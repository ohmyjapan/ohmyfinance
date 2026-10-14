// Fixture for plan omf-auto-sync-build-20261014 (5-plan.json §4): automatic Aplus sync, the bounded statement-code wait
// on a device-bound SMS source, and the collector's SMS-source setting. Run ONLY through the hub verifier (never directly;
// a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture aplus-auto-sync.mjs --cwd <this worktree>
// Every leg runs on synthetic data, an owned ephemeral MongoDB, temporary directories, a fake My APLUS page and a fake
// SMS source; no bank, tablet, mail, production address or real SMS is reached. Recorded inputs: the statement-code facts
// of output/omf-aplus-coverage-20261013/checkpoint.json#liveInspection.downloadStepUp (sender 0570008789, purpose
// ご利用明細書ダウンロード, four digits, five minutes) inside synthetic bodies; the fake page shape of aplus-collector.mjs:66.
// Legs: J (JST helpers) · S1 atomic enqueue · S2 route + real Chrome settings UI · S3 built server schedule · M1-M3 the SMS
// source and the bounded wait · F1 cancellation rechecks · P1 real owned headless Chrome passthrough · P2 collector HTTP
// ownership/session · F2 the setup page in real Chrome · A12 staging · A13 docs. P3 (aplus-collector.mjs and
// collector-connect.mjs stay green) is run by the verifier separately.
// Fail-first on fd12345: financeSyncScheduler.ts and sms-source.mjs missing, queueSync/queueScheduledSync/autoSyncInput not
// exported, PUT auto-sync 404, awaitDownload ignores codeSource/signal, /sms-source 404, ALLOWLIST lacks sms-source.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, unlink, access, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const timeoutMs = 1500000;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const HUB_EVIDENCE = 'C:/Users/Junsan2/Documents/ohmycode/output/omf-aplus-coverage-20261013';
const execFileAsync = promisify(execFile);
const exists = p => access(p).then(() => true, () => false);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForReal(read, ms = 20000, every = 50) { const deadline = Date.now() + ms; do { if (await read()) return true; await sleep(every); } while (Date.now() < deadline); return false; }

// Recorded statement-code facts (checkpoint.json#liveInspection.downloadStepUp) in synthetic bodies.
const STATEMENT_SENDER = '0570008789';
const smsBody = code => '【My APLUS】ご利用明細書ダウンロードの認証コードは ' + code + ' です。有効期限は5分です。';
const smsMessage = (id, receivedAt, code = '4821', sender = STATEMENT_SENDER) => ({ id, sender, receivedAt, body: smsBody(code) });

// Synthetic statement shapes (scripts/finance-aplus.test.mjs:8-11), the fake page of aplus-collector.mjs:66 plus a
// "person types later" arm (the person path of plan §2 A8 after the code's validity ends).
const csvOf = (rows, headers) => Buffer.from('\uFEFF' + [headers, ...rows].map(row => row.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n'));
const purchase = (changes = {}) => Object.assign(['≪****-****-****-1234≫', '20260801', 'Synthetic shop', '1200', 'Ｓ', '1', '01', '1200', ''], changes);
const ACCOUNT = { _id: 'a1a1a1a1a1a1a1a1a1a1a1a1', ownerId: 'b2b2b2b2b2b2b2b2b2b2b2b2', provider: 'aplus', name: 'Synthetic Aplus', primaryCard: '1234', cardIdentifiers: ['1234', '5678'], jobId: randomUUID() };
const CREDENTIALS = { username: 'synthetic', password: 'synthetic' };
const ORIGIN = 'https://omf.example';
let HEADERS_CACHE = null;
function pendingPages(items, perPage) {
  const total = items.reduce((n, r) => n + r.amount, 0);
  const chunks = []; for (let i = 0; i < items.length; i += perPage) chunks.push(items.slice(i, i + perPage));
  const pageNumbers = chunks.map((_, i) => String(i + 1));
  return chunks.map((rows, i) => ({ activePage: String(i + 1), pageNumbers: [...pageNumbers], summary: '未請求のご利用金額\n\n未確定\n' + total.toLocaleString('en-US') + '円',
    rows: rows.map((r, j) => ({ position: j + 1, merchant: r.merchant, dateAndPayment: r.date.slice(2).replaceAll('-', '.') + '   1回払い', amount: r.amount.toLocaleString('en-US') + '円', details: [{ label: 'カード番号下4桁', value: '1234' }, { label: '売上種別', value: 'ショッピング' }, { label: '初回年月', value: '26/09' }] })) }));
}
const pendingItems = n => Array.from({ length: n }, (_, i) => ({ merchant: 'Synthetic shop ' + (i + 1), amount: 1200, date: '2026-08-0' + ((i % 9) + 1) }));
function fakeUi({ options = ['2026/09'], totals = { '2026/09': 2400 }, verification = false, personAfterMs = null, pages = pendingPages(pendingItems(2), 2) } = {}) {
  const clock = { t: 1_800_000_000_000 };
  const counts = { open: 0, login: 0, openDetails: 0, openUnbilled: 0, save: 0, csv: 0, code: 0, show: 0, readPage: 0, goToPage: 0, selectMonth: 0, person: 0, lastCode: null };
  let kind = 'login', month = options[0], activeIndex = 0, pendingDelivery = null, handlers = {}, jobDir = null, requestedAtVirtual = null;
  const bytesFor = m => csvOf([purchase({ 1: m.replace('/', '') + '01', 3: String(totals[m]), 7: String(totals[m]) })], HEADERS_CACHE);
  const deliver = async () => {
    if (!pendingDelivery) return;
    const { guid, bytes } = pendingDelivery; pendingDelivery = null;
    await writeFile(path.join(jobDir, guid), bytes);
    handlers['Browser.downloadWillBegin']?.({ guid, suggestedFilename: 'aplus_meisai.csv' });
    handlers['Browser.downloadProgress']?.({ guid, state: 'completed', totalBytes: bytes.length, receivedBytes: bytes.length });
  };
  const ui = {
    counts, clock, now: () => clock.t,
    async wait(ms) {
      clock.t += ms;
      if (kind === 'verification' && personAfterMs !== null && requestedAtVirtual !== null && clock.t - requestedAtVirtual >= personAfterMs) { counts.person++; kind = 'details'; await deliver(); }
    },
    async open() { counts.open++; },
    async state() { return { kind }; },
    async login() { counts.login++; kind = 'authenticated'; },
    async openDetails() { counts.openDetails++; kind = 'details'; },
    async snapshot() { return { url: 'https://myaplus.aplus.co.jp/cards/billing/details', month, total: totals[month] === undefined ? '' : totals[month].toLocaleString('en-US') + '円', account: '…-1234', options: [...options] }; },
    async selectMonth(m) { counts.selectMonth++; month = m.replace('-', '/'); },
    downloadSession(dir) { jobDir = dir; handlers = {}; return { on(event, handler) { handlers[event] = handler; }, async close() { handlers = {}; } }; },
    async save() { counts.save++; },
    async csv() { counts.csv++; pendingDelivery = { guid: randomUUID(), bytes: bytesFor(month) }; requestedAtVirtual = clock.t; if (verification) { kind = 'verification'; return; } await deliver(); },
    async code(value) { counts.code++; counts.lastCode = value; kind = 'details'; await deliver(); },
    async show() { counts.show++; },
    async openUnbilled() { counts.openUnbilled++; kind = 'unbilled'; activeIndex = 0; },
    async pageNumbers() { return [...pages[0].pageNumbers]; },
    async goToPage(n) { counts.goToPage++; activeIndex = Number(n) - 1; },
    async readPage() { counts.readPage++; return JSON.parse(JSON.stringify(pages[activeIndex])); }
  };
  return ui;
}

function runChild(args, { cwd = REPO_ROOT, env = process.env, timeout = 600000 } = {}) {
  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, args, { cwd, windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, env }, (error, stdout, stderr) => {
      const text = String(stdout || ''), lines = text.split(/\r?\n/);
      let receipt = null;
      try { receipt = JSON.parse(lines.find(l => l.startsWith('{"pass":')) || 'null'); } catch { receipt = null; }
      resolve({ ms: Date.now() - started, code: error ? (error.code ?? 1) : 0, killed: !!error?.killed, passes: lines.filter(l => l.startsWith('PASS ')).map(l => l.slice(5)), reds: lines.filter(l => l.startsWith('FAIL ')).map(l => l.slice(5)), receipt, tail: (String(stderr || '').trim() || text).slice(-1800) });
    });
  });
}
async function harness(name, source, extraEnv = {}) {
  // Inside the tree (gitignored .cache) so bare imports resolve like the project's own scripts; removed afterwards.
  const cache = path.join(REPO_ROOT, '.cache'); await mkdir(cache, { recursive: true });
  const file = path.join(cache, 'aplus-auto-sync-' + name + '-' + process.pid + '.mts'); await writeFile(file, source, { flag: 'wx' });
  let result;
  try { result = await runChild(['--import', 'tsx', file, REPO_ROOT], { env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', ...extraEnv } }); } finally { await unlink(file).catch(() => {}); }
  const ok = result.code === 0 && result.receipt?.pass === true && result.receipt.checks === result.passes.length && !result.reds.length;
  if (!ok) throw new Error('RED (exit ' + (result.killed ? 'timeout' : result.code) + ', ' + result.passes.length + ' green): ' + (result.reds[0] || result.tail).replace(/\s+/g, ' ').slice(-900));
  return result.passes.length + ' legs green in ' + Math.round(result.ms / 1000) + 's — ' + result.passes.join(' · ');
}

// S1/S2 route harness: the real scheduler and service on an owned ephemeral MongoDB; the real route mounted on h3.
const S1_HARNESS = String.raw`
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = process.argv[2], u = (p: string) => pathToFileURL(path.join(ROOT, p)).href;
let checks = 0; const pass = (name: string) => { checks++; console.log('PASS ' + name); };
const at = (iso: string) => new Date(iso);
const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default, jwt = (await import('jsonwebtoken')).default;
const { createApp, toNodeListener } = await import('h3');
const mongo = await MongoMemoryServer.create({ instance: { dbName: 'aplus_auto_sync_isolated' } });
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-auto-sync-s1-'));
process.env.MONGO_URI = mongo.getUri('aplus_auto_sync_isolated'); process.env.JWT_SECRET = randomBytes(32).toString('hex'); process.env.NODE_ENV = 'test'; process.env.OMF_DATA_DIR = path.join(temp, 'data');
let server: any;
try {
  await mongoose.connect(process.env.MONGO_URI); assert.equal(mongoose.connection.name, 'aplus_auto_sync_isolated');
  const User = (await import(u('server/models/User.ts'))).default;
  const { FinancialAccount, FinanceCollector, initializeFinance } = await import(u('server/models/Finance.ts'));
  const route = (await import(u('server/api/finance/[...path].ts'))).default, auth = (await import(u('server/middleware/auth.ts'))).default;
  const service: any = await import(u('server/services/financeService.ts'));
  for (const name of ['queueSync', 'queueScheduledSync', 'autoSyncInput']) assert.equal(typeof service[name], 'function', 'financeService exports no ' + name);
  const scheduler: any = await import(u('server/services/financeSyncScheduler.ts'));
  for (const name of ['jstDay', 'jstHour', 'jstDayStartUtc', 'dueAccounts', 'runSyncSchedule']) assert.equal(typeof scheduler[name], 'function', 'financeSyncScheduler exports no ' + name);
  await initializeFinance();
  // J — JST helpers.
  assert.equal(scheduler.jstDay(at('2026-10-14T14:59:59Z')), '2026-10-14'); assert.equal(scheduler.jstHour(at('2026-10-14T14:59:59Z')), 23);
  assert.equal(scheduler.jstDay(at('2026-10-14T15:00:00Z')), '2026-10-15'); assert.equal(scheduler.jstHour(at('2026-10-14T15:00:00Z')), 0);
  assert.equal(scheduler.jstHour(at('2026-10-14T00:30:00Z')), 9);
  assert.equal(scheduler.jstDayStartUtc(at('2026-10-14T23:30:00Z')).toISOString(), '2026-10-14T15:00:00.000Z');
  assert.equal(scheduler.jstDayStartUtc(at('2026-10-14T14:59:59Z')).toISOString(), '2026-10-13T15:00:00.000Z');
  assert.equal(scheduler.jstDayStartUtc(at('2026-10-14T15:00:00Z')).toISOString(), '2026-10-14T15:00:00.000Z');
  pass('J JST day, hour and day-start helpers across the midnight boundary');
  // S1 — atomic enqueue.
  const user = await User.create({ email: 'auto-sync-fixture@example.invalid', name: 'Synthetic owner', password: 'Synthetic-only-Strong-Password1!' });
  const ownerId = String(user._id);
  const account: any = await FinancialAccount.create({ ownerId, name: 'Synthetic Aplus', provider: 'aplus', primaryCard: '1234', cardIdentifiers: ['1234'], autoSync: { enabled: true, hour: 9 } });
  const collector = await FinanceCollector.create({ ownerId, name: 'Synthetic PC', tokenHash: 'a'.repeat(64), accountIds: [account._id] });
  const read = async () => (await FinancialAccount.findById(account._id).lean()) as any;
  const reset = async (set: any = {}, unset: string[] = []) => { await FinancialAccount.updateOne({ _id: account._id }, { $set: { jobState: 'idle', 'autoSync.enabled': true, 'autoSync.hour': 9, ...set }, $unset: Object.fromEntries(['autoSync.lastQueuedDay', 'lastAttemptAt', 'jobLeaseUntil', 'jobDeviceId', 'jobId', ...unset].filter(k => !(k in set)).map(k => [k, ''])) }); };
  const stale = { day: '2026-10-14', hour: 10, dayStartUtc: at('2026-10-13T15:00:00Z'), now: at('2026-10-14T01:00:00Z') };
  await reset({ jobLeaseUntil: at('2026-10-13T00:00:00Z'), jobDeviceId: collector._id, jobState: 'complete' });
  const tenJst = at('2026-10-14T01:00:00Z');
  const first = await scheduler.runSyncSchedule(tenJst);
  assert.deepEqual(first, { queued: [String(account._id)] });
  let row = await read();
  assert.equal(row.jobState, 'queued'); assert.match(row.jobId, /^[0-9a-f-]{36}$/); assert.equal(row.jobRequestedAt.toISOString(), tenJst.toISOString());
  assert.equal(row.lastMessage, '自動取得を予約しました'); assert.equal(row.autoSync.lastQueuedDay, '2026-10-14'); assert.equal(row.jobLeaseUntil, undefined); assert.equal(row.jobDeviceId, undefined);
  const firstJob = row.jobId;
  assert.deepEqual(await scheduler.runSyncSchedule(at('2026-10-14T03:00:00Z')), { queued: [] }); assert.equal((await read()).jobId, firstJob);
  await FinancialAccount.updateOne({ _id: account._id }, { $set: { jobState: 'complete', lastAttemptAt: at('2026-10-14T01:30:00Z') } });
  assert.deepEqual(await scheduler.runSyncSchedule(at('2026-10-14T05:00:00Z')), { queued: [] });
  pass('S1 due account queued once with the exact fields; the same JST day never queues again, before or after the job ran');
  await reset(); row = await read();
  await FinancialAccount.updateOne({ _id: account._id }, { $set: { 'autoSync.enabled': false } });
  assert.equal(await service.queueScheduledSync(row, stale), null); assert.equal((await read()).jobState, 'idle');
  await reset(); row = await read();
  await FinancialAccount.updateOne({ _id: account._id }, { $set: { 'autoSync.hour': 15 } });
  assert.equal(await service.queueScheduledSync(row, stale), null); assert.equal((await read()).jobState, 'idle');
  await reset(); row = await read();
  await FinancialAccount.updateOne({ _id: account._id }, { $set: { jobState: 'complete', lastAttemptAt: at('2026-10-14T00:30:00Z') } });
  assert.equal(await service.queueScheduledSync(row, stale), null); assert.equal((await read()).jobState, 'complete');
  pass('S1 a disable, a later hour or a manual claim between the scan and the write makes the write a no-op');
  await reset({ jobState: 'complete', lastAttemptAt: at('2026-10-13T14:59:00Z') }); row = await read();
  const yesterday: any = await service.queueScheduledSync(row, stale);
  assert.equal(yesterday.jobState, 'queued'); assert.equal(yesterday.autoSync.lastQueuedDay, '2026-10-14'); assert.match(yesterday.jobId, /^[0-9a-f-]{36}$/);
  await reset({ jobState: 'running', jobLeaseUntil: at('2026-10-13T23:00:00Z'), jobDeviceId: collector._id, lastAttemptAt: at('2026-10-13T14:59:00Z') }); row = await read();
  assert.equal(await service.queueScheduledSync(row, stale), null); assert.equal((await read()).jobState, 'running');
  const manual: any = await service.queueSync(ownerId, row);
  assert.equal(manual.jobState, 'queued'); assert.equal(manual.lastMessage, 'Waiting for collector');
  pass('S1 a job last attempted yesterday 23:59 JST is due; a running job with an expired lease is not re-queued by the schedule (the manual button still is: control)');
  await reset();
  const [a, b] = await Promise.all([scheduler.runSyncSchedule(tenJst), scheduler.runSyncSchedule(tenJst)]);
  assert.equal(a.queued.length + b.queued.length, 1, JSON.stringify([a, b])); assert.equal((await read()).jobState, 'queued');
  await reset(); await FinanceCollector.updateOne({ _id: collector._id }, { $set: { revokedAt: new Date() } });
  assert.deepEqual(await scheduler.runSyncSchedule(tenJst), { queued: [] }); assert.equal((await read()).jobState, 'idle');
  await FinanceCollector.updateOne({ _id: collector._id }, { $set: { revokedAt: null } });
  pass('S1 two concurrent schedulers produce exactly one jobId; a revoked collector queues nothing');
  await reset({ 'autoSync.lastQueuedDay': '2026-10-14' });
  assert.deepEqual(await scheduler.runSyncSchedule(at('2026-10-14T14:59:59Z')), { queued: [] });
  assert.deepEqual(await scheduler.runSyncSchedule(at('2026-10-14T15:00:00Z')), { queued: [] });
  await FinancialAccount.updateOne({ _id: account._id }, { $set: { 'autoSync.hour': 0 } });
  assert.deepEqual(await scheduler.runSyncSchedule(at('2026-10-14T15:00:00Z')), { queued: [String(account._id)] });
  row = await read(); assert.equal(row.autoSync.lastQueuedDay, '2026-10-15'); assert.equal(row.jobRequestedAt.toISOString(), '2026-10-14T15:00:00.000Z');
  const due = scheduler.dueAccounts([{ provider: 'aplus', active: true, autoSync: { enabled: true, hour: 9 }, jobState: 'idle' }, { provider: 'aplus', active: true, autoSync: { enabled: true, hour: 9, lastQueuedDay: '2026-10-14' }, jobState: 'idle' }, { provider: 'amex', active: true, autoSync: { enabled: true, hour: 9 }, jobState: 'idle' }, { provider: 'aplus', active: true, autoSync: { enabled: true, hour: 11 }, jobState: 'idle' }, { provider: 'aplus', active: true, autoSync: { enabled: true, hour: 9 }, jobState: 'queued' }, { provider: 'aplus', active: true, autoSync: { enabled: true, hour: 9 }, jobState: 'complete', lastAttemptAt: at('2026-10-14T00:30:00Z') }], tenJst);
  assert.equal(due.length, 1);
  pass('S1 JST midnight: 23:59:59 same day no-op, 00:00 next day due only once the hour has passed; dueAccounts pre-filter keeps only the due row');
  // S2 — the route.
  const app = createApp(); app.use(auth); app.use(route);
  server = http.createServer(toNodeListener(app)); await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
  const jwtToken = jwt.sign({ userId: ownerId, email: user.email, type: 'access', jti: randomUUID() }, process.env.JWT_SECRET, { expiresIn: '30m' });
  const call = async (route: string, { method = 'GET', token = jwtToken, body, type = 'application/json', query }: any = {}) => {
    const url = new URL('/api/finance/' + route, origin); if (query) url.search = new URLSearchParams(query).toString();
    const response = await fetch(url, { method, headers: { 'Content-Type': type, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }) });
    const text = await response.text(); let data: any; try { data = JSON.parse(text); } catch { data = text; } return { status: response.status, data, message: data?.data?.message || data?.statusMessage || '' };
  };
  const id = String(account._id);
  await FinancialAccount.updateOne({ _id: account._id }, { $set: { 'autoSync.enabled': false, 'autoSync.hour': 9, 'autoSync.lastQueuedDay': '2026-10-01' } });
  const saved = await call('accounts/' + id + '/auto-sync', { method: 'PUT', body: { enabled: true, hour: 7 } });
  assert.equal(saved.status, 200, JSON.stringify(saved)); assert.deepEqual(saved.data, { autoSync: { enabled: true, hour: 7 } });
  row = await read(); assert.equal(row.autoSync.enabled, true); assert.equal(row.autoSync.hour, 7); assert.equal(row.autoSync.lastQueuedDay, '2026-10-01');
  for (const body of [{ enabled: true, hour: 24 }, { enabled: true, hour: '9' }, { enabled: 'yes', hour: 9 }, { enabled: true, hour: -1 }, { enabled: true, hour: 9.5 }, {}]) { const r = await call('accounts/' + id + '/auto-sync', { method: 'PUT', body }); assert.equal(r.status, 400, JSON.stringify(body) + ' → ' + r.status); assert.equal(r.message, '自動取得の時刻は0〜23で指定してください'); }
  const amex: any = await FinancialAccount.create({ ownerId, name: 'Synthetic Amex', provider: 'amex', primaryCard: '12345', cardIdentifiers: ['12345'], otpRecipient: 'a@example.invalid', otpMailbox: 'a@example.invalid' });
  const refused = await call('accounts/' + String(amex._id) + '/auto-sync', { method: 'PUT', body: { enabled: true, hour: 9 } }); assert.equal(refused.status, 400); assert.equal(refused.message, 'Aplus account required');
  assert.equal((await call('accounts/' + id + '/auto-sync', { method: 'PUT', token: '', body: { enabled: true, hour: 9 } })).status, 401);
  const foreign: any = await FinancialAccount.create({ ownerId: new mongoose.Types.ObjectId(), name: 'Synthetic other owner', provider: 'aplus', primaryCard: '9999', cardIdentifiers: ['9999'] });
  assert.equal((await call('accounts/' + String(foreign._id) + '/auto-sync', { method: 'PUT', body: { enabled: true, hour: 9 } })).status, 404);
  assert.equal((await FinancialAccount.findById(foreign._id).lean() as any).autoSync.enabled, false);
  const listed = await call('accounts'); assert.equal(listed.status, 200);
  assert.deepEqual(listed.data.accounts.find((a: any) => a._id === id).autoSync, { enabled: true, hour: 7, lastQueuedDay: '2026-10-01' });
  assert.deepEqual(listed.data.accounts.find((a: any) => a._id === String(amex._id)).autoSync, { enabled: false, hour: 9 });
  pass('S2 PUT auto-sync saves enabled/hour by dotted $set (lastQueuedDay kept), refuses hour 24, "9", a non-boolean, Amex, no token and a foreign account; GET accounts carries autoSync');
  const fiscal = { start: '2026-11-01', end: '2027-10-31' };
  const setting = await call('accounts/' + id + '/fiscal-period', { method: 'PUT', body: fiscal }); assert.equal(setting.status, 200, JSON.stringify(setting));
  assert.deepEqual((await read()).accounting.fiscalPeriod, fiscal); assert.equal((await read()).autoSync.hour, 7);
  assert.equal((await call('accounts/' + id + '/fiscal-period', { method: 'PUT', body: { start: '2026-02-30', end: fiscal.end } })).status, 400);
  assert.equal((await call('accounts/' + String(amex._id) + '/fiscal-period', { method: 'PUT', body: fiscal })).status, 400);
  pass('S2 fiscal-period control: unchanged route, input and 400s beside the new branch');
  await reset({ 'autoSync.enabled': false }); await FinanceCollector.updateOne({ _id: collector._id }, { $set: { revokedAt: new Date() } });
  const unpaired = await call('accounts/' + id + '/sync', { method: 'POST' }); assert.equal(unpaired.status, 409); assert.equal(unpaired.message, 'Pair a collector for this account first');
  await FinanceCollector.updateOne({ _id: collector._id }, { $set: { revokedAt: null } });
  await FinancialAccount.updateOne({ _id: account._id }, { $set: { jobLeaseUntil: at('2026-10-13T00:00:00Z'), jobDeviceId: collector._id, jobState: 'complete' } });
  const before = Date.now();
  const queued = await call('accounts/' + id + '/sync', { method: 'POST' }); assert.equal(queued.status, 200, JSON.stringify(queued));
  assert.equal(queued.data.account.jobState, 'queued'); assert.equal(queued.data.account.lastMessage, 'Waiting for collector'); assert.match(queued.data.account.jobId, /^[0-9a-f-]{36}$/);
  assert.ok(Date.parse(queued.data.account.jobRequestedAt) >= before - 1000); assert.equal(queued.data.account.jobLeaseUntil, undefined); assert.equal(queued.data.account.jobDeviceId, undefined);
  const again = await call('accounts/' + id + '/sync', { method: 'POST' }); assert.equal(again.status, 409); assert.equal(again.message, 'A synchronization is already queued or running');
  await FinancialAccount.updateOne({ _id: account._id }, { $set: { jobState: 'running', jobLeaseUntil: new Date(Date.now() - 1000) } });
  const expired = await call('accounts/' + id + '/sync', { method: 'POST' }); assert.equal(expired.status, 200); assert.notEqual(expired.data.account.jobId, queued.data.account.jobId);
  await FinancialAccount.updateOne({ _id: account._id }, { $set: { jobState: 'running', jobLeaseUntil: new Date(Date.now() + 60000) } });
  assert.equal((await call('accounts/' + id + '/sync', { method: 'POST' })).status, 409);
  assert.equal((await call('accounts/' + String(foreign._id) + '/sync', { method: 'POST' })).status, 404);
  pass('S2 manual 確定明細を取得 control: same collector 409, same filter (expired lease re-queues, live lease 409), same $set/$unset and message');
  console.log(JSON.stringify({ pass: true, checks }));
} catch (error: any) {
  console.log('FAIL ' + String(error?.stack || error?.message || error).replace(/\s+/g, ' ').slice(0, 900));
  console.log(JSON.stringify({ pass: false, checks }));
  process.exitCode = 1;
} finally { (await import(u('server/services/tokenBlacklistService.ts'))).stopCleanup(); if (server) await new Promise(r => server.close(r)); await mongoose.disconnect(); await mongo.stop(); await (await import('node:fs/promises')).rm(temp, { recursive: true, force: true }).catch(() => {}); }
`;

// Built-app harness: the Nuxt production build on an owned ephemeral MongoDB (S3 schedule plugin, S2 real Chrome settings
// UI), the real Windows collector enrolled through the real security routes over an isolated TLS origin (P2), and its
// setup page driven in real headless Chrome (F2). Every bank/mail/browser launch is intercepted; no production address.
const APP_HARNESS = String.raw`
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
const ROOT = process.argv[2], u = (p: string) => pathToFileURL(path.join(ROOT, p)).href, execute = promisify(execFile), digest = (s: string) => createHash('sha256').update(s).digest('hex');
let checks = 0; const pass = (name: string) => { checks++; console.log('PASS ' + name); };
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
async function freePort() { const s = net.createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const n = (s.address() as net.AddressInfo).port; await new Promise<void>(r => s.close(() => r())); return n; }
async function waitFor(fn: () => Promise<any>, label: string, ms = 40000) { const end = Date.now() + ms; let error: any; while (Date.now() < end) { try { const r = await fn(); if (r) return r; } catch (e) { error = e; } await delay(200); } throw Error(label + ' timed out: ' + String(error || '')); }
const BUILT = path.join(ROOT, '.output', 'server', 'index.mjs');
if (!existsSync(BUILT)) throw new Error('NOT RUN: .output/server/index.mjs is missing in this worktree (build it first); no built-app coverage claimed');
const mongoose = (await import('mongoose')).default, jwt = (await import('jsonwebtoken')).default;
const { MongoMemoryServer } = await import('mongodb-memory-server');
const { generateSync } = await import('otplib');
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-auto-sync-app-'));
const mongo = await MongoMemoryServer.create({ instance: { dbName: 'aplus_auto_sync_app_isolated' } });
const uri = mongo.getUri('aplus_auto_sync_app_isolated');
process.env.MONGO_URI = uri; process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = randomBytes(32).toString('hex');
let app: any = null, appLog = '', collector: any = null, proxy: any = null, browser: any = null, held: any = null, holdStatus = false; const counts = new Map<string, number>();
const pageLogs: string[] = [], pageErrors: string[] = [];
let closeOwnedBrowsers: any = async () => {}, removeOwnedTemp: any = async () => {};
try {
  await mongoose.connect(uri); assert.equal(mongoose.connection.name, 'aplus_auto_sync_app_isolated');
  const User = (await import(u('server/models/User.ts'))).default;
  const { FinancialAccount, initializeFinance } = await import(u('server/models/Finance.ts'));
  const { generateSecret } = await import(u('server/services/twoFactorService.ts'));
  const { SplitStore, replaceVaultFile } = await import(u('collector/vault.mjs'));
  const browserModule = await import(u('collector/browser.mjs')); closeOwnedBrowsers = browserModule.closeOwnedBrowsers;
  const { browserFor, ephemeralProfile, ownedBrowsers, findChrome } = browserModule;
  const fake = await import(u('collector/test/fake-broker.mjs')); removeOwnedTemp = fake.removeOwnedTemp;
  await initializeFinance();
  assert.ok(findChrome(), 'Chrome not found in its standard locations');
  const appPort = await freePort(), tlsPort = await freePort(), baseUrl = 'https://127.0.0.1:' + tlsPort, appOrigin = 'http://127.0.0.1:' + appPort;
  const certFile = path.join(temp, 'test-ca.pem'), keyFile = path.join(temp, 'test-ca-key.pem');
  await execute('C:/Program Files/Git/usr/bin/openssl.exe', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=OMF auto-sync isolated test', '-addext', 'subjectAltName=IP:127.0.0.1'], { windowsHide: true });
  const ca = await readFile(certFile), agent = new https.Agent({ ca });
  proxy = https.createServer({ key: await readFile(keyFile), cert: ca }, (req: any, res: any) => {
    const route = (req.url || '').split('?')[0]; counts.set(route, (counts.get(route) || 0) + 1);
    const forward = http.request({ host: '127.0.0.1', port: appPort, path: req.url, method: req.method, headers: req.headers }, (upstream: any) => {
      if (holdStatus && route === '/api/finance/collector/status' && req.method === 'POST') { holdStatus = false; held = { res, upstream }; return; }
      res.writeHead(upstream.statusCode || 502, upstream.headers); upstream.pipe(res);
    });
    forward.on('error', () => { res.writeHead(503); res.end('{}'); }); req.pipe(forward);
  });
  proxy.listen(tlsPort, '127.0.0.1'); await once(proxy, 'listening');
  const release = () => { if (!held) return; const { res, upstream } = held; held = null; res.writeHead(upstream.statusCode || 502, upstream.headers); upstream.pipe(res); };
  const startApp = async (scheduleMs: number) => {
    app = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: ROOT, windowsHide: true, env: { ...process.env, JWT_SECRET: process.env.JWT_SECRET, MONGO_URI: uri, NUXT_MONGO_URI: uri, NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(appPort), NITRO_PORT: String(appPort), OMF_COLLECTOR_PUBLIC_ORIGIN: baseUrl, OMF_DATA_DIR: path.join(temp, 'server-data'), OMF_SYNC_SCHEDULE_MS: String(scheduleMs) }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [app.stdout, app.stderr]) stream.on('data', (b: Buffer) => { appLog = (appLog + b).slice(-12000); });
    await waitFor(async () => { const r = await fetch(appOrigin + '/api/health', { signal: AbortSignal.timeout(2000) }); const b: any = await r.json(); if (b.database?.connected) { assert.equal(b.database.name, 'aplus_auto_sync_app_isolated'); return true; } }, 'built app', 90000);
  };
  const stopApp = async () => { if (!app || app.exitCode !== null) { app = null; return; } const exited = once(app, 'exit'); app.kill(); await exited; app = null; };
  const api = async (route: string, token: string, body?: any, method = body === undefined ? 'GET' : 'POST') => { const r = await fetch(appOrigin + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); const text = await r.text(); let data: any; try { data = JSON.parse(text); } catch { data = text; } return { status: r.status, data }; };
  const tls = (route: string, token: string, body?: any, method = body === undefined ? 'GET' : 'POST') => new Promise<any>((resolve, reject) => {
    const req = https.request(baseUrl + route, { method, agent, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }, (res: any) => { let text = ''; res.on('data', (b: any) => { text += b; }); res.on('end', () => { let value: any; try { value = JSON.parse(text); } catch { return reject(Error('Non-JSON response ' + res.statusCode)); } if ((res.statusCode || 500) >= 400) return reject(Object.assign(Error(value.statusMessage || 'Request rejected'), { status: res.statusCode })); resolve(value); }); });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  // ── S3a: the built server's schedule plugin queues a due account with no request from anyone.
  await startApp(2000);
  const password = 'Synthetic-Only-Password123!', secret = generateSecret();
  const owner: any = await User.create({ email: 'auto-sync-owner@example.invalid', name: 'Synthetic PC owner', password, twoFactorEnabled: true, twoFactorSecret: secret });
  const ownerToken = jwt.sign({ userId: String(owner._id), email: owner.email, type: 'access', jti: randomUUID() }, process.env.JWT_SECRET, { expiresIn: '2h' });
  const account: any = await FinancialAccount.create({ ownerId: owner._id, provider: 'aplus', name: 'Synthetic Aplus', primaryCard: '1234', cardIdentifiers: ['1234'], autoSync: { enabled: true, hour: 0 } });
  const accountId = String(account._id);
  const device = await api('/api/finance/collectors', ownerToken, { name: 'Synthetic remembered PC', accountIds: [accountId] }); assert.equal(device.status, 200, JSON.stringify(device));
  const queuedAt = Date.now();
  const scheduled: any = await waitFor(async () => { const r: any = await FinancialAccount.findById(account._id).lean(); return r.jobState === 'queued' ? r : null; }, 'schedule plugin queue', 15000);
  assert.equal(scheduled.lastMessage, '自動取得を予約しました'); assert.match(scheduled.jobId, /^[0-9a-f-]{36}$/); assert.ok(Date.parse(scheduled.jobRequestedAt) >= queuedAt - 5000);
  assert.equal(scheduled.autoSync.lastQueuedDay.length, 10); assert.equal(counts.size, 0, 'no collector request was made yet');
  assert.ok(appLog.includes('sync schedule every 2000 ms'), 'plugin start line missing: ' + appLog.slice(-600));
  pass('S3 built server with OMF_SYNC_SCHEDULE_MS=2000 queues the due account by itself, no 確定明細を取得 and no collector request');
  await stopApp(); appLog = ''; await startApp(0);
  await FinancialAccount.updateOne({ _id: account._id }, { $set: { jobState: 'idle' }, $unset: { 'autoSync.lastQueuedDay': '', jobId: '', jobRequestedAt: '' } });
  await delay(6000);
  assert.equal(((await FinancialAccount.findById(account._id).lean()) as any).jobState, 'idle');
  assert.ok(appLog.includes('sync schedule disabled'), 'plugin disabled line missing: ' + appLog.slice(-600));
  pass('S3 OMF_SYNC_SCHEDULE_MS=0 disables the schedule: the due account stays idle');
  // ── S2 UI: the settings in real headless Chrome at 390 px and 1440 px through the built page.
  const registered = await api('/api/auth/register', '', { email: 'auto-sync-ui@example.invalid', password: 'Synthetic-password-Only1!', name: 'Synthetic UI owner' }); assert.equal(registered.status, 200, JSON.stringify(registered));
  const uiToken = registered.data.tokens.accessToken;
  const uiAccount = await api('/api/finance/accounts', uiToken, { provider: 'aplus', name: 'Synthetic Aplus UI', primaryCard: '1234', cardIdentifiers: ['1234'] }); assert.equal(uiAccount.status, 200, JSON.stringify(uiAccount));
  const uiRoot = path.join(temp, 'ui');
  browser = await browserFor(ephemeralProfile(uiRoot, 'synthetic', 'omf', 'settings', 'ui'), { ephemeral: true, root: uiRoot, headless: true });
  let page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (r: any) => { const o = new URL(r.url()); if (o.origin === appOrigin || ['about:', 'data:'].includes(o.protocol)) return r.continue(); return r.abort(); });
  // Chrome logs every blocked third-party request and every expected 4xx as "Failed to load resource"; those are not page errors.
  page.on('pageerror', (e: any) => pageErrors.push(String(e)));
  page.on('console', (m: any) => { pageLogs.push(m.text()); if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) pageErrors.push(m.text()); });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(appOrigin + '/login', { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.setItem('theme', 'light')); await page.reload({ waitUntil: 'networkidle2' });
  const until = async (fn: any, label: string) => { for (let i = 0; i < 150; i++) { if (await page.evaluate(fn)) return; await delay(100); } throw Error('Browser condition timed out: ' + label); };
  await page.evaluate(() => (document.querySelector('#email') as any).focus()); await page.keyboard.type('auto-sync-ui@example.invalid');
  await page.evaluate(() => (document.querySelector('#password') as any).focus()); await page.keyboard.type('Synthetic-password-Only1!');
  await page.evaluate(() => (document.querySelector('button[type="submit"]') as any).click()); await until(() => location.pathname === '/', 'login');
  await page.goto(appOrigin + '/connections', { waitUntil: 'networkidle2' }); await until(() => !!document.querySelector('.account-grid section'), 'connections');
  const findAuto = String.raw!!PLACEHOLDER!!;
  await until(findAuto.replace('RETURN', 'return !!d'), 'auto-sync details present');
  assert.equal(await page.evaluate(findAuto.replace('RETURN', "return d.querySelector('summary').textContent")), '自動取得：オフ');
  await page.evaluate(findAuto.replace('RETURN', "d.open = true; d.querySelector('input[type=checkbox]').click(); const s = d.querySelector('select'); s.value = '9'; s.dispatchEvent(new Event('change', { bubbles: true })); return true"));
  assert.equal(await page.evaluate(findAuto.replace('RETURN', "return d.querySelector('input[type=checkbox]').checked")), true);
  await page.evaluate(findAuto.replace('RETURN', "d.querySelector('form button').click(); return true"));
  await until(() => (document.querySelector('.notice')?.textContent || '').includes('自動取得の設定を保存しました'), 'save notice');
  await until(findAuto.replace('RETURN', "return d.querySelector('summary').textContent.includes('毎日 9:00 以降')"), 'summary after save');
  assert.equal(await page.evaluate(findAuto.replace('RETURN', "return d.querySelector('summary').textContent")), '自動取得：毎日 9:00 以降（PCが利用可能なとき）');
  const listed = await api('/api/finance/accounts', uiToken); assert.deepEqual(listed.data.accounts.find((a: any) => a._id === uiAccount.data.account._id).autoSync, { enabled: true, hour: 9 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'horizontal overflow at 390 px');
  await page.setViewport({ width: 1440, height: 1000 }); await page.reload({ waitUntil: 'networkidle2' }); await until(() => !!document.querySelector('.account-grid section'), 'connections at 1440');
  assert.equal(await page.evaluate(findAuto.replace('RETURN', "return d.querySelector('summary').textContent")), '自動取得：毎日 9:00 以降（PCが利用可能なとき）');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'horizontal overflow at 1440 px');
  assert.deepEqual(pageErrors, [], 'page errors: ' + pageErrors.join(' | ').slice(0, 600));
  await closeOwnedBrowsers(); browser = null;
  pass('S2 real Chrome: 自動取得 details, checkbox, hour 9, save → 「毎日 9:00 以降」, GET accounts enabled, no horizontal overflow at 390/1440 px, 0 page errors');
  // ── P2 enrollment: the real security routes over the isolated TLS origin, the owner approving with password + TOTP.
  const data = path.join(temp, 'collector'), brokerDir = path.join(temp, 'test-broker'); await mkdir(data, { recursive: true });
  const store = new SplitStore(data), generation = randomBytes(32).toString('hex'), installationId = randomBytes(16).toString('hex');
  let key: any, trustToken = '';
  await store.withLock(async () => { key = await store.deviceKey(generation, { create: true }); trustToken = await store.trustCredential(generation, { create: true }); });
  const verifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('hex');
  const prefix = '/api/finance/collector-security/';
  const enroll = { action: 'enroll', installationId, generation, trustHash: digest(trustToken), publicKey: key.publicKey, codeChallenge: createHash('sha256').update(verifier).digest('base64url'), state, redirectUri: 'http://127.0.0.1:49123/collector-callback' };
  const pending = await tls(prefix + 'requests', device.data.token, enroll);
  const approved = await tls(prefix + 'requests/' + pending.id, ownerToken, { password, code: generateSync({ secret }) });
  const granted = await tls(prefix + 'exchange', device.data.token, { id: pending.id, code: new URL(approved.redirectUri).searchParams.get('code'), verifier });
  assert.match(granted.grant, /^[a-f0-9]{64}$/);
  const config = { baseUrl, token: device.data.token, accountInfo: [{ _id: accountId, ownerId: String(owner._id), name: account.name, primaryCard: '1234', provider: 'aplus' }], accounts: {}, mode: 'protected' };
  await store.withLock(async () => { await store.connection(config); await replaceVaultFile(path.join(data, 'vault-state.json'), JSON.stringify({ v: 3, phase: 'enrolling', installationId, generation, publicKey: key.publicKey, legacyId: 'legacy-' + Date.now() })); });
  key.close(); key = null;
  // The real collector launches the system browser for approvals; intercept only that OS-launch call (none is expected here).
  const launcherStub = path.join(temp, 'browser-launcher.cjs'), launcherCalls = path.join(temp, 'browser-launches.jsonl');
  await writeFile(launcherStub, [
    "const cp=require('node:child_process'),fs=require('node:fs');",
    'const original=cp.execFile;',
    'function execFile(file,...args){',
    "  if(file!=='rundll32.exe')return Reflect.apply(original,this,[file,...args]);",
    '  const [argv]=args,done=args.at(-1);',
    '  fs.appendFileSync(' + JSON.stringify(launcherCalls) + ",JSON.stringify({argv})+'\\n');",
    "  queueMicrotask(()=>done(null,'',''));return new (require('node:events').EventEmitter)();",
    '}',
    'for(const symbol of Object.getOwnPropertySymbols(original))Object.defineProperty(execFile,symbol,Object.getOwnPropertyDescriptor(original,symbol));',
    "cp.execFile=execFile;require('node:module').syncBuiltinESMExports();"
  ].join('\n'));
  // The default 10 s tick: a 1 s tick keeps the collector busy (DPAPI read + claim) almost continuously, and the setup
  // page disables every save button while /status reports busy.
  collector = await fake.startCollector({ directory: data, hideBrowser: true, env: { ...fake.brokerEnv(brokerDir), OMF_COLLECTOR_TICK_MS: '10000', NODE_EXTRA_CA_CERTS: certFile, NODE_OPTIONS: '--require ' + launcherStub } });
  assert.equal(await collector.waitStartup(), true, 'collector startup: ' + collector.output.join('').slice(-400));
  const local = async (route: string, body?: any, extra: any = {}) => collector.request(route, body, extra);
  // ── P2 before any session: key, host, shape and session guards.
  assert.equal((await fetch(collector.origin + '/sms-source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serial: 'ABC123' }) })).status, 403);
  assert.equal((await local('/sms-source', { serial: 'ABC123' }, { Origin: 'https://wrong.example.invalid' })).status, 403);
  for (const body of [{ serial: 'bad serial!' }, { serial: '' }, { serial: 'x'.repeat(65) }, { serial: 12 }, { serial: 'ABC123', extra: 1 }, {}]) { const r = await local('/sms-source', body); assert.equal(r.status, 400, JSON.stringify(body) + ' → ' + r.status + ' ' + r.text); }
  const noSession = await local('/sms-source', { serial: 'ABC123' }); assert.equal(noSession.status, 403); assert.equal(noSession.data.error, 'Connect this PC before saving a login.');
  let status = await collector.status(); assert.equal(status.smsSource?.serial, null); assert.equal(typeof status.smsSource?.adbFound, 'boolean'); assert.equal(status.protected, false);
  pass('P2 /sms-source: 403 without the setup key, 403 wrong Origin, 400 for a bad serial/shape, 403 without a protected session; /status carries smsSource');
  // ── P2 protected session through /protect (installation known → silent resume, no approval prompt).
  const protectedNow = await local('/protect', {}); assert.equal(protectedNow.status, 200, JSON.stringify(protectedNow.data)); assert.equal(protectedNow.data.protected, true); assert.equal(protectedNow.data.unlocked, true);
  status = await collector.status(); assert.equal(status.protected, true); assert.equal(status.unlocked, true); assert.equal(status.mode, 'protected');
  assert.equal(existsSync(launcherCalls), false, 'the collector opened a browser for approval');
  const savedSerial = await local('/sms-source', { serial: 'ABC123' }); assert.equal(savedSerial.status, 200, JSON.stringify(savedSerial.data)); assert.deepEqual(savedSerial.data, { saved: true, smsSource: { kind: 'adb', serial: 'ABC123' } });
  status = await collector.status(); assert.equal(status.smsSource.serial, 'ABC123');
  pass('P2 after /protect with the fake broker: a serial is saved into secret-free metadata and shown by /status');
  // ── F2: the setup page itself in real headless Chrome.
  const setupRoot = path.join(temp, 'setup-ui');
  browser = await browserFor(ephemeralProfile(setupRoot, 'synthetic', 'omf', 'setup', 'ui'), { ephemeral: true, root: setupRoot, headless: true });
  page = await browser.newPage(); pageLogs.length = 0; pageErrors.length = 0; const bodies: string[] = [];
  await page.setRequestInterception(true);
  page.on('request', (r: any) => { const o = new URL(r.url()); if (o.origin === collector.origin || ['about:', 'data:'].includes(o.protocol)) return r.continue(); return r.abort(); });
  page.on('pageerror', (e: any) => pageErrors.push(String(e)));
  page.on('console', (m: any) => { pageLogs.push(m.text()); if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) pageErrors.push(m.text()); });
  page.on('response', async (r: any) => { try { if (r.url().startsWith(collector.origin)) bodies.push(await r.text()); } catch { /* no body */ } });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(collector.link, { waitUntil: 'networkidle2' });
  const untilSetup = async (fn: any, label: string) => { for (let i = 0; i < 150; i++) { if (await page.evaluate(fn)) return; await delay(100); } throw Error('Setup page condition timed out: ' + label); };
  await untilSetup(() => !!document.querySelector('#sms-serial') && (document.querySelector('#sms-saved')?.textContent || '').includes('ABC123'), 'saved serial shown');
  // The page disables its buttons while /status reports the collector busy (its one-second tick is a claim round-trip),
  // exactly as the Aplus and Yayoi forms do; opening the setup link again lands outside that window (the page drops the
  // key from its URL at load, so a plain reload would lose it).
  const ready = async (selector: string) => { for (let i = 0; i < 40; i++) { if (await page.evaluate((s: string) => !(document.querySelector(s) as any)?.disabled, selector)) return; await delay(250); await page.goto(collector.link, { waitUntil: 'networkidle2' }); await untilSetup(() => !!document.querySelector('#sms-serial') && /^(SMS source saved|No SMS source)/.test(document.querySelector('#sms-saved')?.textContent || ''), 'setup page reopened'); } throw Error(selector + ' stayed disabled on 40 refreshes'); };
  await ready('#sms-save'); await ready('#sms-remove');
  await page.evaluate(() => { (document.querySelector('#sms-remove') as any).click(); });
  await untilSetup(() => (document.querySelector('#sms-status')?.textContent || '').includes('removed'), 'removed status');
  await untilSetup(() => !(document.querySelector('#sms-saved')?.textContent || '').includes('ABC123'), 'saved text cleared');
  status = await collector.status(); assert.equal(status.smsSource.serial, null);
  await ready('#sms-save');
  await page.evaluate(() => { const i = document.querySelector('#sms-serial') as any; i.value = 'TAB-01:5555'; (document.querySelector('#sms-save') as any).click(); });
  await untilSetup(() => (document.querySelector('#sms-status')?.textContent || '').includes('saved'), 'saved status');
  await untilSetup(() => (document.querySelector('#sms-saved')?.textContent || '').includes('TAB-01:5555'), 'saved serial shown again');
  status = await collector.status(); assert.equal(status.smsSource.serial, 'TAB-01:5555');
  pass('F2 real Chrome setup page: shows the saved serial, Remove clears it, Save stores a new one, /status agrees');
  // ── P2/F2 active action: a claimed job (no Chrome on this collector: the failure status is held by the proxy) → 409 on both paths.
  await ready('#sms-save');
  holdStatus = true;
  const manual = await api('/api/finance/accounts/' + accountId + '/sync', ownerToken, {}); assert.equal(manual.status, 200, JSON.stringify(manual));
  await waitFor(async () => held, 'collector claimed the job and reported', 30000);
  const busy = await local('/sms-source', { serial: 'ABC123' }); assert.equal(busy.status, 409); assert.equal(busy.data.error, 'Wait for the current collector action to finish');
  await page.evaluate(() => { const i = document.querySelector('#sms-serial') as any; i.value = 'XYZ789'; (document.querySelector('#sms-save') as any).click(); });
  await untilSetup(() => (document.querySelector('#sms-status')?.textContent || '') === 'Wait for the current collector action to finish', 'active-action error shown');
  release();
  await waitFor(async () => { const r: any = await FinancialAccount.findById(account._id).lean(); return r.jobState === 'failed' ? r : null; }, 'job failed closed without Chrome', 30000);
  await waitFor(async () => (await local('/sms-source', { serial: 'ABC123' })).status === 200, 'collector idle again', 15000);
  assert.equal((await collector.status()).smsSource.serial, 'ABC123'); assert.equal(existsSync(launcherCalls), false);
  pass('P2/F2 during an active collector action /sms-source answers 409 and the page shows it; afterwards the save succeeds');
  // ── P2/F2 after /lock: the session is gone → 403 on both paths; the metadata keeps no secret.
  const locked = await local('/lock', {}); assert.equal(locked.status, 200);
  const afterLock = await local('/sms-source', { serial: 'ABC123' }); assert.equal(afterLock.status, 403); assert.equal(afterLock.data.error, 'Connect this PC before saving a login.');
  await page.evaluate(() => { const i = document.querySelector('#sms-serial') as any; i.value = 'ABC123'; (document.querySelector('#sms-save') as any).click(); });
  await untilSetup(() => (document.querySelector('#sms-status')?.textContent || '') === 'Connect this PC before saving a login.', 'protected-session error shown');
  const removedAfterLock = await local('/sms-source', { serial: null }); assert.equal(removedAfterLock.status, 403);
  const logged = [...pageLogs, ...pageErrors, ...bodies].join('\n');
  for (const secretText of [device.data.token, password, trustToken, secret, 'omfc_']) assert.equal(logged.includes(secretText), false, 'a secret reached the page or its logs');
  assert.deepEqual(pageErrors, [], 'setup page errors: ' + pageErrors.join(' | ').slice(0, 600));
  await closeOwnedBrowsers(); browser = null;
  pass('P2/F2 after /lock: 403 on the API and shown on the page; no token, password, trust secret, TOTP secret or code in page logs or responses');
  console.log(JSON.stringify({ pass: true, checks }));
} catch (error: any) {
  console.log('FAIL ' + String(error?.stack || error?.message || error).replace(/\s+/g, ' ').slice(0, 1200) + (appLog ? ' | app: ' + appLog.replace(/\s+/g, ' ').slice(-400) : '') + (collector ? ' | collector: ' + collector.output.join('').replace(/\s+/g, ' ').slice(-400) : ''));
  console.log(JSON.stringify({ pass: false, checks }));
  process.exitCode = 1;
} finally {
  try { await closeOwnedBrowsers(); } catch { /* best effort */ }
  if (collector) await collector.stop().catch(() => {});
  if (app && app.exitCode === null) { const exited = once(app, 'exit'); app.kill(); await exited; }
  if (proxy) await new Promise(r => proxy.close(r));
  await import(u('server/services/tokenBlacklistService.ts')).then((m: any) => (m.stopCleanup || m.default?.stopCleanup)?.()).catch(() => {});
  await mongoose.disconnect(); await mongo.stop();
  await delay(500); await removeOwnedTemp(temp, { tmpdir: os.tmpdir() }).catch(() => {});
}
`.replace('String.raw!!PLACEHOLDER!!', JSON.stringify("(() => { const d = [...document.querySelectorAll('.account-grid details')].find(e => (e.querySelector('summary')?.textContent || '').startsWith('自動取得：')); if (!d) return false; RETURN })()"));

export default {
  name: 'aplus-auto-sync',
  covers: ['server/models/Finance.ts', 'server/services/financeService.ts', 'server/api/finance/[...path].ts', 'server/services/financeSyncScheduler.ts', 'server/plugins/syncSchedule.ts', 'pages/connections.vue', 'collector/sms-source.mjs', 'collector/aplus.mjs', 'collector/index.mjs', 'collector/browser.mjs', 'collector/setup.html', 'collector/setup.js', 'collector/package/stage.mjs', 'docs/amex-connector.md'],
  async run() {
    const started = Date.now();
    if (process.platform !== 'win32') return { pass: false, message: 'the Windows collector legs (DPAPI, broker, Chrome) can only be exercised on Windows' };
    const legs = [];
    const leg = async (name, fn) => { const t = Date.now(); try { const detail = await fn(); legs.push({ name, ok: true, detail: detail || '', ms: Date.now() - t }); } catch (error) { legs.push({ name, ok: false, detail: String(error?.message || error).split('\n')[0].slice(0, 700), ms: Date.now() - t }); } };
    const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-auto-sync-fixture-'));
    process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector');
    const assert = (await import('node:assert/strict')).default;
    const { HEADERS } = await import(pathToFileURL(path.join(REPO_ROOT, 'shared', 'aplus.mjs')).href);
    HEADERS_CACHE = HEADERS;
    const load = file => import(pathToFileURL(path.join(REPO_ROOT, file)).href).catch(error => Object.assign(new Error(file + ' missing or broken: ' + (error?.message || error)), { load: true }));
    const aplus = await load('collector/aplus.mjs');
    const sms = await load('collector/sms-source.mjs');
    const need = module => { if (module instanceof Error) throw module; return module; };
    const dirFor = name => path.join(temp, name);
    const collect = async (name, ui, { codeSource = null, signal = null, statuses = [], account = ACCOUNT, jobId = randomUUID() } = {}) => {
      const module = need(aplus);
      const directory = dirFor(name); await mkdir(directory, { recursive: true });
      const status = async (state, text) => { statuses.push([state, text]); };
      const result = await module.collectAplusFromPage(null, null, { ...account, jobId }, CREDENTIALS, directory, status, { ui, covered: [], codeSource, signal, jobId, now: ui.now, wait: ui.wait, origin: ORIGIN, pollMs: 1000 });
      return { result, directory, statuses, outbox: path.join(directory, 'outbox', account._id) };
    };
    const oneRequest = ui => { assert.equal(ui.counts.save, 1, 'saves ' + ui.counts.save); assert.equal(ui.counts.csv, 1, 'CSV clicks ' + ui.counts.csv); };
    try {
      await leg('S1/S2 scheduler, atomic enqueue and routes on memory Mongo', async () => harness('s1', S1_HARNESS));
      // M1 — the adb content-query parser.
      await leg('M1 parseContentQuery: statement row, six-digit payment row, comma and multi-line bodies; body last', async () => {
        const { parseContentQuery } = need(sms);
        const stdout = 'Row: 0 _id=41, address=0570008789, date=1760400000000, body=' + smsBody('4821') + '\r\nRow: 1 _id=42, address=0120000000, date=1760400001000, body=お支払いの認証コードは 482113 です。\nRow: 2 _id=43, address=, date=1760400002000, body=ご利用明細書ダウンロード, address=fake, date=9, body=inside\ncontinued line\nRow: 3 broken line without fields\n';
        const rows = parseContentQuery(stdout);
        assert.deepEqual(rows.map(r => [r.id, r.sender, r.receivedAt]), [['41', '0570008789', 1760400000000], ['42', '0120000000', 1760400001000], ['43', '', 1760400002000]]);
        assert.equal(rows[0].body, smsBody('4821')); assert.equal(rows[2].body, 'ご利用明細書ダウンロード, address=fake, date=9, body=inside\ncontinued line');
        assert.deepEqual(parseContentQuery(''), []); assert.deepEqual(parseContentQuery('No result found.\n'), []);
        return '3 rows parsed, commas and a continuation line kept in the body, a broken row dropped';
      });
      // M2 — the device-bound source with an injected adb.
      await leg('M2 AdbSmsSource: exact argv, device-bound claim persisted before return, duplicate claim throws, device switch not blocked, no code on disk, execute failure throws', async () => {
        const { AdbSmsSource, smsSourceInput, adbCandidates, findAdb } = need(sms);
        assert.deepEqual(smsSourceInput({ serial: 'ABC123' }), { serial: 'ABC123' }); assert.deepEqual(smsSourceInput({ serial: null }), { serial: null });
        for (const bad of [{ serial: 'bad serial!' }, { serial: '' }, { serial: 'x'.repeat(65) }, { serial: 7 }, { serial: 'ok', other: 1 }, {}, null, 'ABC123']) assert.throws(() => smsSourceInput(bad), undefined, JSON.stringify(bad));
        const env = { LOCALAPPDATA: path.join(temp, 'local'), OMF_ADB_PATH: path.join(temp, 'custom', 'adb.exe') };
        const candidates = adbCandidates(env);
        assert.equal(candidates[0], path.join(env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe')); assert.ok(candidates.includes(env.OMF_ADB_PATH));
        assert.equal(findAdb(env), null);
        await mkdir(path.dirname(env.OMF_ADB_PATH), { recursive: true }); await writeFile(env.OMF_ADB_PATH, ''); assert.equal(findAdb(env), env.OMF_ADB_PATH);
        const directory = dirFor('m2'); await mkdir(directory, { recursive: true });
        const calls = [], stdout = 'Row: 0 _id=1, address=0570008789, date=1760400010000, body=' + smsBody('4821') + '\nRow: 1 _id=2, address=0570008789, date=1760400020000, body=' + smsBody('9911') + '\n';
        const execute = async (file, args, options) => { calls.push({ file, args, options }); return { stdout, stderr: '' }; };
        const controller = new AbortController();
        const source = new AdbSmsSource({ serial: 'ABC123', directory, adb: 'C:/fake/platform-tools/adb.exe', execute });
        const messages = await source.messages({ requestedAt: 1760400000000, signal: controller.signal });
        assert.equal(calls.length, 1); assert.equal(calls[0].file, 'C:/fake/platform-tools/adb.exe');
        assert.deepEqual(calls[0].args, ['-s', 'ABC123', 'shell', 'content', 'query', '--uri', 'content://sms/inbox', '--projection', '_id:address:date:body', '--where', '"date>=1760400000000"']);
        assert.equal(calls[0].options.windowsHide, true); assert.equal(calls[0].options.timeout, 15000); assert.equal(calls[0].options.signal, controller.signal);
        assert.deepEqual(messages.map(m => m.id), ['ABC123:1', 'ABC123:2']); assert.equal(messages[0].sender, '0570008789'); assert.equal(messages[0].receivedAt, 1760400010000); assert.equal(messages[0].body, smsBody('4821'));
        await source.claim('ABC123:1');
        assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'used-sms-messages.json'), 'utf8')), ['ABC123:1']);
        await assert.rejects(source.claim('ABC123:1'), /already/);
        await assert.rejects(source.claim('DEF456:1'), /tablet|device/);
        assert.deepEqual((await source.messages({ requestedAt: 1760400000000 })).map(m => m.id), ['ABC123:2']);
        const other = new AdbSmsSource({ serial: 'DEF456', directory, adb: 'C:/fake/platform-tools/adb.exe', execute });
        assert.deepEqual((await other.messages({ requestedAt: 1760400000000 })).map(m => m.id), ['DEF456:1', 'DEF456:2']);
        await other.claim('DEF456:1');
        assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'used-sms-messages.json'), 'utf8')), ['ABC123:1', 'DEF456:1']);
        for (const name of await readdir(directory)) { const text = await readFile(path.join(directory, name), 'utf8'); assert.equal(text.includes('4821') || text.includes('9911') || text.includes('認証コード'), false, name + ' holds a code or body'); }
        const failing = new AdbSmsSource({ serial: 'ABC123', directory, adb: 'C:/fake/platform-tools/adb.exe', execute: async () => { throw new Error('error: device offline'); } });
        await assert.rejects(failing.messages({ requestedAt: 1760400000000 }), /device offline/);
        const noAdb = new AdbSmsSource({ serial: 'ABC123', directory, adb: null, execute });
        await assert.rejects(noAdb.messages({ requestedAt: 1760400000000 }), /adb/);
        assert.throws(() => new AdbSmsSource({ serial: 'bad serial!', directory, adb: 'x', execute }));
        return 'argv exact, keys ABC123:1 and DEF456:1 persisted, bodies and codes never on disk';
      });
      // M3 — the bounded wait on the real callback with the fake page and a virtual clock.
      const verificationOnce = statuses => { assert.equal(statuses.filter(([s]) => s === 'verification_required').length, 1, JSON.stringify(statuses)); };
      await leg('M3a message on the 4th poll → typed once, one claim, download completes', async () => {
        const ui = fakeUi({ verification: true }); let calls = 0; const claims = [];
        const codeSource = { async messages({ requestedAt }) { calls++; return calls >= 4 ? [smsMessage('src:1', requestedAt + 15000, '1357')] : []; }, async claim(id) { claims.push(id); } };
        const { result, statuses } = await collect('m3a', ui, { codeSource });
        assert.equal(result.items.length, 1); assert.equal(result.failed, null); assert.equal(ui.counts.code, 1); assert.equal(ui.counts.lastCode, '1357'); assert.deepEqual(claims, ['src:1']); assert.equal(calls, 4); oneRequest(ui); verificationOnce(statuses); assert.equal(ui.counts.show, 1);
        assert.ok(ui.clock.t - 1_800_000_000_000 < 60000, 'virtual ms ' + (ui.clock.t - 1_800_000_000_000));
        return 'typed 1357 after 4 reads (' + (ui.clock.t - 1_800_000_000_000) / 1000 + 's virtual), item collected';
      });
      await leg('M3b a message received before the request is never typed; the person path completes', async () => {
        const ui = fakeUi({ verification: true, personAfterMs: 60000 }); let calls = 0; const claims = [];
        const codeSource = { async messages({ requestedAt }) { calls++; return [smsMessage('src:old', requestedAt - 1000)]; }, async claim(id) { claims.push(id); } };
        const { result, statuses } = await collect('m3b', ui, { codeSource });
        assert.equal(result.items.length, 1); assert.equal(ui.counts.code, 0); assert.deepEqual(claims, []); assert.equal(ui.counts.person, 1); assert.ok(calls >= 10, 'reads ' + calls); oneRequest(ui); verificationOnce(statuses);
        return calls + ' reads refused by freshness; the person typed at 60 s';
      });
      await leg('M3c a message 310 s late is never typed (polling stopped after 300 s); the person path still completes', async () => {
        const ui = fakeUi({ verification: true, personAfterMs: 400000 }); let calls = 0, lateCalls = 0; const claims = [];
        const codeSource = { async messages({ requestedAt }) { calls++; if (ui.clock.t - requestedAt > 300000) lateCalls++; return ui.clock.t >= requestedAt + 310000 ? [smsMessage('src:late', requestedAt + 310000)] : []; }, async claim(id) { claims.push(id); } };
        const { result, statuses } = await collect('m3c', ui, { codeSource });
        assert.equal(result.items.length, 1); assert.equal(ui.counts.code, 0); assert.deepEqual(claims, []); assert.equal(ui.counts.person, 1); assert.equal(lateCalls, 0, 'reads after the validity window: ' + lateCalls); assert.ok(calls >= 60 && calls <= 61, 'reads ' + calls); oneRequest(ui); verificationOnce(statuses);
        const elapsed = (ui.clock.t - 1_800_000_000_000) / 1000; assert.ok(elapsed >= 400 && elapsed < 420, 'virtual seconds ' + elapsed);
        return calls + ' reads within 300 s, none after; completed by the person at 400 s';
      });
      await leg('M3d signal aborted mid-verification → throws within one poll, reads frozen, nothing typed', async () => {
        const ui = fakeUi({ verification: true }); let calls = 0; const claims = [], controller = new AbortController();
        const codeSource = { async messages() { calls++; if (calls === 3) controller.abort(); return []; }, async claim(id) { claims.push(id); } };
        await assert.rejects(collect('m3d', ui, { codeSource, signal: controller.signal }), error => error?.name === 'AbortError');
        const seen = calls; await sleep(200);
        assert.equal(calls, seen); assert.equal(calls, 3); assert.equal(ui.counts.code, 0); assert.deepEqual(claims, []); oneRequest(ui);
        return 'aborted on the 3rd read; no further device read';
      });
      await leg('M3e a source throwing on every poll → person path; one request', async () => {
        const ui = fakeUi({ verification: true, personAfterMs: 120000 }); let calls = 0;
        const codeSource = { async messages() { calls++; throw new Error('adb: device unauthorized'); }, async claim() { throw new Error('never'); } };
        const { result, statuses } = await collect('m3e', ui, { codeSource });
        assert.equal(result.items.length, 1); assert.equal(ui.counts.code, 0); assert.equal(ui.counts.person, 1); assert.ok(calls >= 20, 'reads ' + calls); oneRequest(ui); verificationOnce(statuses);
        return calls + ' failed reads swallowed; the person typed at 120 s';
      });
      await leg('M3f no source → notice once, person path, one request (unchanged manual lane)', async () => {
        const ui = fakeUi({ verification: true, personAfterMs: 90000 });
        const { result, statuses } = await collect('m3f', ui);
        assert.equal(result.items.length, 1); assert.equal(ui.counts.code, 0); assert.equal(ui.counts.person, 1); oneRequest(ui); verificationOnce(statuses); assert.equal(ui.counts.show, 1);
        return 'manual lane unchanged';
      });
      // F1 — cancellation rechecked after asynchronous reads and claims.
      await leg('F1a abort while a delayed read is pending, then a valid message → no claim, no typing, no next read', async () => {
        const ui = fakeUi({ verification: true }); let calls = 0, resolveRead = null; const claims = [], controller = new AbortController();
        const codeSource = { messages({ requestedAt }) { calls++; return new Promise(resolve => { resolveRead = () => resolve([smsMessage('src:1', requestedAt + 5000)]); }); }, async claim(id) { claims.push(id); } };
        const run = collect('f1a', ui, { codeSource, signal: controller.signal });
        assert.ok(await waitForReal(() => calls === 1), 'the read never started');
        controller.abort(); resolveRead();
        await assert.rejects(run, error => error?.name === 'AbortError');
        await sleep(200); assert.equal(calls, 1); assert.deepEqual(claims, []); assert.equal(ui.counts.code, 0); oneRequest(ui);
        return 'read resolved after abort: ignored';
      });
      await leg('F1b abort while a delayed claim is pending, then resolve → no typing, no next read, the message stays consumed', async () => {
        const ui = fakeUi({ verification: true }); let calls = 0, resolveClaim = null; const claims = [], controller = new AbortController();
        const codeSource = { async messages({ requestedAt }) { calls++; return [smsMessage('src:1', requestedAt + 5000)]; }, claim(id) { claims.push(id); return new Promise(resolve => { resolveClaim = resolve; }); } };
        const run = collect('f1b', ui, { codeSource, signal: controller.signal });
        assert.ok(await waitForReal(() => claims.length === 1), 'the claim never started');
        controller.abort(); resolveClaim();
        await assert.rejects(run, error => error?.name === 'AbortError');
        await sleep(200); assert.equal(calls, 1); assert.deepEqual(claims, ['src:1']); assert.equal(ui.counts.code, 0); oneRequest(ui);
        return 'claimed key kept, nothing typed';
      });
      await leg('F1c real subprocess: abort terminates the adb read and the cancellation propagates (never a manual-fallback null)', async () => {
        const { AdbSmsSource } = need(sms);
        const directory = dirFor('f1c'); await mkdir(directory, { recursive: true });
        const pidFile = path.join(directory, 'child.pid'), sleeper = path.join(directory, 'sleeper.cjs');
        await writeFile(sleeper, "require('node:fs').writeFileSync(process.argv[2], String(process.pid)); setTimeout(() => {}, 60000);");
        const execute = (file, args, options) => execFileAsync(process.execPath, [sleeper, pidFile], options);
        const source = new AdbSmsSource({ serial: 'ABC123', directory, adb: 'C:/fake/platform-tools/adb.exe', execute });
        const ui = fakeUi({ verification: true }), controller = new AbortController();
        const run = collect('f1c', ui, { codeSource: source, signal: controller.signal });
        assert.ok(await waitForReal(() => exists(pidFile), 20000), 'the subprocess never started');
        const pid = Number(await readFile(pidFile, 'utf8'));
        controller.abort();
        await assert.rejects(run, error => error?.name === 'AbortError');
        const alive = p => { try { process.kill(p, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
        assert.ok(await waitForReal(() => !alive(pid), 10000), 'subprocess ' + pid + ' still alive after the abort');
        assert.equal(ui.counts.code, 0); assert.equal(await exists(path.join(directory, 'used-sms-messages.json')), false); oneRequest(ui);
        return 'subprocess ' + pid + ' ended, AbortError propagated';
      });
      // P1 — the actual collector passthrough on real owned headless Chrome.
      await leg('P1 collectAplusStatement on real owned headless Chrome with the fake page: code typed once, profile removed; runAplusJob passes codeSource/signal', async () => {
        const browser = await load('collector/browser.mjs'); const index = await load('collector/index.mjs');
        const { collectAplusStatement, browserFor, ephemeralProfile, ownedBrowsers, closeOwnedBrowsers, findChrome } = need(browser);
        assert.ok(findChrome(), 'Chrome not found in its standard locations');
        const directory = dirFor('p1'); await mkdir(directory, { recursive: true });
        const account = { ...ACCOUNT, jobId: randomUUID() }, profile = ephemeralProfile(directory, account.ownerId, 'aplus', account._id, 'p1');
        // Pre-launch the owned browser hidden on the exact profile the collector computes: browserFor reuses it (no window).
        // Every page it opens aborts every request: nothing can reach a bank, in this revision or any earlier one.
        const owned = await browserFor(profile, { ephemeral: true, root: directory, headless: true });
        const newPage = owned.newPage.bind(owned);
        owned.newPage = async () => { const page = await newPage(); await page.setRequestInterception(true); page.on('request', request => request.abort()); return page; };
        const ui = fakeUi({ verification: true }), claims = [], controller = new AbortController(), statuses = [];
        const codeSource = { async messages({ requestedAt }) { return [smsMessage('src:p1', requestedAt + 2000, '2468')]; }, async claim(id) { claims.push(id); } };
        try {
          const result = await collectAplusStatement(account, CREDENTIALS, directory, async (state, text) => { statuses.push([state, text]); }, { batch: 'p1', origin: ORIGIN, covered: [], jobId: account.jobId, codeSource, signal: controller.signal, ui });
          assert.equal(result.items.length, 1); assert.ok(result.pending); assert.equal(ui.counts.code, 1); assert.equal(ui.counts.lastCode, '2468'); assert.deepEqual(claims, ['src:p1']); oneRequest(ui); verificationOnce(statuses);
        } finally { await closeOwnedBrowsers().catch(() => {}); }
        assert.equal(ownedBrowsers().length, 0); assert.ok(await waitForReal(async () => !(await exists(profile)), 15000), 'ephemeral profile still exists');
        const { runAplusJob } = need(index); const seen = [];
        const outcome = await runAplusJob(account, { baseUrl: ORIGIN, token: 'omfc_' + 'a'.repeat(64) }, null, { status: async () => {}, pending: async () => [], upload: async () => ({ id: 'f'.repeat(24) }), directory: dirFor('p1-job'), codeSource, signal: controller.signal, collect: async (acct, credentials, root, status, options) => { seen.push(options); return { items: [], pending: null, nothing: true, unavailable: [], failed: null }; } });
        assert.equal(seen.length, 1); assert.equal(seen[0].codeSource, codeSource); assert.equal(seen[0].signal, controller.signal); assert.equal(outcome.nothing, true);
        return 'typed 2468 once on real Chrome, profile ' + path.basename(profile) + ' removed; runAplusJob forwards codeSource and signal';
      });
      // A12 — the staged package carries the source module.
      await leg('A12 staged package: ALLOWLIST carries sms-source.mjs and the staged copy imports', async () => {
        const { ALLOWLIST, stage } = await import(pathToFileURL(path.join(REPO_ROOT, 'collector', 'package', 'stage.mjs')).href);
        assert.ok(ALLOWLIST.some(item => item.from === 'collector/sms-source.mjs'), 'ALLOWLIST lacks collector/sms-source.mjs');
        const into = path.join(temp, 'staged'); const { manifest } = await stage({ into, origin: 'https://omf.example', install: false, log: () => {} });
        assert.ok(manifest.files['collector/sms-source.mjs'], 'not staged');
        const staged = await import(pathToFileURL(path.join(into, 'collector', 'sms-source.mjs')).href); assert.equal(typeof staged.AdbSmsSource, 'function');
        const stagedAplus = await import(pathToFileURL(path.join(into, 'collector', 'aplus.mjs')).href); assert.equal(typeof stagedAplus.collectAplusFromPage, 'function');
        return Object.keys(manifest.files).length + ' files staged';
      });
      // A13 — the owner transition steps and the scope line.
      await leg('A13 docs: B1-B6 owner transition steps and the current-scope line', async () => {
        const text = await readFile(path.join(REPO_ROOT, 'docs', 'amex-connector.md'), 'utf8');
        for (const step of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']) assert.ok(new RegExp('\\b' + step + '\\b').test(text), step + ' missing');
        assert.ok(text.includes('OMF_SYNC_SCHEDULE_MS'), 'scope line lacks the schedule setting'); assert.ok(/adb/i.test(text), 'scope line lacks the ADB SMS source');
        return 'B1-B6 present; schedule and SMS source described';
      });
      // S2 UI, S3, P2, F2 — the built app and the real collector.
      await leg('S2-UI/S3/P2/F2 built app: schedule plugin, settings UI in real Chrome, collector /sms-source ownership and session, setup page in real Chrome', async () => harness('app', APP_HARNESS));
    } finally {
      await rm(temp, { recursive: true, force: true }).catch(() => {});
    }
    const red = legs.filter(l => !l.ok);
    const lines = legs.map(l => l.name + ': ' + (l.ok ? 'ok' : 'RED') + ' (' + Math.round(l.ms / 1000) + 's)' + (l.detail ? ' — ' + l.detail : ''));
    return { pass: red.length === 0, message: (red.length === 0 ? legs.length + ' legs green' : red.length + ' of ' + legs.length + ' legs red') + ' in ' + Math.round((Date.now() - started) / 1000) + 's · ' + lines.join(' · ') };
  }
};
