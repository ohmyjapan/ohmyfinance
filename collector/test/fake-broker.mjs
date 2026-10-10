// collector/test/fake-broker.mjs — the injected key broker for the default fixtures, plus the helpers those
// fixtures share (plan omf-customer-credential-security-20261009, §2 site 1 test hooks and §4).
//
// Run as a process (`node fake-broker.mjs --role key|owner`, selected by OMF_KEY_BROKER in the collector's
// environment) it speaks the key broker's JSON-lines protocol with an in-memory RSA-2048 key persisted under
// OMF_FAKE_BROKER_DIR/keys, so default fixtures never open the machine TPM, never show a dialog and never consume
// the TPM dictionary-attack counter. Dialog outcomes are scripted by OMF_FAKE_BROKER_DIR/dialog.json
// ({ enroll: 'ok'|'cancel'|'fail'|'unavailable', unseal: 'ok'|'cancel'|'fail', capability: 'ok'|'none' }); every
// request is appended to calls.jsonl (the fixtures count spawns, dialogs and unseal attempts from it); a file named
// `locked` makes the broker print {event:'locked'} and exit, the way the real broker reacts to a Windows lock.
// Imported, it exports those scripted controls and the collector/fake-OMF harness. Nothing runs at import.
import { spawn } from 'node:child_process';
import { createPublicKey, createPrivateKey, generateKeyPairSync, privateDecrypt, randomUUID, createHash, constants as cryptoConstants } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const FAKE_BROKER = fileURLToPath(import.meta.url);
export const COLLECTOR_DIR = path.resolve(path.dirname(FAKE_BROKER), '..');
export const RUN_MJS = path.join(COLLECTOR_DIR, 'run.mjs');

/** The environment that makes a collector use this broker. */
export function brokerEnv(dir) { return { OMF_KEY_BROKER: FAKE_BROKER, OMF_FAKE_BROKER_DIR: dir }; }
export async function setDialog(dir, outcomes) { await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, 'dialog.json'), JSON.stringify(outcomes)); }
export async function readCalls(dir) {
  let text = '';
  try { text = await readFile(path.join(dir, 'calls.jsonl'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
}
export async function triggerLocked(dir) { await writeFile(path.join(dir, 'locked'), ''); }
export async function clearLocked(dir) { await unlink(path.join(dir, 'locked')).catch(() => {}); }
/** Simulates a lost device key: the persisted fake key is deleted; `open` then reports the missing-key code. */
export async function dropKeys(dir) {
  const keys = path.join(dir, 'keys');
  let names = [];
  try { names = await readdir(keys); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const name of names) await unlink(path.join(keys, name));
  return names.length;
}

const keyFile = (dir, name) => path.join(dir, 'keys', encodeURIComponent(name) + '.json');
const b64 = value => Buffer.from(value, 'base64url').toString('base64');
function publicFields(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  return { modulus: b64(jwk.n), exponent: b64(jwk.e) };
}

async function runBroker() {
  const dir = process.env.OMF_FAKE_BROKER_DIR;
  const out = line => process.stdout.write(JSON.stringify(line) + '\n');
  if (!dir) { out({ event: 'fatal', error: 'OMF_FAKE_BROKER_DIR is not set' }); process.exit(2); }
  const roleIndex = process.argv.indexOf('--role');
  const role = roleIndex >= 0 ? process.argv[roleIndex + 1] : 'key';
  await mkdir(path.join(dir, 'keys'), { recursive: true });
  const log = record => appendFile(path.join(dir, 'calls.jsonl'), JSON.stringify({ t: Date.now(), pid: process.pid, role, ...record }) + '\n');
  const dialog = async () => { try { return JSON.parse(await readFile(path.join(dir, 'dialog.json'), 'utf8')); } catch { return {}; } };
  await log({ op: 'start' });
  out({ event: 'ready', role, pid: process.pid, job: false, test: true });
  let key = null, prompted = false;
  const poll = setInterval(async () => {
    if (existsSync(path.join(dir, 'locked'))) { clearInterval(poll); await log({ op: 'event', event: 'locked' }); out({ event: 'locked', reason: 'test' }); process.exit(0); }
  }, 200);
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const raw of input) {
    if (!raw.trim()) continue;
    let request;
    try { request = JSON.parse(raw); } catch { out({ ok: false, code: 'invalid', error: 'invalid request' }); continue; }
    const reply = fields => out({ id: request.id, ...fields });
    const d = await dialog();
    try {
      if (request.op === 'consent') {
        const outcome=d.consent || 'ok';
        await log({op:'consent',action:request.action,outcome});
        if(d.consentDelayMs)await sleep(Math.min(30000,Math.max(0,Number(d.consentDelayMs)||0)));
        if(role!=='consent')reply({ok:false,code:'role'});
        else if(outcome==='ok')reply({ok:true,action:request.action});
        else reply({ok:false,code:outcome==='cancel'?'cancelled':'unavailable'});
      } else if (request.op === 'available') {
        reply({ok:true,available:!existsSync(path.join(dir,'locked'))});
      } else if (request.op === 'capability') {
        await log({ op: 'capability', outcome: d.capability || 'ok' });
        if (d.capability === 'none') reply({ ok: false, code: 'no_provider', error: 'no key storage provider (fake)' });
        else reply({ ok: true, provider: 'fake-broker', implType: 0, hardware: false, test: true });
      } else if (request.op === 'enroll') {
        const outcome = d.enroll || 'ok';
        await log({ op: 'enroll', name: request.name, outcome });
        if (role !== 'key') reply({ ok: false, code: 'role', error: 'owner role has no key' });
        else if (outcome === 'cancel') reply({ ok: false, code: 'cancelled', error: 'the fake dialog was cancelled' });
        else if (outcome === 'fail') reply({ ok: false, code: 'failed', status: '0x80090020', error: 'fake provider failure' });
        else if (outcome === 'unavailable') reply({ ok: false, code: 'no_provider', error: 'no key storage provider (fake)' });
        else if (existsSync(keyFile(dir, request.name))) reply({ ok: false, code: 'exists', error: 'key already exists' });
        else {
          const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
          await writeFile(keyFile(dir, request.name), JSON.stringify({ name: request.name, privateJwk: pair.privateKey.export({ format: 'jwk' }), createdAt: new Date().toISOString() }));
          key = { name: request.name, privateKey: pair.privateKey, publicKey: pair.publicKey };
          prompted = true;
          await log({ op: 'dialog', kind: 'enroll' });
          reply({ ok: true, publicKey: publicFields(pair.publicKey), provider: 'fake-broker', exportPolicy: 0, test: true });
        }
      } else if (request.op === 'open') {
        let record = null;
        try { record = JSON.parse(await readFile(keyFile(dir, request.name), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        await log({ op: 'open', name: request.name, outcome: record ? 'ok' : 'missing' });
        if (!record) reply({ ok: false, code: 'missing', status: '0x80090016', error: 'key not found' });
        else {
          const privateKey = createPrivateKey({ key: record.privateJwk, format: 'jwk' });
          key = { name: request.name, privateKey, publicKey: createPublicKey(privateKey) };
          reply({ ok: true, publicKey: publicFields(key.publicKey), provider: 'fake-broker', exportPolicy: 0, test: true });
        }
      } else if (request.op === 'unseal') {
        const outcome = d.unseal || 'ok';
        await log({ op: 'unseal', outcome });
        if (d.unsealDelayMs) await sleep(Math.min(30000, Math.max(0, Number(d.unsealDelayMs) || 0)));
        if (!key) reply({ ok: false, code: 'no_key', error: 'open or enroll first' });
        else if (outcome === 'cancel') reply({ ok: false, code: 'cancelled', error: 'the fake dialog was cancelled' });
        else if (outcome === 'fail') reply({ ok: false, code: 'failed', status: '0x80090020', error: 'fake provider failure' });
        else {
          if (!prompted) { prompted = true; await log({ op: 'dialog', kind: 'unseal' }); }
          try {
            const unwrapped = privateDecrypt({ key: key.privateKey, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(String(request.wrapped), 'base64'));
            reply({ ok: true, key: unwrapped.toString('base64') });
          } catch { reply({ ok: false, code: 'failed', error: 'the wrapped key does not belong to this device key' }); }
        }
      } else if (request.op === 'inspect') {
        await log({ op: 'inspect' });
        if (!key) reply({ ok: false, code: 'no_key', error: 'open or enroll first' });
        else reply({ ok: true, publicKey: publicFields(key.publicKey), provider: 'fake-broker', exportPolicy: 0, test: true });
      } else if (request.op === 'destroy') {
        await log({ op: 'destroy', name: request.name });
        await unlink(keyFile(dir, request.name)).catch(() => {});
        key = null;
        reply({ ok: true });
      } else if (request.op === 'own') {
        await log({ op: 'own', pid: request.pid });
        reply({ ok: true, owned: false, test: true });
      } else if (request.op === 'end') {
        await log({ op: 'end' });
        reply({ ok: true });
        break;
      } else {
        reply({ ok: false, code: 'unknown_op', error: 'unknown operation' });
      }
    } catch (error) {
      reply({ ok: false, code: 'failed', error: String(error && error.message || error) });
    }
  }
  clearInterval(poll);
  process.exit(0);
}

// ── harness shared by the default fixtures ──────────────────────────────────────────────────────────────
export async function freePort() {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', () => resolve(undefined)));
  const { port } = /** @type {import('node:net').AddressInfo} */ (reservation.address());
  await new Promise(resolve => reservation.close(resolve));
  return port;
}
export async function waitFor(read, timeoutMs = 10000, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs;
  do {
    try { const value = await read(); if (value) return value; } catch { /* retry */ }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);
  return false;
}
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Synthetic statement already on disk; no provider or original statement file is used. */
export async function writePendingItem(directory,account,{jobId,ownerId,origin,pageCount=1,acknowledgedAt}) {
  const dir=path.join(directory,'outbox',account._id,jobId);await mkdir(dir,{recursive:true});
  const filename=randomUUID(),bytes=Buffer.from('synthetic,csv\n'+jobId+'\n');
  await writeFile(path.join(dir,filename),bytes);
  const manifest={accountId:account._id,primaryCard:account.primaryCard,jobId,kind:'statement',start:'2026-04-22',end:'2026-05-21',pageCount,sha256:createHash('sha256').update(bytes).digest('hex'),filename,downloadedAt:new Date().toISOString(),...(ownerId?{ownerId}:{}),...(origin?{origin}:{}),...(acknowledgedAt?{acknowledgedAt}:{})};
  const file=path.join(dir,'manifest.json');await writeFile(file,JSON.stringify(manifest,null,2));return file;
}

/** A fake OMF on loopback: the four collector routes, every call counted, claims handed out from a queue. */
export async function startFakeOmf({ accounts = [] } = {}) {
  const counts = { accounts: 0, claim: 0, status: 0, upload: 0, unauthorized: 0 };
  const queue = [], uploads = [], statuses = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const route = url.pathname.replace('/api/finance/collector/', '');
    const json = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (!/^Bearer omfc_[a-f\d]{64}$/.test(req.headers.authorization || '')) { counts.unauthorized += 1; return json(401, { statusMessage: 'Unauthorized' }); }
    let body = Buffer.alloc(0);
    for await (const chunk of req) body = Buffer.concat([body, chunk]);
    if (route === 'accounts' && req.method === 'GET') { counts.accounts += 1; return json(200, { accounts: accounts.map(a => ({ ...a, jobState: queue.length ? 'queued' : (a.jobState || 'idle') })) }); }
    if (route === 'claim' && req.method === 'POST') { counts.claim += 1; return json(200, { account: queue.shift() || null }); }
    if (route === 'status' && req.method === 'POST') { counts.status += 1; try { statuses.push(JSON.parse(body.toString('utf8'))); } catch { statuses.push(null); } return json(200, { success: true }); }
    if (route === 'upload' && req.method === 'POST') { counts.upload += 1; uploads.push({ query: Object.fromEntries(url.searchParams), bytes: body.length }); return json(200, { id: 'import-' + counts.upload }); }
    json(404, { statusMessage: 'Collector endpoint not found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const origin = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  return { origin, counts, uploads, statuses, queue: account => queue.push(account), pending: () => queue.length, close: () => new Promise(resolve => server.close(resolve)) };
}

/**
 * Starts the real collector (run.mjs) as a child on a private directory and returns its setup client.
 * @param {{ directory: string, env?: Record<string, string>, timeoutMs?: number, hideBrowser?: boolean }} options
 */
export async function startCollector({ directory, env = {}, timeoutMs = 30000, hideBrowser = false }) {
  const port = await freePort();
  // Test-only launcher: browser-module loading restores ProgramFiles on this Windows runtime. Override its
  // search locations afterward, before importing run.mjs; no real browser can launch on an unexpected branch.
  const noBrowser=path.join(directory,'no-browser');
  const args=hideBrowser?['--input-type=module','-e',`await import(${JSON.stringify(new URL('../browser.mjs',import.meta.url).href)}); for(const key of ['ProgramFiles','ProgramFiles(x86)','LOCALAPPDATA']) process.env[key]=${JSON.stringify(noBrowser)}; await import(${JSON.stringify(new URL('../run.mjs',import.meta.url).href)});`]:[RUN_MJS];
  const child = spawn(process.execPath, args, { windowsHide: true, env: { ...process.env, OMF_COLLECTOR_DIR: directory, OMF_COLLECTOR_PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [];
  child.stdout.on('data', data => output.push(String(data)));
  child.stderr.on('data', data => output.push(String(data)));
  const linkFile = path.join(directory, 'setup-link.txt');
  const link = await waitFor(async () => {
    if (child.exitCode !== null) throw new Error('collector exited');
    const text = (await readFile(linkFile, 'utf8')).trim();
    return text.startsWith('http://127.0.0.1:' + port + '/#') ? text : null;
  }, timeoutMs, 100);
  if (!link) {
    if (child.exitCode === null) child.kill();
    throw new Error('the collector did not start: ' + output.join('').slice(0, 400));
  }
  const origin = new URL(link).origin, key = new URL(link).hash.slice(1);
  const request = async (route, body, extra = {}) => {
    const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Setup-Key': key, ...extra }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(240000) });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, data, text };
  };
  const status = async () => (await request('/status')).data || {};
  const waitStartup = async (ms = 60000) => waitFor(async () => (await status()).startupDone === true, ms, 250);
  const stop = async () => {
    if (child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
  };
  return { child, port, origin, key, link, request, status, waitStartup, stop, output };
}

/** Removes a directory this run created under the OS temp directory; never follows a link, never leaves the temp root. */
export async function removeOwnedTemp(directory, { tmpdir }) {
  const root = path.resolve(tmpdir) + path.sep;
  if (!path.resolve(directory).startsWith(root)) throw new Error('refusing to remove ' + directory + ': not under ' + root);
  for (let attempt = 0; ; attempt += 1) {
    try { await rm(directory, { recursive: true, force: true }); return; }
    catch (error) { if (attempt >= 6) throw error; await sleep(400); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === FAKE_BROKER) {
  runBroker().catch(error => { process.stdout.write(JSON.stringify({ event: 'fatal', error: String(error && error.message || error) }) + '\n'); process.exit(1); });
}
