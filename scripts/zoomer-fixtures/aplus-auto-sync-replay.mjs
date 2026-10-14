// Replay for plan omf-auto-sync-build-20261014 (plan.replay): the owner's real Aplus account row, exported read-only into
// a private hub file, is loaded as production had it into an owned ephemeral MongoDB with a synthetic owner user and an
// explicitly synthetic collector row/token (the export holds no collector row). A virtual clock, installed before any
// project import, advances hourly for 21 JST days twice: first with the row exactly as exported (no autoSync: the
// scheduler must never queue), then with 自動取得 switched on and the plan's script (manual day, disabled day, offline
// days, duplicate upload, lease expiry) driven through runSyncSchedule and the real collector route handlers
// (claim/status/upload) mounted on h3 — never a collector process, bank, SMS or network. The replay's first upload is the
// recorded September CSV read from the hub evidence folder (sha256 pinned here; totals read from its validation file).
// Run ONLY through the hub verifier (never directly):
//   REPLAY_INPUT=<abs 8-replay-input.json> REPLAY_OUT=<abs 8-replay-result.json> node scripts/zoomer-verify.mjs --run-fixture aplus-auto-sync-replay.mjs --cwd <worktree>
// With REPLAY_INPUT unset (decided at load) it exports covers: [] and passes with the note "no replay input": it grants
// no coverage of the scheduler. Customer text never enters this file or the result: only ids, states, counts and days.
import { execFile } from 'node:child_process';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const timeoutMs = 900000;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const INPUT = process.env.REPLAY_INPUT || '';
const OUT = process.env.REPLAY_OUT || '';

const CHILD = String.raw`
// @ts-nocheck
// The virtual clock comes first: every later import (mongoose, jwt, the services, the route) sees it as Date. The class
// keeps the name Date: mongoose resolves a schema path's type by the constructor's name.
const RealDate = Date; const clock = { now: RealDate.now() };
globalThis.Date = class Date extends RealDate { constructor(...args) { if (args.length === 0) super(clock.now); else super(...args); } static now() { return clock.now; } };
const assert = (await import('node:assert/strict')).default;
const { createHash, randomBytes, randomUUID } = await import('node:crypto');
const { readFile, mkdtemp, writeFile, rm } = await import('node:fs/promises');
const http = (await import('node:http')).default;
const os = (await import('node:os')).default;
const path = (await import('node:path')).default;
const { pathToFileURL } = await import('node:url');
const ROOT = process.argv[2], INPUT = process.argv[3], OUT = process.argv[4], CSV_SHA256 = process.argv[5];
const u = p => pathToFileURL(path.join(ROOT, p)).href, sha256 = b => createHash('sha256').update(b).digest('hex');
const HOUR = 3600000, DAY = 24 * HOUR, JST = 9 * HOUR;
const exported = JSON.parse(await readFile(INPUT, 'utf8'));
const rows = Array.isArray(exported.rows) ? exported.rows : [];
const hubRoot = path.resolve(path.dirname(INPUT), '..', '..', '..');
const csvPath = path.resolve(hubRoot, exported.limits?.sourceCsv || ''), csvBytes = await readFile(csvPath);
assert.equal(sha256(csvBytes), CSV_SHA256, 'September CSV sha256 differs from the recorded input');
const validation = JSON.parse(await readFile(path.join(path.dirname(csvPath), '..', 'september-validation.json'), 'utf8'));
const statementTotal = validation.paymentTotal; assert.ok(Number.isSafeInteger(statementTotal), 'paymentTotal missing from the validation file');
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-auto-sync-replay-'));
process.env.OMF_DATA_DIR = path.join(temp, 'data'); process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector'); process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = randomBytes(32).toString('hex');
const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default, jwt = (await import('jsonwebtoken')).default;
const { createApp, toNodeListener } = await import('h3');
const mongo = await MongoMemoryServer.create({ instance: { dbName: 'aplus_auto_sync_replay_isolated' } });
process.env.MONGO_URI = mongo.getUri('aplus_auto_sync_replay_isolated');
let server = null, revision = 'unknown';
try { revision = (await (await import('node:util')).promisify((await import('node:child_process')).execFile)('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { windowsHide: true })).stdout.trim(); } catch { /* not a checkout */ }
const results = [], problems = [];
try {
  await mongoose.connect(process.env.MONGO_URI); assert.equal(mongoose.connection.name, 'aplus_auto_sync_replay_isolated');
  const User = (await import(u('server/models/User.ts'))).default;
  const { FinancialAccount, FinanceCollector, FinanceImport, initializeFinance } = await import(u('server/models/Finance.ts'));
  const route = (await import(u('server/api/finance/[...path].ts'))).default, auth = (await import(u('server/middleware/auth.ts'))).default;
  const { runSyncSchedule, jstDay } = await import(u('server/services/financeSyncScheduler.ts'));
  const { parseAplus } = await import(u('shared/aplus.mjs'));
  const { digest } = await import(u('shared/amex.mjs'));
  const { uploadQuery } = await import(u('collector/index.mjs'));
  await initializeFinance();
  const app = createApp(); app.use(auth); app.use(route);
  server = http.createServer(toNodeListener(app)); await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
  const call = async (route, { method = 'GET', token, body, type = 'application/json', query } = {}) => {
    const url = new URL('/api/finance/' + route, origin); if (query) url.search = new URLSearchParams(query).toString();
    const response = await fetch(url, { method, headers: { 'Content-Type': type, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; } return { status: response.status, data };
  };
  const toDate = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new RealDate(v) : v);
  const asStored = value => Array.isArray(value) ? value.map(asStored) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, asStored(v)])) : toDate(value);
  // The replay starts on the JST day after the export (00:00 JST) and advances one hour per tick.
  const captured = RealDate.parse(exported.capturedAt) || RealDate.now();
  const start = Math.floor((captured + JST) / DAY) * DAY - JST + DAY;
  let sends = { queueScheduledSync: 0, queueSync: 0, collectorRouteCalls: 0, archiveWrites: 0 };
  for (const row of rows) {
    const id = String(row._id), entry = { id, production: null, replay: null, sends: [], same: false, differences: [], intended: null };
    try {
      const { _id, ownerId, ...rest } = row;
      const accountId = new mongoose.Types.ObjectId(id), owner = new mongoose.Types.ObjectId(String(ownerId));
      await mongoose.connection.collection('financialaccounts').insertOne({ _id: accountId, ownerId: owner, ...asStored(rest) });
      await User.create({ _id: owner, email: 'replay-owner-' + id.slice(-6) + '@example.invalid', name: 'Synthetic replay owner', password: 'Synthetic-only-Strong-Password1!' });
      const token = 'omfc_' + randomBytes(32).toString('hex');
      const collector = await FinanceCollector.create({ ownerId: owner, name: 'Synthetic replay PC (not a production row)', tokenHash: digest(token), accountIds: [accountId] });
      const ownerJwt = jwt.sign({ userId: String(owner), email: 'replay-owner@example.invalid', type: 'access', jti: randomUUID() }, process.env.JWT_SECRET, { expiresIn: '120d' });
      const read = async () => mongoose.connection.collection('financialaccounts').findOne({ _id: accountId });
      const stored = await read();
      entry.production = { jobState: stored.jobState, lastSuccessAt: stored.lastSuccessAt ? new RealDate(stored.lastSuccessAt).toISOString() : null, autoSync: stored.autoSync ?? null, recordedScheduledJobs: exported.limits?.recordedScheduledJobs ?? null, existingImports: exported.limits?.existingImports ?? null, collectorRowsExported: (exported.companions?.financecollectors || []).length };
      const parsed = parseAplus(csvBytes, stored.cardIdentifiers, { kind: 'statement', statementMonth: '2026-09', statementTotal });
      const manifest = { kind: 'statement', sourceFormat: 'csv', statementMonth: '2026-09', statementTotal, start: parsed.period.start, end: parsed.period.end };
      const at = (base, day, hour) => base + (day - 1) * DAY + hour * HOUR;
      const tick = async (base, day, hour, log) => {
        clock.now = at(base, day, hour);
        const before = await read();
        const { queued } = await runSyncSchedule(new Date());
        sends.collectorRouteCalls += 0;
        if (queued.includes(id)) { sends.queueScheduledSync++; const after = await read(); log.push({ day, hour, event: 'scheduler-queued', jobId: after.jobId, lastQueuedDay: after.autoSync?.lastQueuedDay, jstDay: jstDay(new Date()) }); assert.equal(before.jobState !== 'queued', true); }
        return queued.includes(id);
      };
      const claim = async () => { sends.collectorRouteCalls++; const r = await call('collector/claim', { method: 'POST', token, body: {} }); assert.equal(r.status, 200, JSON.stringify(r)); return r.data.account; };
      const status = async (jobId, state, message) => { sends.collectorRouteCalls++; const r = await call('collector/status', { method: 'POST', token, body: { accountId: id, jobId, state, message } }); assert.equal(r.status, 200, JSON.stringify(r)); };
      const upload = async jobId => { sends.collectorRouteCalls++; const r = await call('collector/upload', { method: 'POST', token, body: csvBytes, type: 'text/csv', query: uploadQuery(manifest, { _id: id, jobId }) }); assert.equal(r.status, 200, JSON.stringify(r)); if (!r.data.duplicateFile) sends.archiveWrites++; return r.data; };
      const manualSync = async () => { const r = await call('accounts/' + id + '/sync', { method: 'POST', token: ownerJwt }); assert.equal(r.status, 200, JSON.stringify(r)); sends.queueSync++; return r.data.account; };
      const setAutoSync = async (enabled, hour) => { const r = await call('accounts/' + id + '/auto-sync', { method: 'PUT', token: ownerJwt, body: { enabled, hour } }); assert.equal(r.status, 200, JSON.stringify(r)); };
      // ── Pass A: the row exactly as exported (no autoSync). 21 days, the collector asking every day, nothing queued.
      const logA = []; let claimsA = 0, nullClaimsA = 0;
      for (let day = 1; day <= 21; day++) for (let hour = 0; hour < 24; hour++) { await tick(start, day, hour, logA); if (hour === 10) { claimsA++; if ((await claim()) === null) nullClaimsA++; } }
      const afterA = await read();
      entry.replay = { asExported: { days: 21, schedulerQueues: logA.length, collectorClaims: claimsA, emptyClaims: nullClaimsA, jobState: afterA.jobState, autoSync: afterA.autoSync ?? null, imports: await FinanceImport.countDocuments({ accountId }) } };
      if (logA.length) entry.differences.push({ pass: 'asExported', field: 'schedulerQueues', production: 0, replay: logA.length });
      if (afterA.jobState !== stored.jobState) entry.differences.push({ pass: 'asExported', field: 'jobState', production: stored.jobState, replay: afterA.jobState });
      entry.same = entry.differences.length === 0;
      // ── Pass B: 自動取得 switched on at 09:00 JST and the plan's 21-day script.
      const base = start + 21 * DAY, logB = [], perDay = {}, expectations = [];
      const expect = (condition, text) => { expectations.push({ ok: !!condition, text }); if (!condition) entry.differences.push({ pass: 'scripted', field: 'expectation', production: null, replay: text }); };
      let day10Job = null, duplicate = null, reclaimed = null;
      for (let day = 1; day <= 21; day++) {
        perDay[day] = { scheduler: 0, manual: 0, claims: [] };
        for (let hour = 0; hour < 24; hour++) {
          if (day === 1 && hour === 0) await setAutoSync(true, 9);
          if (day === 8 && hour === 0) await setAutoSync(false, 9);
          if (day === 9 && hour === 0) await setAutoSync(true, 9);
          if (day === 5 && hour === 8) { const queued = await manualSync(); perDay[day].manual++; logB.push({ day, hour, event: 'manual-queued', jobId: queued.jobId }); const got = await claim(); expect(got?.jobId === queued.jobId, 'day 5: the manual job is claimed at 08:00'); perDay[day].claims.push(got?.jobId || null); await status(got.jobId, 'complete', 'すべての確定明細を取得済み'); }
          if (await tick(base, day, hour, logB)) perDay[day].scheduler++;
          const offline = day >= 10 && day <= 12, disabled = day === 8, manualDay = day === 5;
          if (hour === 10 && !offline && !disabled && !manualDay) {
            const got = await claim(); perDay[day].claims.push(got?.jobId || null);
            if (day === 13) { expect(got?.jobId && got.jobId === day10Job, 'day 13: the job queued on day 10 (offline days) is the one claimed, same jobId'); }
            else expect(got?.jobId && got.jobId === logB.filter(e => e.day === day && e.event === 'scheduler-queued')[0]?.jobId, 'day ' + day + ': the claim returns the job the scheduler queued at 09:00');
            if (!got) continue;
            await status(got.jobId, 'running', '明細の取得を開始');
            if (day === 1) { const first = await upload(got.jobId); expect(first.duplicateFile === false, 'day 1: the September statement is accepted once'); await status(got.jobId, 'complete', '確定明細 1件・未請求 0件を保存'); }
            else if (day === 14) { duplicate = await upload(got.jobId); expect(duplicate.duplicateFile === true, 'day 14: re-uploading September answers duplicateFile:true'); await status(got.jobId, 'complete', 'すべての確定明細を取得済み'); }
            else if (day === 20) { await status(got.jobId, 'verification_required', 'My APLUSの認証コードをChromeで入力してください'); }
            else await status(got.jobId, 'complete', 'すべての確定明細を取得済み');
          }
          if (day === 20 && hour === 11) { const again = await claim(); reclaimed = again?.jobId || null; expect(again?.jobId && again.jobId === perDay[20].claims[0], 'day 20: after the lease expired the re-claim continues the same jobId'); if (again) await status(again.jobId, 'complete', 'すべての確定明細を取得済み'); }
          if (day === 10 && hour === 9) day10Job = (await read()).jobId;
        }
      }
      const importsB = await FinanceImport.countDocuments({ accountId }), afterB = await read();
      for (const day of Object.keys(perDay)) expect(perDay[day].scheduler <= 1, 'day ' + day + ': at most one scheduler queue');
      for (const day of [5, 8, 11, 12, 13]) expect(perDay[day].scheduler === 0, 'day ' + day + ': no scheduler queue (manual / disabled / offline carry-over / claimed carry-over)');
      for (const day of [1, 2, 3, 4, 6, 7, 9, 10, 14, 15, 16, 17, 18, 19, 20, 21]) expect(perDay[day].scheduler === 1, 'day ' + day + ': exactly one scheduler queue');
      expect(importsB === 1, 'imports stay at 1 across 21 days (' + importsB + ')');
      expect(afterB.jobState === 'complete', 'final jobState complete (' + afterB.jobState + ')');
      entry.replay.scripted = { days: 21, autoSync: afterB.autoSync ?? null, schedulerQueues: logB.filter(e => e.event === 'scheduler-queued').length, manualQueues: logB.filter(e => e.event === 'manual-queued').length, queuesByDay: Object.fromEntries(Object.entries(perDay).map(([d, v]) => [d, { scheduler: v.scheduler, manual: v.manual, claims: v.claims.length }])), imports: importsB, duplicateUploadDay14: duplicate?.duplicateFile ?? null, reclaimSameJobIdDay20: !!reclaimed && reclaimed === perDay[20].claims[0], finalJobState: afterB.jobState, expectations: expectations.filter(e => !e.ok).map(e => e.text), expectationsChecked: expectations.length, events: logB };
      entry.intended = 'INTENDED — plan omf-auto-sync-build-20261014 §2 A2/A4 and §4 Replay: with 自動取得 on, the scheduler queues one job per JST day; production had no scheduler and the exported row carries no autoSync, so the as-exported pass is identical (0 queues)';
      entry.sends = [{ kind: 'queueScheduledSync (FinancialAccount.findOneAndUpdate jobState queued, owned memory Mongo only)', count: sends.queueScheduledSync }, { kind: 'queueSync (manual button, owned memory Mongo only)', count: sends.queueSync }, { kind: 'collector api() calls replaced by direct route handler calls (claim/status/upload on loopback h3)', count: sends.collectorRouteCalls }, { kind: 'acceptImport archive writes', directory: process.env.OMF_DATA_DIR, count: sends.archiveWrites }];
      entry.same = entry.differences.filter(d => d.pass === 'asExported').length === 0 && expectations.every(e => e.ok);
    } catch (error) {
      entry.error = String(error?.stack || error?.message || error).replace(/\s+/g, ' ').slice(0, 600);
      problems.push(id + ': ' + entry.error);
    }
    results.push(entry);
  }
  const failed = results.filter(r => r.error).length, same = results.filter(r => r.same && !r.error).length, different = results.length - failed - same;
  const result = { capturedAt: new RealDate().toISOString(), input: INPUT, revision, entry: 'runSyncSchedule (server/services/financeSyncScheduler.ts) + collector route handlers claim/status/upload + owner routes sync/auto-sync (server/api/finance/[...path].ts) on h3', virtualClock: { start: new RealDate(start).toISOString(), hoursPerTick: 1, daysPerPass: 21, passes: ['asExported', 'scripted'] }, syntheticEnrollment: 'the collector row and token are synthetic (the export holds 0 collector rows); 自動取得 is switched on by the scripted pass only', exported: rows.length, loaded: results.length, replayed: results.length - failed, same, different, unexplainedDifferent: results.filter(r => !r.error && !r.same && !r.intended).length, intendedDifferent: results.filter(r => !r.error && r.replay?.scripted && r.intended && r.same).length, failed, sends, rows: results };
  if (OUT) await writeFile(OUT, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ __replay__: { pass: rows.length > 0 && failed === 0 && different === 0, message: rows.length + ' exported, ' + results.length + ' loaded, ' + (results.length - failed) + ' replayed on ' + revision.slice(0, 8) + ': as-exported pass identical for ' + same + ' row(s); scripted pass (synthetic enrollment, 自動取得 on) differs by design for ' + results.filter(r => r.replay?.scripted).length + ' row(s) with ' + results.reduce((n, r) => n + (r.replay?.scripted?.expectations?.length || 0), 0) + ' unmet expectations of ' + results.reduce((n, r) => n + (r.replay?.scripted?.expectationsChecked || 0), 0) + '; ' + failed + ' not run; sends ' + JSON.stringify(sends) + (OUT ? '; result ' + OUT : '') + (problems.length ? ' — ' + problems.join(' | ').slice(0, 900) : '') } }));
} finally {
  await import(u('server/services/tokenBlacklistService.ts')).then(m => (m.stopCleanup || m.default?.stopCleanup)?.()).catch(() => {});
  if (server) await new Promise(r => server.close(r));
  await mongoose.disconnect(); await mongo.stop();
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
`;

export default {
  name: 'aplus-auto-sync-replay',
  covers: INPUT ? ['server/services/financeSyncScheduler.ts', 'server/services/financeService.ts', 'server/api/finance/[...path].ts', 'server/models/Finance.ts', 'collector/index.mjs'] : [],
  async run() {
    if (!INPUT) return { pass: true, message: 'no replay input (REPLAY_INPUT unset): nothing exercised, no coverage claimed' };
    const started = Date.now();
    // Like the route fixture, run the TypeScript service imports from a .mts entry under the project's installed tsx.
    const cache = path.join(REPO_ROOT, '.cache'); await mkdir(cache, { recursive: true });
    const harness = path.join(cache, 'aplus-auto-sync-replay-' + process.pid + '.mts');
    await writeFile(harness, CHILD, { flag: 'wx' });
    try {
      const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', harness, REPO_ROOT, INPUT, OUT, '893e4ee8be29dcddab5c5a101519ec8e91f8ca30a49e101a32981399685d3b8b'], { cwd: REPO_ROOT, windowsHide: true, timeout: 840000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '' } }).catch(error => { throw new Error(String(error.stderr || error.stdout || error.message).slice(-2500)); });
      const line = stdout.split(/\r?\n/).find(l => l.startsWith('{') && l.includes('__replay__'));
      if (!line) throw new Error('the replay harness produced no result: ' + String(stderr || stdout).slice(-1500));
      const result = JSON.parse(line).__replay__;
      return { pass: result.pass, message: result.message + ' in ' + Math.round((Date.now() - started) / 1000) + 's' };
    } catch (error) { return { pass: false, message: 'Replay failed: ' + String(error?.message || error).replace(/\s+/g, ' ').slice(-2500) }; }
    finally { await unlink(harness).catch(() => {}); }
  }
};
