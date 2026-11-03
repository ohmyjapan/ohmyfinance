// Replay of the real production role rows (plan omf-role-writes-20261101 §4 replay; house rules 5 and 7) on an owned throwaway
// MongoDB through the hub verifier only:
//   REPLAY_INPUT=<export> REPLAY_OUT=<result> node scripts/zoomer-verify.mjs --run-fixture scripts/zoomer-fixtures/omf-role-writes-replay.mjs --cwd <tree>
// The export (read by path at run time, never copied into this public repository) carries every `organizations` row with its saved
// members, every `bankclassifications` row with its registration actor and every `financeimportcompanies` row. Each row is loaded
// verbatim (ids and dates restored) into an empty memory MongoDB; a synthetic user document with each saved member's id and a random
// password lets the harness sign that member's company token (the export holds no credentials). The entry is the CHANGED built
// server itself: per saved member a read, the viewerReadOnly decision (an unrouted POST: the middleware answers before any handler)
// and requireLedgerRegistrar through the company-commit route with an empty body (the writer's first line refuses an empty body, so
// a registrar role answers 400 and nothing is written); per bank classification row its registration actor presses the register route
// with an empty body (C4 gates it; the service's confirm check answers 400 before any read or write). Per row: the outcome production
// recorded, the changed code's outcome, the recorded sends (plan.replay.sends is empty: this change adds no outbound call; model and
// mail keys are sentinels) and `same`. Ids, roles, states and dates only: no names or text leave the private input. With
// REPLAY_INPUT unset this fixture exports `covers: []`, passes with the note "no replay input" and grants NO coverage of the entry it
// did not exercise.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const timeoutMs = 1800000;
const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const INPUT = process.env.REPLAY_INPUT || '';
const OUT = process.env.REPLAY_OUT || '';
const BUILT = existsSync(path.join(REPO_ROOT, '.output', 'server', 'index.mjs'));

const CHILD = String.raw`
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { MongoMemoryServer } = require('mongodb-memory-server'), { MongoClient, ObjectId } = require('mongodb'), jwt = require('jsonwebtoken'), bcrypt = require('bcryptjs');
const ROOT = process.argv[2], INPUT = process.argv[3], OUT = process.argv[4];
const VIEWER_MESSAGE = '閲覧のみのメンバーは変更できません（閲覧だけができます）。', REGISTRAR_MESSAGE = '帳簿への登録（仕訳の登録）は経理担当以上のメンバーだけができます。';
const REGISTRARS = ['owner', 'admin', 'accountant'];
const pause = ms => new Promise(r => setTimeout(r, ms));
const hex24 = /^[a-f0-9]{24}$/i, iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
// The export is plain JSON: 24-hex ids and ISO dates come back as ObjectId and Date (hash fields stay strings).
const revive = (v, key = '') => Array.isArray(v) ? v.map(x => revive(x)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x, k)])) : typeof v === 'string' && hex24.test(v) && !/hash/i.test(key) ? new ObjectId(v) : typeof v === 'string' && iso.test(v) ? new Date(v) : v;
const exported = JSON.parse(await readFile(INPUT, 'utf8')), collections = exported.collections || {};
const organizations = revive(collections.organizations || []), classifications = revive(collections.bankclassifications || []), importCompanies = revive(collections.financeimportcompanies || []);
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-role-writes-replay-'));
const binary = path.resolve(ROOT, '..', 'node_modules', '.cache', 'mongodb-memory-server', 'mongod-x64-win32-8.2.1.exe');
const dbName = 'role_writes_replay_isolated';
const mongo = await MongoMemoryServer.create({ binary: existsSync(binary) ? { systemBinary: binary, version: '8.2.1' } : undefined, instance: { dbName, launchTimeout: 300000 } });
const uri = mongo.getUri(dbName);
let revision = 'unknown'; try { revision = (await promisify(execFile)('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { windowsHide: true })).stdout.trim(); } catch { /* not a checkout */ }
let child = null, client = null, logs = '';
const rows = [], problems = [], sends = [];
try {
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, 'the replay must run on its own memory server');
  client = await MongoClient.connect(uri); const db = client.db(dbName); assert.equal(db.databaseName, dbName);
  const col = name => db.collection(name);
  // Rows exactly as exported (a synthetic name and slug only where the export omits them: the Organization schema requires both).
  for (const org of organizations) await col('organizations').insertOne({ name: 'Replay company ' + String(org._id).slice(-4), slug: 'replay-' + String(org._id).slice(-6), type: 'business', ...org, isActive: org.isActive !== false, members: (org.members || []).map(m => ({ joinedAt: new Date(0), ...m })) });
  // The export projects each classification row to _id/ownerId/organizationId/registration. Two unique indexes the service builds on
  // its first use (ownerId+bankRowId, reservedTransactionId) need a distinct value per row — production rows carry their own, the
  // projection omits them — so each loaded row gets a unique placeholder for exactly those two fields (declared in the result); the
  // gate under replay (requireLedgerRegistrar before registerBankClassification) reads neither.
  const fillers = ['bankRowId', 'reservedTransactionId'].filter(k => classifications.some(r => r[k] === undefined));
  if (classifications.length) await col('financebankclassifications').insertMany(classifications.map(r => ({ ...r, ...(r.bankRowId === undefined ? { bankRowId: new ObjectId() } : {}), ...(r.reservedTransactionId === undefined ? { reservedTransactionId: new ObjectId() } : {}) })));
  if (importCompanies.length) await col('financeimportcompanies').insertMany(importCompanies.map(r => ({ ...r })));
  const roleOf = (userId, organizationId) => { const org = organizations.find(o => String(o._id) === String(organizationId)); if (!org || org.isActive === false) return null; return org.members?.find(m => String(m.userId) === String(userId))?.role ?? null; };
  // One synthetic user per saved actor id (the export has no credentials); a random password hash that nothing here uses.
  const actorIds = new Set();
  for (const org of organizations) for (const m of org.members || []) actorIds.add(String(m.userId));
  for (const r of classifications) if (r.registration?.by) actorIds.add(String(r.registration.by));
  for (const r of importCompanies) for (const k of ['ownerId', 'actorId', 'createdBy']) if (r[k]) actorIds.add(String(r[k]));
  const passwordHash = await bcrypt.hash(randomBytes(24).toString('hex'), 4), at = new Date();
  for (const id of actorIds) await col('users').insertOne({ _id: new ObjectId(id), email: 'replay-' + id.slice(-8) + '@example.invalid', password: passwordHash, name: 'Replay member ' + id.slice(-4), isActive: true, isEmailVerified: true, loginAttempts: 0, twoFactorEnabled: false, createdAt: at, updatedAt: at });
  const dump = async () => JSON.stringify(await Promise.all(['organizations', 'financebankclassifications', 'financeimportcompanies', 'transactions', 'financeentries', 'users'].map(n => col(n).find().sort({ _id: 1 }).toArray())));
  const before = await dump();
  // The CHANGED built server on this owned database.
  const listener = net.createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r)); const port = listener.address().port; await new Promise(r => listener.close(r));
  const origin = 'http://127.0.0.1:' + port, secret = randomBytes(32).toString('hex');
  await mkdir(path.join(temp, 'data'), { recursive: true });
  const env = { ...process.env, MONGO_URI: uri, MONGODB_URI: uri, NUXT_MONGO_URI: uri, OMF_DATA_DIR: path.join(temp, 'data'), JWT_SECRET: secret, NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port) };
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_SETUP_TOKEN', 'SLACK_BOT_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OMF_GMAIL_CLIENT_ID', 'OMF_GMAIL_CLIENT_SECRET', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) env[key] = 'no-model-or-business-send';
  child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: ROOT, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] }); child.closed = new Promise(r => child.once('exit', r));
  for (const s of [child.stdout, child.stderr]) { s.setEncoding('utf8'); s.on('data', v => { logs = (logs + v).slice(-40000); }); }
  let healthy = false; for (let i = 0; i < 600 && !healthy; i++) { try { const d = await (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) })).json(); if (d.database?.connected) { assert.equal(d.database.name, dbName); healthy = true; } } catch {} if (!healthy) await pause(200); }
  assert.ok(healthy, 'owned server unavailable: ' + logs.slice(-1500));
  const api = async (route, token, method = 'GET', body) => { const r = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) }), raw = await r.text(); let data; try { data = JSON.parse(raw); } catch {} return { status: r.status, data, raw }; };
  const tokenFor = (userId, organizationId, role) => jwt.sign({ userId: String(userId), email: 'replay-' + String(userId).slice(-8) + '@example.invalid', organizationId: String(organizationId), role: role || 'member', type: 'access', jti: randomUUID() }, secret, { expiresIn: '1h' });
  const messageOf = r => String(r.data?.data?.message || r.data?.message || r.data?.statusMessage || '');
  const describe = r => r.status + (r.data?.data?.code ? ' ' + r.data.data.code : '') + (messageOf(r) ? ' ' + messageOf(r).slice(0, 60) : '');
  // What the changed code must answer per role (plan §2 C2/C3: viewer 403 VIEWER_READ_ONLY on every non-read request; member 403
  // with the registrar message at the three registrations; owner/admin/accountant reach the writer, whose first check answers 400).
  // The unrouted POST isolates the middleware: a viewer is refused by it; any other role passes through it and is answered by whatever
  // sits behind (the page renderer answers an unmatched /api path), so "passed" means not refused with VIEWER_READ_ONLY.
  const refusedByMiddleware = r => r.status === 403 && r.data?.data?.code === 'VIEWER_READ_ONLY';
  const expectedWrite = role => role === 'viewer' ? { status: 403, code: 'VIEWER_READ_ONLY' } : { passed: true };
  const expectedRegistrar = (role, open) => role === 'viewer' ? { status: 403, message: VIEWER_MESSAGE } : role === 'member' ? { status: 403, message: REGISTRAR_MESSAGE } : REGISTRARS.includes(role) ? { status: 400, message: open } : { status: 403 };
  const matches = (r, e) => r.status === e.status && (!e.code || r.data?.data?.code === e.code) && (!e.message || messageOf(r) === e.message);
  const probeMember = async (userId, organizationId, role) => {
    const token = tokenFor(userId, organizationId, role);
    const read = await api('/api/transactions', token), write = await api('/api/role-replay-no-such-route', token, 'POST', {}), registrar = await api('/api/finance/imports/000000000000000000000000/company-commit', token, 'POST', {});
    const expected = { read: role ? 200 : 403, write: expectedWrite(role), registrar: expectedRegistrar(role, 'Select rows to review') };
    const okRead = read.status === expected.read, okWrite = expected.write.passed ? !refusedByMiddleware(write) : matches(write, expected.write), okRegistrar = matches(registrar, expected.registrar);
    return { userId: String(userId), role, read: read.status, write: (refusedByMiddleware(write) ? 'refused by viewerReadOnly ' : 'passed the middleware, answered behind it ') + describe(write), registrar: describe(registrar), asPlanned: okRead && okWrite && okRegistrar, changed: role === 'viewer' || role === 'member' };
  };
  // 1 organizations: every saved member.
  for (const org of organizations) {
    const entry = { collection: 'organizations', id: String(org._id), productionOutcome: null, newOutcome: null, sends: [], same: false, label: null, members: [] };
    try {
      for (const m of org.members || []) entry.members.push(await probeMember(m.userId, org._id, m.role || 'member'));
      const roles = entry.members.map(x => x.role);
      entry.productionOutcome = 'members ' + JSON.stringify(roles) + ': every role reads and writes and registers 仕訳 (4ad3703 has no role check: companyMembership admits every role)';
      entry.newOutcome = entry.members.map(x => x.role + ': read ' + x.read + ', write ' + x.write + ', registration ' + x.registrar).join(' ; ');
      const planned = entry.members.every(x => x.asPlanned), changed = entry.members.filter(x => x.changed);
      if (planned && !changed.length) { entry.same = true; entry.label = 'SAME: every saved member is ' + roles.join('/') + '; reads, writes and registrations answer as before (the registrar role reaches the writer, whose empty-body check answers 400 with nothing written)'; }
      else if (planned) entry.label = 'INTENDED (plan §2 C2 viewerReadOnly / C3 requireLedgerRegistrar, §4 R2/R5): ' + changed.map(x => x.role + ' ' + x.userId.slice(-6) + (x.role === 'viewer' ? ' loses every write (403 VIEWER_READ_ONLY)' : ' loses 仕訳 registration (403 registrar message)')).join('; ');
      else entry.label = 'UNEXPLAINED: a member answered outside the plan table: ' + JSON.stringify(entry.members.filter(x => !x.asPlanned));
    } catch (error) { entry.error = String(error?.stack || error?.message || error).replace(/\s+/g, ' ').slice(0, 600); entry.label = 'UNEXPLAINED: the harness could not run this row'; problems.push(entry.id + ': ' + entry.error); }
    rows.push(entry);
  }
  // 2 bank classifications: the saved registration actor presses the register route with an empty body (C4 before the service).
  for (const r of classifications) {
    const by = r.registration?.by, role = by ? roleOf(by, r.organizationId) : null;
    const entry = { collection: 'bankclassifications', id: String(r._id), organizationId: String(r.organizationId), actor: by ? String(by) : null, actorRoleToday: role, registeredAt: r.registration?.at instanceof Date ? r.registration.at.toISOString() : r.registration?.at ?? null, productionOutcome: null, newOutcome: null, sends: [], same: false, label: null };
    try {
      entry.productionOutcome = 'registration ' + (r.registration?.state || 'none') + ' by ' + (by ? String(by).slice(-6) : 'nobody') + (role ? ' (today ' + role + ')' : ' (today not a member)');
      if (!by) { entry.newOutcome = 'no registration actor on the row: nothing to drive'; entry.same = true; entry.label = 'SAME: unregistered row, no actor, no registration path exercised'; rows.push(entry); continue; }
      const res = await api('/api/finance-payments/bank-classifications/' + String(r._id) + '/register', tokenFor(by, r.organizationId, role), 'POST', {});
      const expected = expectedRegistrar(role, '「確認して取引へ登録」の確認操作を確認してください。');
      entry.newOutcome = 'register route for ' + String(by).slice(-6) + ' as ' + (role || 'non-member') + ': ' + describe(res);
      if (!matches(res, expected)) entry.label = 'UNEXPLAINED: expected ' + JSON.stringify(expected) + ' got ' + describe(res);
      else if (REGISTRARS.includes(role)) { entry.same = true; entry.label = 'SAME: the actor who registered this row is ' + role + ' today and still reaches the register service (its confirm check answers 400 on the empty body; nothing written)'; }
      else if (role === 'member' || role === 'viewer') entry.label = 'INTENDED (plan §2 ' + (role === 'viewer' ? 'C2 viewerReadOnly' : 'C4 requireLedgerRegistrar before registerBankClassification') + '): the actor is ' + role + ' today and is now refused 403';
      else entry.label = 'SAME: the actor is no longer a member; the route\'s own membership 403 decided before and decides now';
    } catch (error) { entry.error = String(error?.stack || error?.message || error).replace(/\s+/g, ' ').slice(0, 600); entry.label = 'UNEXPLAINED: the harness could not run this row'; problems.push(entry.id + ': ' + entry.error); }
    rows.push(entry);
  }
  // 3 import-company bindings: the owner who posted the statement presses company-commit with an empty body (C5 after calendarCompany).
  for (const r of importCompanies) {
    const by = r.ownerId, role = by ? roleOf(by, r.organizationId) : null;
    const entry = { collection: 'financeimportcompanies', id: String(r._id), organizationId: String(r.organizationId), actor: by ? String(by) : null, actorRoleToday: role, productionOutcome: 'statement ' + String(r.importId || '') + ' bound and posted by ' + (by ? String(by).slice(-6) : 'nobody') + (role ? ' (today ' + role + ')' : ' (today not a member)'), newOutcome: null, sends: [], same: false, label: null };
    try {
      if (!by) { entry.newOutcome = 'no owner on the row'; entry.label = 'UNEXPLAINED: no actor to drive'; rows.push(entry); continue; }
      const res = await api('/api/finance/imports/' + String(r.importId || '000000000000000000000000') + '/company-commit', tokenFor(by, r.organizationId, role), 'POST', {});
      const expected = expectedRegistrar(role, 'Select rows to review');
      entry.newOutcome = 'company-commit for ' + String(by).slice(-6) + ' as ' + (role || 'non-member') + ': ' + describe(res);
      if (!matches(res, expected)) entry.label = 'UNEXPLAINED: expected ' + JSON.stringify(expected) + ' got ' + describe(res);
      else if (REGISTRARS.includes(role)) { entry.same = true; entry.label = 'SAME: the posting owner is ' + role + ' today and still reaches commitCompanyImport (400 on the empty body; nothing written)'; }
      else if (role === 'member' || role === 'viewer') entry.label = 'INTENDED (plan §2 ' + (role === 'viewer' ? 'C2' : 'C5') + '): the actor is ' + role + ' today and is now refused 403';
      else entry.label = 'SAME: the actor is no longer a member; the route\'s own membership 403 decides as before';
    } catch (error) { entry.error = String(error?.stack || error?.message || error).replace(/\s+/g, ' ').slice(0, 600); entry.label = 'UNEXPLAINED: the harness could not run this row'; problems.push(entry.id + ': ' + entry.error); }
    rows.push(entry);
  }
  const after = await dump();
  const untouched = before === after; if (!untouched) problems.push('the replay probes changed a loaded collection (organizations / classifications / bindings / transactions / entries / users)');
  const exportedCount = organizations.length + classifications.length + importCompanies.length;
  const failed = rows.filter(r => r.error).length, same = rows.filter(r => r.same && !r.error).length, intended = rows.filter(r => !r.error && !r.same && String(r.label).startsWith('INTENDED')).length, unexplained = rows.length - failed - same - intended;
  const stats = await db.stats();
  const database = { executed: stats.objects > 0, ownedProcess: true, name: dbName, objects: stats.objects, collections: stats.collections };
  const serverLogTail = (failed || unexplained) ? logs.slice(-2500) : null;
  const result = { capturedAt: new Date().toISOString(), input: INPUT, revision, serverLogTail, fillers: fillers.length ? 'unique placeholder per loaded bankclassifications row for ' + fillers.join(' and ') + ' (omitted by the export projection; read only by the unique indexes)' : null, source: exported.source || null, readAt: exported.readAt || null, entry: 'the changed built server: per saved member GET /api/transactions, an unrouted POST (viewerReadOnly decides before any handler) and POST company-commit with an empty body (requireLedgerRegistrar after calendarCompany; the writer refuses the empty body first); per bankclassifications row POST …/register with an empty body by its registration actor (requireLedgerRegistrar before registerBankClassification; the confirm check refuses first); per financeimportcompanies row POST company-commit by its owner', sends: 'plan.replay.sends is empty — no outbound call exists on this path; model and mail keys were sentinels; nothing left the process', exported: { organizations: organizations.length, bankclassifications: classifications.length, financeimportcompanies: importCompanies.length, total: exportedCount }, loaded: exportedCount, replayed: rows.length - failed, same, intended, unexplained, failed, loadedCollectionsUntouched: untouched, problems, rows };
  if (OUT) await writeFile(OUT, JSON.stringify(result, null, 2) + '\n');
  const pass = exportedCount > 0 && rows.length === exportedCount && failed === 0 && unexplained === 0 && untouched && database.executed;
  console.log(JSON.stringify({ __replay__: { pass, database, message: exportedCount + ' exported (' + organizations.length + ' organizations, ' + classifications.length + ' bank classifications, ' + importCompanies.length + ' import bindings), ' + rows.length + ' loaded, ' + (rows.length - failed) + ' replayed on ' + revision.slice(0, 8) + ': ' + same + ' same, ' + intended + ' INTENDED different, ' + unexplained + ' UNEXPLAINED, ' + failed + ' not run; loaded collections ' + (untouched ? 'byte-identical after the probes' : 'CHANGED') + '; sends: none (plan.replay.sends empty)' + (fillers.length ? '; loader fillers: unique ' + fillers.join('/') + ' per bank row (export projection omits them)' : '') + (problems.length ? '; problems: ' + problems.slice(0, 3).join(' | ') : '') } }));
} finally {
  if (child) { child.kill(); await child.closed; }
  if (client) await client.close().catch(() => {});
  await mongo.stop();
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
`;

export default {
  name: 'omf-role-writes-replay',
  covers: INPUT && BUILT ? ['server/middleware/viewerReadOnly.ts', 'server/utils/ledgerRegistrarAccess.ts', 'server/utils/calendarAccess.ts', 'server/api/finance-payments/[...path].ts', 'server/api/finance/[...path].ts'] : [],
  async run() {
    if (!INPUT) return { pass: true, message: 'no replay input (REPLAY_INPUT unset): nothing exercised, no coverage claimed' };
    if (!OUT) return { pass: false, message: 'REPLAY_OUT required' };
    if (!BUILT) return { pass: false, message: '.output/server/index.mjs is missing (run nuxt build first): the replay drives the built server and was not run' };
    const started = Date.now();
    const cache = path.join(REPO_ROOT, '.cache'); await mkdir(cache, { recursive: true });
    const harness = path.join(cache, 'omf-role-writes-replay-' + process.pid + '.mjs');
    await writeFile(harness, CHILD, { flag: 'wx' });
    try {
      const env = { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '' };
      const { stdout, stderr } = await promisify(execFile)(process.execPath, [harness, REPO_ROOT, INPUT, OUT], { cwd: REPO_ROOT, windowsHide: true, timeout: 1500000, maxBuffer: 64 * 1024 * 1024, env }).catch(error => { throw new Error(String(error.stderr || error.stdout || error.message).slice(-3000)); });
      const line = stdout.split(/\r?\n/).find(l => l.startsWith('{') && l.includes('__replay__'));
      if (!line) throw new Error('the replay harness produced no result: ' + String(stderr || stdout).slice(-1500));
      const result = JSON.parse(line).__replay__, database = result.database || {};
      return { pass: result.pass, databaseCoverage: { executed: database.executed === true, ownedProcess: database.ownedProcess === true }, message: result.message + ' in ' + Math.round((Date.now() - started) / 1000) + 's' };
    } catch (error) { return { pass: false, message: 'Replay failed (harness could not run or the result is incomplete): ' + String(error?.message || error).replace(/\s+/g, ' ').slice(-3000) }; }
    finally { await unlink(harness).catch(() => {}); }
  }
};
