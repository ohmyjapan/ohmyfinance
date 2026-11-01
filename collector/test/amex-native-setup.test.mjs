// collector/test/amex-native-setup.test.mjs — the attended Amex download of the local setup (case omf-amex-native-runtime-01): routine
// Amex jobs run in a Chrome that is never shown; the person arms ONE card on the setup screen (it starts nothing), requests
// 確定明細を取得 for it in OMF, and that one job runs with Chrome on the person's desktop. Legs:
//  - the REAL index.mjs attendedInput / armAttended / takeAttended / attendedStatus: the body, the card of this connection that OMF still
//    lists, the binding to the job OMF held at arming (only a later job of that card, in that session, before the expiry, consumes it);
//  - the REAL setup.html + setup.js in owned headless Chrome against a stub of the setup endpoints: what the control says and posts;
//  - the REAL collector process (run.mjs) with the fake key broker and a loopback TLS fake OMF: the setup route's refusals, and a
//    manual batch's claimed Amex job handed to the native helper on the person's desktop (-Mode input); the helper is a scripted stand-in
//    put at amex-native.mjs nativeHost.spawn by that process's own launcher (it refuses the launch: no Chrome starts);
//  - the same in a PROTECTED session (case attended-fold-01): the route's preparation and its binding, Cancel during the preparation, a
//    failed lookup, Lock, and the preparation against the collector's claims and other setup actions (the action slot), each with jobs
//    claimed after it (private: no helper; attended: the stand-in on the person's desktop).
// Fictional accounts and tokens; owned temporary directories with a fresh LOCALAPPDATA; no issuer, mailbox, vault key or real OMF.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-amex-attended-'));
process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector-dir'); process.env.LOCALAPPDATA = path.join(temp, 'local');
const index = await import(pathToFileURL(process.env.OMF_TEST_INDEX_MODULE ? path.resolve(process.env.OMF_TEST_INDEX_MODULE) : path.join(here, '..', 'index.mjs')).href);
const execute = promisify(execFile);
const WINDOWS = process.platform === 'win32' ? false : 'Windows only';
const AMEX = 'a1'.repeat(12), OTHER_AMEX = 'a2'.repeat(12), APLUS = 'b1'.repeat(12), OWNER = 'c1'.repeat(12);
const CONFIG = { baseUrl: 'https://omf.example.invalid', token: 'omfc_' + 'd'.repeat(64), accountInfo: [{ _id: AMEX, ownerId: OWNER, provider: 'amex', primaryCard: '12345', name: 'Card A' }, { _id: OTHER_AMEX, ownerId: OWNER, provider: 'amex', primaryCard: '54321', name: 'Card B' }, { _id: APLUS, ownerId: OWNER, provider: 'aplus', primaryCard: '1234', name: 'Aplus' }] };
const LIVE = { id: 'session-1', mode: 'protected' };
test.after(async () => { await rm(temp, { recursive: true, force: true }).catch(() => {}); });

test('attendedInput: exactly an Amex card account id, and cancel: true; anything else is refused before any session or OMF call', () => {
  assert.deepEqual(index.attendedInput({ accountId: AMEX }), { accountId: AMEX, cancel: false });
  assert.deepEqual(index.attendedInput({ accountId: AMEX, cancel: true }), { accountId: AMEX, cancel: true });
  for (const body of [null, [], {}, { accountId: 'x' }, { accountId: AMEX, cancel: 'yes' }, { accountId: AMEX, cancel: false }, { accountId: AMEX, jobId: 'j' }, { accountId: AMEX, until: 1 }])
    assert.throws(() => index.attendedInput(body), /Choose the Amex card/, 'attended:input-refused ' + JSON.stringify(body));
});

test('armAttended: an Amex card of this connection that OMF lists now, bound to the job OMF holds for it and a ten-minute expiry; an Aplus card, an unknown card, a card OMF no longer lists or a failed OMF lookup arm nothing', async () => {
  const now = () => 1_800_000_000_000, accounts = async () => [{ _id: AMEX, provider: 'amex', jobId: 'job-before', jobState: 'failed' }, { _id: APLUS, provider: 'aplus' }];
  const intent = await index.armAttended({ accountId: AMEX }, { live: LIVE, config: CONFIG, accounts, now });
  assert.deepEqual(intent, { session: 'session-1', accountId: AMEX, priorJobId: 'job-before', armedAt: now(), until: now() + index.ATTENDED_MS }, 'attended:armed-binding');
  assert.equal(index.ATTENDED_MS, 600000, 'attended:ten-minutes');
  assert.deepEqual((await index.armAttended({ accountId: AMEX }, { live: LIVE, config: CONFIG, accounts: async () => [{ _id: AMEX, provider: 'amex' }], now })).priorJobId, null, 'attended:no-prior-job');
  for (const [label, input, list] of [['aplus', { accountId: APLUS }, accounts], ['unknown', { accountId: 'e'.repeat(24) }, accounts], ['not-listed', { accountId: OTHER_AMEX }, accounts]]) {
    let called = 0; const counted = async () => { called++; return list(); };
    await assert.rejects(index.armAttended(input, { live: LIVE, config: CONFIG, accounts: counted, now }), error => error.code === 'forbidden', 'attended:refused ' + label);
    assert.equal(called, label === 'not-listed' ? 1 : 0, 'attended:config-checked-before-omf ' + label);
  }
  await assert.rejects(index.armAttended({ accountId: AMEX }, { live: LIVE, config: CONFIG, accounts: async () => { throw new Error('OMF connection failed'); }, now }), /OMF connection failed/, 'attended:omf-failure-arms-nothing');
});

test('takeAttended: only a later job of the armed card, claimed in the same session before the expiry, is attended — once; the job OMF held at arming, other cards, another session or an expired arming are private', () => {
  const t = 1_800_000_000_000, intent = { session: 'session-1', accountId: AMEX, priorJobId: 'job-before', armedAt: t, until: t + index.ATTENDED_MS };
  const job = (id, jobId) => ({ _id: id, jobId, provider: 'amex' });
  assert.deepEqual(index.takeAttended(intent, LIVE, job(AMEX, 'job-after'), t + 1000), { attended: true, intent: null }, 'attended:next-job-consumes');
  assert.deepEqual(index.takeAttended(intent, LIVE, job(AMEX, 'job-before'), t + 1000), { attended: false, intent }, 'attended:prior-job-private-kept');
  assert.deepEqual(index.takeAttended(intent, LIVE, job(OTHER_AMEX, 'job-x'), t + 1000), { attended: false, intent }, 'attended:other-card-private-kept');
  assert.deepEqual(index.takeAttended(intent, { id: 'session-2', mode: 'protected' }, job(AMEX, 'job-after'), t + 1000), { attended: false, intent: null }, 'attended:other-session-dropped');
  assert.deepEqual(index.takeAttended(intent, LIVE, job(AMEX, 'job-after'), t + index.ATTENDED_MS + 1), { attended: false, intent: null }, 'attended:expired-dropped');
  assert.deepEqual(index.takeAttended(null, LIVE, job(AMEX, 'job-after'), t), { attended: false, intent: null }, 'attended:none');
  assert.deepEqual(index.takeAttended({ ...intent, priorJobId: null }, LIVE, job(AMEX, 'job-first'), t + 1), { attended: true, intent: null }, 'attended:first-job');
  // once consumed, the same job claimed again (an expired lease re-claims it) runs private
  const after = index.takeAttended(intent, LIVE, job(AMEX, 'job-after'), t + 1000).intent;
  assert.deepEqual(index.takeAttended(after, LIVE, job(AMEX, 'job-after'), t + 2000), { attended: false, intent: null }, 'attended:consumed-once');
  assert.deepEqual(index.attendedStatus(intent, LIVE, t + 1), { accountId: AMEX, until: new Date(t + index.ATTENDED_MS).toISOString() }, 'attended:status');
  assert.equal(index.attendedStatus(intent, { id: 'session-2' }, t + 1), null, 'attended:status-other-session');
  assert.equal(index.attendedStatus(intent, LIVE, t + index.ATTENDED_MS + 1), null, 'attended:status-expired');
});

// ── the real setup page against a stub of the setup endpoints (owned headless Chrome) ──────────────────────────────────────────────────
async function stubCollector(state) {
  const posts = [], key = 'k'.repeat(64);
  const server = http.createServer(async (req, res) => {
    const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
    if (req.method === 'GET' && req.url === '/') return send(200, 'text/html; charset=utf-8', await readFile(path.join(here, '..', 'setup.html')));
    if (req.method === 'GET' && req.url === '/setup.js') return send(200, 'text/javascript; charset=utf-8', await readFile(process.env.OMF_TEST_SETUP_SCRIPT ? path.resolve(process.env.OMF_TEST_SETUP_SCRIPT) : path.join(here, '..', 'setup.js')));
    if (req.headers['x-setup-key'] !== key) return send(403, 'application/json', JSON.stringify({ error: 'key' }));
    let body = ''; for await (const chunk of req) body += chunk;
    if (req.method === 'GET' && req.url === '/status') return send(200, 'application/json', JSON.stringify(state.status()));
    if (req.method === 'GET' && ['/aplus/status', '/yayoi/status'].includes(req.url)) return send(200, 'application/json', JSON.stringify({ busy: false, unlocked: state.unlocked, aplus: { hasCredentials: false }, yayoi: { state: 'idle', message: '', hasCredentials: false } }));
    if (req.method === 'POST' && req.url === '/amex/attended') { const parsed = JSON.parse(body); posts.push(parsed); state.armed = parsed.cancel ? null : { accountId: parsed.accountId, until: new Date(Date.now() + 600000).toISOString() }; return send(200, 'application/json', JSON.stringify({ amexAttended: state.armed })); }
    return send(404, 'application/json', JSON.stringify({ error: 'Unknown setup endpoint' }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { origin: 'http://127.0.0.1:' + server.address().port, key, posts, close: () => new Promise(r => server.close(r)) };
}
const statusOf = state => ({ message: 'Connected.', approvalUrl: null, reconnectNeeded: false, baseUrl: CONFIG.baseUrl, pcName: 'PC', connect: { phase: 'idle' }, busy: false, authorizing: false, locking: false, legacy: false, protected: true, mode: state.mode, capability: true, unlocked: state.unlocked, unlockUntil: new Date(Date.now() + 600000).toISOString(), due: false, paused: false, keyLost: false, aclProtected: true, elevated: false, chromeFound: true, testBroker: false, startupDone: true, aplus: { hasCredentials: false }, yayoi: { state: 'idle', message: '', hasCredentials: false }, mailbox: { hasCredentials: false }, smsSource: { serial: null, adbFound: false },
  accounts: [{ id: '12345', accountId: AMEX, name: 'Card A', provider: 'amex', hasCredentials: true }, { id: '1234', accountId: APLUS, name: 'Aplus', provider: 'aplus', hasCredentials: true }], banks: [], legacyCards: { available: false, state: 'legacy-none' }, amexAttended: state.armed });
test('the real setup page: the Amex card section says the attended download starts nothing and names 確定明細を取得 in OMF; Prepare posts exactly that card, the prepared state offers Cancel; disabled outside a protected session; none for Aplus; a manual batch says Chrome opens there', { skip: WINDOWS, timeout: 180000 }, async () => {
  const { browserFor, closeOwnedBrowsers } = await import('../browser.mjs');
  const state = { unlocked: false, mode: 'protected', armed: null }; state.status = () => statusOf(state);
  const collector = await stubCollector(state), profileDir = await mkdtemp(path.join(temp, 'chrome-'));
  const browser = await browserFor(path.join(profileDir, 'profile'), { headless: true }); let page; const errors = [];
  try {
    page = await browser.newPage(); page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const card = `[data-amex-attended="${AMEX}"] `, open = async () => { await page.goto('about:blank'); await page.goto(collector.origin + '/#' + collector.key, { waitUntil: 'networkidle0' }); };
    const wait = async (fn, arg, label) => { for (let i = 0; i < 150; i++) { if (await page.evaluate(fn, arg)) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('attended-setup:chrome ' + label + ' — ' + String(await page.$eval('#accounts', e => e.innerText).catch(() => 'no #accounts')).slice(0, 600)); };
    await open(); await wait(sel => !!document.querySelector(sel), card, 'amex control');
    assert.equal(await page.$(`[data-amex-attended="${APLUS}"]`), null, 'attended-setup:no-aplus-control');
    const note = await page.$eval(card + '[data-amex-attended-note]', e => e.textContent);
    assert.ok(/starts nothing/.test(note) && note.includes('確定明細を取得') && /within 10 minutes/.test(note) && /not shown/.test(note), 'attended-setup:truthful-note ' + note);
    assert.deepEqual(await page.$eval(card + '[data-amex-attended-arm]', e => [e.disabled, e.textContent]), [true, 'Prepare an attended download'], 'attended-setup:needs-protected-session');
    assert.ok(/prepare an attended download/.test(await page.$eval('#mailbox-saved', e => e.textContent)), 'attended-setup:mailbox-note-names-the-way');
    state.unlocked = true; await open(); await wait(sel => { const e = document.querySelector(sel); return !!e && !e.disabled; }, card + '[data-amex-attended-arm]', 'prepare enabled');
    assert.equal(await page.$eval(card + '[data-amex-attended-cancel]', e => e.classList.contains('hidden')), true, 'attended-setup:cancel-hidden-until-prepared');
    await page.click(card + '[data-amex-attended-arm]');
    await wait(sel => /Prepared until/.test(document.querySelector(sel)?.textContent || ''), card + '[data-amex-attended-note]', 'prepared note');
    const prepared = await page.$eval(card + '[data-amex-attended-note]', e => e.textContent);
    assert.ok(prepared.includes('Nothing has started yet') && prepared.includes('確定明細を取得'), 'attended-setup:prepared-truthful ' + prepared);
    assert.deepEqual(await page.$eval(card + '[data-amex-attended-cancel]', e => [e.classList.contains('hidden'), e.disabled]), [false, false], 'attended-setup:cancel-offered');
    await page.click(card + '[data-amex-attended-cancel]');
    await wait(sel => !/Prepared until/.test(document.querySelector(sel)?.textContent || ''), card + '[data-amex-attended-note]', 'cancelled note');
    assert.deepEqual(collector.posts, [{ accountId: AMEX }, { accountId: AMEX, cancel: true }], 'attended-setup:exact-bodies');
    state.mode = 'manual'; await open(); await wait(sel => /manual batch/.test(document.querySelector(sel)?.textContent || ''), card, 'manual note');
    assert.equal(await page.$(card + '[data-amex-attended-arm]'), null, 'attended-setup:manual-no-arming');
    assert.deepEqual(errors, [], 'attended-setup:no-console-errors');
  } finally { if (page) await page.close().catch(() => {}); await closeOwnedBrowsers(); await collector.close(); }
});

// ── the real collector process: its setup route and a manual batch's claimed Amex job, over a loopback TLS fake OMF ────────────────────
const OPENSSL = 'C:/Program Files/Git/usr/bin/openssl.exe';
// The card list reports the card's latest job (jobId), as OMF's does. hold(route): the next card-list or claim request is answered only on
// release, with the answer taken when it arrived. failAccounts / listed: card-list answers refused, or without the card. `security` (the
// protected legs): the PC's trust token answers one short grant (session); wrapped keys are stored and read back under a live grant; lock
// revokes it — what a remembered PC's silent resume and its saved-entry reads ask (omf-authorization.mjs resumeWithOmf, keyService).
async function fakeOmf(dir, { security = null } = {}) {
  const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  await execute(OPENSSL, ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { windowsHide: true, timeout: 30000 });
  const state = { queue: [], statuses: [], claims: 0, jobId: null, holds: { accounts: [], claim: [] }, failAccounts: 0, listed: true, grants: new Set(), keys: new Map(), sessions: 0 };
  const account = { _id: AMEX, ownerId: OWNER, provider: 'amex', name: 'Card A', primaryCard: '12345', cardIdentifiers: ['12345'], otpRecipient: 'codes@example.invalid', otpMailbox: 'codes@example.invalid' };
  const held = async route => { const gate = state.holds[route].shift(); if (gate) { gate.arrive(); await gate.released; } };
  const server = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, async (req, res) => {
    const json = (code, value) => { try { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); } catch { /* the client left */ } };
    let body = ''; for await (const chunk of req) body += chunk;
    if (!/^Bearer omfc_[a-f\d]{64}$/.test(req.headers.authorization || '')) return json(401, { statusMessage: 'Unauthorized' });
    const route = new URL(req.url, 'https://127.0.0.1').pathname.replace('/api/finance/collector/', '');
    if (route === 'accounts' && req.method === 'GET') {
      if (state.failAccounts > 0) { state.failAccounts--; return json(503, { statusMessage: 'Synthetic OMF failure' }); }
      const answer = { accounts: state.listed ? [{ ...account, jobId: state.jobId, jobState: state.queue.length ? 'queued' : 'idle' }] : [] };
      await held('accounts'); return json(200, answer);
    }
    if (route === 'claim' && req.method === 'POST') { state.claims++; const answer = { account: state.queue.shift() || null }; await held('claim'); return json(200, answer); }
    if (route === 'status' && req.method === 'POST') { state.statuses.push(JSON.parse(body)); return json(200, { success: true }); }
    if (req.url.startsWith('/api/finance-payments/collector/bank/claim')) return json(404, { statusMessage: 'none' });
    if (security && route.startsWith('/api/finance/collector-security/')) {
      const sub = route.slice('/api/finance/collector-security/'.length), grant = req.headers['x-collector-grant'];
      let asked = {}; try { asked = body ? JSON.parse(body) : {}; } catch { return json(400, { statusMessage: 'Invalid body' }); }
      if (sub === 'session' && req.method === 'POST') {
        if (asked.installationId !== security.installationId || asked.generation !== security.generation || asked.trustToken !== security.trustToken) return json(401, { statusMessage: 'Unknown PC' });
        const issued = randomBytes(32).toString('hex'); state.grants.add(issued); state.sessions++;
        return json(200, { installationId: security.installationId, generation: security.generation, publicKey: security.publicKey, action: 'resume', grant: issued, expiresAt: new Date(Date.now() + 20 * 60000).toISOString() });
      }
      if (!state.grants.has(grant)) return json(403, { statusMessage: 'Grant required' });
      if (sub === 'lock' && req.method === 'POST') { state.grants.delete(grant); return json(200, {}); }
      if (sub === 'keys' && req.method === 'POST') { state.keys.set(asked.keyId, asked); return json(200, { keyId: asked.keyId, generation: security.generation }); }
      const stored = sub.startsWith('keys/') && req.method === 'GET' ? state.keys.get(sub.slice('keys/'.length)) : null;
      if (stored) return json(200, { ...stored, generation: security.generation });
    }
    return json(404, { statusMessage: 'Collector endpoint not found' });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const hold = route => { const gate = {}; gate.arrived = new Promise(r => { gate.arrive = r; }); gate.released = new Promise(r => { gate.release = r; }); state.holds[route].push(gate); return gate; };
  const unhold = gate => { for (const list of Object.values(state.holds)) { const at = list.indexOf(gate); if (at >= 0) list.splice(at, 1); } gate.release(); };
  return { origin: 'https://127.0.0.1:' + server.address().port, cert, state, hold, unhold, queue: jobId => { state.jobId = jobId; state.queue.push({ ...account, jobId }); }, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}
// The collector process with a launcher that puts a stand-in at amex-native.mjs nativeHost.spawn, then starts the collector as run.mjs does.
// The stand-in records its arguments (never a value) and refuses the launch, so the job ends before any Chrome.
const STAND_IN = `
import { EventEmitter } from 'node:events'; import { PassThrough, Writable } from 'node:stream'; import { appendFileSync } from 'node:fs';
const native = await import(process.env.OMF_TEST_NATIVE_URL);
native.nativeHost.spawn = args => {
  const child = new EventEmitter(), out = new PassThrough(); let buffer = '', ended = false;
  appendFileSync(process.env.OMF_TEST_STAND_IN, JSON.stringify({ event: 'spawn', mode: args[args.indexOf('-Mode') + 1], profile: args[args.indexOf('-ProfileDir') + 1] }) + '\\n');
  const finish = () => { if (ended) return; ended = true; out.end(JSON.stringify({ event: 'end', reason: 'closed', chromeEnded: true, desktopClosed: true }) + '\\n'); setImmediate(() => child.emit('close', 0)); };
  Object.assign(child, { pid: 54001, stdout: out, stderr: new PassThrough(), kill() { finish(); return true; } });
  child.stdin = new Writable({ write(chunk, _e, callback) { buffer += chunk; let i; while ((i = buffer.indexOf('\\n')) >= 0) { const r = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1); appendFileSync(process.env.OMF_TEST_STAND_IN, JSON.stringify({ event: 'op', op: r.op }) + '\\n');
    if (!ended) out.write(JSON.stringify(r.op === 'launch' ? { id: r.id, ok: false, code: 'chrome_creation', acted: false } : { id: r.id, ok: true }) + '\\n'); if (r.op === 'close') finish(); } callback(); }, final(callback) { finish(); callback(); } });
  setImmediate(() => out.write(JSON.stringify({ event: 'ready', pid: child.pid, mode: args[args.indexOf('-Mode') + 1] }) + '\\n'));
  return child;
};
// what run.mjs does for a background start (no setup window): startCollector() of index.mjs (OMF_TEST_INDEX_MODULE: a copy beside it)
const collector = await import(process.env.OMF_TEST_INDEX_URL);
collector.startCollector().catch(() => { process.exitCode = 1; });
`;
async function startCollector(dir, env) {
  const port = await new Promise(resolve => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const child = spawn(process.execPath, ['--input-type=module', '-e', STAND_IN], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env, OMF_COLLECTOR_PORT: String(port), OMF_TEST_NATIVE_URL: pathToFileURL(path.join(here, '..', 'amex-native.mjs')).href, OMF_TEST_INDEX_URL: pathToFileURL(process.env.OMF_TEST_INDEX_MODULE ? path.resolve(process.env.OMF_TEST_INDEX_MODULE) : path.join(here, '..', 'index.mjs')).href } });
  const output = []; child.stdout.on('data', d => output.push(String(d))); child.stderr.on('data', d => output.push(String(d)));
  let link = null;
  for (let i = 0; i < 300 && !link; i++) { if (child.exitCode !== null) break; try { const text = (await readFile(path.join(dir, 'setup-link.txt'), 'utf8')).trim(); if (text.startsWith('http://127.0.0.1:' + port + '/#')) link = text; } catch { /* not yet */ } await new Promise(r => setTimeout(r, 100)); }
  if (!link) { child.kill(); throw new Error('the collector did not start: ' + output.join('').slice(0, 600)); }
  const origin = new URL(link).origin, key = new URL(link).hash.slice(1);
  const request = async (route, body) => { const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Setup-Key': key }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }); const text = await response.text(); let data = null; try { data = JSON.parse(text); } catch { /* text */ } return { status: response.status, data, text }; };
  const stop = async () => { if (child.exitCode === null) { const exited = new Promise(r => child.once('exit', r)); child.kill(); await exited; } };
  return { request, stop, output };
}
const until = async (read, ms, label) => { const deadline = Date.now() + ms; for (;;) { const value = await read(); if (value) return value; if (Date.now() > deadline) throw new Error('timed out: ' + label); await new Promise(r => setTimeout(r, 200)); } };
test('the real collector process: /amex/attended refuses a malformed body (400) and a session that is not protected (403); a manual batch\'s claimed Amex job goes to the native helper on the person\'s desktop, owned by the batch first, and the job ends failed without any Chrome', { skip: WINDOWS, timeout: 240000 }, async () => {
  const { FAKE_BROKER } = await import('./fake-broker.mjs');
  const dir = path.join(temp, 'collector-run'), brokerDir = path.join(temp, 'broker'), local = path.join(temp, 'local-run'), standIn = path.join(temp, 'stand-in.jsonl');
  await mkdir(dir, { recursive: true }); await mkdir(brokerDir, { recursive: true }); await mkdir(local, { recursive: true });
  const omf = await fakeOmf(temp);
  const collector = await startCollector(dir, { OMF_COLLECTOR_DIR: dir, LOCALAPPDATA: local, OMF_KEY_BROKER: FAKE_BROKER, OMF_FAKE_BROKER_DIR: brokerDir, OMF_COLLECTOR_TICK_MS: '1000', NODE_EXTRA_CA_CERTS: omf.cert, OMF_TEST_STAND_IN: standIn, OMF_COLLECTOR_ORIGIN: omf.origin });
  try {
    await until(async () => (await collector.request('/status')).data?.startupDone === true, 60000, 'startup');
    assert.equal((await collector.request('/amex/attended', '{not json')).status, 400, 'attended-route:malformed-400');
    assert.equal((await collector.request('/amex/attended', { accountId: AMEX, extra: 1 })).status, 400, 'attended-route:shape-400');
    assert.equal((await collector.request('/amex/attended', { accountId: AMEX })).status, 403, 'attended-route:needs-protected-session');
    assert.equal((await collector.request('/status')).data.amexAttended, null, 'attended-route:status-none');
    const token = 'omfc_' + randomBytes(32).toString('hex');
    assert.equal((await collector.request('/pair', { token, baseUrl: omf.origin + '/' })).status, 200, 'pair ' + (await collector.request('/status')).data.message);
    assert.equal((await collector.request('/mode', { mode: 'manual' })).status, 200, 'manual mode');
    assert.equal((await collector.request('/batch/start', {})).status, 200, 'manual batch');
    assert.equal((await collector.request('/amex/attended', { accountId: AMEX })).status, 403, 'attended-route:manual-batch-not-protected');
    omf.queue('job-manual-1');
    const failed = await until(() => omf.state.statuses.find(s => s.jobId === 'job-manual-1' && s.state === 'failed'), 60000, 'the job failed');
    const records = (await readFile(standIn, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); // none when no helper started
    assert.deepEqual(records.filter(r => r.event === 'spawn').map(r => r.mode), ['input'], 'attended-route:manual-batch-input-desktop ' + JSON.stringify(records));
    assert.deepEqual(records.filter(r => r.event === 'op').map(r => r.op), ['launch', 'close'], 'attended-route:launch-refused-closed ' + JSON.stringify(records));
    const calls = (await readFile(path.join(brokerDir, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.ok(calls.some(c => c.op === 'own' && c.pid === 54001), 'attended-route:helper-owned-by-the-batch ' + JSON.stringify(calls.map(c => c.op)));
    assert.equal(failed.message, 'Open the downloader setup screen on the connected PC for details', 'attended-route:generic-omf-failure');
  } finally { await collector.request('/lock', {}).catch(() => {}); await collector.stop(); await omf.close(); }
});

// ── the real collector process in a protected session: the preparation against Cancel, a failed lookup, the session's end, claims and other
// setup actions (case attended-fold-01) ────────────────────────────────────────────────────────────────────────────────────────────────
// One collector for these legs, on its own owned root with a fresh LOCALAPPDATA: the state an activated connection leaves (the DPAPI device
// key and trust credential, the connection metadata with its protection record, the sealed canary whose wrapped key the fake OMF holds, the
// active state) is written here, and the collector resumes it on its first tick with the fake key broker. No Amex login is saved, so a
// private job ends before any helper starts (amex-native.mjs NO_LOGIN) and an attended one starts the stand-in on the person's desktop
// (-Mode input), which refuses the launch: no Chrome starts in these legs. Fictional card, token and keys only.
const P = {};
const BUSY = /Wait for the current collector action to finish/;
async function protectedCollector() {
  if (P.collector) return P;
  const { FAKE_BROKER } = await import('./fake-broker.mjs'), { SplitStore, Vault, aadOf, replaceVaultFile } = await import('../vault.mjs');
  P.root = await mkdtemp(path.join(os.tmpdir(), 'omf-amex-attended-protected-'));
  const dir = path.join(P.root, 'collector'), local = path.join(P.root, 'local'), brokerDir = path.join(P.root, 'broker'), omfDir = path.join(P.root, 'omf');
  for (const d of [dir, local, brokerDir, omfDir]) await mkdir(d, { recursive: true });
  P.standIn = path.join(P.root, 'stand-in.jsonl');
  const security = {}; P.omf = await fakeOmf(omfDir, { security });
  const store = new SplitStore(dir), generation = randomBytes(32).toString('hex'), installationId = randomBytes(16).toString('hex'), activatedAt = new Date().toISOString();
  let key, trustToken;
  await store.withLock(async () => { key = await store.deviceKey(generation, { create: true }); trustToken = await store.trustCredential(generation, { create: true }); });
  Object.assign(security, { installationId, generation, publicKey: key.publicKey, trustToken });
  const config = { baseUrl: P.omf.origin, token: 'omfc_' + randomBytes(32).toString('hex'), accountInfo: [{ _id: AMEX, primaryCard: '12345', name: 'Card A', ownerId: OWNER, provider: 'amex' }], accounts: {}, services: {}, mode: 'protected', protection: { installationId, generation, keyProvider: 'CurrentUser DPAPI + OMF', publicKey: key.publicKey, activatedAt } };
  const remote = { check() {}, async put(record) { P.omf.state.keys.set(record.keyId, record); return { keyId: record.keyId, generation }; }, async get(keyId) { return { ...P.omf.state.keys.get(keyId), generation }; } };
  await store.withLock(async () => {
    await store.save('check', aadOf({ installationId, origin: P.omf.origin, ownerId: OWNER, provider: 'check', accountId: 'check' }), { canary: randomBytes(16).toString('hex') }, { remote, localKey: key, generation });
    await new Vault(dir).update(() => config);
    await replaceVaultFile(path.join(dir, 'vault-state.json'), JSON.stringify({ v: 3, phase: 'active', installationId, generation, publicKey: key.publicKey, activatedAt }));
  });
  key.close();
  P.collector = await startCollector(dir, { OMF_COLLECTOR_DIR: dir, LOCALAPPDATA: local, OMF_KEY_BROKER: FAKE_BROKER, OMF_FAKE_BROKER_DIR: brokerDir, OMF_COLLECTOR_TICK_MS: '1000', NODE_EXTRA_CA_CERTS: P.omf.cert, OMF_TEST_STAND_IN: P.standIn });
  await until(async () => { const s = (await P.collector.request('/status')).data; return s?.unlocked && s.mode === 'protected'; }, 90000, 'the protected session resumed: ' + P.collector.output.join('').slice(-400));
  return P;
}
test.after(async () => { if (P.collector) { await P.collector.request('/lock', {}).catch(() => {}); await P.collector.stop(); } if (P.omf) await P.omf.close(); if (P.root) await rm(P.root, { recursive: true, force: true }).catch(() => {}); });
const statusNow = async () => (await P.collector.request('/status')).data || {};
const attendedNow = async () => (await statusNow()).amexAttended ?? null;
// a request the collector's own claim may hold the action slot for a moment: a 409 "wait" is asked again
async function act(route, body) { for (let i = 0; i < 80; i++) { const r = await P.collector.request(route, body); if (!(r.status === 409 && BUSY.test(r.data?.error || ''))) return r; await new Promise(r2 => setTimeout(r2, 150)); } throw new Error('the collector stayed busy for ' + route); }
async function resume() { const r = await P.collector.request('/resume', {}); assert.equal(r.status, 200, 'resume ' + r.text); await until(async () => { const s = await statusNow(); return s.unlocked && s.mode === 'protected'; }, 90000, 'the protected session resumed'); }
// the session is live, no job runs and nothing is prepared
async function ready() { await protectedCollector(); await until(async () => { const s = await statusNow(); if (!s.unlocked && s.paused) await P.collector.request('/resume', {}); return s.unlocked && s.mode === 'protected' && !s.busy; }, 90000, 'the protected session is idle'); await act('/amex/attended', { accountId: AMEX, cancel: true }); }
// a preparation whose card-list request is held at the fake OMF (arrived: its answer, the card's latest job, is taken)
async function heldPreparation(accountId) {
  for (let i = 0; i < 80; i++) {
    const gate = P.omf.hold('accounts'), pending = P.collector.request('/amex/attended', { accountId });
    if (await Promise.race([gate.arrived.then(() => true), pending.then(() => false)])) return { gate, pending };
    P.omf.unhold(gate); const r = await pending;
    if (!(r.status === 409 && BUSY.test(r.data?.error || ''))) throw new Error('the preparation was answered before OMF was asked: ' + r.status + ' ' + r.text);
    await new Promise(r2 => setTimeout(r2, 150));
  }
  throw new Error('the collector stayed busy');
}
// the helper modes started for one job of the card ([]: private, ended before any helper; ['input']: attended, on the person's desktop)
const helperModes = async () => (await readFile(P.standIn, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(r => r.event === 'spawn').map(r => r.mode);
const ended = jobId => P.omf.state.statuses.filter(s => s.jobId === jobId && s.state === 'failed').length;
const jobMark = async jobId => ({ jobId, spawned: (await helperModes()).length, ended: ended(jobId) });
async function jobEnded(mark) { await until(() => ended(mark.jobId) > mark.ended, 60000, 'job ' + mark.jobId + ' ended'); return (await helperModes()).slice(mark.spawned); }
async function runJob(jobId) { const mark = await jobMark(jobId); P.omf.queue(jobId); return jobEnded(mark); }

test('protected route: in the real protected session Prepare arms the card bound to the job OMF lists for it — that job handed again stays private and keeps the arming; the next job of the card is the attended one (its helper on the person\'s desktop) and consumes it; jobs without an arming stay private', { skip: WINDOWS, timeout: 300000 }, async () => {
  await ready();
  assert.deepEqual(await runJob('job-routine'), [], 'attended-protected:routine-private');
  const before = Date.now(), prepared = await act('/amex/attended', { accountId: AMEX });
  assert.equal(prepared.status, 200, 'attended-protected:prepared ' + prepared.text);
  assert.equal(prepared.data.amexAttended?.accountId, AMEX, 'attended-protected:prepared-card ' + prepared.text);
  const expiry = Date.parse(prepared.data.amexAttended.until);
  assert.ok(expiry >= before + index.ATTENDED_MS && expiry <= Date.now() + index.ATTENDED_MS, 'attended-protected:ten-minutes ' + prepared.text);
  assert.deepEqual(await attendedNow(), prepared.data.amexAttended, 'attended-protected:status-shows-prepared');
  assert.deepEqual(await runJob('job-routine'), [], 'attended-protected:held-job-private'); // the job OMF listed at the preparation, handed again
  assert.equal((await attendedNow())?.accountId, AMEX, 'attended-protected:held-job-keeps-arming');
  assert.deepEqual(await runJob('job-requested'), ['input'], 'attended-protected:next-job-attended');
  assert.equal(await attendedNow(), null, 'attended-protected:consumed');
  assert.deepEqual(await runJob('job-later'), [], 'attended-protected:after-consumption-private');
});

test('protected route: a Cancel acknowledged while the preparation waits for OMF\'s card list stays effective — the preparation answers that it was cancelled, nothing is armed and the next job of the card is private; a Cancel of another card leaves the preparation, which is kept', { skip: WINDOWS, timeout: 300000 }, async () => {
  await ready();
  let held = await heldPreparation(AMEX);
  try {
    const cancel = await P.collector.request('/amex/attended', { accountId: AMEX, cancel: true });
    assert.deepEqual([cancel.status, cancel.data?.amexAttended], [200, null], 'attended-protected:cancel-acknowledged-during-preparation ' + cancel.text);
    held.gate.release(); const answer = await held.pending;
    assert.equal(await attendedNow(), null, 'attended-protected:cancel-stays-effective (the preparation answered ' + answer.status + ')');
    assert.equal(answer.status, 409, 'attended-protected:cancelled-preparation-refused ' + answer.text);
    assert.match(answer.data?.error || '', /cancelled/, 'attended-protected:cancelled-preparation-says-so ' + answer.text);
    assert.deepEqual(await runJob('job-after-cancel'), [], 'attended-protected:after-cancel-private');
    held = await heldPreparation(AMEX);
    const other = await P.collector.request('/amex/attended', { accountId: OTHER_AMEX, cancel: true });
    assert.deepEqual([other.status, other.data?.amexAttended], [200, null], 'attended-protected:other-card-cancel ' + other.text);
    held.gate.release(); const kept = await held.pending;
    assert.equal(kept.status, 200, 'attended-protected:other-card-cancel-leaves-preparation ' + kept.text);
    assert.equal((await attendedNow())?.accountId, AMEX, 'attended-protected:kept-preparation-armed');
  } finally { held.gate.release(); await held.pending.catch(() => {}); await act('/amex/attended', { accountId: AMEX, cancel: true }).catch(() => {}); }
});

test('protected route: a failed card-list lookup at OMF, or a card OMF no longer lists for this PC, arms nothing, and the action slot is free again at once', { skip: WINDOWS, timeout: 300000 }, async () => {
  await ready();
  P.omf.state.failAccounts = 1;
  const failed = await act('/amex/attended', { accountId: AMEX });
  assert.equal(failed.status, 400, 'attended-protected:lookup-failure-refused ' + failed.text);
  assert.equal(await attendedNow(), null, 'attended-protected:lookup-failure-arms-nothing');
  P.omf.state.listed = false;
  try { const unlisted = await act('/amex/attended', { accountId: AMEX }); assert.equal(unlisted.status, 403, 'attended-protected:unlisted-card-refused ' + unlisted.text); }
  finally { P.omf.state.listed = true; }
  assert.equal(await attendedNow(), null, 'attended-protected:unlisted-arms-nothing');
  const again = await act('/amex/attended', { accountId: AMEX });
  assert.equal(again.status, 200, 'attended-protected:slot-free-after-failure ' + again.text);
  await act('/amex/attended', { accountId: AMEX, cancel: true });
  assert.deepEqual(await runJob('job-after-failure'), [], 'attended-protected:after-failure-private');
});

test('protected route: Lock while a card is prepared, or while a preparation waits for OMF, leaves nothing armed — that preparation is refused, Resume starts a new session with nothing armed, its next job of the card is private and the action slot is free', { skip: WINDOWS, timeout: 300000 }, async () => {
  await ready();
  const prepared = await act('/amex/attended', { accountId: AMEX });
  assert.equal(prepared.status, 200, 'attended-protected:prepared-before-lock ' + prepared.text);
  assert.equal((await P.collector.request('/lock', {})).status, 200, 'attended-protected:locked');
  let s = await statusNow();
  assert.deepEqual([s.unlocked, s.amexAttended], [false, null], 'attended-protected:lock-withdraws');
  await resume();
  assert.equal(await attendedNow(), null, 'attended-protected:resumed-nothing-armed');
  const held = await heldPreparation(AMEX); let answer;
  try { assert.equal((await P.collector.request('/lock', {})).status, 200, 'attended-protected:locked-during-preparation'); answer = await held.pending; }
  finally { held.gate.release(); await held.pending.catch(() => {}); }
  assert.notEqual(answer.status, 200, 'attended-protected:preparation-ends-with-the-session ' + answer.text);
  s = await statusNow();
  assert.deepEqual([s.unlocked, s.amexAttended], [false, null], 'attended-protected:lock-during-preparation-arms-nothing');
  await resume();
  assert.equal(await attendedNow(), null, 'attended-protected:resumed-after-preparation-nothing-armed');
  assert.deepEqual(await runJob('job-after-lock'), [], 'attended-protected:after-lock-private');
  const again = await act('/amex/attended', { accountId: AMEX });
  assert.equal(again.status, 200, 'attended-protected:slot-free-after-session-end ' + again.text);
  await act('/amex/attended', { accountId: AMEX, cancel: true });
});

test('protected route: claim overlap — while a preparation waits for OMF no claim starts (the collector action slot), so the job the person requests meanwhile is claimed after it and is the attended one', { skip: WINDOWS, timeout: 300000 }, async () => {
  await ready();
  const held = await heldPreparation(AMEX), claims = P.omf.state.claims, mark = await jobMark('job-during-preparation'); let answer;
  try {
    P.omf.queue('job-during-preparation'); // the person's 確定明細を取得 while the preparation waits
    await new Promise(r => setTimeout(r, 3500)); // three collector ticks
    assert.deepEqual({ claimed: P.omf.state.claims - claims, queued: P.omf.state.queue.length }, { claimed: 0, queued: 1 }, 'attended-race:no-claim-during-preparation');
  } finally { held.gate.release(); answer = await held.pending.catch(error => ({ status: 0, text: String(error) })); }
  assert.equal(answer.status, 200, 'attended-race:preparation-kept ' + answer.text);
  assert.deepEqual(await jobEnded(mark), ['input'], 'attended-race:requested-during-preparation-attended');
  assert.equal(await attendedNow(), null, 'attended-race:consumed');
});

test('protected route: claim overlap — a preparation asked while a claim is in flight is refused (409, wait) and arms nothing', { skip: WINDOWS, timeout: 300000 }, async () => {
  await ready();
  const gate = P.omf.hold('claim'); let refused;
  try { await gate.arrived; refused = await P.collector.request('/amex/attended', { accountId: AMEX }); }
  finally { gate.release(); }
  try {
    assert.equal(refused.status, 409, 'attended-race:prepare-refused-while-claiming ' + refused.text);
    assert.match(refused.data?.error || '', BUSY, 'attended-race:prepare-refused-says-wait ' + refused.text);
    assert.equal(await attendedNow(), null, 'attended-race:refused-arms-nothing');
  } finally { await act('/amex/attended', { accountId: AMEX, cancel: true }).catch(() => {}); }
});

test('protected route: setup overlap — a second preparation while one waits for OMF is refused (409, wait), so two never finish in reverse order; the first is kept', { skip: WINDOWS, timeout: 300000 }, async () => {
  await ready();
  const held = await heldPreparation(AMEX); let second, first;
  try { second = await P.collector.request('/amex/attended', { accountId: AMEX }); }
  finally { held.gate.release(); first = await held.pending.catch(error => ({ status: 0, text: String(error) })); }
  try {
    assert.equal(second.status, 409, 'attended-race:second-preparation-refused ' + second.text);
    assert.match(second.data?.error || '', BUSY, 'attended-race:second-preparation-says-wait ' + second.text);
    assert.equal(first.status, 200, 'attended-race:first-preparation-kept ' + first.text);
    assert.equal((await attendedNow())?.accountId, AMEX, 'attended-race:first-preparation-armed');
  } finally { await act('/amex/attended', { accountId: AMEX, cancel: true }).catch(() => {}); }
});

test('protected route: setup overlap — another setup action of the action slot (/bank/retry) is refused (409, wait) while a preparation waits for OMF', { skip: WINDOWS, timeout: 300000 }, async () => {
  await ready();
  const held = await heldPreparation(AMEX); let other;
  try { other = await P.collector.request('/bank/retry', {}); }
  finally { held.gate.release(); await held.pending.catch(() => {}); }
  try {
    assert.equal(other.status, 409, 'attended-race:setup-action-refused-during-preparation ' + other.text);
    assert.match(other.data?.error || '', BUSY, 'attended-race:setup-action-says-wait ' + other.text);
  } finally { await act('/amex/attended', { accountId: AMEX, cancel: true }).catch(() => {}); }
});
