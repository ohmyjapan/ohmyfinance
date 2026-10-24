// Fixture for plan omf-workflow-daily-20261025 Phase B: opt-in daily web-bank collection on the existing durable BankJob queue
// (shared/finance-bank-schedule.mjs, server/services/financeBankScheduleService.ts, server/plugins/bankSchedule.ts, GET/PUT
// /api/finance-payments/bank/accounts/:id/schedule, components/intake/BankConnections.vue).
// Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-bank-schedule.mjs --cwd <this worktree>
// Evidence, stated exactly: synthetic only. Fictional owners, banks, labels, templates, rows, PCs and saved logins on an owned
// mongodb-memory-server (test commands enabled for fail points on the processes' own connections); Chrome is owned, headless and every
// request outside the owned app is aborted. No bank, network, credential, vault, model or production database is touched.
// Legs:
//   U  node --test test/finance-bank-schedule.test.mjs (the pure rules).
//   S  the real services and routes (h3) under tsx on the owned MongoDB with an injected clock (this file, --omf-bank-schedule-harness):
//      S1 five accounts daily · S2 JST midnight · S3 missed/offline days coalesce · S4 restart (fresh processes) · S5 concurrent ticks
//      and processes · S6 crash between writes (fail point) and a killed process mid-insert · S7 manual overlap and the interrupted-job
//      lane · S8 attention/failure/recovery through the real collector login code (fictional page-less UI and saved login) · S9 changed
//      settings, revision compare-and-set, closed period, a second PC · S10 owner/PC isolation · S11 default off, malformed input,
//      tolerance · S12 the claim-time check (stale enqueue after off/changed connection/another setting revision, a manual run between
//      read and insert, in-flight) and the save closing a still-queued earlier-revision run.
//   A  the built app (.output) with its real plugin timer: default off, five accounts queued once, claims, restart, two server processes.
//   C  owned headless Chrome on the built app: saved vs current state, opt-in save, last failure, attention, unsupported, stale save,
//      390/1440 px and dark.
//   R  existing integrations unchanged: bank collection (manual queue, CSV via collector, Chrome on BankConnections.vue) and payment
//      matching (card and bank callers of the changed model).
//   M  deliberately reintroduced defects in copies of server/ and shared/, each must fail its named S assertion.
// Fail-first: OMF_SCHEDULE_OUTPUT points legs A/C at another built app and OMF_SCHEDULE_SRC points leg S at another server/shared tree
// (the unmodified base build and source); OMF_SCHEDULE_ONLY selects legs.
// OMF_SCHEDULE_EVIDENCE (optional): a directory for leg logs and screenshots.
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 3000000;
const SELF = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(SELF), '..', '..');
const requireRoot = createRequire(path.join(root, 'package.json'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = v => createHash('sha256').update(v).digest('hex');
const HARNESS_FLAG = '--omf-bank-schedule-harness', TICK_FLAG = '--omf-bank-schedule-tick';
const COVERS = ['shared/finance-bank-schedule.mjs', 'shared/finance-bank-schedule.d.mts', 'server/services/financeBankScheduleService.ts', 'server/plugins/bankSchedule.ts', 'server/services/financeBankCollectionService.ts', 'server/models/FinancePaymentMatch.ts', 'server/api/finance-payments/[...path].ts', 'components/intake/BankConnections.vue', 'test/finance-bank-schedule.test.mjs', 'scripts/zoomer-fixtures/omf-bank-schedule.mjs'];
const BINARY = path.join(root, '..', 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
const EVIDENCE = process.env.OMF_SCHEDULE_EVIDENCE || '';
const ONLY = (process.env.OMF_SCHEDULE_ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
const OUTPUT_ROOT = process.env.OMF_SCHEDULE_OUTPUT ? path.resolve(process.env.OMF_SCHEDULE_OUTPUT) : root;
const SRC_ROOT = process.env.OMF_SCHEDULE_SRC ? path.resolve(process.env.OMF_SCHEDULE_SRC) : root;
// Fictional values shared by the legs.
const LABEL_R = '普通 1234567 カクウ商事（架空）', PP_HEAD = ['取引日', '摘要', '出金', '入金', '残高'];
const RAKUTEN = { provider: 'rakuten', variant: 'standard', accountLabel: LABEL_R, coverage: { from: '2025-11-01', to: null } };
const paypay = (templateId, i) => ({ provider: 'paypay', variant: 'standard', templateId, accountLabel: '普通 765432' + i + ' カクウ物産（架空）', coverage: { from: '2025-11-01', to: null } });
const NATIVE_CSV = Buffer.from('取引日,入出金(円),残高(円),入出金先内容\r\n20261001,-3300,996700,振込 カクウサプライ\r\n20261005,120000,1116700,振込 カクウ顧客\r\n');

// ════════════════════════════ S: the services and routes under tsx (child process) ════════════════════════════
async function harnessMain(SRC) {
  const u = p => pathToFileURL(path.join(SRC, p)).href, c = p => pathToFileURL(path.join(root, p)).href;
  const base = String(process.env.OMF_SCHEDULE_MONGO_URI || ''), dbName = String(process.env.OMF_SCHEDULE_DB || ''), appName = 'omf-sched-' + dbName;
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(base) || /:27017\/?$/.test(base) || !/^omf_sched_[a-z0-9_]+$/.test(dbName)) { console.log('SETUP refused: not an owned ephemeral database address'); process.exit(3); }
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-sched-harness-'));
  Object.assign(process.env, { MONGO_URI: base.replace(/\/?$/, '/') + dbName + '?appName=' + appName, JWT_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'test', OMF_DATA_DIR: path.join(temp, 'data'), OMF_COLLECTOR_DIR: path.join(temp, 'collector') });
  let m;
  try {
    const mongoose = (await import('mongoose')).default, jwt = (await import('jsonwebtoken')).default, h3 = await import('h3'), http = await import('node:http');
    m = { mongoose, jwt, h3, http, User: (await import(u('server/models/User.ts'))).default, Finance: await import(u('server/models/Finance.ts')), Pay: await import(u('server/models/FinancePaymentMatch.ts')),
      svc: await import(u('server/services/financeBankScheduleService.ts')), collection: await import(u('server/services/financeBankCollectionService.ts')), payments: (await import(u('server/api/finance-payments/[...path].ts'))).default, collector: (await import(u('server/api/finance-payments/collector/[...path].ts'))).default,
      auth: (await import(u('server/middleware/auth.ts'))).default, digest: (await import(u('shared/amex.mjs'))).digest, J: await import(u('shared/finance-bank-schedule.mjs')),
      bank: await import(c('collector/bank.mjs')), index: await import(c('collector/index.mjs')), rakuten: (await import(c('collector/banks/rakuten.mjs'))).default, paypayAdapter: (await import(c('collector/banks/paypay.mjs'))).default };
  } catch (e) { console.log('SETUP module unavailable: ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 300)); process.exit(3); }
  const { mongoose, jwt, h3, User, svc, J } = m, { FinanceCollector } = m.Finance, { BankAccount, BankJob, BankTemplate } = m.Pay;
  await mongoose.connect(process.env.MONGO_URI); assert.equal(mongoose.connection.name, dbName);
  await m.Pay.initializePaymentMatching(); await m.Finance.initializeFinance?.();
  const admin = mongoose.connection.db.admin(), failPoint = spec => admin.command(spec ? { configureFailPoint: 'failCommand', mode: spec.mode, data: { ...spec.data, appName: spec.appName || appName } } : { configureFailPoint: 'failCommand', mode: 'off' });
  const app = h3.createApp(); app.use(m.auth); app.use(h3.defineEventHandler(e => e.path.startsWith('/api/finance-payments/collector/') ? m.collector(e) : e.path.startsWith('/api/finance-payments/') ? m.payments(e) : undefined));
  const server = m.http.createServer(h3.toNodeListener(app)); await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
  const call = async (route, { method = 'GET', token, body, raw } = {}) => { const r = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(raw !== undefined ? { body: raw } : body === undefined ? {} : { body: JSON.stringify(body) }) }); const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; } return { status: r.status, data }; };
  const api = '/api/finance-payments/', capi = api + 'collector/', oid = v => new mongoose.Types.ObjectId(String(v));
  const ok = (r, label) => { assert.equal(r.status, 200, label + ' ' + JSON.stringify(r.data).slice(0, 400)); return r.data; };
  const owner = async tag => { const email = 'sched-' + tag + '@example.invalid', user = await User.create({ email, name: 'Synthetic owner ' + tag, password: 'Synthetic-only-Strong-Password1!' }), id = String(user._id); return { id, token: jwt.sign({ userId: id, email, type: 'access', jti: randomUUID() }, process.env.JWT_SECRET, { expiresIn: '3h' }) }; };
  const account = async (o, name, connection) => { const a = ok(await call(api + 'bank/accounts', { method: 'POST', token: o.token, body: { name, currency: 'JPY' } }), 'create ' + name).account; if (connection) ok(await call(api + 'bank/accounts/' + a.id + '/connection', { method: 'PUT', token: o.token, body: connection }), 'connect ' + name); return a.id; };
  const ppTemplate = async (o, name = 'Synthetic PayPay template') => ok(await call(api + 'bank/templates', { method: 'PUT', token: o.token, body: { name, headers: PP_HEAD, mapping: { date: '0', description: '1', outflow: '2', inflow: '3', balance: '4' }, amountSign: 'outflow-positive' } }), 'template').template.id;
  const device = async (o, ids) => { const token = 'omfc_' + randomBytes(32).toString('hex'), d = await FinanceCollector.create({ ownerId: o.id, name: 'Synthetic PC', tokenHash: m.digest(token), accountIds: [], bankAccountIds: ids.map(oid) }); return { id: String(d._id), token }; };
  const five = async (o, tag) => { const t = await ppTemplate(o), ids = [await account(o, tag + ' Rakuten', RAKUTEN)]; for (let i = 1; i <= 4; i++) ids.push(await account(o, tag + ' PayPay ' + i, paypay(t, i))); return ids; };
  const enable = (o, id, hour, revision = 0, extra = {}) => call(api + 'bank/accounts/' + id + '/schedule', { method: 'PUT', token: o.token, body: { enabled: true, hour, revision, ...extra } });
  const stateOf = async (o, id, now = new Date()) => (await svc.readBankSchedule(o.id, id, now)).status;
  const tick = now => svc.runBankSchedule(now);
  const jobsOf = (id, filter = {}) => BankJob.find({ bankAccountId: oid(id), ...filter }).sort({ requestedAt: 1, _id: 1 }).lean();
  const scheduled = id => jobsOf(id, { trigger: 'schedule' });
  const claim = async dev => ok(await call(capi + 'bank/claim', { method: 'POST', token: dev.token, body: {} }), 'claim');
  const status = (dev, jobId, state, message = '') => call(capi + 'bank/status', { method: 'POST', token: dev.token, body: { jobId, state, message } });
  const completeAll = async dev => { const done = []; for (let i = 0; i < 20; i++) { const r = await claim(dev); if (!r.job) break; ok(await status(dev, r.job.jobId, 'complete', 'fictional complete'), 'complete'); done.push(r.job.jobId); } return done; };
  const at = (day, h, mi = 0, s = 0) => new Date(J.jstInstant(day, h).getTime() + mi * 60000 + s * 1000);
  const D = J.nextDay(J.jstDay(new Date())), D1 = J.nextDay(D), D2 = J.nextDay(D1), D3 = J.nextDay(D2);
  const childTick = (iso, name) => { const child = spawn(process.execPath, ['--import', 'tsx', SELF, TICK_FLAG, SRC, iso], { cwd: root, windowsHide: true, env: { ...process.env, OMF_SCHEDULE_TICK_APP: name } }); let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; }); return { child, done: new Promise(r => child.on('exit', code => r({ code, out, result: (() => { try { return JSON.parse((out.match(/^TICK (.*)$/m) || [])[1]); } catch { return null; } })() }))) }; };
  let checks = 0, failed = 0; const only = (process.env.OMF_SCHEDULE_ONLY_S || '').split(',').filter(Boolean);
  // Each leg starts with every earlier leg's schedule switched off in the database, so a tick (which reads every opted-in account) and a
  // fail point act only on the leg's own accounts; assertions count the leg's own accounts.
  const quiet = () => BankAccount.updateMany({ 'schedule.enabled': true }, { $set: { 'schedule.enabled': false } });
  const queuedFor = async (r, ids) => r.queued.length ? BankJob.countDocuments({ jobId: { $in: r.queued }, bankAccountId: { $in: ids.map(oid) } }) : 0;
  const leg = async (name, fn) => { const key = name.split(' ')[0]; if (only.length && !only.includes(key)) return; try { await quiet(); await fn(); checks++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 900)); } };

  await leg('S1 five fictional accounts (楽天銀行 標準 native + four PayPay銀行 標準 mapped): nothing before 09:00 JST, one retrieval each at 09:00 frozen through that JST day, no second on repeated ticks, the next day once more', async () => {
    const o = await owner('s1'), ids = await five(o, 'S1'), dev = await device(o, ids);
    for (const id of ids) assert.equal(ok(await enable(o, id, 9), 'enable').schedule.revision, 1, 'sched:enable-revision');
    assert.equal(await queuedFor(await tick(at(D, 8, 59, 59)), ids), 0, 'sched:before-hour');
    for (const id of ids) assert.equal((await stateOf(o, id, at(D, 8, 59, 59))).state, 'waiting', 'sched:waiting');
    assert.equal(await queuedFor(await tick(at(D, 9)), ids), 5, 'sched:daily-five');
    for (const id of ids) {
      const jobs = await scheduled(id); assert.equal(jobs.length, 1, 'sched:daily-once ' + id);
      const j = jobs[0]; assert.deepEqual([j.kind, j.state, j.open, j.schedule.day, j.requestedAt.toISOString()], ['retrieve', 'queued', true, D, at(D, 9).toISOString()], 'sched:job-shape');
      assert.deepEqual(j.snapshot.coverage, { from: '2025-11-01', to: D }, 'sched:open-period-through-day'); assert.equal(j.snapshotHash, sha256(JSON.stringify(j.snapshot)), 'sched:frozen-hash');
      assert.notEqual(j.snapshot.templateId, null, 'sched:mapped');
    }
    for (const now of [at(D, 9), at(D, 12), at(D, 23, 59, 59)]) assert.equal(await queuedFor(await tick(now), ids), 0, 'sched:daily-once repeated tick ' + now.toISOString());
    const done = await completeAll(dev); assert.equal(done.length, 5, 'sched:claimable-five'); assert.equal((await claim(dev)).job, null);
    for (const id of ids) { const s = await stateOf(o, id, at(D, 10)); assert.equal(s.state, 'done-today', 'sched:done-today'); assert.equal(s.nextAt, at(D1, 9).toISOString(), 'sched:next-at'); }
    assert.equal(await queuedFor(await tick(at(D1, 8, 59)), ids), 0, 'sched:next-day-before-hour');
    assert.equal(await queuedFor(await tick(at(D1, 9)), ids), 5, 'sched:next-day');
    for (const id of ids) assert.deepEqual((await scheduled(id)).map(j => j.schedule.day), [D, D1], 'sched:next-day days');
    await completeAll(dev);
  });
  await leg('S2 JST midnight: 23:59:59.999 JST is still the old day; 00:00 JST (15:00 UTC of the previous UTC date) queues the new day', async () => {
    const o = await owner('s2'), id = await account(o, 'S2 Rakuten', RAKUTEN), dev = await device(o, [id]); ok(await enable(o, id, 0), 'enable');
    assert.equal(await queuedFor(await tick(at(D, 23, 59, 59)), [id]), 1); await completeAll(dev);
    const midnight = J.jstInstant(D1, 0);
    assert.equal(await queuedFor(await tick(new Date(midnight.getTime() - 1)), [id]), 0, 'sched:jst-midnight before');
    assert.equal(midnight.toISOString().slice(0, 10), D, 'the instant is still the previous UTC date');
    assert.equal(await queuedFor(await tick(midnight), [id]), 1, 'sched:jst-midnight new day');
    assert.deepEqual((await scheduled(id)).map(j => j.schedule.day), [D, D1], 'sched:jst-midnight days'); await completeAll(dev);
  });
  await leg('S3 missed and offline days coalesce: an unclaimed run waits before the hour, is replaced (never claimed, no login) when the next day is due, skipped days add nothing, the PC gets one job', async () => {
    const o = await owner('s3'), id = await account(o, 'S3 Rakuten', RAKUTEN), dev = await device(o, [id]); ok(await enable(o, id, 9), 'enable');
    await tick(at(D, 9)); const [j1] = await scheduled(id);
    assert.equal(await queuedFor(await tick(at(D1, 8)), [id]), 0); assert.equal((await stateOf(o, id, at(D1, 8))).state, 'queued', 'sched:offline-waits');
    const r = await tick(at(D1, 9)); assert.deepEqual([await queuedFor(r, [id]), r.superseded], [1, [j1.jobId]], 'sched:coalesce replace');
    const old = (await jobsOf(id, { jobId: j1.jobId }))[0]; assert.deepEqual([old.state, old.open, old.schedule.day, old.schedule.supersededDay, old.collectorId ?? null], ['superseded', false, undefined, D, null], 'sched:coalesce superseded');
    await tick(at(D3, 10));
    const all = await scheduled(id), live = all.filter(j => j.state !== 'superseded');
    assert.deepEqual([all.length, live.length, live[0].schedule.day, live[0].snapshot.coverage.to], [3, 1, D3, D3], 'sched:coalesce one through today');
    const got = await claim(dev); assert.equal(got.job.jobId, live[0].jobId, 'sched:coalesce claim'); assert.equal((await claim(dev)).job, null, 'sched:coalesce no backlog');
    ok(await status(dev, got.job.jobId, 'complete'), 'complete');
  });
  await leg('S4 restart: a fresh process ticking the same instant queues nothing more; a fresh process on the next day queues one per account', async () => {
    const o = await owner('s4'), ids = await five(o, 'S4'), dev = await device(o, ids); for (const id of ids) ok(await enable(o, id, 9), 'enable');
    const first = await childTick(at(D, 9).toISOString(), 'omf-sched-restart-1').done; assert.equal(first.result ? await queuedFor(first.result, ids) : NaN, 5, 'sched:restart first ' + first.out.slice(-300));
    const second = await childTick(at(D, 9, 0, 30).toISOString(), 'omf-sched-restart-2').done; assert.equal(second.result ? await queuedFor(second.result, ids) : NaN, 0, 'sched:restart same day ' + second.out.slice(-300));
    assert.equal(await queuedFor(await tick(at(D, 11)), ids), 0);
    for (const id of ids) assert.equal((await scheduled(id)).length, 1, 'sched:restart once');
    await completeAll(dev);
    const next = await childTick(at(D1, 9).toISOString(), 'omf-sched-restart-3').done; assert.equal(next.result ? await queuedFor(next.result, ids) : NaN, 5, 'sched:restart next day');
    await completeAll(dev);
  });
  await leg('S5 concurrency: six in-process ticks and two server processes at the same instant queue exactly one job per account', async () => {
    const o = await owner('s5'), ids = await five(o, 'S5'), dev = await device(o, ids); for (const id of ids) ok(await enable(o, id, 9), 'enable');
    const kids = [childTick(at(D, 9).toISOString(), 'omf-sched-par-1'), childTick(at(D, 9).toISOString(), 'omf-sched-par-2')];
    const local = await Promise.all(Array.from({ length: 6 }, () => tick(at(D, 9)))), remote = await Promise.all(kids.map(k => k.done));
    let total = 0; for (const r of [...local, ...remote.map(x => x.result)]) total += r ? await queuedFor(r, ids) : NaN;
    for (const id of ids) assert.equal((await scheduled(id)).length, 1, 'sched:concurrent once ' + id);
    assert.equal(total, 5, 'sched:concurrent total ' + JSON.stringify(remote.map(r => r.out.slice(-200))));
    await completeAll(dev);
  });
  await leg('S6 crash between writes: a failed insert after the replacement leaves no job and the next tick queues one; a process killed while its insert is held leaves at most one', async () => {
    const o = await owner('s6'), id = await account(o, 'S6 Rakuten', RAKUTEN); await device(o, [id]); ok(await enable(o, id, 9), 'enable');
    await tick(at(D, 9)); const [j1] = await scheduled(id);
    await failPoint({ mode: { times: 1 }, data: { failCommands: ['insert'], errorCode: 2 } });
    let r; try { r = await tick(at(D1, 9)); } finally { await failPoint(null); }
    assert.deepEqual([r.failed, await queuedFor(r, [id])], [1, 0], 'sched:crash-supersede-create tick');
    assert.equal((await jobsOf(id, { jobId: j1.jobId }))[0].state, 'superseded');
    assert.equal(await BankJob.countDocuments({ bankAccountId: oid(id), open: true }), 0, 'sched:crash-supersede-create nothing open');
    assert.equal(await queuedFor(await tick(at(D1, 9, 5)), [id]), 1, 'sched:crash-supersede-create recovered');
    const crashApp = 'omf-sched-crash-' + dbName;
    await failPoint({ appName: crashApp, mode: { times: 1 }, data: { failCommands: ['insert'], blockConnection: true, blockTimeMS: 4000 } });
    const before = (await scheduled(id)).find(j => j.schedule?.day === D1), kid = childTick(at(D2, 9).toISOString(), crashApp);
    let replaced = false; for (let i = 0; i < 200 && !replaced; i++) { replaced = (await jobsOf(id, { jobId: before.jobId }))[0].state === 'superseded'; if (!replaced) await pause(100); }
    await pause(600); kid.child.kill('SIGKILL'); const killed = await kid.done; await pause(5000); await failPoint(null);
    assert.ok(replaced, 'sched:crash-kill the killed process replaced the earlier run first');
    const landed = (await scheduled(id)).some(j => j.schedule?.day === D2);
    await tick(at(D2, 9, 1)); await tick(at(D2, 9, 2));
    const day2 = (await scheduled(id)).filter(j => j.schedule?.day === D2);
    assert.equal(day2.length, 1, 'sched:crash-kill exactly one (killed insert landed: ' + landed + ', exit ' + killed.code + ')');
    assert.equal(await BankJob.countDocuments({ bankAccountId: oid(id), open: true }), 1, 'sched:crash-kill one open');
    console.log('NOTE S6 killed-process insert landed: ' + landed);
  });
  await leg('S7 manual overlap and the interrupted lane: a manual request today is the run; a scheduled job blocks a manual request (409); an expired lease is resumed, never duplicated', async () => {
    const day0 = J.jstDay(new Date());
    const o = await owner('s7'), id = await account(o, 'S7 Rakuten', RAKUTEN), dev = await device(o, [id]); ok(await enable(o, id, 0), 'enable');
    const manual = ok(await call(api + 'bank/accounts/' + id + '/sync', { method: 'POST', token: o.token, body: {} }), 'manual').job;
    assert.equal(await queuedFor(await tick(new Date()), [id]), 0, 'sched:manual-first'); assert.equal((await stateOf(o, id)).state, 'queued');
    assert.equal((await claim(dev)).job.jobId, manual.jobId); ok(await status(dev, manual.jobId, 'complete'), 'complete');
    assert.equal(await queuedFor(await tick(new Date()), [id]), 0, 'sched:manual-counts'); assert.equal((await stateOf(o, id)).state, 'done-today', 'sched:manual-counts state');
    const o2 = await owner('s7b'), id2 = await account(o2, 'S7b Rakuten', RAKUTEN), dev2 = await device(o2, [id2]); ok(await enable(o2, id2, 0), 'enable');
    assert.equal(await queuedFor(await tick(new Date()), [id2]), 1);
    const refused = await call(api + 'bank/accounts/' + id2 + '/sync', { method: 'POST', token: o2.token, body: {} });
    assert.deepEqual([refused.status, refused.data?.data?.message], [409, '取得はすでに予約・実行中です。'], 'sched:manual-409'); assert.equal((await jobsOf(id2)).length, 1);
    const running = (await claim(dev2)).job; await BankJob.updateOne({ jobId: running.jobId }, { $set: { leaseUntil: new Date(Date.now() - 60000) } });
    const tomorrow = at(J.nextDay(day0), 1);
    assert.equal(await queuedFor(await tick(tomorrow), [id2]), 0, 'sched:interrupted-no-duplicate');
    const after = await jobsOf(id2); assert.deepEqual(after.map(j => [j.jobId, j.state, j.open]), [[running.jobId, 'running', true]], 'sched:interrupted-no-duplicate kept');
    assert.equal((await stateOf(o2, id2, tomorrow)).state, 'interrupted', 'sched:interrupted-state');
    assert.equal((await claim(dev2)).job.jobId, running.jobId, 'sched:resume-same-job'); ok(await status(dev2, running.jobId, 'complete'), 'complete');
    assert.equal(await queuedFor(await tick(tomorrow), [id2]), 1, 'sched:after-resume next run'); await completeAll(dev2);
  });
  await leg('S8 attention, failure and recovery through the collector code: a blocked saved login is never sent and the PC asks the person (attention); a failed run is shown, the day counts as run, the next day runs again without sending the unconfirmed login; 取得 recovers with exactly one submission; a reclaimed job never resubmits', async () => {
    const o = await owner('s8'), id = await account(o, 'S8 Rakuten', RAKUTEN), dev = await device(o, [id]); ok(await enable(o, id, 0), 'enable');
    const rakutenStd = m.rakuten.variants.standard, directory = await mkdtemp(path.join(os.tmpdir(), 'omf-sched-pc-')), config = { baseUrl: origin };
    const upload = async (_c, _a, item, _l, { base, route, query }) => { const bytes = await readFile(path.join(item.directory, item.manifest.filename)); const r = await fetch(origin + base + route + '?' + new URLSearchParams(query), { method: 'POST', headers: { Authorization: 'Bearer ' + dev.token, 'Content-Type': 'text/csv' }, body: bytes }); const data = await r.json().catch(() => null); if (r.status !== 200) throw Object.assign(new Error('upload ' + r.status), { status: r.status }); return data; };
    const runPc = async (claimed, ui, login, signal = null) => {
      const seen = [];
      const bankStatus = async (state, text) => { ok(await status(dev, claimed.job.jobId, state, text), 'status ' + state); if (state === 'verification_required') seen.push((await stateOf(o, id)).state); };
      let error = null;
      try { await m.index.runBankJob(claimed, config, null, { status: bankStatus, pending: async () => [], upload, directory, now: ui.now, signal, login, collect: (bound, job, dir, st) => m.bank.collectBankFromPage(null, null, rakutenStd, bound, job, dir, st, { ui, login, now: ui.now, wait: ui.wait, pollMs: 1000, loginTimeoutMs: 20000, signal }) }); }
      catch (e) { error = e; if (e?.name !== 'AbortError') ok(await status(dev, claimed.job.jobId, 'failed', 'Open the downloader setup screen on the connected PC for details'), 'failed as index.mjs:621'); }
      return { seen, error };
    };
    const today = J.jstDay(new Date()), tomorrow = at(J.nextDay(today), 0, 0, 1), dayAfter = at(J.nextDay(J.nextDay(today)), 0, 0, 1);
    assert.equal(await queuedFor(await tick(new Date()), [id]), 1);
    const first = await claim(dev), blocked = savedLogin('blocked'), ui1 = fictionalUi();
    const r1 = await runPc(first, ui1, blocked);
    assert.ok(r1.error, 'the person never signed in: the run ends'); assert.deepEqual(r1.seen, ['attention'], 'sched:attention-visible');
    assert.deepEqual([blocked.calls.open, ui1.calls.login], [0, 0], 'sched:no-credential');
    const shown = await stateOf(o, id); assert.deepEqual([shown.state, shown.lastFailure?.jobId], ['done-today', first.job.jobId], 'sched:failure-shown');
    assert.equal(await queuedFor(await tick(new Date()), [id]), 0, 'sched:once-per-day-after-failure');
    const manual = ok(await call(api + 'bank/accounts/' + id + '/sync', { method: 'POST', token: o.token, body: {} }), 'recover via 取得').job;
    const second = await claim(dev); assert.equal(second.job.jobId, manual.jobId);
    const ready = savedLogin('ready'), ui2 = fictionalUi(); const r2 = await runPc(second, ui2, ready);
    assert.equal(r2.error, null, 'recovery run ' + String(r2.error?.message || ''));
    assert.deepEqual([ready.calls.open, ui2.calls.login, ready.calls.accepted], [1, 1, 1], 'sched:one-attempt');
    const done = (await jobsOf(id, { jobId: manual.jobId }))[0]; assert.equal(done.state, 'complete'); assert.equal(done.statementIds.length, 1, 'sched:recovered statement');
    const recovered = await stateOf(o, id); assert.deepEqual([recovered.state, recovered.lastFailure], ['done-today', null], 'sched:recovered');
    // A scheduled job whose PC stopped after its one submission: the lease expires, the schedule adds nothing, the PC resumes the same job and its journal stops a second submission.
    assert.equal(await queuedFor(await tick(tomorrow), [id]), 1); const third = await claim(dev), controller = new AbortController(), once = savedLogin('ready'), ui3 = fictionalUi({ authenticate: false, onLogin: () => controller.abort() });
    const r3 = await runPc(third, ui3, once, controller.signal); assert.equal(r3.error?.name, 'AbortError'); assert.deepEqual([once.calls.open, ui3.calls.login], [1, 1]);
    await BankJob.updateOne({ jobId: third.job.jobId }, { $set: { leaseUntil: new Date(Date.now() - 60000) } });
    assert.equal(await queuedFor(await tick(tomorrow), [id]), 0, 'sched:interrupted-no-duplicate (after a submission)'); assert.equal((await stateOf(o, id, tomorrow)).state, 'interrupted');
    const again = await claim(dev); assert.equal(again.job.jobId, third.job.jobId, 'sched:resume-same-job');
    const fresh = savedLogin('ready'), ui4 = fictionalUi(); const r4 = await runPc(again, ui4, fresh);
    assert.ok(r4.error, 'the reclaimed job asks the person'); assert.deepEqual([fresh.calls.open, ui4.calls.login], [0, 0], 'sched:reclaimed-no-resubmit');
    // The day after that failure: the run is queued as usual (no hold) and the PC, whose marker still says the last sign-in is unconfirmed, does not send the saved login.
    const after = await stateOf(o, id, tomorrow); assert.deepEqual([after.state, after.lastFailure?.jobId], ['done-today', third.job.jobId], 'sched:failure-shown next day');
    assert.equal(await queuedFor(await tick(dayAfter), [id]), 1, 'sched:next-day-after-failure');
    const fifth = await claim(dev), still = savedLogin('blocked'), ui6 = fictionalUi(); const r6 = await runPc(fifth, ui6, still);
    assert.ok(r6.error, 'the next day asks the person again'); assert.deepEqual([still.calls.open, ui6.calls.login], [0, 0], 'sched:no-resubmit-next-day');
    // PayPay銀行 標準 with a refused saved login: never sent again.
    const t = await ppTemplate(o, 'S8 PayPay template'), pid = await account(o, 'S8 PayPay', paypay(t, 8)); ok(await call(api + 'bank/collectors/' + dev.id, { method: 'PUT', token: o.token, body: { bankAccountIds: [id, pid] } }), 'grant');
    ok(await enable(o, pid, 0), 'enable paypay'); assert.equal(await queuedFor(await tick(new Date()), [pid]), 1);
    const pjob = await claim(dev), refusedLogin = savedLogin('refused'), ui5 = fictionalUi(); let perror = null;
    try { await m.bank.collectBankFromPage(null, null, m.paypayAdapter.variants.standard, { bankAccountId: pid, ownerId: o.id, origin, jobId: pjob.job.jobId, snapshotHash: pjob.job.snapshotHash, provider: 'paypay' }, pjob.job, directory, async () => {}, { ui: ui5, login: refusedLogin, now: ui5.now, wait: ui5.wait, pollMs: 1000, loginTimeoutMs: 20000 }); } catch (e) { perror = e; }
    assert.ok(perror, 'the refused PayPay login waits for the person'); assert.deepEqual([refusedLogin.calls.open, ui5.calls.login], [0, 0], 'sched:refused-not-resent');
    ok(await status(dev, pjob.job.jobId, 'failed', 'Open the downloader setup screen on the connected PC for details'), 'failed');
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  });
  await leg('S9 changed settings: a connection save keeps the schedule; a closed period keeps its end; one of two concurrent saves wins; a changed template stops it until saved again; a newly granted second PC keeps it running and may run the job; a removed PC alone changes nothing, no PC waits; disabling closes the unclaimed run; unsupported stays manual', async () => {
    const o = await owner('s9'), id = await account(o, 'S9 Rakuten', RAKUTEN), closed = await account(o, 'S9 Rakuten closed', { ...RAKUTEN, coverage: { from: '2026-07-01', to: '2026-07-31' } }), dev = await device(o, [id, closed]);
    ok(await enable(o, id, 9), 'enable'); ok(await enable(o, closed, 9), 'enable closed');
    ok(await call(api + 'bank/accounts/' + id + '/connection', { method: 'PUT', token: o.token, body: RAKUTEN }), 'same connection');
    const kept = (await BankAccount.findById(id).lean()).schedule; assert.deepEqual([kept.enabled, kept.revision, kept.hour], [true, 1, 9], 'sched:connection-save-keeps-schedule');
    await tick(at(D, 9));
    assert.deepEqual((await scheduled(closed))[0].snapshot.coverage, { from: '2026-07-01', to: '2026-07-31' }, 'sched:closed-period-kept');
    assert.deepEqual((await scheduled(id))[0].snapshot.coverage, { from: '2025-11-01', to: D });
    await failPoint({ mode: { times: 1 }, data: { failCommands: ['update'], blockConnection: true, blockTimeMS: 1500 } });
    let raced; try { raced = await Promise.all([enable(o, id, 10, 1), (async () => { await pause(300); return enable(o, id, 11, 1); })()]); } finally { await failPoint(null); }
    assert.deepEqual(raced.map(r => r.status).sort(), [200, 409], 'sched:revision-cas ' + JSON.stringify(raced.map(r => r.data)).slice(0, 300));
    const afterRace = (await BankAccount.findById(id).lean()).schedule; assert.equal(afterRace.revision, 2, 'sched:revision-cas stored');
    const stale = await enable(o, id, 12, 1); assert.equal(stale.status, 409, 'sched:stale-save'); assert.equal((await BankAccount.findById(id).lean()).schedule.hour, afterRace.hour);
    const custom = ok(await call(api + 'bank/templates', { method: 'PUT', token: o.token, body: { name: 'S9 custom Rakuten', headers: ['取引日', '入出金(円)', '残高(円)', '入出金先内容'], mapping: { date: '0', amount: '1', balance: '2', description: '3' }, amountSign: 'outflow-negative' } }), 'custom').template.id;
    ok(await call(api + 'bank/accounts/' + id + '/connection', { method: 'PUT', token: o.token, body: { ...RAKUTEN, templateId: custom } }), 'changed template');
    assert.deepEqual([(await stateOf(o, id, at(D, 10))).state, (await stateOf(o, id, at(D, 10))).reason], ['reconfirm', 'connection-changed'], 'sched:connection-changed');
    const r = await tick(at(D, 10)); assert.equal((await scheduled(id))[0].state, 'superseded', 'sched:connection-changed-supersedes ' + JSON.stringify(r));
    assert.equal(await queuedFor(await tick(at(D1, 9)), [id]), 0, 'no run for the changed connection');
    assert.equal((await scheduled(id)).filter(j => j.state !== 'superseded').length, 0, 'sched:connection-changed no new run');
    ok(await enable(o, id, 9, 2), 're-save'); assert.equal(await queuedFor(await tick(at(D1, 9, 1)), [id]), 1, 'sched:re-saved runs');
    const dev2 = await device(o, []); ok(await call(api + 'bank/collectors/' + dev2.id, { method: 'PUT', token: o.token, body: { bankAccountIds: [id] } }), 'grant second PC');
    assert.equal((await stateOf(o, id, at(D1, 10))).state, 'queued', 'sched:second-pc-legit (the already-authorized schedule keeps running)');
    await tick(at(D1, 10)); const idQueued = (await scheduled(id)).filter(j => j.state === 'queued'); assert.equal(idQueued.length, 1, 'sched:second-pc-legit the unclaimed run stays');
    const byNewPc = await claim(dev2); assert.equal(byNewPc.job?.jobId, idQueued[0].jobId, 'sched:second-pc-legit the newly granted PC may run it'); ok(await status(dev2, byNewPc.job.jobId, 'complete'), 'complete');
    assert.equal((await stateOf(o, id, at(D2, 9))).state, 'due');
    await FinanceCollector.updateOne({ _id: oid(dev2.id) }, { $set: { revokedAt: new Date() } });
    assert.equal((await stateOf(o, id, at(D2, 9))).state, 'due', 'sched:device-removed-continues');
    await FinanceCollector.updateOne({ _id: oid(dev.id) }, { $set: { revokedAt: new Date() } });
    assert.equal((await stateOf(o, id, at(D2, 9))).state, 'waiting-pc', 'sched:waiting-pc'); assert.equal(await queuedFor(await tick(at(D2, 9)), [id]), 0, 'sched:waiting-pc nothing queued');
    await FinanceCollector.updateOne({ _id: oid(dev.id) }, { $unset: { revokedAt: '' } });
    const queuedClosed = (await scheduled(closed)).filter(j => j.state === 'queued'); assert.equal(queuedClosed.length, 1);
    ok(await call(api + 'bank/accounts/' + closed + '/schedule', { method: 'PUT', token: o.token, body: { enabled: false, hour: 9, revision: 1 } }), 'disable');
    assert.equal((await jobsOf(closed, { jobId: queuedClosed[0].jobId }))[0].state, 'superseded', 'sched:disable-supersedes'); assert.equal((await stateOf(o, closed)).state, 'off');
    assert.equal(ok(await call(api + 'bank/accounts/' + closed + '/sync', { method: 'POST', token: o.token, body: {} }), 'manual after disable').job.kind, 'retrieve', 'sched:manual-after-disable');
    ok(await call(api + 'bank/accounts/' + closed + '/connection', { method: 'PUT', token: o.token, body: { provider: 'rakuten', variant: 'plus', templateId: custom, coverage: { from: '2026-07-01', to: null } } }), 'observe variant');
    const refused = await call(api + 'bank/accounts/' + closed + '/schedule', { method: 'PUT', token: o.token, body: { enabled: true, hour: 9, revision: 2 } });
    assert.equal(refused.status, 400, 'sched:unsupported-refused-on-enable'); assert.match(refused.data?.data?.message || '', /対象外/);
  });
  await leg('S10 isolation: another owner cannot read or save the schedule, another owner\'s PC and an unscoped PC never receive the job, a revoked PC is refused', async () => {
    const a = await owner('s10a'), b = await owner('s10b'), ida = await account(a, 'S10 A Rakuten', RAKUTEN), ida2 = await account(a, 'S10 A Rakuten 2', RAKUTEN), idb = await account(b, 'S10 B Rakuten', RAKUTEN);
    const devA = await device(a, [ida]), devA2 = await device(a, [ida2]), devB = await device(b, [idb]);
    for (const [method, body] of [['GET', undefined], ['PUT', { enabled: true, hour: 9, revision: 0 }]]) assert.equal((await call(api + 'bank/accounts/' + ida + '/schedule', { method, token: b.token, body })).status, 404, 'sched:other-owner ' + method);
    assert.equal((await BankAccount.findById(ida).lean()).schedule ?? null, null, 'sched:other-owner nothing written');
    ok(await enable(a, ida, 9), 'enable a'); await tick(at(D, 9));
    assert.equal((await claim(devB)).job, null, 'sched:other-owner-pc'); assert.equal((await claim(devA2)).job, null, 'sched:unscoped-pc');
    await FinanceCollector.updateOne({ _id: oid(devA.id) }, { $set: { revokedAt: new Date() } });
    assert.equal((await call(capi + 'bank/claim', { method: 'POST', token: devA.token, body: {} })).status, 401, 'sched:revoked-pc');
    assert.equal((await jobsOf(ida))[0].state, 'queued', 'unclaimed');
  });
  await leg('S11 default off, malformed input and tolerance: nothing runs without opt-in; bad bodies 400 and write nothing; a malformed stored setting reads as off and can be saved over; unsupported or PC-less enabling is refused with the reason', async () => {
    const o = await owner('s11'), t = await ppTemplate(o), id = await account(o, 'S11 Rakuten', RAKUTEN), unmapped = await account(o, 'S11 PayPay unmapped', { provider: 'paypay', variant: 'standard', coverage: { from: '2025-11-01', to: null } }), nocov = await account(o, 'S11 Rakuten no period', { provider: 'rakuten', variant: 'standard' }), lonely = await account(o, 'S11 PayPay no PC', paypay(t, 9));
    await device(o, [id, unmapped, nocov]);
    const view = ok(await call(api + 'bank/accounts/' + id + '/schedule', { token: o.token }), 'read');
    assert.deepEqual([view.schedule.enabled, view.schedule.revision, view.status.state, view.supported, view.timezone], [false, 0, 'off', true, 'Asia/Tokyo'], 'sched:default-off');
    await tick(at(D, 12)); assert.equal((await jobsOf(id)).length, 0, 'sched:default-off no job');
    for (const [raw, body] of [['{not json', undefined], [undefined, { enabled: true, hour: 24, revision: 0 }], [undefined, { enabled: true, hour: '9', revision: 0 }], [undefined, { enabled: 1, hour: 9, revision: 0 }], [undefined, { enabled: true, hour: 9 }], [undefined, []]]) {
      const r = await call(api + 'bank/accounts/' + id + '/schedule', { method: 'PUT', token: o.token, raw, body }); assert.equal(r.status, 400, 'sched:malformed ' + (raw || JSON.stringify(body)));
    }
    assert.equal((await call(api + 'bank/accounts/' + id + '/schedule', { method: 'PUT', token: o.token, body: { enabled: true, hour: 9, revision: 5 } })).status, 409, 'sched:malformed stale revision');
    assert.equal((await BankAccount.findById(id).lean()).schedule ?? null, null, 'sched:malformed nothing written');
    await BankAccount.updateOne({ _id: oid(id) }, { $set: { schedule: { enabled: true, hour: 9 } } });
    assert.equal(ok(await call(api + 'bank/accounts/' + id + '/schedule', { token: o.token }), 'read malformed').status.state, 'off', 'sched:malformed-stored-off');
    await tick(at(D, 12)); assert.equal((await jobsOf(id)).length, 0, 'sched:malformed-stored-off no run');
    assert.equal(ok(await enable(o, id, 9, 0), 'save over malformed').schedule.revision, 1, 'sched:malformed-stored-saved');
    for (const [acct, status, pattern] of [[unmapped, 400, /テンプレート/], [nocov, 400, /取得期間/], [lonely, 409, /PC未接続/]]) { const r = await enable(o, acct, 9); assert.equal(r.status, status, 'sched:enable-refused ' + JSON.stringify(r.data).slice(0, 200)); assert.match(r.data?.data?.message || '', pattern); }
    const firstCapture = ok(await call(api + 'bank/accounts/' + unmapped + '/sync', { method: 'POST', token: o.token, body: {} }), 'manual first capture').job;
    assert.deepEqual([firstCapture.kind, firstCapture.snapshot.interpretation, firstCapture.snapshot.templateId], ['retrieve', 'unmapped', null], 'sched:unsupported-manual-kept (the template-free first capture stays the manual 取得)');
  });
  await leg('S12 claim-time check: a scheduled job inserted from a setting read before the owner turned it off or changed the connection, or after a manual run completed that day, is closed when a PC claims it and never handed out; a job a PC received is in flight and resumed; manual jobs are claimed as before', async () => {
    const o = await owner('s12'), id = await account(o, 'S12 Rakuten', RAKUTEN), dev = await device(o, [id]); ok(await enable(o, id, 9), 'enable');
    const read = () => BankAccount.findById(id).lean(), templateOf = a => BankTemplate.findOne({ _id: a.connection.templateId }).lean(), sched = (r, body) => call(api + 'bank/accounts/' + id + '/schedule', { method: 'PUT', token: o.token, body });
    // (a) The tick read the enabled setting, the owner turned it off, the tick's insert landed and its process stopped before its own check.
    let before = await read(); ok(await sched(null, { enabled: false, hour: 9, revision: 1 }), 'disable');
    const staleOff = await m.collection.queueScheduledBankJob(before, await templateOf(before), { day: D, now: at(D, 9), revision: 1 });
    assert.ok(staleOff, 'the stale insert landed'); assert.equal((await claim(dev)).job, null, 'sched:stale-claim-refused');
    const closedOff = (await jobsOf(id, { jobId: staleOff.jobId }))[0];
    assert.deepEqual([closedOff.state, closedOff.open, closedOff.schedule.day, closedOff.schedule.supersededDay], ['superseded', false, undefined, D], 'sched:stale-claim-refused closed'); assert.match(closedOff.lastMessage, /オフ/);
    // (b) The same after a connection change.
    ok(await enable(o, id, 9, 2), 're-enable'); before = await read();
    const custom = ok(await call(api + 'bank/templates', { method: 'PUT', token: o.token, body: { name: 'S12 custom Rakuten', headers: ['取引日', '入出金(円)', '残高(円)', '入出金先内容'], mapping: { date: '0', amount: '1', balance: '2', description: '3' }, amountSign: 'outflow-negative' } }), 'custom').template.id;
    ok(await call(api + 'bank/accounts/' + id + '/connection', { method: 'PUT', token: o.token, body: { ...RAKUTEN, templateId: custom } }), 'changed connection');
    const staleConn = await m.collection.queueScheduledBankJob(before, await templateOf(before), { day: D1, now: at(D1, 9), revision: 3 });
    assert.equal((await claim(dev)).job, null, 'sched:changed-claim-refused'); const closedConn = (await jobsOf(id, { jobId: staleConn.jobId }))[0]; assert.equal(closedConn.state, 'superseded'); assert.match(closedConn.lastMessage, /接続/);
    // (c) A manual 取得 requested and completed between the tick's read and its insert, on the job's JST day.
    ok(await enable(o, id, 0, 3), 're-save for the current connection'); before = await read();
    const manual = ok(await call(api + 'bank/accounts/' + id + '/sync', { method: 'POST', token: o.token, body: {} }), 'manual').job;
    assert.equal((await claim(dev)).job.jobId, manual.jobId); ok(await status(dev, manual.jobId, 'complete'), 'complete');
    const today = J.jstDay(new Date()), staleDay = await m.collection.queueScheduledBankJob(before, await templateOf(before), { day: today, now: new Date(), revision: 4 });
    assert.equal((await claim(dev)).job, null, 'sched:manual-between'); const closedDay = (await jobsOf(id, { jobId: staleDay.jobId }))[0]; assert.equal(closedDay.state, 'superseded'); assert.match(closedDay.lastMessage, /同じ日/);
    // (d) A scheduled job a PC received is in flight: turning the schedule off afterwards does not take it back; after an expired lease the PC resumes it.
    const next = at(J.nextDay(today), 0, 0, 1);
    assert.equal(await queuedFor(await tick(next), [id]), 1); const flying = await claim(dev); assert.ok(flying.job, 'sched:legit-claim');
    assert.ok((await jobsOf(id, { jobId: flying.job.jobId }))[0].schedule.claimedAt, 'sched:claimed-marked');
    ok(await sched(null, { enabled: false, hour: 0, revision: 4 }), 'disable after the PC received it');
    assert.equal((await jobsOf(id, { jobId: flying.job.jobId }))[0].state, 'running', 'sched:in-flight-not-superseded');
    await BankJob.updateOne({ jobId: flying.job.jobId }, { $set: { leaseUntil: new Date(Date.now() - 60000) } });
    assert.equal((await claim(dev)).job?.jobId, flying.job.jobId, 'sched:in-flight-preserved'); ok(await status(dev, flying.job.jobId, 'complete'), 'complete');
    // (e) Manual jobs are claimed exactly as before with the schedule off.
    const manual2 = ok(await call(api + 'bank/accounts/' + id + '/sync', { method: 'POST', token: o.token, body: {} }), 'manual 2').job;
    assert.equal((await claim(dev)).job?.jobId, manual2.jobId, 'sched:manual-claim-unchanged'); ok(await status(dev, manual2.jobId, 'complete'), 'complete');
    // (f) Phase C: the tick read the setting, the owner saved another hour, the tick's insert landed with the earlier setting's revision and
    // its process stopped: the current setting did not ask for that run (claim closes it); the current setting's run follows at its hour.
    ok(await sched(null, { enabled: true, hour: 0, revision: 5 }), 'enable at 0時'); before = await read();
    ok(await sched(null, { enabled: true, hour: 23, revision: 6 }), 'owner moves the hour to 23時');
    const staleHour = await m.collection.queueScheduledBankJob(before, await templateOf(before), { day: D2, now: at(D2, 0, 0, 1), revision: 6 });
    assert.equal((await claim(dev)).job, null, 'sched:stale-setting-claim-refused (an earlier hour)');
    const closedHour = (await jobsOf(id, { jobId: staleHour.jobId }))[0]; assert.deepEqual([closedHour.state, closedHour.open], ['superseded', false], 'sched:stale-setting-claim-refused closed'); assert.match(closedHour.lastMessage, /設定が変わった/);
    assert.equal(await queuedFor(await tick(at(D2, 22)), [id]), 0, 'sched:current-setting-hour (nothing before 23時)');
    assert.equal(await queuedFor(await tick(at(D2, 23)), [id]), 1, 'sched:current-setting-runs'); const current = await claim(dev); assert.equal((await jobsOf(id, { jobId: current.job?.jobId }))[0]?.schedule?.day, D2, 'sched:current-setting-runs claimed'); ok(await status(dev, current.job.jobId, 'complete'), 'complete');
    // (g) Turned off and on again at the same hour after the tick's read: the same.
    before = await read(); ok(await sched(null, { enabled: false, hour: 23, revision: 7 }), 'off'); ok(await sched(null, { enabled: true, hour: 23, revision: 8 }), 'on again');
    const staleToggle = await m.collection.queueScheduledBankJob(before, await templateOf(before), { day: D3, now: at(D3, 23, 0, 1), revision: 7 });
    assert.equal((await claim(dev)).job, null, 'sched:stale-setting-claim-refused (off and on again)'); assert.equal((await jobsOf(id, { jobId: staleToggle.jobId }))[0].state, 'superseded');
    // (h) A save closes a still-queued run of the earlier setting at once (no PC received it), so the screen never shows the old run as
    // pending; the next tick queues under the saved setting and a PC runs it.
    const D4 = J.nextDay(D3); assert.equal(await queuedFor(await tick(at(D4, 23, 5)), [id]), 1); const pending = (await scheduled(id)).find(j => j.state === 'queued');
    ok(await sched(null, { enabled: true, hour: 22, revision: 9 }), 'owner saves 22時 while the run is queued');
    assert.equal((await jobsOf(id, { jobId: pending.jobId }))[0].state, 'superseded', 'sched:save-closes-older-queued');
    assert.equal(await queuedFor(await tick(at(D4, 23, 6)), [id]), 1, 'sched:save-then-current-run'); const after = await claim(dev); assert.ok(after.job, 'sched:save-then-current-run claimed'); ok(await status(dev, after.job.jobId, 'complete'), 'complete');
  });
  console.log('RECEIPT ' + JSON.stringify({ pass: failed === 0, checks, failed, days: { D, D1, D2, D3 } }));
  server.close(); await mongoose.disconnect().catch(() => {}); await rm(temp, { recursive: true, force: true }).catch(() => {});
  process.exit(failed ? 1 : 0);
}
// A fictional saved login with the interface collector/bank.mjs expects (state() without decryption, open() once, rejected(), accepted()).
function savedLogin(state = 'ready') {
  const calls = { state: 0, open: 0, rejected: 0, accepted: 0 }; let current = state;
  return { calls, async state() { calls.state++; return current; }, async open() { calls.open++; return { username: 'fictional-user-01', password: 'Fictional-Pass-0001' }; }, async rejected() { calls.rejected++; current = 'blocked'; }, async accepted() { calls.accepted++; current = 'ready'; } };
}
// A page-less bank UI on a virtual clock: the login form, its one submission, the statement steps and one fictional CSV download.
function fictionalUi({ authenticate = true, onLogin = null } = {}) {
  const clock = { t: 1_800_000_000_000 }, calls = { open: 0, show: 0, loginForm: 0, login: 0, openStatements: 0, selectPeriod: 0, exportCsv: 0 };
  let kind = 'login', doc = 'doc-1', handlers = {}, jobDir = null; const emit = (event, value) => { for (const h of handlers[event] || []) h(value); };
  return { calls, now: () => clock.t, async wait(ms) { clock.t += ms; },
    async open() { calls.open++; }, async state() { return { kind }; }, async show() { calls.show++; },
    async loginForm() { calls.loginForm++; return kind === 'login' ? { ok: true, document: doc } : { ok: false, reason: 'form' }; }, async document() { return doc; },
    async login() { calls.login++; const before = doc; doc = 'doc-' + (calls.login + 1); onLogin?.(); if (authenticate) { kind = 'authenticated'; return { outcome: 'authenticated', document: before }; } kind = 'unknown'; return { outcome: 'unknown', document: before }; },
    async openStatements() { calls.openStatements++; kind = 'export_ready'; }, async selectPeriod(period) { calls.selectPeriod++; calls.period = period; },
    async snapshot() { return { accountLabel: LABEL_R, period: 'fictional' }; },
    downloadSession(dir) { jobDir = dir; handlers = {}; return { on(event, handler) { (handlers[event] ||= []).push(handler); }, async close() { handlers = {}; } }; },
    async exportCsv() { calls.exportCsv++; const guid = randomUUID(); await writeFile(path.join(jobDir, guid), NATIVE_CSV); emit('Browser.downloadWillBegin', { guid, url: 'https://fes.rakuten-bank.co.jp/fictional/download', suggestedFilename: 'RB-fictional.csv' }); emit('Browser.downloadProgress', { guid, state: 'completed' }); } };
}
// One tick in its own process (restart, concurrency, crash legs): prints TICK <result>.
async function tickMain(SRC, iso) {
  const base = String(process.env.OMF_SCHEDULE_MONGO_URI || ''), dbName = String(process.env.OMF_SCHEDULE_DB || ''), name = String(process.env.OMF_SCHEDULE_TICK_APP || 'omf-sched-tick');
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(base) || !/^omf_sched_[a-z0-9_]+$/.test(dbName)) process.exit(3);
  process.env.MONGO_URI = base.replace(/\/?$/, '/') + dbName + '?appName=' + name;
  const mongoose = (await import('mongoose')).default; await mongoose.connect(process.env.MONGO_URI);
  const svc = await import(pathToFileURL(path.join(SRC, 'server/services/financeBankScheduleService.ts')).href);
  console.log('TICK ' + JSON.stringify(await svc.runBankSchedule(new Date(iso))));
  process.exit(0);
}

// ════════════════════════════ The built app (A, C) ════════════════════════════
const APP_LOGS = []; // every owned app's startup head and recent tail, retained as leg evidence
async function availablePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function bootApp(outputRoot, mongo, dbName, directory, scheduleMs) {
  const base = new URL(mongo.getUri(dbName)); base.searchParams.set('appName', 'omf-sched-app-' + dbName);
  const uri = base.toString(), port = await availablePort(), origin = 'http://127.0.0.1:' + port; let logs = '', head = '';
  const child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: outputRoot, windowsHide: true, env: { ...process.env, MONGO_URI: uri, NUXT_MONGO_URI: uri, MONGODB_URI: '', OMF_DATA_DIR: directory, OMF_SYNC_SCHEDULE_MS: '0', OMF_BANK_SCHEDULE_MS: String(scheduleMs), JWT_SECRET: process.env.OMF_SCHEDULE_JWT, NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(r => child.once('exit', r));
  for (const stream of [child.stdout, child.stderr]) stream.on('data', v => { if (head.length < 6000) head += v; logs = (logs + v).slice(-20000); });
  let healthy = false;
  for (let i = 0; i < 150; i++) { try { const d = await (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) })).json(); if (d.database?.connected && d.database.name === dbName) { healthy = true; break; } } catch { /* booting */ } await pause(200); }
  if (!healthy) { child.kill(); await Promise.race([exited, pause(5000)]); throw new Error('SETUP owned app did not become healthy: ' + logs.slice(-1500)); }
  const call = async (route, { method = 'GET', token, body } = {}) => { const r = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(30000) }); const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; } return { status: r.status, data }; };
  // Close is idempotent: one stored exit promise armed at spawn (a child ended by a signal keeps exitCode null and sets signalCode), one
  // stored closing promise, and a bounded forced stop (parent finding PARENT-FIXTURE-ABORT.md: the former close waited forever on an exit
  // that had already been emitted).
  let closing = null;
  const close = () => closing ??= (async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); if (await Promise.race([exited.then(() => true), pause(15000).then(() => false)])) return; child.kill('SIGKILL'); await Promise.race([exited, pause(5000)]); })();
  const all = () => head.length < 6000 ? head : head + '\n…\n' + logs; APP_LOGS.push({ dbName, port, logs: all });
  return { origin, call, logs: all, close, alive: () => child.exitCode === null && child.signalCode === null };
}
const jstDayNow = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
async function appWorld(holder, db, tag, { five = true } = {}) {
  const app = { call: (...a) => holder.app.call(...a) }; // every request goes to the holder's current server (it changes on restart)
  const { ObjectId } = requireRoot('mongodb'), api = '/api/finance-payments/';
  const ok = (r, label) => { assert.equal(r.status, 200, label + ' ' + JSON.stringify(r.data).slice(0, 400)); return r.data; };
  const email = 'sched-app-' + tag + '@example.invalid', password = 'Synthetic-password-Only1!';
  const reg = ok(await app.call('/api/auth/register', { method: 'POST', body: { email, password, name: 'Finance test' } }), 'register'); const token = reg.tokens.accessToken;
  const owner = await db.collection('users').findOne({ email });
  const req = (route, o = {}) => app.call(api + route, { token, ...o });
  const account = async (name, connection) => { const a = ok(await req('bank/accounts', { method: 'POST', body: { name, currency: 'JPY' } }), 'create').account; if (connection) ok(await req('bank/accounts/' + a.id + '/connection', { method: 'PUT', body: connection }), 'connect ' + name); return a.id; };
  const template = ok(await req('bank/templates', { method: 'PUT', body: { name: 'Synthetic PayPay template', headers: PP_HEAD, mapping: { date: '0', description: '1', outflow: '2', inflow: '3', balance: '4' } } }), 'template').template.id;
  const ids = five ? [await account(tag + ' 楽天銀行 普通', RAKUTEN)] : []; if (five) for (let i = 1; i <= 4; i++) ids.push(await account(tag + ' PayPay銀行 ' + i, paypay(template, i)));
  const deviceToken = 'omfc_' + randomBytes(32).toString('hex'); const device = { _id: new ObjectId(), token: deviceToken };
  await db.collection('financecollectors').insertOne({ _id: device._id, ownerId: owner._id, name: 'Synthetic PC ' + tag, tokenHash: sha256(deviceToken), accountIds: [], bankAccountIds: ids.map(id => new ObjectId(id)), createdAt: new Date(), updatedAt: new Date() });
  const grant = async list => ok(await req('bank/collectors/' + device._id, { method: 'PUT', body: { bankAccountIds: list } }), 'grant');
  const claim = async () => ok(await app.call(api + 'collector/bank/claim', { method: 'POST', token: deviceToken, body: {} }), 'claim');
  const status = (jobId, state, message = '') => app.call(api + 'collector/bank/status', { method: 'POST', token: deviceToken, body: { jobId, state, message } });
  return { token, email, password, owner, req, ok, account, template, ids, device, grant, claim, status };
}
async function legA(mongo, base, out) {
  const { MongoClient } = requireRoot('mongodb'), client = await MongoClient.connect(mongo.getUri('omf_sched_app')), db = client.db('omf_sched_app'), apps = [];
  const boot = async ms => { const app = await bootApp(OUTPUT_ROOT, mongo, 'omf_sched_app', path.join(base, 'app-data'), ms); apps.push(app); return app; };
  const scheduledCount = filter => db.collection('financebankjobs').countDocuments({ trigger: 'schedule', ...filter });
  const waitFor = async (fn, label, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await pause(200); } throw new Error(label); };
  try {
    let app = await boot(1000), w, unmapped, observe; const holder = { app };
    try { w = await appWorld(holder, db, 'a'); unmapped = await w.account('a PayPay unmapped', { provider: 'paypay', variant: 'standard', coverage: { from: '2025-11-01', to: null } }); observe = await w.account('a 楽天銀行 口座管理プラス', { provider: 'rakuten', variant: 'plus', templateId: w.template, coverage: { from: '2025-11-01', to: null } }); await w.grant([...w.ids, unmapped, observe]); }
    catch (e) { throw new Error('SETUP fictional world (accounts, connections, PC grant): ' + e.message); }
    const { ok, req } = w;
    await pause(3500); assert.equal(await db.collection('financebankjobs').countDocuments(), 0, 'app:default-off');
    const dayBefore = jstDayNow();
    const saves = []; for (const id of w.ids) saves.push(await req('bank/accounts/' + id + '/schedule', { method: 'PUT', body: { enabled: true, hour: 0, revision: 0 } }));
    if (saves.some(r => r.status !== 200)) {
      // A tree without the route: store the same opt-in setting directly and give its timer the same window, so the result says whether a
      // saved daily setting can yield a request at all (not only that the route is missing).
      const { ObjectId } = requireRoot('mongodb'), now = new Date();
      await db.collection('financebankaccounts').updateMany({ _id: { $in: w.ids.map(id => new ObjectId(id)) } }, { $set: { schedule: { enabled: true, hour: 0, revision: 1, savedAt: now, binding: null } } });
      for (const id of w.ids) { const a = await db.collection('financebankaccounts').findOne({ _id: new ObjectId(id) }); await db.collection('financebankaccounts').updateOne({ _id: a._id }, { $set: { 'schedule.binding': { provider: a.connection.provider, variant: a.connection.variant ?? null, templateId: a.connection.templateId ?? null } } }); }
      await pause(4000);
      throw new Error('app:save daily schedule → ' + saves.map(r => r.status).join('/') + ' (' + String(saves.find(r => r.status !== 200)?.data?.data?.message || '') + '); with the same daily setting stored on the 5 accounts, the timer queued ' + await scheduledCount({}) + ' jobs in 4 s (' + await db.collection('financebankjobs').countDocuments() + ' jobs of any kind)');
    }
    for (const r of saves) assert.equal(ok(r, 'app:save daily schedule (0時)').schedule.enabled, true);
    await waitFor(async () => await scheduledCount({}) >= 5, 'app:timer queued ' + 0 + ' — the saved daily schedule yielded no due request', 15000);
    await pause(2000);
    const jobs = await db.collection('financebankjobs').find({ trigger: 'schedule' }).toArray(), dayAfter = jstDayNow();
    assert.equal(jobs.length, 5, 'app:one-per-account'); assert.deepEqual([...new Set(jobs.map(j => String(j.bankAccountId)))].sort(), [...w.ids].sort());
    for (const j of jobs) { assert.ok([dayBefore, dayAfter].includes(j.schedule.day), 'app:jst-day'); assert.deepEqual(j.snapshot.coverage, { from: '2025-11-01', to: j.schedule.day }, 'app:coverage'); assert.equal(j.kind, 'retrieve'); }
    for (const id of [unmapped, observe]) { const v = ok(await req('bank/accounts/' + id + '/schedule'), 'read'); assert.deepEqual([v.schedule.enabled, v.schedule.revision, v.status.state, v.supported], [false, 0, 'off', false], 'app:default-off state'); assert.equal((await req('bank/accounts/' + id + '/schedule', { method: 'PUT', body: { enabled: true, hour: 0, revision: 0 } })).status, 400, 'app:unsupported-refused'); }
    out.push('A1 default off: 3.5 s of 1 s timer ticks before any opt-in, 0 jobs; unmapped/observe accounts read off and enabling them is 400');
    out.push('A2 five accounts enabled at 0時 → the plugin timer queued exactly 5 retrievals (JST day ' + jobs[0].schedule.day + ', period 2025-11-01〜that day)');
    const refused = await req('bank/accounts/' + w.ids[0] + '/sync', { method: 'POST', body: {} }); assert.equal(refused.status, 409, 'app:manual-409');
    for (let i = 0; i < 5; i++) { const c = await w.claim(); assert.ok(c.job, 'app:claim ' + i); ok(await w.status(c.job.jobId, 'complete', 'fictional complete'), 'complete'); }
    assert.equal((await w.claim()).job, null);
    for (const id of w.ids) assert.equal(ok(await req('bank/accounts/' + id + '/schedule'), 'read').status.state, 'done-today', 'app:done-today');
    out.push('A3 the PC token claimed the 5 scheduled jobs, completed them; each state done-today; a manual request while queued kept its 409');
    await app.close(); assert.equal(app.alive(), false, 'app:first-server-closed'); app = await boot(1000); holder.app = app; await pause(3500);
    assert.equal(await scheduledCount({}), 5, 'app:restart-no-duplicate');
    out.push('A4 restart: a new server process ticking for 3.5 s (1 s timer) queued nothing more (5 scheduled jobs)');
    const app2 = await boot(1000), w2 = await appWorld(holder, db, 'c');
    for (const id of w2.ids) w2.ok(await w2.req('bank/accounts/' + id + '/schedule', { method: 'PUT', body: { enabled: true, hour: 0, revision: 0 } }), 'enable c');
    await waitFor(async () => await scheduledCount({ ownerId: w2.owner._id }) >= 5, 'app:two-process queue', 15000); await pause(3500);
    assert.equal(await scheduledCount({ ownerId: w2.owner._id }), 5, 'app:two-processes-one-each');
    out.push('A5 two server processes (1 s timers each) for 3.5 s after enabling five accounts: exactly 5 scheduled jobs');
    const manual = ok(await req('bank/accounts/' + w.ids[0] + '/sync', { method: 'POST', body: {} }), 'manual after done'); assert.equal(manual.job.kind, 'retrieve', 'app:manual-kept');
    const firstCapture = ok(await req('bank/accounts/' + unmapped + '/sync', { method: 'POST', body: {} }), 'first capture').job; assert.deepEqual([firstCapture.kind, firstCapture.snapshot.interpretation], ['retrieve', 'unmapped'], 'app:unsupported-manual-kept');
    const observed = ok(await req('bank/accounts/' + observe + '/sync', { method: 'POST', body: {} }), 'observe').job; assert.equal(observed.kind, 'observe', 'app:observe-manual-kept');
    const csv = Buffer.from(PP_HEAD.join(',') + '\r\n2026-10-01,振込 カクウサプライ,3300,,996700\r\n2026-10-05,振込 カクウ顧客,,120000,1116700\r\n');
    const file = await fetch(holder.app.origin + '/api/finance-payments/bank/files?name=sched-paypay.csv', { method: 'POST', headers: { Authorization: 'Bearer ' + w.token, 'Content-Type': 'text/csv' }, body: csv }).then(r => r.json());
    const sheet = ok(await req('bank/files/' + file.document.id + '/sheet'), 'sheet');
    const imported = ok(await req('bank/files/' + file.document.id + '/import', { method: 'POST', body: { sheet: sheet.sheet, headerRow: sheet.headerRow, mapping: { date: '0', description: '1', outflow: '2', inflow: '3', balance: '4' }, amountSign: 'outflow-positive', bankAccountId: w.ids[1], transactionIdConfirmed: false, confirm: true } }), 'import');
    assert.ok(JSON.stringify(imported).length > 0); assert.equal(await db.collection('financebankrows').countDocuments({ bankAccountId: new (requireRoot('mongodb').ObjectId)(w.ids[1]) }), 2, 'app:csv-import-kept');
    out.push('A6 manual 取得 after the day\'s run 200 (retrieve); template-free PayPay first capture 200 (retrieve, unmapped); 口座管理プラス 200 (observe); owner CSV import of 2 fictional rows unchanged');
    assert.match(app.logs(), /\[Finance\] bank schedule every 1000 ms/, 'app:plugin-started'); assert.match(app.logs(), /sync schedule disabled \(OMF_SYNC_SCHEDULE_MS=0\)/, 'app:aplus-timer-separate');
    out.push('A7 logs: the bank timer runs beside the unchanged, separately disabled Aplus timer');
    await app2.close();
  } finally { for (const a of apps) await a.close().catch(() => {}); await client.close().catch(() => {}); }
  for (const a of apps) assert.equal(a.alive(), false, 'app:every-server-closed');
}
async function legC(mongo, base, out) {
  const { MongoClient, ObjectId } = requireRoot('mongodb'), client = await MongoClient.connect(mongo.getUri('omf_sched_ui')), db = client.db('omf_sched_ui');
  const app = await bootApp(OUTPUT_ROOT, mongo, 'omf_sched_ui', path.join(base, 'ui-data'), 0);
  const { browserFor } = await import(pathToFileURL(path.join(root, 'collector/browser.mjs')).href), profileDir = await mkdtemp(path.join(os.tmpdir(), 'omf-sched-browser-')), browser = await browserFor(path.join(profileDir, 'profile'), { headless: true });
  const shots = EVIDENCE ? path.join(EVIDENCE, 'screenshots') : null, errors = [], blocked = [];
  try {
    let w, R, P, H, V, U;
    try { w = await appWorld({ app }, db, 'ui', { five: false }); R = await w.account('UI 楽天銀行 普通', RAKUTEN); P = await w.account('UI PayPay銀行 1', paypay(w.template, 1)); H = await w.account('UI PayPay銀行 2', paypay(w.template, 2)); V = await w.account('UI 楽天銀行 確認待ち', RAKUTEN); U = await w.account('UI PayPay銀行 未割り当て', { provider: 'paypay', variant: 'standard', coverage: { from: '2025-11-01', to: null } }); await w.grant([R, P, H, V, U]); }
    catch (e) { throw new Error('SETUP fictional world (accounts, connections, PC grant): ' + e.message); }
    const { ok, req } = w;
    for (const id of [R, H, V]) ok(await req('bank/accounts/' + id + '/schedule', { method: 'PUT', body: { enabled: true, hour: 9, revision: 0 } }), 'enable');
    const failed = ok(await req('bank/accounts/' + H + '/sync', { method: 'POST', body: {} }), 'sync H').job; assert.equal((await w.claim()).job.jobId, failed.jobId); ok(await w.status(failed.jobId, 'failed', 'Open the downloader setup screen on the connected PC for details'), 'fail H');
    const waiting = ok(await req('bank/accounts/' + V + '/sync', { method: 'POST', body: {} }), 'sync V').job; assert.equal((await w.claim()).job.jobId, waiting.jobId); ok(await w.status(waiting.jobId, 'verification_required', '楽天銀行にChromeでサインインしてください'), 'attention V');
    const page = await browser.newPage(); await page.setViewport({ width: 390, height: 844 });
    await page.setRequestInterception(true); page.on('request', r => { if (r.url().startsWith(app.origin) || r.url().startsWith('data:') || r.url().startsWith('blob:')) r.continue(); else { blocked.push(new URL(r.url()).host); r.abort(); } });
    page.on('pageerror', e => errors.push(String(e))); page.on('console', msg => { if (msg.type() === 'error' && !/^Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
    const wait = async (f, arg, label) => { for (let i = 0; i < 250; i++) { if (await page.evaluate(f, arg)) return; await pause(100); } throw new Error('ui:condition ' + label); };
    const card = id => '[data-bank-connection="' + id + '"] ', text = async (id, sel) => page.$eval(card(id) + sel, e => e.textContent.trim());
    const shot = async name => { if (shots) { await mkdir(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true }); } };
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    const open = async () => { await page.goto(app.origin + '/intake/payments', { waitUntil: 'networkidle2' }); await wait(() => !!document.querySelector('[data-bank-connections-open]'), null, 'page'); await page.click('[data-bank-connections-open]'); await wait(id => !!document.querySelector('[data-bank-connection="' + id + '"] [data-bank-schedule-status]')?.textContent.trim(), R, 'card'); };
    await page.goto(app.origin + '/login', { waitUntil: 'networkidle2' }); await page.type('#email', w.email); await page.type('#password', w.password); await page.evaluate(() => document.querySelector('button[type="submit"]').click()); await wait(() => location.pathname === '/', null, 'login');
    await open();
    const dueOrWaiting = /状態: (本日 9時（日本時間）を過ぎたため、まもなく予約されます|次回は \d{4}-\d{2}-\d{2} 09:00（日本時間）以降に予約されます)/;
    assert.match(await text(R, '[data-bank-schedule-saved]'), /保存済みの設定: 毎日 9時（日本時間）以降に1回、自動で取得 · 取得期間 2025-11-01〜取得する日の当日/, 'ui:saved-text');
    assert.match(await text(R, '[data-bank-schedule-status]'), dueOrWaiting, 'ui:due-or-waiting');
    assert.match(await text(H, '[data-bank-schedule-status]'), /本日分は実行済み（失敗）（手動の取得/, 'ui:failed-day-counted');
    assert.match(await text(H, '[data-bank-schedule-last-failure]'), /要対応 — 前回の取得は失敗しました（手動の取得 · .*）。理由は下の「取得の記録」に表示されます。.*毎日の自動取得は続けますが、確認できていない保存済みのログインは自動では送信しません/, 'ui:last-failure'); assert.equal(await page.$eval(card(H) + '[data-bank-schedule-last-failure]', e => e.getAttribute('role')), 'alert');
    assert.equal(await page.$(card(H) + '[data-bank-schedule-resume]'), null, 'ui:no-hold-control');
    assert.match(await text(V, '[data-bank-schedule-status]'), /要対応 — 銀行のサインイン・追加の確認待ちです。接続したPCのChromeで操作してください（手動の取得/, 'ui:attention');
    assert.equal(await page.$(card(U) + '[data-bank-schedule-enabled]'), null, 'ui:unsupported-no-toggle'); assert.match(await text(U, '[data-bank-schedule-unsupported]'), /列の割り当て（テンプレート）がない接続は、毎日の自動取得の対象外です。.*ボタンはこれまでどおり使えます/, 'ui:unsupported-text');
    assert.ok(await page.$(card(U) + '[data-bank-sync]'), 'ui:unsupported-manual-button');
    assert.match(await text(P, '[data-bank-schedule-saved]'), /オフ（自動では取得しません）/); assert.match(await text(P, '[data-bank-schedule-status]'), /自動取得はオフです/);
    await shot('390-states'); assert.equal(await overflow(), false, 'ui:no-overflow-390');
    await page.click(card(P) + '[data-bank-schedule-enabled]'); await page.select(card(P) + '[data-bank-schedule-hour]', '6');
    await wait(id => !!document.querySelector('[data-bank-connection="' + id + '"] [data-bank-schedule-unsaved]'), P, 'unsaved'); assert.match(await text(P, '[data-bank-schedule-saved]'), /オフ/, 'ui:unsaved-not-shown-as-saved');
    const connectionBefore = (await db.collection('financebankaccounts').findOne({ _id: new ObjectId(P) })).connection;
    await page.click(card(P) + '[data-bank-schedule-save]'); await wait(id => /毎日 6時/.test(document.querySelector('[data-bank-connection="' + id + '"] [data-bank-schedule-saved]')?.textContent || ''), P, 'saved');
    const savedP = await db.collection('financebankaccounts').findOne({ _id: new ObjectId(P) });
    assert.deepEqual([savedP.schedule.enabled, savedP.schedule.hour, savedP.schedule.revision], [true, 6, 1], 'ui:saved'); assert.deepEqual(savedP.connection, connectionBefore, 'ui:connection-untouched');
    assert.equal(await page.$(card(P) + '[data-bank-schedule-unsaved]'), null);
    await page.select(card(P) + '[data-bank-schedule-hour]', '7');
    ok(await req('bank/accounts/' + P + '/schedule', { method: 'PUT', body: { enabled: true, hour: 8, revision: 1 } }), 'other screen');
    await page.click(card(P) + '[data-bank-schedule-save]'); await wait(id => !!document.querySelector('[data-bank-connection="' + id + '"] [data-bank-schedule-error]'), P, 'stale');
    assert.match(await text(P, '[data-bank-schedule-error]'), /他の画面で変更されました/, 'ui:stale-refused'); assert.match(await text(P, '[data-bank-schedule-saved]'), /毎日 8時/, 'ui:stale-reloaded');
    assert.equal((await db.collection('financebankaccounts').findOne({ _id: new ObjectId(P) })).schedule.hour, 8, 'ui:stale-not-written');
    await shot('390-stale');
    ok(await req('bank/accounts/' + R + '/connection', { method: 'PUT', body: { ...RAKUTEN, templateId: w.template } }), 'change R connection');
    await open(); assert.match(await text(R, '[data-bank-schedule-status]'), /要確認 — 保存したときから接続（銀行・ログイン方式・テンプレート）が変わったため、自動取得を止めています/, 'ui:reconfirm');
    assert.equal(await page.$eval(card(R) + '[data-bank-schedule-save]', e => [e.disabled, e.textContent.trim()].join('|')), 'false|現在の接続で自動取得を保存し直す', 'ui:reconfirm-save-enabled');
    await shot('390-reconfirm'); await page.click(card(R) + '[data-bank-schedule-save]'); await wait(id => !/要確認/.test(document.querySelector('[data-bank-connection="' + id + '"] [data-bank-schedule-status]')?.textContent || ''), R, 'reconfirmed');
    assert.match(await text(R, '[data-bank-schedule-status]'), dueOrWaiting, 'ui:reconfirmed'); assert.equal((await db.collection('financebankaccounts').findOne({ _id: new ObjectId(R) })).schedule.binding.templateId, w.template, 'ui:reconfirm-recorded');
    const jobText = await page.$eval(card(H), e => e.textContent); assert.doesNotMatch(jobText, /Error|undefined|null|omfc_|Stack/, 'ui:no-raw-error');
    const html = await page.content(); assert.ok(!html.includes(w.device.token), 'ui:no-token');
    // Phase C (parent lead 8): one instant, one rendering. The same failed run reads the same labelled Japan time in its status line and in
    // 取得の記録; a run requested at 17:12 UTC (02:12 JST the next day) is shown on the JST date; an absent or unreadable stored time
    // renders as nothing, never as a crash or "Invalid Date". Stored times are not changed.
    const T = await w.account('UI 楽天銀行 時刻', RAKUTEN); await w.grant([R, P, H, V, U, T]);
    const instant = new Date('2026-10-24T17:12:00.000Z'), jobBase = { ownerId: w.owner._id, bankAccountId: new ObjectId(T), kind: 'retrieve', open: false, snapshot: { provider: 'rakuten' }, snapshotHash: 'fictional', statementIds: [], observation: null, trigger: 'manual' };
    await db.collection('financebankjobs').insertMany([{ ...jobBase, jobId: 'ui-boundary-failed', state: 'failed', requestedAt: instant, completedAt: instant, lastMessage: 'fictional failure at the UTC/JST date boundary' }, { ...jobBase, jobId: 'ui-absent-time', state: 'complete', requestedAt: null, completedAt: null, lastMessage: 'fictional run without a stored time' }, { ...jobBase, jobId: 'ui-unreadable-time', state: 'complete', requestedAt: 'not-a-date', completedAt: null, lastMessage: 'fictional run with an unreadable stored time' }]);
    await open(); await wait(id => !!document.querySelector('[data-bank-connection="' + id + '"] [data-bank-job="ui-boundary-failed"]'), T, 'time jobs');
    assert.match(await text(T, '[data-bank-schedule-last-failure]'), /2026-10-25 02:12/, 'ui:jst-status-same-instant');
    const logLine = await text(T, '[data-bank-job="ui-boundary-failed"]');
    assert.match(logLine, /2026-10-25 02:12（日本時間）/, 'ui:jst-log-same-instant (取得の記録 shows the same Japan time, labelled) ' + logLine); assert.doesNotMatch(logLine, /2026-10-24 17:12/, 'ui:jst-log-not-utc');
    for (const jobId of ['ui-absent-time', 'ui-unreadable-time']) { const line = await text(T, '[data-bank-job="' + jobId + '"]'); assert.doesNotMatch(line, /Invalid|NaN|undefined|not-a-date|（日本時間）/, 'ui:jst-tolerant ' + jobId + ' ' + line); }
    assert.equal((await db.collection('financebankjobs').findOne({ jobId: 'ui-boundary-failed' })).requestedAt.toISOString(), instant.toISOString(), 'ui:stored-time-unchanged');
    await shot('390-times'); if (shots) await (await page.$('[data-bank-connection="' + T + '"]')).screenshot({ path: path.join(shots, '390-times-card.png') }); assert.equal(await overflow(), false, 'ui:no-overflow-390-times');
    await page.setViewport({ width: 1440, height: 1000 }); await pause(300); assert.equal(await overflow(), false, 'ui:no-overflow-1440'); await shot('1440-states');
    await page.evaluate(() => document.documentElement.classList.add('dark')); await pause(200); assert.equal(await overflow(), false, 'ui:dark'); await shot('1440-dark');
    await page.setViewport({ width: 390, height: 844 }); await pause(300); assert.equal(await overflow(), false, 'ui:dark-390'); await shot('390-dark');
    assert.match(app.logs(), /bank schedule disabled \(OMF_BANK_SCHEDULE_MS=0\)/, 'ui:timer-off');
    assert.deepEqual(errors, [], 'ui:no-page-errors'); assert.ok([...new Set(blocked)].every(h => h && !h.startsWith('127.0.0.1')), 'ui:outside-requests-aborted');
    out.push('C Chrome 390/1440/dark (every request outside the owned app aborted: ' + ([...new Set(blocked)].join(', ') || 'none') + '): saved vs state texts (due/waiting, failed day + last failure, attention, off, unsupported+manual button), opt-in save (6時, connection untouched), unsaved notice, stale save refused and reloaded, a failed run shown with the day counted (no hold control), changed connection → 要確認 → re-saved from the screen, no overflow, no page errors');
  } finally { await browser.close().catch(() => {}); await app.close(); await client.close().catch(() => {}); await rm(profileDir, { recursive: true, force: true }).catch(() => {}); }
}

// ════════════════════════════ M: reintroduced defects in copies of server/ and shared/ ════════════════════════════
const MUTANTS = [
  ['MS1-today-run-ignored', 'shared/finance-bank-schedule.mjs', /if \(today\) return out\('done-today'/g, "if (false) return out('done-today'", 'S7', /sched:manual-counts/],
  ['MS2-utc-day', 'shared/finance-bank-schedule.mjs', /export function jstDay\(now\) \{ return new Date\(now\.getTime\(\) \+ JST_MS\)\.toISOString\(\)\.slice\(0, 10\); \}/g, 'export function jstDay(now) { return now.toISOString().slice(0, 10); }', 'S2', /sched:jst-midnight/],
  ['MS3-close-and-mint', 'server/services/financeBankScheduleService.ts', /  if \(status\.state !== 'due'\) return result\n/g, "  if (status.state === 'interrupted') { await BankJob.updateMany({ ownerId: account.ownerId, bankAccountId: account._id, open: true, state: { $in: ['running', 'verification_required'] }, leaseUntil: { $lt: now } }, { $set: { open: false } }); status.state = 'due' }\n  if (status.state !== 'due') return result\n", 'S7', /sched:interrupted-no-duplicate/],
  ['MS4-claim-check-dropped', 'server/services/financeBankCollectionService.ts', /if\(job\.trigger==='schedule'&&!job\.schedule\?\.claimedAt\)\{/g, 'if(false){', 'S12', /sched:stale-claim-refused/],
  ['MS5-failure-holds-schedule', 'shared/finance-bank-schedule.mjs', /  if \(!collectorIds\.length\) return out\('waiting-pc'\);\n/g, "  if (lastFailure) return out('held');\n  if (!collectorIds.length) return out('waiting-pc');\n", 'S8', /sched:failure-shown/],
  ['MS6-closed-period-replaced', 'server/services/financeBankCollectionService.ts', /const \{snapshot,snapshotHash\}=snapshotOf\(account\.connection,template,account,day\)/g, 'const {snapshot,snapshotHash}=snapshotOf({...account.connection,coverage:account.connection.coverage&&{from:account.connection.coverage.from,to:null}},template,account,day)', 'S9', /sched:closed-period-kept/],
  ['MS7-earlier-run-not-replaced', 'server/services/financeBankScheduleService.ts', /  for \(const job of await queuedScheduled\(account\)\) if \(job\.schedule\.day < day && await supersede\(job, now, REPLACED_DAY\)\) result\.superseded\.push\(job\.jobId\)\n/g, '', 'S3', /sched:coalesce/],
  ['MS9-earlier-run-ignored-at-claim', 'shared/finance-bank-schedule.mjs', /  if \(earlier\) return 'already-requested-today';\n/g, '', 'S12', /sched:manual-between/],
  ['MS10-setting-revision-ignored-at-claim', 'shared/finance-bank-schedule.mjs', /  if \(job\?\.schedule\?\.revision !== s\.revision\) return 'setting-changed';\n/g, '', 'S12', /sched:stale-setting-claim-refused/],
  ['MS11-save-keeps-older-queued-run', 'server/services/financeBankScheduleService.ts', /  for \(const job of await queuedScheduled\(fresh\)\) await supersede\(job, now, REPLACED_SETTING\)\n/g, '', 'S12', /sched:save-closes-older-queued/],
  ['MS8-revision-not-compared', 'server/services/financeBankScheduleService.ts', /, 'schedule\.revision': raw === undefined \? \{ \$exists: false \} : raw \}/g, ' }', 'S9', /sched:revision-cas/]
];

// ════════════════════════════ The fixture ════════════════════════════
function runChild(args, env, timeout) {
  return new Promise(resolve => {
    const started = Date.now(), child = execFile(process.execPath, args, { cwd: root, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      const text = String(stdout || ''), lines = text.split(/\r?\n/);
      resolve({ ms: Date.now() - started, code: error ? (error.code ?? 1) : 0, killed: !!error?.killed, text, stderr: String(stderr || ''), passes: lines.filter(l => l.startsWith('PASS ')), fails: lines.filter(l => l.startsWith('FAIL ')), setup: lines.find(l => l.startsWith('SETUP ')) || null, receipt: (() => { try { return JSON.parse((lines.find(l => l.startsWith('RECEIPT ')) || '').slice(8)); } catch { return null; } })() });
    });
    return child;
  });
}
export default { name: 'omf-bank-schedule', covers: COVERS, async run() {
  const started = Date.now(), lines = [], green = new Set(); let pass = true, executed = false;
  const counts = { unitTests: null, harnessLegs: 0, appLegs: 0, chrome: 0, regression: {}, mutantsCaught: 0, mutantsTotal: MUTANTS.length };
  const want = name => !ONLY.length || ONLY.includes(name);
  const keep = async (name, text) => { if (EVIDENCE) { await mkdir(EVIDENCE, { recursive: true }); await writeFile(path.join(EVIDENCE, 'leg-' + name + '.txt'), text); } };
  const leg = async (name, fn) => { const key = name.split(' ')[0]; if (!want(key)) return; const t = Date.now(); try { lines.push(name + ': ' + await fn() + ' (' + Math.round((Date.now() - t) / 1000) + 's)'); green.add(key); } catch (e) { pass = false; const msg = String(e?.message || e).replace(/\s+/g, ' ').slice(0, 1600); lines.push(name + ': ' + (/^(SETUP|NOT RUN)/.test(msg) ? '' : 'RED ') + msg); } };
  const base = await mkdtemp(path.join(os.tmpdir(), 'omf-sched-fixture-')); let mongo = null;
  process.env.OMF_SCHEDULE_JWT = randomBytes(32).toString('hex');
  try {
    await leg('U node --test test/finance-bank-schedule.test.mjs', async () => {
      const r = await runChild(['--test', 'test/finance-bank-schedule.test.mjs'], {}, 120000), passed = Number((r.text.match(/ℹ pass (\d+)/) || [])[1]), failedN = Number((r.text.match(/ℹ fail (\d+)/) || [])[1]);
      await keep('U', r.text + r.stderr); counts.unitTests = passed;
      if (r.code !== 0 || failedN !== 0 || !passed) throw new Error((/Cannot find module|ERR_MODULE_NOT_FOUND/.test(r.text + r.stderr) ? 'SETUP shared module absent: ' : 'exit ' + r.code + ': ') + (r.text + r.stderr).replace(/\s+/g, ' ').slice(-600));
      return passed + ' unit tests green';
    });
    const { MongoMemoryServer } = requireRoot('mongodb-memory-server');
    mongo = await MongoMemoryServer.create({ binary: existsSync(BINARY) ? { systemBinary: BINARY, version: '8.2.1' } : undefined, instance: { args: ['--setParameter', 'enableTestCommands=1'] } });
    const harness = async (src, db, legs = '') => runChild(['--import', 'tsx', SELF, HARNESS_FLAG, src], { OMF_SCHEDULE_MONGO_URI: mongo.getUri(), OMF_SCHEDULE_DB: db, OMF_SCHEDULE_ONLY_S: legs, MONGO_URI: '', MONGODB_URI: '' }, 900000);
    await leg('S services and routes on the owned MongoDB with an injected JST clock (S1-S11)', async () => {
      const r = await harness(SRC_ROOT, 'omf_sched_s'); executed = true; await keep('S', r.text + '\n--- stderr ---\n' + r.stderr);
      counts.harnessLegs = r.passes.length;
      if (r.setup) throw new Error(r.setup + ' (no behavioural result)');
      if (r.code !== 0 || !r.receipt?.pass || r.fails.length) throw new Error(r.fails.length + ' failed / ' + r.passes.length + ' green: ' + (r.fails.join(' | ') || r.stderr.slice(-800)).slice(0, 1500));
      return r.passes.length + ' legs green — ' + r.passes.map(p => p.slice(5, 9).trim()).join(' ') + (/NOTE S6 (.*)/.exec(r.text)?.[0] ? '; ' + /NOTE S6 (.*)/.exec(r.text)[0] : '');
    });
    await leg('A built app with its real plugin timer (' + (OUTPUT_ROOT === root ? 'this tree' : OUTPUT_ROOT) + ')', async () => {
      if (!existsSync(path.join(OUTPUT_ROOT, '.output/server/index.mjs'))) throw new Error('NOT RUN: built app absent');
      const out = []; executed = true; APP_LOGS.length = 0; try { await legA(mongo, base, out); } finally { counts.appLegs = out.length; await keep('A', out.join('\n') + '\n\n' + APP_LOGS.map(a => '--- app ' + a.dbName + ':' + a.port + ' ---\n' + a.logs()).join('\n')); }
      return out.join(' · ');
    });
    await leg('C owned headless Chrome on the built app', async () => {
      if (!existsSync(path.join(OUTPUT_ROOT, '.output/server/index.mjs'))) throw new Error('NOT RUN: built app absent');
      const out = []; APP_LOGS.length = 0; try { await legC(mongo, base, out); } finally { counts.chrome = out.length; await keep('C', out.join('\n') + '\n\n' + APP_LOGS.map(a => '--- app ' + a.dbName + ':' + a.port + ' ---\n' + a.logs()).join('\n')); }
      return out.join(' · ') + (EVIDENCE ? '; screenshots ' + path.join(EVIDENCE, 'screenshots') : '');
    });
    for (const [key, flag, summary, extra] of [['R1', 'OMF_TEST_BANK_COLLECTION_ONLY', /(\d+) targeted bank collection checks passed/, /^PASS V hidden real Chrome/], ['R2', 'OMF_TEST_PAYMENTS_ONLY', /(\d+) targeted [^\n]*checks passed/, null]]) {
      await leg(key + ' existing integration unchanged (' + flag + ', scripts/finance-integration.cjs, own owned MongoDB)', async () => {
        const r = await runChild(['scripts/finance-integration.cjs'], { MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', [flag]: '1', ...(existsSync(BINARY) ? { MONGOMS_SYSTEM_BINARY: BINARY } : {}) }, 1200000);
        await keep(key, r.text + '\n--- stderr ---\n' + r.stderr);
        const passes = r.text.split('\n').filter(l => l.startsWith('PASS ')), s = r.text.match(summary);
        if (r.code !== 0 || !s) throw new Error('exit ' + r.code + '; last PASS: ' + (passes.at(-1)?.slice(5, 140) || 'none') + '; ' + (r.text + r.stderr).replace(/\s+/g, ' ').slice(-1200));
        if (extra && !passes.some(p => extra.test(p))) throw new Error('the existing Chrome leg on BankConnections.vue did not pass');
        counts.regression[key] = Number(s[1]); return s[0] + ', ' + passes.length + ' PASS lines';
      });
    }
    await leg('M reintroduced defects in copies of server/ and shared/ (each run only on its leg; the unchanged copy first)', async () => {
      if (!green.has('S')) throw new Error('NOT RUN: leg S must be green first');
      const copyTree = async label => { const dir = path.join(root, '.cache', 'omf-sched-' + label); await rm(dir, { recursive: true, force: true }); for (const d of ['server', 'shared']) await cp(path.join(root, d), path.join(dir, d), { recursive: true }); return dir; };
      const control = await copyTree('control'); try { const r = await harness(control, 'omf_sched_mcontrol', 'S3,S7'); if (r.code !== 0 || r.fails.length) throw new Error('unchanged copy failed: ' + r.fails.join(' | ').slice(0, 500)); } finally { await rm(control, { recursive: true, force: true }); }
      const caught = [];
      for (const [label, file, anchor, replacement, legName, pattern] of MUTANTS) {
        const dir = await copyTree(label.toLowerCase());
        try {
          const target = path.join(dir, file), source = (await readFile(target, 'utf8')).replace(/\r\n/g, '\n'), hits = (source.match(anchor) || []).length;
          if (hits !== 1) throw new Error(label + ' anchor hits ' + hits);
          await writeFile(target, source.replace(anchor, replacement));
          const r = await harness(dir, 'omf_sched_' + label.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30), legName);
          if (!r.fails.length || !pattern.test(r.fails[0])) throw new Error(label + ' did not fail ' + pattern + ': ' + (r.fails[0] || r.passes.join(' ') || r.setup || r.stderr.slice(-300)).slice(0, 400));
          caught.push(label + '→' + r.fails[0].match(pattern)[0]); counts.mutantsCaught++;
        } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
      }
      await keep('M', caught.join('\n')); return 'control green; ' + caught.join(', ');
    });
  } catch (e) { pass = false; lines.push('setup: ' + String(e?.message || e).slice(0, 800)); }
  finally { if (mongo) await mongo.stop().catch(() => {}); await rm(base, { recursive: true, force: true }).catch(() => {}); }
  return { pass, databaseCoverage: { executed, ownedProcess: executed }, message: (pass ? 'green' : 'RED') + ' in ' + Math.round((Date.now() - started) / 1000) + 's ' + JSON.stringify(counts) + '\n' + lines.join('\n') };
} };

if (process.argv.includes(HARNESS_FLAG)) await harnessMain(path.resolve(process.argv[process.argv.indexOf(HARNESS_FLAG) + 1]));
else if (process.argv.includes(TICK_FLAG)) await tickMain(path.resolve(process.argv[process.argv.indexOf(TICK_FLAG) + 1]), process.argv[process.argv.indexOf(TICK_FLAG) + 2]);
