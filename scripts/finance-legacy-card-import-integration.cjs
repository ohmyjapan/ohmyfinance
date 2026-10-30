'use strict';
// scripts/finance-legacy-card-import-integration.cjs — the card handover (plan omf-card-handover-20261030) on owned infrastructure:
//   L1 the previous-setup owner proof in financeCollectorSecurityService (legacyOwner) on an owned MongoDB: preflight, same-owner
//      proof, scope intersection, foreign/unknown/revoked tokens, expired/revoked grants, a removed PC, the post-I/O recheck, nothing written;
//   L2 the new collector-security route over HTTP (origin, size, method and grant rules; the existing key routes unchanged);
//   L3 the REAL collector (run as a child on owned directories, the fake key broker, this Windows user's DPAPI) connected through the
//      real security routes over an isolated TLS origin: status metadata, explicit check and import of a previous setup proved by its
//      token hash, existing bank/canary/connection/key bytes unchanged, the previous directory byte-for-byte unchanged, re-run, stale
//      confirm, a revoked grant stopping before the read, foreign/revoked previous tokens, no login/token/address in any reply or log;
//   L4 (--ui, OMF_CARD_NATIVE=1) the setup page in owned headless Chrome on the same collector: check, confirm, no secret in the DOM
//      or any response;
//   L5 the daily schedule on the same database with an injected JST clock: Amex and Aplus queued exactly once per JST day after their
//      hour, catch-up, repeated/concurrent ticks, a manual claim the same day, revoked collectors, Amex accounts left off stay off;
//   L6 the 自動取得 settings writes: the owner settings route saves an Amex and an Aplus account's daily setting (the input rule, no token,
//      another owner and an unsupported provider refused; fiscal/calendar/billing-mail stay Aplus-only), while the real owner Navi
//      action and the shared write without the route's opt-in stay Aplus-only by plan;
//   L7 every `// legacy:<name>` guard line removed in turn from a copy of the service: its attack then succeeds;
//   L8 (--ui, OMF_CARD_NATIVE=1, a built .output) the native connections page in owned headless Chrome on its own database: the daily
//      control for Amex as well as Aplus, saved values, default off, the issuer wording; the Amex save from the page succeeds, is stored
//      and still shows after a refresh.
//   node --import tsx scripts/finance-legacy-card-import-integration.cjs [--ui]     (OMF_CARD_ONLY=L1,L5 selects legs)
// OMF_CARD_SRC points the server legs at another server/ + shared/ tree (the base revision or a mutant copy); OMF_TEST_INDEX_MODULE the
// collector child at a copy of collector/index.mjs beside the original. Every leg prints PASS/FAIL <name>; the last line is RECEIPT.
// Evidence, stated exactly: synthetic owners, cards, logins, tokens and addresses; owned mongodb-memory-server and temporary
// directories; loopback only — the previous address is a local listener that must receive nothing. No live directory, credential,
// issuer, browser of the owner, model or production database is touched; the import never reads outside its owned roots.
const { spawn, execFile } = require('node:child_process');
const { createHash, generateKeyPairSync, randomBytes, randomUUID } = require('node:crypto');
const { existsSync } = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { promisify } = require('node:util');

const root = path.resolve(__dirname, '..');
const SRC = process.env.OMF_CARD_SRC ? path.resolve(process.env.OMF_CARD_SRC) : root;
const BINARY = path.join(root, '..', 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
const OPENSSL = 'C:/Program Files/Git/usr/bin/openssl.exe';
const ONLY = (process.env.OMF_CARD_ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
const UI = process.argv.includes('--ui');
const execute = promisify(execFile);
const pause = ms => new Promise(r => setTimeout(r, ms));
const sha256 = v => createHash('sha256').update(v).digest('hex');
const u = p => pathToFileURL(path.join(SRC, p)).href, c = p => pathToFileURL(path.join(root, p)).href;
const INDEX = process.env.OMF_TEST_INDEX_MODULE ? path.resolve(process.env.OMF_TEST_INDEX_MODULE) : path.join(root, 'collector', 'index.mjs');

async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function snapshot(dir, skip = () => false) {
  const files = {};
  const walk = async rel => { let entries = []; try { entries = await fsp.readdir(path.join(dir, rel), { withFileTypes: true }); } catch { return; } for (const e of entries) { const r = path.join(rel, e.name).split(path.sep).join('/'); if (skip(r)) continue; if (e.isDirectory()) await walk(r); else files[r] = sha256(await fsp.readFile(path.join(dir, r))); } };
  await walk('');
  return files;
}

async function main() {
  const { MongoMemoryServer } = require(require.resolve('mongodb-memory-server', { paths: [root] }));
  const mongo = await MongoMemoryServer.create({ binary: existsSync(BINARY) ? { systemBinary: BINARY, version: '8.2.1' } : undefined, instance: { launchTimeout: 120000 } });
  const dbName = 'omf_card_handover', uri = mongo.getUri(dbName);
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri) || /:27017\//.test(uri)) { console.log('SETUP refused: not an owned ephemeral database address'); process.exit(3); }
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'omf-card-handover-'));
  Object.assign(process.env, { MONGO_URI: uri, JWT_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'test', OMF_DATA_DIR: path.join(temp, 'data') });
  let m;
  try {
    const mongoose = (await import('mongoose')).default, h3 = await import('h3'), http = await import('node:http'), https = await import('node:https');
    m = { mongoose, h3, http, https, User: (await import(u('server/models/User.ts'))).default, Finance: await import(u('server/models/Finance.ts')), Security: await import(u('server/models/FinanceCollectorSecurity.ts')), Pay: await import(u('server/models/FinancePaymentMatch.ts')),
      svc: await import(u('server/services/financeCollectorSecurityService.ts')), finance: await import(u('server/services/financeService.ts')), scheduler: await import(u('server/services/financeSyncScheduler.ts')),
      securityRoute: (await import(u('server/api/finance/collector-security/[...path].ts'))).default, financeRoute: (await import(u('server/api/finance/[...path].ts'))).default, bankRoute: (await import(u('server/api/finance-payments/collector/[...path].ts'))).default,
      auth: (await import(u('server/middleware/auth.ts'))).default, digest: (await import(u('shared/amex.mjs'))).digest,
      vault: await import(c('collector/vault.mjs')), fake: await import(c('collector/test/fake-broker.mjs')) };
  } catch (e) { console.log('SETUP module unavailable: ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 300)); process.exit(3); }
  const { mongoose, h3, User } = m, { FinancialAccount, FinanceCollector } = m.Finance, { CollectorInstallation, CollectorGrant, CollectorWrappedKey, CollectorThrottle } = m.Security, { BankAccount } = m.Pay;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 }); assert.equal(mongoose.connection.name, dbName);
  await m.Finance.initializeFinance(); await m.svc.initializeSecurity(); await m.Pay.initializePaymentMatching?.();
  let checks = 0, failed = 0, lastStep = 'start';
  const leg = async (name, fn, ms = 600000) => {
    const key = name.split(' ')[0]; if (ONLY.length && !ONLY.includes(key)) return; const t = Date.now(); let timer; console.log('START ' + key);
    try { await Promise.race([fn(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('leg timeout; last step ' + lastStep)), ms); })]); checks++; console.log('PASS ' + name + ' (' + Math.round((Date.now() - t) / 1000) + 's)'); }
    catch (e) { failed++; console.log('FAIL ' + name + ': ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 900) + ' (last step ' + lastStep + ')'); }
    finally { clearTimeout(timer); }
  };
  // ── synthetic owners, cards and PCs ─────────────────────────────────────────────────────────────────────────────────────────────
  const PASSWORD = 'Synthetic-only-Strong-Password1!';
  const owner = async tag => User.create({ email: 'card-handover-' + tag + '-' + randomUUID().slice(0, 6) + '@example.invalid', name: 'Synthetic owner ' + tag, password: PASSWORD });
  const amex = (o, card, extra = {}) => FinancialAccount.create({ ownerId: o._id, provider: 'amex', name: 'Synthetic Amex ' + card, cardIdentifiers: [card], primaryCard: card, otpRecipient: 'codes-' + card + '@example.invalid', otpMailbox: 'codes-' + card + '@example.invalid', ...extra });
  const aplus = (o, card, extra = {}) => FinancialAccount.create({ ownerId: o._id, provider: 'aplus', name: 'Synthetic Aplus ' + card, cardIdentifiers: [card], primaryCard: card, ...extra });
  const device = async (o, accounts, extra = {}) => { const token = 'omfc_' + randomBytes(32).toString('hex'); const row = await FinanceCollector.create({ ownerId: o._id, name: 'Synthetic PC', tokenHash: m.digest(token), accountIds: accounts.map(a => a._id), ...extra }); return { token, row }; };
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  // An enrolled installation and an active grant exactly as resumeSession writes them (the unchanged activeGrant reads these).
  const granted = async (o, dev, accounts, origin, { expiresAt = new Date(Date.now() + 20 * 60000) } = {}) => {
    const fresh = await User.findById(o._id).select('+password +twoFactorSecret +twoFactorBackupCodes'), authStamp = m.svc.stamp(fresh), trust = randomBytes(32).toString('hex');
    const id = randomBytes(16).toString('hex'), generation = randomBytes(32).toString('hex'), ids = accounts.map(a => a._id);
    await CollectorInstallation.create({ _id: id, ownerId: o._id, collectorId: dev.row._id, generation, publicKey: pair.publicKey, fingerprint: m.digest(pair.publicKey), origin, trustHash: m.digest(trust), authStamp, accountIds: ids, trustedAt: new Date() });
    const grant = randomBytes(32).toString('hex');
    await CollectorGrant.create({ _id: m.digest(grant), ownerId: o._id, collectorId: dev.row._id, installationId: id, generation, origin, accountIds: ids, authStamp, trustHash: m.digest(trust), expiresAt });
    return { grant, installationId: id, generation };
  };
  const refusedWith = async (attempt, codes) => { try { await attempt; return null; } catch (e) { if (codes.includes(e?.statusCode)) return e.statusCode; throw e; } };
  const ids = list => list.map(a => String(a._id)).sort();
  const counts = async () => ({ grants: await CollectorGrant.countDocuments(), keys: await CollectorWrappedKey.countDocuments(), collectors: await FinanceCollector.countDocuments(), installations: await CollectorInstallation.countDocuments() });

  // ═══ L1: the service ════════════════════════════════════════════════════════════════════════════════════════════════════════
  const ORIGIN = 'https://omf-card-handover.example.invalid';
  const L1 = {};
  const l1 = async () => {
    if (L1.ready) return L1;
    const o = await owner('l1'), other = await owner('l1x');
    const A = await amex(o, '12345'), B = await amex(o, '23456'), P = await aplus(o, '1234'), I = await amex(o, '34567', { active: false }), F = await amex(other, '45678');
    const dev = await device(o, [A, B, P, I]), g = await granted(o, dev, [A, B, P, I], ORIGIN);
    const previous = await device(o, [A, P]), revoked = await device(o, [A, B], { revokedAt: new Date() }), foreign = await device(other, [F]);
    Object.assign(L1, { ready: true, o, other, A, B, P, I, F, dev, g, previous, revoked, foreign, call: (body, { token = dev.token, grant = g.grant, origin = ORIGIN, svc = m.svc } = {}) => svc.legacyOwner(token, grant, body, origin) });
    return L1;
  };
  await leg('L1 legacyOwner preflight: the unchanged active grant answers its owner, origin and the permitted live cards only (grant ∩ PC ∩ active owned Amex/Aplus)', async () => {
    const { o, A, B, P, call } = await l1();
    assert.equal(typeof m.svc.legacyOwner, 'function', 'legacy:service-exported (financeCollectorSecurityService.legacyOwner)');
    const before = await counts();
    const view = await call({});
    assert.deepEqual(view, { ownerId: String(o._id), origin: ORIGIN, accountIds: ids([A, B, P]) }, 'legacy:preflight ' + JSON.stringify(view));
    assert.deepEqual(await counts(), before, 'legacy:nothing-written');
  });
  await leg('L1 same-owner proof: a previous collector of the same owner in this database answers matched with only its cards that are permitted now', async () => {
    const { o, A, P, previous, call } = await l1();
    const proof = await call({ legacyTokenHash: m.digest(previous.token) });
    assert.deepEqual(proof, { ownerId: String(o._id), origin: ORIGIN, matched: true, accountIds: ids([A, P]) }, 'legacy:proof ' + JSON.stringify(proof));
  });
  await leg('L1 foreign and unknown previous tokens: the same matched:false with no account id; nothing written', async () => {
    const { o, foreign, call } = await l1(), before = await counts();
    const expected = { ownerId: String(o._id), origin: ORIGIN, matched: false, accountIds: [] };
    for (const [label, hash] of [['foreign', m.digest(foreign.token)], ['unknown', sha256('omfc_' + randomBytes(32).toString('hex'))]]) assert.deepEqual(await call({ legacyTokenHash: hash }), expected, 'legacy:' + label + '-not-matched');
    assert.deepEqual(await counts(), before, 'legacy:nothing-written');
  });
  await leg('L1 a revoked OLD collector of the same owner is identity evidence only (fold P1): matched within the current permitted cards; it stays revoked, nothing is restored', async () => {
    const { o, A, B, revoked, call } = await l1(), before = await counts(), row = await FinanceCollector.findById(revoked.row._id).lean();
    assert.deepEqual(await call({ legacyTokenHash: m.digest(revoked.token) }), { ownerId: String(o._id), origin: ORIGIN, matched: true, accountIds: ids([A, B]) }, 'legacy:revoked-old-identity');
    assert.deepEqual(await FinanceCollector.findById(revoked.row._id).lean(), row, 'legacy:old-collector-untouched'); assert.ok(row.revokedAt, 'the old collector stays revoked');
    assert.deepEqual(await counts(), before, 'legacy:nothing-written');
  });
  await leg('L1 refusals: expired or revoked grant, removed PC, inactive owner, another origin, malformed body — before any lookup', async () => {
    const { o, A, B, P, I, dev, g, previous, call } = await l1();
    const body = { legacyTokenHash: m.digest(previous.token) };
    await CollectorGrant.updateOne({ _id: m.digest(g.grant) }, { $set: { expiresAt: new Date(Date.now() - 1000) } }); assert.equal(await refusedWith(call(body), [401]), 401, 'legacy:expired-grant'); await CollectorGrant.updateOne({ _id: m.digest(g.grant) }, { $set: { expiresAt: new Date(Date.now() + 20 * 60000) } });
    await CollectorGrant.updateOne({ _id: m.digest(g.grant) }, { $set: { revokedAt: new Date() } }); assert.equal(await refusedWith(call(body), [401]), 401, 'legacy:revoked-grant'); await CollectorGrant.updateOne({ _id: m.digest(g.grant) }, { $unset: { revokedAt: 1 } });
    await FinanceCollector.updateOne({ _id: dev.row._id }, { $set: { revokedAt: new Date() } }); assert.equal(await refusedWith(call(body), [403]), 403, 'legacy:removed-pc'); await FinanceCollector.updateOne({ _id: dev.row._id }, { $unset: { revokedAt: 1 } });
    await User.updateOne({ _id: o._id }, { $set: { isActive: false } }); assert.equal(await refusedWith(call(body), [403]), 403, 'legacy:inactive-owner'); await User.updateOne({ _id: o._id }, { $set: { isActive: true } });
    assert.equal(await refusedWith(call(body, { origin: 'https://other.example.invalid' }), [401]), 401, 'legacy:origin');
    for (const bad of [{ legacyTokenHash: previous.token }, { legacyTokenHash: 'x' }, { legacyTokenHash: m.digest(previous.token), extra: 1 }, { token: previous.token }]) assert.equal(await refusedWith(call(bad), [400]), 400, 'legacy:malformed ' + Object.keys(bad));
    assert.equal(await refusedWith(call(body, { grant: dev.token.slice(5) }), [401, 403]) !== null, true, 'legacy:poll-token-as-grant');
    await FinanceCollector.updateOne({ _id: dev.row._id }, { $set: { accountIds: [A._id, B._id, I._id] } });
    assert.deepEqual((await call({})).accountIds, ids([A, B]), 'legacy:device-scope (a card removed from the PC is not permitted)');
    await FinanceCollector.updateOne({ _id: dev.row._id }, { $set: { accountIds: [A._id, B._id, P._id, I._id] } });
    await CollectorThrottle.deleteMany({});
  });
  await leg('L1 post-I/O recheck: a grant revoked while the previous token is looked up is refused (never a stale answer)', async () => {
    const { g, previous, call } = await l1();
    const findOne = FinanceCollector.findOne.bind(FinanceCollector); let reads = 0;
    FinanceCollector.findOne = (...args) => { const q = findOne(...args); if (++reads === 2) { const lean = q.lean.bind(q); q.lean = async (...l) => { await CollectorGrant.updateOne({ _id: m.digest(g.grant) }, { $set: { revokedAt: new Date() } }); return lean(...l); }; } return q; };
    try { assert.equal(await refusedWith(call({ legacyTokenHash: m.digest(previous.token) }), [401]), 401, 'legacy:recheck'); assert.equal(reads >= 2, true, 'the race hook fired'); }
    finally { FinanceCollector.findOne = findOne; await CollectorGrant.updateOne({ _id: m.digest(g.grant) }, { $unset: { revokedAt: 1 } }); await CollectorThrottle.deleteMany({}); }
  });
  await leg('L1 throttle: 30 proofs per PC per minute, then 429', async () => {
    const o = await owner('l1t'), A = await amex(o, '56789'), dev = await device(o, [A]), g = await granted(o, dev, [A], ORIGIN);
    for (let i = 0; i < 30; i++) await m.svc.legacyOwner(dev.token, g.grant, {}, ORIGIN);
    assert.equal(await refusedWith(m.svc.legacyOwner(dev.token, g.grant, {}, ORIGIN), [429]), 429, 'legacy:throttle');
  });

  // ═══ L2: the route over HTTP ══════════════════════════════════════════════════════════════════════════════════════════════════
  await leg('L2 route POST legacy-owner: same token/grant/origin/body rules as the key routes; other methods 404; existing key routes unchanged', async () => {
    const app = h3.createApp(); app.use(m.auth); app.use(h3.defineEventHandler(e => e.path.startsWith('/api/finance/collector-security/') ? m.securityRoute(e) : undefined));
    const server = m.http.createServer(h3.toNodeListener(app)); await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
    const previousOrigin = process.env.OMF_COLLECTOR_PUBLIC_ORIGIN; process.env.OMF_COLLECTOR_PUBLIC_ORIGIN = origin;
    try {
      const o = await owner('l2'), A = await amex(o, '67890'), P = await aplus(o, '6789'), dev = await device(o, [A, P]), g = await granted(o, dev, [A, P], origin), previous = await device(o, [P]);
      const post = (route, body, headers = {}) => fetch(origin + '/api/finance/collector-security/' + route, { method: 'POST', headers: { Authorization: 'Bearer ' + dev.token, 'X-Collector-Grant': g.grant, 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json().catch(() => null) }));
      const pre = await post('legacy-owner', {}); assert.equal(pre.status, 200, 'legacy:route ' + JSON.stringify(pre)); assert.deepEqual(pre.data, { ownerId: String(o._id), origin, accountIds: ids([A, P]) });
      const proof = await post('legacy-owner', { legacyTokenHash: m.digest(previous.token) }); assert.deepEqual(proof.data, { ownerId: String(o._id), origin, matched: true, accountIds: ids([P]) }, 'legacy:route-proof');
      assert.equal((await post('legacy-owner', {}, { Origin: 'https://evil.example.invalid' })).status, 403, 'legacy:route-origin-header');
      assert.equal((await post('legacy-owner', JSON.stringify({ legacyTokenHash: 'a'.repeat(64), pad: 'x'.repeat(21000) }))).status, 413, 'legacy:route-size');
      assert.equal((await post('legacy-owner', '[]')).status, 400, 'legacy:route-array');
      assert.ok([401, 403].includes((await post('legacy-owner', {}, { 'X-Collector-Grant': '' })).status), 'legacy:route-no-grant');
      assert.equal((await fetch(origin + '/api/finance/collector-security/legacy-owner', { headers: { Authorization: 'Bearer ' + dev.token, 'X-Collector-Grant': g.grant } })).status, 404, 'legacy:route-get-404');
      // existing key routes under the same grant: unchanged register and read-back of an Amex key
      const keyId = randomBytes(32).toString('hex'), aad = { v: 3, installationId: g.installationId, origin, ownerId: String(o._id), provider: 'amex', accountId: String(A._id), generation: g.generation, keyId };
      const wrapped = m.vault.sealEnvelope(pair.publicKey, aad, { username: 'synthetic', password: 'synthetic' }).wrapped;
      assert.equal((await post('keys', { keyId, entryId: 'amex-' + A._id, aad, wrapped })).status, 200, 'keys:put-unchanged');
      const back = await fetch(origin + '/api/finance/collector-security/keys/' + keyId, { headers: { Authorization: 'Bearer ' + dev.token, 'X-Collector-Grant': g.grant } }).then(r => r.json());
      assert.equal(back.wrapped, wrapped, 'keys:get-unchanged');
    } finally { process.env.OMF_COLLECTOR_PUBLIC_ORIGIN = previousOrigin || ''; server.close(); await CollectorThrottle.deleteMany({}); }
  });

  // ═══ L3/L4: the real collector over an isolated TLS origin ════════════════════════════════════════════════════════════════════
  const E = {}; // shared L3/L4 environment
  const SECRET = { amex: { username: 'synthetic-amex-' + randomBytes(4).toString('hex'), password: 'synthetic-amex-pass-' + randomBytes(6).toString('hex') }, amex2: { username: 'synthetic-amex2-' + randomBytes(4).toString('hex'), password: 'synthetic-amex2-pass-' + randomBytes(6).toString('hex') }, aplus: { username: 'synthetic-aplus-' + randomBytes(4).toString('hex'), password: 'synthetic-aplus-pass-' + randomBytes(6).toString('hex') }, yayoi: { username: 'synthetic-yayoi@example.invalid', password: 'synthetic-yayoi-pass-' + randomBytes(5).toString('hex') }, bank: { username: 'synthetic-bank-' + randomBytes(4).toString('hex'), password: 'synthetic-bank-pass-' + randomBytes(6).toString('hex') }, manualAplus: { username: 'synthetic-manual-aplus-' + randomBytes(4).toString('hex'), password: 'synthetic-manual-pass-' + randomBytes(6).toString('hex') }, manualAmex: { username: 'synthetic-manual-amex-' + randomBytes(4).toString('hex'), password: 'synthetic-manual-amex-pass-' + randomBytes(6).toString('hex') }, manualGmail: { clientId: 'synthetic-manual-client', clientSecret: 'synthetic-manual-secret-' + randomBytes(6).toString('hex'), refreshToken: 'synthetic-manual-refresh-' + randomBytes(6).toString('hex'), mailbox: 'manual-codes@example.invalid' } };
  const secretTexts = () => [SECRET.amex.username, SECRET.amex.password, SECRET.amex2.username, SECRET.amex2.password, SECRET.aplus.username, SECRET.aplus.password, SECRET.yayoi.password, SECRET.bank.password, SECRET.manualAplus.username, SECRET.manualAplus.password, SECRET.manualAmex.username, SECRET.manualAmex.password, SECRET.manualGmail.clientSecret, SECRET.manualGmail.refreshToken, E.gmail?.clientSecret, E.gmail?.refreshToken, E.oldToken, E.oldToken && sha256(E.oldToken), E.oldAddress].filter(Boolean);
  const leaksIn = text => secretTexts().filter(s => String(text).includes(s));
  async function startTarget() {
    if (E.collector) return E;
    const base = await fsp.mkdtemp(path.join(temp, 'pc-')); E.base = base;
    E.source = path.join(base, 'OhMyFinance', 'collector'); E.target = path.join(base, 'OhMyFinance', 'collector-public');
    await fsp.mkdir(E.source, { recursive: true }); await fsp.mkdir(E.target, { recursive: true });
    // the isolated TLS origin in front of the real routes; collector-security bodies are recorded (to prove what was sent)
    const certFile = path.join(temp, 'ca.pem'), keyFile = path.join(temp, 'ca-key.pem');
    if (!existsSync(certFile)) await execute(OPENSSL, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=OMF card handover isolated test', '-addext', 'subjectAltName=IP:127.0.0.1'], { windowsHide: true });
    const app = h3.createApp(); app.use(m.auth);
    app.use(h3.defineEventHandler(e => e.path.startsWith('/api/finance/collector-security/') ? m.securityRoute(e) : e.path.startsWith('/api/finance-payments/collector/') ? m.bankRoute(e) : e.path.startsWith('/api/finance/') ? m.financeRoute(e) : undefined));
    const appServer = m.http.createServer(h3.toNodeListener(app)); await new Promise(r => appServer.listen(0, '127.0.0.1', r)); const appPort = appServer.address().port;
    E.sent = []; E.holds = [];
    // holdNext(match): the next request matching is not forwarded until release() (the race leg of fold P2b)
    E.holdNext = match => { const hold = { match, record: null, go: null }; hold.held = new Promise(resolve => { hold.arrived = resolve; }); hold.release = () => { E.holds = E.holds.filter(h => h !== hold); hold.go?.(); }; E.holds.push(hold); return hold; };
    const proxy = m.https.createServer({ key: await fsp.readFile(keyFile), cert: await fsp.readFile(certFile) }, (req, res) => {
      const chunks = []; req.on('data', d => chunks.push(d)); req.on('end', () => {
        const body = Buffer.concat(chunks), record = { method: req.method, path: req.url.split('?')[0], body: body.toString('utf8'), headers: JSON.stringify(req.headers) }; E.sent.push(record);
        const go = () => { const forward = m.http.request({ host: '127.0.0.1', port: appPort, path: req.url, method: req.method, headers: req.headers }, upstream => { res.writeHead(upstream.statusCode || 502, upstream.headers); upstream.pipe(res); }); forward.on('error', () => { res.writeHead(503); res.end('{}'); }); forward.end(body); };
        const hold = E.holds.find(h => !h.record && h.match(record));
        if (hold) { hold.record = record; hold.go = go; hold.arrived(record); return; }
        go();
      });
    });
    await new Promise(r => proxy.listen(0, '127.0.0.1', r)); E.origin = 'https://127.0.0.1:' + proxy.address().port; process.env.OMF_COLLECTOR_PUBLIC_ORIGIN = E.origin;
    // the previous address: a loopback listener that must never be contacted
    E.oldHits = []; const old = m.http.createServer((req, res) => { E.oldHits.push(req.method + ' ' + req.url); res.writeHead(500); res.end('{}'); });
    await new Promise(r => old.listen(0, '127.0.0.1', r)); E.oldAddress = 'http://127.0.0.1:' + old.address().port;
    E.servers = [appServer, proxy, old];
    // OMF side: the owner, three granted cards (two Amex, one Aplus), one PayPay-like bank login (rakuten standard) and this PC
    E.owner = await owner('l3'); E.A = await amex(E.owner, '11111'); E.B = await amex(E.owner, '22222'); E.P = await aplus(E.owner, '1111');
    E.bank = await BankAccount.create({ ownerId: E.owner._id, name: 'Synthetic 楽天銀行', currency: 'JPY', revision: 1, connection: { provider: 'rakuten', templateId: 'e5e5e5e5e5e5e5e5e5e5e5e5', transactionIdConfirmed: false, accountLabel: null, variant: 'standard', coverage: { from: '2025-11-01', to: null }, connectedAt: new Date() } });
    E.dev = await device(E.owner, [E.A, E.B, E.P], { bankAccountIds: [E.bank._id] });
    // enrollment through the real security routes (the owner approves with the password), then the collector child and /protect
    const store = new m.vault.SplitStore(E.target), generation = randomBytes(32).toString('hex'), installationId = randomBytes(16).toString('hex');
    let key, trust; await store.withLock(async () => { key = await store.deviceKey(generation, { create: true }); trust = await store.trustCredential(generation, { create: true }); });
    const tls = (route, body) => new Promise((resolve, reject) => { const req = m.https.request(E.origin + route, { method: body === undefined ? 'GET' : 'POST', ca: require('node:fs').readFileSync(certFile), headers: { Authorization: 'Bearer ' + E.dev.token, 'Content-Type': 'application/json' } }, res => { let t = ''; res.on('data', d => { t += d; }); res.on('end', () => { let v; try { v = JSON.parse(t); } catch { return reject(Error('non-JSON ' + res.statusCode)); } if (res.statusCode >= 400) return reject(Object.assign(Error(v.statusMessage || 'refused'), { status: res.statusCode })); resolve(v); }); }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body)); });
    const verifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('hex');
    const pending = await tls('/api/finance/collector-security/requests', { action: 'enroll', installationId, generation, trustHash: m.digest(trust), publicKey: key.publicKey, codeChallenge: createHash('sha256').update(verifier).digest('base64url'), state, redirectUri: 'http://127.0.0.1:49123/collector-callback' });
    const approved = await m.svc.approveRequest(String(E.owner._id), pending.id, { password: PASSWORD });
    await tls('/api/finance/collector-security/exchange', { id: pending.id, code: new URL(approved.redirectUri).searchParams.get('code'), verifier });
    const info = [E.A, E.B, E.P].map(a => ({ _id: String(a._id), primaryCard: a.primaryCard, name: a.name, ownerId: String(E.owner._id), provider: a.provider }));
    await store.withLock(async () => { await store.connection({ baseUrl: E.origin, token: E.dev.token, accountInfo: info, accounts: {}, mode: 'protected' }); await m.vault.replaceVaultFile(path.join(E.target, 'vault-state.json'), JSON.stringify({ v: 3, phase: 'enrolling', installationId, generation, publicKey: key.publicKey, legacyId: 'legacy-' + Date.now() })); });
    key.close();
    // the collector child: no Chrome can launch (Program Files hidden, LOCALAPPDATA = this owned PC root, which holds no Chrome)
    const port = await freePort(), brokerDir = path.join(temp, 'broker'), noBrowser = path.join(base, 'no-browser');
    const script = `await import(${JSON.stringify(c('collector/browser.mjs'))}); for (const k of ['ProgramFiles','ProgramFiles(x86)']) process.env[k]=${JSON.stringify(noBrowser)}; const { startCollector } = await import(${JSON.stringify(pathToFileURL(INDEX).href)}); await startCollector();`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: path.join(root, 'collector'), windowsHide: true, env: { ...process.env, OMF_COLLECTOR_DIR: E.target, OMF_COLLECTOR_PORT: String(port), LOCALAPPDATA: base, NODE_EXTRA_CA_CERTS: certFile, OMF_COLLECTOR_TICK_MS: '10000', ...m.fake.brokerEnv(brokerDir) }, stdio: ['ignore', 'pipe', 'pipe'] });
    E.output = []; child.stdout.on('data', d => E.output.push(String(d))); child.stderr.on('data', d => E.output.push(String(d)));
    E.child = child;
    const link = await m.fake.waitFor(async () => { const t = (await fsp.readFile(path.join(E.target, 'setup-link.txt'), 'utf8')).trim(); return t.startsWith('http://127.0.0.1:' + port + '/#') ? t : null; }, 60000, 200);
    if (!link) throw new Error('SETUP the collector did not start: ' + E.output.join('').slice(-600));
    E.link = link; E.local = new URL(link).origin; E.key = new URL(link).hash.slice(1);
    E.request = async (route, body, extra = {}) => { lastStep = 'collector ' + route; const r = await fetch(E.local + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Setup-Key': E.key, ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(240000) }); const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch { /* not JSON */ } E.replies.push(text); return { status: r.status, data, text }; };
    E.replies = [];
    // the collector's one action slot is shared with its 10 s tick: a 409 "Wait for the current collector action" is retried
    E.act = async (route, body) => { for (let i = 0; i < 40; i++) { const r = await E.request(route, body); if (!(r.status === 409 && /Wait for the current collector action/.test(r.data?.error || ''))) return r; await pause(250); } throw new Error('the collector stayed busy for ' + route); };
    E.status = async () => (await E.request('/status')).data || {};
    assert.ok(await m.fake.waitFor(async () => (await E.status()).startupDone === true, 90000, 250), 'collector startup');
    E.collector = true;
    return E;
  }
  const blobOf = (extra = {}) => ({ baseUrl: E.oldAddress, token: E.oldToken, accountInfo: [{ _id: String(E.A._id), primaryCard: E.A.primaryCard, ownerId: String(E.owner._id), provider: 'aplus' }], mode: 'protected', accounts: { [E.A.primaryCard]: { ...SECRET.amex, profile: 'Default' }, [E.B.primaryCard]: { ...SECRET.amex2 } }, services: { aplus: { ...SECRET.aplus }, yayoi: { ...SECRET.yayoi } }, gmail: { ...E.gmail }, ...extra });
  async function writePrevious(blob) {
    await new m.vault.Vault(E.source).update(() => blob);
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'collector', 'windows', 'private-acl.ps1'), '-Root', E.source], { windowsHide: true, timeout: 60000 });
    assert.equal(JSON.parse(stdout.trim()).verified, true, 'SETUP the owned previous directory could not be made private');
  }
  const TARGET_SKIP = r => r.startsWith('outbox/') || r.startsWith('profiles/') || r === 'setup-link.txt' || r === 'vault.lock' || r.startsWith('.acl-probe');
  await leg('L3 status before the connection: the previous setup is reported from file metadata only; check and import refuse without a protected session; nothing is read', async () => {
    await startTarget();
    E.previous = await device(E.owner, [E.A, E.P]); E.oldToken = E.previous.token; E.gmail = { clientId: 'synthetic-client', clientSecret: 'synthetic-secret-' + randomBytes(5).toString('hex'), refreshToken: 'synthetic-refresh-' + randomBytes(8).toString('hex'), mailbox: String(E.A.otpMailbox).toUpperCase() };
    await writePrevious(blobOf()); E.sourceBefore = await snapshot(E.source);
    const s = await E.status();
    assert.deepEqual(s.legacyCards, { available: true, state: 'legacy-ready' }, 'legacy-status ' + JSON.stringify(s.legacyCards));
    for (const [route, body] of [['/legacy-cards/preview', {}], ['/legacy-cards/import', { previewId: 'a'.repeat(32) }]]) { const r = await E.act(route, body); assert.equal(r.status, 403, route + ' without a protected session ' + r.text); assert.equal(r.data.code, 'legacy-ended'); }
    assert.equal((await E.act('/legacy-cards/preview', { anything: 1 })).status, 400, 'legacy-route:body-shape');
    assert.equal((await fetch(E.local + '/legacy-cards/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403, 'legacy-route:setup-key');
    assert.equal(E.sent.filter(x => x.path.endsWith('/legacy-owner')).length, 0, 'no proof request without a session');
    assert.deepEqual(await snapshot(E.source), E.sourceBefore, 'legacy:source-unchanged');
  });
  await leg('L3 connect, then the bank login and canary exist before any import (the bytes that must stay unchanged)', async () => {
    await startTarget();
    const p = await E.act('/protect', {}); assert.equal(p.status, 200, '/protect ' + p.text);
    const saved = await E.act('/bank/credentials', { bankAccountId: String(E.bank._id), ...SECRET.bank }); assert.equal(saved.status, 200, 'bank save ' + saved.text);
    const s = await E.status(); assert.deepEqual([s.protected, s.unlocked, s.mode], [true, true, 'protected']); assert.equal(s.banks.find(b => b.bankAccountId === String(E.bank._id))?.hasCredentials, true);
    E.targetBefore = await snapshot(E.target, TARGET_SKIP);
    assert.ok(Object.keys(E.targetBefore).some(f => f === 'secrets/rakuten-' + E.bank._id + '.sealed') && Object.keys(E.targetBefore).includes('secrets/check.sealed') && Object.keys(E.targetBefore).includes('connection.dpapi'), 'SETUP target files ' + Object.keys(E.targetBefore).join(','));
  });
  await leg('L3 check: OMF confirms the grant first, then the previous token is proved by its SHA-256 only; Amex and Aplus mapped, the unproved Amex manual; the old address never contacted', async () => {
    await startTarget();
    const sentBefore = E.sent.length;
    const r = await E.act('/legacy-cards/preview', {}); assert.equal(r.status, 200, 'preview ' + r.text);
    const v = r.data; E.check = v;
    assert.equal(v.owner, 'proved', 'legacy:proved');
    assert.deepEqual(v.items.map(i => [i.accountId, i.provider, i.action]).sort(), [[String(E.A._id), 'amex', 'import'], [String(E.P._id), 'aplus', 'import']].sort(), 'legacy:mapped ' + JSON.stringify(v.items));
    assert.equal(v.mailbox, 'import', 'legacy:mailbox-of-matched-amex'); assert.equal(v.counts.unmatched, 1, 'legacy:unproved-amex-manual'); assert.deepEqual(v.notTransferred, ['yayoi']);
    const proofs = E.sent.slice(sentBefore).filter(x => x.path.endsWith('/legacy-owner'));
    assert.deepEqual(proofs.map(x => JSON.parse(x.body)), [{}, { legacyTokenHash: sha256(E.oldToken) }], 'legacy:grant-first-then-hash-only');
    assert.equal(E.sent.some(x => x.body.includes(E.oldToken) || x.headers.includes(E.oldToken)), false, 'legacy:raw-token-sent');
    assert.deepEqual(E.oldHits, [], 'legacy:old-address-contacted');
    assert.deepEqual(leaksIn(r.text), [], 'privacy:check-reply');
  });
  await leg('L3 import: exactly the checked logins are sealed through OMF; bank, canary, connection, key and state bytes unchanged; the previous directory unchanged', async () => {
    await startTarget();
    const keysBefore = await CollectorWrappedKey.find({ ownerId: E.owner._id }).lean();
    const r = await E.act('/legacy-cards/import', { previewId: E.check.previewId }); assert.equal(r.status, 200, 'import ' + r.text);
    assert.deepEqual(r.data.counts, { imported: 3, existing: 0, notImported: 1 }, 'legacy:exact-count ' + JSON.stringify(r.data));
    assert.deepEqual(leaksIn(r.text), [], 'privacy:import-reply');
    const s = await E.status(), has = id => s.accounts.find(a => a.accountId === String(id))?.hasCredentials;
    assert.deepEqual([has(E.A._id), has(E.B._id), has(E.P._id), s.mailbox.hasCredentials, s.yayoi.hasCredentials], [true, false, true, true, false], 'legacy:what-is-saved ' + JSON.stringify(s.accounts));
    const after = await snapshot(E.target, TARGET_SKIP);
    for (const [file, hash] of Object.entries(E.targetBefore)) assert.equal(after[file], hash, 'legacy:target-unchanged ' + file);
    assert.deepEqual(Object.keys(after).filter(f => !E.targetBefore[f]).sort(), ['secrets/amex-' + E.A._id + '.sealed', 'secrets/aplus-' + E.P._id + '.sealed', 'secrets/gmail.sealed'].sort(), 'legacy:only-new-entries');
    const keys = (await CollectorWrappedKey.find({ ownerId: E.owner._id }).lean()).filter(k => !keysBefore.some(b => b.keyId === k.keyId));
    assert.deepEqual(keys.map(k => k.entryId).sort(), ['amex-' + E.A._id, 'aplus-' + E.P._id, 'gmail'].sort(), 'legacy:keys-registered');
    for (const k of keys) assert.equal(k.aad.origin, E.origin, 'legacy:bound-to-the-current-origin');
    for (const file of Object.keys(after).filter(f => f.endsWith('.sealed'))) assert.deepEqual(leaksIn(await fsp.readFile(path.join(E.target, file), 'utf8')), [], 'privacy:no-plaintext ' + file);
    assert.deepEqual(await snapshot(E.source), E.sourceBefore, 'legacy:source-unchanged');
    assert.deepEqual(E.oldHits, [], 'legacy:old-address-contacted');
  });
  await leg('L3 re-run and stale confirm: a second check finds everything kept; a used or unknown check id is refused', async () => {
    await startTarget();
    const again = await E.act('/legacy-cards/import', { previewId: E.check.previewId }); assert.deepEqual([again.status, again.data?.code], [409, 'legacy-stale'], 'legacy:one-confirm ' + again.text);
    const r = await E.act('/legacy-cards/preview', {}); assert.equal(r.status, 200);
    assert.deepEqual(r.data.items.map(i => i.action), ['existing', 'existing'], 'legacy:kept'); assert.equal(r.data.mailbox, 'existing');
    const done = await E.act('/legacy-cards/import', { previewId: r.data.previewId }); assert.deepEqual(done.data.counts, { imported: 0, existing: 3, notImported: 1 }, 'legacy:rerun-imports-nothing');
    assert.deepEqual(await snapshot(E.source), E.sourceBefore, 'legacy:source-unchanged');
  });
  await leg('L3 a foreign previous token is not confirmed and imports nothing; a revoked OLD same-owner token proves identity and imports within its scope (fold P1)', async () => {
    await startTarget();
    const other = await owner('l3x'), foreignCard = await amex(other, '33333'), foreign = await device(other, [foreignCard]);
    await writePrevious(blobOf({ token: foreign.token, accounts: { [E.B.primaryCard]: { ...SECRET.amex2 } }, services: {}, gmail: undefined }));
    const r = await E.act('/legacy-cards/preview', {}); assert.equal(r.status, 200, 'foreign ' + r.text);
    assert.deepEqual([r.data.owner, r.data.items.length, r.data.counts.import], ['unproven', 0, 0], 'legacy:foreign-unproven ' + r.text);
    const i = await E.act('/legacy-cards/import', { previewId: r.data.previewId }); assert.deepEqual(i.data.counts, { imported: 0, existing: 0, notImported: 1 }, 'legacy:foreign-nothing');
    assert.equal((await E.status()).accounts.find(a => a.accountId === String(E.B._id)).hasCredentials, false, 'legacy:foreign-never-saved');
    const old = await device(E.owner, [E.B], { revokedAt: new Date() });
    await writePrevious(blobOf({ token: old.token, accounts: { [E.B.primaryCard]: { ...SECRET.amex2 } }, services: {}, gmail: undefined }));
    const p = await E.act('/legacy-cards/preview', {}); assert.equal(p.status, 200, 'revoked old ' + p.text);
    assert.deepEqual([p.data.owner, p.data.items.map(x => [x.accountId, x.action])], ['proved', [[String(E.B._id), 'import']]], 'legacy:revoked-old-identity ' + p.text);
    const done = await E.act('/legacy-cards/import', { previewId: p.data.previewId }); assert.deepEqual(done.data.counts, { imported: 1, existing: 0, notImported: 0 }, 'legacy:revoked-old-imports-within-scope');
    assert.equal((await E.status()).accounts.find(a => a.accountId === String(E.B._id)).hasCredentials, true);
    assert.ok((await FinanceCollector.findById(old.row._id).lean()).revokedAt, 'the old collector stays revoked');
    await writePrevious(blobOf()); E.sourceBefore = await snapshot(E.source);
  });
  await leg('L3 a revoked grant stops the check at OMF’s answer: no owner proof is sent and nothing is saved; reconnecting restores it', async () => {
    await startTarget();
    await CollectorGrant.updateMany({ ownerId: E.owner._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    const sentBefore = E.sent.length;
    const r = await E.act('/legacy-cards/preview', {}); assert.equal(r.status, 403, 'revoked ' + r.text); assert.equal(r.data.code, 'legacy-access', 'legacy:grant-first');
    const proofs = E.sent.slice(sentBefore).filter(x => x.path.endsWith('/legacy-owner'));
    assert.deepEqual(proofs.map(x => JSON.parse(x.body)), [{}], 'legacy:no-proof-after-a-refused-grant');
    // a fresh session (Lock, Resume: the tick renews silently) answers again
    await E.request('/lock', {}); await E.request('/resume', {});
    assert.ok(await m.fake.waitFor(async () => (await E.status()).unlocked === true, 90000, 500), 'the remembered PC reconnected');
    const ok = await E.act('/legacy-cards/preview', {}); assert.equal(ok.status, 200, 'after reconnect ' + ok.text);
  });
  await leg('L3 fold P2b: a manual shared My APLUS save that takes the writer lease after the import planned stays the login used; the imported per-account login is not written over it', async () => {
    await startTarget();
    // owned test state: the Aplus login imported earlier is removed so the check plans it again
    for (const name of ['aplus-' + E.P._id + '.sealed', 'aplus.sealed']) await fsp.unlink(path.join(E.target, 'secrets', name)).catch(() => {});
    const check = await E.act('/legacy-cards/preview', {}); assert.equal(check.status, 200, 'check ' + check.text);
    assert.equal(check.data.items.find(i => i.accountId === String(E.P._id))?.action, 'import', 'SETUP the Aplus login is planned ' + check.text);
    const hold = E.holdNext(x => x.method === 'POST' && x.path.endsWith('/collector-security/keys') && /"entryId":"aplus"/.test(x.body));
    const manual = E.request('/aplus/credentials', { ...SECRET.manualAplus }); // passes the action check now, then takes the writer lease
    await hold.held; // the manual save holds the lease; its key registration waits at OMF
    const sentBefore = E.sent.length, importing = E.act('/legacy-cards/import', { previewId: check.data.previewId });
    assert.ok(await m.fake.waitFor(async () => E.sent.slice(sentBefore).some(x => x.method === 'GET' && x.path.endsWith('/api/finance/collector/accounts')), 60000, 100), 'the import did not plan');
    await pause(1500); // the import has planned (no shared entry yet) and now waits for the writer lease
    hold.release();
    const [saved, imported] = await Promise.all([manual, importing]);
    assert.equal(saved.status, 200, 'manual shared save ' + saved.text); assert.equal(imported.status, 200, 'import ' + imported.text);
    assert.equal(existsSync(path.join(E.target, 'secrets', 'aplus-' + E.P._id + '.sealed')), false, 'legacy:p2b-specific-not-written');
    assert.equal(imported.data.items.find(x => x.accountId === String(E.P._id))?.action, 'existing', 'legacy:p2b-reported-kept ' + imported.text);
    // fold P6b: with only the shared login saved, the account's own flag stays false (/status reads its own entry, never the shared fallback)
    const s = await E.status(); assert.deepEqual([s.aplus.hasCredentials, s.accounts.find(a => a.accountId === String(E.P._id)).hasCredentials], [true, false], 'legacy:p6b-shared-not-own (the manual shared login is the one the job uses)');
  });
  await leg('L3 per-account and mailbox races: a manual Amex login or mailbox save that takes the writer lease after the import planned stays; the import reports it kept and registers no second key (guard:legacy-no-overwrite)', async () => {
    await startTarget();
    const keyPosts = entry => E.sent.filter(x => x.method === 'POST' && x.path.endsWith('/collector-security/keys') && x.body.includes('"entryId":"' + entry + '"')).length;
    // /credentials and /mailbox take no action slot: a manual save can land at any moment of an import, so only the write-time check keeps it
    for (const [entry, route, body] of [['amex-' + E.A._id, '/credentials', { accountId: String(E.A._id), ...SECRET.manualAmex }], ['gmail', '/mailbox', { ...SECRET.manualGmail }]]) {
      await fsp.unlink(path.join(E.target, 'secrets', entry + '.sealed')).catch(() => {}); // owned test state: the check plans it again
      const check = await E.act('/legacy-cards/preview', {}); assert.equal(check.status, 200, 'check ' + check.text);
      const planned = entry === 'gmail' ? check.data.mailbox : check.data.items.find(i => i.accountId === String(E.A._id))?.action;
      assert.equal(planned, 'import', 'SETUP ' + entry + ' is planned ' + check.text);
      const before = keyPosts(entry), hold = E.holdNext(x => x.method === 'POST' && x.path.endsWith('/collector-security/keys') && x.body.includes('"entryId":"' + entry + '"'));
      const manual = E.request(route, body);
      await hold.held; // the manual save holds the writer lease; its key registration waits at OMF
      const sentBefore = E.sent.length, importing = E.act('/legacy-cards/import', { previewId: check.data.previewId });
      assert.ok(await m.fake.waitFor(async () => E.sent.slice(sentBefore).some(x => x.method === 'GET' && x.path.endsWith('/api/finance/collector/accounts')), 60000, 100), 'the import did not plan');
      await pause(1500); // the import has planned (the entry absent) and now waits for the writer lease
      hold.release();
      const [saved, imported] = await Promise.all([manual, importing]);
      assert.equal(saved.status, 200, 'manual save ' + saved.text); assert.equal(imported.status, 200, 'import ' + imported.text);
      const reported = entry === 'gmail' ? imported.data.items.find(x => x.mailbox)?.action : imported.data.items.find(x => x.accountId === String(E.A._id))?.action;
      assert.equal(reported, 'existing', 'legacy:race-kept ' + entry + ' ' + imported.text);
      assert.equal(keyPosts(entry) - before, 1, 'legacy:race-one-key ' + entry + ' (the manual save only)');
    }
  });
  await leg('L3 privacy: no login, token, address or digest in any collector reply or log line', async () => {
    await startTarget();
    assert.deepEqual(leaksIn(E.replies.join('\n')), [], 'privacy:replies');
    assert.deepEqual(leaksIn(E.output.join('')), [], 'privacy:collector-log');
  });
  if (UI) await leg('L4 setup page in owned headless Chrome: the previous setup section, Check and Use buttons, outcomes only — no login, token or address in the DOM or any response; the My APLUS panel tells the truth about per-account logins (fold P6)', async () => {
    await startTarget();
    if (process.env.OMF_CARD_NATIVE !== '1') throw new Error('NOT RUN: set OMF_CARD_NATIVE=1 (Chrome legs are serialized with the other suites)');
    // owned test state: no shared and no per-account My APLUS login, so the page imports the Aplus account's own login (P6's case)
    for (const name of ['aplus-' + E.P._id + '.sealed', 'aplus.sealed']) await fsp.unlink(path.join(E.target, 'secrets', name)).catch(() => {});
    await writePrevious(blobOf({ token: undefined, baseUrl: undefined })); // a local-only setup: protect()'s mapping
    const { browserFor, ephemeralProfile, closeOwnedBrowsers } = await import(c('collector/browser.mjs'));
    const uiRoot = await fsp.mkdtemp(path.join(temp, 'ui-'));
    const browser = await browserFor(ephemeralProfile(uiRoot, 'synthetic', 'omf', 'setup', 'ui'), { ephemeral: true, root: uiRoot, headless: true });
    try {
      const page = await browser.newPage(), bodies = [];
      await page.setRequestInterception(true);
      page.on('request', r => { const o = new URL(r.url()); if (o.origin === E.local || ['about:', 'data:'].includes(o.protocol)) return r.continue(); return r.abort(); });
      page.on('response', async r => { try { if (r.url().startsWith(E.local)) bodies.push(await r.text()); } catch { /* no body */ } });
      await page.goto(E.link, { waitUntil: 'networkidle2' });
      const until = async (fn, label, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await page.evaluate(fn)) return; await pause(150); } throw new Error('UI timed out: ' + label); };
      await until(() => !document.querySelector('#legacy-cards').classList.contains('hidden') && !document.querySelector('#legacy-preview').disabled, 'previous setup section enabled');
      await page.evaluate(() => document.querySelector('#legacy-preview').click());
      await until(() => /^Checked:/.test(document.querySelector('#legacy-message').textContent), 'checked');
      const listed = await page.evaluate(() => document.querySelector('#legacy-items').textContent);
      assert.ok(listed.includes(E.P.name + ': can be saved on this PC') && listed.includes(E.A.name + ': already saved on this PC'), 'ui:items ' + listed);
      assert.equal(await page.evaluate(() => document.querySelector('#aplus-saved').textContent), 'Enter the login you use for My APLUS.', 'ui:aplus-panel-before (no login of any kind yet)');
      await until(() => !document.querySelector('#legacy-import').classList.contains('hidden') && !document.querySelector('#legacy-import').disabled, 'import button');
      await page.evaluate(() => document.querySelector('#legacy-import').click());
      await until(() => /^Done:/.test(document.querySelector('#legacy-message').textContent), 'done');
      const text = await page.evaluate(() => document.body.innerText + document.documentElement.outerHTML);
      assert.deepEqual(leaksIn(text), [], 'privacy:dom'); assert.deepEqual(leaksIn(bodies.join('\n')), [], 'privacy:responses');
      const s = await E.status();
      assert.deepEqual([s.accounts.find(a => a.accountId === String(E.P._id)).hasCredentials, s.aplus.hasCredentials], [true, false], 'ui:imported per-account Aplus, no shared login');
      // P6: the per-account section and the shared panel agree; no first-time request for a login that exists
      const panel = await page.evaluate(() => document.querySelector('#aplus-saved').textContent);
      assert.equal(panel, 'Every My APLUS account of this PC has its own saved login (' + E.P.name + '). This shared login is optional.', 'ui:aplus-panel-truthful ' + panel);
      const variants = await page.evaluate(() => [
        aplusSavedText(false, [{ provider: 'aplus', name: 'One', hasCredentials: true }, { provider: 'aplus', name: 'Two', hasCredentials: false }, { provider: 'amex', name: 'Card', hasCredentials: false }]),
        aplusSavedText(false, [{ provider: 'aplus', name: 'One', hasCredentials: false }]),
        aplusSavedText(true, [{ provider: 'aplus', name: 'One', hasCredentials: true }]),
        aplusSavedText(true, [])]);
      assert.deepEqual(variants, ['Saved on this PC for One. Two has no saved login yet: enter it in its own section above.', 'Enter the login you use for My APLUS.', 'Login saved. Enter both fields to replace it. One uses its own saved login instead.', 'Login saved. Enter both fields to replace it.'], 'ui:aplus-panel-variants');
      // P6b on the real page and /status: both logins saved, then (owned test state: its own entry removed) the shared login only
      const panelNow = async () => { await page.evaluate(() => refresh()); return page.evaluate(() => document.querySelector('#aplus-saved').textContent); };
      const shared = await E.request('/aplus/credentials', { ...SECRET.manualAplus }); assert.equal(shared.status, 200, 'shared save ' + shared.text);
      assert.equal(await panelNow(), 'Login saved. Enter both fields to replace it. ' + E.P.name + ' uses its own saved login instead.', 'ui:aplus-panel-both-logins');
      await fsp.unlink(path.join(E.target, 'secrets', 'aplus-' + E.P._id + '.sealed'));
      const only = await E.status(); assert.deepEqual([only.aplus.hasCredentials, only.accounts.find(a => a.accountId === String(E.P._id)).hasCredentials], [true, false], 'ui:shared-only-not-own');
      assert.equal(await panelNow(), 'Login saved. Enter both fields to replace it.', 'ui:aplus-panel-shared-only (P6b: no own login claimed)');
      const after = await page.evaluate(() => document.body.innerText + document.documentElement.outerHTML);
      assert.deepEqual(leaksIn(after), [], 'privacy:dom-after-shared'); assert.deepEqual(leaksIn(bodies.join('\n')), [], 'privacy:responses-after-shared');
    } finally { await closeOwnedBrowsers().catch(() => {}); void browser; }
  });

  // ═══ L8 (--ui): the native connections page of the BUILT app (pages/connections.vue) in owned headless Chrome ════════════════════════
  if (UI) await leg('L8 the connections page (built app, owned headless Chrome): the daily 自動取得 control for Amex as well as Aplus, saved values kept, default off, Amex latest-closed/email wording and the SMS wording on Aplus only; fiscal/calendar/billing-mail stay Aplus-only; the Amex save from the page succeeds and persists after a refresh', async () => {
    if (process.env.OMF_CARD_NATIVE !== '1') throw new Error('NOT RUN: set OMF_CARD_NATIVE=1 (Chrome legs are serialized with the other suites)');
    if (!existsSync(path.join(root, '.output', 'server', 'index.mjs'))) throw new Error('SETUP the built app is missing: npm run build in this worktree first');
    const pageDb = 'omf_card_page', pageUri = mongo.getUri(pageDb), port = await freePort(), origin = 'http://127.0.0.1:' + port, uiRoot = path.join(temp, 'page-ui');
    const { browserFor, ephemeralProfile, closeOwnedBrowsers } = await import(c('collector/browser.mjs'));
    let app = null, appLog = ''; const pageErrors = [];
    try {
      app = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: root, windowsHide: true, env: { ...process.env, MONGO_URI: pageUri, MONGODB_URI: pageUri, NUXT_MONGO_URI: pageUri, NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port), OMF_DATA_DIR: path.join(temp, 'page-data'), OMF_SYNC_SCHEDULE_MS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
      for (const s of [app.stdout, app.stderr]) s.on('data', b => { appLog = (appLog + b).slice(-6000); });
      assert.ok(await m.fake.waitFor(async () => { try { const h = await (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(2000) })).json(); return h.database?.connected && h.database.name === pageDb; } catch { return false; } }, 120000, 500), 'SETUP the built app did not start on the owned database: ' + appLog.slice(-400));
      const api = async (route, token, body, method = body === undefined ? 'GET' : 'POST') => { const r = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) }); const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; } return { status: r.status, data }; };
      const email = 'card-page-' + randomUUID().slice(0, 6) + '@example.invalid', password = 'Synthetic-password-Only1!';
      const registered = await api('/api/auth/register', '', { email, password, name: 'Synthetic page owner' }); assert.equal(registered.status, 200, 'SETUP register ' + JSON.stringify(registered.data).slice(0, 200));
      const token = registered.data.tokens.accessToken;
      const create = async body => { const r = await api('/api/finance/accounts', token, body); assert.equal(r.status, 200, 'SETUP account ' + JSON.stringify(r.data).slice(0, 200)); return r.data.account; };
      const amexOn = await create({ provider: 'amex', name: 'Synthetic Amex daily', primaryCard: '11111', cardIdentifiers: ['11111'], otpRecipient: 'codes@example.invalid', otpMailbox: 'codes@example.invalid' });
      const amexOff = await create({ provider: 'amex', name: 'Synthetic Amex left off', primaryCard: '22222', cardIdentifiers: ['22222'], otpRecipient: 'codes2@example.invalid', otpMailbox: 'codes2@example.invalid' });
      const aplusAcc = await create({ provider: 'aplus', name: 'Synthetic Aplus daily', primaryCard: '3333', cardIdentifiers: ['3333'] });
      // an Amex setting saved earlier through the built app's own settings route (the route opts into Amex: L6)
      const stored = mongoose.connection.getClient().db(pageDb).collection(FinancialAccount.collection.name), oid = id => new mongoose.Types.ObjectId(String(id));
      const earlier = await api('/api/finance/accounts/' + amexOn._id + '/auto-sync', token, { enabled: true, hour: 7 }, 'PUT');
      assert.deepEqual([earlier.status, earlier.data], [200, { autoSync: { enabled: true, hour: 7 } }], 'ui:built-route-saves-amex ' + JSON.stringify(earlier.data).slice(0, 200));
      const browser = await browserFor(ephemeralProfile(uiRoot, 'synthetic', 'omf', 'connections', 'ui'), { ephemeral: true, root: uiRoot, headless: true });
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', r => { const o = new URL(r.url()); if (o.origin === origin || ['about:', 'data:'].includes(o.protocol)) return r.continue(); return r.abort(); });
      page.on('pageerror', e => pageErrors.push(String(e)));
      page.on('console', msg => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) pageErrors.push(msg.text()); });
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
      const until = async (fn, label, arg) => { for (let i = 0; i < 300; i++) { if (await page.evaluate(fn, arg)) return; await pause(100); } throw new Error('UI timed out: ' + label); };
      await page.goto(origin + '/login', { waitUntil: 'networkidle2' });
      await page.evaluate(() => document.querySelector('#email').focus()); await page.keyboard.type(email);
      await page.evaluate(() => document.querySelector('#password').focus()); await page.keyboard.type(password);
      await page.evaluate(() => document.querySelector('button[type="submit"]').click()); await until(() => location.pathname === '/', 'login');
      await page.goto(origin + '/connections', { waitUntil: 'networkidle2' }); await until(() => document.querySelectorAll('.account-grid section').length === 3, 'three cards');
      const card = name => page.evaluate(n => {
        const s = [...document.querySelectorAll('.account-grid section')].find(x => x.querySelector('h2')?.textContent.trim() === n);
        if (!s) return null;
        const d = [...s.querySelectorAll('details')].find(x => x.querySelector('summary')?.textContent.startsWith('自動取得：'));
        return { daily: d ? { summary: d.querySelector('summary').textContent, checked: d.querySelector('input[type=checkbox]').checked, hour: d.querySelector('select').value, text: d.querySelector('form p').textContent } : null, others: [...s.querySelectorAll('details summary')].map(x => x.textContent.split('：')[0]) };
      }, name);
      const on = await card(amexOn.name), off = await card(amexOff.name), ap = await card(aplusAcc.name);
      assert.ok(on?.daily && off?.daily && ap?.daily, 'ui:daily-control-for-amex-and-aplus ' + JSON.stringify({ on, off, ap }).slice(0, 600));
      assert.deepEqual([on.daily.summary, on.daily.checked, on.daily.hour], ['自動取得：毎日 7:00 以降（PCが利用可能なとき）', true, '7'], 'ui:amex-saved-values-kept');
      assert.deepEqual([off.daily.summary, off.daily.checked, off.daily.hour, ap.daily.summary, ap.daily.checked], ['自動取得：オフ', false, '9', '自動取得：オフ', false], 'ui:default-off');
      assert.ok(on.daily.text.includes('Amexは最新の確定明細だけを取得し、未確定のご利用分は取得しません') && on.daily.text.includes('メール') && !on.daily.text.includes('SMS'), 'ui:amex-closed-statement-email-wording ' + on.daily.text);
      assert.ok(ap.daily.text.includes('SMS読み取り元') && !ap.daily.text.includes('Amex'), 'ui:sms-wording-on-aplus-only ' + ap.daily.text);
      const aplusOnly = list => list.filter(x => ['自動取得の会計期間', '支払カレンダー', '請求メール'].includes(x));
      assert.deepEqual([aplusOnly(on.others), aplusOnly(off.others), aplusOnly(ap.others)], [[], [], ['自動取得の会計期間', '支払カレンダー', '請求メール']], 'ui:aplus-only-settings-unchanged ' + JSON.stringify([on.others, ap.others]));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'ui:no-horizontal-overflow-390');
      // the person switches the Amex account left off on from the page: the save succeeds, is stored, and a refresh still shows it
      await page.evaluate(n => { const s = [...document.querySelectorAll('.account-grid section')].find(x => x.querySelector('h2')?.textContent.trim() === n); const d = [...s.querySelectorAll('details')].find(x => x.querySelector('summary')?.textContent.startsWith('自動取得：')); d.open = true; d.querySelector('input[type=checkbox]').click(); d.querySelector('form button').click(); }, amexOff.name);
      await until(() => (document.querySelector('.notice')?.textContent || '').trim().length > 0, 'save outcome');
      const outcome = await page.evaluate(() => document.querySelector('.notice').textContent.trim()), after = await stored.findOne({ _id: oid(amexOff._id) });
      assert.equal(outcome, '自動取得の設定を保存しました', 'ui:amex-save-succeeds ' + outcome);
      assert.deepEqual([after?.autoSync?.enabled, after?.autoSync?.hour], [true, 9], 'ui:amex-save-stored ' + JSON.stringify(after?.autoSync));
      await page.reload({ waitUntil: 'networkidle2' }); await until(() => document.querySelectorAll('.account-grid section').length === 3, 'three cards after the refresh');
      const turnedOn = await card(amexOff.name), keptOn = await card(amexOn.name), keptOff = await card(aplusAcc.name);
      assert.deepEqual([turnedOn?.daily?.summary, turnedOn?.daily?.checked, turnedOn?.daily?.hour, keptOn?.daily?.summary, keptOff?.daily?.summary], ['自動取得：毎日 9:00 以降（PCが利用可能なとき）', true, '9', '自動取得：毎日 7:00 以降（PCが利用可能なとき）', '自動取得：オフ'], 'ui:amex-save-persists-after-refresh ' + JSON.stringify([turnedOn?.daily, keptOn?.daily?.summary, keptOff?.daily?.summary]));
      const listed = await api('/api/finance/accounts', token);
      assert.deepEqual(listed.data.accounts.find(a => a._id === amexOff._id)?.autoSync, { enabled: true, hour: 9 }, 'ui:amex-listed-on');
      assert.deepEqual(pageErrors, [], 'ui:page-errors ' + pageErrors.join(' | ').slice(0, 400));
    } finally { await closeOwnedBrowsers().catch(() => {}); if (app && app.exitCode === null) { const exited = new Promise(r => app.once('exit', r)); app.kill(); await exited; } }
  });

  // ═══ L5: the daily schedule ═══════════════════════════════════════════════════════════════════════════════════════════════════
  const S = {};
  const jst = (day, h, mi = 0) => new Date(Date.parse(day + 'T00:00:00Z') + h * 3600000 + mi * 60000 - 9 * 3600000);
  const sched = async () => {
    if (S.ready) return S;
    await FinancialAccount.updateMany({ 'autoSync.enabled': true }, { $set: { 'autoSync.enabled': false } });
    S.o = await owner('l5'); S.amex = await amex(S.o, '44444', { autoSync: { enabled: true, hour: 9 } }); S.aplus = await aplus(S.o, '4444', { autoSync: { enabled: true, hour: 9 } });
    S.off = await amex(S.o, '55555'); S.inactive = await amex(S.o, '66666', { active: false, autoSync: { enabled: true, hour: 9 } }); S.unpaired = await amex(S.o, '77777', { autoSync: { enabled: true, hour: 9 } });
    S.dev = await device(S.o, [S.amex, S.aplus, S.off, S.inactive]);
    S.read = async a => FinancialAccount.findById(a._id).lean();
    S.reset = async () => { await FinancialAccount.updateMany({ _id: { $in: [S.amex._id, S.aplus._id, S.off._id, S.inactive._id, S.unpaired._id] } }, { $set: { jobState: 'idle' }, $unset: { 'autoSync.lastQueuedDay': '', lastAttemptAt: '', jobId: '', jobRequestedAt: '', jobLeaseUntil: '', jobDeviceId: '' } }); };
    S.ready = true; return S;
  };
  await leg('L5 Amex and Aplus are queued once per JST day after their hour; an Amex account left off, an inactive and an unpaired one stay idle', async () => {
    const s = await sched(); await s.reset();
    assert.deepEqual(await m.scheduler.runSyncSchedule(jst('2026-11-02', 8, 59)), { queued: [] }, 'schedule:before-the-hour');
    const first = await m.scheduler.runSyncSchedule(jst('2026-11-02', 9, 0));
    assert.deepEqual([...first.queued].sort(), ids([s.amex, s.aplus]), 'schedule:amex-and-aplus-due ' + JSON.stringify(first));
    const a = await s.read(s.amex), p = await s.read(s.aplus);
    assert.deepEqual([a.jobState, a.autoSync.lastQueuedDay, a.lastMessage, p.jobState], ['queued', '2026-11-02', '自動取得を予約しました', 'queued']);
    for (const idle of [s.off, s.inactive, s.unpaired]) assert.equal((await s.read(idle)).jobState, 'idle', 'schedule:stays-idle ' + idle.primaryCard);
    assert.equal((await s.read(s.off)).autoSync.enabled, false, 'schedule:old-off-state-kept');
    assert.deepEqual(await m.scheduler.runSyncSchedule(jst('2026-11-02', 15, 0)), { queued: [] }, 'schedule:same-day-once');
    assert.equal((await s.read(s.amex)).jobId, a.jobId, 'schedule:same-job');
    const due = m.scheduler.dueAccounts([{ provider: 'amex', active: true, autoSync: { enabled: true, hour: 9 }, jobState: 'idle' }, { provider: 'aplus', active: true, autoSync: { enabled: true, hour: 9 }, jobState: 'idle' }, { provider: 'amex', active: true, autoSync: { enabled: false, hour: 9 }, jobState: 'idle' }], jst('2026-11-02', 9, 0));
    assert.equal(due.length, 2, 'schedule:due-prefilter-includes-amex');
  });
  await leg('L5 the claimed Amex job is the ordinary latest-closed-statement job; a manual claim the same day, two concurrent ticks and a revoked PC queue nothing more', async () => {
    const s = await sched(); await s.reset();
    await m.scheduler.runSyncSchedule(jst('2026-11-03', 9, 30));
    const app = h3.createApp(); app.use(h3.defineEventHandler(e => e.path.startsWith('/api/finance/') ? m.financeRoute(e) : undefined));
    const server = m.http.createServer(h3.toNodeListener(app)); await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
    try {
      const claimed = []; for (let i = 0; i < 3; i++) { const r = await fetch(origin + '/api/finance/collector/claim', { method: 'POST', headers: { Authorization: 'Bearer ' + s.dev.token, 'Content-Type': 'application/json' }, body: '{}' }).then(x => x.json()); if (r.account) claimed.push(r); }
      const amexClaim = claimed.find(r => r.account.provider === 'amex');
      assert.ok(amexClaim && amexClaim.covered === undefined && amexClaim.account.jobState === 'running', 'schedule:amex-claim-unchanged ' + JSON.stringify(claimed.map(r => ({ provider: r.account.provider, covered: r.covered }))));
      assert.ok(claimed.find(r => r.account.provider === 'aplus')?.covered, 'schedule:aplus-claim-unchanged');
    } finally { server.close(); }
    await FinancialAccount.updateMany({ _id: { $in: [s.amex._id, s.aplus._id] } }, { $set: { jobState: 'complete' } });
    assert.deepEqual(await m.scheduler.runSyncSchedule(jst('2026-11-03', 20, 0)), { queued: [] }, 'schedule:claimed-today-not-again');
    await s.reset(); await FinancialAccount.updateMany({ _id: { $in: [s.amex._id, s.aplus._id] } }, { $set: { jobState: 'complete', lastAttemptAt: jst('2026-11-04', 8, 0) } });
    assert.deepEqual(await m.scheduler.runSyncSchedule(jst('2026-11-04', 10, 0)), { queued: [] }, 'schedule:manual-claim-same-day');
    await s.reset();
    const [x, y] = await Promise.all([m.scheduler.runSyncSchedule(jst('2026-11-05', 10, 0)), m.scheduler.runSyncSchedule(jst('2026-11-05', 10, 0))]);
    assert.deepEqual([...x.queued, ...y.queued].sort(), ids([s.amex, s.aplus]), 'schedule:concurrent-exactly-once ' + JSON.stringify([x, y]));
    await s.reset(); await FinanceCollector.updateOne({ _id: s.dev.row._id }, { $set: { revokedAt: new Date() } });
    try { assert.deepEqual(await m.scheduler.runSyncSchedule(jst('2026-11-06', 10, 0)), { queued: [] }, 'schedule:revoked-pc'); }
    finally { await FinanceCollector.updateOne({ _id: s.dev.row._id }, { $unset: { revokedAt: 1 } }); }
    // catch-up: no tick on 11-07; the next available tick on 11-08 after the hour queues one job
    await s.reset(); assert.deepEqual([...(await m.scheduler.runSyncSchedule(jst('2026-11-08', 9, 5))).queued].sort(), ids([s.amex, s.aplus]), 'schedule:catch-up');
    await s.reset(); await FinancialAccount.updateMany({ _id: { $in: [s.amex._id, s.aplus._id] } }, { $set: { 'autoSync.enabled': false } });
  });
  await leg('L5 the atomic enqueue itself refuses a stale scan of an Amex account: already queued today, switched off, its hour not passed, inactive, attempted today', async () => {
    const s = await sched(); await s.reset();
    const on = { 'autoSync.enabled': true, 'autoSync.hour': 9, active: true }, at = { day: '2026-11-09', hour: 10, dayStartUtc: jst('2026-11-09', 0, 0), now: jst('2026-11-09', 10, 0) };
    await FinancialAccount.updateOne({ _id: s.amex._id }, { $set: on }); const stale = await s.read(s.amex); // the row as a scan read it
    for (const [label, change] of [['already-queued-today', { jobState: 'complete', 'autoSync.lastQueuedDay': '2026-11-09' }], ['switched-off', { 'autoSync.enabled': false }], ['hour-not-passed', { 'autoSync.hour': 11 }], ['inactive', { active: false }], ['attempted-today', { jobState: 'complete', lastAttemptAt: jst('2026-11-09', 9, 0) }], ['job-running', { jobState: 'running', jobLeaseUntil: jst('2026-11-09', 9, 0) }]]) {
      await s.reset(); await FinancialAccount.updateOne({ _id: s.amex._id }, { $set: { ...on, ...change } });
      assert.equal(await m.finance.queueScheduledSync(stale, at), null, 'schedule:atomic-' + label);
    }
    await s.reset(); await FinancialAccount.updateOne({ _id: s.amex._id }, { $set: on });
    assert.equal((await m.finance.queueScheduledSync(stale, at))?.jobState, 'queued', 'schedule:atomic-control (a due Amex account is queued)');
    await s.reset(); await FinancialAccount.updateMany({ _id: { $in: [s.amex._id, s.aplus._id] } }, { $set: { 'autoSync.enabled': false } });
  });
  await leg('L6 the 自動取得 settings writes: the owner settings route saves the daily setting of an Amex and an Aplus account (lastQueuedDay kept; the input rule, no token, another owner and an unsupported provider refused; fiscal/calendar/billing-mail stay Aplus-only), while the owner Navi action and the shared write without the route opt-in stay Aplus-only', async () => {
    const s = await sched(), owned = String(s.o._id);
    // the shared write without a provider list — the owner Navi action's call — stays Aplus-only
    await assert.rejects(m.finance.saveAutoSync(owned, await s.read(s.off), { enabled: true, hour: 9 }), e => e?.statusCode === 400 && e?.statusMessage === 'Aplus account required', 'navi:shared-default-aplus-only');
    const saved = await m.finance.saveAutoSync(owned, await s.read(s.aplus), { enabled: true, hour: 7 }); assert.deepEqual(saved, { autoSync: { enabled: true, hour: 7 } });
    // the real owner Navi action set_card_auto_sync: an Amex account refused before any write; its Aplus control saves with the operation
    const navi = (await import(u('server/services/financeOwnerActionService.ts'))).ownerActions.find(a => a.name === 'set_card_auto_sync'), scope = { ownerId: owned, agent: { accountIds: [s.off._id, s.aplus._id] } };
    await assert.rejects(navi.run(scope, { accountId: String(s.off._id), enabled: true, hour: 9 }, null, { operationId: randomUUID() }), e => e?.statusCode === 400 && e?.statusMessage === 'Aplus account required', 'navi:amex-refused');
    assert.deepEqual([(await s.read(s.off)).autoSync?.enabled ?? false, (await s.read(s.off)).autoSyncOperation], [false, undefined], 'navi:amex-nothing-written');
    const operationId = randomUUID(), naviSaved = await navi.run(scope, { accountId: String(s.aplus._id), enabled: true, hour: 6 }, null, { operationId });
    assert.deepEqual([naviSaved.result.autoSync, (await s.read(s.aplus)).autoSyncOperation?.operationId], [{ enabled: true, hour: 6 }, operationId], 'navi:aplus-control-saved');
    // the native owner route opts into Amex and Aplus (card-handover/SETTINGS-ROUTE-COMPLETION.json)
    const jwt = (await import('jsonwebtoken')).default, token = jwt.sign({ userId: owned, email: s.o.email, type: 'access', jti: randomUUID() }, process.env.JWT_SECRET, { expiresIn: '30m' });
    const app = h3.createApp(); app.use(m.auth); app.use(h3.defineEventHandler(e => e.path.startsWith('/api/finance/') ? m.financeRoute(e) : undefined));
    const server = m.http.createServer(h3.toNodeListener(app)); await new Promise(r => server.listen(0, '127.0.0.1', r));
    try {
      const put = (id, body, setting = 'auto-sync', auth = token) => fetch('http://127.0.0.1:' + server.address().port + '/api/finance/accounts/' + id + '/' + setting, { method: 'PUT', headers: { ...(auth ? { Authorization: 'Bearer ' + auth } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json() }));
      await FinancialAccount.updateOne({ _id: s.off._id }, { $set: { 'autoSync.lastQueuedDay': '2026-11-01' } });
      const amexPut = await put(String(s.off._id), { enabled: true, hour: 8 });
      assert.deepEqual([amexPut.status, amexPut.data], [200, { autoSync: { enabled: true, hour: 8 } }], 'route:amex-daily-setting-saved ' + JSON.stringify(amexPut));
      const amexRow = await s.read(s.off); assert.deepEqual([amexRow.autoSync.enabled, amexRow.autoSync.hour, amexRow.autoSync.lastQueuedDay, amexRow.autoSyncOperation], [true, 8, '2026-11-01', undefined], 'route:amex-setting-persisted');
      assert.deepEqual([(await put(String(s.off._id), { enabled: false, hour: 8 })).status, (await s.read(s.off)).autoSync.enabled], [200, false], 'route:amex-setting-off-again');
      assert.deepEqual([(await put(String(s.aplus._id), { enabled: true, hour: 9 })).status, (await s.read(s.aplus)).autoSync.hour], [200, 9], 'route:aplus-setting-saved');
      for (const body of [{ enabled: true, hour: 24 }, { enabled: true, hour: '9' }, { enabled: 'yes', hour: 9 }, {}]) { const r = await put(String(s.off._id), body); assert.deepEqual([r.status, r.data?.data?.message], [400, '自動取得の時刻は0〜23で指定してください'], 'route:amex-input-rule ' + JSON.stringify(body)); }
      assert.equal((await put(String(s.off._id), { enabled: true, hour: 9 }, 'auto-sync', '')).status, 401, 'route:no-token');
      const foreign = await amex(await owner('l6x'), '88888');
      assert.deepEqual([(await put(String(foreign._id), { enabled: true, hour: 9 })).status, (await FinancialAccount.findById(foreign._id).lean()).autoSync.enabled], [404, false], 'route:another-owner-refused');
      const unsupported = (await FinancialAccount.collection.insertOne({ ownerId: s.o._id, provider: 'unsupported-card', name: 'Synthetic unsupported card', primaryCard: '99999', cardIdentifiers: ['99999'], active: true })).insertedId;
      const refused = await put(String(unsupported), { enabled: true, hour: 9 });
      assert.deepEqual([refused.status, refused.data.statusMessage, (await FinancialAccount.collection.findOne({ _id: unsupported })).autoSync], [400, 'Amex or Aplus account required', undefined], 'route:unsupported-provider-refused ' + JSON.stringify(refused));
      for (const setting of ['fiscal-period', 'calendar', 'billing-mail']) { const r = await put(String(s.off._id), {}, setting); assert.deepEqual([r.status, r.data.statusMessage], [400, 'Aplus account required'], 'route:aplus-only-' + setting); }
      assert.equal((await s.read(s.off)).autoSync.enabled, false, 'schedule:amex-setting-unchanged');
    } finally { server.close(); }
    await FinancialAccount.updateMany({ _id: { $in: [s.off._id, s.aplus._id] } }, { $set: { 'autoSync.enabled': false } });
  });

  // ═══ L7: each legacy guard line removed in turn ═══════════════════════════════════════════════════════════════════════════════
  await leg('L7 each `// legacy:<name>` line of the service removed in turn: its attack then succeeds (the real service refuses all)', async () => {
    const { o, A, B, P, I, dev, g, previous, foreign, call } = await l1();
    await CollectorThrottle.deleteMany({});
    const file = path.join(SRC, 'server', 'services', 'financeCollectorSecurityService.ts');
    // (fold P1: a revoked OLD collector is identity evidence only, so `revoked` is no longer a guard; the CURRENT grant's own
    // revocation is refused by the unchanged activeGrant — L1 refusals and the recheck race below)
    const ATTACKS = {
      'origin': async svc => (await call({}, { svc, origin: 'https://other.example.invalid' })).origin === ORIGIN,
      'recheck': async svc => { const findOne = FinanceCollector.findOne.bind(FinanceCollector); let reads = 0; FinanceCollector.findOne = (...args) => { const q = findOne(...args); if (++reads === 2) { const lean = q.lean.bind(q); q.lean = async (...l) => { await CollectorGrant.updateOne({ _id: m.digest(g.grant) }, { $set: { revokedAt: new Date() } }); return lean(...l); }; } return q; }; try { return (await call({ legacyTokenHash: m.digest(previous.token) }, { svc })).matched === true; } finally { FinanceCollector.findOne = findOne; await CollectorGrant.updateOne({ _id: m.digest(g.grant) }, { $unset: { revokedAt: 1 } }); } },
      'same-owner': async svc => (await call({ legacyTokenHash: m.digest(foreign.token) }, { svc })).matched === true,
      'device-scope': async svc => { await FinanceCollector.updateOne({ _id: dev.row._id }, { $set: { accountIds: [A._id, B._id, I._id] } }); try { return (await call({}, { svc })).accountIds.includes(String(P._id)); } finally { await FinanceCollector.updateOne({ _id: dev.row._id }, { $set: { accountIds: [A._id, B._id, P._id, I._id] } }); } },
      'legacy-scope': async svc => (await call({ legacyTokenHash: m.digest(previous.token) }, { svc })).accountIds.includes(String(B._id)),
      'account-live': async svc => (await call({}, { svc })).accountIds.includes(String(I._id))
    };
    const succeeded = async (svc, name) => { await CollectorThrottle.deleteMany({}); try { return await ATTACKS[name](svc); } catch (e) { if ([400, 401, 403].includes(e?.statusCode)) return false; throw e; } };
    for (const name of Object.keys(ATTACKS)) assert.equal(await succeeded(m.svc, name), false, 'the real service allowed the attack ' + name);
    const caught = [];
    for (const name of Object.keys(ATTACKS)) {
      const lines = (await fsp.readFile(file, 'utf8')).split('\n'), index = lines.findIndex(l => l.includes('// legacy:' + name));
      assert.ok(index >= 0, 'guard marker missing: legacy:' + name); lines.splice(index, 1);
      const copy = path.join(path.dirname(file), 'financeCollectorSecurityService.mutant-' + name + '-' + process.pid + '.ts');
      await fsp.writeFile(copy, lines.join('\n'), { flag: 'wx' });
      try { const mutant = await import(pathToFileURL(copy).href); assert.equal(await succeeded(mutant, name), true, 'mutant legacy:' + name + ' still refused its attack'); caught.push(name); }
      finally { await fsp.unlink(copy).catch(() => {}); }
    }
    console.log('MUTANTS legacy:' + caught.join(',legacy:'));
    void o; void P;
  });

  for (const s of E.servers || []) s.close();
  if (E.child && E.child.exitCode === null) { const exited = new Promise(r => E.child.once('exit', r)); E.child.kill(); await exited; }
  await mongoose.disconnect(); await mongo.stop();
  try { (await import(u('server/services/tokenBlacklistService.ts'))).stopCleanup?.(); } catch { /* optional */ }
  await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
  console.log('RECEIPT ' + JSON.stringify({ pass: failed === 0 && checks > 0, checks, failed, src: SRC === root ? 'tree' : SRC, index: INDEX === path.join(root, 'collector', 'index.mjs') ? 'tree' : INDEX }));
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.log('FAIL harness: ' + String(e?.stack || e).replace(/\s+/g, ' ').slice(0, 900)); console.log('RECEIPT ' + JSON.stringify({ pass: false })); process.exit(1); });
