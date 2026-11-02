// collector/test/amex-recent.test.mjs — the claimed recent job in the REAL collector (case omf-amex-recent-activity-20261102): what no adapter test can see. Legs:
//  - the REAL index.mjs claimWork, uploadQuery and amexRetained: the claim declares the capability, a retained pending manifest keeps its own kind and dates, and which retained
//    files a job sends;
//  - the REAL collector process (index.mjs startCollector) in a manual batch with the fake key broker and a loopback TLS fake OMF: the claimed job's source reaches the native module,
//    each job uploads its own kind, the retained-outbox rules across recent and closed jobs, and the completion text. The helper is a scripted stand-in put at amex-native.mjs
//    nativeHost.spawn by that process's own launcher: no Chrome, window or PowerShell helper exists, so the batch's attended mode shows nothing.
// Fictional accounts, tokens and rows; owned temporary directories with a fresh LOCALAPPDATA; no issuer, mailbox, vault key or real OMF.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-amex-recent-'));
process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector-dir'); process.env.LOCALAPPDATA = path.join(temp, 'local');
const INDEX = process.env.OMF_TEST_INDEX_MODULE ? path.resolve(process.env.OMF_TEST_INDEX_MODULE) : path.join(here, '..', 'index.mjs');
const index = await import(pathToFileURL(INDEX).href);
const execute = promisify(execFile);
const WINDOWS = process.platform === 'win32' ? false : 'Windows only';
const OPENSSL = 'C:/Program Files/Git/usr/bin/openssl.exe';
const AMEX = 'a1'.repeat(12), OWNER = 'c1'.repeat(12);
const CAPABILITY = 'amex-recent-v1';
test.after(async () => { await rm(temp, { recursive: true, force: true }).catch(() => {}); });

test('claimWork declares the recent capability on the card claim and keeps the bank claim as it was', { skip: WINDOWS }, async () => {
  const bodies = {}, server = http.createServer((req, res) => { let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => { const bank = req.url.endsWith('/bank/claim'); (bodies[bank ? 'bank' : 'card'] ??= []).push(JSON.parse(body)); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(bank ? { job: null } : { account: null })); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await index.claimWork({ baseUrl: 'http://127.0.0.1:' + server.address().port, token: 'omfc_' + 'e'.repeat(64) }, null); } finally { server.close(); }
  assert.deepEqual(bodies.card, [{ capabilities: [CAPABILITY] }], 'amex-recent:claim-declares-the-capability ' + JSON.stringify(bodies));
  assert.deepEqual(bodies.bank, [{ capabilities: ['balance-v1'] }], 'amex-recent:bank-claim-unchanged ' + JSON.stringify(bodies));
});

test('uploadQuery: a retained recent manifest goes up as pending with its own dates and count, no statement field; a closed manifest is exactly what it was', () => {
  const account = { _id: AMEX, jobId: 'job-now' };
  assert.deepEqual(index.uploadQuery({ kind: 'pending', start: '2026-10-05', end: '2026-11-02', pageCount: 4, key: 'pending:2026-10-05:2026-11-02', sha256: 'x', filename: 'y' }, account), { accountId: AMEX, jobId: 'job-now', kind: 'pending', start: '2026-10-05', end: '2026-11-02', pageCount: '4' }, 'amex-recent:pending-query');
  assert.deepEqual(index.uploadQuery({ kind: 'statement', start: '2026-09-05', end: '2026-10-04', pageCount: 12 }, account), { accountId: AMEX, jobId: 'job-now', kind: 'statement', start: '2026-09-05', end: '2026-10-04', pageCount: '12' }, 'amex-recent:statement-query-unchanged');
});

test('amexRetained: a closed job sends everything and collects unless it sent a statement; a recent job sends only provisional files and leaves a closed statement for a closed job', () => {
  const statement = { manifest: { kind: 'statement' } }, pending = { manifest: { kind: 'pending' } }, kinds = r => [r.send.map(i => i.manifest.kind), r.collect];
  assert.deepEqual(kinds(index.amexRetained('statement', [])), [[], true], 'amex-recent:closed-nothing-retained');
  assert.deepEqual(kinds(index.amexRetained('statement', [statement])), [['statement'], false], 'amex-recent:closed-statement-retained-as-ever');
  assert.deepEqual(kinds(index.amexRetained('statement', [pending])), [['pending'], true], 'amex-recent:closed-job-still-collects-after-a-provisional-file');
  assert.deepEqual(kinds(index.amexRetained('statement', [pending, statement])), [['pending', 'statement'], false], 'amex-recent:closed-sends-both');
  assert.deepEqual(kinds(index.amexRetained('recent', [])), [[], true], 'amex-recent:recent-nothing-retained');
  assert.deepEqual(kinds(index.amexRetained('recent', [pending])), [['pending'], false], 'amex-recent:recent-retry-does-not-download-again');
  assert.deepEqual(kinds(index.amexRetained('recent', [statement])), [[], true], 'amex-recent:recent-leaves-a-statement');
  assert.deepEqual(kinds(index.amexRetained('recent', [pending, statement])), [['pending'], false], 'amex-recent:recent-sends-only-provisional');
});

// ── the fake OMF over loopback TLS: claims from a queue (each body kept), statuses, uploads (query, content type and bytes kept); no bank work ───────────────────────────────────────
async function fakeOmf(dir) {
  const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  await execute(OPENSSL, ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { windowsHide: true, timeout: 30000 });
  const state = { queue: [], claims: [], statuses: [], uploads: [] };
  const account = { _id: AMEX, ownerId: OWNER, provider: 'amex', name: 'Card A', primaryCard: '12345', cardIdentifiers: ['12345'], otpRecipient: 'codes@example.invalid', otpMailbox: 'codes@example.invalid' };
  const server = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, async (req, res) => {
    const json = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks), url = new URL(req.url, 'https://127.0.0.1'), route = url.pathname.replace('/api/finance/collector/', '');
    if (!/^Bearer omfc_[a-f\d]{64}$/.test(req.headers.authorization || '')) return json(401, { statusMessage: 'Unauthorized' });
    if (route === 'accounts' && req.method === 'GET') return json(200, { accounts: [{ ...account, jobState: 'idle' }] });
    if (route === 'claim' && req.method === 'POST') { state.claims.push(JSON.parse(body.toString('utf8'))); return json(200, { account: state.queue.shift() || null }); }
    if (route === 'status' && req.method === 'POST') { state.statuses.push(JSON.parse(body.toString('utf8'))); return json(200, { success: true }); }
    if (route === 'upload' && req.method === 'POST') { state.uploads.push({ query: Object.fromEntries(url.searchParams), type: req.headers['content-type'], sha256: createHash('sha256').update(body).digest('hex') }); return json(200, { id: 'd4'.repeat(11) + String(10 + state.uploads.length) }); }
    if (req.url.startsWith('/api/finance-payments/collector/bank/claim')) return json(404, { statusMessage: 'none' });
    return json(404, { statusMessage: 'Collector endpoint not found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: 'https://127.0.0.1:' + server.address().port, cert, state, queue: (jobId, jobSource) => state.queue.push({ ...account, jobId, ...(jobSource ? { jobSource } : {}) }), close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }) };
}
// The collector process with a scripted helper put at nativeHost.spawn: it answers every operation of a signed-in closed or recent job, writes the file of the job's one download
// into the job's own folder, and records each spawn and operation (never a value).
const STAND_IN = `
import { EventEmitter } from 'node:events'; import { PassThrough, Writable } from 'node:stream'; import { appendFileSync, writeFileSync } from 'node:fs'; import path from 'node:path';
const native = await import(process.env.OMF_TEST_NATIVE_URL), { HEADERS } = await import(process.env.OMF_TEST_AMEX_URL);
const day = n => new Date(Date.now() + 9 * 3600000 + n * 864e5).toISOString().slice(0, 10), slash = d => d.replaceAll('-', '/');
const STATEMENT = 'https://global.americanexpress.com/activity/statement', RECENT = 'https://global.americanexpress.com/activity/recent';
const closed = { start: day(-35), end: day(-5) }, cycle = { start: day(-4), closing: day(26) };
const csv = rows => Buffer.from([HEADERS, ...rows.map(([a, b, name, amount]) => [slash(a), slash(b), name, 'FIXTURE TARO', '-12345', amount, '', ''])].map(r => r.join(',')).join('\\r\\n') + '\\r\\n');
native.nativeHost.spawn = args => {
  const child = new EventEmitter(), out = new PassThrough(), folder = args[args.indexOf('-Downloads') + 1], mode = args[args.indexOf('-Mode') + 1]; let buffer = '', ended = false, selected = false, onStatement = false;
  appendFileSync(process.env.OMF_TEST_STAND_IN, JSON.stringify({ event: 'spawn', mode }) + '\\n');
  const finish = () => { if (ended) return; ended = true; out.end(JSON.stringify({ event: 'end', reason: 'closed', chromeEnded: true, desktopClosed: true }) + '\\n'); setImmediate(() => child.emit('close', 0)); };
  const answer = op => {
    if (op === 'launch') return { ok: true, pid: 61001, mode };
    if (op === 'wait-ready') return { ok: true, surface: 'global' };
    if (op === 'state') return { ok: true, kind: 'authenticated' };
    if (op === 'open-statement') { onStatement = true; return { ok: true, invoked: 1 }; }
    if (op === 'snapshot') return { ok: true, url: selected ? STATEMENT + '?end=' + closed.end : STATEMENT, links: [{ text: slash(closed.start) + ' - ' + slash(closed.end), href: STATEMENT + '?end=' + closed.end }], periods: selected ? ['（' + slash(closed.start) + '－' + slash(closed.end) + '）'] : [], cards: ['-12345'], counts: selected ? [[2, 2]] : [] };
    if (op === 'invoke-period') { selected = true; return { ok: true, invoked: 1 }; }
    if (op === 'open-recent') return onStatement ? { ok: true, invoked: 1 } : { ok: false, code: 'document_path', acted: false };
    if (op === 'recent-snapshot') return { ok: true, url: RECENT, links: [], periods: [], ranges: [slash(cycle.start) + 'ー今日現在（次回締め日' + slash(cycle.closing) + ')'], cards: ['-12345'], counts: [[2, 2]] };
    if (op === 'download-open' || op === 'recent-download-open') return { ok: true, invoked: 1 };
    if (op === 'csv-state' || op === 'recent-csv-state') return { ok: true, present: true, selected: true };
    if (op === 'csv-select' || op === 'recent-csv-select') return { ok: true, chosen: 1 };
    if (op === 'download') { writeFileSync(path.join(folder, 'closed.csv'), csv([[day(-20), day(-19), 'FIXTURE CLOSED 1', '1100'], [day(-18), day(-17), 'FIXTURE CLOSED 2', '2200']])); return { ok: true, invoked: 1 }; }
    if (op === 'recent-download') { writeFileSync(path.join(folder, 'recent.csv'), csv([[day(-3), day(-2), 'FIXTURE RECENT 1', '1300'], [day(-2), day(-1), 'FIXTURE RECENT 2', '2600']])); return { ok: true, invoked: 1 }; }
    if (op === 'close') return { ok: true, gracefulExit: true };
    return { ok: false, code: 'unknown_op', acted: false };
  };
  Object.assign(child, { pid: 54001, stdout: out, stderr: new PassThrough(), kill() { finish(); return true; } });
  child.stdin = new Writable({ write(chunk, _e, callback) { buffer += chunk; let i; while ((i = buffer.indexOf('\\n')) >= 0) { const r = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1); appendFileSync(process.env.OMF_TEST_STAND_IN, JSON.stringify({ event: 'op', op: r.op }) + '\\n'); if (!ended) out.write(JSON.stringify({ id: r.id, ...answer(r.op) }) + '\\n'); if (r.op === 'close') finish(); } callback(); }, final(callback) { finish(); callback(); } });
  setImmediate(() => out.write(JSON.stringify({ event: 'ready', pid: child.pid, mode }) + '\\n'));
  return child;
};
const collector = await import(process.env.OMF_TEST_INDEX_URL);
collector.startCollector().catch(() => { process.exitCode = 1; });
`;
async function startCollector(dir, env) {
  const port = await new Promise(resolve => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const child = spawn(process.execPath, ['--input-type=module', '-e', STAND_IN], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env, OMF_COLLECTOR_PORT: String(port), OMF_TEST_NATIVE_URL: pathToFileURL(process.env.OMF_TEST_NATIVE_MODULE ? path.resolve(process.env.OMF_TEST_NATIVE_MODULE) : path.join(here, '..', 'amex-native.mjs')).href, OMF_TEST_AMEX_URL: pathToFileURL(path.join(here, '..', '..', 'shared', 'amex.mjs')).href, OMF_TEST_INDEX_URL: pathToFileURL(INDEX).href } });
  const output = []; child.stdout.on('data', d => output.push(String(d))); child.stderr.on('data', d => output.push(String(d)));
  let link = null;
  for (let i = 0; i < 300 && !link; i++) { if (child.exitCode !== null) break; try { const text = (await readFile(path.join(dir, 'setup-link.txt'), 'utf8')).trim(); if (text.startsWith('http://127.0.0.1:' + port + '/#')) link = text; } catch { /* not yet */ } await new Promise(r => setTimeout(r, 100)); }
  if (!link) { child.kill(); throw new Error('the collector did not start: ' + output.join('').slice(0, 600)); }
  const origin = new URL(link).origin, key = new URL(link).hash.slice(1);
  const request = async (route, body) => { const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Setup-Key': key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); const text = await response.text(); let data = null; try { data = JSON.parse(text); } catch { /* text */ } return { status: response.status, data }; };
  const stop = async () => { if (child.exitCode === null) { const exited = new Promise(r => child.once('exit', r)); child.kill(); await exited; } };
  return { request, stop, output };
}
const until = async (read, ms, label) => { const deadline = Date.now() + ms; for (;;) { const value = await read(); if (value) return value; if (Date.now() > deadline) throw new Error('timed out: ' + label); await new Promise(r => setTimeout(r, 200)); } };
// A file already in the outbox, bound to this owner and origin, as a job that lost its acknowledgement leaves it.
async function retained(dir, origin, jobId, kind, label) {
  const folder = path.join(dir, 'outbox', AMEX, jobId), filename = randomUUID(), bytes = Buffer.from('fictional ' + label + '\n'); await mkdir(folder, { recursive: true }); await writeFile(path.join(folder, filename), bytes);
  await writeFile(path.join(folder, 'manifest.json'), JSON.stringify({ accountId: AMEX, primaryCard: '12345', jobId, kind, start: '2026-10-05', end: '2026-11-01', pageCount: 2, sha256: createHash('sha256').update(bytes).digest('hex'), filename, downloadedAt: new Date().toISOString(), ownerId: OWNER, origin }, null, 2));
  return createHash('sha256').update(bytes).digest('hex');
}
const ops = async file => (await readFile(file, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));

test('the real collector process: each claimed job takes its own path and uploads its own kind; a retained provisional file and a retained statement each go up under the right job, and neither a closed nor a recent job is lost to the other', { skip: WINDOWS, timeout: 300000 }, async () => {
  const { FAKE_BROKER } = await import('./fake-broker.mjs');
  const dir = path.join(temp, 'collector-run'), brokerDir = path.join(temp, 'broker'), local = path.join(temp, 'local-run'), standIn = path.join(temp, 'stand-in.jsonl');
  await mkdir(dir, { recursive: true }); await mkdir(brokerDir, { recursive: true }); await mkdir(local, { recursive: true });
  const omf = await fakeOmf(temp);
  const collector = await startCollector(dir, { OMF_COLLECTOR_DIR: dir, LOCALAPPDATA: local, USERPROFILE: local, OMF_KEY_BROKER: FAKE_BROKER, OMF_FAKE_BROKER_DIR: brokerDir, OMF_COLLECTOR_TICK_MS: '1000', NODE_EXTRA_CA_CERTS: omf.cert, OMF_TEST_STAND_IN: standIn, OMF_COLLECTOR_ORIGIN: omf.origin });
  const complete = jobId => until(() => omf.state.statuses.find(s => s.jobId === jobId && ['complete', 'failed'].includes(s.state)), 90000, 'the job ' + jobId + ' ended');
  try {
    await until(async () => (await collector.request('/status')).data?.startupDone === true, 60000, 'startup');
    assert.equal((await collector.request('/pair', { token: 'omfc_' + randomBytes(32).toString('hex'), baseUrl: omf.origin + '/' })).status, 200, 'pair');
    assert.equal((await collector.request('/mode', { mode: 'manual' })).status, 200, 'manual mode');
    // one batch: a retained provisional file, a retained closed statement, then two recent and two closed jobs
    const provisional = await retained(dir, omf.origin, 'job-old-recent', 'pending', 'retained provisional'), statement = await retained(dir, omf.origin, 'job-old-closed', 'statement', 'retained statement');
    omf.queue('job-recent-1', 'recent'); omf.queue('job-recent-2', 'recent'); omf.queue('job-closed-1'); omf.queue('job-closed-2');
    assert.equal((await collector.request('/batch/start', {})).status, 200, 'manual batch');
    const results = { 'job-recent-1': await complete('job-recent-1'), 'job-recent-2': await complete('job-recent-2'), 'job-closed-1': await complete('job-closed-1'), 'job-closed-2': await complete('job-closed-2') };
    for (const [jobId, ending] of Object.entries(results)) assert.equal(ending.state, 'complete', 'amex-recent:job-completes ' + jobId + ' ' + collector.output.join('').slice(-400));
    const sent = omf.state.uploads.map(u => [u.query.jobId, u.query.kind]);
    assert.deepEqual(sent, [['job-recent-1', 'pending'], ['job-recent-2', 'pending'], ['job-closed-1', 'statement'], ['job-closed-2', 'statement']], 'amex-recent:each-job-uploads-its-own-kind ' + JSON.stringify(sent));
    assert.equal(omf.state.uploads[0].sha256, provisional, 'amex-recent:recent-sends-the-retained-provisional-file');
    assert.equal(omf.state.uploads[2].sha256, statement, 'amex-recent:closed-sends-the-retained-statement');
    assert.ok(omf.state.uploads.every(u => u.type.startsWith('text/csv')), 'amex-recent:csv-content-type');
    assert.deepEqual([omf.state.uploads[1].query.pageCount, omf.state.uploads[3].query.pageCount], ['2', '2'], 'amex-recent:counts-sent');
    assert.ok(omf.state.claims.length >= 4 && omf.state.claims.every(body => JSON.stringify(body) === JSON.stringify({ capabilities: [CAPABILITY] })), 'amex-recent:every-claim-declares ' + JSON.stringify(omf.state.claims));
    // a helper ran only for the jobs with nothing of their kind retained: the second recent job and the second closed job, each on its own path
    const records = await ops(standIn), spawns = records.filter(r => r.event === 'spawn'), names = records.filter(r => r.event === 'op').map(r => r.op);
    assert.equal(spawns.length, 2, 'amex-recent:one-helper-per-collected-job ' + JSON.stringify(spawns));
    assert.deepEqual([names.filter(op => op === 'open-recent').length, names.filter(op => op === 'recent-download').length, names.filter(op => op === 'invoke-period').length, names.filter(op => op === 'download').length], [1, 1, 1, 1], 'amex-recent:each-path-once ' + names.join(','));
    assert.ok(names.indexOf('recent-download') < names.indexOf('invoke-period'), 'amex-recent:recent-path-belongs-to-the-recent-job ' + names.join(','));
    assert.equal(results['job-closed-2'].message, 'Statement saved in OMF for review', 'amex-recent:closed-completion-text-unchanged');
    assert.equal(results['job-recent-2'].message, '未請求（仮）の明細をOMFに保存しました', 'amex-recent:recent-completion-says-provisional');
    assert.ok(!omf.state.statuses.filter(s => s.jobId.startsWith('job-recent')).some(s => /closed|確定/i.test(s.message)), 'amex-recent:recent-statuses-never-say-closed ' + JSON.stringify(omf.state.statuses.filter(s => s.jobId.startsWith('job-recent')).map(s => s.message)));
    // the next batch: a provisional file left behind never costs a closed job its download
    await until(async () => !(await collector.request('/status')).data?.unlocked, 60000, 'the batch ended');
    const later = await retained(dir, omf.origin, 'job-old-recent-2', 'pending', 'second retained provisional');
    omf.queue('job-closed-3');
    assert.equal((await collector.request('/batch/start', {})).status, 200, 'second manual batch');
    assert.equal((await complete('job-closed-3')).state, 'complete', 'amex-recent:closed-after-provisional-completes');
    const third = omf.state.uploads.filter(u => u.query.jobId === 'job-closed-3');
    assert.deepEqual(third.map(u => u.query.kind), ['pending', 'statement'], 'amex-recent:provisional-file-then-the-closed-download ' + JSON.stringify(third));
    assert.equal(third[0].sha256, later, 'amex-recent:the-provisional-file-keeps-its-bytes');
    assert.equal((await ops(standIn)).filter(r => r.event === 'spawn').length, 3, 'amex-recent:the-closed-job-collected');
  } finally { await collector.request('/lock', {}).catch(() => {}); await collector.stop(); await omf.close(); }
});
