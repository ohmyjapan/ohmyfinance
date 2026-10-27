'use strict';
// scripts/finance-bank-balance-integration.cjs — hourly background bank balances (plan omf-bank-hourly-balances-20261027): the real
// services, owner and collector routes (h3) and the real collector code on an owned mongodb-memory-server with an injected clock (S),
// and the built app with its real plugin timer in an owned headless Chrome on components/intake/BankConnections.vue (--ui).
// Run it through the hub fixture scripts/zoomer-fixtures/omf-bank-balances.mjs (node <hub>/scripts/zoomer-verify.mjs --run-fixture
// omf-bank-balances.mjs --cwd <worktree>); never against a shared database: it starts its own MongoDB and refuses any other address.
// Evidence, stated exactly: synthetic only. Fictional owners, accounts, PCs, amounts and bank times; no bank, network, credential, vault,
// model or production database. The bank pages themselves are covered by collector/test/bank-balance.test.mjs (intercepted Chromium).
//   node --import tsx scripts/finance-bank-balance-integration.cjs [--ui]   (OMF_BALANCE_ONLY=S1,S3 selects legs)
// OMF_BALANCE_SRC points the S legs at another server/ + shared/ tree (a mutant copy or the base revision), OMF_TEST_INDEX_MODULE at a
// mutant copy of collector/index.mjs (beside the original); OMF_BALANCE_OUTPUT points
// --ui at another built app. Every leg prints PASS/FAIL <name>; the last line is RECEIPT {pass, legs}.
const { spawn } = require('node:child_process');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { existsSync } = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const SRC = process.env.OMF_BALANCE_SRC ? path.resolve(process.env.OMF_BALANCE_SRC) : root;
const OUTPUT = process.env.OMF_BALANCE_OUTPUT ? path.resolve(process.env.OMF_BALANCE_OUTPUT) : root;
const BINARY = path.join(root, '..', 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
const ONLY = (process.env.OMF_BALANCE_ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
const EVIDENCE = process.env.OMF_BALANCE_EVIDENCE || '';
const pause = ms => new Promise(r => setTimeout(r, ms));
const sha256 = v => createHash('sha256').update(v).digest('hex');
const u = p => pathToFileURL(path.join(SRC, p)).href, c = p => pathToFileURL(path.join(root, p)).href;
const SOURCES = { rakuten: { origin: 'https://fes.rakuten-bank.co.jp', path: '/XMS/inquiry/gns', labels: ['普通預金残高', '支払可能残高'] }, paypay: { origin: 'https://login.paypay-bank.co.jp', path: '/wctx/NBCW2101.do', labels: ['普通預金残高'] }, ikeda: { origin: 'https://www.0161.houjinportal.anser.ne.jp', path: '/', labels: ['各口座残高'] } };
const RAKUTEN = { provider: 'rakuten', variant: 'standard', coverage: { from: '2025-11-01', to: null } };
const PAYPAY = { provider: 'paypay', variant: 'standard' };
const IDENTITY = { branch: 'カクウ支店', type: '普通', number: '0000001' };
const JST_MS = 9 * 3600000;
const jstDay = now => new Date(now.getTime() + JST_MS).toISOString().slice(0, 10);
const nextDay = day => new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
const at = (day, h, mi = 0, s = 0) => new Date(Date.parse(day + 'T00:00:00Z') + h * 3600000 + mi * 60000 + s * 1000 - JST_MS);
const slotKey = (day, h) => day + 'T' + String(h).padStart(2, '0') + ':00';

async function ownedMongo() {
  const { MongoMemoryServer } = require(require.resolve('mongodb-memory-server', { paths: [root] }));
  return MongoMemoryServer.create({ binary: existsSync(BINARY) ? { systemBinary: BINARY, version: '8.2.1' } : undefined, instance: { launchTimeout: 120000 } });
}
function guardUri(uri, dbName) {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?/.test(uri) || /:27017\//.test(uri) || !/^omf_balance_[a-z0-9_]+$/.test(dbName)) { console.log('SETUP refused: not an owned ephemeral database address'); process.exit(3); }
}

// ════════════════════════════ S: services, routes and the collector under tsx ════════════════════════════
async function harness() {
  const mongo = await ownedMongo(), dbName = 'omf_balance_s', uri = mongo.getUri(dbName); guardUri(uri, dbName);
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'omf-balance-harness-'));
  Object.assign(process.env, { MONGO_URI: uri, JWT_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'test', OMF_DATA_DIR: path.join(temp, 'data'), OMF_COLLECTOR_DIR: path.join(temp, 'collector') });
  let m;
  try {
    const mongoose = (await import('mongoose')).default, jwt = (await import('jsonwebtoken')).default, h3 = await import('h3'), http = await import('node:http');
    m = { mongoose, jwt, h3, http, User: (await import(u('server/models/User.ts'))).default, Finance: await import(u('server/models/Finance.ts')), Pay: await import(u('server/models/FinancePaymentMatch.ts')),
      schedule: await import(u('server/services/financeBankScheduleService.ts')), payments: (await import(u('server/api/finance-payments/[...path].ts'))).default, collector: (await import(u('server/api/finance-payments/collector/[...path].ts'))).default, finance: (await import(u('server/api/finance/[...path].ts'))).default,
      auth: (await import(u('server/middleware/auth.ts'))).default, digest: (await import(u('shared/amex.mjs'))).digest, index: await import(process.env.OMF_TEST_INDEX_MODULE ? pathToFileURL(process.env.OMF_TEST_INDEX_MODULE).href : c('collector/index.mjs')) };
  } catch (e) { console.log('SETUP module unavailable: ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 300)); process.exit(3); }
  // The new service (absent before this plan): its absence is a named assertion of the legs that drive the clock, not a setup error.
  let svc = null; try { svc = await import(u('server/services/financeBankBalanceService.ts')); } catch { svc = null; }
  const { mongoose, jwt, h3, User } = m, { FinanceCollector } = m.Finance, { BankAccount, BankJob, BankTemplate } = m.Pay;
  // Bounded database operations (the services share this connection): a hung operation errors instead of waiting without end.
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000, socketTimeoutMS: 120000 }); assert.equal(mongoose.connection.name, dbName);
  await m.Pay.initializePaymentMatching(); await m.Finance.initializeFinance?.();
  const db = mongoose.connection.db, balances = db.collection('financebankbalances');
  const app = h3.createApp(); app.use(m.auth); // The card collector routes (unchanged, out of scope) are mounted too: the real claimWork asks them first.
  app.use(h3.defineEventHandler(e => e.path.startsWith('/api/finance-payments/collector/') ? m.collector(e) : e.path.startsWith('/api/finance-payments/') ? m.payments(e) : e.path.startsWith('/api/finance/') ? m.finance(e) : undefined));
  const server = m.http.createServer(h3.toNodeListener(app)); await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
  // Every request is bounded (REQUEST_MS) and recorded as the leg's last step; a slow one prints a STEP progress line, so a stalled leg
  // fails with its own name and step instead of vanishing into the outer wait.
  const REQUEST_MS = Number(process.env.OMF_BALANCE_REQUEST_MS) || 60000; let lastStep = 'start';
  const call = async (route, { method = 'GET', token, body, raw, type = 'application/json' } = {}) => {
    const t = Date.now(); lastStep = method + ' ' + route.split('?')[0];
    const r = await fetch(origin + route, { method, signal: AbortSignal.timeout(REQUEST_MS), headers: { 'Content-Type': type, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(raw !== undefined ? { body: raw } : body === undefined ? {} : { body: JSON.stringify(body) }) }).catch(e => { throw new Error('request ' + lastStep + ' failed after ' + (Date.now() - t) + ' ms: ' + (e?.name || 'Error')); });
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    const ms = Date.now() - t; if (ms > 5000) console.log('STEP slow ' + ms + ' ms ' + lastStep + ' → ' + r.status);
    return { status: r.status, data };
  };
  const api = '/api/finance-payments/', capi = api + 'collector/', oid = v => new mongoose.Types.ObjectId(String(v));
  const ok = (r, label) => { assert.equal(r.status, 200, label + ' ' + JSON.stringify(r.data).slice(0, 400)); return r.data; };
  const owner = async tag => { const email = 'balance-' + tag + '@example.invalid', user = await User.create({ email, name: 'Synthetic owner ' + tag, password: 'Synthetic-only-Strong-Password1!' }), id = String(user._id); return { id, token: jwt.sign({ userId: id, email, type: 'access', jti: randomUUID() }, process.env.JWT_SECRET, { expiresIn: '3h' }) }; };
  const template = async o => ok(await call(api + 'bank/templates', { method: 'PUT', token: o.token, body: { name: 'Synthetic template ' + randomUUID().slice(0, 6), headers: ['日付', '摘要', '出金', '入金', '残高'], mapping: { date: '0', description: '1', outflow: '2', inflow: '3', balance: '4' }, amountSign: 'outflow-positive' } }), 'template').template.id;
  const account = async (o, name, connection) => { const a = ok(await call(api + 'bank/accounts', { method: 'POST', token: o.token, body: { name, currency: 'JPY' } }), 'create ' + name).account; if (connection) ok(await call(api + 'bank/accounts/' + a.id + '/connection', { method: 'PUT', token: o.token, body: connection }), 'connect ' + name); return a.id; };
  const ikeda = async o => account(o, 'Synthetic 池田泉州銀行 ' + randomUUID().slice(0, 4), { provider: 'ikeda', variant: 'portal', templateId: await template(o), accountIdentity: { ...IDENTITY } });
  const six = async (o, tag) => { const ids = [await account(o, tag + ' 楽天銀行', RAKUTEN)]; for (let i = 1; i <= 4; i++) ids.push(await account(o, tag + ' PayPay銀行 ' + i, PAYPAY)); ids.push(await ikeda(o)); return ids; };
  const device = async (o, ids, name = 'Synthetic PC') => { const token = 'omfc_' + randomBytes(32).toString('hex'), d = await FinanceCollector.create({ ownerId: o.id, name, tokenHash: m.digest(token), accountIds: [], bankAccountIds: ids.map(oid) }); return { id: String(d._id), token }; };
  const view = (o, id) => call(api + 'bank/accounts/' + id + '/balance', { token: o.token });
  const save = (o, id, body) => call(api + 'bank/accounts/' + id + '/balance', { method: 'PUT', token: o.token, body });
  const enable = async (o, id, dev, revision = 0) => ok(await save(o, id, { enabled: true, collectorId: dev.id, revision }), 'enable balance');
  const refresh = (o, id) => call(api + 'bank/accounts/' + id + '/balance/refresh', { method: 'POST', token: o.token, body: {} });
  const claim = async (dev, capable = true) => ok(await call(capi + 'bank/claim', { method: 'POST', token: dev.token, body: capable ? { capabilities: ['balance-v1'] } : {} }), 'claim');
  const status = (dev, jobId, state, message = '') => call(capi + 'bank/status', { method: 'POST', token: dev.token, body: { jobId, state, message } });
  const receiptOf = (job, patch = {}) => { const p = job.snapshot.provider, s = SOURCES[p]; return { v: 1, jobId: job.jobId, snapshotHash: job.snapshotHash, provider: p, variant: job.snapshot.variant, currency: 'JPY', amount: 1234567, available: p === 'rakuten' ? 1200000 : null, asOf: new Date(Date.now() - 60000).toISOString(), observedAt: new Date().toISOString(), source: { ...s, labels: [...s.labels] }, ...patch }; };
  const postReceipt = (dev, job, body, query = {}) => call(capi + 'bank/balance?' + new URLSearchParams({ jobId: job.jobId, snapshotHash: job.snapshotHash, ...query }), { method: 'POST', token: dev.token, raw: typeof body === 'string' ? body : JSON.stringify(body) });
  const finish = async (dev, job, patch = {}) => { ok(await postReceipt(dev, job, receiptOf(job, patch)), 'receipt'); ok(await status(dev, job.jobId, 'complete', 'fictional balance'), 'complete'); };
  const tick = now => { assert.ok(svc && typeof svc.runBalanceSchedule === 'function', 'balance:hourly-tick-service (server/services/financeBankBalanceService.ts runBalanceSchedule)'); lastStep = 'tick ' + now.toISOString(); return svc.runBalanceSchedule(now); };
  const balanceJobs = (id, filter = {}) => BankJob.find({ bankAccountId: oid(id), kind: 'balance', ...filter }).sort({ requestedAt: 1, _id: 1 }).lean();
  const queuedFor = async (r, ids) => r.queued.length ? BankJob.countDocuments({ jobId: { $in: r.queued }, bankAccountId: { $in: ids.map(oid) } }) : 0;
  const readView = (o, id, now) => { assert.ok(svc && typeof svc.readBankBalance === 'function', 'balance:view-service'); return svc.readBankBalance(o.id, id, now); };
  const D = nextDay(jstDay(new Date())), D1 = nextDay(D), D2 = nextDay(D1);
  // Every leg starts with every earlier leg's balance setting off, so a tick acts only on the leg's own accounts.
  const quiet = () => BankAccount.updateMany({ 'balanceSetting.enabled': true }, { $set: { 'balanceSetting.enabled': false } });
  let checks = 0, failed = 0;
  // A leg is bounded too (LEG_MS); its START/PASS/FAIL lines carry the elapsed time and, on a timeout, the last step it reached.
  const LEG_MS = Number(process.env.OMF_BALANCE_LEG_MS) || 600000;
  const leg = async (name, fn) => {
    const key = name.split(' ')[0]; if (ONLY.length && !ONLY.includes(key)) return; const t = Date.now(); let timer; console.log('START ' + key + ' ' + new Date().toISOString());
    try { await Promise.race([(async () => { await quiet(); await fn(); })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('leg timeout after ' + LEG_MS + ' ms; last step ' + lastStep)), LEG_MS); })]); checks++; console.log('PASS ' + name + ' (' + Math.round((Date.now() - t) / 1000) + 's)'); }
    catch (e) { failed++; console.log('FAIL ' + name + ': ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 900) + ' (' + Math.round((Date.now() - t) / 1000) + 's, last step ' + lastStep + ')'); }
    finally { clearTimeout(timer); }
  };

  await leg('S0 the claim contract without any new route: the real collector claim advertises balance-v1 (recorded by a spy OMF), and a balance job on the queue is never handed to a claim without that capability', async () => {
    const bodies = [], spy = m.http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { if (req.url.endsWith('/bank/claim')) bodies.push(b); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(req.url.endsWith('/bank/claim') ? { job: null } : { account: null })); }); });
    await new Promise(r => spy.listen(0, '127.0.0.1', r));
    try { await m.index.claimWork({ baseUrl: 'http://127.0.0.1:' + spy.address().port, token: 'omfc_' + 'e'.repeat(64) }, null); } finally { spy.close(); }
    assert.equal(bodies.length, 1, 'balance:native-bank-claim-sent'); let sent = null; try { sent = JSON.parse(bodies[0]); } catch { sent = null; }
    assert.deepEqual(sent?.capabilities, ['balance-v1'], 'balance:native-claim-advertises ' + bodies[0]);
    const o = await owner('s0'), R = await account(o, 'S0 楽天銀行', RAKUTEN), dev = await device(o, [R]), snapshot = { kind: 'balance', provider: 'rakuten', variant: 'standard', currency: 'JPY' };
    // written straight into the collection (no new route or model needed): the shape this plan's queue uses
    await db.collection('financebankjobs').insertOne({ ownerId: oid(o.id), bankAccountId: oid(R), jobId: randomUUID(), kind: 'balance', state: 'queued', open: true, requestedAt: new Date(), snapshot, snapshotHash: sha256(JSON.stringify(snapshot)), statementIds: [], observation: null, balance: { trigger: 'manual', collectorId: oid(dev.id), revision: 0, binding: { provider: 'rakuten', variant: 'standard' } }, createdAt: new Date(), updatedAt: new Date() });
    try { assert.equal((await claim(dev, false)).job, null, 'balance:old-claim-never-receives-balance'); }
    finally { await db.collection('financebankjobs').deleteMany({ bankAccountId: oid(R) }); }
  });

  await leg('S1 owner view and settings over HTTP: default off, owner-scoped, revision compare-and-set, an owner PC granted this account, supported connections only; the connection and statement schedule are untouched', async () => {
    const o = await owner('s1'), other = await owner('s1x'), R = await account(o, 'S1 楽天銀行', RAKUTEN), N = await account(o, 'S1 未接続'), Z = await account(o, 'S1 りそな', { provider: 'resona', variant: 'direct', templateId: await template(o) });
    const dev = await device(o, [R, Z]), foreign = await device(other, []), ungranted = await device(o, [], 'Synthetic PC without this account');
    const v0 = await view(o, R); assert.equal(v0.status, 200, 'balance:view-route GET bank/accounts/:id/balance ' + JSON.stringify(v0.data).slice(0, 200));
    assert.deepEqual([v0.data.setting.enabled, v0.data.setting.revision, v0.data.status.state, v0.data.latest, v0.data.intervalMinutes, v0.data.supported], [false, 0, 'off', null, 60, true], 'balance:default-off');
    assert.ok(v0.data.collectors.some(x => x.id === dev.id && x.granted === true) && v0.data.collectors.some(x => x.id === ungranted.id && x.granted === false), 'balance:collectors-listed');
    assert.equal((await view(other, R)).status, 404, 'balance:owner-scoped-view');
    assert.equal((await save(other, R, { enabled: true, collectorId: dev.id, revision: 0 })).status, 404, 'balance:owner-scoped-save');
    const before = await BankAccount.findById(R).lean();
    for (const bad of [{ enabled: 'yes', collectorId: dev.id, revision: 0 }, { enabled: true, collectorId: 'x', revision: 0 }, { enabled: true, collectorId: dev.id, revision: 0, intervalMinutes: 5 }]) assert.equal((await save(o, R, bad)).status, 400, 'balance:malformed ' + JSON.stringify(bad));
    assert.equal((await save(o, R, { enabled: true, collectorId: foreign.id, revision: 0 })).status, 400, 'balance:foreign-pc-refused');
    assert.equal((await save(o, R, { enabled: true, collectorId: ungranted.id, revision: 0 })).status, 409, 'balance:pc-must-be-granted');
    assert.equal((await save(o, Z, { enabled: true, collectorId: dev.id, revision: 0 })).status, 400, 'balance:unsupported-connection');
    assert.equal((await save(o, N, { enabled: true, collectorId: dev.id, revision: 0 })).status, 400, 'balance:no-connection');
    const s1 = await enable(o, R, dev); assert.deepEqual([s1.setting.enabled, s1.setting.revision, s1.setting.collectorId], [true, 1, dev.id], 'balance:saved');
    assert.equal((await save(o, R, { enabled: false, collectorId: dev.id, revision: 0 })).status, 409, 'balance:stale-revision');
    const after = await BankAccount.findById(R).lean();
    assert.deepEqual(after.connection, before.connection, 'balance:connection-untouched'); assert.deepEqual(after.schedule ?? null, before.schedule ?? null, 'balance:statement-schedule-untouched');
    assert.deepEqual([after.balanceSetting.binding.provider, after.balanceSetting.binding.variant], ['rakuten', 'standard'], 'balance:binding-recorded');
    const off = ok(await save(o, R, { enabled: false, collectorId: dev.id, revision: 1 }), 'off'); assert.deepEqual([off.setting.enabled, off.setting.collectorId, off.status.state], [false, dev.id, 'off'], 'balance:off-keeps-pc');
    assert.equal(await BankJob.countDocuments({ bankAccountId: oid(R) }), 0, 'balance:saving-queues-nothing');
  });

  await leg('S2 six fictional accounts (楽天銀行 標準, four PayPay銀行 標準, 池田泉州銀行 ビジネスゲート) hourly: one job each per JST hour on the shared queue, nothing again within the hour (repeated and concurrent ticks), the next hour once more; never a statement job or a schedule day', async () => {
    const o = await owner('s2'), ids = await six(o, 'S2'), dev = await device(o, ids);
    for (const id of ids) await enable(o, id, dev);
    assert.equal(await queuedFor(await tick(at(D, 10)), ids), 6, 'balance:hourly-six');
    for (const id of ids) {
      const jobs = await balanceJobs(id); assert.equal(jobs.length, 1, 'balance:hourly-once ' + id); const j = jobs[0];
      assert.deepEqual([j.kind, j.state, j.open, j.balance.trigger, j.balance.slot, String(j.balance.collectorId), j.requestedAt.toISOString()], ['balance', 'queued', true, 'hourly', slotKey(D, 10), dev.id, at(D, 10).toISOString()], 'balance:job-shape');
      assert.equal(j.trigger === 'schedule' || j.schedule?.day !== undefined, false, 'balance:not-a-schedule-day'); assert.equal(j.snapshotHash, sha256(JSON.stringify(j.snapshot)), 'balance:frozen-hash');
      assert.equal(j.snapshot.kind, 'balance', 'balance:snapshot-kind');
    }
    const k = (await BankAccount.findById(ids[5]).lean()), kj = (await balanceJobs(ids[5]))[0]; assert.deepEqual(kj.snapshot.accountIdentity, { ...k.connection.accountIdentity }, 'balance:ikeda-identity-frozen');
    for (const now of [at(D, 10), at(D, 10, 30)]) assert.equal(await queuedFor(await tick(now), ids), 0, 'balance:within-hour ' + now.toISOString());
    const concurrent = await Promise.all([1, 2, 3, 4, 5].map(() => tick(at(D, 10, 45)))); assert.equal(concurrent.reduce((n, r) => n + r.queued.length, 0), 0, 'balance:concurrent-ticks');
    const got = []; for (let i = 0; i < 6; i++) { const r = await claim(dev); assert.ok(r.job, 'balance:claimable ' + i); assert.equal(r.job.kind, 'balance'); got.push(r.job); }
    assert.equal((await claim(dev)).job, null, 'balance:no-seventh');
    for (const j of got) await finish(dev, j);
    for (const now of [at(D, 10, 59, 59)]) assert.equal(await queuedFor(await tick(now), ids), 0, 'balance:before-next-hour');
    for (const id of ids) assert.equal((await readView(o, id, at(D, 10, 59))).status.state, 'done', 'balance:done-this-hour');
    assert.equal(await queuedFor(await tick(at(D, 11)), ids), 6, 'balance:next-hour');
    assert.equal(await queuedFor(await tick(at(D, 11, 20)), ids), 0);
    assert.equal(await BankJob.countDocuments({ bankAccountId: { $in: ids.map(oid) }, kind: { $ne: 'balance' } }), 0, 'balance:no-statement-jobs');
    assert.equal(await db.collection('financebankstatements').countDocuments({}), 0, 'balance:no-statements'); assert.equal(await db.collection('financebankrows').countDocuments({}), 0, 'balance:no-rows');
  });

  await leg('S3 an offline PC: missed hours coalesce into one newest run (earlier queued runs superseded, never claimed); a run received late counts as that hour and the next automatic run waits 60 minutes after it (no 15:59→16:00 burst); a day later still one', async () => {
    const o = await owner('s3'), R = await account(o, 'S3 楽天銀行', RAKUTEN), dev = await device(o, [R]); await enable(o, R, dev);
    for (const h of [12, 13, 14, 15]) assert.equal((await tick(at(D, h))).queued.length >= 1, true, 'balance:offline-tick ' + h);
    const jobs = await balanceJobs(R), queued = jobs.filter(j => j.state === 'queued'), superseded = jobs.filter(j => j.state === 'superseded');
    assert.deepEqual([queued.length, queued[0]?.balance.slot, superseded.length], [1, slotKey(D, 15), 3], 'balance:coalesce');
    assert.ok(superseded.every(j => !j.open && !j.balance.claimedAt && !j.balance.slot && /^20/.test(j.balance.supersededSlot)), 'balance:superseded-unclaimed');
    const r = await claim(dev); assert.equal(r.job.jobId, queued[0].jobId, 'balance:newest-claimed');
    await BankJob.updateOne({ jobId: r.job.jobId }, { $set: { 'balance.claimedAt': at(D, 15, 20) } }); await finish(dev, r.job);
    // cadence (parent acceptance note hour-boundary-spacing): 60 minutes after the bank access, not at the next calendar hour
    assert.equal((await tick(at(D, 15, 40))).queued.length, 0, 'balance:late-claim-counts'); assert.equal((await tick(at(D, 16))).queued.length, 0, 'balance:cooldown-after-late-claim');
    assert.equal((await readView(o, R, at(D, 16))).status.nextAt, at(D, 16, 20).toISOString(), 'balance:next-at-after-cooldown');
    assert.equal((await tick(at(D, 16, 20))).queued.length, 1, 'balance:after-late-claim');
    const s = await claim(dev); await finish(dev, s.job);
    assert.equal((await tick(at(D1, 9, 30))).queued.length, 1, 'balance:long-offline-one'); assert.equal((await tick(at(D1, 9, 50))).queued.length, 0);
  });

  await leg('S4 settings change, restart and races: a save closes still-queued runs of the earlier setting; a run inserted from a setting read before a save, after turning off, for another PC or for a changed connection is closed at the claim (the PC receives nothing); two processes and a restart keep one run per hour', async () => {
    const o = await owner('s4'), R = await account(o, 'S4 楽天銀行', RAKUTEN), K = await ikeda(o), dev = await device(o, [R, K]), dev2 = await device(o, [R, K], 'Synthetic second PC');
    await enable(o, R, dev); await enable(o, K, dev);
    assert.equal((await tick(at(D, 13))).queued.length, 2);
    const saved = ok(await save(o, R, { enabled: true, collectorId: dev2.id, revision: 1 }), 'switch PC'); assert.equal(saved.setting.revision, 2);
    const [closed] = await balanceJobs(R, { state: 'superseded' }); assert.ok(closed && !closed.balance.claimedAt, 'balance:save-closes-queued');
    // the tick of another process read revision 1 just before the save and inserts afterwards (the stale enqueue the claim must refuse)
    const stale = await svc.queueHourlyBalance((await BankAccount.findById(R).lean()), { now: at(D, 13, 30), slot: slotKey(D, 13), revision: 1, collectorId: dev.id });
    assert.ok(stale, 'balance:stale-inserted');
    // K: the identity changed after its run was queued — the claim closes it too (no bank login, no receipt under the old account)
    const [kq] = await balanceJobs(K, { state: 'queued' });
    ok(await call(api + 'bank/accounts/' + K + '/connection', { method: 'PUT', token: o.token, body: { provider: 'ikeda', variant: 'portal', templateId: (await BankAccount.findById(K).lean()).connection.templateId, accountIdentity: { ...IDENTITY, number: '0000002' } } }), 'change identity');
    assert.equal((await claim(dev)).job, null, 'balance:old-pc-and-changed-connection-never-received');
    assert.equal((await BankJob.findOne({ jobId: stale.jobId }).lean()).state, 'superseded', 'balance:stale-setting-claim-refused');
    assert.equal((await BankJob.findOne({ jobId: kq.jobId }).lean()).state, 'superseded', 'balance:changed-connection-claim-refused');
    const kv = await readView(o, K, at(D, 14)); assert.equal(kv.status.state, 'reconfirm', 'balance:reconfirm-after-change');
    // turned off after the tick: the queued hourly run is closed; a manual refresh while off still runs
    ok(await save(o, R, { enabled: true, collectorId: dev2.id, revision: 2 }), 'noop');
    assert.equal((await tick(at(D, 14))).queued.length, 1); ok(await save(o, R, { enabled: false, collectorId: dev2.id, revision: 3 }), 'off');
    assert.equal((await claim(dev2)).job, null, 'balance:off-claim-refused');
    const man = ok(await refresh(o, R), 'manual while off'); assert.equal(man.job.kind, 'balance');
    const mr = await claim(dev2); assert.equal(mr.job?.jobId, man.job.jobId, 'balance:manual-while-off'); assert.equal(mr.job.kind, 'balance'); await finish(dev2, mr.job);
    // two processes and a restart: one run per hour across fresh module instances
    ok(await save(o, R, { enabled: true, collectorId: dev2.id, revision: 4 }), 'on');
    const kids = await Promise.all([childTick(at(D, 17).toISOString()), childTick(at(D, 17).toISOString()), childTick(at(D, 17, 1).toISOString())]);
    assert.ok(kids.every(k => k.code === 0), 'balance:child-ticks ' + kids.map(k => k.out.slice(-300)).join(' | '));
    assert.equal((await balanceJobs(R, { 'balance.slot': slotKey(D, 17) })).length, 1, 'balance:one-per-hour-across-processes');
  });

  await leg('S5 statements keep priority and their daily rules: a manual 取得 replaces a never-claimed balance run, an in-flight one blocks it; a due daily run supersedes a queued balance run; balance jobs never count as a statement run, failure or the day; while a statement job is open no balance run is queued', async () => {
    const o = await owner('s5'), R = await account(o, 'S5 楽天銀行', RAKUTEN), P = await account(o, 'S5 PayPay銀行', PAYPAY), dev = await device(o, [R, P]); await enable(o, R, dev); await enable(o, P, dev);
    assert.equal((await tick(at(D, 9, 10))).queued.length, 2);
    const sync = ok(await call(api + 'bank/accounts/' + R + '/sync', { method: 'POST', token: o.token, body: {} }), 'manual 取得 over a queued balance run');
    assert.equal(sync.job.kind, 'retrieve'); const [yielded] = await balanceJobs(R, { state: 'superseded' }); assert.ok(yielded && !yielded.balance.claimedAt, 'balance:statement-priority-manual');
    assert.equal((await readView(o, R, at(D, 9, 15))).status.state, 'busy', 'balance:busy-while-statement');
    await tick(at(D, 9, 20)); assert.equal((await balanceJobs(R, { state: 'queued' })).length, 0, 'balance:no-balance-while-statement');
    const st = await claim(dev); assert.equal(st.job.kind === 'retrieve' || st.job.kind === 'balance', true); // the oldest first: P's balance run or R's retrieval
    const second = await claim(dev); const jobs = [st.job, second.job]; const pj = jobs.find(j => j?.kind === 'balance'), rj = jobs.find(j => j?.kind === 'retrieve'); assert.ok(pj && rj, 'balance:both-claimable');
    assert.equal((await call(api + 'bank/accounts/' + P + '/sync', { method: 'POST', token: o.token, body: {} })).status, 409, 'balance:in-flight-blocks-statement');
    await finish(dev, pj); ok(await status(dev, rj.jobId, 'failed', 'fictional statement failure'), 'statement failed');
    // the daily statement schedule: due at 9 for P; a queued balance run of the same account is replaced by the day's run
    const sp = ok(await call(api + 'bank/accounts/' + P + '/schedule', { method: 'GET', token: o.token }), 'schedule');
    assert.equal(sp.supported, false, 'balance:unmapped-paypay-unsupported-for-daily'); // PayPay template-free: the daily schedule is unsupported; use R
    ok(await save(o, P, { enabled: false, collectorId: dev.id, revision: 1 }), 'P balance off (R alone from here)');
    ok(await call(api + 'bank/accounts/' + R + '/schedule', { method: 'PUT', token: o.token, body: { enabled: true, hour: 9, revision: 0 } }), 'daily on');
    assert.equal((await tick(at(D1, 9, 0))).queued.length >= 1, true, 'balance:queued-before-daily');
    const daily = await m.schedule.runBankSchedule(at(D1, 9, 0, 30)); assert.equal(daily.queued.length, 1, 'balance:daily-queued-despite-balance');
    const [replaced] = (await balanceJobs(R, { state: 'superseded' })).filter(j => j.requestedAt.getTime() >= at(D1, 9).getTime()); assert.ok(replaced, 'balance:statement-priority-daily');
    const dj = await claim(dev); assert.equal(dj.job.kind, 'retrieve'); ok(await status(dev, dj.job.jobId, 'complete', 'fictional daily'), 'daily complete');
    assert.equal((await tick(at(D1, 9, 30))).queued.length, 1, 'balance:after-statement-due'); const bj = await claim(dev); ok(await status(dev, bj.job.jobId, 'failed', 'fictional balance failure'), 'balance failed');
    const sv = await m.schedule.readBankSchedule(o.id, R, at(D1, 10)); assert.equal(sv.status.state, 'done-today', 'balance:daily-done-by-statement-only'); assert.equal(sv.status.job.kind, 'retrieve', 'balance:daily-state-ignores-balance'); assert.equal(sv.status.lastFailure, null, 'balance:balance-failure-not-statement-failure');
    assert.equal((await m.schedule.runBankSchedule(at(D1, 12))).queued.length, 0, 'balance:daily-once');
    const listed = ok(await call(api + 'bank/accounts/' + R + '/jobs', { token: o.token }), 'jobs').jobs; assert.ok(listed.some(j => j.kind === 'balance' && j.balanceTrigger === 'hourly'), 'balance:history-lists-balance');
  });

  await leg('S6 only the chosen PC with the new collector receives balance runs: an old collector (no capability) never does and is shown as needing an update; another PC in scope never does; a revoked PC stops the hourly runs; an expired lease is resumed by the same PC only', async () => {
    const o = await owner('s6'), R = await account(o, 'S6 楽天銀行', RAKUTEN), chosen = await device(o, [R], 'Synthetic chosen PC'), other = await device(o, [R], 'Synthetic other PC');
    await enable(o, R, chosen); assert.equal((await tick(at(D, 18))).queued.length, 1);
    assert.equal((await claim(chosen, false)).job, null, 'balance:old-collector-never-receives');
    assert.equal((await readView(o, R, at(D, 18, 5))).status.state, 'queued');
    assert.equal((await readView(o, R, at(D, 18, 5))).collectors.find(x => x.id === chosen.id).capable, false, 'balance:capability-recorded');
    assert.equal((await claim(other)).job, null, 'balance:other-pc-never-receives');
    const r = await claim(chosen); assert.equal(r.job?.kind, 'balance', 'balance:chosen-receives'); const claimedAt = (await BankJob.findOne({ jobId: r.job.jobId }).lean()).balance.claimedAt;
    await BankJob.updateOne({ jobId: r.job.jobId }, { $set: { leaseUntil: new Date(Date.now() - 1000) } });
    assert.equal((await claim(other)).job, null, 'balance:other-pc-no-reclaim'); assert.equal((await claim(chosen, false)).job, null, 'balance:old-collector-no-reclaim');
    const again = await claim(chosen); assert.equal(again.job?.jobId, r.job.jobId, 'balance:same-pc-resumes');
    assert.equal((await BankJob.findOne({ jobId: r.job.jobId }).lean()).balance.claimedAt.toISOString(), claimedAt.toISOString(), 'balance:resume-not-rejudged');
    await finish(chosen, again.job);
    // the chosen PC only ever claimed without the capability → 要更新
    const O = await owner('s6b'), Q = await account(O, 'S6 楽天銀行 旧', RAKUTEN), old = await device(O, [Q], 'Synthetic old PC'); await enable(O, Q, old); assert.equal((await claim(old, false)).job, null);
    assert.equal((await readView(O, Q, at(D, 19, 5))).status.state, 'upgrade', 'balance:upgrade-state'); assert.equal(await queuedFor(await tick(at(D, 19, 5)), [Q]), 0, 'balance:upgrade-queues-nothing');
    await FinanceCollector.updateOne({ _id: oid(chosen.id) }, { $set: { revokedAt: new Date() } });
    // revoked within the same hour as its queued run (so no later-hour coalescing is what closes it)
    assert.equal((await balanceJobs(R, { state: 'queued' })).length, 1, 'balance:queued-before-revoke');
    const revokedTick = await tick(at(D, 19, 30)); assert.equal(await queuedFor(revokedTick, [R]), 0, 'balance:revoked-no-run');
    assert.equal((await balanceJobs(R, { state: 'queued' })).length, 0, 'balance:revoked-closes-queued'); assert.equal((await readView(o, R, at(D, 19, 31))).status.state, 'waiting-pc', 'balance:revoked-waiting');
    assert.equal(await queuedFor(await tick(at(D, 20)), [R]), 0, 'balance:revoked-next-hour');
    assert.ok([401, 403].includes((await call(capi + 'bank/claim', { method: 'POST', token: chosen.token, body: { capabilities: ['balance-v1'] } })).status), 'balance:revoked-token');
  });

  await leg('S7 receipts: bound to the job, PC, snapshot, provider and current account; idempotent per job; a conflicting, malformed, future, foreign or identity-changed receipt never publishes; completion needs the receipt; an old delayed receipt never replaces newer bank data; a stale bank time stays stale; a balance job accepts no CSV', async () => {
    const o = await owner('s7'), other = await owner('s7x'), R = await account(o, 'S7 楽天銀行', RAKUTEN), K = await ikeda(o), dev = await device(o, [R, K]), dev2 = await device(o, [R, K], 'Synthetic second PC'), foreign = await device(other, []);
    await enable(o, R, dev); await enable(o, K, dev);
    const job1 = (ok(await refresh(o, R), 'refresh R')).job; const c1 = await claim(dev); assert.equal(c1.job.jobId, job1.jobId);
    assert.equal((await status(dev, c1.job.jobId, 'complete', 'no receipt')).status, 409, 'balance:complete-needs-receipt');
    const refuse = async (body, expect, label, query) => { const r = await postReceipt(dev, c1.job, body, query); assert.equal(r.status, expect, 'balance:receipt-refused ' + label + ' ' + JSON.stringify(r.data).slice(0, 200)); };
    await refuse(receiptOf(c1.job, { amount: '1,234' }), 400, 'amount-string'); await refuse(receiptOf(c1.job, { currency: 'USD' }), 400, 'currency'); await refuse(receiptOf(c1.job, { amount: null }), 400, 'missing-not-zero');
    await refuse(receiptOf(c1.job, { asOf: new Date(Date.now() + 3600000).toISOString(), observedAt: new Date(Date.now() + 3600000).toISOString() }), 400, 'future');
    await refuse(receiptOf(c1.job, { provider: 'paypay' }), 400, 'provider'); await refuse(receiptOf(c1.job, { source: { ...SOURCES.rakuten, path: '/XMS/inquiry/gns?q=1' } }), 400, 'query-string');
    await refuse(receiptOf(c1.job, { extra: 'x' }), 400, 'unknown-key'); await refuse('not json', 400, 'malformed'); await refuse(receiptOf(c1.job), 400, 'snapshot-hash', { snapshotHash: 'f'.repeat(64) });
    assert.equal((await postReceipt(dev2, c1.job, receiptOf(c1.job))).status, 409, 'balance:receipt-other-pc'); assert.equal((await postReceipt(foreign, c1.job, receiptOf(c1.job))).status, 409, 'balance:receipt-foreign-owner');
    assert.equal(await balances.countDocuments({ jobId: c1.job.jobId }), 0, 'balance:nothing-published');
    const body = receiptOf(c1.job, { asOf: new Date(Date.now() - 120000).toISOString() });
    const first = ok(await postReceipt(dev, c1.job, body), 'receipt'), dup = ok(await postReceipt(dev, c1.job, body), 'same receipt again');
    assert.deepEqual([first.stored, dup.duplicate, dup.id], [true, true, first.id], 'balance:idempotent-per-job');
    const conflict = await postReceipt(dev, c1.job, { ...body, amount: 1 }); assert.equal(conflict.status, 409, 'balance:receipt-conflict'); assert.equal(conflict.data?.data?.code, 'balance-receipt-conflict');
    assert.equal(await balances.countDocuments({ jobId: c1.job.jobId }), 1);
    assert.equal((await call(capi + 'bank/upload?' + new URLSearchParams({ jobId: c1.job.jobId, snapshotHash: c1.job.snapshotHash, kind: 'statement' }), { method: 'POST', token: dev.token, raw: '日付,金額\n2026-10-01,1\n', type: 'text/csv' })).status, 409, 'balance:no-csv-for-balance');
    ok(await status(dev, c1.job.jobId, 'complete', 'fictional'), 'complete with receipt');
    const v1 = ok(await view(o, R), 'view'); assert.deepEqual([v1.latest.amount, v1.latest.available, v1.latest.currency, v1.latest.jobId], [1234567, 1200000, 'JPY', c1.job.jobId], 'balance:latest-shown');
    assert.ok(v1.latest.receivedAt && v1.latest.observedAt && v1.latest.asOf, 'balance:times-kept');
    // newer then an older delayed one
    const j2 = (ok(await refresh(o, R), 'refresh 2')).job, c2 = await claim(dev); await finish(dev, c2.job, { amount: 2000000, asOf: new Date(Date.now() - 30000).toISOString() });
    const j3 = (ok(await refresh(o, R), 'refresh 3')).job, c3 = await claim(dev); await finish(dev, c3.job, { amount: 5, asOf: new Date(Date.now() - 7200000).toISOString(), observedAt: new Date(Date.now() - 7100000).toISOString() });
    assert.deepEqual([j2.jobId, j3.jobId], [c2.job.jobId, c3.job.jobId]);
    const v2 = ok(await view(o, R), 'view 2'); assert.equal(v2.latest.amount, 2000000, 'balance:old-delayed-not-latest'); assert.ok(v2.history.some(h => h.amount === 5), 'balance:old-kept-in-history');
    // stale bank time: fetched now, the bank says three hours ago
    const j4 = (ok(await refresh(o, R), 'refresh 4')).job, c4 = await claim(dev); await finish(dev, c4.job, { amount: 3000000, asOf: new Date(Date.now() - 3 * 3600000).toISOString() });
    assert.equal(j4.jobId, c4.job.jobId); const s4 = await balances.findOne({ jobId: c4.job.jobId }); assert.equal(s4.stale, true, 'balance:bank-side-stale');
    const v4 = ok(await view(o, R), 'view 4'); assert.equal(v4.latest.amount, 2000000, 'balance:stale-older-not-latest');
    // identity changed between the claim and the receipt
    const jk = (ok(await refresh(o, K), 'refresh K')).job, ck = await claim(dev); assert.equal(ck.job.jobId, jk.jobId);
    ok(await call(api + 'bank/accounts/' + K + '/connection', { method: 'PUT', token: o.token, body: { provider: 'ikeda', variant: 'portal', templateId: (await BankAccount.findById(K).lean()).connection.templateId, accountIdentity: { ...IDENTITY, number: '0000003' } } }), 'change identity');
    const changed = await postReceipt(dev, ck.job, receiptOf(ck.job)); assert.equal(changed.status, 409, 'balance:identity-changed-refused'); assert.equal(changed.data?.data?.code, 'balance-identity-changed');
    assert.equal(await balances.countDocuments({ jobId: ck.job.jobId }), 0, 'balance:identity-changed-not-published');
    const snapshot = await balances.findOne({ jobId: c1.job.jobId }); assert.equal(JSON.stringify(snapshot).includes('0000001'), false, 'balance:no-account-number-stored');
    assert.equal(await db.collection('financebankstatements').countDocuments({}), 0, 'balance:no-statements');
  });

  await leg('S8 the real collector (index.mjs + bank-balance.mjs; the bank inquiry is a fictional seam): it advertises balance-v1, takes the saved-login handle for the three balance logins only, retains the normalized receipt before sending, completes only after OMF stored it, resends identical bytes after a crash or a lost acknowledgement without another inquiry, and never runs the statement path', async () => {
    const o = await owner('s8'), ids = await six(o, 'S8'), dev = await device(o, ids); for (const id of ids) await enable(o, id, dev);
    const config = { baseUrl: origin, token: dev.token, accountInfo: [] }, directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'omf-balance-collector-'));
    const I = m.index, statements = []; let inquiries = 0;
    assert.equal((await tick(at(D, 21))).queued.length, 6);
    const claimed = await I.claimWork(config, null); assert.equal(claimed.bank?.job?.kind, 'balance', 'balance:native-claim-capability');
    const live = { mode: 'protected', installationId: 'f'.repeat(32), broker: {} };
    for (const [p, v, kind, expect] of [['rakuten', 'standard', 'balance', true], ['paypay', 'standard', 'balance', true], ['ikeda', 'portal', 'balance', true], ['rakuten', 'plus', 'balance', false], ['resona', 'direct', 'balance', false]]) {
      const handle = I.bankLoginFor({ job: { kind, provider: p, snapshot: { provider: p, variant: v } }, account: { _id: 'a'.repeat(24), ownerId: 'b'.repeat(24) } }, config, live, { store: { has: async () => false }, root: directory, assert: () => {} });
      assert.equal(!!handle, expect, 'balance:login-handle ' + p + '/' + v);
    }
    assert.equal(I.bankLoginFor({ job: claimed.bank.job, account: claimed.bank.account }, config, { ...live, mode: 'manual' }, { store: { has: async () => false }, root: directory, assert: () => {} }), null, 'balance:login-handle-protected-only');
    const reading = job => ({ amount: 4321000, available: job.snapshot.provider === 'rakuten' ? 4000000 : null, asOf: new Date(Date.now() - 60000).toISOString(), source: { ...SOURCES[job.snapshot.provider] } });
    const inquire = async (bound, job, root, st, { onReading }) => { inquiries++; await st('running', 'fictional inquiry'); await onReading(reading(job)); return { loggedOut: true }; };
    const noStatement = async () => { statements.push(1); throw new Error('the statement path was used for a balance job'); };
    const statusOf = job => async (state, text) => { const r = await call(capi + 'bank/status', { method: 'POST', token: dev.token, body: { jobId: job.jobId, state, message: text } }); if (r.status !== 200) throw Object.assign(new Error('status ' + r.status), { status: r.status }); };
    const run = (bank, extra = {}) => I.runBankJob(bank, config, null, { status: statusOf(bank.job), directory, collect: noStatement, observe: noStatement, inquire, now: Date.now, login: null, ...extra });
    const r1 = await run(claimed.bank); assert.equal(r1.failed ?? null, null, 'balance:native-run ' + JSON.stringify(r1).slice(0, 300)); assert.deepEqual([inquiries, statements.length], [1, 0], 'balance:native-one-inquiry-no-statement');
    const j1 = await BankJob.findOne({ jobId: claimed.bank.job.jobId }).lean(); assert.equal(j1.state, 'complete', 'balance:native-complete'); assert.ok(j1.balance.snapshotId, 'balance:native-receipt-stored');
    const dir1 = path.join(directory, 'outbox', 'balance', String(claimed.bank.account._id), claimed.bank.job.jobId), m1 = JSON.parse(await fsp.readFile(path.join(dir1, 'manifest.json'), 'utf8'));
    assert.ok(m1.acknowledgedAt && m1.importId === String(j1.balance.snapshotId), 'balance:native-acknowledged-after-store');
    const bytes1 = await fsp.readFile(path.join(dir1, m1.filename)); assert.equal(sha256(bytes1), m1.sha256); assert.equal(/password|cookie|0000001|<td|\?/.test(bytes1.toString()), false, 'balance:receipt-minimal');
    // crash after the retained receipt: the send fails (network), the lease expires, the same PC resumes: identical bytes, no second inquiry
    const c2 = await I.claimWork(config, null); let crashed = false;
    const failingSend = async () => { throw Object.assign(new Error('fictional network failure'), { name: 'TypeError' }); };
    try { await run(c2.bank, { upload: failingSend }); } catch { crashed = true; }
    assert.equal(crashed, true, 'balance:native-send-failure-propagates'); assert.equal(inquiries, 2);
    await BankJob.updateOne({ jobId: c2.bank.job.jobId }, { $set: { leaseUntil: new Date(Date.now() - 1000) } });
    const again = await I.claimWork(config, null); assert.equal(again.bank.job.jobId, c2.bank.job.jobId, 'balance:native-resume-same-job');
    const before = inquiries; const r2 = await run(again.bank); assert.equal(r2.failed ?? null, null); assert.equal(inquiries, before, 'balance:no-second-inquiry-after-crash');
    const j2 = await BankJob.findOne({ jobId: c2.bank.job.jobId }).lean(), dir2 = path.join(directory, 'outbox', 'balance', String(c2.bank.account._id), c2.bank.job.jobId), m2 = JSON.parse(await fsp.readFile(path.join(dir2, 'manifest.json'), 'utf8'));
    assert.equal(j2.state, 'complete'); assert.equal(sha256(await fsp.readFile(path.join(dir2, m2.filename))), m2.sha256, 'balance:identical-bytes');
    assert.equal(await balances.countDocuments({ jobId: c2.bank.job.jobId }), 1);
    // lost acknowledgement: OMF stored it, the PC never heard back
    const c3 = await I.claimWork(config, null);
    const rawSend = async (cfg, acct, item, l, opts) => { const b = await fsp.readFile(path.join(item.directory, item.manifest.filename)); const r = await call(capi + opts.route + '?' + new URLSearchParams(opts.query), { method: 'POST', token: dev.token, raw: b }); assert.equal(r.status, 200); throw Object.assign(new Error('fictional lost acknowledgement'), { name: 'TypeError' }); };
    try { await run(c3.bank, { upload: rawSend }); } catch { /* the lost acknowledgement */ }
    assert.equal(await balances.countDocuments({ jobId: c3.bank.job.jobId }), 1, 'balance:stored-before-lost-ack');
    await BankJob.updateOne({ jobId: c3.bank.job.jobId }, { $set: { leaseUntil: new Date(Date.now() - 1000) } });
    const c3b = await I.claimWork(config, null), n3 = inquiries; assert.equal(c3b.bank.job.jobId, c3.bank.job.jobId);
    const r3 = await run(c3b.bank); assert.equal(r3.failed ?? null, null); assert.equal(inquiries, n3, 'balance:no-inquiry-after-lost-ack');
    assert.equal(await balances.countDocuments({ jobId: c3.bank.job.jobId }), 1, 'balance:lost-ack-one-snapshot'); assert.equal((await BankJob.findOne({ jobId: c3.bank.job.jobId }).lean()).state, 'complete');
    // an interrupted inquiry (attempt recorded, no receipt): never a second bank login for that job
    const c4 = await I.claimWork(config, null); const crashInquiry = async () => { inquiries++; throw new Error('fictional crash inside the inquiry'); };
    try { await run(c4.bank, { inquire: crashInquiry }); } catch { /* interrupted */ }
    await BankJob.updateOne({ jobId: c4.bank.job.jobId }, { $set: { leaseUntil: new Date(Date.now() - 1000) } });
    const c4b = await I.claimWork(config, null), n4 = inquiries; const r4 = await run(c4b.bank); assert.equal(inquiries, n4, 'balance:no-second-login'); assert.ok(r4.failed, 'balance:interrupted-fails');
    assert.equal((await BankJob.findOne({ jobId: c4.bank.job.jobId }).lean()).state, 'failed');
    // a receipt OMF refuses for good (the account changed meanwhile) is kept on the PC, never resent; the job fails with the reason
    // (deterministic: the remaining hourly jobs first — their claim order among equal request times is not defined — then a manual K job)
    const K = ids[5]; let refusedChecked = false;
    for (let i = 0; i < 6; i++) { const cn = await I.claimWork(config, null); if (!cn.bank) break; const rn = await run(cn.bank); assert.equal(rn.failed ?? null, null, 'balance:native-run-' + i); }
    ok(await refresh(o, K), 'manual K');
    for (let i = 0; i < 1; i++) {
      const cn = await I.claimWork(config, null); assert.equal(String(cn.bank?.account?._id), K, 'balance:manual-k-claimed');
      await BankAccount.updateOne({ _id: oid(K) }, { $set: { 'connection.accountIdentity.number': '0000009' } });
      const r5 = await run(cn.bank); assert.ok(r5.failed, 'balance:refused-receipt-fails');
      const dir5 = path.join(directory, 'outbox', 'balance', K, cn.bank.job.jobId), m5 = JSON.parse(await fsp.readFile(path.join(dir5, 'manifest.json'), 'utf8'));
      assert.equal(m5.refusal?.reason, 'balance-identity-changed', 'balance:refusal-terminal'); assert.equal((await BankJob.findOne({ jobId: cn.bank.job.jobId }).lean()).state, 'failed');
      const sent = []; const again5 = await I.runBankJob({ ...cn.bank, job: { ...cn.bank.job, jobId: randomUUID() } }, config, null, { status: async () => {}, directory, collect: noStatement, observe: noStatement, inquire: async () => { throw new Error('not reached'); }, upload: async (...a) => { sent.push(a); return {}; } }).catch(() => null);
      void again5; assert.equal(sent.filter(a => a[2]?.manifest?.jobId === cn.bank.job.jobId).length, 0, 'balance:refused-never-resent'); refusedChecked = true;
    }
    assert.equal(refusedChecked, true, 'balance:refusal-leg-reached');
    assert.equal(statements.length, 0, 'balance:never-statement-path');
    await fsp.rm(directory, { recursive: true, force: true }).catch(() => {});
  });

  await leg('S9 default off and tolerance: connected accounts without a balance setting are never queued; a malformed stored setting reads as off; the plugin keeps OMF_BANK_SCHEDULE_MS=0 disabling every bank timer', async () => {
    const o = await owner('s9'), R = await account(o, 'S9 楽天銀行', RAKUTEN), P = await account(o, 'S9 PayPay銀行', PAYPAY); await device(o, [R, P]);
    assert.equal((await tick(at(D2, 10))).queued.length, 0, 'balance:default-off-tick');
    await BankAccount.updateOne({ _id: oid(P) }, { $set: { balanceSetting: 'garbage' } });
    assert.equal((await tick(at(D2, 11))).queued.length, 0, 'balance:malformed-off'); const v = ok(await view(o, P), 'view'); assert.equal(v.status.state, 'off', 'balance:malformed-reads-off');
    const plugin = await fsp.readFile(path.join(SRC, 'server/plugins/bankSchedule.ts'), 'utf8');
    assert.match(plugin, /runBalanceSchedule/, 'balance:plugin-drives-hourly'); assert.match(plugin, /OMF_BANK_SCHEDULE_MS=0/, 'balance:plugin-off-switch-kept');
  });

  // Seeded fictional history (owned DB only): a retrieval with its imported capture, then balance-only jobs.
  const seedRetrieve = async (o, id, { state = 'complete', at: when, imported = true } = {}) => {
    const jobId = randomUUID(), snapshot = { provider: 'rakuten', variant: 'standard', fictional: true };
    await db.collection('financebankjobs').insertOne({ ownerId: oid(o.id), bankAccountId: oid(id), jobId, kind: 'retrieve', state, open: false, requestedAt: when, completedAt: when, lastMessage: 'fictional ' + state, snapshot, snapshotHash: sha256(JSON.stringify(snapshot)), statementIds: [], observation: null, trigger: 'manual', createdAt: when, updatedAt: when });
    if (imported) await db.collection('financebankstatements').insertOne({ ownerId: oid(o.id), hash: sha256(jobId), name: 'fictional-' + jobId.slice(0, 6) + '.csv', size: 10, capture: { jobId, bankAccountId: String(id), kind: 'retrieve', channel: 'collector', state: 'imported', rows: { new: 1, existing: 0, differs: 0 }, receivedAt: when }, createdAt: when, updatedAt: when });
    return jobId;
  };
  const seedBalances = async (o, id, n, from) => { const docs = []; for (let i = 0; i < n; i++) { const when = new Date(from.getTime() + i * 3600000), snapshot = { kind: 'balance', provider: 'rakuten', variant: 'standard', currency: 'JPY' }; docs.push({ ownerId: oid(o.id), bankAccountId: oid(id), jobId: randomUUID(), kind: 'balance', state: 'complete', open: false, requestedAt: when, completedAt: when, lastMessage: '残高を更新しました', snapshot, snapshotHash: sha256(JSON.stringify(snapshot)), statementIds: [], observation: null, balance: { trigger: 'hourly', claimedAt: when }, createdAt: when, updatedAt: when }); } await db.collection('financebankjobs').insertMany(docs); };

  await leg('S10 statement history survives hourly balance history: after more than 50 newer balance jobs the owner jobs route still returns the latest non-superseded retrieval with its captures — its failure when that is the latest, never an older success — within the ordinary bounded list and only for this owner', async () => {
    const o = await owner('s10'), other = await owner('s10x'), R = await account(o, 'S10 楽天銀行', RAKUTEN), X = await account(other, 'S10 他の所有者', RAKUTEN);
    const base = Date.now() - 200 * 3600000, okJob = await seedRetrieve(o, R, { at: new Date(base) }); await seedRetrieve(other, X, { at: new Date(base + 1000) });
    await seedBalances(o, R, 55, new Date(base + 2 * 3600000));
    const list = async who => ok(await call(api + 'bank/accounts/' + R + '/jobs', { token: who.token }), 'jobs').jobs;
    let jobs = await list(o);
    assert.ok(jobs.length <= 51, 'balance:history-bounded ' + jobs.length); assert.equal(jobs.filter(j => j.kind === 'balance').length, 50, 'balance:history-recent-50');
    const kept = jobs.find(j => j.kind === 'retrieve'); assert.equal(kept?.jobId, okJob, 'balance:history-keeps-statement');
    assert.equal(kept.captures?.[0]?.state, 'imported', 'balance:history-keeps-capture');
    assert.equal((await call(api + 'bank/accounts/' + R + '/jobs', { token: other.token })).status, 404, 'balance:history-owner-scoped');
    const failedJob = await seedRetrieve(o, R, { state: 'failed', at: new Date(base + 3600000), imported: false }); await seedRetrieve(o, R, { state: 'superseded', at: new Date(base + 1.5 * 3600000), imported: false });
    jobs = await list(o); const retrieves = jobs.filter(j => j.kind === 'retrieve' && j.state !== 'superseded');
    assert.deepEqual(retrieves.map(j => j.jobId), [failedJob], 'balance:history-latest-failure-not-older-success'); assert.ok(jobs.length <= 51, 'balance:history-bounded-2');
    assert.equal(jobs.some(j => j.jobId === okJob), false, 'balance:history-no-older-substitution');
  });

  await leg('S11 an abandoned PC: after PC A claimed a balance job and vanished, the owner explicitly selecting PC B (or turning the check off and on) closes only that long-expired job (kept as a record) and B receives the next job; a live A job is never stolen; a closed (open:false) job neither blocks nor is reclaimed', async () => {
    const o = await owner('s11'), R = await account(o, 'S11 楽天銀行', RAKUTEN), A = await device(o, [R], 'Synthetic PC A'), Bpc = await device(o, [R], 'Synthetic PC B');
    await enable(o, R, A);
    const j1 = ok(await refresh(o, R), 'refresh').job; const a1 = await claim(A); assert.equal(a1.job?.jobId, j1.jobId);
    // A is still alive (live lease): switching to B never steals it, nothing runs in parallel
    ok(await save(o, R, { enabled: true, collectorId: Bpc.id, revision: 1 }), 'select B while A is live');
    assert.equal((await BankJob.findOne({ jobId: j1.jobId }).lean()).state, 'running', 'balance:live-not-stolen');
    assert.equal((await refresh(o, R)).status, 409, 'balance:live-blocks-refresh'); assert.equal((await claim(Bpc)).job, null, 'balance:live-not-reclaimed-by-b');
    // A vanished: its lease expired only a minute ago — not yet abandoned; long ago — the explicit reconfiguration closes it
    await BankJob.updateOne({ jobId: j1.jobId }, { $set: { leaseUntil: new Date(Date.now() - 60000) } });
    ok(await save(o, R, { enabled: true, collectorId: Bpc.id, revision: 2 }), 'save again (recent expiry)');
    assert.equal((await BankJob.findOne({ jobId: j1.jobId }).lean()).state, 'running', 'balance:recent-expiry-not-abandoned');
    await BankJob.updateOne({ jobId: j1.jobId }, { $set: { leaseUntil: new Date(Date.now() - 20 * 60000) } });
    const s3 = ok(await save(o, R, { enabled: true, collectorId: Bpc.id, revision: 3 }), 'explicit reconfiguration to B');
    const old = await BankJob.findOne({ jobId: j1.jobId }).lean();
    assert.deepEqual([old.state, old.open, String(old.balance.collectorId), !!old.balance.claimedAt], ['failed', false, A.id, true], 'balance:abandoned-closed-and-kept');
    assert.ok(['due', 'done'].includes(s3.status.state), 'balance:recovered-state ' + s3.status.state);
    const j2 = ok(await refresh(o, R), 'refresh after recovery').job; assert.equal((await claim(A)).job, null, 'balance:abandoned-not-reclaimed-by-a');
    const b2 = await claim(Bpc); assert.equal(b2.job?.jobId, j2.jobId, 'balance:b-receives-next'); await finish(Bpc, b2.job);
    assert.equal(await BankJob.countDocuments({ bankAccountId: oid(R), kind: 'balance' }), 2, 'balance:history-kept');
    // a closed job (open:false, as a statement request leaves an expired one) is no blocker and is never reclaimed
    const j3 = ok(await refresh(o, R), 'refresh 3').job; const b3 = await claim(Bpc); assert.equal(b3.job?.jobId, j3.jobId);
    await BankJob.updateOne({ jobId: j3.jobId }, { $set: { open: false, leaseUntil: new Date(Date.now() - 1000) } });
    assert.equal((await claim(Bpc)).job, null, 'balance:closed-not-reclaimed');
    const j4 = await refresh(o, R); assert.equal(j4.status, 200, 'balance:closed-not-blocking ' + JSON.stringify(j4.data).slice(0, 200));
    const b4 = await claim(Bpc); assert.equal(b4.job?.jobId, j4.data.job.jobId, 'balance:next-after-closed'); await finish(Bpc, b4.job);
    // the same PC vanished: turning the check off and on again is the owner's recovery
    const j5 = ok(await refresh(o, R), 'refresh 5').job; await claim(Bpc); await BankJob.updateOne({ jobId: j5.jobId }, { $set: { leaseUntil: new Date(Date.now() - 20 * 60000) } });
    ok(await save(o, R, { enabled: false, collectorId: Bpc.id, revision: 4 }), 'off'); assert.equal((await BankJob.findOne({ jobId: j5.jobId }).lean()).state, 'failed', 'balance:off-closes-abandoned');
    ok(await save(o, R, { enabled: true, collectorId: Bpc.id, revision: 5 }), 'on'); assert.equal((await refresh(o, R)).status, 200, 'balance:on-after-recovery');
    assert.equal(await BankJob.countDocuments({ bankAccountId: oid(R), kind: { $ne: 'balance' } }), 0, 'balance:no-statement-job-touched');
  });

  await leg('S12 a recent closed balance job (open:false while still running, as a statement request leaves an expired one) stays in history and cadence but is not derived as active work: the owner view does not show it running/interrupted, a later due hourly tick queues exactly one new job, the claim returns that job and never the closed one', async () => {
    const o = await owner('s12'), R = await account(o, 'S12 楽天銀行', RAKUTEN), dev = await device(o, [R]); await enable(o, R, dev);
    const j = ok(await refresh(o, R), 'refresh').job, c = await claim(dev); assert.equal(c.job?.jobId, j.jobId);
    await BankJob.updateOne({ jobId: j.jobId }, { $set: { open: false, leaseUntil: new Date(Date.now() - 1000) } });
    const v = ok(await view(o, R), 'owner view'); assert.ok(!['running', 'interrupted', 'attention', 'queued'].includes(v.status.state), 'balance:closed-not-shown-active ' + v.status.state);
    assert.ok(ok(await call(api + 'bank/accounts/' + R + '/jobs', { token: o.token }), 'jobs').jobs.some(x => x.jobId === j.jobId && x.state === 'running'), 'balance:closed-kept-in-history');
    assert.equal((await readView(o, R, at(D2, 10))).status.state, 'due', 'balance:closed-not-active-later');
    const r = await tick(at(D2, 10)); assert.equal(await queuedFor(r, [R]), 1, 'balance:closed-does-not-block-hourly');
    const next = await claim(dev); assert.ok(next.job && next.job.jobId !== j.jobId && next.job.kind === 'balance', 'balance:claim-new-not-closed');
    assert.equal((await claim(dev)).job, null, 'balance:closed-never-reclaimed'); const closed = await BankJob.findOne({ jobId: j.jobId }).lean();
    assert.deepEqual([closed.state, closed.open], ['running', false], 'balance:closed-record-unchanged'); await finish(dev, next.job);
  });

  console.log('RECEIPT ' + JSON.stringify({ pass: failed === 0 && checks > 0, checks, failed }));
  server.close(); await mongoose.disconnect().catch(() => {}); await mongo.stop().catch(() => {}); await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
  process.exit(failed ? 1 : 0);
}
// A fresh process ticking at `iso` (restart and two-process proof); the parent's owned database only.
function childTick(iso) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--import', 'tsx', __filename, '--tick', iso], { cwd: root, windowsHide: true, env: { ...process.env } }); let out = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; }); child.on('exit', code => resolve({ code, out }));
  });
}
async function tickMain(iso) {
  const uri = String(process.env.MONGO_URI || ''); if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/omf_balance_[a-z0-9_]+/.test(uri) || /:27017\//.test(uri)) { console.log('SETUP refused'); process.exit(3); }
  const mongoose = (await import('mongoose')).default; await mongoose.connect(uri);
  const svc = await import(u('server/services/financeBankBalanceService.ts')); console.log('TICK ' + JSON.stringify(await svc.runBalanceSchedule(new Date(iso))));
  await mongoose.disconnect(); process.exit(0);
}

// ════════════════════════════ --ui: the built app with its real plugin timer, owned headless Chrome ════════════════════════════
async function availablePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function ui() {
  if (!existsSync(path.join(OUTPUT, '.output/server/index.mjs'))) { console.log('SETUP built app absent at ' + OUTPUT); process.exit(3); }
  const mongo = await ownedMongo(), dbName = 'omf_balance_ui', uri = mongo.getUri(dbName); guardUri(uri, dbName);
  const { MongoClient, ObjectId } = require(require.resolve('mongodb', { paths: [root] })), client = await MongoClient.connect(uri), db = client.db(dbName);
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'omf-balance-ui-')), port = await availablePort(), origin = 'http://127.0.0.1:' + port, jwtSecret = randomBytes(32).toString('hex'); let logs = '';
  const child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: OUTPUT, windowsHide: true, env: { ...process.env, MONGO_URI: uri, NUXT_MONGO_URI: uri, MONGODB_URI: '', OMF_DATA_DIR: path.join(directory, 'data'), OMF_SYNC_SCHEDULE_MS: '0', OMF_BANK_SCHEDULE_MS: '1500', JWT_SECRET: jwtSecret, NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const s of [child.stdout, child.stderr]) s.on('data', v => { logs = (logs + v).slice(-30000); });
  let healthy = false; for (let i = 0; i < 150; i++) { try { const d = await (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) })).json(); if (d.database?.connected && d.database.name === dbName) { healthy = true; break; } } catch { /* booting */ } await pause(200); }
  if (!healthy) { child.kill(); console.log('SETUP owned app did not become healthy: ' + logs.slice(-800)); process.exit(3); }
  const call = async (route, { method = 'GET', token, body, raw } = {}) => { const r = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(raw !== undefined ? { body: raw } : body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) }); const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; } return { status: r.status, data }; };
  const ok = (r, label) => { assert.equal(r.status, 200, label + ' ' + JSON.stringify(r.data).slice(0, 300)); return r.data; };
  // A plain headless Chrome on its own profile (the collector's owned-process machinery is not what this leg tests).
  const { findChrome, LAUNCH_ARGS } = await import(c('collector/browser.mjs')), puppeteer = (await import(pathToFileURL(require.resolve('rebrowser-puppeteer-core', { paths: [path.join(root, 'collector')] })).href)).default;
  // Fixture-owned Chrome readiness: a failed start is logged and retried once only after that Chrome released its profile (process list).
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'omf-balance-browser-')), userDataDir = path.join(profile, 'p');
  const holders = () => new Promise(r => require('node:child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ForEach-Object { $_.CommandLine }"], { windowsHide: true, timeout: 20000 }, (e, out) => r(e ? null : String(out).split(/\r?\n/).filter(l => l.includes(userDataDir)).length)));
  const released = async () => { for (let i = 0; i < 60; i++) { if ((await holders()) === 0) return true; await pause(500); } return false; };
  let browser = null;
  for (let attempt = 1; !browser; attempt++) {
    const t = Date.now();
    try { browser = await puppeteer.launch({ executablePath: findChrome(), pipe: true, headless: true, userDataDir, defaultViewport: null, protocolTimeout: 60000, args: [...LAUNCH_ARGS] }); console.log('STEP owned Chrome ready (attempt ' + attempt + ', ' + (Date.now() - t) + ' ms)'); }
    catch (e) { const free = await released(); console.log('STEP owned Chrome launch attempt ' + attempt + ' failed after ' + (Date.now() - t) + ' ms (' + (e?.name || 'Error') + '); profile ' + (free ? 'released' : 'STILL HELD')); if (attempt >= 2 || !free) { child.kill(); console.log('SETUP owned Chrome did not start'); process.exit(3); } }
  }
  const shots = EVIDENCE ? path.join(EVIDENCE, 'screenshots') : null, errors = [], blocked = []; let passed = false;
  try {
    const api = '/api/finance-payments/', email = 'balance-ui@example.invalid', password = 'Synthetic-password-Only1!';
    const token = ok(await call('/api/auth/register', { method: 'POST', body: { email, password, name: 'Finance test' } }), 'register').tokens.accessToken, ownerDoc = await db.collection('users').findOne({ email });
    const req = (route, o = {}) => call(api + route, { token, ...o });
    const account = async (name, connection) => { const a = ok(await req('bank/accounts', { method: 'POST', body: { name, currency: 'JPY' } }), 'create').account; if (connection) ok(await req('bank/accounts/' + a.id + '/connection', { method: 'PUT', body: connection }), 'connect'); return a.id; };
    const tpl = ok(await req('bank/templates', { method: 'PUT', body: { name: 'Synthetic UI template', headers: ['日付', '摘要', '出金', '入金', '残高'], mapping: { date: '0', description: '1', outflow: '2', inflow: '3', balance: '4' }, amountSign: 'outflow-positive' } }), 'template').template.id;
    const R = await account('UI 楽天銀行 普通', RAKUTEN), P = await account('UI PayPay銀行 1', PAYPAY), K = await account('UI 池田泉州銀行', { provider: 'ikeda', variant: 'portal', templateId: tpl, accountIdentity: { ...IDENTITY } });
    // History (parent finding hourly-history-hides-statement-test): an older imported statement retrieval behind 55 newer balance jobs.
    const H = await account('UI 楽天銀行 履歴', RAKUTEN), hJob = randomUUID(), hAt = new Date(Date.now() - 300 * 3600000), hSnap = { provider: 'rakuten', variant: 'standard', fictional: true };
    await db.collection('financebankjobs').insertOne({ ownerId: ownerDoc._id, bankAccountId: new ObjectId(H), jobId: hJob, kind: 'retrieve', state: 'complete', open: false, requestedAt: hAt, completedAt: hAt, lastMessage: '明細 1件を保存', snapshot: hSnap, snapshotHash: sha256(JSON.stringify(hSnap)), statementIds: [], observation: null, trigger: 'manual' });
    await db.collection('financebankstatements').insertOne({ ownerId: ownerDoc._id, hash: sha256(hJob), name: 'fictional-history.csv', size: 10, capture: { jobId: hJob, bankAccountId: H, kind: 'retrieve', channel: 'collector', state: 'imported', rows: { new: 1, existing: 0, differs: 0 }, receivedAt: hAt } });
    await db.collection('financebankjobs').insertMany(Array.from({ length: 55 }, (_, i) => { const when = new Date(hAt.getTime() + (i + 1) * 3600000), sn = { kind: 'balance', provider: 'rakuten', variant: 'standard', currency: 'JPY' }; return { ownerId: ownerDoc._id, bankAccountId: new ObjectId(H), jobId: randomUUID(), kind: 'balance', state: 'complete', open: false, requestedAt: when, completedAt: when, lastMessage: '残高を更新しました', snapshot: sn, snapshotHash: sha256(JSON.stringify(sn)), statementIds: [], observation: null, balance: { trigger: 'hourly', claimedAt: when } }; }));
    const devToken = 'omfc_' + randomBytes(32).toString('hex'), devId = new ObjectId();
    await db.collection('financecollectors').insertOne({ _id: devId, ownerId: ownerDoc._id, name: '経理PC（架空）', tokenHash: sha256(devToken), accountIds: [], bankAccountIds: [R, P, K].map(id => new ObjectId(id)), createdAt: new Date(), updatedAt: new Date() });
    const claim = async () => ok(await call(api + 'collector/bank/claim', { method: 'POST', token: devToken, body: { capabilities: ['balance-v1'] } }), 'claim');
    const status = (jobId, state, message = '') => call(api + 'collector/bank/status', { method: 'POST', token: devToken, body: { jobId, state, message } });
    const receipt = (job, patch = {}) => { const p = job.snapshot.provider, s = SOURCES[p]; return call(api + 'collector/bank/balance?' + new URLSearchParams({ jobId: job.jobId, snapshotHash: job.snapshotHash }), { method: 'POST', token: devToken, raw: JSON.stringify({ v: 1, jobId: job.jobId, snapshotHash: job.snapshotHash, provider: p, variant: job.snapshot.variant, currency: 'JPY', amount: 1234567, available: p === 'rakuten' ? 1200000 : null, asOf: new Date(Date.now() - 120000).toISOString(), observedAt: new Date().toISOString(), source: { ...s, labels: [...s.labels] }, ...patch }) }); };
    const page = await browser.newPage(); await page.setViewport({ width: 390, height: 844 });
    await page.setRequestInterception(true); page.on('request', r => { if (r.url().startsWith(origin) || r.url().startsWith('data:') || r.url().startsWith('blob:')) r.continue(); else { blocked.push(new URL(r.url()).host); r.abort(); } });
    page.on('pageerror', e => errors.push(String(e))); page.on('console', msg => { if (msg.type() === 'error' && !/^Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
    const wait = async (f, arg, label, tries = 300) => { for (let i = 0; i < tries; i++) { if (await page.evaluate(f, arg).catch(() => false)) return; await pause(100); } throw new Error('ui:condition ' + label); };
    const card = id => '[data-bank-connection="' + id + '"] ', text = async (id, sel) => page.$eval(card(id) + sel, e => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => null);
    const shot = async name => { if (shots) { await fsp.mkdir(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true }); } };
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await page.goto(origin + '/login', { waitUntil: 'networkidle2' }); await page.type('#email', email); await page.type('#password', password); await page.evaluate(() => document.querySelector('button[type="submit"]').click()); await wait(() => location.pathname === '/', null, 'login');
    const open = async () => { await page.goto(origin + '/intake/payments', { waitUntil: 'networkidle2' }); await wait(() => !!document.querySelector('[data-bank-connections-open]'), null, 'page'); await page.click('[data-bank-connections-open]'); await wait(id => !!document.querySelector('[data-bank-connection="' + id + '"] [data-bank-schedule-status]')?.textContent.trim(), R, 'card'); };
    await open();
    await wait(id => !!document.querySelector('[data-bank-connection="' + id + '"] [data-bank-test-state]'), H, 'history card');
    assert.match(await text(H, '[data-bank-test-state]'), /接続テスト: 成功（.*明細を取り込みました）/, 'ui:statement-test-survives-balance-history');
    await wait(id => !!document.querySelector('[data-bank-connection="' + id + '"] [data-bank-balance]'), R, 'ui:balance-panel (the balance panel on the bank connection card)', 60);
    assert.match(await text(R, '[data-bank-balance-amount]'), /まだ残高を取得していません/, 'ui:no-amount-invented');
    assert.match(await text(R, '[data-bank-balance-status]'), /1時間ごとの残高の確認はオフです/, 'ui:default-off');
    await shot('390-balance-off'); assert.equal(await overflow(), false, 'ui:no-overflow-390');
    // settings: choose the PC, turn it on — unsaved until saved; the saved setting is shown apart from the form
    await page.select(card(R) + '[data-bank-balance-collector]', String(devId)); await page.click(card(R) + '[data-bank-balance-enabled]');
    await wait(id => !!document.querySelector('[data-bank-connection="' + id + '"] [data-bank-balance-unsaved]'), R, 'unsaved');
    await page.click(card(R) + '[data-bank-balance-save]'); await wait(id => /1時間ごとに自動で確認/.test(document.querySelector('[data-bank-connection="' + id + '"] [data-bank-balance-saved]')?.textContent || ''), R, 'saved');
    const saved = await db.collection('financebankaccounts').findOne({ _id: new ObjectId(R) }); assert.deepEqual([saved.balanceSetting.enabled, String(saved.balanceSetting.collectorId)], [true, String(devId)], 'ui:saved');
    assert.match(await text(R, '[data-bank-balance-saved]'), /経理PC（架空）/, 'ui:selected-pc-shown');
    // the real plugin timer queues the hourly run; the screen polls OMF (never the bank) and shows it
    await wait(id => /予約済み|PCの受け取り待ち/.test(document.querySelector('[data-bank-connection="' + id + '"] [data-bank-balance-status]')?.textContent || ''), R, 'ui:plugin-queued-and-polled', 400);
    // an unsaved form survives the polling refresh
    await page.click(card(R) + '[data-bank-balance-enabled]'); await wait(id => !!document.querySelector('[data-bank-connection="' + id + '"] [data-bank-balance-unsaved]'), R, 'unsaved 2');
    const job = (await claim()).job; assert.equal(job.kind, 'balance'); ok(await receipt(job), 'receipt'); ok(await status(job.jobId, 'complete', '残高を更新しました'), 'complete');
    await wait(id => /1,234,567/.test(document.querySelector('[data-bank-connection="' + id + '"] [data-bank-balance-amount]')?.textContent || ''), R, 'ui:amount-polled', 400);
    assert.ok(await page.$(card(R) + '[data-bank-balance-unsaved]'), 'ui:unsaved-kept-while-polling'); assert.equal(await page.$eval(card(R) + '[data-bank-balance-enabled]', e => e.checked), false, 'ui:form-state-kept');
    await page.click(card(R) + '[data-bank-balance-enabled]'); // back to the saved value
    assert.match(await text(R, '[data-bank-balance-amount]'), /銀行残高\s*1,234,567円/, 'ui:bank-balance');
    assert.match(await text(R, '[data-bank-balance-available]'), /支払可能残高\s*1,200,000円/, 'ui:available-rakuten');
    assert.match(await text(R, '[data-bank-balance-asof]'), /残高確認時間（銀行の表示） \d{4}-\d{2}-\d{2} \d{2}:\d{2}（日本時間）/, 'ui:bank-time-label');
    assert.match(await text(R, '[data-bank-balance-fetched]'), /最終取得 \d{4}-\d{2}-\d{2} \d{2}:\d{2}（日本時間）/, 'ui:last-fetch');
    assert.match(await text(R, '[data-bank-balance-status]'), /この1時間の確認は済み.*次回 \d{4}-\d{2}-\d{2} \d{2}:\d{2}（日本時間）以降/, 'ui:next-check');
    assert.match(await text(R, '[data-bank-test-state]'), /接続テスト: 未実施/, 'ui:statement-test-unaffected');
    assert.match(await page.$eval(card(R) + '[data-bank-job="' + job.jobId + '"]', e => e.textContent), /残高更新（1時間ごと） · 完了/, 'ui:history-named');
    // manual refresh, PayPay without 支払可能残高 and with its own wording, a failure keeping the last good amount
    for (const id of [P, K]) ok(await req('bank/accounts/' + id + '/balance', { method: 'PUT', body: { enabled: false, collectorId: String(devId), revision: 0 } }), 'select pc');
    await open(); await page.click(card(P) + '[data-bank-balance-refresh]');
    await wait(id => /予約済み|PCの受け取り待ち/.test(document.querySelector('[data-bank-connection="' + id + '"] [data-bank-balance-status]')?.textContent || ''), P, 'ui:manual-refresh');
    const pj = (await claim()).job; assert.equal(pj.kind, 'balance'); ok(await receipt(pj, { amount: 98765 }), 'receipt P'); ok(await status(pj.jobId, 'complete', '残高を更新しました'), 'complete P');
    await wait(id => /98,765/.test(document.querySelector('[data-bank-connection="' + id + '"] [data-bank-balance-amount]')?.textContent || ''), P, 'ui:paypay-amount', 400);
    assert.equal(await page.$(card(P) + '[data-bank-balance-available]'), null, 'ui:no-available-paypay'); assert.match(await text(P, '[data-bank-balance-note]'), /支払可能額を示すものではありません/, 'ui:no-spendability-claim');
    assert.match(await text(P, '[data-bank-balance-asof]'), /現在（銀行の表示）/, 'ui:paypay-time-label');
    ok(await req('bank/accounts/' + P + '/balance/refresh', { method: 'POST', body: {} }), 'refresh P 2'); const pj2 = (await claim()).job; ok(await status(pj2.jobId, 'failed', '保存済みのログインでサインインできなかったため止めました（架空）'), 'fail P');
    await wait(id => /前回の残高の確認は失敗しました/.test(document.querySelector('[data-bank-connection="' + id + '"] [data-bank-balance-failure]')?.textContent || ''), P, 'ui:failure-shown', 400);
    assert.match(await text(P, '[data-bank-balance-amount]'), /98,765/, 'ui:last-good-kept'); assert.equal(await page.$eval(card(P) + '[data-bank-balance-failure]', e => e.getAttribute('role')), 'alert');
    // a stale bank time (池田泉州銀行: the portal's 最終取得日 hours ago)
    ok(await req('bank/accounts/' + K + '/balance/refresh', { method: 'POST', body: {} }), 'refresh K'); const kj = (await claim()).job; ok(await receipt(kj, { amount: 5550000, asOf: new Date(Date.now() - 5 * 3600000).toISOString() }), 'receipt K'); ok(await status(kj.jobId, 'complete', '残高を更新しました'), 'complete K');
    await wait(id => /5,550,000/.test(document.querySelector('[data-bank-connection="' + id + '"] [data-bank-balance-amount]')?.textContent || ''), K, 'ui:ikeda-amount', 400);
    assert.match(await text(K, '[data-bank-balance-stale]'), /銀行の表示時刻が古い/, 'ui:stale-shown'); assert.match(await text(K, '[data-bank-balance-asof]'), /最終取得日（銀行の表示）/, 'ui:ikeda-time-label');
    await shot('390-balance-states'); assert.equal(await overflow(), false, 'ui:no-overflow-390-states');
    const html = await page.content(); assert.ok(!html.includes(devToken), 'ui:no-token'); assert.doesNotMatch(await page.$eval(card(P), e => e.textContent), /undefined|NaN|Invalid|null/, 'ui:no-raw-values');
    await page.setViewport({ width: 1280, height: 1000 }); await pause(300); assert.equal(await overflow(), false, 'ui:no-overflow-1280'); await shot('1280-balance');
    await page.evaluate(() => document.documentElement.classList.add('dark')); await pause(200); assert.equal(await overflow(), false, 'ui:dark'); await shot('1280-dark');
    await page.setViewport({ width: 390, height: 844 }); await pause(300); assert.equal(await overflow(), false, 'ui:dark-390'); await shot('390-dark');
    assert.deepEqual(errors, [], 'ui:no-page-errors'); assert.ok([...new Set(blocked)].every(h => h && !h.startsWith('127.0.0.1')), 'ui:outside-requests-aborted');
    assert.match(logs, /bank schedule every 1500 ms/, 'ui:plugin-timer');
    passed = true; console.log('PASS UI built app + owned Chrome 390/1280/dark (outside requests aborted: ' + ([...new Set(blocked)].join(', ') || 'none') + ')');
  } catch (e) { console.log('FAIL UI: ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 900)); console.log('APP LOG TAIL ' + logs.slice(-2500).replace(/\s+/g, ' ')); }
  finally {
    const chrome = browser.process(); await Promise.race([browser.close().catch(() => {}), pause(10000)]); if (chrome && chrome.exitCode === null && chrome.signalCode === null) { try { chrome.kill(); } catch { /* gone */ } }
    child.kill(); await pause(500); await client.close().catch(() => {}); await mongo.stop().catch(() => {});
    // the profile is removed only after its Chrome left; one still held is reported, never silently skipped
    if (await released()) await fsp.rm(profile, { recursive: true, force: true }).catch(e => { passed = false; console.log('FAIL UI cleanup: profile removal failed (' + (e?.code || 'Error') + ')'); }); else { passed = false; console.log('FAIL UI cleanup: owned Chrome still holds its profile'); }
    await fsp.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
  console.log('RECEIPT ' + JSON.stringify({ pass: passed, checks: passed ? 1 : 0, failed: passed ? 0 : 1 }));
  process.exit(passed ? 0 : 1);
}

if (process.argv.includes('--tick')) tickMain(process.argv[process.argv.indexOf('--tick') + 1]);
else if (process.argv.includes('--ui')) ui();
else harness();
