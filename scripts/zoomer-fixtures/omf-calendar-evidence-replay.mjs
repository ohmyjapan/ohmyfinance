// Replay of the real LOTOS calendar rows (plan omf-calendar-evidence-20261029 §4 replay; house rules 5 and 7) on an owned
// throwaway MongoDB through the hub verifier only:
//   REPLAY_INPUT=<export> REPLAY_OUT=<result> node scripts/zoomer-verify.mjs --run-fixture omf-calendar-evidence-replay.mjs --cwd <tree>
// The export (extended JSON, read by path at run time, never copied into this public repository) carries the 13 `payments` rows of
// the company (12 paid, 1 pending with the legacy Navi marker) and the organization companion; `privateManifest` names the private
// backfill manifest whose originals stay on the private drive. Each row is loaded verbatim into an empty memory MongoDB; the entry is
// calendarPresentation (shared rule) over each row, the backfill's dry-run plan with the private manifest, then its apply in-process
// with EVERY writer of plan.replay.sends replaced by a recorder (the real function then runs against the owned database only; two of
// the six are never handed to the backfill, so their count is 0 by construction), then calendarPresentation again. Per row: the
// outcome production records today (the 9df2635 store flips a past-due pending row to overdue), the changed code's outcome before
// and after the backfill, the recorded sends and `same`. Ids, counts, states, hashes prefixes and invoice numbers only: no titles,
// notes, mail text or file names leave the private input. With REPLAY_INPUT unset this fixture exports `covers: []`, passes with the
// note "no replay input" and grants NO coverage of the entry it did not exercise.
import { execFile } from 'node:child_process';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const timeoutMs = 1200000;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const INPUT = process.env.REPLAY_INPUT || '';
const OUT = process.env.REPLAY_OUT || '';

const CHILD = String.raw`
// @ts-nocheck
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EJSON } from 'bson';
const ROOT = process.argv[2], INPUT = process.argv[3], OUT = process.argv[4];
const u = p => pathToFileURL(path.join(ROOT, p)).href;
const exported = EJSON.deserialize(JSON.parse(await readFile(INPUT, 'utf8')));
assert.equal(exported.readOnly, true); assert.equal(exported.database, 'ohmyfinance'); assert.equal(exported.collection, 'payments');
const rows = Array.isArray(exported.rows) ? exported.rows : [], organizations = exported.companions?.organizations || [];
const manifestPath = String(exported.privateManifest || '');
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-calendar-evidence-replay-'));
process.env.OMF_DATA_DIR = path.join(temp, 'data'); process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = randomBytes(32).toString('hex');
const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default;
const dbName = 'calendar_evidence_replay_isolated';
const mongo = await MongoMemoryServer.create({ instance: { dbName, launchTimeout: 120000 } });
process.env.MONGO_URI = mongo.getUri(dbName);
let revision = 'unknown';
try { revision = (await (await import('node:util')).promisify((await import('node:child_process')).execFile)('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { windowsHide: true })).stdout.trim(); } catch { /* not a checkout */ }
const results = [], problems = [], sends = [];
const counts = { registerCalendarEvidence: 0, retainCalendarOriginal: 0, linkCalendarEvidence: 0, unlinkCalendarEvidence: 0, setPaymentVerification: 0, adoptLegacyVerificationMarker: 0 };
const dayKey = v => v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10);
// The 9df2635 calendar store (stores/calendar.ts:239-246): a pending row past its due day is shown as overdue; no verification exists.
const productionRule = (row, today) => row.status === 'pending' && dayKey(row.dueDate) < today ? 'overdue' : row.status;
const label = { overdue: '期限超過 (red, confirmed overdue)', pending: '保留中', paid: '支払済み', completed: '完了', cancelled: 'キャンセル', bankWait: '銀行照合待ち (neutral, not a confirmed overdue bill)' };
try {
  await mongoose.connect(process.env.MONGO_URI); assert.equal(mongoose.connection.name, dbName);
  assert.equal(mongoose.connection.host, '127.0.0.1'); assert.equal(Number(mongoose.connection.port), Number(mongo.instanceInfo?.port || 0), 'the replay must run on its own memory server');
  const { Payment } = await import(u('server/models/Payment.ts'));
  const { initializeCalendarEvidence, CalendarEvidenceInvoice, CalendarEvidenceSource, CalendarEvidenceLink } = await import(u('server/models/CalendarEvidence.ts'));
  const service = await import(u('server/services/companyCalendarEvidenceService.ts'));
  const backfill = await import(u('scripts/calendar-evidence-backfill.ts'));
  const { calendarPresentation, localDayKey } = await import(u('shared/finance-calendar-verification.mjs'));
  await Payment.init(); await initializeCalendarEvidence();
  // Companions as production had them (the organization with its members; a synthetic name and slug where the export omits them).
  for (const org of organizations) await mongoose.connection.collection('organizations').insertOne({ _id: org._id, name: org.name || 'Replay company ' + String(org._id).slice(-4), slug: org.slug || 'replay-' + String(org._id).slice(-6), type: 'business', isActive: org.isActive !== false, members: (org.members || []).map(m => ({ userId: m.userId, role: m.role || 'member', joinedAt: m.joinedAt || new Date() })) });
  // The rows exactly as exported (BSON shapes restored by EJSON: ObjectId, Date, numbers).
  if (rows.length) await mongoose.connection.collection('payments').insertMany(rows.map(r => ({ ...r })));
  const organizationId = String(exported.filter?.organizationId || organizations[0]?._id || ''), actorId = String(organizations[0]?.members?.[0]?.userId || '');
  assert.ok(/^[a-f0-9]{24}$/i.test(organizationId) && /^[a-f0-9]{24}$/i.test(actorId), 'organization and actor from the export');
  const today = localDayKey();
  const stored = async () => Object.fromEntries((await mongoose.connection.collection('payments').find({}).toArray()).map(r => [String(r._id), r]));
  const before = await stored();
  const describe = (name, args) => {
    if (name === 'retainCalendarOriginal') return name + '(company ' + String(args[0]) + ', ' + (args[1]?.length ?? 0) + ' bytes, sha ' + String(args[2] || '').slice(0, 8) + ')';
    if (name === 'registerCalendarEvidence') { const i = args[1]?.identity || {}, s = args[1]?.source || {}; return name + '(identity ' + i.invoiceNumber + ' ' + i.servicePeriod?.from + '..' + i.servicePeriod?.to + ' ' + i.currency + ', source ' + s.status + ' ' + (s.files || []).length + ' files, email ' + String(s.email?.sha256 || '').slice(0, 8) + ')'; }
    if (name === 'linkCalendarEvidence') return name + '(evidence ' + String(args[1]) + ', payment ' + String(args[2]) + ')';
    if (name === 'adoptLegacyVerificationMarker') return name + '(payment ' + String(args[1]) + ', fingerprint ' + String(args[2]).slice(0, 8) + ')';
    return name + '(' + args.length + ' arguments)';
  };
  const record = (name, args, outcome) => { counts[name]++; const text = describe(name, args) + (outcome !== undefined ? ' -> ' + outcome : ''); sends.push({ name, text, paymentId: name === 'linkCalendarEvidence' ? String(args[2]) : name === 'adoptLegacyVerificationMarker' ? String(args[1]) : null }); };
  const intercept = name => async (...args) => { const r = await service[name](...args); record(name, args, r && typeof r === 'object' && 'outcome' in r ? r.outcome : r && typeof r === 'object' && r.sha256 ? 'retained' : undefined); return r; };
  const writers = { retainCalendarOriginal: intercept('retainCalendarOriginal'), registerCalendarEvidence: intercept('registerCalendarEvidence'), linkCalendarEvidence: intercept('linkCalendarEvidence'), adoptLegacyVerificationMarker: intercept('adoptLegacyVerificationMarker') };
  // The entry: the shared presentation over every row as it is, the dry-run plan, the apply with intercepted writers, then the presentation again.
  const manifest = backfill.loadManifest(manifestPath);
  const plan = await backfill.planCalendarEvidenceBackfill(manifest, { organizationId });
  const checks = await backfill.checkCalendarEvidencePayments(plan, organizationId);
  const dry = { identities: plan.identities.length, sources: plan.identities.reduce((n, i) => n + i.sources.length, 0), activeSources: plan.identities.reduce((n, i) => n + i.sources.filter(s => s.status === 'active').length, 0), supersededSources: plan.identities.reduce((n, i) => n + i.sources.filter(s => s.status === 'superseded').length, 0), links: plan.links.length, adoption: plan.adoption ? 1 : 0, skipped: plan.skipped.map(s => s.status + ' ' + s.invoiceNumber), problems: [...plan.problems, ...checks.problems], fingerprintMatches: checks.payments.find(p => plan.adoption && p.paymentId === plan.adoption.paymentId)?.fingerprintMatches ?? null };
  assert.equal(dry.problems.length, 0, 'dry run problems: ' + dry.problems.join(' | '));
  const confirmedOverdueBefore = Object.values(before).filter(r => calendarPresentation(r, today).confirmedOverdue).length;
  const applied = await backfill.applyCalendarEvidenceBackfill(plan, { organizationId, actorId, writers });
  const after = await stored();
  const confirmedOverdueAfter = Object.values(after).filter(r => calendarPresentation(r, today).confirmedOverdue).length;
  const linkRows = await CalendarEvidenceLink.find({ unlinkedAt: null }).lean(), identities = await CalendarEvidenceInvoice.countDocuments({}), sourcesActive = await CalendarEvidenceSource.countDocuments({ status: 'active' }), sourcesSuperseded = await CalendarEvidenceSource.countDocuments({ status: 'superseded' });
  const linkedIdentities = new Set(linkRows.map(l => String(l.invoiceId))).size;
  for (const row of rows) {
    const id = String(row._id), was = before[id], now = after[id];
    const entry = { id, dueDate: dayKey(row.dueDate), status: row.status, productionOutcome: null, newOutcomeBefore: null, newOutcomeAfter: null, links: linkRows.filter(l => String(l.paymentId) === id).length, sends: sends.filter(s => s.paymentId === id).map(s => s.text), byteIdentical: null, changedFields: [], same: false, label: null };
    try {
      const production = productionRule(was, today), pb = calendarPresentation(was, today), pa = calendarPresentation(now, today);
      entry.productionOutcome = label[production] || production; entry.newOutcomeBefore = label[pb.badge] || pb.badge; entry.newOutcomeAfter = label[pa.badge] || pa.badge;
      entry.byteIdentical = JSON.stringify(EJSON.serialize(was)) === JSON.stringify(EJSON.serialize(now));
      entry.changedFields = Object.keys({ ...was, ...now }).filter(k => JSON.stringify(EJSON.serialize({ v: was[k] })) !== JSON.stringify(EJSON.serialize({ v: now[k] })));
      const adoptedHere = applied.adoption && applied.adoption.paymentId === id && applied.adoption.outcome === 'adopted';
      if (entry.byteIdentical && production === pa.badge && entry.links >= 1) { entry.same = true; entry.label = 'SAME: ' + entry.productionOutcome + ' before and after; the row is byte-identical; ' + entry.links + ' original(s) linked beside it (plan §2: links never write a Payment)'; }
      else if (adoptedHere && pa.badge === 'bankWait' && entry.changedFields.every(k => ['paymentVerification', 'updatedAt'].includes(k)) && now.status === was.status && now.amount === was.amount) entry.label = 'INTENDED (plan §2 adoptLegacyVerificationMarker: exact id + company + naviOperation.invoiceSourceSha256 + unverified marker -> unconfirmed/missing_bank_period; plan §4 replay: exactly one row adopted, confirmed-overdue count down by one): production shows this past-due pending row as 期限超過; the changed code shows 銀行照合待ち; only paymentVerification (and updatedAt) changed, status/amount/dates kept';
      else entry.label = 'UNEXPLAINED: production ' + entry.productionOutcome + ' vs ' + entry.newOutcomeAfter + ' (byteIdentical ' + entry.byteIdentical + ', changed ' + entry.changedFields.join(',') + ', links ' + entry.links + ')';
    } catch (error) { entry.error = String(error?.stack || error?.message || error).replace(/\s+/g, ' ').slice(0, 600); entry.label = 'UNEXPLAINED: the harness could not run this row'; problems.push(id + ': ' + entry.error); }
    results.push(entry);
  }
  const failed = results.filter(r => r.error).length, same = results.filter(r => r.same && !r.error).length, intended = results.filter(r => !r.error && !r.same && String(r.label).startsWith('INTENDED')).length, unexplained = results.length - failed - same - intended;
  const paidIdentical = results.filter(r => r.status === 'paid' && r.byteIdentical).length;
  let retainedFiles = 0; try { for (const company of await readdir(path.join(process.env.OMF_DATA_DIR, 'calendar-evidence'))) retainedFiles += (await readdir(path.join(process.env.OMF_DATA_DIR, 'calendar-evidence', company))).length; } catch { /* none */ }
  let database = { executed: false, ownedProcess: false };
  try { const stats = await mongoose.connection.db.stats(); database = { executed: stats.objects > 0, ownedProcess: Number(mongoose.connection.port) === Number(mongo.instanceInfo?.port || 0) && mongoose.connection.host === '127.0.0.1', name: mongoose.connection.name, objects: stats.objects, collections: stats.collections }; } catch { /* reported as not executed */ }
  const expectations = { links: 13, linkedIdentities: 12, adoption: 'adopted', paidIdentical: 12, confirmedOverdueDrop: 1 };
  const observed = { links: linkRows.length, linkedIdentities, identities, sourcesActive, sourcesSuperseded, adoption: applied.adoption?.outcome || null, paidIdentical, confirmedOverdueBefore, confirmedOverdueAfter, confirmedOverdueDrop: confirmedOverdueBefore - confirmedOverdueAfter, retainedFiles, failures: applied.failures.length };
  const expectationsMet = observed.links === expectations.links && observed.linkedIdentities === expectations.linkedIdentities && observed.adoption === expectations.adoption && observed.paidIdentical === expectations.paidIdentical && observed.confirmedOverdueDrop === expectations.confirmedOverdueDrop && observed.failures === 0;
  if (!expectationsMet) problems.push('plan §4 replay expectations not met: expected ' + JSON.stringify(expectations) + ' observed ' + JSON.stringify(observed));
  const result = { capturedAt: new Date().toISOString(), input: INPUT, privateManifest: manifestPath, revision, source: exported.sourceSha256 || null, readAt: exported.at || null, entry: 'calendarPresentation (shared/finance-calendar-verification.mjs) over each row; planCalendarEvidenceBackfill + checkCalendarEvidencePayments (dry run, read-only) then applyCalendarEvidenceBackfill (scripts/calendar-evidence-backfill.ts) in-process with every writer intercepted; calendarPresentation again', exported: rows.length, loaded: Object.keys(before).length, replayed: results.length - failed, same, intended, unexplained, failed, sends: { counts, intercepted: Object.keys(counts), calls: sends.map(s => s.text) }, dryRun: dry, applied: { identities: applied.identities.map(i => ({ invoiceNumber: i.invoiceNumber, evidenceId: i.evidenceId, sources: i.sources })), links: applied.links, adoption: applied.adoption, failures: applied.failures, writes: applied.writes }, expectations, observed, companions: { organizations: organizations.length, adjustment: 'the organization loaded as exported plus a synthetic name and slug where the export omits them' }, database, problems, rows: results };
  if (OUT) await writeFile(OUT, JSON.stringify(result, null, 2) + '\n');
  const pass = rows.length > 0 && results.length === rows.length && failed === 0 && unexplained === 0 && expectationsMet && database.ownedProcess;
  console.log(JSON.stringify({ __replay__: { pass, database, message: rows.length + ' exported, ' + results.length + ' loaded, ' + (results.length - failed) + ' replayed on ' + revision.slice(0, 8) + ': ' + same + ' same, ' + intended + ' INTENDED different, ' + unexplained + ' UNEXPLAINED, ' + failed + ' not run; backfill dry run ' + dry.identities + ' identities / ' + dry.links + ' links / ' + dry.adoption + ' adoption, apply ' + observed.links + ' links over ' + observed.linkedIdentities + ' identities, adoption ' + observed.adoption + ', paid rows byte-identical ' + paidIdentical + ', confirmed-overdue ' + confirmedOverdueBefore + ' -> ' + confirmedOverdueAfter + '; sends intercepted ' + JSON.stringify(counts) + '; database ' + (database.executed ? 'executed ' + database.objects + ' objects in owned ' + database.name : 'no database work') + (OUT ? '; result ' + OUT : '') + (problems.length ? ' — ' + problems.join(' | ').slice(0, 800) : '') } }));
} finally {
  await import(u('server/services/tokenBlacklistService.ts')).then(m => (m.stopCleanup || m.default?.stopCleanup)?.()).catch(() => {});
  await mongoose.disconnect(); await mongo.stop();
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
`;

export default {
  name: 'omf-calendar-evidence-replay',
  covers: INPUT ? ['server/services/companyCalendarEvidenceService.ts', 'server/models/CalendarEvidence.ts', 'server/models/Payment.ts', 'shared/finance-calendar-verification.mjs', 'scripts/calendar-evidence-backfill.ts'] : [],
  async run() {
    if (!INPUT) return { pass: true, message: 'no replay input (REPLAY_INPUT unset): nothing exercised, no coverage claimed' };
    if (!OUT) return { pass: false, message: 'REPLAY_OUT required' };
    const started = Date.now();
    const cache = path.join(REPO_ROOT, '.cache'); await mkdir(cache, { recursive: true });
    const harness = path.join(cache, 'omf-calendar-evidence-replay-' + process.pid + '.mts');
    await writeFile(harness, CHILD, { flag: 'wx' });
    try {
      const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', harness, REPO_ROOT, INPUT, OUT], { cwd: REPO_ROOT, windowsHide: true, timeout: 1080000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '' } }).catch(error => { throw new Error(String(error.stderr || error.stdout || error.message).slice(-3000)); });
      const line = stdout.split(/\r?\n/).find(l => l.startsWith('{') && l.includes('__replay__'));
      if (!line) throw new Error('the replay harness produced no result: ' + String(stderr || stdout).slice(-1500));
      const result = JSON.parse(line).__replay__;
      const database = result.database || {};
      return { pass: result.pass, databaseCoverage: { executed: database.executed === true, ownedProcess: database.ownedProcess === true }, message: result.message + ' in ' + Math.round((Date.now() - started) / 1000) + 's' };
    } catch (error) { return { pass: false, message: 'Replay failed (harness could not run or the result is incomplete): ' + String(error?.message || error).replace(/\s+/g, ' ').slice(-3000) }; }
    finally { await unlink(harness).catch(() => {}); }
  }
};
