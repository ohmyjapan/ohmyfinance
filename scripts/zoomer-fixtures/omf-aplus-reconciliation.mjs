// Fixture for plan omf-aplus-reconciliation-resolution-20261104 (READBACK B1-B4 folded): the Aplus/Amex forecast reconciliation — the
// settled-line and closed-period rules, settlement precedence, the owner's forecast resolution (billed / closed / reopen), the
// creation-order rebuild and the confirmed values in posting and payment matching. Run ONLY through the hub verifier:
//   node <hub>/scripts/zoomer-verify.mjs --run-fixture omf-aplus-reconciliation.mjs --cwd <this worktree>
// Evidence, stated exactly: synthetic rows only (scripts/finance-pending-fixtures.mjs aplusCapture, shared/aplus.mjs CSV, shared/amex.mjs
// CSV; fictional owner, cards, merchants and amounts). The real services run in a tsx child on an owned ephemeral MongoDB (loopback, never
// :27017) with the real finance route behind the real auth middleware on a loopback HTTP listener; the only intercepted write is the
// ledger insert (Transaction.updateOne: its payload is kept, nothing is inserted). No issuer, mailbox, vault, production database or
// network. The six real cases are not decided here; the replay sibling (omf-aplus-reconciliation-replay.mjs) reads the exported rows.
// Legs (OMF_APLUS_LEGS, comma list; default all; a selected run exports no coverage):
//   L1  settled line excluded from other finals: import-time X->{A,B,D}, Y->{D}; rebuilt with history X->{D}
//   L2  a statement whose coverage closed before the forecast purchases holds nothing (rows active)
//   L3  pendingSettlements precedence over a stale candidate binding: A,B,C finalized, D review
//   L4  tolerance kept: renamed forecast still held; identical repeats E,E vs E,E,E review; snapshot refresh unchanged
//   L5  compat: a binding built by the plan revision's (127c8ad) module verifies under the new code
//   L6  rebuild: CLI dry run writes nothing; apply writes changed bindings + sourceReferenceRebuild only; second apply no-op; entry on a
//       flipping line and a held lease are refused
//   L7  node --test on the two suites that import the shared module; the Amex fixture's frozen list still names it
//   R-a billed 1<->1 with a changed date/merchant/amount through the real route: resolution group, excluded final row, settlement with the
//       billed values, payment matching on the confirmed values (B2), the intercepted ledger payload posts the billed amount
//   R-b closed: 3 final rows + 2 snapshot rows released, closed line unpostable and still visible, a later exact bill supersedes (B1)
//   R-c identical repeats: billed [E1,E2]<->[x1,x2] leaves x3 new (3 purchases); 1<->2 is 400; closing E1 alone leaves E2 held (B4)
//   R-d reopen restores the candidate group; both crash orders verify everywhere and the next call completes; a tampered record fails closed
//   R-e refusals (B3 guards): entry on a target row (409, names the closing alternative), held lease, entry on a flipping line, shape errors
//   R-f Amex: the 127c8ad binding is byte-identical and verifies; one pending/final pair resolves the same way; confirmed values matched
//   M   deliberately reintroduced defects (OMF_APLUS_MUTANTS narrows them): each copy of server/+shared/ with one line changed must turn the
//       named leg RED after that leg's unchanged control was green.
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 3600000;
const SELF = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(SELF), '..', '..');
// The plan's revision: the module the stored production bindings were built with. L5/R-f read it from git and verify its bindings under the new code.
const BASE_REV = '127c8ad9c9edcf91c2bd40a1067d3270d70587cf';
const COVERS = ['shared/finance-import-overlap.mjs', 'server/services/financeService.ts', 'server/models/Finance.ts', 'server/services/financeSourceReferenceRebuildService.ts', 'server/services/financeForecastResolutionService.ts', 'server/api/finance/[...path].ts', 'server/services/financePaymentMatchService.ts', 'scripts/finance-source-references-rebuild.ts', 'scripts/finance-pending.test.mjs', 'scripts/finance-import-overlap.test.mjs', 'scripts/zoomer-fixtures/omf-aplus-reconciliation.mjs'];
const list = name => (process.env[name] || '').split(',').map(s => s.trim()).filter(Boolean);
const LEGS = list('OMF_APLUS_LEGS'), MUTANTS = list('OMF_APLUS_MUTANTS');
export const PARTIAL = LEGS.length > 0 || MUTANTS.length > 0;
const CHILD_LEGS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'R-a', 'R-b', 'R-c', 'R-d', 'R-e', 'R-f', 'R-g'];
const execute = (file, args, options = {}) => new Promise(resolve => execFile(file, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', ...options }, (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, stdout: String(stdout), stderr: String(stderr) })));
const mutate = (text, edits, label) => { let out = text; for (const [a, b] of edits) { const n = out.split(a).length - 1; if (n !== 1) throw new Error(label + ' anchor hits ' + n + ': ' + a.slice(0, 100)); out = out.replace(a, () => b); } return out; };

// ── the reintroduced defects: [label, file, [[anchor, replacement]], leg that must turn RED] ───────────────────────────────────────────
const SHARED = 'shared/finance-import-overlap.mjs', SERVICE = 'server/services/financeService.ts', RESOLUTION = 'server/services/financeForecastResolutionService.ts', MATCH = 'server/services/financePaymentMatchService.ts';
export const DEFECTS = [
  ['M1-resolved-lines-still-held', SHARED, [["  for (const prior of previous) for (const [line] of forecastResolutions(prior)) claimed.add(identity(prior._id, line));\n", '']], 'R-b'],
  ['M2-billed-forecast-matched-again', SHARED, [["const consumed = new Map(previous.map(prior => [prior, isPending(batch) ? new Set() : resolvedWhere(prior, record => record.state === 'billed')]));", 'const consumed = new Map(previous.map(prior => [prior, new Set()]));']], 'R-c'],
  ['M3-candidate-review-outranks-exact', SERVICE, [["strong.get(row.line) || exact.get(row.line) || (record?.state === 'closed' ? { state: 'closed' } : null) || weak.get(row.line) || { state: 'pending' }", "strong.get(row.line) || weak.get(row.line) || exact.get(row.line) || (record?.state === 'closed' ? { state: 'closed' } : null) || { state: 'pending' }"]], 'L3'],
  ['M4-entry-on-target-row-accepted', RESOLUTION, [["      if (await FinanceEntry.exists({ ownerId, importId: target._id, line: { $in: request.target!.lines } })) fail(409, ENTRY_ON_TARGET) // guard:forecast-target-posted\n", '']], 'R-e'],
  ['M5-ledger-posts-the-forecast-amount', SERVICE, [['amount: confirmed?.amount ?? row.amount,', 'amount: row.amount,']], 'R-a'],
  ['M6-closed-period-still-holds', SHARED, [["        if (!isPending(batch) && isPending(prior) && batch.period?.end && batch.period.end < r.purchaseDate) return false;\n", '']], 'L2'],
  ['M7-matching-keeps-provisional-values', MATCH, [["const c=confirmed.get(sid(b._id)+':'+row.line)||null;", 'const c=null;']], 'R-a'],
  ['M8-record-mismatch-verifies', SHARED, [[' || !equal(record.target.lines, group.lines) || !equal(record.lines, target.lines)) fail();', ') fail();']], 'R-d'],
  ['M9-closed-line-still-holds-nonexact', SHARED, [["    if (!isPending(batch) && !exact(candidates)) {", '    if (false) {']], 'R-c'],
  ['M10-superseded-not-marked', SERVICE, [["superseded: settlement.state === 'finalized' && !own", 'superseded: false']], 'R-b'],
  ['M11-partial-resolution-revalidates-consumed-rows', SHARED, [["const available = batch.rows.filter(r => !resolutionLines.has(r.line));", 'const available = batch.rows;']], 'R-c'],
  ['M12-stale-draft-date-overrides-confirmed', SERVICE, [["const date = keepDraft ? draftDate : confirmed.purchaseDate", 'const date = draftDate']], 'R-g'],
  ['M13-legacy-reservation-date-not-persisted', SERVICE, [["        await FinanceEntry.updateOne({ _id: entry._id, 'draftSnapshot.postingDate': { $exists: false } }, { $set: { 'draftSnapshot.postingDate': postingDate } })\n", '']], 'R-g']
];

// ── the child: the real services on an owned ephemeral database (node --import tsx <this file> --child --out <json> [--src <tree>] [--legs a,b]) ──
async function child() {
  const argv = process.argv, opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const SRC = path.resolve(opt('--src', root)), only = (opt('--legs', '') || '').split(',').map(s => s.trim()).filter(Boolean), out = opt('--out', '');
  const require = createRequire(path.join(root, 'package.json')), u = p => pathToFileURL(path.join(SRC, p)).href, r = p => pathToFileURL(path.join(root, p)).href;
  const legs = [], writes = { transactions: [] }, report = { legs, writes: 0, src: SRC, setupError: null };
  const finish = async () => { report.writes = writes.transactions.length; if (out) await writeFile(out, JSON.stringify(report, null, 2)).catch(() => {}); };
  const nodeModules = require.resolve('mongodb-memory-server').split(path.sep + 'node_modules' + path.sep)[0] + path.sep + 'node_modules';
  const binary = path.join(nodeModules, '.cache', 'mongodb-memory-server', 'mongod-x64-win32-8.2.1.exe');
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const dbName = 'omf_aplus_reconciliation';
  let mongo = null, mongoose = null, server = null, temp = null;
  try {
    mongo = await MongoMemoryServer.create({ binary: existsSync(binary) ? { systemBinary: binary, version: '8.2.1' } : undefined, instance: { dbName, launchTimeout: 120000 } });
    const uri = mongo.getUri(dbName); temp = await mkdtemp(path.join(os.tmpdir(), 'omf-aplus-reconciliation-'));
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri) || /:27017\//.test(uri)) throw new Error('SETUP refused: not an owned ephemeral database address');
    Object.assign(process.env, { MONGO_URI: uri, MONGODB_URI: uri, NUXT_MONGO_URI: uri, JWT_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'test', OMF_DATA_DIR: path.join(temp, 'data') });
    mongoose = (await import(pathToFileURL(require.resolve('mongoose')).href)).default;
    const h3 = await import(pathToFileURL(require.resolve('h3')).href), jwt = (await import(pathToFileURL(require.resolve('jsonwebtoken')).href)).default;
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 }); assert.equal(mongoose.connection.name, dbName);
    const User = (await import(u('server/models/User.ts'))).default, { FinancialAccount, FinanceImport, FinanceEntry, initializeFinance } = await import(u('server/models/Finance.ts')), { FinanceDraft } = await import(u('server/models/FinanceDraft.ts'));
    const Transaction = (await import(u('server/models/Transaction.ts'))).default, AccountCategory = (await import(u('server/models/AccountCategory.ts'))).default, TransactionCategory = (await import(u('server/models/TransactionCategory.ts'))).default, TaxCategory = (await import(u('server/models/TaxCategory.ts'))).default;
    const finance = await import(u('server/services/financeService.ts')), overlap = await import(u('shared/finance-import-overlap.mjs'));
    const { HEADERS: APLUS_HEADERS } = await import(u('shared/aplus.mjs')), { HEADERS: AMEX_HEADERS } = await import(u('shared/amex.mjs')), { aplusCapture } = await import(r('scripts/finance-pending-fixtures.mjs'));
    const { cardAccounting } = await import(u('server/services/financeAccountingService.ts')), { draftReferences } = await import(u('server/services/financeDraftService.ts')), { validateValues, emptyValues } = await import(u('shared/finance-draft.mjs'));
    const route = (await import(u('server/api/finance/[...path].ts'))).default, auth = (await import(u('server/middleware/auth.ts'))).default;
    const lazy = async p => { try { return await import(u(p)); } catch (error) { throw new Error('module unavailable at this revision: ' + p + ' — ' + String(error?.message || error).split('\n')[0].slice(0, 160)); } };
    const resolution = () => lazy('server/services/financeForecastResolutionService.ts'), rebuild = () => lazy('server/services/financeSourceReferenceRebuildService.ts'), payments = () => lazy('server/services/financePaymentMatchService.ts');
    await initializeFinance();
    // The ledger write is intercepted: the payload is kept for the assertions, nothing is inserted.
    Transaction.updateOne = async (filter, update, options) => { writes.transactions.push({ filter, update, options }); return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: filter?._id }; };
    const app = h3.createApp(); app.use(auth); app.use(h3.defineEventHandler(e => e.path.startsWith('/api/finance/') ? route(e) : undefined));
    server = http.createServer(h3.toNodeListener(app)); await new Promise(res => server.listen(0, '127.0.0.1', res));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const email = 'aplus-reconciliation@example.invalid', user = await User.create({ email, name: 'Synthetic owner', password: 'Synthetic-password-Only1!' });
    const ownerId = String(user._id), token = jwt.sign({ userId: ownerId, email, type: 'access', jti: randomUUID() }, process.env.JWT_SECRET, { expiresIn: '60m' });
    const api = (p, body, method = 'PUT') => fetch(origin + '/api/finance/' + p, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).then(async res => ({ status: res.status, data: await res.json().catch(() => null) }));
    // ── helpers ──
    const csv = (headers, rows) => Buffer.from([headers, ...rows].map(row => row.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n'));
    const aplusRow = (i, card) => ['≪****-****-****-' + (i.card || card) + '≫', (i.date || '2026-08-10').replaceAll('-', ''), i.merchant, i.amount, 'Ｓ', '1', '01', i.amount, ''];
    const sum = items => items.reduce((n, i) => n + i.amount, 0);
    // One Aplus account per owner and card set (unique index): every synthetic account gets its own four-digit suffix.
    let accounts = 0;
    const nextCard = () => String(1000 + (++accounts));
    const newAccount = async (label, card = nextCard(), extra = {}) => (await FinancialAccount.create({ ownerId, provider: 'aplus', name: 'Synthetic Aplus ' + label + ' ' + card, primaryCard: card, cardIdentifiers: [card], ...extra })).toObject();
    const pendingBytes = (items, capturedAt, card) => Buffer.from(JSON.stringify({ ...aplusCapture(items.map(i => ({ merchant: i.merchant, amount: i.amount, date: i.date || '2026-08-10', card: i.card || card, month: i.month || '26/09' }))), capturedAt }));
    const importPending = async (account, items, capturedAt = '2026-08-20T00:00:00.000Z') => (await finance.acceptImport(ownerId, account, pendingBytes(items, capturedAt, account.primaryCard), { kind: 'pending' })).id;
    const importFinal = async (account, items, month) => (await finance.acceptImport(ownerId, account, csv(APLUS_HEADERS, items.map(i => aplusRow(i, account.primaryCard))), { kind: 'statement', statementMonth: month, statementTotal: String(sum(items)) })).id;
    const doc = id => FinanceImport.findById(id).lean();
    const all = accountId => FinanceImport.find({ ownerId, accountId }).sort({ _id: 1 }).lean();
    const groupsOf = async id => overlap.sourceReferenceGroups(await doc(id));
    const activeOf = async id => overlap.activeImportRows(await doc(id)).map(x => x.line);
    const settlementsOf = async id => Object.fromEntries([...(await finance.pendingSettlements(await doc(id))).entries()]);
    const targetsOf = (groups, match) => groups.filter(g => g.match === match).map(g => ({ lines: g.lines, state: g.state, targets: g.targets.map(t => ({ importId: t.importId, lines: t.lines })) }));
    const verifyAll = async accountId => { const batches = await all(accountId); for (const b of batches) overlap.verifySourceReferences(b, batches); return batches.length; };
    const thrown = async fn => { try { await fn(); return null; } catch (error) { return error; } };
    const messageOf = error => String(error?.data?.message || error?.statusMessage || error?.message || error);
    const records = async id => overlap.forecastResolutions(await doc(id));
    const FORECAST = { A: { merchant: 'Shop A', amount: 1000, month: '26/09' }, B: { merchant: 'Shop B', amount: 900, month: '26/09' }, C: { merchant: 'Shop C', amount: 800, month: '26/10' }, D: { merchant: 'Shop D', amount: 700, month: '26/10' } };
    // P: A=2, B=3, C=4, D=5 (2026-08-10; A,B first month 26/09, C,D 26/10) → Oct final (C exact + unmatched X) → Sept final (A,B exact + unmatched Y): the production creation order.
    const scenarioL1 = async label => { const account = await newAccount(label); const P = await importPending(account, [FORECAST.A, FORECAST.B, FORECAST.C, FORECAST.D]); const Oct = await importFinal(account, [FORECAST.C, { merchant: 'Shop X', amount: 777, date: '2026-10-03' }], '2026-10'); const Sept = await importFinal(account, [FORECAST.A, FORECAST.B, { merchant: 'Shop Y', amount: 555, date: '2026-09-05' }], '2026-09'); return { account, P, Oct, Sept }; };
    const baseShared = async () => { const dir = path.join(temp, 'base-shared'); await mkdir(dir, { recursive: true }); for (const file of ['finance-import-overlap.mjs', 'finance-pending.mjs', 'amex.mjs']) { const shown = await execute('git', ['-C', root, 'show', BASE_REV + ':shared/' + file]); if (shown.code !== 0) throw new Error('git show failed for ' + file + ': ' + shown.stderr.slice(0, 200)); await writeFile(path.join(dir, file), shown.stdout); } const text = await readFile(path.join(dir, 'finance-import-overlap.mjs'), 'utf8'); assert.ok(!text.includes('pending_resolution') && text.includes('disputed'), 'the plan revision module is the one without resolutions'); return import(pathToFileURL(path.join(dir, 'finance-import-overlap.mjs')).href); };
    const categories = { expense: await AccountCategory.create({ name: '仕入高 synthetic', type: 'expense', isActive: true }), transaction: await TransactionCategory.create({ name: '仕入 synthetic' }), tax: await TaxCategory.create({ name: '課税仕入10 synthetic', rate: 10 }) };
    const configuredAccount = async label => { const card = nextCard(), main = await AccountCategory.create({ name: '未払金 ' + label, type: 'liability', isActive: true }), sub = await AccountCategory.create({ name: 'Aplus ' + label, type: 'liability', parentId: main._id, isActive: true }); return newAccount(label, card, { accounting: { version: 1, source: { provider: 'aplus', primaryCard: card, cardIdentifiers: [card] }, accountCategoryId: String(main._id), subAccountCategoryId: String(sub._id), accountName: main.name, subAccountName: sub.name, evidence: { kind: 'yayoi-account-settings' }, verifiedAt: new Date().toISOString() } }); };
    const approvedDraft = async (account, importId, line, date) => { const batch = await doc(importId), row = batch.rows.find(x => x.line === line), references = await draftReferences(ownerId), card = cardAccounting(account, row, references); const values = validateValues({ ...emptyValues(row), purpose: 'company', accountCategoryId: String(categories.expense._id), transactionCategoryId: String(categories.transaction._id), taxCategoryId: String(categories.tax._id), taxRate: 10, date }); await FinanceDraft.create({ ownerId, accountId: account._id, importId: batch._id, line, key: row.key, sourceHash: batch.hash, revision: 1, values, evidence: {}, history: [], approvedAt: new Date(), ...(card.status === 'configured' ? { cardAccounting: card } : {}) }); return 1; };
    const entryOn = async (account, batch, row, state) => FinanceEntry.create({ ownerId, accountId: account._id, key: row.key, fingerprint: row.fingerprint, occurrence: row.occurrence, coverage: batch.period.key, importId: batch._id, line: row.line, transactionId: new mongoose.Types.ObjectId(), row, state });
    const leg = async (name, fn) => { if (only.length && !only.includes(name)) return; const t = Date.now(); try { const note = await fn(); legs.push({ name, pass: true, note: String(note ?? 'ok'), ms: Date.now() - t }); console.log('PASS ' + name + ': ' + note); } catch (error) { legs.push({ name, pass: false, error: String(error?.stack || error).slice(0, 2400), ms: Date.now() - t }); console.log('FAIL ' + name + ': ' + String(error?.message || error).slice(0, 700)); } };

    await leg('L1', async () => {
      const { account, P, Oct, Sept } = await scenarioL1('L1');
      const oct = await groupsOf(Oct), sept = await groupsOf(Sept);
      assert.deepEqual(targetsOf(oct, 'pending_purchase'), [{ lines: [2], state: 'existing_import', targets: [{ importId: P, lines: [4] }] }], 'L1:oct-exact-C');
      assert.deepEqual(targetsOf(oct, 'pending_candidate'), [{ lines: [3], state: 'source_overlap_review', targets: [{ importId: P, lines: [2, 3, 5] }] }], 'L1:import-time X->{A,B,D}');
      assert.deepEqual(targetsOf(sept, 'pending_purchase').map(g => g.targets[0].lines), [[2], [3]], 'L1:sept-exact-A-B');
      assert.deepEqual(targetsOf(sept, 'pending_candidate'), [{ lines: [4], state: 'source_overlap_review', targets: [{ importId: P, lines: [5] }] }], 'L1:import-time Y->{D} (C settled by the Oct statement is excluded)');
      const { planSourceReferenceRebuild } = await rebuild(), plan = planSourceReferenceRebuild(await all(account._id));
      assert.equal(plan.verified, true, 'L1:rebuilt-verifies ' + JSON.stringify(plan.failures));
      assert.deepEqual(targetsOf(overlap.sourceReferenceGroups({ ...(await doc(Oct)), sourceReferences: plan.bindings.get(Oct) }), 'pending_candidate')[0].targets, [{ importId: P, lines: [5] }], 'L1:rebuilt-with-history X->{D}');
      assert.deepEqual(plan.changed, [Oct], 'L1:only-the-stale-oct-binding-changes');
      return 'X->{A,B,D} at import, Y->{D}; rebuilt with history X->{D}';
    });
    await leg('L2', async () => {
      const account = await newAccount('L2'), P = await importPending(account, [FORECAST.A]);
      const old = await importFinal(account, [{ merchant: 'Old shop', amount: 300, date: '2025-08-05' }], '2025-08');
      assert.deepEqual([await groupsOf(old), await activeOf(old)], [[], [2]], 'L2:closed-period-targets-nothing, the historical row is active');
      assert.equal((await settlementsOf(P))[2].state, 'pending', 'L2:forecast-not-disputed');
      return 'a 2025-08 statement holds no 2026 forecast; its row is active';
    });
    await leg('L3', async () => {
      const { P } = await scenarioL1('L3');
      const s = await settlementsOf(P), states = [2, 3, 4, 5].map(l => s[l].state);
      assert.deepEqual(states, ['finalized', 'finalized', 'finalized', 'review'], 'L3:exact-outranks-a-stale-candidate ' + JSON.stringify(states));
      assert.deepEqual([s[2].source.match, s[5].candidates.length, s[5].candidates.map(c => c.final)], ['pending_purchase', 2, [true, true]], 'L3:D-held-by-X-and-Y');
      return 'A,B,C finalized; D review (2 candidate groups)';
    });
    await leg('L4', async () => {
      const account = await newAccount('L4'), P = await importPending(account, [FORECAST.D]);
      const nov = await importFinal(account, [{ merchant: 'Shop D renamed', amount: 700, date: '2026-08-10' }], '2026-11');
      assert.deepEqual([await activeOf(nov), targetsOf(await groupsOf(nov), 'pending_candidate')[0]?.targets, (await settlementsOf(P))[2].state], [[], [{ importId: P, lines: [2] }], 'review'], 'L4:renamed-forecast-still-held');
      const account2 = await newAccount('L4-repeats'), E = { merchant: 'Shop E', amount: 650, month: '26/09' };
      const P2 = await importPending(account2, [E, E]), final = await importFinal(account2, [E, E, E], '2026-09');
      assert.deepEqual([await activeOf(final), targetsOf(await groupsOf(final), 'pending_purchase')[0], (await settlementsOf(P2))[2].state], [[], { lines: [2, 3, 4], state: 'source_overlap_review', targets: [{ importId: P2, lines: [2, 3] }] }, 'review'], 'L4:E,E-vs-E,E,E-review');
      const refresh = await importPending(account2, [E, E], '2026-08-21T00:00:00.000Z');
      assert.deepEqual([await activeOf(refresh), (await groupsOf(refresh)).map(g => g.state)], [[], ['existing_import']], 'L4:snapshot-refresh-unchanged');
      return 'renamed forecast held; E,E vs E,E,E review; snapshot refresh unchanged';
    });
    await leg('L5', async () => {
      const base = await baseShared(), { account, P, Oct, Sept } = await scenarioL1('L5');
      const batches = await all(account._id), by = id => batches.find(b => String(b._id) === id);
      const septBase = base.buildSourceReferences(by(Sept), [by(P), by(Oct)]);
      assert.deepEqual(septBase.groups.find(g => g.match === 'pending_candidate').targets[0].lines, [4, 5], 'L5:the-127c8ad-code-targets-C-and-D');
      await FinanceImport.updateOne({ _id: Sept }, { $set: { sourceReferences: septBase } });
      assert.equal(await verifyAll(account._id), 3, 'L5:the-old-binding-verifies-under-the-new-code');
      await finance.importSourceReferences(await doc(Sept));
      const s = await settlementsOf(P);
      assert.deepEqual([s[2].state, s[4].state, s[5].state], ['finalized', 'finalized', 'review'], 'L5:settlements-read-the-old-binding');
      return '127c8ad binding (Y->{C,D}) verifies under the new code and settles the same lines';
    });
    await leg('L6', async () => {
      const { rebuildSourceReferences } = await rebuild(), base = await baseShared();
      const { account, P, Oct, Sept } = await scenarioL1('L6');
      const before = Object.fromEntries((await all(account._id)).map(b => [String(b._id), b.sourceReferences]));
      const reportFile = path.join(temp, 'rebuild-dry.json');
      const cli = await execute(process.execPath, ['--import', 'tsx', path.join(root, 'scripts', 'finance-source-references-rebuild.ts'), '--owner', ownerId, '--account', String(account._id), '--report', reportFile], { cwd: root, env: { ...process.env }, timeout: 300000 });
      assert.equal(cli.code, 0, 'L6:cli-dry-run-exit ' + cli.stdout.slice(-500) + cli.stderr.slice(-900));
      const dryReport = JSON.parse(await readFile(reportFile, 'utf8'));
      assert.deepEqual([dryReport.apply, dryReport.written, dryReport.changed, dryReport.verified], [false, [], [Oct], true], 'L6:dry-run-plans-oct-only');
      assert.deepEqual(Object.fromEntries((await all(account._id)).map(b => [String(b._id), b.sourceReferences])), before, 'L6:dry-run-writes-nothing');
      const applied = await rebuildSourceReferences(ownerId, String(account._id), { apply: true, revision: 'fixture' });
      assert.deepEqual(applied.written, [Oct], 'L6:apply-writes-the-changed-binding');
      const octDoc = await doc(Oct);
      assert.deepEqual([octDoc.sourceReferenceRebuild.revision, octDoc.sourceReferenceRebuild.replaced, targetsOf(overlap.sourceReferenceGroups(octDoc), 'pending_candidate')[0].targets], ['fixture', before[Oct], [{ importId: P, lines: [5] }]], 'L6:replaced-binding-kept, X->{D} applied');
      for (const id of [P, Sept]) assert.deepEqual([(await doc(id)).sourceReferences, (await doc(id)).sourceReferenceRebuild], [before[id], undefined], 'L6:unchanged-bindings-untouched ' + id);
      await verifyAll(account._id);
      const again = await rebuildSourceReferences(ownerId, String(account._id), { apply: true, revision: 'fixture-2' });
      assert.deepEqual([again.written, again.changed], [[], []], 'L6:second-apply-no-op');
      const account2 = await newAccount('L6-entry'), P2 = await importPending(account2, [FORECAST.A]);
      const old = await importFinal(account2, [{ merchant: 'Old shop', amount: 300, date: '2025-08-05' }], '2025-08');
      const docs = await all(account2._id), oldDoc = docs.find(b => String(b._id) === old), pDoc = docs.find(b => String(b._id) === P2);
      const stale = base.buildSourceReferences(oldDoc, [pDoc]); assert.equal(stale.groups.length, 1, 'L6:the-127c8ad-code-held-the-historical-row');
      await FinanceImport.updateOne({ _id: old }, { $set: { sourceReferences: stale } });
      const entry = await entryOn(account2, oldDoc, oldDoc.rows[0], 'posted');
      const dry = await rebuildSourceReferences(ownerId, String(account2._id), { apply: false });
      assert.deepEqual(dry.flipping.map(f => [f.importId, f.line, f.before, f.after, f.entries.length]), [[old, 2, 'excluded', 'active', 1]], 'L6:dry-run-lists-the-entry-on-the-flipping-line');
      assert.equal((await thrown(() => rebuildSourceReferences(ownerId, String(account2._id), { apply: true })))?.statusCode, 409, 'L6:entry-on-flipping-line-refused');
      assert.deepEqual((await doc(old)).sourceReferences, stale, 'L6:refusal-writes-nothing');
      await FinanceEntry.deleteOne({ _id: entry._id });
      await FinancialAccount.updateOne({ _id: account2._id }, { $set: { commitLease: 'held', commitLeaseUntil: new Date(Date.now() + 60000) } });
      assert.equal((await thrown(() => rebuildSourceReferences(ownerId, String(account2._id), { apply: true })))?.statusCode, 409, 'L6:held-lease-refused');
      await FinancialAccount.updateOne({ _id: account2._id }, { $unset: { commitLease: '', commitLeaseUntil: '' } });
      const released = await rebuildSourceReferences(ownerId, String(account2._id), { apply: true, revision: 'fixture-3' });
      assert.deepEqual([released.written, await activeOf(old)], [[old], [2]], 'L6:historical-row-released-once-the-entry-is-gone');
      return 'CLI dry run writes nothing; apply writes Oct only with the replaced binding; second apply no-op; entry and lease refusals';
    });
    await leg('R-a', async () => {
      const account = await configuredAccount('R-a');
      const P = await importPending(account, [FORECAST.A]), Sept = await importFinal(account, [{ merchant: 'Shop A (final)', amount: 1200, date: '2026-08-12' }], '2026-09');
      assert.equal((await settlementsOf(P))[2].state, 'review', 'R-a:changed-bill-held');
      const sept = await doc(Sept), hash = (await doc(P)).hash;
      const response = await api('imports/' + P + '/forecast', { line: 2, action: 'billed', sourceHash: hash, revision: 0, target: { importId: Sept, sourceHash: sept.hash, lines: [2] }, note: 'merchant, date and amount changed on the bill' });
      assert.equal(response.status, 200, 'R-a:route PUT imports/:id/forecast → ' + response.status + ' ' + JSON.stringify(response.data).slice(0, 300));
      const groups = await groupsOf(Sept);
      assert.deepEqual([(await doc(Sept)).sourceReferences.version, groups.map(g => [g.match, g.state, g.lines, g.targets[0].importId, g.targets[0].lines])], [4, [['pending_resolution', 'existing_import', [2], P, [2]]]], 'R-a:resolution-group');
      assert.deepEqual([await activeOf(Sept), await activeOf(P)], [[], [2]], 'R-a:final-row-excluded, forecast active');
      assert.equal((await thrown(async () => finance.assertEditableImportRow(await doc(Sept), 2)))?.statusCode, 409, 'R-a:final-row-uneditable');
      const s = (await settlementsOf(P))[2];
      assert.deepEqual([s.state, s.source.importId, s.source.match, s.source.row.line, s.source.row.amount, s.source.row.purchaseDate, s.resolution.state, s.resolution.revision, s.resolution.superseded], ['finalized', Sept, 'pending_resolution', 2, 1200, '2026-08-12', 'billed', 1, false], 'R-a:forecast-finalized-with-the-billed-values');
      const { listPayments } = await payments(), listed = (await listPayments(ownerId)).payments.filter(p => p.kind === 'card'), payment = listed.find(p => p.importId === P && p.line === 2);
      assert.deepEqual([payment?.amount, payment?.date, payment?.description, payment?.confirmed?.amount, payment?.confirmed?.importId, payment?.provisional?.amount, payment?.provisional?.purchaseDate], [1200, '2026-08-12', 'Shop A (final)', 1200, Sept, 1000, '2026-08-10'], 'R-a:B2-payment-matching-uses-the-confirmed-values');
      assert.ok(!listed.some(p => p.importId === Sept), 'R-a:the-final-copy-is-not-a-second-payment');
      await approvedDraft(account, P, 2, '2026-08-12');
      const posted = await finance.commitImport(ownerId, P, { decisions: [{ line: 2, action: 'import', draftRevision: 1 }] });
      assert.deepEqual([posted.posted, writes.transactions.length], [1, 1], 'R-a:posted-once');
      const payload = writes.transactions[0].update.$setOnInsert, day = payload.date instanceof Date ? payload.date.toISOString().slice(0, 10) : String(payload.date).slice(0, 10);
      assert.deepEqual([payload.amount, day, payload.notes, payload.metadata.finalizedSource.importId, payload.metadata.finalizedSource.row.amount, payload.metadata.finalizedSource.row.purchaseDate, payload.cardNumber], [1200, '2026-08-12', 'Shop A', Sept, 1200, '2026-08-12', account.primaryCard], 'R-a:ledger-payload-carries-the-billed-amount');
      assert.equal((await FinanceEntry.findOne({ importId: P, line: 2 }).lean()).state, 'posted', 'R-a:entry-posted');
      const reopened = await api('imports/' + P + '/forecast', { line: 2, action: 'reopen', sourceHash: hash });
      assert.equal(reopened.status, 409, 'R-a:a-posted-pairing-cannot-be-reopened');
      return 'billed 1<->1 through the route: resolution group, confirmed values matched, ledger posts 1200';
    });
    await leg('R-b', async () => {
      const account = await newAccount('R-b'), B = { merchant: 'Shop B', amount: 900, month: '26/10' };
      const P = await importPending(account, [B]);
      const Oct = await importFinal(account, [{ merchant: 'Shop O1', amount: 100, date: '2026-10-02' }, { merchant: 'Shop O2', amount: 200, date: '2026-10-03' }, { merchant: 'Shop O3', amount: 300, date: '2026-10-04' }], '2026-10');
      const S2 = await importPending(account, [{ merchant: 'Shop N1', amount: 500, date: '2026-10-05', month: '26/11' }, { merchant: 'Shop N2', amount: 600, date: '2026-10-06', month: '26/11' }], '2026-10-07T00:00:00.000Z');
      assert.deepEqual([await activeOf(Oct), await activeOf(S2), (await settlementsOf(P))[2].state], [[], [], 'review'], 'R-b:unmatched-forecast-holds-3+2-rows');
      const hash = (await doc(P)).hash, closed = await api('imports/' + P + '/forecast', { line: 2, action: 'closed', sourceHash: hash, note: 'cancelled at the shop' });
      assert.equal(closed.status, 200, 'R-b:closed → ' + closed.status + ' ' + JSON.stringify(closed.data).slice(0, 300));
      assert.deepEqual([await activeOf(Oct), await activeOf(S2), await activeOf(P)], [[2, 3, 4], [2, 3], [2]], 'R-b:held-rows-released, the forecast stays visible');
      const s = (await settlementsOf(P))[2];
      assert.deepEqual([s.state, s.resolution.state, s.resolution.note, s.resolution.superseded, s.candidates], ['closed', 'closed', 'cancelled at the shop', false, undefined], 'R-b:closed-settlement');
      const refused = await thrown(() => finance.commitImport(ownerId, P, { decisions: [{ line: 2, action: 'import', draftRevision: 1 }] }));
      assert.equal(refused?.statusCode, 409, 'R-b:closed-line-unpostable'); assert.match(messageOf(refused), /未請求明細/, 'R-b:posting-gate-text');
      const Oct2 = await importFinal(account, [B], '2026-10');
      const after = (await settlementsOf(P))[2];
      assert.deepEqual([after.state, after.source.importId, after.source.match, after.resolution.state, after.resolution.superseded, await activeOf(Oct2), await activeOf(P)], ['finalized', Oct2, 'pending_purchase', 'closed', true, [], [2]], 'R-b:a-later-exact-bill-supersedes-the-closed-record (counted once)');
      assert.equal(await verifyAll(account._id), 4, 'R-b:everything-verifies');
      return '3 final rows + 2 snapshot rows released; closed line unpostable; exact bill supersedes, counted once';
    });
    await leg('R-c', async () => {
      const { resolveForecastLine } = await resolution(), E = { merchant: 'Shop E', amount: 700, month: '26/09' };
      const account = await newAccount('R-c'), P = await importPending(account, [E, E]), Sept = await importFinal(account, [E, E, E], '2026-09'), hash = (await doc(P)).hash, septHash = (await doc(Sept)).hash;
      const before = await settlementsOf(P);
      assert.deepEqual([before[2].state, before[3].state, before[2].candidates.map(c => [c.importId, c.final, c.lines])], ['review', 'review', [[Sept, true, [2, 3, 4]]]], 'R-c:three-bills-two-forecasts-review');
      assert.equal((await thrown(() => resolveForecastLine(ownerId, P, { line: 2, lines: [2], action: 'billed', sourceHash: hash, target: { importId: Sept, sourceHash: septHash, lines: [2, 3] } })))?.statusCode, 400, 'R-c:1<->2-refused');
      await resolveForecastLine(ownerId, P, { line: 2, lines: [2, 3], action: 'billed', sourceHash: hash, target: { importId: Sept, sourceHash: septHash, lines: [2, 3] } });
      const rec = await records(P);
      assert.deepEqual([[...rec.keys()], rec.get(2).lines, rec.get(2).target.lines, rec.get(3).lines, rec.get(3).target.lines, rec.get(2).revision, rec.get(3).revision], [[2, 3], [2, 3], [2, 3], [2, 3], [2, 3], 1, 1], 'R-c:grouped-record-identical-on-every-line');
      assert.deepEqual((await groupsOf(Sept)).map(g => [g.match, g.state, g.lines, g.targets[0].lines]), [['pending_resolution', 'existing_import', [2, 3], [2, 3]]], 'R-c:x3-is-in-no-group');
      assert.deepEqual([await activeOf(Sept), await activeOf(P)], [[4], [2, 3]], 'R-c:three-purchases-in-total');
      const s = await settlementsOf(P);
      assert.deepEqual([s[2].state, s[2].source.row.line, s[3].state, s[3].source.row.line], ['finalized', 2, 'finalized', 3], 'R-c:pairing-by-sorted-index');
      await verifyAll(account._id);
      const account2 = await newAccount('R-c-close-one'), P2 = await importPending(account2, [E, E]), Sept2 = await importFinal(account2, [E, E, E], '2026-09');
      await resolveForecastLine(ownerId, P2, { line: 2, action: 'closed', sourceHash: (await doc(P2)).hash });
      const s2 = await settlementsOf(P2);
      assert.deepEqual([s2[2].state, s2[3].state, (await groupsOf(Sept2)).map(g => [g.match, g.state, g.lines, g.targets[0].lines]), await activeOf(Sept2)], ['closed', 'review', [['pending_purchase', 'source_overlap_review', [2, 3, 4], [3]]], []], 'R-c:closing-E1-alone-leaves-E2-held');
      await verifyAll(account2._id);
      // The page sends one selected radio and no grouped `lines`: each identical purchase must resolve independently.
      for (const changed of [false, true]) {
        const account3 = await newAccount('R-c-browser-' + changed), P3 = await importPending(account3, [E, E]);
        const bills = changed ? [{ ...E, amount: 800 }, { ...E, amount: 800 }] : [E, E, E];
        const F3 = await importFinal(account3, bills, '2026-09'), p3 = await doc(P3), f3 = await doc(F3);
        for (const line of [2, 3]) {
          const response = await api('imports/' + P3 + '/forecast', { line, action: 'billed', sourceHash: p3.hash, revision: 0, target: { importId: F3, sourceHash: f3.hash, lines: [line] } });
          assert.equal(response.status, 200, 'R-c:browser-single-choice-' + changed + '-' + line + ' returns ' + response.status);
          assert.equal((await settlementsOf(P3))[line].state, 'finalized', 'R-c:browser-choice-finalized');
          await verifyAll(account3._id);
        }
        assert.deepEqual([await activeOf(P3), await activeOf(F3)], [[2, 3], changed ? [] : [4]], 'R-c:individual-repeats-preserved');
      }
      return 'billed [E1,E2]<->[x1,x2], x3 new (3 purchases); 1<->2 is 400; closing E1 alone leaves E2 held';
    });
    await leg('R-g', async () => {
      for (const mode of ['default', 'chosen', 'keep-provisional', 'choose-final', 'resume', 'legacy-resume']) {
        const account = await configuredAccount('R-g-' + mode), P = await importPending(account, [FORECAST.A]);
        const draftDate = mode === 'chosen' || mode === 'choose-final' ? '2026-08-31' : '2026-08-10';
        await approvedDraft(account, P, 2, draftDate); // Approved before the final date exists.
        const F = await importFinal(account, [{ merchant: 'Shop A final', amount: 1200, date: '2026-08-12' }], '2026-09'), p = await doc(P), f = await doc(F);
        const resolved = await api('imports/' + P + '/forecast', { line: 2, action: 'billed', sourceHash: p.hash, target: { importId: F, sourceHash: f.hash, lines: [2] } });
        assert.equal(resolved.status, 200, 'R-g:resolve');
        const beforeWrites = writes.transactions.length;
        if (mode === 'resume' || mode === 'legacy-resume') {
          const insert = Transaction.updateOne;
          try {
            Transaction.updateOne = async () => { throw Error('synthetic interruption before the ledger write'); };
            assert.match(String(await thrown(() => finance.commitImport(ownerId, P, { decisions: [{ line: 2, action: 'import', draftRevision: 1 }] }))), /synthetic interruption/);
          } finally { Transaction.updateOne = insert; }
          if (mode === 'legacy-resume') await FinanceEntry.updateOne({ importId: P, line: 2 }, { $unset: { 'draftSnapshot.postingDate': '' } });
          else {
            const view = await finance.reviewImport(ownerId, P);
            assert.equal(view.rows.find(r => r.line === 2).settlement.postingDate.date, '2026-08-12', 'R-g:editor-sees-the-reserved-date');
          }
        }
        const posted = await finance.commitImport(ownerId, P, { decisions: [{ line: 2, action: 'import', draftRevision: 1, ...(mode === 'keep-provisional' || mode === 'resume' ? { keepDraftDate: true } : mode === 'choose-final' ? { keepDraftDate: false } : {}) }] });
        const payload = writes.transactions[beforeWrites].update.$setOnInsert, day = new Date(payload.date).toISOString().slice(0, 10);
        assert.deepEqual([posted.posted, day, payload.amount], [1, ['default','choose-final','resume','legacy-resume'].includes(mode) ? '2026-08-12' : draftDate, 1200], 'R-g:confirmed-date-default-and-explicit-accounting-choice-' + mode);
        const entry = await FinanceEntry.findOne({ importId: P, line: 2 }).lean();
        assert.equal(entry.draftSnapshot.postingDate?.date, day, 'R-g:posting-date-choice-is-durable');
        assert.equal((await FinanceDraft.findOne({ importId: P, line: 2 }).lean()).values.date, draftDate, 'R-g:saved-draft-is-preserved');
        await finance.commitImport(ownerId, P, { decisions: [{ line: 2, action: 'import', draftRevision: 1 }] });
        assert.equal(writes.transactions.length, beforeWrites + 1, 'R-g:retry-no-second-post');
      }
      return 'preapproved provisional date uses the final date; deliberate accounting dates and explicit keep-date survive; no duplicate on retry';
    });
    await leg('R-d', async () => {
      const { resolveForecastLine } = await resolution(), { planSourceReferenceRebuild, applySourceReferenceRebuild } = await rebuild();
      const account = await newAccount('R-d'), P = await importPending(account, [FORECAST.A]), Sept = await importFinal(account, [{ merchant: 'Shop A (final)', amount: 1200, date: '2026-08-12' }], '2026-09');
      const hash = (await doc(P)).hash, septHash = (await doc(Sept)).hash, billed = { line: 2, action: 'billed', sourceHash: hash, target: { importId: Sept, sourceHash: septHash, lines: [2] } };
      await resolveForecastLine(ownerId, P, billed);
      assert.equal((await groupsOf(Sept))[0].match, 'pending_resolution', 'R-d:billed');
      await resolveForecastLine(ownerId, P, { line: 2, action: 'reopen', sourceHash: hash, revision: 1 });
      assert.deepEqual([(await groupsOf(Sept)).map(g => [g.match, g.targets[0].lines]), (await records(P)).size, (await settlementsOf(P))[2].state, (await settlementsOf(P))[2].candidates.length], [[['pending_candidate', [2]]], 0, 'review', 1], 'R-d:reopen-restores-the-candidate-group');
      // crash order 1: the record is written, the bindings are not
      await FinanceImport.updateOne({ _id: P }, { $set: { 'forecastResolutions.2': { state: 'billed', lines: [2], target: { importId: Sept, sourceHash: septHash, lines: [2] }, note: '', at: new Date().toISOString(), revision: 1, replaced: null } } });
      assert.equal(await verifyAll(account._id), 2, 'R-d:readers-verify-with-a-record-but-no-group');
      await finance.importSourceReferences(await doc(Sept));
      const partial = (await settlementsOf(P))[2];
      assert.deepEqual([partial.state, partial.resolution.state, partial.resolution.superseded], ['review', 'billed', false], 'R-d:a-record-without-its-group-is-not-finalized');
      await resolveForecastLine(ownerId, P, { ...billed, revision: 1 });
      assert.deepEqual([(await groupsOf(Sept))[0].match, (await records(P)).get(2).revision, (await settlementsOf(P))[2].state], ['pending_resolution', 2, 'finalized'], 'R-d:the-next-call-completes-the-binding');
      // crash order 2 (reopen): the bindings are rebuilt, the record is still there
      const docs = await all(account._id);
      await applySourceReferenceRebuild(planSourceReferenceRebuild(docs.map(b => String(b._id) === P ? { ...b, forecastResolutions: {} } : b)), { ownerId, revision: 'fixture-crash' });
      assert.deepEqual([(await groupsOf(Sept))[0].match, (await records(P)).size], ['pending_candidate', 1], 'R-d:bindings-rebuilt-record-left');
      assert.equal(await verifyAll(account._id), 2, 'R-d:readers-verify-after-the-reopen-crash');
      await resolveForecastLine(ownerId, P, { line: 2, action: 'reopen', sourceHash: hash });
      assert.equal((await records(P)).size, 0, 'R-d:the-next-reopen-completes');
      // tampering: a record that no longer names the group's rows is refused by every reader
      await resolveForecastLine(ownerId, P, billed);
      await FinanceImport.updateOne({ _id: P }, { $set: { 'forecastResolutions.2.target.lines': [3] } });
      assert.ok(await thrown(() => verifyAll(account._id)), 'R-d:a-record-changed-under-its-resolution-group-fails-closed');
      assert.equal((await thrown(async () => finance.importSourceReferences(await doc(Sept))))?.statusCode, 409, 'R-d:import-references-409-on-tamper');
      await FinanceImport.updateOne({ _id: P }, { $set: { 'forecastResolutions.2.target.lines': [2] } });
      assert.equal(await verifyAll(account._id), 2, 'R-d:restored');
      return 'reopen restores the candidate group; both crash orders verify and complete; tampering fails closed';
    });
    await leg('R-e', async () => {
      const { resolveForecastLine } = await resolution();
      const account = await newAccount('R-e'), P = await importPending(account, [FORECAST.A]), Sept = await importFinal(account, [{ merchant: 'Shop A (final)', amount: 1200, date: '2026-08-12' }], '2026-09');
      const hash = (await doc(P)).hash, sept = await doc(Sept);
      const entry = await entryOn(account, sept, sept.rows[0], 'posted');
      const refused = await thrown(() => resolveForecastLine(ownerId, P, { line: 2, action: 'billed', sourceHash: hash, target: { importId: Sept, sourceHash: sept.hash, lines: [2] } }));
      assert.equal(refused?.statusCode, 409, 'R-e:entry-on-target-row-refused'); assert.match(messageOf(refused), /請求なし/, 'R-e:refusal-names-the-closing-alternative');
      assert.deepEqual([(await records(P)).size, (await doc(Sept)).sourceReferences], [0, sept.sourceReferences], 'R-e:refusal-writes-nothing');
      await FinanceEntry.deleteOne({ _id: entry._id });
      await FinancialAccount.updateOne({ _id: account._id }, { $set: { commitLease: 'held', commitLeaseUntil: new Date(Date.now() + 60000) } });
      assert.equal((await thrown(() => resolveForecastLine(ownerId, P, { line: 2, action: 'closed', sourceHash: hash })))?.statusCode, 409, 'R-e:held-lease-refused');
      await FinancialAccount.updateOne({ _id: account._id }, { $unset: { commitLease: '', commitLeaseUntil: '' } });
      const account2 = await newAccount('R-e-flip'), P2 = await importPending(account2, [{ merchant: 'Shop B', amount: 900, month: '26/10' }]);
      const Oct = await importFinal(account2, [{ merchant: 'Shop O1', amount: 100, date: '2026-10-02' }, { merchant: 'Shop O2', amount: 200, date: '2026-10-03' }], '2026-10'), oct = await doc(Oct);
      await entryOn(account2, oct, oct.rows[0], 'reserved');
      assert.equal((await thrown(async () => resolveForecastLine(ownerId, P2, { line: 2, action: 'closed', sourceHash: (await doc(P2)).hash })))?.statusCode, 409, 'R-e:entry-on-flipping-line-refused');
      assert.deepEqual([(await records(P2)).size, (await doc(Oct)).sourceReferences, await activeOf(Oct)], [0, oct.sourceReferences, []], 'R-e:nothing-written-on-refusal');
      assert.equal((await thrown(() => resolveForecastLine(ownerId, P, { line: 2, action: 'billed', sourceHash: hash, target: { importId: Oct, sourceHash: oct.hash, lines: [2] } })))?.statusCode, 409, 'R-e:not-a-candidate-refused');
      assert.equal((await thrown(() => resolveForecastLine(ownerId, P, { line: 2, action: 'closed', sourceHash: '0'.repeat(64) })))?.statusCode, 409, 'R-e:stale-hash-refused');
      assert.equal((await thrown(() => resolveForecastLine(ownerId, P, { line: 2, action: 'nothing', sourceHash: hash })))?.statusCode, 400, 'R-e:unknown-action-refused');
      assert.equal((await thrown(() => resolveForecastLine(ownerId, P, { line: 2, action: 'reopen', sourceHash: hash })))?.statusCode, 409, 'R-e:reopen-without-a-record-refused');
      assert.equal((await thrown(() => resolveForecastLine(ownerId, Sept, { line: 2, action: 'closed', sourceHash: sept.hash })))?.statusCode, 409, 'R-e:a-statement-line-cannot-be-resolved');
      return 'entry on a target row 409 with the closing hint; held lease 409; entry on a flipping line 409 with nothing written; shape refusals';
    });
    await leg('R-f', async () => {
      const { resolveForecastLine } = await resolution(), { listPayments } = await payments(), base = await baseShared();
      const amex = (await FinancialAccount.create({ ownerId, provider: 'amex', name: 'Synthetic Amex R-f', primaryCard: '12345', cardIdentifiers: ['12345'], otpRecipient: 'rf@example.invalid', otpMailbox: 'rf@example.invalid' })).toObject();
      const amexCsv = rows => csv(AMEX_HEADERS, rows.map(x => [x.date, x.processed, x.merchant, 'Test user', '12345', x.amount, '', '']));
      const P = (await finance.acceptImport(ownerId, amex, amexCsv([{ date: '2026/10/06', processed: '2026/10/07', merchant: 'Shop A', amount: 1200 }]), { kind: 'pending', start: '2026-10-05', end: '2026-10-10' })).id;
      const F = (await finance.acceptImport(ownerId, amex, amexCsv([{ date: '2026/10/07', processed: '2026/10/08', merchant: 'Shop A renamed', amount: 1250 }]), { kind: 'statement', start: '2026-10-05', end: '2026-11-04' })).id;
      const docs = await all(amex._id), fDoc = docs.find(b => String(b._id) === F), pDoc = docs.find(b => String(b._id) === P);
      const old = base.buildSourceReferences(fDoc, [pDoc]); overlap.verifySourceReferences({ ...fDoc, sourceReferences: old }, [pDoc]);
      assert.deepEqual(old, fDoc.sourceReferences, 'R-f:the-amex-binding-is-byte-identical-to-127c8ad');
      assert.equal((await settlementsOf(P))[2].state, 'review', 'R-f:amex-changed-bill-held');
      await resolveForecastLine(ownerId, P, { line: 2, action: 'billed', sourceHash: pDoc.hash, target: { importId: F, sourceHash: fDoc.hash, lines: [2] } });
      const s = (await settlementsOf(P))[2];
      assert.deepEqual([s.state, s.source.match, s.source.row.amount, s.source.row.purchaseDate, await activeOf(F)], ['finalized', 'pending_resolution', 1250, '2026-10-07', []], 'R-f:the-amex-pair-resolves-the-same-way');
      const payment = (await listPayments(ownerId)).payments.find(p => p.kind === 'card' && p.importId === P && p.line === 2);
      assert.deepEqual([payment?.amount, payment?.date, payment?.provisional?.amount], [1250, '2026-10-07', 1200], 'R-f:amex-matching-uses-the-confirmed-values');
      assert.equal(await verifyAll(amex._id), 2, 'R-f:verifies');
      return 'Amex: 127c8ad binding identical and verifies; billed resolves the same way; confirmed values matched';
    });
  } catch (error) { report.setupError = String(error?.stack || error).slice(0, 2400); console.log('SETUP ' + String(error?.message || error).slice(0, 600)); }
  finally {
    await finish();
    server?.closeAllConnections?.(); server?.close();
    try { const { stopCleanup } = await import(u('server/services/tokenBlacklistService.ts')); stopCleanup(); } catch {}
    await mongoose?.disconnect().catch(() => {}); await mongo?.stop().catch(() => {}); if (temp) await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
  process.exit(!report.setupError && legs.every(l => l.pass) ? 0 : 1);
}

// A copy of server/ + shared/ inside the worktree (dependencies resolve upward) with one file changed; removed whatever happens.
async function withTree(label, file, text, fn) {
  const dir = path.join(root, '.cache', 'omf-aplus-' + label); await rm(dir, { recursive: true, force: true });
  for (const d of ['server', 'shared']) await cp(path.join(root, d), path.join(dir, d), { recursive: true });
  await writeFile(path.join(dir, file), text);
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

const fixture = { name: 'omf-aplus-reconciliation', covers: PARTIAL ? [] : COVERS, async run() {
  const started = Date.now(), lines = [], evidence = process.env.OMF_APLUS_EVIDENCE || '', want = name => !LEGS.length || LEGS.includes(name);
  const keep = async (name, text) => { if (evidence) { await mkdir(evidence, { recursive: true }).catch(() => {}); await writeFile(path.join(evidence, name), text).catch(() => {}); } };
  let pass = true;
  const childRun = async (label, args = [], env = {}) => { const out = path.join(os.tmpdir(), 'omf-aplus-' + label + '-' + randomUUID() + '.json'); const result = await execute(process.execPath, ['--import', 'tsx', SELF, '--child', '--out', out, ...args], { cwd: root, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', ...env }, timeout: 1500000 }); let report = null; try { report = JSON.parse(await readFile(out, 'utf8')); } catch {} await rm(out, { force: true }).catch(() => {}); return { ...result, report }; };
  const chosen = CHILD_LEGS.filter(want);
  if (chosen.length) {
    const main = await childRun('main', ['--legs', chosen.join(',')]);
    await keep('child-main.txt', main.stdout + '\n' + main.stderr);
    if (!main.report) { pass = false; lines.push('CHILD: no report (exit ' + main.code + '): ' + (main.stderr + main.stdout).slice(-1500)); }
    else {
      if (main.report.setupError) { pass = false; lines.push('SETUP: ' + main.report.setupError.split('\n').slice(0, 3).join(' | ')); }
      for (const leg of main.report.legs) { if (!leg.pass) pass = false; lines.push((leg.pass ? 'PASS ' : 'FAIL ') + leg.name + ': ' + (leg.pass ? leg.note : leg.error.split('\n').slice(0, 3).join(' | ')) + ' (' + Math.round(leg.ms / 1000) + 's)'); }
      for (const name of chosen) if (!main.report.legs.some(l => l.name === name)) { pass = false; lines.push('FAIL ' + name + ': not reached'); }
      lines.push('intercepted ledger writes: ' + main.report.writes + ' (payloads kept, nothing inserted)');
    }
  }
  if (want('L7')) {
    try {
      const summary = [];
      for (const file of ['scripts/finance-pending.test.mjs', 'scripts/finance-import-overlap.test.mjs']) {
        const r = await execute(process.execPath, ['--test', '--test-concurrency=1', file], { cwd: root, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '' }, timeout: 600000 }), out = r.stdout + r.stderr, count = name => Number(new RegExp('^(?:ℹ|#) ' + name + ' (\\d+)', 'm').exec(out)?.[1] ?? 0);
        await keep('L7-' + path.basename(file) + '.txt', out); summary.push(path.basename(file) + ' ' + count('pass') + '/' + (count('pass') + count('fail')));
        assert.ok(r.code === 0 && count('pass') > 0 && count('fail') === 0, file + ' RED: ' + (out.match(/^(?:✖|not ok).*$/gm) || []).slice(0, 8).join(' | '));
      }
      const amex = await readFile(path.join(root, 'scripts', 'zoomer-fixtures', 'omf-amex-recent.mjs'), 'utf8'), base = /const BASE = '([a-f0-9]{40})';/.exec(amex)?.[1];
      assert.ok(base && /const frozen = \[[^\]]*'shared\/finance-import-overlap\.mjs'/.test(amex), 'the Amex fixture must keep its 40-hex BASE pin and the shared module in its frozen list');
      lines.push('PASS L7: ' + summary.join('; ') + '; Amex frozen list still names the shared module (BASE ' + base.slice(0, 8) + ')');
    } catch (error) { pass = false; lines.push('FAIL L7: ' + String(error?.message || error).slice(0, 900)); }
  }
  if (want('M')) {
    const chosenDefects = DEFECTS.filter(d => !MUTANTS.length || MUTANTS.includes(d[0])), receipts = [];
    for (const [label, file, edits, legName] of chosenDefects) {
      let caught = false, detail = '';
      try {
        const text = mutate(await readFile(path.join(root, file), 'utf8'), edits, label);
        const r = await withTree(label.split('-')[0], file, text, dir => childRun(label, ['--src', dir, '--legs', legName]));
        await keep('M-' + label + '.txt', r.stdout + '\n' + r.stderr);
        const leg = r.report?.legs?.find(l => l.name === legName);
        caught = !!leg && leg.pass === false && !r.report.setupError;
        detail = !r.report ? 'child crashed (exit ' + r.code + ')' : r.report.setupError ? 'setup error, not detection' : !leg ? legName + ' not reached' : leg.pass ? legName + ' stayed green' : leg.error.split('\n')[0].slice(0, 200);
      } catch (error) { detail = 'harness fault: ' + String(error?.message || error).slice(0, 200); }
      receipts.push({ label, leg: legName, caught, detail });
      lines.push((caught ? 'CAUGHT ' : 'MISSED ') + label + ' → ' + legName + ': ' + detail);
    }
    await keep('M.json', JSON.stringify(receipts, null, 2));
    if (receipts.some(x => !x.caught)) pass = false;
    lines.push('M: ' + receipts.filter(x => x.caught).length + '/' + receipts.length + ' reintroduced defects caught, each after its unchanged control');
  }
  return { pass, databaseCoverage: { executed: chosen.length > 0, ownedProcess: chosen.length > 0 }, message: (pass ? 'green' : 'RED') + ' in ' + Math.round((Date.now() - started) / 1000) + 's' + (PARTIAL ? ' (PARTIAL development run — no coverage exported)' : '') + '\n' + lines.join('\n') };
} };
export default fixture;

if (process.argv.includes('--child')) await child().catch(error => { console.error(String(error?.stack || error)); process.exit(1); });
