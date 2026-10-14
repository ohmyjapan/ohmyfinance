// Replay for plan omf-calendar-gmail-build-20261015 (plan.replay): the owner's real Aplus statement imports (10 rows,
// 2025-11..2026-08) and the one recorded confirmation notice, exported read-only into a private hub file together with
// the 48 hand-entered Term Credit Card payments, the accounts and the companies, are loaded as production had them into
// an owned ephemeral MongoDB and driven through reconcileBill in dry-run mode: every read the real code makes, no write
// (every Payment / FinanceNotice / FinanceImport / FinancialAccount writer is replaced by a recorder that throws). Two
// passes per row: as exported (no calendar binding exists in production yet) and with the account bound to the owner's
// company, which is the activation step the plan names. Run ONLY through the hub verifier (never directly):
//   REPLAY_INPUT=<abs 8-replay-input.json> REPLAY_OUT=<abs 8-replay-result.json> node scripts/zoomer-verify.mjs --run-fixture calendar-card-bill-replay.mjs --cwd <worktree>
// With REPLAY_INPUT unset (decided at load) it exports covers: [] and passes with the note "no replay input": it grants
// no coverage. Customer text never enters this file or the result: ids, amounts, dates, states and counts only; the
// recorded mail is read from the hub file named by the export and only its parsed claims are kept.
import { execFile } from 'node:child_process';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const timeoutMs = 600000;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const INPUT = process.env.REPLAY_INPUT || '';
const OUT = process.env.REPLAY_OUT || '';

const CHILD = String.raw`
// @ts-nocheck
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = process.argv[2], INPUT = process.argv[3], OUT = process.argv[4];
const u = p => pathToFileURL(path.join(ROOT, p)).href;
const exported = JSON.parse(await readFile(INPUT, 'utf8'));
assert.equal(exported.readOnly, true); assert.equal(exported.database, 'ohmyfinance');
const rows = Array.isArray(exported.rows) ? exported.rows : [];
const hubRoot = path.resolve(path.dirname(INPUT), '..', '..', '..');
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-calendar-replay-'));
process.env.OMF_DATA_DIR = path.join(temp, 'data'); process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = randomBytes(32).toString('hex');
const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default;
const mongo = await MongoMemoryServer.create({ instance: { dbName: 'calendar_card_bill_replay_isolated' } });
process.env.MONGO_URI = mongo.getUri('calendar_card_bill_replay_isolated');
let revision = 'unknown';
try { revision = (await (await import('node:util')).promisify((await import('node:child_process')).execFile)('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { windowsHide: true })).stdout.trim(); } catch { /* not a checkout */ }
const results = [], problems = [];
const sends = {};
let blocked = 0;
try {
  await mongoose.connect(process.env.MONGO_URI); assert.equal(mongoose.connection.name, 'calendar_card_bill_replay_isolated');
  const Organization = (await import(u('server/models/Organization.ts'))).default;
  const { Payment } = await import(u('server/models/Payment.ts'));
  const { FinancialAccount, FinanceImport, FinanceNotice, initializeFinance } = await import(u('server/models/Finance.ts'));
  const { reconcileBill, importEvidence } = await import(u('server/services/financeBillService.ts'));
  const { parseBillingMail, statementPeriodKey } = await import(u('shared/billing-mail.mjs'));
  await initializeFinance(); await Payment.init();
  // Every writer of the plan's send list is replaced by a recorder that throws: a dry run that tries to write fails loudly.
  for (const [Model, name, methods] of [[Payment, 'Payment', ['updateOne', 'findOneAndUpdate', 'create', 'deleteOne', 'updateMany', 'insertMany']], [FinanceNotice, 'FinanceNotice', ['findOneAndUpdate', 'create', 'updateOne']], [FinanceImport, 'FinanceImport', ['updateOne', 'findOneAndUpdate']], [FinancialAccount, 'FinancialAccount', ['findOneAndUpdate', 'updateOne']]]) {
    for (const method of methods) { const key = name + '.' + method; sends[key] = 0; Model[method] = function () { sends[key]++; blocked++; throw new Error('replay: ' + key + ' called in dry run'); }; }
  }
  const oid = v => new mongoose.Types.ObjectId(String(v));
  const toDate = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v) : v);
  const asStored = value => Array.isArray(value) ? value.map(asStored) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, asStored(v)])) : toDate(value);
  // Companions as production had them (raw inserts; synthetic names only where the schema needs one the export omits).
  const companions = exported.companions || {};
  for (const org of companions.organizations || []) await mongoose.connection.collection('organizations').insertOne({ _id: oid(org._id), name: 'Replay company ' + String(org._id).slice(-4), slug: 'replay-' + String(org._id).slice(-6), type: 'business', isActive: org.isActive !== false, members: (org.members || []).map(m => ({ userId: oid(m.userId), role: m.role || 'member' })) });
  for (const p of companions.payments || []) { const { _id, organizationId, ...rest } = p; await mongoose.connection.collection('payments').insertOne({ _id: oid(_id), ...asStored(rest), ...(organizationId ? { organizationId: oid(organizationId) } : {}) }); }
  for (const a of companions.accounts || []) { const { _id, ownerId, organizationId, previousOrganizationId, ...rest } = a; await mongoose.connection.collection('financialaccounts').insertOne({ _id: oid(_id), ownerId: oid(ownerId), ...asStored(rest), ...(organizationId ? { organizationId: oid(organizationId) } : {}), ...(previousOrganizationId ? { previousOrganizationId: oid(previousOrganizationId) } : {}) }); }
  for (const r of rows) { const { _id, ownerId, accountId, ...rest } = r; await mongoose.connection.collection('financeimports').insertOne({ _id: oid(_id), ownerId: oid(ownerId), accountId: oid(accountId), ...asStored(rest), rows: [] }); }
  const paymentsCount = (companions.payments || []).length, legacyAplus = (companions.payments || []).filter(p => /アプラス|aplus/i.test(String(p.title || '')));
  const accountOf = async id => mongoose.connection.collection('financialaccounts').findOne({ _id: oid(id) });
  const ownersCompany = async ownerId => { const org = await mongoose.connection.collection('organizations').findOne({ 'members.userId': oid(ownerId), isActive: true }); return org ? String(org._id) : null; };
  // What production holds for a cycle: the owner's hand-entered rows that name the provider with a due date in the statement month (+3 days).
  const productionOf = (statementMonth, periodEnd) => {
    const start = new Date(statementMonth + '-01T00:00:00.000Z'), end = new Date(new Date(periodEnd + 'T23:59:59.999Z').getTime() + 3 * 86400000);
    return legacyAplus.filter(p => { const d = new Date(p.dueDate); return d >= start && d <= end; }).map(p => ({ paymentId: String(p._id), amount: p.amount, dueDate: p.dueDate, status: p.status, organizationId: p.organizationId ? String(p.organizationId) : null }));
  };
  const dry = async (ownerId, account, evidence, source) => {
    const before = blocked;
    const r = await reconcileBill(String(ownerId), account, evidence, source, { dryRun: true });
    return { ...r, paymentId: r.paymentId ? String(r.paymentId) : undefined, candidates: Array.isArray(r.candidates) ? r.candidates.map(String) : undefined, at: undefined, writesAttempted: blocked - before };
  };
  const classify = (production, replay) => {
    const would = replay.state === 'dry-run' ? replay.would : replay.state;
    if (production.length === 1 && would === 'adopt' && replay.paymentId === production[0].paymentId) return { same: true, label: 'adopts the hand-entered row production holds (' + production[0].status + '); the row is not changed' };
    if (production.length >= 1 && would === 'review' && (replay.candidates || []).some(c => production.some(p => p.paymentId === c))) return { same: false, label: 'INTENDED (10-plan-continuation F1/B2): the hand-entered アプラス row names no card account, so the changed code offers it for the member\'s explicit link instead of adopting it; the row and the count stay exactly as production holds them' };
    if (production.length === 0 && (would === 'due-date-unresolved' || would === 'unbound')) return { same: true, label: 'production holds no bill for this cycle and the changed code creates none (' + would + ')' };
    if (production.length === 0 && would === 'create') return { same: false, label: 'INTENDED (plan §2 S15 step 4): production holds no bill; the changed code would create one under the bound company' };
    if (would === 'review') return { same: false, label: 'INTENDED (plan §2 S15 step 3, B2): the hand-entered rows need a member\'s choice before any write' };
    if (would === 'unauthorized') return { same: false, label: 'INTENDED (B1): no current membership of the bound company; no write' };
    return { same: false, label: 'UNEXPLAINED: production ' + JSON.stringify(production.map(p => p.paymentId)) + ' vs ' + would };
  };
  const cases = rows.map(r => ({ kind: 'statement', id: String(r._id), accountId: String(r.accountId), ownerId: String(r.ownerId), statementMonth: r.period?.statementMonth, periodEnd: r.period?.end, batch: r }));
  // The recorded confirmation mail: parsed from the hub evidence the export names; only the claims leave this scope.
  let noticeCase = null;
  if (exported.billingNoticeInput) {
    try {
      const claims = JSON.parse(await readFile(path.resolve(hubRoot, exported.billingNoticeInput), 'utf8'));
      const mail = (claims.messages || []).find(m => m.issuer === 'aplus' && m.subject === '最新ご請求明細確定のご案内');
      if (mail) {
        const parsed = parseBillingMail({ from: mail.from, subject: mail.subject }, (mail.billingSnippets || []).join('\n'), { now: Date.now() });
        if (parsed) { const aplus = (companions.accounts || []).find(a => a.provider === 'aplus'); noticeCase = { kind: 'notice', id: mail.id, accountId: aplus ? String(aplus._id) : null, ownerId: aplus ? String(aplus.ownerId) : null, statementMonth: parsed.claims.statementMonth, periodEnd: statementPeriodKey(parsed.claims.statementMonth).split(':')[2], claims: parsed.claims, periodKey: parsed.periodKey }; }
        else problems.push('notice ' + mail.id + ': the recorded confirmation did not parse');
      } else problems.push('notice: no Aplus confirmation in the evidence file');
    } catch (error) { problems.push('notice input unreadable: ' + String(error?.message || error).slice(0, 200)); }
  }
  if (noticeCase && noticeCase.accountId) cases.push(noticeCase);
  for (const c of cases) {
    const entry = { id: c.id, kind: c.kind, statementMonth: c.statementMonth, production: null, replay: null, sends: [], same: false, label: null };
    try {
      if (!c.accountId) throw new Error('no Aplus account in the export');
      const exportedAccount = await accountOf(c.accountId); assert.ok(exportedAccount, 'account ' + c.accountId + ' missing');
      const evidence = c.kind === 'statement' ? importEvidence(c.batch) : { periodKey: c.periodKey, statementMonth: c.statementMonth, statementTotal: c.claims.amount, paymentDueDate: c.claims.dueDate, dueDateEvidence: 'issuer-mail' };
      const source = c.kind === 'statement' ? 'statement-csv' : 'issuer-mail';
      const production = productionOf(c.statementMonth, c.periodEnd);
      entry.production = { statementTotal: evidence.statementTotal, paymentDueDate: evidence.paymentDueDate, handEnteredBills: production, calendarBinding: exportedAccount.organizationId ? String(exportedAccount.organizationId) : null, sourcedBills: 0 };
      const asExported = await dry(c.ownerId, exportedAccount, evidence, source);
      const company = await ownersCompany(c.ownerId);
      const bound = company ? await dry(c.ownerId, { ...exportedAccount, organizationId: oid(company), organizationBoundAt: new Date() }, evidence, source) : null;
      entry.replay = { asExported, bound: bound ? { ...bound, company } : null };
      const verdict = classify(production, bound || asExported);
      entry.same = asExported.state === 'unbound' && verdict.same; entry.label = (asExported.state === 'unbound' ? 'as exported: unbound (no company bound yet; nothing happens until the owner binds); ' : 'as exported: ' + asExported.state + '; ') + 'bound: ' + verdict.label;
      if (!verdict.same) entry.intended = verdict.label.startsWith('INTENDED');
      entry.sends = [{ kind: 'writes attempted by the dry run (every writer throws)', count: asExported.writesAttempted + (bound ? bound.writesAttempted : 0) }];
    } catch (error) { entry.error = String(error?.stack || error?.message || error).replace(/\s+/g, ' ').slice(0, 600); problems.push(c.id + ': ' + entry.error); }
    results.push(entry);
  }
  const failed = results.filter(r => r.error).length, same = results.filter(r => r.same && !r.error).length, different = results.length - failed - same;
  const unexplained = results.filter(r => !r.error && !r.same && !r.intended).length;
  const sourcedAfter = await mongoose.connection.collection('payments').countDocuments({ 'source.kind': 'card-statement' });
  const paymentsAfter = await mongoose.connection.collection('payments').countDocuments({});
  // The child's own database receipt (F4/B4): the owned MongoMemoryServer this child started, and real stored objects in it.
  let database = { executed: false, ownedProcess: false };
  try { const stats = await mongoose.connection.db.stats(); database = { executed: stats.objects > 0, ownedProcess: Number(mongoose.connection.port) === Number(mongo.instanceInfo?.port || 0) && mongoose.connection.host === '127.0.0.1', name: mongoose.connection.name, objects: stats.objects, collections: stats.collections }; } catch { /* reported as not executed */ }
  const result = { capturedAt: new Date().toISOString(), input: INPUT, revision, entry: 'reconcileBill(ownerId, account, evidence, source, { dryRun: true }) in server/services/financeBillService.ts — statement rows via importEvidence(batch), the recorded notice via parseBillingMail claims; two passes (as exported, bound to the owner\'s company)', exported: rows.length + (noticeCase ? 1 : 0), loaded: results.length, replayed: results.length - failed, same, different, unexplainedDifferent: unexplained, intendedDifferent: different - unexplained, failed, sends, writesAttempted: blocked, paymentsBefore: paymentsCount, paymentsAfter, sourcedBillsAfter: sourcedAfter, legacyAplusRows: legacyAplus.length, database, productionObservation: exported.productionObservation || null, problems, rows: results };
  if (OUT) await writeFile(OUT, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ __replay__: { pass: results.length > 0 && failed === 0 && blocked === 0 && paymentsAfter === paymentsCount && sourcedAfter === 0, database, message: (rows.length + (noticeCase ? 1 : 0)) + ' exported, ' + results.length + ' loaded, ' + (results.length - failed) + ' replayed on ' + revision.slice(0, 8) + ': ' + same + ' same, ' + different + ' different (' + (different - unexplained) + ' intended, ' + unexplained + ' unexplained), ' + failed + ' not run; writes attempted ' + blocked + ', payments ' + paymentsCount + ' → ' + paymentsAfter + ', sourced bills ' + sourcedAfter + '; database ' + (database.executed ? 'executed ' + database.objects + ' objects in owned ' + database.name : 'no database work') + (OUT ? '; result ' + OUT : '') + (problems.length ? ' — ' + problems.join(' | ').slice(0, 600) : '') } }));
} finally {
  await import(u('server/services/tokenBlacklistService.ts')).then(m => (m.stopCleanup || m.default?.stopCleanup)?.()).catch(() => {});
  await mongoose.disconnect(); await mongo.stop();
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
`;

export default {
  name: 'calendar-card-bill-replay',
  covers: INPUT ? ['server/services/financeBillService.ts', 'server/models/Payment.ts', 'server/models/Finance.ts', 'shared/billing-mail.mjs'] : [],
  async run() {
    if (!INPUT) return { pass: true, message: 'no replay input (REPLAY_INPUT unset): nothing exercised, no coverage claimed' };
    const started = Date.now();
    const cache = path.join(REPO_ROOT, '.cache'); await mkdir(cache, { recursive: true });
    const harness = path.join(cache, 'calendar-card-bill-replay-' + process.pid + '.mts');
    await writeFile(harness, CHILD, { flag: 'wx' });
    try {
      const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', harness, REPO_ROOT, INPUT, OUT], { cwd: REPO_ROOT, windowsHide: true, timeout: 540000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '' } }).catch(error => { throw new Error(String(error.stderr || error.stdout || error.message).slice(-2500)); });
      const line = stdout.split(/\r?\n/).find(l => l.startsWith('{') && l.includes('__replay__'));
      if (!line) throw new Error('the replay harness produced no result: ' + String(stderr || stdout).slice(-1500));
      const result = JSON.parse(line).__replay__;
      const database = result.database || {};
      return { pass: result.pass, databaseCoverage: { executed: database.executed === true, ownedProcess: database.ownedProcess === true }, message: result.message + ' in ' + Math.round((Date.now() - started) / 1000) + 's' };
    } catch (error) { return { pass: false, message: 'Replay failed: ' + String(error?.message || error).replace(/\s+/g, ' ').slice(-2500) }; }
    finally { await unlink(harness).catch(() => {}); }
  }
};
