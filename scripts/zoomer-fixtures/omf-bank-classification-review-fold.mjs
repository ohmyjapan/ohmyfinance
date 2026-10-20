// Fixture for plan omf-rakuten-shiwake-review-fold-20261020: the owner exits the independent review of the native bank 仕訳
// (output/review/omf-rakuten-native-shiwake-opus55-20261020.md) found missing or unproven, and the parent's source-identity lead.
//   F1 an unregistered draft of another company is moved to the selected company explicitly (CAS, archived, nothing leaked);
//   F2 a registration whose Transaction is missing or changed is shown with its next action, released/unlinked explicitly and
//      revisioned (never a Transaction rewrite/delete), resumed with the same reserved ID, excluded from history; a late old
//      operation never completes or releases a newer reservation; a registering row has a resume lane;
//   F3 positive confirmNew and reviewed own-company transfer registrations (API) and the confirmNew/link controls (Chrome);
//   F4 an undetected holder remembered as an own-company account without an expense account; its next row stays a transfer
//      awaiting review with unknown tax/T;
//   identity: an acknowledged source (acceptSource) and an untouched refresh store the current payee and signed direction.
// Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-bank-classification-review-fold.mjs --cwd <this worktree>
// Evidence, stated exactly: synthetic only. The built app (.output) runs on an owned mongodb-memory-server (test commands
// enabled for one blocking fail point) with fictional owners, companies, rows, calendar and Transactions; owned headless Chrome.
// No collector, bank, network, credential, model or production database is touched; the collector/CSV/monthly/Navi suites are
// NOT run here (their proofs are reused by source byte compatibility and are not claimed by this fixture's covers).
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 3600000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const requireRoot = createRequire(path.join(root, 'package.json'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const u = rel => pathToFileURL(path.join(root, rel)).href;
// Only the classification paths this fixture actually executes (the docs and the .d.mts are checked by reading and by tsc).
const COVERS = ['server/models/FinanceBankClassification.ts', 'server/services/financeBankClassificationService.ts', 'server/api/finance-payments/[...path].ts', 'components/intake/BankClassificationReview.vue', 'shared/finance-bank-classification.mjs', 'scripts/finance-bank-classification.test.mjs', 'scripts/finance-bank-classification-integration.cjs', 'scripts/zoomer-fixtures/omf-bank-classification-review-fold.mjs'];
const API = '/api/finance-payments/', CLS = API + 'bank-classifications';

// ── Shift_JIS for the synthetic native statement (the table of scripts/finance-bank-classification-integration.cjs) ──
const sjisOf = new Map(), sjisDecoder = new TextDecoder('shift_jis');
for (let b = 0; b < 0x80; b++) sjisOf.set(String.fromCharCode(b), [b]);
for (let b = 0xa1; b <= 0xdf; b++) sjisOf.set(sjisDecoder.decode(Uint8Array.of(b)), [b]);
for (let lead = 0x81; lead <= 0xfc; lead++) { if (lead > 0x9f && lead < 0xe0) continue; for (let trail = 0x40; trail <= 0xfc; trail++) { if (trail === 0x7f) continue; const c = sjisDecoder.decode(Uint8Array.of(lead, trail)); if (c.length === 1 && c !== '�' && !sjisOf.has(c)) sjisOf.set(c, [lead, trail]); } }
const sjis = s => Buffer.from([...s].flatMap(c => { const b = sjisOf.get(c); if (!b) throw Error('fixture text not in Shift_JIS: ' + c); return b; }));
function nativeFile(rows, start = 2000000) { let balance = start; const lines = ['取引日,入出金(円),残高(円),入出金先内容']; for (const [date, amount, description] of rows) { balance += amount; lines.push([date, String(amount), String(balance), description].join(',')); } return sjis(lines.join('\r\n') + '\r\n'); }

// ── Owned temporary directories are removed file by file, never through a link (a link anywhere → left as a receipt) ──
const leftBehind = [];
async function linkFree(dir) { for (const e of await readdir(dir, { withFileTypes: true })) { const p = path.join(dir, e.name), s = await lstat(p); if (s.isSymbolicLink()) return false; if (s.isDirectory() && !await linkFree(p)) return false; } return true; }
async function removeOwned(dir, base) {
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(path.resolve(base) + path.sep) || !existsSync(resolved)) return;
  try {
    if (!await linkFree(resolved)) { leftBehind.push(resolved + ' (contains a link; not removed)'); return; }
    const walk = async d => { for (const e of await readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name), s = await lstat(p); if (s.isSymbolicLink()) throw Error('link appeared ' + p); if (s.isDirectory()) { await walk(p); await rmdir(p); } else await unlink(p); } };
    await walk(resolved); await rmdir(resolved);
  } catch (e) { leftBehind.push(resolved + ' (' + String(e?.code || e?.message || e).slice(0, 60) + ')'); }
}

// ── The built app on the owned MongoDB (the bootstrap of scripts/zoomer-fixtures/omf-rakuten-native-shiwake.mjs; the app's
//    connection carries an appName so one fail point can block exactly its next update; the Aplus schedule is off) ──
async function availablePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function bootApp(outputRoot, mongo, dbName, directory) {
  const appName = 'omf-fold-' + dbName, base = new URL(mongo.getUri(dbName)); base.searchParams.set('appName', appName);
  const uri = base.toString(), port = await availablePort(), origin = `http://127.0.0.1:${port}`; let logs = '';
  const child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: outputRoot, windowsHide: true, env: { ...process.env, MONGO_URI: uri, NUXT_MONGO_URI: uri, OMF_DATA_DIR: directory, OMF_SYNC_SCHEDULE_MS: '0', JWT_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', v => { logs = (logs + v).slice(-15000); });
  let healthy = false;
  for (let i = 0; i < 150; i++) { try { const d = await (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) })).json(); if (d.database?.connected && d.database.name === dbName) { healthy = true; break; } } catch { /* booting */ } await pause(200); }
  if (!healthy) { child.kill(); throw new Error('owned app did not become healthy: ' + logs.slice(-1500)); }
  const call = async (route, { method = 'GET', token, body } = {}) => {
    const response = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; } return { status: response.status, data };
  };
  const registerUser = async email => { const r = await call('/api/auth/register', { method: 'POST', body: { email, password: 'Synthetic-password-Only1!', name: 'Finance test' } }); if (r.status !== 200) throw new Error('register ' + JSON.stringify(r.data).slice(0, 300)); return r.data.tokens.accessToken; };
  const token = await registerUser('finance-a@example.invalid'), other = await registerUser('finance-b@example.invalid');
  const { MongoClient } = requireRoot('mongodb'), client = await MongoClient.connect(mongo.getUri(dbName));
  return { origin, call, token, other, appName, client, db: client.db(dbName), logs: () => logs, async close() { await client.close().catch(() => {}); if (child.exitCode === null) { const ended = new Promise(r => child.once('exit', r)); child.kill(); await ended; } } };
}

// ── The synthetic world of one app: users, the (company-agnostic) chart, companies, bank accounts, native imports, API helpers ──
async function worldOf(app, assert) {
  if (app.world) return app.world;
  const { ObjectId } = requireRoot('mongodb'), db = app.db;
  const ok = (r, label) => { assert.equal(r.status, 200, label + ' ' + JSON.stringify(r.data).slice(0, 900)); return r.data; };
  const owner = await db.collection('users').findOne({ email: 'finance-a@example.invalid' }), otherUser = await db.collection('users').findOne({ email: 'finance-b@example.invalid' });
  const chart = {}; for (const [name, type] of [['支払手数料', 'expense'], ['受取利息', 'income'], ['普通預金', 'asset'], ['地代家賃', 'expense'], ['外注費', 'expense'], ['売上高', 'income']]) { chart[name] = new ObjectId(); await db.collection('accountcategories').insertOne({ _id: chart[name], name, type, isActive: true, order: 0 }); }
  const company = async (name, user = owner, t = app.token) => { const _id = new ObjectId(); await db.collection('organizations').insertOne({ _id, name, slug: 'fold-' + String(_id), type: 'business', isActive: true, members: [{ userId: user._id, role: 'owner', joinedAt: new Date() }], settings: { defaultCurrency: 'JPY' } }); return { id: _id, name, token: ok(await app.call('/api/auth/switch-organization', { token: t, method: 'POST', body: { organizationId: String(_id) } }), 'switch').tokens.accessToken }; };
  const accounts = new Map();
  const account = async name => { const id = ok(await app.call(API + 'bank/accounts', { method: 'POST', token: app.token, body: { name, currency: 'JPY' } }), 'bank-account').account.id; accounts.set(id, name); return id; };
  const importRows = async (acct, rows, name, start) => {
    const response = await fetch(app.origin + API + 'bank/files?name=' + name, { method: 'POST', headers: { Authorization: 'Bearer ' + app.token, 'Content-Type': 'text/csv' }, body: nativeFile(rows, start) });
    const d = await response.json(); assert.equal(response.status, 200, 'bank-file ' + JSON.stringify(d).slice(0, 300));
    const s = ok(await app.call(API + 'bank/files/' + d.document.id + '/sheet', { token: app.token }), 'bank-sheet');
    const imported = ok(await app.call(API + 'bank/files/' + d.document.id + '/import', { method: 'POST', token: app.token, body: { sheet: s.sheet, headerRow: s.headerRow, mapping: s.mapping, bankAccountId: acct, transactionIdConfirmed: false, amountSign: 'outflow-negative', confirm: true } }), 'bank-import');
    assert.equal(imported.rows.length, rows.length, 'rows imported ' + name); return imported;
  };
  const rowBy = async (acct, description, date) => { const all = (await db.collection('financebankrows').find({ bankAccountId: new ObjectId(acct) }).toArray()).filter(r => r.description === description.normalize('NFKC') && (!date || r.date === date)); assert.equal(all.length, 1, 'one row ' + description + ' ' + (date || '')); return all[0]; };
  const list = (co, acct) => app.call(CLS + '?account=' + acct, { token: co.token });
  const gen = async (co, acct) => ok(await app.call(CLS + '/generate', { method: 'POST', token: co.token, body: { bankAccountId: acct } }), 'generate');
  const rowIn = (data, row) => { const found = data.rows.find(x => x.rowId === String(row._id)); assert.ok(found, 'row visible ' + row.description); return found; };
  const draftOf = async (co, acct, row) => { const d = rowIn(ok(await list(co, acct), 'list'), row).draft; assert.ok(d, 'draft for ' + row.description); return d; };
  const put = (co, d, body) => app.call(CLS + '/' + d.id, { method: 'PUT', token: co.token, body });
  const fix = async (co, acct, row, purpose, account = '外注費', extra = {}) => { const d = await draftOf(co, acct, row); return ok(await put(co, d, { revision: d.revision, values: { purpose, accountCategoryId: String(chart[account]), ...extra } }), 'edit ' + purpose).row.draft; };
  const register = (co, d, body) => app.call(CLS + '/' + d.id + '/register', { method: 'POST', token: co.token, body });
  const remember = (co, d, body) => app.call(CLS + '/' + d.id + '/remember', { method: 'POST', token: co.token, body });
  const release = (co, d, body) => app.call(CLS + '/' + d.id + '/release', { method: 'POST', token: co.token, body });
  const reassign = (co, body) => app.call(CLS + '/reassign', { method: 'POST', token: co.token, body });
  const stored = id => db.collection('financebankclassifications').findOne({ _id: new ObjectId(String(id)) });
  const tx = id => db.collection('transactions').findOne({ _id: new ObjectId(String(id)) });
  const existingTx = async (co, date, amount, notes) => (await db.collection('transactions').insertOne({ organizationId: co.id, date: new Date(date + 'T00:00:00.000Z'), amount, type: '支出', status: 'completed', notes, items: [], timeline: [], createdAt: new Date(), updatedAt: new Date() })).insertedId;
  const bankSide = acct => '普通預金（' + accounts.get(acct) + '）';
  app.world = { ObjectId, db, ok, owner, otherUser, chart, company, account, importRows, rowBy, list, gen, rowIn, draftOf, put, fix, register, remember, release, reassign, stored, tx, existingTx, bankSide };
  return app.world;
}

// ── One blocking fail point: the app's next `update` command waits, observed in $currentOp before the fixture interleaves ──
async function holdNextUpdate(app, fn) {
  const admin = app.client.db('admin');
  await admin.command({ configureFailPoint: 'failCommand', mode: { times: 1 }, data: { failCommands: ['update'], appName: app.appName, blockConnection: true, blockTimeMS: 4000 } });
  try { return await fn(async () => { for (let i = 0; i < 70; i++) { const ops = await admin.aggregate([{ $currentOp: { allUsers: true, idleConnections: false } }, { $match: { appName: app.appName } }]).toArray(); if (ops.some(o => o.command?.update)) return true; await pause(40); } return false; }); }
  finally { await admin.command({ configureFailPoint: 'failCommand', mode: 'off' }).catch(() => {}); }
}

// ══ API legs: each sets up its own companies/accounts on the given app, so a mutant app can rerun exactly one leg ══
const legs = {
  // Parent identity lead (1): a manual source acknowledgement after a genuinely different payee and a flipped direction.
  async A1a(app, assert, normalizePayee) {
    const w = await worldOf(app, assert), P = await w.company('Fold identity accept'), acct = await w.account('Synthetic fold identity A');
    await w.importRows(acct, [['20260910', -40000, '振込 カクウデザイン']], 'fold-identity-a1.csv');
    const r = await w.rowBy(acct, '振込 カクウデザイン'); await w.gen(P, acct);
    const d0 = await w.draftOf(P, acct, r); assert.deepEqual([d0.payeeKey, (await w.stored(d0.id)).direction], [normalizePayee('振込 カクウデザイン'), 'out']);
    await w.fix(P, acct, r, '外注費');
    const NEW = 'ﾌﾘｺﾐ ｶ)ﾐﾄﾞﾘｼｮｳｶｲ';
    await w.db.collection('financebankrows').updateOne({ _id: r._id }, { $inc: { revision: 1 }, $set: { description: NEW.normalize('NFKC'), amount: -40000, direction: 'in' }, $push: { history: { at: new Date(), action: 'source-updated' } } });
    const d1 = await w.draftOf(P, acct, r); assert.equal(d1.sourceChanged, true, 'fold:identity-source-changed-visible');
    const e1 = w.ok(await w.put(P, d1, { revision: d1.revision, acceptSource: true, values: { purpose: 'Synthetic 売上', accountCategoryId: String(w.chart['売上高']) } }), 'accept-source').row.draft;
    const s1 = await w.stored(e1.id);
    assert.equal(s1.payeeKey, normalizePayee(NEW), 'fold:accept-source-payee (the acknowledged payee is the stored identity)');
    assert.equal(s1.direction, 'in', 'fold:accept-source-direction (the acknowledged signed direction is the stored identity)');
    assert.equal(e1.payeeKey, normalizePayee(NEW), 'fold:accept-source-payee (view)'); assert.equal(e1.sourceChanged, false);
    assert.deepEqual(e1.preview, { debit: { account: w.bankSide(acct), amount: 40000 }, credit: { account: '売上高', amount: 40000 } }, 'fold:accept-source-preview (incoming: the bank is debited)');
    const taught = w.ok(await w.remember(P, e1, { revision: e1.revision }), 'remember').teaching;
    assert.deepEqual([taught.payeeKey, taught.direction], [normalizePayee(NEW), 'in'], 'fold:teach-new-identity');
    assert.equal(await w.db.collection('financebankteachings').countDocuments({ organizationId: P.id, payeeKey: normalizePayee('振込 カクウデザイン') }), 0, 'fold:old-identity-not-taught');
    await w.importRows(acct, [['20261010', 40000, NEW], ['20261012', -40000, NEW], ['20261014', -40000, '振込 カクウデザイン']], 'fold-identity-a2.csv', 1000000);
    const later = w.ok(await w.list(P, acct), 'list-later');
    const inRow = w.rowIn(later, await w.rowBy(acct, NEW, '2026-10-10')), outRow = w.rowIn(later, await w.rowBy(acct, NEW, '2026-10-12')), oldRow = w.rowIn(later, await w.rowBy(acct, '振込 カクウデザイン', '2026-10-14'));
    assert.equal(inRow.proposal.proposal.purposeKind, 'teaching', 'fold:teaching-new-identity-applies'); assert.equal(inRow.proposal.proposal.accountCategoryId, String(w.chart['売上高']));
    assert.notEqual(outRow.proposal.proposal.purposeKind, 'teaching', 'fold:teaching-direction-exact');
    assert.equal(oldRow.proposal.proposal.purposeKind, 'none', 'fold:old-identity-no-proposal');
    return 'acceptSource stored the new payee ' + s1.payeeKey + ' and direction in; preview, teaching and later proposals follow it';
  },
  // Parent identity lead (2): an untouched refresh after the signed direction flipped; history under the refreshed identity.
  async A1b(app, assert, normalizePayee) {
    const w = await worldOf(app, assert), P = await w.company('Fold identity refresh'), acct = await w.account('Synthetic fold identity B');
    await w.importRows(acct, [['20260915', -20000, '振込 カクウコンサル']], 'fold-identity-b1.csv');
    const r = await w.rowBy(acct, '振込 カクウコンサル'); await w.gen(P, acct);
    const d0 = await w.draftOf(P, acct, r); assert.equal(d0.manual, false); assert.equal((await w.stored(d0.id)).direction, 'out');
    await w.db.collection('financebankrows').updateOne({ _id: r._id }, { $inc: { revision: 1 }, $set: { amount: -20000, direction: 'in' }, $push: { history: { at: new Date(), action: 'source-updated' } } });
    const refreshed = await w.gen(P, acct); assert.equal(refreshed.refreshed, 1, 'fold:refresh-ran');
    const s = await w.stored(d0.id);
    assert.equal(s.direction, 'in', 'fold:refresh-direction (an untouched refresh stores the current signed direction)'); assert.equal(s.payeeKey, normalizePayee('振込 カクウコンサル'));
    const d1 = await w.draftOf(P, acct, r); assert.equal(d1.sourceChanged, false, 'fold:refresh-source-current');
    assert.equal(d1.preview.debit.account, w.bankSide(acct), 'fold:refresh-preview (incoming: the bank is debited)');
    const e1 = await w.fix(P, acct, r, 'Synthetic 受取', '売上高'), reg = w.ok(await w.register(P, e1, { revision: e1.revision, action: 'create', confirm: true }), 'register');
    assert.equal((await w.tx(reg.transaction.id)).type, '入金', 'fold:refresh-registered-direction');
    await w.importRows(acct, [['20261011', 20000, '振込 カクウコンサル'], ['20261013', -20000, '振込 カクウコンサル']], 'fold-identity-b2.csv', 1000000);
    const later = w.ok(await w.list(P, acct), 'list-later');
    assert.equal(w.rowIn(later, await w.rowBy(acct, '振込 カクウコンサル', '2026-10-11')).proposal.proposal.purposeKind, 'history', 'fold:history-new-direction');
    assert.equal(w.rowIn(later, await w.rowBy(acct, '振込 カクウコンサル', '2026-10-13')).proposal.proposal.purposeKind, 'none', 'fold:history-old-direction-gone');
    return 'untouched refresh stored direction in; registered as 入金; history applies to the refreshed direction only';
  },
  // F1: an explicit, revisioned move of another company's unregistered draft; registered rows stay exclusive; nothing leaks.
  async A2(app, assert) {
    const w = await worldOf(app, assert), P = await w.company('Fold reassign P'), Q = await w.company('Fold reassign Q'), acct = await w.account('Synthetic fold reassign');
    const noon = d => new Date(d + 'T12:00:00.000Z'), entry = (co, title) => ({ _id: new w.ObjectId(), title, amount: 7700, currency: 'JPY', dueDate: noon('2026-09-20'), type: 'expense', status: 'pending', category: '外注費', recurring: false, organizationId: co.id, createdAt: new Date(), updatedAt: new Date() });
    await w.db.collection('payments').insertMany([entry(P, 'Synthetic secret plan P'), entry(Q, 'Synthetic Q plan')]);
    await w.importRows(acct, [['20260920', -7700, '振込 カクウヒミツ'], ['20260921', -8800, '振込 カクウトウロク']], 'fold-reassign.csv');
    const r1 = await w.rowBy(acct, '振込 カクウヒミツ'), r2 = await w.rowBy(acct, '振込 カクウトウロク'); await w.gen(P, acct);
    const d1 = await w.draftOf(P, acct, r1); assert.equal(d1.proposed.purpose, 'Synthetic secret plan P');
    const e1 = await w.fix(P, acct, r1, 'P secret purpose', '外注費', { notes: 'P private note' }); w.ok(await w.remember(P, e1, { revision: e1.revision }), 'remember-P');
    const e2 = await w.fix(P, acct, r2, 'P registered'), reg2 = w.ok(await w.register(P, e2, { revision: e2.revision, action: 'create', confirm: true }), 'register-P');
    const SECRETS = ['P secret purpose', 'P private note', 'Synthetic secret plan P', 'P registered'];
    const noSecret = (data, label) => { const text = JSON.stringify(data); for (const s of SECRETS) assert.ok(!text.includes(s), label + ' leaked ' + s); };
    const qList = w.ok(await w.list(Q, acct), 'list-Q'), q1 = w.rowIn(qList, r1), q2 = w.rowIn(qList, r2);
    assert.deepEqual([q1.state, q1.draft], ['other-company', null]); noSecret(qList, 'fold:other-company-no-leak');
    assert.ok(q1.otherCompanyDraft && Number.isSafeInteger(q1.otherCompanyDraft.revision) && q1.otherCompanyDraft.registered === false, 'fold:reassign-offered (an unregistered draft of another company can be moved here) ' + JSON.stringify(q1.otherCompanyDraft));
    assert.equal(q2.otherCompanyDraft?.registered, true, 'fold:reassign-registered-shown');
    const rev = q1.otherCompanyDraft.revision, body = { bankAccountId: acct, rowId: String(r1._id), revision: rev, confirm: true };
    assert.equal((await w.reassign(Q, { ...body, confirm: undefined })).status, 400, 'fold:reassign-needs-confirm');
    assert.equal((await w.reassign(Q, { ...body, revision: rev + 1 })).status, 409, 'fold:reassign-stale');
    const before2 = await w.stored(e2.id), exclusive = await w.reassign(Q, { ...body, rowId: String(r2._id), revision: q2.otherCompanyDraft.revision });
    assert.equal(exclusive.status, 409, 'fold:reassign-registered-exclusive ' + JSON.stringify(exclusive.data).slice(0, 200)); assert.deepEqual(await w.stored(e2.id), before2, 'fold:reassign-registered-unchanged');
    const X = await w.company('Fold reassign foreign', w.otherUser, app.other);
    assert.equal((await w.reassign(X, body)).status, 404, 'fold:reassign-owner-scoped'); assert.equal((await w.reassign(P, body)).status, 409, 'fold:reassign-same-company');
    const both = await Promise.all([1, 2].map(() => w.reassign(Q, body)));
    assert.deepEqual(both.map(x => x.status).sort(), [200, 409], 'fold:reassign-cas (two claims at one revision: exactly one wins) ' + JSON.stringify(both.map(x => [x.status, JSON.stringify(x.data).slice(0, 120)])));
    const won = both.find(x => x.status === 200).data; noSecret(won, 'fold:reassign-no-leak');
    assert.equal(won.row.state, 'proposed', 'fold:reassign-state'); assert.equal(won.row.draft.proposed.purpose, 'Synthetic Q plan', 'fold:reassign-own-evidence (the new company\'s own calendar)');
    assert.deepEqual(won.row.draft.history.map(h => h.action), ['company-reassigned'], 'fold:reassign-history-reset');
    const s1 = await w.stored(d1.id);
    assert.equal(String(s1.organizationId), String(Q.id), 'fold:reassign-company'); assert.equal(s1.revision, rev + 1); assert.equal(s1.manual, false); assert.equal(String(s1.reservedTransactionId), String(d1.reservedTransactionId), 'fold:reassign-reserved-id-kept');
    assert.equal(s1.archive?.length, 1, 'fold:reassign-archived'); assert.equal(String(s1.archive[0].organizationId), String(P.id)); assert.deepEqual([s1.archive[0].values.purpose, s1.archive[0].values.notes], ['P secret purpose', 'P private note'], 'fold:reassign-archived (old company values kept)'); assert.ok(s1.archive[0].history.length >= 2, 'fold:reassign-archived (old history kept)');
    noSecret(w.ok(await app.call(CLS + '/' + d1.id, { token: Q.token }), 'get-Q'), 'fold:reassign-get-no-leak');
    assert.equal((await app.call(CLS + '/' + d1.id, { token: P.token })).status, 404, 'fold:reassign-old-company-scoped'); assert.equal(w.rowIn(w.ok(await w.list(P, acct), 'list-P'), r1).state, 'other-company');
    assert.deepEqual([await w.db.collection('financebankteachings').countDocuments({ organizationId: P.id }), await w.db.collection('financebankteachings').countDocuments({ organizationId: Q.id })], [1, 0], 'fold:reassign-teaching-stays');
    const indexes = await w.db.collection('financebankclassifications').indexes(), keyOf = i => JSON.stringify(i.key);
    assert.ok(indexes.some(i => i.unique && keyOf(i) === '{"ownerId":1,"bankRowId":1}') && indexes.some(i => i.unique && keyOf(i) === '{"reservedTransactionId":1}'), 'fold:indexes-kept ' + indexes.map(keyOf).join(' '));
    const q = await w.fix(Q, acct, r1, 'Q purpose'), regQ = w.ok(await w.register(Q, q, { revision: q.revision, action: 'create', confirm: true }), 'register-Q');
    assert.equal(regQ.transaction.id, String(d1.reservedTransactionId), 'fold:reassign-register-in-new-company'); assert.equal(String((await w.tx(regQ.transaction.id)).organizationId), String(Q.id));
    const back = w.rowIn(w.ok(await w.list(P, acct), 'list-P2'), r1);
    assert.equal(back.otherCompanyDraft?.registered, true); assert.equal((await w.reassign(P, { ...body, revision: back.otherCompanyDraft.revision })).status, 409, 'fold:reassign-back-refused');
    assert.equal(String((await w.tx(reg2.transaction.id)).organizationId), String(P.id));
    return 'offered, confirm/stale/registered/foreign/same-company refused, one of two concurrent claims won, archived with the old company, reset to Q evidence, nothing leaked, registered in Q with the same reserved ID';
  },
  // F2: missing/changed targets shown, explicit revisioned release/unlink, no Transaction rewrite, same reserved ID, history.
  async A3(app, assert) {
    const w = await worldOf(app, assert), P = await w.company('Fold release'), acct = await w.account('Synthetic fold release');
    await w.importRows(acct, [['20260903', -3300, '振込 カクウパーツ'], ['20260904', -4400, '振込 カクウツール'], ['20260905', -5500, '口座振替 カクウリンク'], ['20260906', -6600, '口座振替 カクウリンクニ'], ['20260907', -2200, '振込 カクウヨヤク']], 'fold-release-1.csv');
    const R = { c1: await w.rowBy(acct, '振込 カクウパーツ'), c2: await w.rowBy(acct, '振込 カクウツール'), l1: await w.rowBy(acct, '口座振替 カクウリンク'), l2: await w.rowBy(acct, '口座振替 カクウリンクニ'), y: await w.rowBy(acct, '振込 カクウヨヤク') };
    const T5500 = await w.existingTx(P, '2026-09-05', 5500, 'Synthetic linked A'), T5500b = await w.existingTx(P, '2026-09-06', 5500, 'Synthetic linked B'), T6600 = await w.existingTx(P, '2026-09-06', 6600, 'Synthetic linked C');
    await w.gen(P, acct);
    const view = async row => w.rowIn(w.ok(await w.list(P, acct), 'list'), row);
    // created, then deleted on the native Transaction page: missing → release → the same reserved ID once more
    const c1 = await w.fix(P, acct, R.c1, 'Synthetic parts'), reg1 = w.ok(await w.register(P, c1, { revision: c1.revision, action: 'create', confirm: true }), 'register-c1');
    assert.equal(reg1.transaction.id, String(c1.reservedTransactionId));
    w.ok(await app.call('/api/transactions/' + reg1.transaction.id, { method: 'DELETE', token: P.token }), 'native delete');
    const m1 = await view(R.c1);
    assert.equal(m1.draft?.registration?.target, 'missing', 'fold:missing-detected ' + JSON.stringify(m1.draft?.registration));
    assert.ok(w.ok(await w.list(P, acct), 'list').counts.issues >= 1, 'fold:issue-counted');
    const resumeMissing = await w.register(P, m1.draft, { revision: m1.draft.revision, action: 'create', confirm: true });
    assert.equal(resumeMissing.status, 409); assert.match(JSON.stringify(resumeMissing.data), /registered-transaction-missing/, 'fold:missing-resume-points-to-release');
    await w.importRows(acct, [['20261003', -3300, '振込 カクウパーツ']], 'fold-release-2.csv', 900000);
    assert.notEqual((await view(await w.rowBy(acct, '振込 カクウパーツ', '2026-10-03'))).proposal.proposal.purposeKind, 'history', 'fold:history-excludes-missing');
    const relBody = { revision: m1.draft.revision, transactionId: reg1.transaction.id, confirm: true };
    assert.equal((await w.release(P, m1.draft, { ...relBody, confirm: undefined })).status, 400, 'fold:release-needs-confirm');
    assert.equal((await w.release(P, m1.draft, { ...relBody, revision: relBody.revision + 1 })).status, 409, 'fold:release-stale');
    assert.equal((await w.release(P, m1.draft, { ...relBody, transactionId: String(new w.ObjectId()) })).status, 409, 'fold:release-bound-to-target');
    const Q = await w.company('Fold release other'); assert.equal((await w.release(Q, m1.draft, relBody)).status, 404, 'fold:release-company-scoped');
    const rel1 = w.ok(await w.release(P, m1.draft, relBody), 'release-c1'), s1 = await w.stored(c1.id), h1 = s1.history.at(-1);
    assert.equal(s1.registration, null, 'fold:release-recorded'); assert.deepEqual([h1.action, h1.reason, String(h1.transactionId), h1.revision], ['registration-released', 'transaction-missing', reg1.transaction.id, relBody.revision + 1], 'fold:release-recorded (history)');
    assert.equal(String(s1.reservedTransactionId), reg1.transaction.id, 'fold:release-keeps-reserved-id'); assert.equal(await w.db.collection('transactions').countDocuments({ _id: new w.ObjectId(reg1.transaction.id) }), 0, 'fold:release-creates-nothing');
    const again = w.ok(await w.register(P, rel1.row.draft, { revision: rel1.row.draft.revision, action: 'create', confirm: true }), 'register-again');
    assert.equal(again.transaction.id, reg1.transaction.id, 'fold:re-register-same-id'); assert.equal(await w.db.collection('transactions').countDocuments({ 'metadata.bankClassificationId': c1.id }), 1, 'fold:re-register-once');
    // created, then re-amounted on the native page: changed, never released while present, excluded from history
    const c2 = await w.fix(P, acct, R.c2, 'Synthetic tool'), reg2 = w.ok(await w.register(P, c2, { revision: c2.revision, action: 'create', confirm: true }), 'register-c2');
    w.ok(await app.call('/api/transactions/' + reg2.transaction.id, { method: 'PUT', token: P.token, body: { amount: 4500 } }), 'native re-amount');
    const m2 = await view(R.c2); assert.equal(m2.draft?.registration?.target, 'changed', 'fold:changed-detected ' + JSON.stringify(m2.draft?.registration));
    const present = await w.tx(reg2.transaction.id), refused = await w.release(P, m2.draft, { revision: m2.draft.revision, transactionId: reg2.transaction.id, confirm: true });
    assert.equal(refused.status, 409, 'fold:release-keeps-present-transaction ' + JSON.stringify(refused.data).slice(0, 200)); assert.match(JSON.stringify(refused.data), /registered-transaction-present/, 'fold:release-keeps-present-transaction (next action named)');
    assert.deepEqual(await w.tx(reg2.transaction.id), present, 'fold:present-transaction-untouched'); assert.equal((await w.stored(c2.id)).registration.state, 'registered');
    await w.importRows(acct, [['20261004', -4400, '振込 カクウツール']], 'fold-release-3.csv', 800000);
    assert.notEqual((await view(await w.rowBy(acct, '振込 カクウツール', '2026-10-04'))).proposal.proposal.purposeKind, 'history', 'fold:history-excludes-changed');
    // a mistaken link: unlinked explicitly, the Transaction byte-identical, then the right one linked
    const l1 = await w.fix(P, acct, R.l1, 'Synthetic subscription'), cands = w.ok(await app.call(CLS + '/' + l1.id, { token: P.token }), 'get-l1').linkCandidates.map(c => c.id);
    assert.deepEqual(cands.sort(), [String(T5500), String(T5500b)].sort());
    w.ok(await w.register(P, l1, { revision: l1.revision, action: 'link', transactionId: String(T5500), confirm: true }), 'link-l1');
    const beforeT = await w.tx(T5500), lv = await view(R.l1); assert.equal(lv.draft.registration.target, 'present', 'fold:link-present');
    const un = w.ok(await w.release(P, lv.draft, { revision: lv.draft.revision, transactionId: String(T5500), confirm: true }), 'unlink-l1');
    assert.deepEqual(await w.tx(T5500), beforeT, 'fold:unlink-no-rewrite'); const sl = await w.stored(l1.id);
    assert.equal(sl.registration, null); assert.deepEqual([sl.history.at(-1).action, sl.history.at(-1).reason], ['link-released', 'owner-unlink'], 'fold:unlink-recorded');
    w.ok(await w.register(P, un.row.draft, { revision: un.row.draft.revision, action: 'link', transactionId: String(T5500b), confirm: true }), 'fold:relink-after-unlink');
    // a linked Transaction deleted natively: missing; the unlink creates nothing
    const l2 = await w.fix(P, acct, R.l2, 'Synthetic subscription 2'); w.ok(await w.register(P, l2, { revision: l2.revision, action: 'link', transactionId: String(T6600), confirm: true }), 'link-l2');
    w.ok(await app.call('/api/transactions/' + String(T6600), { method: 'DELETE', token: P.token }), 'native delete linked');
    const m4 = await view(R.l2); assert.equal(m4.draft.registration.target, 'missing', 'fold:link-missing-detected');
    const count = await w.db.collection('transactions').countDocuments();
    w.ok(await w.release(P, m4.draft, { revision: m4.draft.revision, transactionId: String(T6600), confirm: true }), 'unlink-l2');
    assert.equal((await w.stored(l2.id)).registration, null); assert.equal(await w.db.collection('transactions').countDocuments(), count, 'fold:link-release-creates-nothing');
    // a reservation in progress is resumed (its own lane), never released by the owner action
    const y = await w.fix(P, acct, R.y, 'Synthetic reserved'), regY = w.ok(await w.register(P, y, { revision: y.revision, action: 'create', confirm: true }), 'register-y');
    await w.db.collection('financebankclassifications').updateOne({ _id: new w.ObjectId(y.id) }, { $set: { 'registration.state': 'reserved' } });
    const yv = await view(R.y); assert.equal(yv.state, 'registering');
    const ry = await w.release(P, yv.draft, { revision: yv.draft.revision, transactionId: regY.transaction.id, confirm: true });
    assert.equal(ry.status, 409, 'fold:release-refuses-reserved'); assert.match(JSON.stringify(ry.data), /registration-reserved/, 'fold:release-refuses-reserved (resume named)');
    return 'missing/changed/link targets shown; release needs confirm, revision and the exact target; present creation kept; unlink byte-identical; re-register with the same reserved ID once; history excludes missing/changed';
  },
  // F2: a late old operation (a resume blocked inside its update) never completes or releases a newer reservation.
  async A4(app, assert) {
    const w = await worldOf(app, assert), P = await w.company('Fold late operation'), acct = await w.account('Synthetic fold late');
    await w.importRows(acct, [['20260908', -1100, '振込 カクウレイト'], ['20260909', -1200, '口座振替 カクウレイトリンク']], 'fold-late.csv');
    const rA = await w.rowBy(acct, '振込 カクウレイト'), rB = await w.rowBy(acct, '口座振替 カクウレイトリンク');
    const T1 = await w.existingTx(P, '2026-09-09', 1200, 'Synthetic late A'), T2 = await w.existingTx(P, '2026-09-10', 1200, 'Synthetic late B');
    await w.gen(P, acct); const col = w.db.collection('financebankclassifications');
    // a create reservation whose insert had not happened (crash state), resumed by an old operation that stalls in its update
    const a = await w.fix(P, acct, rA, 'Synthetic late'), regA = w.ok(await w.register(P, a, { revision: a.revision, action: 'create', confirm: true }), 'register-a');
    await w.db.collection('transactions').deleteOne({ _id: new w.ObjectId(regA.transaction.id) }); await col.updateOne({ _id: new w.ObjectId(a.id) }, { $set: { 'registration.state': 'reserved' } });
    const newerA = new w.ObjectId().toHexString();
    const oldA = await holdNextUpdate(app, async blocked => {
      const pending = w.register(P, a, { revision: a.revision, action: 'create', confirm: true });
      if (!await blocked()) { await pending; throw new Error('NOT RUN: the old operation was not observed blocked in its update'); }
      await col.updateOne({ _id: new w.ObjectId(a.id) }, { $set: { 'registration.op': newerA, 'registration.at': new Date() }, $inc: { revision: 1 }, $push: { history: { at: new Date(), action: 'simulated-newer-reservation' } } });
      return pending;
    });
    const sa = await col.findOne({ _id: new w.ObjectId(a.id) });
    assert.equal(sa.registration?.op, newerA, 'fold:late-op-not-marking-newer (the newer reservation is kept)');
    assert.equal(sa.registration?.state, 'reserved', 'fold:late-op-not-marking-newer (an old operation never completes a newer reservation)');
    assert.equal(oldA.status, 409, 'fold:late-op-refused ' + JSON.stringify(oldA.data).slice(0, 200));
    const doneA = w.ok(await w.register(P, a, { action: 'create', confirm: true }), 'resume-newer');
    assert.equal(doneA.transaction.id, String(a.reservedTransactionId)); assert.equal(await w.db.collection('transactions').countDocuments({ 'metadata.bankClassificationId': a.id }), 1, 'fold:late-op-one-effect (the fixed reserved ID)');
    assert.deepEqual([(await col.findOne({ _id: new w.ObjectId(a.id) })).registration.state, (await col.findOne({ _id: new w.ObjectId(a.id) })).registration.op], ['registered', newerA]);
    // a link reservation whose target vanished: the old operation's release must not drop a newer reservation to another target
    const b = await w.fix(P, acct, rB, 'Synthetic late link'); w.ok(await w.register(P, b, { revision: b.revision, action: 'link', transactionId: String(T1), confirm: true }), 'link-b');
    await col.updateOne({ _id: new w.ObjectId(b.id) }, { $set: { 'registration.state': 'reserved' } }); await w.db.collection('transactions').deleteOne({ _id: T1 });
    const newerB = new w.ObjectId().toHexString();
    const oldB = await holdNextUpdate(app, async blocked => {
      const pending = w.register(P, b, { revision: b.revision, action: 'link', transactionId: String(T1), confirm: true });
      if (!await blocked()) { await pending; throw new Error('NOT RUN: the old release was not observed blocked in its update'); }
      await col.updateOne({ _id: new w.ObjectId(b.id) }, { $set: { 'registration.op': newerB, 'registration.transactionId': T2, 'registration.at': new Date() }, $inc: { revision: 1 }, $push: { history: { at: new Date(), action: 'simulated-newer-reservation' } } });
      return pending;
    });
    const sb = await col.findOne({ _id: new w.ObjectId(b.id) });
    assert.ok(sb.registration && sb.registration.op === newerB && String(sb.registration.transactionId) === String(T2), 'fold:late-op-not-releasing-newer ' + JSON.stringify(sb.registration));
    assert.equal(oldB.status, 409);
    const beforeT2 = await w.tx(T2), doneB = w.ok(await w.register(P, b, { action: 'link', transactionId: String(T2), confirm: true }), 'resume-newer-link');
    assert.equal(doneB.transaction.id, String(T2)); assert.equal((await col.findOne({ _id: new w.ObjectId(b.id) })).registration.state, 'linked'); assert.deepEqual(await w.tx(T2), beforeT2, 'fold:late-link-no-rewrite');
    return 'old create resume refused (409) without completing the newer reservation; newer resumed to one Transaction at the reserved ID; old link release did not drop the newer link reservation';
  },
  // F3: the legitimate manual exits, positively: confirmNew past an unrelated amount-only candidate, a reviewed own transfer.
  async A5(app, assert) {
    const w = await worldOf(app, assert), P = await w.company('カクウトレード'), acct = await w.account('Synthetic fold exits');
    await w.importRows(acct, [['20260912', -8800, '振込 カクウベンダー'], ['20260913', -300000, '振込 カ）カクウトレード']], 'fold-exits.csv');
    const rN = await w.rowBy(acct, '振込 カクウベンダー'), rT = await w.rowBy(acct, '振込 カ）カクウトレード'), T8800 = await w.existingTx(P, '2026-09-12', 8800, 'Synthetic unrelated');
    await w.gen(P, acct);
    const n = await w.fix(P, acct, rN, 'Synthetic purchase');
    assert.deepEqual(w.ok(await app.call(CLS + '/' + n.id, { token: P.token }), 'get-n').linkCandidates.map(c => c.id), [String(T8800)], 'fold:candidate-present');
    const refused = await w.register(P, n, { revision: n.revision, action: 'create', confirm: true }); assert.equal(refused.status, 409); assert.match(JSON.stringify(refused.data), /existing-transaction-candidate/);
    const before = await w.tx(T8800), created = w.ok(await w.register(P, n, { revision: n.revision, action: 'create', confirm: true, confirmNew: true }), 'fold:confirm-new-creates');
    assert.equal(created.transaction.id, String(n.reservedTransactionId), 'fold:confirm-new-creates (the reserved ID)'); const t = await w.tx(created.transaction.id);
    assert.deepEqual([t.amount, t.type, String(t.organizationId), t.metadata.bankClassificationId], [8800, '支出', String(P.id), n.id], 'fold:confirm-new-effect');
    assert.deepEqual(await w.tx(T8800), before, 'fold:confirm-new-leaves-candidate');
    const replay = w.ok(await w.register(P, n, { revision: n.revision, action: 'create', confirm: true, confirmNew: true }), 'replay');
    assert.equal(replay.replayed, true); assert.equal(await w.db.collection('transactions').countDocuments({ 'metadata.bankClassificationId': n.id }), 1, 'fold:confirm-new-idempotent');
    const dt = await w.draftOf(P, acct, rT); assert.deepEqual(dt.transfer, { kind: 'own-company', proof: 'awaiting-other-bank' });
    const et = await w.fix(P, acct, rT, 'Synthetic 資金移動', '普通預金'); assert.deepEqual(et.ready.reasons, ['transfer-unreviewed']);
    assert.equal((await w.register(P, et, { revision: et.revision, action: 'create', confirm: true })).status, 409, 'fold:unreviewed-transfer-refused');
    const er = w.ok(await w.put(P, et, { revision: et.revision, values: { transferReviewed: true } }), 'review-transfer').row.draft;
    assert.equal(er.ready.ready, true, 'fold:reviewed-transfer-ready ' + JSON.stringify(er.ready));
    const rt = w.ok(await w.register(P, er, { revision: er.revision, action: 'create', confirm: true }), 'fold:reviewed-transfer-registers'), t2 = await w.tx(rt.transaction.id);
    assert.deepEqual([String(t2.accountCategoryId), t2.type, t2.amount, t2.metadata.purpose, t2.metadata.taxStatus, t2.metadata.invoiceNumberStatus, t2.taxCategoryId], [String(w.chart['普通預金']), '支出', 300000, 'Synthetic 資金移動', 'unknown', 'none', undefined], 'fold:reviewed-transfer-effect');
    assert.ok(t2.metadata.unresolvedAtRegistration.includes('transfer-awaiting-other-bank'), 'fold:reviewed-transfer-unresolved-kept');
    return 'confirmNew created the reserved-ID Transaction beside an unrelated candidate (left unchanged, replay idempotent); a reviewed own transfer registered with the owner-chosen account, tax unknown';
  },
  // F4: the owner remembers an undetected holder as an own-company account; the next row stays a transfer awaiting review.
  async A6(app, assert) {
    const w = await worldOf(app, assert), P = await w.company('カクウホールディングス'), acct = await w.account('Synthetic fold own holder');
    const HOLDER = '振込 カクウホ-ルディングス ニホン';
    await w.importRows(acct, [['20260914', -100000, HOLDER], ['20260915', -165, '振込手数料'], ['20260916', -7000, '振込 カクウサプライ']], 'fold-own-1.csv');
    const rH = await w.rowBy(acct, HOLDER), rF = await w.rowBy(acct, '振込手数料'), rS = await w.rowBy(acct, '振込 カクウサプライ'); await w.gen(P, acct);
    const h = await w.draftOf(P, acct, rH), fee = await w.draftOf(P, acct, rF), s = await w.draftOf(P, acct, rS);
    assert.deepEqual([h.transfer, h.manual, h.proposed.purposeKind], [null, false, 'none'], 'fold:holder-undetected');
    assert.equal((await w.remember(P, s, { revision: s.revision })).status, 400, 'fold:supplier-teach-still-needs-decision');
    assert.equal((await w.remember(P, fee, { revision: fee.revision, kind: 'own-transfer' })).status, 400, 'fold:own-teach-not-fee');
    const own = await w.remember(P, h, { revision: h.revision, kind: 'own-transfer' });
    assert.equal(own.status, 200, 'fold:own-teach-undetected (an explicit owner choice for a holder the proposer did not detect) ' + JSON.stringify(own.data).slice(0, 300));
    assert.deepEqual(own.data.teaching.values, { purpose: 'own-transfer' }, 'fold:own-teach-no-account');
    await w.importRows(acct, [['20261014', -120000, HOLDER], ['20261015', 120000, HOLDER]], 'fold-own-2.csv', 1000000);
    const later = w.ok(await w.list(P, acct), 'list-later'), next = w.rowIn(later, await w.rowBy(acct, HOLDER, '2026-10-14')).proposal, incoming = w.rowIn(later, await w.rowBy(acct, HOLDER, '2026-10-15')).proposal;
    assert.deepEqual([next.proposal.purposeKind, next.proposal.origin, next.proposal.confidence, next.proposal.accountCategoryId], ['own-transfer', 'teaching', 'review', null], 'fold:own-teaching-next-row-transfer');
    assert.deepEqual(next.transfer, { kind: 'own-company', proof: 'awaiting-other-bank' }); assert.ok(next.unresolved.includes('transfer-awaiting-other-bank'));
    assert.deepEqual([next.tax, next.invoice, next.values.accountCategoryId, next.values.taxCategoryId, next.values.invoiceNumber], [{ status: 'unknown' }, { value: null, status: 'unverified' }, '', '', ''], 'fold:own-teaching-unknown-tax-t');
    assert.notEqual(incoming.proposal.purposeKind, 'own-transfer', 'fold:own-teaching-direction-exact');
    await w.gen(P, acct); const dn = await w.draftOf(P, acct, await w.rowBy(acct, HOLDER, '2026-10-14'));
    assert.deepEqual(dn.ready.reasons, ['account-missing', 'transfer-unreviewed'], 'fold:own-teaching-not-registrable-without-review');
    assert.equal((await w.register(P, dn, { revision: dn.revision, action: 'create', confirm: true })).status, 409);
    // An owner-entered own-account teaching can be a mistake: correct it through the ordinary reviewed teaching action.
    const corrected = await w.fix(P, acct, await w.rowBy(acct, HOLDER, '2026-10-14'), 'Synthetic corrected supplier', '外注費');
    assert.equal(corrected.proposed.origin, 'teaching'); assert.ok(corrected.transfer);
    const correction = await w.remember(P, corrected, { revision: corrected.revision });
    assert.equal(correction.status, 200, 'fold:own-teaching-correctable (reviewed supplier replaces an owner-entered own-account rule)');
    assert.equal(correction.data.teaching.values.purpose, 'Synthetic corrected supplier');
    await w.importRows(acct, [['20261017', -123000, HOLDER]], 'fold-own-corrected.csv', 1000000);
    const future = w.rowIn(w.ok(await w.list(P, acct), 'list-corrected-future'), await w.rowBy(acct, HOLDER, '2026-10-17')).proposal;
    assert.deepEqual([future.proposal.origin, future.proposal.purpose, future.proposal.accountCategoryId, future.transfer], ['teaching', 'Synthetic corrected supplier', String(w.chart['外注費']), null], 'fold:own-teaching-corrected-future');
    assert.deepEqual([future.tax.status, future.invoice.status], ['unknown', 'unverified']);
    assert.equal(await w.db.collection('transactions').countDocuments({ organizationId: P.id }), 0, 'fold:teaching-correction-creates-no-transaction');
    await w.importRows(acct, [['20261018', -50000, '振込 カクウホールディングス']], 'fold-own-exact-name.csv', 1000000);
    const automatic = await w.rowBy(acct, '振込 カクウホールディングス', '2026-10-18'); await w.gen(P, acct);
    const autoDraft = await w.fix(P, acct, automatic, 'Synthetic supplier override', '外注費');
    assert.equal(autoDraft.proposed.origin, 'own-company-name');
    assert.equal((await w.remember(P, autoDraft, { revision: autoDraft.revision })).status, 400, 'fold:automatic-own-name-stays-transfer');
    return 'own-company choice stored without an account (fee and undecided supplier refused); next row: own-transfer / teaching / review, transfer awaiting the other bank, tax unknown, T unverified, not registrable';
  }
};

// ══ Chrome legs (owned headless Chrome on the built app) ══
async function chromeSession(app, browserModule, base, fn) {
  const profileDir = await mkdtemp(path.join(base, 'chrome-')), browser = await browserModule.browserFor(path.join(profileDir, 'profile'), { headless: true }); let page; const errors = [];
  try {
    page = await browser.newPage(); page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const wait = async (f, arg, label = '') => { for (let i = 0; i < 300; i++) { if (await page.evaluate(f, arg)) return; await pause(100); } throw Error('fold:chrome condition ' + label + ' ' + f.toString().slice(0, 160)); };
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(app.origin + '/login', { waitUntil: 'networkidle2' }); await page.type('#email', 'finance-a@example.invalid'); await page.type('#password', 'Synthetic-password-Only1!'); await page.evaluate(() => document.querySelector('button[type="submit"]').click()); await wait(() => location.pathname === '/', null, 'login');
    const open = async (companyId, acct) => {
      await page.evaluate(async organizationId => { const user = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user'); const r = await fetch('/api/auth/switch-organization', { method: 'POST', headers: { ...user.authHeader, 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId }) }), s = await r.json(); if (!r.ok) throw Error('Synthetic switch failed'); const p = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + s.tokens.accessToken } }); user.acceptSession({ ...await p.json(), tokens: s.tokens }, false); }, String(companyId));
      await page.goto(app.origin + '/intake/payments', { waitUntil: 'networkidle2' }); await wait(() => !!document.querySelector('[data-review-tab="bank-classification"]'), null, 'tab');
      await page.click('[data-review-tab="bank-classification"]'); await wait(() => !!document.querySelector('[data-bank-classification]'), null, 'component');
      await select(acct);
    };
    const select = async acct => { await wait(a => { const s = document.querySelector('[data-bank-classification-account]'); return !!s && [...s.options].some(o => o.value === a); }, acct, 'account option'); await page.select('[data-bank-classification-account]', ''); await page.select('[data-bank-classification-account]', acct); await wait(() => !!document.querySelector('[data-bank-classification-row]'), null, 'rows'); };
    const reload = async () => { await page.evaluate(() => [...document.querySelectorAll('[data-bank-classification] button')].find(b => b.textContent.trim() === '再読み込み').click()); await pause(400); };
    const rowSel = r => '[data-bank-classification-row="' + String(r._id) + '"] ';
    const clickLabel = async (sel, text) => assert(await page.evaluate((s, t) => { const l = [...document.querySelectorAll(s + 'label')].find(x => x.textContent.includes(t)); if (!l) return false; l.querySelector('input').click(); return true; }, sel, text), 'fold:chrome control ' + text);
    const assert = (v, m) => { if (!v) throw Error(m); };
    const settle = sel => wait(x => { const b = document.querySelector(x + '[data-bank-classification-save]'); return !!b && !b.disabled && !document.querySelector('[data-bank-classification-generate]').disabled; }, sel, 'settled');
    const until = async (probe, label) => { for (let i = 0; i < 100; i++) { const v = await probe(); if (v) return v; await pause(100); } throw Error(label + ' (not observed)'); };
    return await fn({ page, wait, open, select, reload, rowSel, clickLabel, until, settle, errors });
  } finally { if (page) await page.close().catch(() => {}); await browser.close(); await removeOwned(profileDir, base); }
}
const editRow = async (s, sel, purpose, accountId, extra = async () => {}) => {
  await s.page.click(sel + '[data-bank-classification-open]'); await s.wait(x => !!document.querySelector(x + '[data-bank-classification-editor]'), sel, 'editor');
  if (purpose !== null) { await s.page.$eval(sel + '[data-field="purpose"]', e => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); }); await s.page.type(sel + '[data-field="purpose"]', purpose); }
  await s.page.select(sel + '[data-field="accountCategoryId"]', accountId); await extra();
  await s.page.click(sel + '[data-bank-classification-save]');
};
const chromeLegs = {
  // F3 in Chrome: the confirmNew checkbox past an unrelated candidate, the link selector, a reviewed own transfer — readback.
  async C1(app, assert, browserModule, base) {
    const w = await worldOf(app, assert), P = await w.company('カクウチェーン'), acct = await w.account('Synthetic fold chrome exits');
    await w.importRows(acct, [['20260917', -9100, '振込 カクウベンダーツー'], ['20260918', -7300, '口座振替 カクウリンクスリー'], ['20260919', -50000, '振込 カ）カクウチェーン']], 'fold-chrome-1.csv');
    const k1 = await w.rowBy(acct, '振込 カクウベンダーツー'), k2 = await w.rowBy(acct, '口座振替 カクウリンクスリー'), k3 = await w.rowBy(acct, '振込 カ）カクウチェーン');
    const T9100 = await w.existingTx(P, '2026-09-17', 9100, 'Synthetic chrome unrelated'), T7300 = await w.existingTx(P, '2026-09-18', 7300, 'Synthetic chrome subscription');
    await w.gen(P, acct); const before9100 = await w.tx(T9100), before7300 = await w.tx(T7300);
    const id = async r => (await w.draftOf(P, acct, r)).id, dk1 = await id(k1), dk2 = await id(k2), dk3 = await id(k3);
    return await chromeSession(app, browserModule, base, async s => {
      await s.open(P.id, acct);
      // confirmNew: the owner states that the row is a new Transaction beside the unrelated candidate
      const a = s.rowSel(k1); await editRow(s, a, 'Synthetic chrome purchase', String(w.chart['外注費']));
      await s.until(async () => (await w.stored(dk1)).values.purpose === 'Synthetic chrome purchase', 'fold:chrome-confirm-new saved');
      await s.settle(a); await s.wait(x => !!document.querySelector(x + '[data-bank-classification-link-select]'), a, 'candidates');
      await s.page.click(a + '[data-bank-classification-confirm]'); await s.clickLabel(a, '既存の取引とは別の取引として新しく登録します');
      await s.wait(x => !document.querySelector(x + '[data-bank-classification-register]').disabled, a, 'register enabled'); await s.page.click(a + '[data-bank-classification-register]');
      await s.wait(x => !!document.querySelector(x + '[data-bank-classification-transaction]'), a, 'fold:chrome-confirm-new registered');
      const t1 = await w.db.collection('transactions').findOne({ 'metadata.bankClassificationId': dk1 }), s1 = await w.stored(dk1);
      assert.equal(String(t1?._id), String(s1.reservedTransactionId), 'fold:chrome-confirm-new (the reserved ID)'); assert.deepEqual(await w.tx(T9100), before9100, 'fold:chrome-confirm-new-leaves-candidate');
      // link: the owner selects the existing company Transaction; it is recorded on the draft and left unchanged
      const b = s.rowSel(k2); await editRow(s, b, 'Synthetic chrome subscription', String(w.chart['支払手数料']));
      await s.until(async () => (await w.stored(dk2)).values.purpose === 'Synthetic chrome subscription', 'fold:chrome-link saved'); await s.settle(b);
      await s.wait(x => !!document.querySelector(x + '[data-bank-classification-link-select]'), b, 'link select');
      await s.page.select(b + '[data-bank-classification-link-select]', String(T7300)); await s.page.click(b + '[data-bank-classification-confirm]');
      await s.wait(x => !document.querySelector(x + '[data-bank-classification-link]').disabled, b, 'link enabled'); await s.page.click(b + '[data-bank-classification-link]');
      await s.wait(x => !!document.querySelector(x + '[data-bank-classification-transaction]'), b, 'fold:chrome-link linked');
      const s2 = await w.stored(dk2); assert.deepEqual([s2.registration.state, s2.registration.kind, String(s2.registration.transactionId)], ['linked', 'link', String(T7300)], 'fold:chrome-link'); assert.deepEqual(await w.tx(T7300), before7300, 'fold:chrome-link-no-rewrite');
      assert.match(await s.page.$eval(b + '[data-bank-classification-transaction]', e => e.getAttribute('href')), new RegExp('/transactions/' + String(T7300)));
      // reviewed own transfer: account chosen by the owner and the transfer review checkbox
      const c = s.rowSel(k3); await editRow(s, c, 'Synthetic chrome transfer', String(w.chart['普通預金']), async () => { await s.page.click(c + '[data-field="transferReviewed"]'); });
      await s.until(async () => (await w.stored(dk3)).values.transferReviewed === true, 'fold:chrome-reviewed-transfer saved'); await s.settle(c);
      await s.wait(x => !!document.querySelector(x + '[data-bank-classification-confirm]'), c, 'confirm'); await s.page.click(c + '[data-bank-classification-confirm]');
      await s.wait(x => !document.querySelector(x + '[data-bank-classification-register]').disabled, c, 'transfer register enabled'); await s.page.click(c + '[data-bank-classification-register]');
      await s.wait(x => !!document.querySelector(x + '[data-bank-classification-transaction]'), c, 'fold:chrome-reviewed-transfer registered');
      const t3 = await w.db.collection('transactions').findOne({ 'metadata.bankClassificationId': dk3 }); assert.equal(String(t3?.accountCategoryId), String(w.chart['普通預金']), 'fold:chrome-reviewed-transfer');
      assert.deepEqual(s.errors, [], 'fold:chrome-no-console-errors');
      return 'confirmNew checkbox → reserved-ID Transaction, candidate unchanged; link selector → linked, Transaction unchanged; transferReviewed → registered';
    });
  },
  // F1/F2/F4 in Chrome: move another company's draft here, release a missing registration, unlink, resume a registering row,
  // remember an undetected holder as an own-company account; 390/1440 px, dark, no console errors.
  async C2(app, assert, browserModule, base) {
    const w = await worldOf(app, assert), R1 = await w.company('Fold chrome first'), R2 = await w.company('カクウグループ');
    const acctMove = await w.account('Synthetic fold chrome move'), acct = await w.account('Synthetic fold chrome repair');
    await w.importRows(acctMove, [['20260921', -1500, '振込 カクウイドウ']], 'fold-chrome-move.csv');
    await w.importRows(acct, [['20260922', -2500, '振込 カクウケシ'], ['20260923', -3500, '口座振替 カクウヒモ'], ['20260924', -4500, '振込 カクウサイカイ'], ['20260925', -60000, '振込 カクウグル-プ ニシ']], 'fold-chrome-repair.csv');
    const mv = await w.rowBy(acctMove, '振込 カクウイドウ'), gone = await w.rowBy(acct, '振込 カクウケシ'), link = await w.rowBy(acct, '口座振替 カクウヒモ'), crash = await w.rowBy(acct, '振込 カクウサイカイ'), holder = await w.rowBy(acct, '振込 カクウグル-プ ニシ');
    await w.gen(R1, acctMove); const dm = await w.fix(R1, acctMove, mv, 'R1 private purpose');
    const T3500 = await w.existingTx(R2, '2026-09-23', 3500, 'Synthetic chrome link'); await w.gen(R2, acct);
    const dGone = await w.fix(R2, acct, gone, 'Synthetic gone'), regGone = w.ok(await w.register(R2, dGone, { revision: dGone.revision, action: 'create', confirm: true }), 'register-gone');
    w.ok(await app.call('/api/transactions/' + regGone.transaction.id, { method: 'DELETE', token: R2.token }), 'native delete');
    const dLink = await w.fix(R2, acct, link, 'Synthetic link'); w.ok(await w.register(R2, dLink, { revision: dLink.revision, action: 'link', transactionId: String(T3500), confirm: true }), 'link');
    const dCrash = await w.fix(R2, acct, crash, 'Synthetic crash'), regCrash = w.ok(await w.register(R2, dCrash, { revision: dCrash.revision, action: 'create', confirm: true }), 'register-crash');
    await w.db.collection('transactions').deleteOne({ _id: new w.ObjectId(regCrash.transaction.id) }); await w.db.collection('financebankclassifications').updateOne({ _id: new w.ObjectId(dCrash.id) }, { $set: { 'registration.state': 'reserved' } });
    await w.db.collection('financebankrows').updateOne({ _id: crash._id }, { $inc: { revision: 1 }, $set: { description: '振込 カクウサイカイ 再取込' } });
    const dHolder = await w.draftOf(R2, acct, holder), beforeLink = await w.tx(T3500);
    return await chromeSession(app, browserModule, base, async s => {
      await s.open(R2.id, acctMove);
      const m = s.rowSel(mv);
      await s.wait(x => !!document.querySelector(x + '[data-bank-classification-reassign]'), m, 'fold:chrome-reassign control');
      assert.ok(!(await s.page.evaluate(() => document.body.innerText)).includes('R1 private purpose'), 'fold:chrome-other-company-no-leak');
      await s.page.click(m + '[data-bank-classification-reassign-confirm]'); await s.wait(x => !document.querySelector(x + '[data-bank-classification-reassign]').disabled, m, 'reassign enabled'); await s.page.click(m + '[data-bank-classification-reassign]');
      await s.wait(x => !!document.querySelector(x + '[data-bank-classification-open]'), m, 'fold:chrome-reassign editable');
      const moved = await w.stored(dm.id); assert.equal(String(moved.organizationId), String(R2.id), 'fold:chrome-reassign'); assert.equal(moved.archive?.length, 1);
      assert.ok(!(await s.page.evaluate(() => document.body.innerText)).includes('R1 private purpose'), 'fold:chrome-reassign-no-leak');
      await s.select(acct);
      // a registration whose Transaction was deleted natively: shown with its next action, released explicitly
      const g = s.rowSel(gone);
      await s.wait(x => /見つかりません/.test(document.querySelector(x + '[data-bank-classification-issue]')?.textContent || ''), g, 'fold:chrome-missing-shown');
      await s.page.click(g + '[data-bank-classification-release-confirm]'); await s.wait(x => !document.querySelector(x + '[data-bank-classification-release]').disabled, g, 'release enabled'); await s.page.click(g + '[data-bank-classification-release]');
      await s.until(async () => (await w.stored(dGone.id)).registration === null, 'fold:chrome-release');
      await s.wait(x => !!document.querySelector(x + '[data-bank-classification-open]'), g, 'fold:chrome-release editable');
      assert.equal((await w.stored(dGone.id)).history.at(-1).action, 'registration-released', 'fold:chrome-release recorded');
      // a mistaken link: unlinked, the Transaction unchanged
      const l = s.rowSel(link);
      await s.wait(x => !!document.querySelector(x + '[data-bank-classification-release]'), l, 'unlink control');
      await s.page.click(l + '[data-bank-classification-release-confirm]'); await s.wait(x => !document.querySelector(x + '[data-bank-classification-release]').disabled, l, 'unlink enabled'); await s.page.click(l + '[data-bank-classification-release]');
      await s.until(async () => (await w.stored(dLink.id)).registration === null, 'fold:chrome-unlink'); assert.deepEqual(await w.tx(T3500), beforeLink, 'fold:chrome-unlink-no-rewrite');
      // a registering row whose source changed since: the resume lane completes the same reserved ID
      const c = s.rowSel(crash);
      await s.wait(x => !!document.querySelector(x + '[data-bank-classification-resume]') && !document.querySelector(x + '[data-bank-classification-resume]').disabled, c, 'fold:chrome-resume control');
      await s.page.click(c + '[data-bank-classification-resume]');
      await s.until(async () => (await w.stored(dCrash.id)).registration?.state === 'registered', 'fold:chrome-resume');
      assert.equal(await w.db.collection('transactions').countDocuments({ 'metadata.bankClassificationId': dCrash.id }), 1, 'fold:chrome-resume-once'); assert.ok(await w.tx(regCrash.transaction.id), 'fold:chrome-resume (the reserved ID)');
      // an undetected holder remembered as an own-company account (no expense account)
      const h = s.rowSel(holder);
      await s.page.click(h + '[data-bank-classification-open]'); await s.wait(x => !!document.querySelector(x + '[data-bank-classification-remember-own]'), h, 'fold:chrome-own-teach control');
      await s.page.click(h + '[data-bank-classification-remember-own]');
      const taught = await s.until(async () => w.db.collection('financebankteachings').findOne({ organizationId: R2.id, payeeKey: dHolder.payeeKey }), 'fold:chrome-own-teach');
      assert.deepEqual(taught.values, { purpose: 'own-transfer' }, 'fold:chrome-own-teach-no-account');
      // Correct a mistaken own-account rule using the native editor, then verify the next row uses that correction.
      await w.importRows(acct, [['20261001', -61000, holder.description]], 'fold-chrome-own-later.csv', 1000000);
      await w.gen(R2, acct); await s.reload();
      const laterHolder = await w.rowBy(acct, holder.description, '2026-10-01'), hc = s.rowSel(laterHolder);
      await editRow(s, hc, 'Synthetic corrected chrome supplier', String(w.chart['外注費']));
      const laterDraft = await w.draftOf(R2, acct, laterHolder);
      await s.until(async () => (await w.stored(laterDraft.id)).values.purpose === 'Synthetic corrected chrome supplier', 'fold:chrome-correction-saved');
      await s.settle(hc);
      await s.wait(x => !!document.querySelector(x + '[data-bank-classification-remember-correction]') && !document.querySelector(x + '[data-bank-classification-remember-correction]').disabled, hc, 'fold:chrome-own-teaching-correctable');
      await s.page.click(hc + '[data-bank-classification-remember-correction]');
      const correctedTeaching = await s.until(async () => { const t = await w.db.collection('financebankteachings').findOne({ organizationId: R2.id, payeeKey: dHolder.payeeKey }); return t?.values?.purpose === 'Synthetic corrected chrome supplier' ? t : null; }, 'fold:chrome-own-teaching-corrected');
      assert.equal(String(correctedTeaching.values.accountCategoryId), String(w.chart['外注費']));
      await w.importRows(acct, [['20261002', -62000, holder.description]], 'fold-chrome-own-corrected.csv', 1000000);
      const futureHolder = w.rowIn(w.ok(await w.list(R2, acct), 'list-chrome-corrected'), await w.rowBy(acct, holder.description, '2026-10-02')).proposal;
      assert.deepEqual([futureHolder.proposal.origin, futureHolder.proposal.purpose, futureHolder.transfer, futureHolder.tax.status, futureHolder.invoice.status], ['teaching', 'Synthetic corrected chrome supplier', null, 'unknown', 'unverified'], 'fold:chrome-corrected-future');
      assert.equal(await s.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'fold:chrome-no-overflow');
      await s.page.setViewport({ width: 1440, height: 1000 }); await pause(300); assert.equal(await s.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'fold:chrome-desktop-no-overflow');
      await s.page.evaluate(() => document.documentElement.classList.add('dark')); assert.equal(await s.page.$eval('[data-bank-classification-account]', e => getComputedStyle(e).backgroundColor), 'rgb(30, 41, 59)', 'fold:chrome-dark-control');
      if (process.env.OMF_TEST_PAYMENT_SCREENSHOTS) { await mkdir(process.env.OMF_TEST_PAYMENT_SCREENSHOTS, { recursive: true }); await s.page.screenshot({ path: path.join(process.env.OMF_TEST_PAYMENT_SCREENSHOTS, 'bank-classification-review-fold.png'), fullPage: true }); }
      assert.deepEqual(s.errors, [], 'fold:chrome-no-console-errors');
      return 'moved another company\'s draft here (nothing shown of it), released a missing registration, unlinked a link unchanged, resumed a registering row to one reserved-ID Transaction, remembered an undetected holder as own; 390/1440, dark, no console errors';
    });
  }
};

// ══ Deliberately reintroduced defects in copies of the built server chunks (each anchor must hit exactly once) ══
const SERVER_MUTANTS = [
  ['MF15', 'A6', [[/if \(!ownTransfer && current\.proposed\?\.transfer && current\.proposed\?\.proposal\?\.origin !== "teaching"\)/g, 'if (!ownTransfer && current.proposed?.transfer)']], /fold:own-teaching-correctable/],
  ['MF1', 'A2', [[/const claimFilter = \{ _id: d\._id, ownerId, organizationId: d\.organizationId, revision: d\.revision, registration: null \}/g, 'const claimFilter = { _id: d._id, ownerId, organizationId: d.organizationId, revision: d.revision }'], [/const exclusive = !!d\.registration;/g, 'const exclusive = false;']], /fold:reassign-registered-exclusive/],
  ['MF2', 'A2', [[/const claimFilter = \{ _id: d\._id, ownerId, organizationId: d\.organizationId, revision: d\.revision, registration: null \}/g, 'const claimFilter = { _id: d._id, ownerId, organizationId: d.organizationId, registration: null }'], [/if \(Number\(body\.revision\) !== d\.revision\) fail\(409, STALE\);/g, '']], /fold:reassign-stale|fold:reassign-cas/],
  ['MF3', 'A2', [[/values: fresh\.values,/g, 'values: d.values,']], /fold:reassign-no-leak/],
  ['MF4', 'A3', [[/if \(reg\.kind === "create" && present\)/g, 'if (false)']], /fold:release-keeps-present-transaction/],
  ['MF5', 'A3', [[/historyDrafts\.filter\(\(d\) => targetState\(d, targets\) === "present"\)/g, 'historyDrafts.filter(() => true)']], /fold:history-excludes-missing/],
  ['MF6', 'A4', [[/const markScope = opOf\(reg\);/g, 'const markScope = {};']], /fold:late-op-not-marking-newer/],
  ['MF7', 'A4', [[/const releaseScope = opOf\(reg\);/g, 'const releaseScope = {};']], /fold:late-op-not-releasing-newer/],
  ['MF8', 'A1a', [[/Object\.assign\(set, identityOf\(row\)\);/g, '']], /fold:accept-source-payee/],
  ['MF9', 'A1b', [[/payeeKey: p\.payeeKey, direction: p\.direction \}/g, 'payeeKey: p.payeeKey }']], /fold:refresh-direction/],
  ['MF10', 'A6', [[/if \(!ownTransfer && !current\.manual && !current\.registration\)/g, 'if (!current.manual && !current.registration)']], /fold:own-teach-undetected/],
  ['MF11', 'A6', [[/if \(ownTransfer && TEXT_KINDS\.includes\(/g, 'if (false && TEXT_KINDS.includes(']], /fold:own-teach-not-fee/],
  ['MF12', 'A5', [[/if \(action === "create" && candidates\.length && body\.confirmNew !== true\)/g, 'if (action === "create" && candidates.length)']], /fold:confirm-new-creates/],
  ['MF13', 'A5', [[/if \(input\.transfer && v\.transferReviewed !== true\) reasons\.push\('transfer-unreviewed'\);/g, "if (input.transfer) reasons.push('transfer-unreviewed');"]], /fold:reviewed-transfer/],
  ['MF14', 'A6', [[/if \(selfNames\.has\(payeeKey\) \|\| taughtSelf\)/g, 'if (selfNames.has(payeeKey))']], /fold:own-teaching-next-row-transfer/],
  // the original native fixture's server mutants (M12-M16), rerun on this source through the unchanged integration
  ['M12', 'I', [[/if\s*\(\s*body\.revision\s*!==\s*draft\.revision\s*\)\s*fail\(\s*409\s*,\s*STALE\s*\)/g, 'if(false)fail(409,STALE)']], /shiwake:stale-revision/],
  ['M13', 'I', [[/const\s+transactionId\s*=\s*draft\.reservedTransactionId\b/g, 'const transactionId=draft._id']], /shiwake:reserved-id-used|shiwake:crash-before-insert-same-id|shiwake:register-idempotent|shiwake:concurrent/],
  ['M14', 'I', [[/const scopeOfDraft\s*=\s*\(ownerId,\s*organizationId,\s*draftId\)\s*=>\s*\(\{\s*_id:\s*id\(draftId\),\s*ownerId,\s*organizationId\s*\}\)/g, 'const scopeOfDraft=(ownerId,organizationId,draftId)=>({_id:id(draftId),ownerId})']], /shiwake:draft-company-scoped/],
  ['M15', 'I', [[/const\s*\{\s*organizationId:\s*classificationCompany\s*\}\s*=\s*await\s*calendarCompany\(event\)/g, 'const classificationCompany=event.context.auth?.organizationId?new (await import("mongoose")).default.Types.ObjectId(String(event.context.auth.organizationId)):(()=>{throw new Error("unreachable")})(await (async()=>{throw (await import("h3")).createError({statusCode:403,statusMessage:"No organization selected"})})())']], /shiwake:revoked-membership/],
  ['M16', 'I', [[/if\s*\(\s*action\s*===\s*"create"\s*&&\s*candidates\.length\s*&&\s*body\.confirmNew\s*!==\s*true\s*\)/g, 'if(false)']], /shiwake:no-silent-double-booking/]
];
async function chunkFiles(dir) { const out = []; for (const e of await readdir(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) out.push(...await chunkFiles(f)); else if (e.name.endsWith('.mjs')) out.push(f); } return out; }

export default { name: 'omf-bank-classification-review-fold', covers: COVERS, async run() {
  const started = Date.now(), lines = []; let pass = true; const green = new Set();
  const leg = async (name, fn) => { const t = Date.now(); try { lines.push(name + ': ' + await fn() + ` (${Math.round((Date.now() - t) / 1000)}s)`); green.add(name.split(' ')[0]); } catch (e) { pass = false; lines.push(name + ': RED ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 1400)); } };
  const assert = (await import('node:assert/strict')).default;
  const base = await mkdtemp(path.join(os.tmpdir(), 'omf-fold-fixture-'));
  let mongo = null, integrationApp = null, reviewApp = null, executed = false;
  const run = (args, timeout = 300000) => new Promise(resolve => execFile(process.execPath, args, { cwd: root, env: process.env, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024 }, (e, stdout, stderr) => resolve({ code: e ? e.code || 1 : 0, stdout: String(stdout), stderr: String(stderr) })));
  try {
    const shared = await import(u('shared/finance-bank-classification.mjs')), browserModule = await import(u('collector/browser.mjs'));
    if (!existsSync(path.join(root, '.output/server/index.mjs'))) throw new Error('built app absent; no HTTP coverage');
    const { MongoMemoryServer } = requireRoot('mongodb-memory-server'), binary = path.join(root, '..', 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
    mongo = await MongoMemoryServer.create({ binary: existsSync(binary) ? { systemBinary: binary, version: '8.2.1' } : undefined, instance: { args: ['--setParameter', 'enableTestCommands=1'] } });
    const boot = async (outputRoot, dbName) => { const app = await bootApp(outputRoot, mongo, dbName, path.join(base, 'data-' + dbName)); executed = true; return app; };
    const integration = createRequire(import.meta.url)(path.join(root, 'scripts/finance-bank-classification-integration.cjs'));
    // ── U: the pure classification units (the unchanged proposer plus the F4 own-holder case) ──
    await leg('U pure units: scripts/finance-bank-classification.test.mjs', async () => {
      const r = await run(['--test', 'scripts/finance-bank-classification.test.mjs']); await writeFile(path.join(root, '.zoomer-fold-unit.txt'), r.stdout + r.stderr);
      if (r.code !== 0) throw new Error((r.stdout + r.stderr).split('\n').filter(l => /not ok|Error|assert|ERR_/.test(l)).slice(0, 14).join(' | '));
      return (r.stdout.match(/(?:#|ℹ) pass \d+/) || ['pass ?'])[0] + ', ' + (r.stdout.match(/(?:#|ℹ) fail \d+/) || ['fail ?'])[0];
    });
    // ── I: the original native classification integration, unchanged assertions, on its own owned app and database ──
    await leg('I original classification integration (B1 G E T R N L H + V Chrome) on the built app, assertions unchanged', async () => {
      integrationApp = await boot(root, 'fold_integration'); const passed = [];
      await integration({ db: integrationApp.db, call: integrationApp.call, origin: integrationApp.origin, token: integrationApp.token, other: integrationApp.other, pass: name => passed.push(name.split(' ')[0]), root, pause });
      return passed.join(', ');
    });
    reviewApp = await boot(root, 'fold_review');
    const titles = { A1a: 'A1a identity: manual acceptSource after a different payee and a flipped direction stores both; preview, teaching and later proposals use them', A1b: 'A1b identity: an untouched refresh after a flipped direction stores it; registration and history follow it', A2: 'A2 F1 company reassignment: explicit, revisioned, CAS, registered rows exclusive, old company archived and not leaked, reserved ID kept, unique indexes kept', A3: 'A3 F2 missing/changed registrations: shown, explicit revisioned release/unlink bound to the target, present creation kept, same reserved ID, history excluded, reserved rows resumed', A4: 'A4 F2 late old operations (blocking fail point): an old resume neither completes nor releases a newer reservation; one effect at the fixed ID', A5: 'A5 F3 positive exits: confirmNew beside an unrelated amount-only candidate; a reviewed own-company transfer', A6: 'A6 F4 own-holder teaching: explicit own-company choice without an account; the next row is a transfer awaiting review with unknown tax/T' };
    for (const name of Object.keys(legs)) await leg(titles[name], () => legs[name](reviewApp, assert, shared.normalizePayee));
    await leg('C1 Chrome F3: confirmNew checkbox, link selector and reviewed transfer through the native tab with database readback', () => chromeLegs.C1(reviewApp, assert, browserModule, base));
    await leg('C2 Chrome F1/F2/F4: reassign, release a missing registration, unlink, resume a registering row, remember an undetected holder as own; 390/1440, dark', () => chromeLegs.C2(reviewApp, assert, browserModule, base));
    // ── M: each defect in a copy of the built server, one owned app per mutant, its leg must flip its named assertion ──
    const ready = ['U', 'I', 'A1a', 'A1b', 'A2', 'A3', 'A4', 'A5', 'A6'].every(n => green.has(n));
    await leg('M server mutants MF1-MF14 (fold guards and exits) and M12-M16 (original guards) on copies of the built chunks', async () => {
      if (!ready) throw new Error('NOT RUN: the behaviour legs must be green first');
      const caught = [];
      for (const [label, target, edits, pattern] of SERVER_MUTANTS) {
        const copy = path.join(base, 'mutant-' + label); await mkdir(copy, { recursive: true }); await cp(path.join(root, '.output'), path.join(copy, '.output'), { recursive: true, dereference: true });
        const chunks = await chunkFiles(path.join(copy, '.output/server/chunks')), texts = new Map(await Promise.all(chunks.map(async f => [f, await readFile(f, 'utf8')])));
        for (const [anchor, replacement] of edits) { let hits = 0; for (const [f, text] of texts) { const n = (text.match(anchor) || []).length; if (n) { hits += n; texts.set(f, text.replace(anchor, replacement)); } } if (hits !== 1) throw new Error(label + ' anchor hits ' + hits + ' ' + anchor); }
        for (const [f, text] of texts) await writeFile(f, text);
        const mutantApp = await bootApp(copy, mongo, 'fold_' + label.toLowerCase(), path.join(base, 'data-' + label)); let error = null;
        try { if (target === 'I') await integration({ db: mutantApp.db, call: mutantApp.call, origin: mutantApp.origin, token: mutantApp.token, other: mutantApp.other, pass: () => {}, root, pause, mutant: true }); else await legs[target](mutantApp, assert, shared.normalizePayee); } catch (e) { error = e; } finally { await mutantApp.close(); await removeOwned(copy, base); }
        if (!error || !pattern.test(String(error.message))) throw new Error(label + ' did not flip ' + pattern + ': ' + String(error?.message || 'passed').slice(0, 300));
        caught.push(label + '→' + String(error.message).match(pattern)[0]);
      }
      return caught.join(', ');
    });
  } catch (e) { pass = false; lines.push('setup: RED ' + String(e?.message || e).slice(0, 800)); }
  finally {
    for (const app of [integrationApp, reviewApp]) if (app) await app.close().catch(() => {});
    if (mongo) await mongo.stop().catch(() => {});
    await removeOwned(base, os.tmpdir());
  }
  if (leftBehind.length) lines.push('receipts left (not removed): ' + leftBehind.join('; '));
  return { pass, databaseCoverage: { executed, ownedProcess: executed }, message: `${pass ? 'green' : 'RED'} in ${Math.round((Date.now() - started) / 1000)}s\n` + lines.join('\n') };
} };
