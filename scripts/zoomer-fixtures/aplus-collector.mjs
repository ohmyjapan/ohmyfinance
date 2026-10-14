// Fixture for plan omf-aplus-automation-20261013 (5-plan-approved.json §4a): Aplus statement and pending capture in the
// OMF downloader. Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture aplus-collector.mjs --cwd <this worktree>
// Every leg runs on synthetic data, an owned ephemeral MongoDB, temporary directories and a fake My APLUS page; no bank,
// mail, browser or production address is reached. The recorded private inputs (the retained September CSV, its card list,
// the archived pending capture) are read from the hub's private evidence folder or OMF_APLUS_REAL_* and never copied here.
// Fail-first on 81ab467: L1 `3行目: 円の金額を整数で指定してください`, L2 `2行目`, L4 400/400/415 at the route, L4b the
// pending bytes labelled text/csv (no exported upload), L5 collector/aplus.mjs missing, L6 shared/finance-pending.mjs
// missing from the staged tree, L7/L8 exports missing, the five security binding mutants absent.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, rename, stat, unlink, access } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const timeoutMs = 900000;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const PLAN_REVISION = '81ab467182fefe4b6820d020bf9b3ff623f7324b';
const HUB_EVIDENCE = 'C:/Users/Junsan2/Documents/ohmycode/output/omf-aplus-coverage-20261013';
const REAL_CSV = process.env.OMF_APLUS_REAL_CSV || path.join(HUB_EVIDENCE, 'originals', 'aplus_meisai_3709_202609.csv');
const REAL_CSV_SHA256 = '893e4ee8be29dcddab5c5a101519ec8e91f8ca30a49e101a32981399685d3b8b';
const REAL_CARDS = process.env.OMF_APLUS_REAL_CARDS || path.join(HUB_EVIDENCE, 'september-validation.json');
const REAL_PENDING = process.env.OMF_APLUS_REAL_PENDING || path.join(HUB_EVIDENCE, 'live2', 'pending-capture.json');
const REAL_PENDING_SHA256 = 'e29b65db8d2e9d422d4cf1f5d0566f693a24b5bbf08fb452ad3e10ea36809ec0';
const SYNTHETIC_FILE = path.join(HUB_EVIDENCE, 'synthetic-adjustment-fixture.json');
const execute = promisify(execFile);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = p => access(p).then(() => true, () => false);
const GUID = /^[a-f\d-]{36}$/;

// Synthetic statement shapes (scripts/finance-aplus.test.mjs:8-11) and the observed September field shapes without any
// real merchant, card, date or amount (output/omf-aplus-coverage-20261013/synthetic-adjustment-fixture.json).
const csvOf = (rows, headers) => Buffer.from('\uFEFF' + [headers, ...rows].map(row => row.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n'));
const purchase = (changes = {}) => Object.assign(['≪****-****-****-1234≫', '20260801', 'Synthetic shop', '1200', 'Ｓ', '1', '01', '1200', ''], changes);
const SYNTHETIC = {
  statementMonth: '2026-09', cardIdentifiers: ['1234'], displayedPaymentTotal: 280, displayedCreditOffset: 50,
  rows: [
    ['≪****-****-****-1234≫', '20260806', 'Synthetic merchant A', '30', 'Ｓ', '1', '01', '', ''],
    ['≪****-****-****-1234≫', '20260807', 'Synthetic merchant B', '200', 'Ｓ', '1', '01', '180', ''],
    ['≪****-****-****-1234≫', '20260808', 'Synthetic merchant C', '100', 'Ｓ', '1', '01', '100', ''],
    ['≪****-****-****-1234≫', '20260713', 'Synthetic refund', '-50', 'Ｓ', '1', '', '', '返品（８月ご利用明細分）'],
    ['', '', 'ご入金（８／２７）', '-50', '', '', '', '', 'ショッピング元金５０円']
  ]
};
const ACCOUNT = { _id: 'a1a1a1a1a1a1a1a1a1a1a1a1', ownerId: 'b2b2b2b2b2b2b2b2b2b2b2b2', provider: 'aplus', name: 'Synthetic Aplus', primaryCard: '1234', cardIdentifiers: ['1234', '5678'], jobId: randomUUID() };
const CREDENTIALS = { username: 'synthetic', password: 'synthetic' };
const ORIGIN = 'https://omf.example';

// Pending page shapes (scripts/finance-pending-fixtures.mjs aplusCapture) split over N rendered pages.
function pendingPages(items, perPage) {
  const total = items.reduce((n, r) => n + r.amount, 0);
  const chunks = []; for (let i = 0; i < items.length; i += perPage) chunks.push(items.slice(i, i + perPage));
  const pageNumbers = chunks.map((_, i) => String(i + 1));
  return chunks.map((rows, i) => ({ activePage: String(i + 1), pageNumbers: [...pageNumbers], summary: `未請求のご利用金額\n\n未確定\n${total.toLocaleString('en-US')}円`,
    rows: rows.map((r, j) => ({ position: j + 1, merchant: r.merchant, dateAndPayment: r.date.slice(2).replaceAll('-', '.') + '   1回払い', amount: r.amount.toLocaleString('en-US') + '円', details: [{ label: 'カード番号下4桁', value: r.card || '1234' }, { label: '売上種別', value: 'ショッピング' }, { label: '初回年月', value: r.month || '26/09' }] })) }));
}
const pendingItems = n => Array.from({ length: n }, (_, i) => ({ merchant: 'Synthetic shop ' + (i + 1), amount: 1200, date: '2026-08-0' + ((i % 9) + 1) }));

// The fake My APLUS page: every click and read is counted; downloads arrive the way the scenario says; time is virtual.
function fakeUi({ start = 'login', options = ['2026/09', '2026/08', '2026/07'], totals = { '2026/09': 2400, '2026/08': 1200, '2026/07': 600 }, totalText = null, accountLabel = '…-1234', download = 'events', verification = false, pages = pendingPages(pendingItems(2), 2), corruptPage = null, errorPageOnce = false, csvMonth = null } = {}) {
  const clock = { t: 1_800_000_000_000 };
  const counts = { open: 0, login: 0, returnToLogin: 0, openDetails: 0, openUnbilled: 0, save: 0, csv: 0, code: 0, show: 0, readPage: 0, goToPage: 0, selectMonth: 0 };
  let kind = start, month = options[0], activeIndex = 0, pendingDelivery = null, handlers = {}, jobDir = null, crdownloadPolls = 0;
  const bytesFor = m => csvOf([purchase({ 1: m.replace('/', '') + '01', 3: String(totals[m]), 7: String(totals[m]) })], csvMonth?.headers || HEADERS_CACHE);
  const deliver = async () => {
    if (!pendingDelivery) return;
    const { guid, bytes } = pendingDelivery; pendingDelivery = null;
    if (download === 'events' || download === 'double') {
      await writeFile(path.join(jobDir, guid), bytes);
      handlers['Browser.downloadWillBegin']?.({ guid, suggestedFilename: 'aplus_meisai.csv' });
      if (download === 'double') handlers['Browser.downloadWillBegin']?.({ guid: randomUUID(), suggestedFilename: 'aplus_meisai.csv' });
      handlers['Browser.downloadProgress']?.({ guid, state: 'completed', totalBytes: bytes.length, receivedBytes: bytes.length });
    } else if (download === 'lost') await writeFile(path.join(jobDir, guid), bytes);
    else if (download === 'crdownload') { await writeFile(path.join(jobDir, guid + '.crdownload'), bytes.subarray(0, 4)); crdownloadPolls = 2; pendingDelivery = { guid, bytes, rename: true }; }
  };
  const ui = {
    counts, clock, now: () => clock.t,
    async wait(ms) {
      clock.t += ms;
      if (pendingDelivery?.rename) { if (--crdownloadPolls <= 0) { const { guid, bytes } = pendingDelivery; pendingDelivery = null; await writeFile(path.join(jobDir, guid + '.crdownload'), bytes); await rename(path.join(jobDir, guid + '.crdownload'), path.join(jobDir, guid)); } }
    },
    async open() { counts.open++; },
    async state() { return { kind }; },
    async login() { counts.login++; kind = 'authenticated'; },
    async returnToLogin() { counts.returnToLogin++; kind = errorPageOnce ? 'login' : 'error_page'; },
    async openDetails() { counts.openDetails++; kind = 'details'; },
    async snapshot() { return { url: 'https://myaplus.aplus.co.jp/cards/billing/details', month, total: totals[month] === undefined ? '' : (totalText ?? totals[month].toLocaleString('en-US') + '円'), account: accountLabel, options: [...options] }; },
    async selectMonth(m) { counts.selectMonth++; month = m.replace('-', '/'); },
    downloadSession(dir) { jobDir = dir; handlers = {}; return { on(event, handler) { handlers[event] = handler; }, async close() { handlers = {}; } }; },
    async save() { counts.save++; },
    async csv() {
      counts.csv++;
      pendingDelivery = { guid: randomUUID(), bytes: bytesFor(month) };
      if (verification) { kind = 'verification'; return; }
      await deliver();
    },
    async code(value) { counts.code++; counts.lastCode = value; kind = 'details'; await deliver(); },
    async show() { counts.show++; },
    async openUnbilled() { counts.openUnbilled++; kind = 'unbilled'; activeIndex = 0; },
    async pageNumbers() { return [...pages[0].pageNumbers]; },
    async goToPage(n) { counts.goToPage++; activeIndex = Number(n) - 1; },
    async readPage() { counts.readPage++; const page = JSON.parse(JSON.stringify(pages[activeIndex])); if (corruptPage) corruptPage(activeIndex + 1, page); return page; }
  };
  return ui;
}
let HEADERS_CACHE = null;

async function withMutantModule(file, marker, fn) {
  const source = path.join(REPO_ROOT, file), lines = (await readFile(source, 'utf8')).split('\n'), index = lines.findIndex(l => l.includes('// guard:' + marker));
  if (index < 0) throw new Error('guard marker missing: ' + marker);
  lines.splice(index, 1);
  const mutant = path.join(path.dirname(source), path.basename(file, '.mjs') + `.mutant-${marker}-${process.pid}.mjs`);
  await writeFile(mutant, lines.join('\n'), { flag: 'wx' });
  try {
    let module;
    try { module = await import(pathToFileURL(mutant).href); } catch (error) { throw new Error('FAIL mutant invalid: ' + marker + ' — ' + (error?.message || error)); }
    await fn(module);
  } finally { await unlink(mutant); }
}

function runChild(args, { cwd = REPO_ROOT, env = process.env, timeout = 600000 } = {}) {
  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, args, { cwd, windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, env }, (error, stdout, stderr) => {
      const text = String(stdout || ''), lines = text.split(/\r?\n/);
      let receipt = null;
      try { receipt = JSON.parse(lines.find(l => l.startsWith('{"pass":')) || 'null'); } catch { receipt = null; }
      resolve({ ms: Date.now() - started, code: error ? (error.code ?? 1) : 0, killed: !!error?.killed, passes: lines.filter(l => l.startsWith('PASS ')).map(l => l.slice(5)), reds: lines.filter(l => l.startsWith('FAIL ')).map(l => l.slice(5)), receipt, tail: (String(stderr || '').trim() || text).slice(-1500) });
    });
  });
}

// L4: the real route (server/api/finance/[...path].ts) mounted on h3 over an owned ephemeral MongoDB, driven over HTTP by
// an owner JWT and a collector token; written to a temporary file and run under tsx because the route is TypeScript.
const L4_HARNESS = String.raw`
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = process.argv[2], u = p => pathToFileURL(path.join(ROOT, p)).href, sha = b => createHash('sha256').update(b).digest('hex');
let checks = 0; const pass = name => { checks++; console.log('PASS ' + name); };
const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default, jwt = (await import('jsonwebtoken')).default;
const { createApp, toNodeListener } = await import('h3');
const mongo = await MongoMemoryServer.create({ instance: { dbName: 'aplus_collector_isolated' } });
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-aplus-l4-'));
process.env.MONGO_URI = mongo.getUri('aplus_collector_isolated'); process.env.JWT_SECRET = randomBytes(32).toString('hex'); process.env.NODE_ENV = 'test';
process.env.OMF_DATA_DIR = path.join(temp, 'data'); process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector'); await mkdir(process.env.OMF_COLLECTOR_DIR, { recursive: true });
let server;
try {
  await mongoose.connect(process.env.MONGO_URI); assert.equal(mongoose.connection.name, 'aplus_collector_isolated');
  const User = (await import(u('server/models/User.ts'))).default;
  const { FinancialAccount, FinanceCollector, FinanceImport, initializeFinance } = await import(u('server/models/Finance.ts'));
  const route = (await import(u('server/api/finance/[...path].ts'))).default, auth = (await import(u('server/middleware/auth.ts'))).default;
  const { reviewImport, commitImport } = await import(u('server/services/financeService.ts'));
  const { HEADERS } = await import(u('shared/aplus.mjs')); const { aplusCapture } = await import(u('scripts/finance-pending-fixtures.mjs'));
  await initializeFinance();
  const app = createApp(); app.use(auth); app.use(route);
  server = http.createServer(toNodeListener(app)); await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
  const user = await User.create({ email: 'aplus-fixture@example.invalid', name: 'Synthetic owner', password: 'Synthetic-only-Strong-Password1!' });
  const ownerId = String(user._id), jwtToken = jwt.sign({ userId: ownerId, email: user.email, type: 'access', jti: randomUUID() }, process.env.JWT_SECRET, { expiresIn: '30m' });
  const call = async (route, { method = 'GET', token = jwtToken, body, type = 'application/json', query } = {}) => {
    const url = new URL('/api/finance/' + route, origin); if (query) url.search = new URLSearchParams(query).toString();
    const response = await fetch(url, { method, headers: { 'Content-Type': type, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; } return { status: response.status, data };
  };
  const csv = rows => Buffer.from('\uFEFF' + [HEADERS, ...rows].map(r => r.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n'));
  const purchase = (changes = {}) => Object.assign(['≪****-****-****-1234≫', '20260801', 'Synthetic shop', '1200', 'Ｓ', '1', '01', '1200', ''], changes);
  // Account, collector, sync, claim.
  const created = await call('accounts', { method: 'POST', body: { provider: 'aplus', name: 'Synthetic Aplus', primaryCard: '1234', cardIdentifiers: ['1234', '5678'] } }); assert.equal(created.status, 200, JSON.stringify(created)); const accountId = created.data.account._id;
  const collector = await call('collectors', { method: 'POST', body: { name: 'Synthetic PC', accountIds: [accountId] } }); assert.equal(collector.status, 200, 'createCollector refused the Aplus account: ' + JSON.stringify(collector)); const token = collector.data.token;
  const synced = await call('accounts/' + accountId + '/sync', { method: 'POST' }); assert.equal(synced.status, 200, 'sync refused for Aplus: ' + JSON.stringify(synced)); assert.equal(synced.data.account.jobState, 'queued'); const jobId = synced.data.account.jobId;
  assert.equal((await call('accounts/' + accountId + '/sync', { method: 'POST' })).status, 409);
  const claimed = await call('collector/claim', { method: 'POST', token, body: {} }); assert.equal(claimed.status, 200, JSON.stringify(claimed)); assert.ok(claimed.data.account, 'claim returned no Aplus account'); assert.equal(claimed.data.account.jobId, jobId);
  assert.deepEqual(claimed.data.covered, { statements: [], notices: [] }); assert.equal(claimed.data.account.lastMessage, '明細の取得を開始');
  assert.equal((await call('collector/accounts', { token })).data.accounts.length, 1);
  pass('an Aplus account can be given to a collector, queued by 確定明細を取得 and claimed with an empty covered list');
  // Statement upload, duplicate, covered.
  // Distinct from the pending capture's purchases so the later same-day repeat has exactly one earlier candidate.
  const statement = csv([purchase({ 1: '20260901', 2: 'Synthetic shop S1' }), purchase({ 1: '20260902', 2: 'Synthetic shop S2' })]);
  const metadata = { accountId, jobId, kind: 'statement', start: '2026-09-01', end: '2026-09-30', statementMonth: '2026-09', statementTotal: '2400' };
  assert.equal((await call('collector/upload', { method: 'POST', token, body: statement, type: 'application/json', query: metadata })).status, 415);
  const first = await call('collector/upload', { method: 'POST', token, body: statement, type: 'text/csv', query: metadata }); assert.equal(first.status, 200, JSON.stringify(first)); assert.equal(first.data.duplicateFile, false);
  const again = await call('collector/upload', { method: 'POST', token, body: statement, type: 'text/csv', query: metadata }); assert.equal(again.data.id, first.data.id); assert.equal(again.data.duplicateFile, true);
  assert.equal((await call('collector/upload', { method: 'POST', token, body: statement, type: 'text/csv', query: { ...metadata, statementTotal: '2401' } })).status, 400);
  assert.equal((await call('collector/upload', { method: 'POST', token, body: statement, type: 'text/csv', query: { ...metadata, start: '2026-10-01', end: '2026-10-31', statementMonth: '2026-10' } })).status, 409);
  const stored = await FinanceImport.findById(first.data.id).lean(); assert.equal(stored.provider, 'aplus'); assert.equal(stored.period.statementMonth, '2026-09'); assert.equal(stored.reconciliation.version, 2); assert.equal(String(stored.collectorId), collector.data.id);
  assert.equal(sha(await readFile(path.join(process.env.OMF_DATA_DIR, 'imports', stored.hash.slice(0, 2), stored.hash + '.csv'))), sha(statement));
  assert.equal((await call('collector/status', { method: 'POST', token, body: { accountId, jobId, state: 'complete', message: '確定明細 1件・未請求 0件を保存' } })).status, 200);
  const second = await call('accounts/' + accountId + '/sync', { method: 'POST' }); assert.equal(second.status, 200); const jobId2 = second.data.account.jobId; assert.notEqual(jobId2, jobId);
  const claimed2 = await call('collector/claim', { method: 'POST', token, body: {} }); assert.deepEqual(claimed2.data.covered, { statements: ['2026-09'], notices: [] }); assert.equal(claimed2.data.account.jobId, jobId2);
  pass('a statement CSV uploads once with its metadata, re-uploads as the same import, is archived byte-exact, and the next claim lists it as covered');
  // Pending JSON through the collector route, with the pending manifest page count forwarded, then the matching final.
  // An unbilled capture taken after the September statement is finalized bills from 2026-10 on (first payment month 26/10).
  const unbilled = [{ merchant: 'Synthetic shop', amount: 1200, date: '2026-09-05', month: '26/10' }, { merchant: 'Synthetic shop', amount: 1200, date: '2026-09-05', month: '26/10' }];
  const capture = aplusCapture(unbilled), captureBytes = Buffer.from(JSON.stringify(capture, null, 2) + '\n');
  const pendingQuery = { accountId, jobId: jobId2, kind: 'pending', start: '2026-09-05', end: '2026-09-05', pageCount: '1' };
  assert.equal((await call('collector/upload', { method: 'POST', token, body: captureBytes, type: 'text/csv', query: pendingQuery })).status, 415);
  const pending = await call('collector/upload', { method: 'POST', token, body: captureBytes, type: 'application/json', query: pendingQuery }); assert.equal(pending.status, 200, JSON.stringify(pending));
  const pendingStored = await FinanceImport.findById(pending.data.id).lean(); assert.equal(pendingStored.sourceStatus, 'pending'); assert.equal(pendingStored.sourceFormat, 'json'); assert.equal(pendingStored.rowCount, 2);
  assert.equal(sha(await readFile(path.join(process.env.OMF_DATA_DIR, 'imports', pendingStored.hash.slice(0, 2), pendingStored.hash + '.csv'))), sha(captureBytes));
  const sameDay = await call('collector/upload', { method: 'POST', token, body: Buffer.from(JSON.stringify({ ...capture, capturedAt: '2026-08-10T06:00:00.000Z' }, null, 2) + '\n'), type: 'application/json', query: pendingQuery }); assert.equal(sameDay.status, 200, JSON.stringify(sameDay)); assert.notEqual(sameDay.data.id, pending.data.id);
  const repeated = await reviewImport(ownerId, sameDay.data.id); assert.ok(repeated.rows.every(r => r.sourceReference?.match === 'pending_purchase' && r.sourceReference.state === 'existing_import'), JSON.stringify(repeated.rows.map(r => r.state)));
  await assert.rejects(commitImport(ownerId, sameDay.data.id, { decisions: [{ line: 2, action: 'import', confirmNew: true }] }), e => e.statusCode === 409);
  const final = csv([purchase({ 1: '20260905' }), purchase({ 1: '20260905' })]);
  const finalized = await call('collector/upload', { method: 'POST', token, body: final, type: 'text/csv', query: { accountId, jobId: jobId2, kind: 'statement', start: '2026-10-01', end: '2026-10-31', statementMonth: '2026-10', statementTotal: '2400' } });
  assert.equal(finalized.status, 200, JSON.stringify(finalized)); assert.equal(finalized.data.duplicateFile, false);
  const settled = await reviewImport(ownerId, pending.data.id); assert.ok(settled.rows.every(r => r.settlement?.state === 'finalized'), JSON.stringify(settled.rows.map(r => r.settlement)));
  assert.equal(await mongoose.connection.db.collection('transactions').countDocuments(), 0);
  pass('a pending page capture uploads as JSON (CSV label refused), a same-day repeat is grouped without a new expense, and the matching final statement settles it');
  // T4: lease expiry refuses upload; a status after completion or after another authorized device reclaims is refused.
  await FinancialAccount.updateOne({ _id: accountId }, { $set: { jobLeaseUntil: new Date(Date.now() - 1000) } });
  assert.equal((await call('collector/upload', { method: 'POST', token, body: statement, type: 'text/csv', query: { ...metadata, jobId: jobId2 } })).status, 409);
  const other = await call('collectors', { method: 'POST', body: { name: 'Second PC', accountIds: [accountId] } }); const token2 = other.data.token;
  const reclaimed = await call('collector/claim', { method: 'POST', token: token2, body: {} }); assert.equal(reclaimed.data.account?.jobId, jobId2, 'an expired lease was not reclaimable');
  assert.equal((await call('collector/status', { method: 'POST', token, body: { accountId, jobId: jobId2, state: 'running', message: 'stale' } })).status, 409);
  assert.equal((await call('collector/status', { method: 'POST', token: token2, body: { accountId, jobId: jobId2, state: 'complete', message: 'done' } })).status, 200);
  assert.equal((await call('collector/status', { method: 'POST', token: token2, body: { accountId, jobId: jobId2, state: 'running', message: 'after completion' } })).status, 409);
  pass('an expired lease refuses uploads; a status from the old device after another device reclaims, or after completion, is refused');
  // L4b end to end: the exported upload() sends the retained bytes and the archive hash equals the manifest for both kinds.
  const { upload } = await import(u('collector/index.mjs'));
  assert.equal(typeof upload, 'function', 'collector/index.mjs exports no upload()');
  const third = await call('accounts/' + accountId + '/sync', { method: 'POST' }); const jobId3 = third.data.account.jobId; const claimed3 = await call('collector/claim', { method: 'POST', token, body: {} }); assert.equal(claimed3.data.account.jobId, jobId3);
  const account = { _id: accountId, ownerId, provider: 'aplus', primaryCard: '1234', cardIdentifiers: ['1234', '5678'], jobId: jobId3 }, config = { baseUrl: origin, token };
  const outbox = path.join(process.env.OMF_COLLECTOR_DIR, 'outbox', accountId);
  const item = async (name, bytes, manifest) => { const dir = path.join(outbox, name); await mkdir(dir, { recursive: true }); const filename = randomUUID(); await writeFile(path.join(dir, filename), bytes); const m = { accountId, primaryCard: '1234', jobId: jobId3, ownerId, origin, sha256: sha(bytes), filename, ...manifest }; await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2)); return { directory: dir, manifest: m }; };
  const octoberCsv = csv([purchase({ 1: '20261001', 3: '700', 7: '700' })]);
  const statementItem = await item(jobId3 + '-2026-10', octoberCsv, { kind: 'statement', provider: 'aplus', sourceFormat: 'csv', statementMonth: '2026-10', statementTotal: 700, start: '2026-10-01', end: '2026-10-31', rowCount: 1 });
  const laterCapture = Buffer.from(JSON.stringify(aplusCapture([{ merchant: 'Synthetic later', amount: 300, date: '2026-10-02', month: '26/11' }]), null, 2) + '\n');
  const pendingItem = await item(jobId3 + '-pending', laterCapture, { kind: 'pending', provider: 'aplus', sourceFormat: 'json', capturedAt: '2026-08-10T00:00:00.000Z', pageCount: 1, rowCount: 1, start: '2026-10-02', end: '2026-10-02' });
  for (const [it, bytes] of [[statementItem, octoberCsv], [pendingItem, laterCapture]]) {
    const result = await upload(config, account, it, null); assert.equal(result.duplicateFile, false, JSON.stringify(result));
    const batch = await FinanceImport.findById(result.id).lean(); assert.equal(batch.hash, it.manifest.sha256);
    assert.equal(sha(await readFile(path.join(process.env.OMF_DATA_DIR, 'imports', batch.hash.slice(0, 2), batch.hash + '.csv'))), it.manifest.sha256);
    assert.equal(sha(await readFile(path.join(it.directory, it.manifest.filename))), it.manifest.sha256);
    const acked = JSON.parse(await readFile(path.join(it.directory, 'manifest.json'), 'utf8')); assert.ok(acked.acknowledgedAt); assert.equal(acked.importId, result.id);
  }
  assert.equal((await FinanceImport.findOne({ hash: pendingItem.manifest.sha256 }).lean()).sourceFormat, 'json');
  pass('the exported upload() delivers a statement CSV and a pending JSON capture end to end; the archived bytes equal each manifest hash and each manifest is acknowledged');
  // F1: use the account's saved fiscal period on real collector uploads, including a rollover capture.
  await FinancialAccount.updateOne({_id:accountId},{$set:{accounting:{version:1,accountName:'Synthetic existing account'}}});
  const fiscal={start:'2026-11-01',end:'2027-10-31'};
  const setting=await call('accounts/'+accountId+'/fiscal-period',{method:'PUT',body:fiscal});
  assert.equal(setting.status,200,JSON.stringify(setting));
  assert.equal((await FinancialAccount.findById(accountId).lean()).accounting.accountName,'Synthetic existing account');
  assert.deepEqual((await call('accounts')).data.accounts.find(a=>a._id===accountId).fiscalPeriod,fiscal);
  assert.equal((await call('accounts/'+accountId+'/fiscal-period',{method:'PUT',body:{start:'2026-02-30',end:fiscal.end}})).status,400);
  const rollover=csv([purchase({1:'20261031',2:'Synthetic previous fiscal year'}),purchase({1:'20261101',2:'Synthetic current fiscal year'})]);
  const rolloverQuery={accountId,jobId:jobId3,kind:'statement',statementMonth:'2026-11',statementTotal:'2400'};
  const imported=await call('collector/upload',{method:'POST',token,body:rollover,type:'text/csv',query:rolloverQuery});
  assert.equal(imported.status,200,JSON.stringify(imported));
  const fiscalBatch=await FinanceImport.findById(imported.data.id).lean();
  assert.deepEqual(fiscalBatch.period.fiscalPeriod,fiscal);
  assert.equal(fiscalBatch.rows[0].kind,'statement_review');assert.match(fiscalBatch.rows[0].sourceReviewReason,/会計期間外/);
  assert.equal(fiscalBatch.rows[1].kind,'expense');
  const boundaryCapture=Buffer.from(JSON.stringify(aplusCapture([{merchant:'Synthetic pending prior year',amount:500,date:'2026-10-31',month:'26/11'},{merchant:'Synthetic pending new year',amount:700,date:'2026-11-01',month:'26/12'}])));
  const boundary=await call('collector/upload',{method:'POST',token,body:boundaryCapture,type:'application/json',query:{accountId,jobId:jobId3,kind:'pending',fiscalStart:'2000-01-01',fiscalEnd:'2000-12-31'}});
  assert.equal(boundary.status,200,JSON.stringify(boundary));
  const boundaryBatch=await FinanceImport.findById(boundary.data.id).lean();assert.deepEqual(boundaryBatch.period.fiscalPeriod,fiscal);
  assert.deepEqual(boundaryBatch.rows.map(r=>r.kind),['statement_review','expense']);
  await call('accounts/'+accountId+'/fiscal-period',{method:'PUT',body:{start:'2027-11-01',end:'2028-10-31'}});
  const retryFiscal=await call('collector/upload',{method:'POST',token,body:rollover,type:'text/csv',query:rolloverQuery});
  assert.equal(retryFiscal.status,200,JSON.stringify(retryFiscal));assert.equal(retryFiscal.data.id,imported.data.id);assert.equal(retryFiscal.data.duplicateFile,true);
  await FinancialAccount.updateOne({_id:accountId},{$unset:{'accounting.fiscalPeriod':''}});
  const manualSeed=await call('accounts/'+accountId+'/imports',{method:'POST',body:csv([purchase({1:'20261102',2:'Synthetic owner-selected fiscal period'})]),type:'text/csv',query:{kind:'statement',statementMonth:'2026-12',statementTotal:'1200',fiscalStart:fiscal.start,fiscalEnd:fiscal.end}});
  assert.equal(manualSeed.status,200,JSON.stringify(manualSeed));
  const inherited=await call('collector/upload',{method:'POST',token,body:csv([purchase({1:'20261030',2:'Synthetic history period fallback'})]),type:'text/csv',query:{accountId,jobId:jobId3,kind:'statement',statementMonth:'2027-01',statementTotal:'1200'}});
  assert.equal(inherited.status,200,JSON.stringify(inherited));
  assert.equal((await FinanceImport.findById(inherited.data.id).lean()).rows[0].kind,'statement_review');
  const foreign=await FinancialAccount.create({ownerId:new mongoose.Types.ObjectId(),name:'Synthetic other owner',provider:'aplus',primaryCard:'9999',cardIdentifiers:['9999']});
  assert.equal((await call('accounts/'+foreign._id+'/fiscal-period',{method:'PUT',body:fiscal})).status,404);
  assert.equal((await FinancialAccount.findById(foreign._id).lean()).accounting,undefined);
  await FinancialAccount.updateOne({_id:accountId},{$set:{accounting:null}});
  assert.equal((await call('accounts/'+accountId+'/fiscal-period',{method:'PUT',body:fiscal})).status,200);
  assert.deepEqual((await FinancialAccount.findById(accountId).lean()).accounting.fiscalPeriod,fiscal);
  pass('collector applies saved fiscal period, retains rollover review rows, accepts crossing pending pages, ignores client overrides, retries old files idempotently and inherits the owner-selected history period');
  console.log(JSON.stringify({ pass: true, checks }));
} finally { (await import(u('server/services/tokenBlacklistService.ts'))).stopCleanup(); if (server) await new Promise(r => server.close(r)); await mongoose.disconnect(); await mongo.stop(); }
`;

export default {
  name: 'aplus-collector',
  covers: ['shared/aplus.mjs', 'shared/finance-pending.mjs', 'shared/card-import.mjs', 'collector/aplus.mjs', 'collector/aplus-verification.mjs', 'collector/browser.mjs', 'collector/index.mjs', 'collector/interaction.mjs', 'collector/package/stage.mjs', 'server/api/finance/[...path].ts', 'server/services/financeService.ts', 'server/services/financeCollectorConnectService.ts', 'server/services/financeCollectorSecurityService.ts', 'scripts/collector-security-integration.ts'],
  async run() {
    const started = Date.now();
    if (process.platform !== 'win32') return { pass: false, message: 'the Windows collector package legs (stage catalog) can only be exercised on Windows' };
    const legs = [];
    const leg = async (name, fn) => { const t = Date.now(); try { const detail = await fn(); legs.push({ name, ok: true, detail: detail || '', ms: Date.now() - t }); } catch (error) { legs.push({ name, ok: false, detail: String(error?.message || error).split('\n')[0].slice(0, 400), ms: Date.now() - t }); } };
    const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-aplus-fixture-'));
    process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector');
    const assert = (await import('node:assert/strict')).default;
    const { HEADERS, parseAplus } = await import(pathToFileURL(path.join(REPO_ROOT, 'shared', 'aplus.mjs')).href);
    const { parsePendingImport } = await import(pathToFileURL(path.join(REPO_ROOT, 'shared', 'finance-pending.mjs')).href);
    const { aplusCapture } = await import(pathToFileURL(path.join(REPO_ROOT, 'scripts', 'finance-pending-fixtures.mjs')).href);
    HEADERS_CACHE = HEADERS;
    try {
      // L1 — the retained September statement: every row kept, the three special rows classified, both totals reconciled.
      await leg('L1 real September CSV (65 rows, blank payment, refund, card-less deposit)', async () => {
        if (!existsSync(REAL_CSV) || !existsSync(REAL_CARDS)) throw new Error('NOT RUN: the private September CSV or its card list is absent (OMF_APLUS_REAL_CSV / OMF_APLUS_REAL_CARDS)');
        const bytes = await readFile(REAL_CSV); assert.equal(sha256(bytes), REAL_CSV_SHA256, 'September CSV sha256 differs from the recorded input');
        const cards = JSON.parse(await readFile(REAL_CARDS, 'utf8')).cards.map(c => /(\d{4})≫$/.exec(c)[1]);
        const parse = meta => parseAplus(bytes, cards, { kind: 'statement', statementMonth: '2026-09', statementTotal: 536390, ...meta });
        const result = parse({});
        assert.equal(result.rows.length, 65); assert.equal(result.parserVersion, 'aplus-jp-2');
        const at = line => result.rows.find(r => r.line === line);
        assert.equal(at(3).kind, 'statement_review'); assert.equal(at(3).paymentAmount, null); assert.equal(at(3).amount, 8039); assert.ok(at(3).sourceReviewReason);
        assert.equal(at(59).kind, 'credit_review'); assert.equal(at(59).paymentAmount, null); assert.equal(at(59).amount, -11590); assert.equal(at(59).separateRefund, true); assert.ok(!/別途返金済み/.test(at(59).sourceReviewReason), 'refund wording still asserts a separate refund');
        assert.equal(at(66).kind, 'credit_review'); assert.equal(at(66).cardIdentifier, null); assert.equal(at(66).purchaseDate, null); assert.equal(at(66).amount, -11590); assert.equal(at(66).paymentAmount, null);
        assert.deepEqual(result.reconciliation, { statementTotal: 536390, purchaseTotal: 524800, separateRefundTotal: null, sourceRefundTotal: 11590, accountAdjustmentTotal: -11590, verified: true, version: 2 });
        // 61 expense rows: lines 3/59/66 above plus one pre-existing review row (line 60, the unchanged purchase/payment difference rule).
        assert.deepEqual(result.rows.reduce((a, r) => (a[r.kind] = (a[r.kind] || 0) + 1, a), {}), { expense: 61, statement_review: 2, credit_review: 2 });
        assert.deepEqual(result.rows.filter(r => r.kind !== 'expense').map(r => r.line), [3, 59, 60, 66]); assert.match(at(60).sourceReviewReason, /支払金額の差/);
        assert.equal(new Set(result.rows.map(r => r.key)).size, 65);
        assert.equal(parse({ refundTotal: 11590 }).reconciliation.separateRefundTotal, 11590);
        assert.throws(() => parse({ refundTotal: 0 }), /返金/);
        assert.throws(() => parse({ statementTotal: 536391 }));
        return '65 rows, 61 expense, lines 3/59/66 review (+60 pre-existing), reconciliation 536390/524800/11590/-11590/null';
      });
      // L2 — the synthetic adjustment shapes (blank payment, partial payment, refund, card-less deposit).
      await leg('L2 synthetic adjustment rows', async () => {
        if (existsSync(SYNTHETIC_FILE)) { const recorded = JSON.parse(await readFile(SYNTHETIC_FILE, 'utf8')); assert.deepEqual(recorded.rows, SYNTHETIC.rows, 'embedded synthetic rows differ from the recorded input'); }
        const bytes = csvOf(SYNTHETIC.rows, HEADERS), result = parseAplus(bytes, SYNTHETIC.cardIdentifiers, { kind: 'statement', statementMonth: SYNTHETIC.statementMonth, statementTotal: SYNTHETIC.displayedPaymentTotal });
        assert.equal(result.rows.length, 5);
        assert.deepEqual(result.rows.map(r => r.kind), ['statement_review', 'statement_review', 'expense', 'credit_review', 'credit_review']);
        assert.deepEqual(result.rows.map(r => r.paymentAmount), [null, 180, 100, null, null]);
        assert.deepEqual(result.rows.map(r => r.amount), [30, 200, 100, -50, -50]);
        for (let i = 0; i < 5; i++) assert.deepEqual(Object.values(result.rows[i].raw), SYNTHETIC.rows[i]);
        assert.equal(result.rows[4].cardIdentifier, null); assert.equal(result.rows[4].purchaseDate, null);
        // purchaseTotal is the ご利用金 column sum (330 of purchases − 50 refund − 50 deposit), the same rule that gives September its 524800.
        assert.deepEqual(result.reconciliation, { statementTotal: 280, purchaseTotal: 230, separateRefundTotal: null, sourceRefundTotal: 50, accountAdjustmentTotal: -50, verified: true, version: 2 });
        assert.equal(result.rows.filter(r => r.amount > 0).reduce((n, r) => n + r.amount, 0), 330);
        assert.throws(() => parseAplus(bytes, ['1234'], { kind: 'statement', statementMonth: '2026-09', statementTotal: 280, refundTotal: 0 }));
        assert.equal(parseAplus(bytes, ['1234'], { kind: 'statement', statementMonth: '2026-09', statementTotal: 280, refundTotal: 50 }).reconciliation.separateRefundTotal, 50);
        return '5 rows kept, 1 expense, no fabricated payment';
      });
      // L3 — control: the parser at plan.revision and the current one agree on keys, fingerprints and kinds for the existing shapes.
      await leg('L3 old vs new parser on the existing test shapes (control)', async () => {
        const old = path.join(temp, 'old-parser'); await mkdir(old, { recursive: true });
        for (const file of ['aplus.mjs', 'amex.mjs']) await writeFile(path.join(old, file), (await execute('git', ['-C', REPO_ROOT, 'show', PLAN_REVISION + ':shared/' + file], { windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer' })).stdout);
        const previous = await import(pathToFileURL(path.join(old, 'aplus.mjs')).href);
        const metadata = { kind: 'statement', statementMonth: '2026-08', statementTotal: 1200, fiscalStart: '2025-11-01', fiscalEnd: '2026-10-31' };
        const fee = ['', '', '年会費', '500', '', '', '', '500', ''], refund = purchase({ 1: '20251001', 2: '返金店舗', 3: '-100', 6: '', 7: '', 8: '返品 別途返金済み' });
        const shapes = [[[purchase()], {}], [[fee, refund], { statementTotal: 500, refundTotal: 100 }], [[purchase({ 5: '3', 7: '400' })], { statementTotal: 400 }], [[purchase(), purchase(), purchase({ 2: 'Other shop' })], { statementTotal: 3600 }], [[purchase({ 1: '20251031' })], {}]];
        let compared = 0;
        for (const [rows, meta] of shapes) {
          const a = previous.parseAplus(csvOf(rows, previous.HEADERS), ['1234', '5678'], { ...metadata, ...meta }), b = parseAplus(csvOf(rows, HEADERS), ['1234', '5678'], { ...metadata, ...meta });
          assert.deepEqual(a.rows.map(r => [r.key, r.fingerprint, r.kind, r.amount, r.paymentAmount]), b.rows.map(r => [r.key, r.fingerprint, r.kind, r.amount, r.paymentAmount])); compared += a.rows.length;
        }
        return compared + ' rows identical in key/fingerprint/kind/amount/paymentAmount';
      });
      // L4 — services and the real route on an owned ephemeral MongoDB, plus L4b end to end.
      await leg('L4 route and services on memory Mongo (collector/claim/sync/upload/pending/finalize/T4/L4b end-to-end)', async () => {
        // Inside the tree (gitignored .cache) so its bare imports resolve like the project's own scripts; removed afterwards.
        const cache = path.join(REPO_ROOT, '.cache'); await mkdir(cache, { recursive: true });
        const harness = path.join(cache, `aplus-l4-harness-${process.pid}.mts`); await writeFile(harness, L4_HARNESS, { flag: 'wx' });
        let result;
        try { result = await runChild(['--import', 'tsx', harness, REPO_ROOT], { env: { ...process.env, MONGO_URI: '', MONGODB_URI: '' } }); } finally { await unlink(harness).catch(() => {}); }
        const ok = result.code === 0 && result.receipt?.pass === true && result.receipt.checks === result.passes.length && !result.reds.length;
        if (!ok) throw new Error(`RED (exit ${result.killed ? 'timeout' : result.code}, ${result.passes.length} green): ${(result.reds[0] || result.tail).replace(/\s+/g, ' ').slice(-700)}`);
        return result.passes.length + ' legs green in ' + Math.round(result.ms / 1000) + 's';
      });
      // L4b — transport against an HTTP stub: exact bytes and the manifest-derived content type.
      await leg('L4b upload() transport: JSON for pending, text/csv for statements, Amex request byte-identical', async () => {
        const index = await import(pathToFileURL(path.join(REPO_ROOT, 'collector', 'index.mjs')).href);
        assert.equal(typeof index.upload, 'function', 'collector/index.mjs exports no upload()');
        const requests = [];
        const stub = http.createServer((req, res) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { requests.push({ url: req.url, type: req.headers['content-type'], body: Buffer.concat(chunks) }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'f'.repeat(24), rowCount: 1, duplicateFile: false })); }); });
        await new Promise(r => stub.listen(0, '127.0.0.1', r));
        try {
          const config = { baseUrl: 'http://127.0.0.1:' + stub.address().port, token: 'omfc_' + 'a'.repeat(64) };
          const outbox = path.join(temp, 'l4b', ACCOUNT._id);
          const item = async (name, bytes, manifest) => { const dir = path.join(outbox, name); await mkdir(dir, { recursive: true }); const filename = randomUUID(); await writeFile(path.join(dir, filename), bytes); const m = { accountId: ACCOUNT._id, primaryCard: '1234', jobId: ACCOUNT.jobId, sha256: sha256(bytes), filename, ...manifest }; await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(m)); return { directory: dir, manifest: m }; };
          const captureBytes = Buffer.from(JSON.stringify(aplusCapture(), null, 2) + '\n'), statementBytes = csvOf([purchase()], HEADERS), amexBytes = Buffer.from('amex,bytes\r\n1,2\r\n');
          const pendingItem = await item(ACCOUNT.jobId + '-pending', captureBytes, { kind: 'pending', provider: 'aplus', sourceFormat: 'json', pageCount: 2, rowCount: 2, start: '2026-08-01', end: '2026-08-01' });
          const statementItem = await item(ACCOUNT.jobId + '-2026-08', statementBytes, { kind: 'statement', provider: 'aplus', sourceFormat: 'csv', statementMonth: '2026-08', statementTotal: 1200, refundTotal: 0, start: '2026-08-01', end: '2026-08-31' });
          const amexItem = await item(randomUUID(), amexBytes, { kind: 'statement', start: '2026-07-19', end: '2026-08-18', pageCount: 1 });
          for (const it of [pendingItem, statementItem, amexItem]) await index.upload(config, ACCOUNT, it, null);
          const [p, s, a] = requests;
          assert.equal(p.type, 'application/json'); assert.equal(sha256(p.body), pendingItem.manifest.sha256); const pq = Object.fromEntries(new URL(p.url, config.baseUrl).searchParams); assert.equal(pq.kind, 'pending'); assert.equal(pq.pageCount, '2'); assert.equal(pq.accountId, ACCOUNT._id); assert.equal(pq.jobId, ACCOUNT.jobId);
          assert.equal(s.type, 'text/csv'); assert.equal(sha256(s.body), statementItem.manifest.sha256); const sq = Object.fromEntries(new URL(s.url, config.baseUrl).searchParams); assert.equal(sq.kind, 'statement'); assert.equal(sq.statementMonth, '2026-08'); assert.equal(sq.statementTotal, '1200'); assert.equal(sq.refundTotal, '0'); assert.equal(sq.start, '2026-08-01'); assert.equal(sq.end, '2026-08-31'); assert.equal(sq.pageCount, undefined);
          assert.equal(a.type, 'text/csv'); assert.ok(a.body.equals(amexBytes)); assert.equal(new URL(a.url, config.baseUrl).search, '?' + new URLSearchParams({ accountId: ACCOUNT._id, jobId: ACCOUNT.jobId, kind: 'statement', start: '2026-07-19', end: '2026-08-18', pageCount: '1' }).toString());
          for (const it of [pendingItem, statementItem, amexItem]) assert.ok(JSON.parse(await readFile(path.join(it.directory, 'manifest.json'), 'utf8')).acknowledgedAt);
          return '3 requests: pending application/json + pageCount preserved, statement text/csv + metadata, Amex query unchanged';
        } finally { await new Promise(r => stub.close(r)); }
      });
      // L5 — the state machine on the fake page.
      const aplus = await import(pathToFileURL(path.join(REPO_ROOT, 'collector', 'aplus.mjs')).href).catch(error => { throw Object.assign(new Error('collector/aplus.mjs missing or broken: ' + (error?.message || error)), { load: true }); }).catch(error => error);
      const verification = await import(pathToFileURL(path.join(REPO_ROOT, 'collector', 'aplus-verification.mjs')).href).catch(error => error);
      const dirFor = name => path.join(temp, 'l5', name);
      const run = async (name, ui, { account = ACCOUNT, covered = [], jobId = account.jobId, codeSource = null, credentials = { username: 'synthetic', password: 'synthetic' }, module = aplus, statuses = [] } = {}) => {
        if (module instanceof Error) throw module;
        const directory = dirFor(name); await mkdir(directory, { recursive: true });
        const status = async (state, text) => { statuses.push([state, text]); };
        const result = await module.collectAplusFromPage(null, null, { ...account, jobId }, credentials, directory, status, { ui, covered, codeSource, jobId, now: ui.now, wait: ui.wait, origin: ORIGIN, pollMs: 1000 });
        return { result, directory, statuses, outbox: path.join(directory, 'outbox', account._id) };
      };
      await leg('L5a two missing months + pending → three folders newest first, manifests wx', async () => {
        const ui = fakeUi(), { result, outbox, statuses } = await run('a', ui, { covered: ['2026-07'] });
        assert.deepEqual(result.items.map(i => i.manifest.statementMonth), ['2026-09', '2026-08']);
        assert.deepEqual((await readdir(outbox)).sort(), [ACCOUNT.jobId + '-2026-08', ACCOUNT.jobId + '-2026-09', ACCOUNT.jobId + '-pending'].sort());
        for (const it of result.items) { assert.equal(it.manifest.kind, 'statement'); assert.equal(it.manifest.sourceFormat, 'csv'); assert.equal(it.manifest.provider, 'aplus'); assert.equal(it.manifest.ownerId, ACCOUNT.ownerId); assert.equal(it.manifest.origin, ORIGIN); assert.ok(GUID.test(it.manifest.filename)); assert.equal(sha256(await readFile(path.join(it.directory, it.manifest.filename))), it.manifest.sha256); assert.ok(await exists(path.join(it.directory, 'attempt.json'))); await assert.rejects(writeFile(path.join(it.directory, 'manifest.json'), 'x', { flag: 'wx' }), e => e.code === 'EEXIST'); }
        assert.equal(result.items[0].manifest.statementTotal, 2400); assert.equal(result.items[1].manifest.statementTotal, 1200);
        assert.equal(result.pending.manifest.kind, 'pending'); assert.equal(result.pending.manifest.sourceFormat, 'json'); assert.equal(result.pending.manifest.pageCount, 1); assert.equal(result.pending.manifest.rowCount, 2); assert.ok(GUID.test(result.pending.manifest.filename));
        const pendingBytes = await readFile(path.join(result.pending.directory, result.pending.manifest.filename)); assert.equal(sha256(pendingBytes), result.pending.manifest.sha256); assert.equal(parsePendingImport(pendingBytes, ACCOUNT, { kind: 'pending' }).rows.length, 2);
        assert.equal(result.nothing, false); assert.equal(result.failed, null);
        assert.deepEqual([ui.counts.login, ui.counts.save, ui.counts.csv, ui.counts.readPage], [1, 2, 2, 1]);
        assert.ok(statuses.every(([state]) => state === 'running'), JSON.stringify(statuses));
        return 'folders ' + ACCOUNT.jobId.slice(0, 8) + '-2026-09/-2026-08/-pending; 2 saves, 2 CSV clicks';
      });
      await leg('L5b download events lost, GUID file appears → directory arm, zero extra clicks', async () => {
        const ui = fakeUi({ options: ['2026/09'], download: 'lost' }), { result } = await run('b', ui);
        assert.equal(result.items.length, 1); assert.equal(ui.counts.csv, 1); assert.equal(ui.counts.save, 1); assert.equal(result.failed, null);
        return 'detected without events after ' + ((ui.clock.t - 1_800_000_000_000) / 1000) + 's virtual';
      });
      await leg('L5c nothing arrives in 600 s → failed, zero extra clicks, marker left, one verification notice', async () => {
        const ui = fakeUi({ options: ['2026/09'], download: 'none', verification: true }), { result, outbox, statuses } = await run('c', ui);
        assert.equal(result.items.length, 0); assert.equal(ui.counts.csv, 1); assert.equal(ui.counts.save, 1); assert.equal(ui.counts.code, 0);
        assert.match(result.failed || '', /ダウンロードが完了しませんでした/); assert.ok(await exists(path.join(outbox, ACCOUNT.jobId + '-2026-09', 'attempt.json'))); assert.equal(await exists(path.join(outbox, ACCOUNT.jobId + '-2026-09', 'manifest.json')), false);
        assert.equal(statuses.filter(([s]) => s === 'verification_required').length, 1); assert.equal(ui.counts.show, 1);
        const elapsed = (ui.clock.t - 1_800_000_000_000) / 1000; assert.ok(elapsed >= 600 && elapsed < 700, 'virtual seconds ' + elapsed);
        assert.equal(result.pending, null);
        return 'failed after ' + elapsed + 's virtual, marker kept';
      });
      await leg('L5d same jobId re-run with marker and no artifact → zero clicks, failed', async () => {
        const ui = fakeUi({ options: ['2026/09'] }), directory = dirFor('d'), marker = path.join(directory, 'outbox', ACCOUNT._id, ACCOUNT.jobId + '-2026-09');
        await mkdir(marker, { recursive: true }); await writeFile(path.join(marker, 'attempt.json'), JSON.stringify({ requestedAt: '2026-10-13T00:00:00.000Z' }));
        const { result } = await run('d', ui);
        assert.equal(ui.counts.csv, 0); assert.equal(ui.counts.save, 0); assert.match(result.failed || '', /ダウンロードが完了しませんでした/); assert.deepEqual(result.skipped, { month: '2026-09', reason: 'attempted' }); assert.equal(result.items.length, 0);
        return 'skipped 2026-09 (attempted), no click';
      });
      await leg('L5e same jobId with pending manifest → no second capture; new jobId same minute → capture runs', async () => {
        const first = fakeUi({ options: ['2026/09'] }), { result: r1, directory } = await run('e', first, { covered: ['2026-09'] }); assert.equal(first.counts.readPage, 1); assert.ok(r1.pending);
        const second = fakeUi({ options: ['2026/09'] }), { result: r2 } = await run('e', second, { covered: ['2026-09'] }); assert.equal(second.counts.readPage, 0); assert.equal(second.counts.openUnbilled, 0); assert.equal(r2.pending, null); assert.equal(r2.nothing, true); assert.equal(r2.failed, null);
        const third = fakeUi({ options: ['2026/09'] }), fresh = randomUUID(), { result: r3 } = await run('e', third, { covered: ['2026-09'], jobId: fresh }); assert.equal(third.counts.readPage, 1); assert.ok(r3.pending); assert.equal(path.basename(r3.pending.directory), fresh + '-pending');
        assert.equal((await readdir(path.join(directory, 'outbox', ACCOUNT._id))).length, 2);
        return 'resume: 0 reads; new job: 1 read, second pending folder';
      });
      await leg('L5f all months covered → pending still captured; pending refused → nothing written, failed', async () => {
        const ui = fakeUi(), { result } = await run('f1', ui, { covered: ['2026-09', '2026-08', '2026-07'] }); assert.equal(ui.counts.csv, 0); assert.ok(result.pending); assert.equal(result.nothing, false); assert.equal(result.items.length, 0);
        const bad = fakeUi({ pages: pendingPages(pendingItems(2), 2).map(p => ({ ...p, summary: '未請求のご利用金額\n\n未確定\n9,999円' })) }), { result: refused, outbox } = await run('f2', bad, { covered: ['2026-09', '2026-08', '2026-07'] });
        assert.equal(refused.pending, null); assert.match(refused.failed || '', /未請求明細の読み取りを確認できませんでした/); assert.equal(await exists(path.join(outbox, ACCOUNT.jobId + '-pending')), false);
        return 'covered → 0 CSV clicks, pending captured; refused capture leaves no folder';
      });
      await leg('L5l an offered month without a payment total is unavailable; pending capture continues', async () => {
        const ui = fakeUi({ options: ['2026/09'], totalText: '' }), { result } = await run('unavailable', ui);
        assert.deepEqual(result.unavailable, ['2026-09']); assert.equal(result.failed, null);
        assert.equal(ui.counts.csv, 0); assert.equal(ui.counts.save, 0); assert.ok(result.pending);
        return 'no CSV/SMS request for the unavailable month; the unbilled capture remains available';
      });
      await leg('L5g three-page pagination accepted; changed pageNumbers or wrong activePage on page 2 refused, nothing written', async () => {
        const ok = fakeUi({ options: ['2026/09'], pages: pendingPages(pendingItems(7), 3) }), { result } = await run('g1', ok, { covered: ['2026-09'] });
        assert.equal(result.pending.manifest.pageCount, 3); assert.equal(result.pending.manifest.rowCount, 7); assert.equal(ok.counts.goToPage, 2); assert.equal(ok.counts.readPage, 3);
        for (const [name, corrupt] of [['numbers', (n, page) => { if (n === 2) page.pageNumbers = ['1', '2', '3', '4']; }], ['active', (n, page) => { if (n === 2) page.activePage = '1'; }]]) {
          const bad = fakeUi({ options: ['2026/09'], pages: pendingPages(pendingItems(7), 3), corruptPage: corrupt }), directory = dirFor('g-' + name); await mkdir(directory, { recursive: true });
          await assert.rejects(aplus.collectAplusFromPage(null, null, ACCOUNT, CREDENTIALS, directory, async () => {}, { ui: bad, covered: ['2026-09'], now: bad.now, wait: bad.wait, origin: ORIGIN }), /pages changed/);
          assert.equal(await exists(path.join(directory, 'outbox', ACCOUNT._id, ACCOUNT.jobId + '-pending')), false);
        }
        return '3 pages → 7 rows; two corruptions refused';
      });
      await leg('L5h .crdownload sibling → keeps waiting, then detected', async () => {
        const ui = fakeUi({ options: ['2026/09'], download: 'crdownload' }), { result } = await run('h', ui);
        assert.equal(result.items.length, 1); assert.equal(ui.counts.csv, 1); assert.equal(result.failed, null);
        return 'completed after the rename';
      });
      await leg('L5i error page → ログインに戻る once, then login proceeds', async () => {
        const ui = fakeUi({ start: 'error_page', errorPageOnce: true, options: ['2026/09'] }), { result } = await run('i', ui);
        assert.equal(ui.counts.returnToLogin, 1); assert.equal(ui.counts.login, 1); assert.equal(result.items.length, 1);
        const stuck = fakeUi({ start: 'error_page', errorPageOnce: false, options: ['2026/09'] });
        await assert.rejects(run('i2', stuck), /attention|error/i); assert.equal(stuck.counts.returnToLogin, 1);
        return 'one return, one login; a repeated error page is not retried';
      });
      await leg('L5j matchStatementCode: accepts once; refuses payment OTP, 301 s old, duplicate, other sender', async () => {
        if (verification instanceof Error) throw verification;
        const { matchStatementCode, STATEMENT_CODE_SENDER } = verification;
        const requestedAt = 1_800_000_000_000, now = requestedAt + 60_000;
        const message = (changes = {}) => ({ id: 'm1', sender: STATEMENT_CODE_SENDER, receivedAt: requestedAt + 30_000, body: '【My APLUS】ご利用明細書ダウンロードの認証コードは 4821 です。有効期限は5分です。', ...changes });
        assert.deepEqual(matchStatementCode([message()], { requestedAt, now }), { id: 'm1', code: '4821' });
        assert.equal(matchStatementCode([message()], { requestedAt, now, claimed: ['m1'] }), null);
        assert.equal(matchStatementCode([message({ body: 'お支払いの認証コードは 482113 です。' })], { requestedAt, now }), null);
        assert.equal(matchStatementCode([message({ receivedAt: requestedAt + 30_000 })], { requestedAt, now: requestedAt + 30_000 + 301_000 }), null);
        assert.equal(matchStatementCode([message({ receivedAt: requestedAt - 1000 })], { requestedAt, now }), null);
        assert.equal(matchStatementCode([message(), message({ id: 'm2', body: '【My APLUS】ご利用明細書ダウンロードの認証コードは 9911 です。' })], { requestedAt, now }), null);
        assert.equal(matchStatementCode([message({ sender: '0120000000' })], { requestedAt, now }), null);
        assert.equal(matchStatementCode([], { requestedAt, now }), null);
        return 'one code accepted; six refusals';
      });
      await leg('L5k verification with a bound code source → one code typed, download completes', async () => {
        const ui = fakeUi({ options: ['2026/09'], verification: true }), claims = [];
        const codeSource = { async messages({ requestedAt }) { return [{ id: 'sms-1', sender: '0570008789', receivedAt: requestedAt + 5000, body: 'ご利用明細書ダウンロードの認証コードは 1357 です。' }]; }, async claim(id) { claims.push(id); } };
        const { result, statuses } = await run('k', ui, { codeSource });
        assert.equal(result.items.length, 1); assert.equal(ui.counts.code, 1); assert.equal(ui.counts.lastCode, '1357'); assert.deepEqual(claims, ['sms-1']); assert.equal(ui.counts.csv, 1);
        assert.equal(statuses.filter(([s]) => s === 'verification_required').length, 1);
        return 'code 1357 typed once, item collected';
      });
      // L5m — collector mutants at their named boundaries.
      await leg('L5m five collector guards: real refuses; each mutant loses exactly its own predicate; downstream parsers still refuse', async () => {
        if (aplus instanceof Error) throw aplus;
        const snapshot = { month: '2026/09', total: '1,200円', account: '…-1234', options: ['2026/09'] }, account = { primaryCard: '1234', cardIdentifiers: ['1234'] };
        assert.equal(aplus.verifyAplusStatement(snapshot, '2026-09', account), 1200);
        assert.throws(() => aplus.verifyAplusStatement({ ...snapshot, account: '…-2432' }, '2026-09', account), /account/);
        assert.throws(() => aplus.verifyAplusStatement({ ...snapshot, month: '2026/08' }, '2026-09', account), /month/);
        assert.throws(() => aplus.verifyAplusStatement({ ...snapshot, total: '—' }, '2026-09', account), /total/);
        await withMutantModule('collector/aplus.mjs', 'account-label', async m => { assert.equal(m.verifyAplusStatement({ ...snapshot, account: '…-2432' }, '2026-09', account), 1200); assert.throws(() => m.verifyAplusStatement({ ...snapshot, month: '2026/08' }, '2026-09', account)); assert.throws(() => m.verifyAplusStatement({ ...snapshot, total: '—' }, '2026-09', account)); });
        await withMutantModule('collector/aplus.mjs', 'month', async m => { assert.equal(m.verifyAplusStatement({ ...snapshot, month: '2026/08' }, '2026-09', account), 1200); assert.throws(() => m.verifyAplusStatement({ ...snapshot, account: '…-2432' }, '2026-09', account)); assert.throws(() => m.verifyAplusStatement({ ...snapshot, total: '—' }, '2026-09', account)); });
        await withMutantModule('collector/aplus.mjs', 'total', async m => { const total = m.verifyAplusStatement({ ...snapshot, total: '—' }, '2026-09', account); assert.equal(typeof total, 'number'); assert.throws(() => parseAplus(csvOf([purchase()], HEADERS), ['1234'], { kind: 'statement', statementMonth: '2026-09', statementTotal: total }), /一致しません|整数/); assert.throws(() => m.verifyAplusStatement({ ...snapshot, account: '…-2432' }, '2026-09', account)); assert.throws(() => m.verifyAplusStatement({ ...snapshot, month: '2026/08' }, '2026-09', account)); });
        const corrupt = (n, page) => { if (n === 2) page.activePage = '1'; };
        const pagesUi = () => fakeUi({ pages: pendingPages(pendingItems(4), 2), corruptPage: corrupt });
        const okUi = fakeUi({ pages: pendingPages(pendingItems(4), 2) }); await okUi.openUnbilled(); const good = await aplus.captureUnbilled(okUi, { now: okUi.now }); assert.equal(parsePendingImport(good.bytes, ACCOUNT, { kind: 'pending' }).rows.length, 4);
        const badUi = pagesUi(); await badUi.openUnbilled(); await assert.rejects(aplus.captureUnbilled(badUi, { now: badUi.now }), /pages changed/);
        await withMutantModule('collector/aplus.mjs', 'page-identity', async m => { const ui = pagesUi(); await ui.openUnbilled(); const captured = await m.captureUnbilled(ui, { now: ui.now }); assert.equal(captured.source.rawPageFields[1].activePage, '1'); assert.throws(() => parsePendingImport(captured.bytes, ACCOUNT, { kind: 'pending' })); assert.throws(() => m.verifyAplusStatement({ ...snapshot, account: '…-2432' }, '2026-09', account)); });
        const markerDir = async name => { const directory = dirFor('m-' + name), folder = path.join(directory, 'outbox', ACCOUNT._id, ACCOUNT.jobId + '-2026-09'); await mkdir(folder, { recursive: true }); await writeFile(path.join(folder, 'attempt.json'), JSON.stringify({ requestedAt: '2026-10-13T00:00:00.000Z' })); return directory; };
        const realUi = fakeUi({ options: ['2026/09'] }), realDir = await markerDir('real');
        const real = await aplus.collectAplusFromPage(null, null, ACCOUNT, CREDENTIALS, realDir, async () => {}, { ui: realUi, now: realUi.now, wait: realUi.wait, origin: ORIGIN }); assert.deepEqual(real.skipped, { month: '2026-09', reason: 'attempted' }); assert.equal(realUi.counts.csv, 0);
        await withMutantModule('collector/aplus.mjs', 'attempt-marker', async m => { const ui = fakeUi({ options: ['2026/09'] }), directory = await markerDir('mutant'); await assert.rejects(m.collectAplusFromPage(null, null, ACCOUNT, CREDENTIALS, directory, async () => {}, { ui, now: ui.now, wait: ui.wait, origin: ORIGIN }), e => e.code === 'EEXIST'); assert.equal(ui.counts.csv, 0); assert.equal(ui.counts.selectMonth, 1); });
        let invalid = false; try { await withMutantModule('collector/aplus.mjs', 'no-such-marker', async () => {}); } catch (error) { invalid = /guard marker missing/.test(error.message); } assert.ok(invalid, 'a missing marker must be a harness fault');
        return 'account-label/month/total at verifyAplusStatement, page-identity past captureUnbilled (parser refuses), attempt-marker reaches the wx write (EEXIST)';
      });
      // L6 — the staged customer package carries and runs the adapter without an install.
      await leg('L6 staged tree without install: aplus adapter and parsers run from the staged copy; every relative import staged', async () => {
        const { stage } = await import(pathToFileURL(path.join(REPO_ROOT, 'collector', 'package', 'stage.mjs')).href);
        const into = path.join(temp, 'staged'); const { manifest } = await stage({ into, origin: 'https://omf.example', install: false, log: () => {} });
        for (const file of ['collector/aplus.mjs', 'collector/aplus-verification.mjs', 'shared/aplus.mjs', 'shared/finance-pending.mjs']) assert.ok(manifest.files[file], 'not staged: ' + file);
        const specifiers = [];
        for (const dir of ['collector', 'shared']) for (const name of (await readdir(path.join(into, dir))).filter(n => n.endsWith('.mjs'))) {
          const text = await readFile(path.join(into, dir, name), 'utf8');
          for (const m of text.matchAll(/from\s+'(\.[^']+)'/g)) { const target = path.resolve(into, dir, m[1]); specifiers.push(m[1]); assert.ok(existsSync(target), `${dir}/${name} imports ${m[1]} which is not staged`); }
        }
        const previousCwd = process.cwd(), previousNodePath = process.env.NODE_PATH; process.chdir(into); delete process.env.NODE_PATH;
        try {
          const stagedAplus = await import(pathToFileURL(path.join(into, 'collector', 'aplus.mjs')).href), stagedVerification = await import(pathToFileURL(path.join(into, 'collector', 'aplus-verification.mjs')).href);
          const stagedShared = await import(pathToFileURL(path.join(into, 'shared', 'aplus.mjs')).href), stagedPending = await import(pathToFileURL(path.join(into, 'shared', 'finance-pending.mjs')).href);
          assert.equal(typeof stagedVerification.matchStatementCode, 'function');
          assert.equal(stagedPending.parsePendingImport(Buffer.from(JSON.stringify(aplusCapture())), ACCOUNT, { kind: 'pending' }).rows.length, 2);
          assert.equal(stagedShared.parseAplus(csvOf(SYNTHETIC.rows, stagedShared.HEADERS), ['1234'], { kind: 'statement', statementMonth: '2026-09', statementTotal: 280 }).rows.length, 5);
          const ui = fakeUi(), directory = path.join(temp, 'l6-run'); await mkdir(directory, { recursive: true });
          const result = await stagedAplus.collectAplusFromPage(null, null, ACCOUNT, { username: 'synthetic', password: 'synthetic' }, directory, async () => {}, { ui, covered: ['2026-07'], now: ui.now, wait: ui.wait, origin: ORIGIN });
          assert.equal(result.items.length, 2); assert.ok(result.pending);
          let installed = 'collector/browser.mjs and index.mjs NOT RUN from the staged tree (OMF_TEST_STAGE_INSTALL unset: they need rebrowser-puppeteer-core)';
          if (process.env.OMF_TEST_STAGE_INSTALL === '1') {
            await execute('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', [], { cwd: path.join(into, 'collector'), windowsHide: true, shell: true, maxBuffer: 16 * 1024 * 1024 });
            const browser = await import(pathToFileURL(path.join(into, 'collector', 'browser.mjs')).href); assert.equal(typeof browser.collectAplusStatement, 'function');
            const index = await import(pathToFileURL(path.join(into, 'collector', 'index.mjs')).href); assert.equal(typeof index.runAplusJob, 'function'); installed = 'browser.mjs and index.mjs imported from the installed staged tree';
          }
          return `${Object.keys(manifest.files).length} files staged, ${specifiers.length} relative imports resolve; ${installed}`;
        } finally { process.chdir(previousCwd); if (previousNodePath !== undefined) process.env.NODE_PATH = previousNodePath; }
      });
      // L7 — pure helpers of the collector.
      await leg('L7 credentialEntryFor and uploadQuery', async () => {
        const index = await import(pathToFileURL(path.join(REPO_ROOT, 'collector', 'index.mjs')).href);
        assert.equal(typeof index.credentialEntryFor, 'function', 'credentialEntryFor not exported'); assert.equal(typeof index.uploadQuery, 'function', 'uploadQuery not exported');
        const a = { _id: 'a'.repeat(24), provider: 'aplus' }, b = { _id: 'b'.repeat(24), provider: 'aplus' }, amex = { _id: 'c'.repeat(24), provider: 'amex' };
        assert.equal(index.credentialEntryFor(a, ['aplus-' + a._id, 'aplus'], [a, b]), 'aplus-' + a._id);
        assert.equal(index.credentialEntryFor(a, ['aplus'], [a, amex]), 'aplus');
        assert.equal(index.credentialEntryFor(a, ['aplus'], [a, b]), null);
        assert.equal(index.credentialEntryFor(a, [], [a]), null);
        assert.equal(index.credentialEntryFor(amex, ['amex-' + amex._id], [amex]), 'amex-' + amex._id);
        const account = { _id: a._id, jobId: 'job-1' };
        assert.deepEqual(index.uploadQuery({ kind: 'statement', start: '2026-08-01', end: '2026-08-31', statementMonth: '2026-08', statementTotal: 1200 }, account), { accountId: a._id, jobId: 'job-1', kind: 'statement', start: '2026-08-01', end: '2026-08-31', statementMonth: '2026-08', statementTotal: '1200' });
        assert.deepEqual(index.uploadQuery({ kind: 'statement', start: '2026-08-01', end: '2026-08-31', statementMonth: '2026-08', statementTotal: 1200, refundTotal: 100 }, account), { accountId: a._id, jobId: 'job-1', kind: 'statement', start: '2026-08-01', end: '2026-08-31', statementMonth: '2026-08', statementTotal: '1200', refundTotal: '100' });
        assert.deepEqual(index.uploadQuery({ kind: 'pending', start: '2026-08-01', end: '2026-08-09', pageCount: 2 }, account), { accountId: a._id, jobId: 'job-1', kind: 'pending', start: '2026-08-01', end: '2026-08-09', pageCount: '2' });
        assert.deepEqual(Object.keys(index.uploadQuery({ kind: 'statement', start: '2026-07-19', end: '2026-08-18', pageCount: 12 }, account)), ['accountId', 'jobId', 'kind', 'start', 'end', 'pageCount']);
        return 'entries resolve per account, then the single legacy service entry, else none; query shapes exact';
      });
      // L8 — the job loop: drain, collect, upload, complete; a failed upload leaves the rest for the next claim.
      await leg('L8 runAplusJob: drain → collect → upload each → complete; upload failure resumes with only the rest', async () => {
        const index = await import(pathToFileURL(path.join(REPO_ROOT, 'collector', 'index.mjs')).href);
        assert.equal(typeof index.runAplusJob, 'function', 'runAplusJob not exported');
        const directory = path.join(temp, 'l8'), outbox = path.join(directory, 'outbox', ACCOUNT._id), old = path.join(outbox, 'older-job-2026-07'); await mkdir(old, { recursive: true });
        const oldManifest = { accountId: ACCOUNT._id, primaryCard: '1234', jobId: 'older-job', kind: 'statement', statementMonth: '2026-07', sourceFormat: 'csv', sha256: 'x', filename: randomUUID(), ownerId: ACCOUNT.ownerId, origin: ORIGIN };
        await writeFile(path.join(old, 'manifest.json'), JSON.stringify(oldManifest));
        const newDir = path.join(outbox, ACCOUNT.jobId + '-2026-09');
        const newManifest = { ...oldManifest, jobId: ACCOUNT.jobId, statementMonth: '2026-09', filename: randomUUID() };
        const uploads = [], statuses = [], coveredSeen = [];
        const deps = (fail = false) => ({
          directory,
          pending: async () => { const items = []; for (const name of await readdir(outbox)) { const m = JSON.parse(await readFile(path.join(outbox, name, 'manifest.json'), 'utf8').catch(() => 'null')); if (m && !m.acknowledgedAt) items.push({ directory: path.join(outbox, name), manifest: m }); } return items; },
          upload: async (config, account, item) => { uploads.push(item.manifest.statementMonth); if (fail && uploads.length === 2) throw new Error('synthetic upload failure'); await writeFile(path.join(item.directory, 'manifest.json'), JSON.stringify({ ...item.manifest, acknowledgedAt: 'now' })); return { id: 'f'.repeat(24) }; },
          collect: async (account, credentials, root, status, { covered, jobId }) => { coveredSeen.push([...covered].sort()); if (covered.includes('2026-09')) return { items: [], pending: null, nothing: true, unavailable: [], failed: null }; await mkdir(newDir, { recursive: true }); await writeFile(path.join(newDir, 'manifest.json'), JSON.stringify(newManifest)); return { items: [{ directory: newDir, manifest: newManifest }], pending: null, nothing: false, unavailable: [], failed: null }; },
          status: async (state, text) => { statuses.push([state, text]); }
        });
        const config = { baseUrl: ORIGIN, token: 'omfc_' + 'a'.repeat(64) };
        await assert.rejects(index.runAplusJob(ACCOUNT, config, null, { ...deps(true), covered: ['2026-08'] }), /synthetic upload failure/);
        assert.deepEqual(uploads, ['2026-07', '2026-09']); assert.deepEqual(coveredSeen[0], ['2026-07', '2026-08']); assert.equal(JSON.parse(await readFile(path.join(newDir, 'manifest.json'), 'utf8')).acknowledgedAt, undefined); assert.ok(!statuses.some(([s]) => s === 'complete'));
        uploads.length = 0; statuses.length = 0;
        const outcome = await index.runAplusJob(ACCOUNT, config, null, { ...deps(false), covered: ['2026-08'] });
        assert.deepEqual(uploads, ['2026-09']); assert.deepEqual(coveredSeen[1], ['2026-07', '2026-08', '2026-09']); assert.equal(statuses.at(-1)[0], 'complete'); assert.match(statuses.at(-1)[1], /確定明細 1件・未請求 0件を保存/); assert.ok(JSON.parse(await readFile(path.join(newDir, 'manifest.json'), 'utf8')).acknowledgedAt);
        assert.equal(outcome.drained.statement, 1); assert.equal(outcome.items, 0);
        uploads.length = 0; statuses.length = 0;
        const idle = await index.runAplusJob(ACCOUNT, config, null, { ...deps(false), covered: ['2026-08'] });
        assert.deepEqual(uploads, []); assert.equal(statuses.at(-1)[0], 'complete'); assert.equal(statuses.at(-1)[1], 'すべての確定明細を取得済み'); assert.equal(idle.nothing, true);
        return 'first call drained the old month then failed on the new one; the next call uploaded only the rest and completed; an idle job completes with nothing';
      });
      // Security mutants — scripts/collector-security-integration.ts (isolated Mongo; five binding mutants appended).
      await leg('security: collector-security-integration.ts (eight Connect mutants kept, five binding mutants, Aplus selection, Amex corpus)', async () => {
        const result = await runChild(['--import', 'tsx', path.join(REPO_ROOT, 'scripts', 'collector-security-integration.ts')], { env: { ...process.env } });
        const ok = result.code === 0 && result.receipt?.pass === true && result.receipt.checks === result.passes.length && !result.reds.length && result.receipt.securityMutants === 5 && result.receipt.connectMutants === 8;
        if (!ok) throw new Error(`RED (exit ${result.killed ? 'timeout' : result.code}, ${result.passes.length} green, receipt ${JSON.stringify(result.receipt)}): ${(result.reds[0] || result.tail).replace(/\s+/g, ' ').slice(-600)}`);
        return result.passes.length + ' legs green, receipt securityMutants=5 connectMutants=8 in ' + Math.round(result.ms / 1000) + 's';
      });
    } finally {
      await rm(temp, { recursive: true, force: true }).catch(() => {});
    }
    const red = legs.filter(l => !l.ok);
    const lines = legs.map(l => `${l.name}: ${l.ok ? 'ok' : 'RED'} (${Math.round(l.ms / 1000)}s)${l.detail ? ' — ' + l.detail : ''}`);
    return { pass: red.length === 0, message: `${red.length === 0 ? `${legs.length} legs green` : `${red.length} of ${legs.length} legs red`} in ${Math.round((Date.now() - started) / 1000)}s · ${lines.join(' · ')}` };
  }
};
