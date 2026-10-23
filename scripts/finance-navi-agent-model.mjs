// Navi product-model acceptance corpus runner (docs/navi-agent-model-evaluation.md).
// Importing this module does nothing. Run directly without arguments it prints the declared population and exits: no application,
// model, provider or network call. Every explicit mode is reached only through the fixture (hub verifier fixture mode) with
// OMF_NAVI_AGENT_MODEL_MODE plus a declared nonempty case list and a new owned output directory:
//   prepare  — owned MongoDB + built application + synthetic records, the resolved/frozen requests and baseline checks; zero model.
//   selftest — prepare plus a scripted synthetic worker turn per case through the native worker routes (zero model) and its checks.
//   manual   — the paid corpus: the actual TeachingWorker.cycle() (its own claim, capability report, 20 s heartbeat, result and
//              failure reporting), the unchanged interpreter/native CLI/actions MCP, and the configured accountant model.
//   lifecycle — zero model, no case list: owned startup/cleanup controls (normal start, faults during and after each startup stage,
//              a failed cleanup, and a deliberately lost partial reference that must be detected).
// The runtime is owned and disposable: random loopback ports, its own mongod and database, OMF_DATA_DIR, synthetic Vault and
// inference directory, the existing OMF_SYNC_SCHEDULE_MS=0 scheduler switch, and an allowlisted application environment (no
// ambient credential, database address or provider key). Only the native accountant inference and the configured public
// company/accounting research of company jobs leave it. No collector, research, workflow or export worker is started.
// The runtime object is created by the caller and filled as each resource starts, so a failure at any startup stage (including a
// mongod whose start has not finished) still reaches cleanup; cleanup verifies each owned process exited through its own handle
// before it deletes the checked temp directory, keeps the primary error, and a failed cleanup step is never an overall pass.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { population, selectCases, denominators, resolveRequest, verifyDeclaration, canonicalJson, sha256, plainDocument, diffSnapshots, gradeEffects, check, retainedSource, retainedDocuments, overallPass, EVALUATOR_ONLY, DECLARED_TEXT_SHA256, COHORT, SUPPLEMENTAL_COHORT, supplementalPopulation, verifySupplementalDeclaration, SUPPLEMENTAL_EVALUATOR_ONLY, SUPPLEMENTAL_TEXT_SHA256, SUPPLEMENTAL_RUBRIC_SHA256 } from './finance-navi-agent-model-cases.mjs';
import { companyCases, FOREIGN_MARKERS } from './finance-navi-agent-model-company-cases.mjs';
import { ownerCases } from './finance-navi-agent-model-owner-cases.mjs';
import { supplementalCases } from './finance-navi-agent-model-supplemental.mjs';
import { installSpawnObserver, openHttpObserver, redact, AUTH_KEY } from './finance-navi-agent-model-observer.mjs';
import { validNativeCliToken } from '../shared/finance-native-cli-auth.mjs';

export const HARNESS_FILES = Object.freeze(['scripts/finance-navi-agent-model.mjs', 'scripts/finance-navi-agent-model-cases.mjs', 'scripts/finance-navi-agent-model-company-cases.mjs', 'scripts/finance-navi-agent-model-owner-cases.mjs', 'scripts/finance-navi-agent-model-supplemental.mjs', 'scripts/finance-navi-agent-model-observer.mjs', 'scripts/finance-navi-agent-model-observer.test.mjs', 'scripts/zoomer-fixtures/omf-navi-agent-model.mjs', 'docs/navi-agent-model-evaluation.md']);
export const MODES = Object.freeze(['prepare', 'selftest', 'manual', 'lifecycle']);
// Manual-only authentication sources: the unchanged default native login, the connected one-key observer overlay, or the owned
// worker Vault (nativeOAuthToken delivered by the product's own shared/finance-native-cli-auth.mjs; the observer adds nothing).
export const AUTH_MODES = Object.freeze(['default', 'connected', 'vault']);
// Selftest variants: 'ideal' (scripted correct turns), 'defects' (scripted WRONG turns that must flip their named oracle) and
// 'p02-missing' (the scripted P01 source publishes no T-number, so P02 exercises its missing-prerequisite branch).
export const SELFTEST_VARIANTS = Object.freeze(['ideal', 'defects', 'p02-missing']);
const ENV = Object.freeze({ mode: 'OMF_NAVI_AGENT_MODEL_MODE', cases: 'OMF_NAVI_AGENT_MODEL_CASES', out: 'OMF_NAVI_AGENT_MODEL_OUT', cli: 'OMF_NAVI_AGENT_MODEL_CLI', frozen: 'OMF_NAVI_AGENT_MODEL_FROZEN', attempt: 'OMF_NAVI_AGENT_MODEL_ATTEMPT', reason: 'OMF_NAVI_AGENT_MODEL_REASON', batch: 'OMF_NAVI_AGENT_MODEL_BATCH', claims: 'OMF_NAVI_AGENT_MODEL_CLAIMS', auth: 'OMF_NAVI_AGENT_MODEL_AUTH', token: 'OMF_NAVI_AGENT_MODEL_CONNECTED_OAUTH', configDir: 'OMF_NAVI_AGENT_MODEL_CONFIG_DIR', slot: 'OMF_NAVI_AGENT_MODEL_AUTH_SLOT', variant: 'OMF_NAVI_AGENT_MODEL_SELFTEST_VARIANT' });
export const ENVIRONMENT = ENV;
const EXCLUDED = new Set(['financecompanyassistants', 'financeassistants', 'financechats', 'financechatagents', 'financecompanyconversationarchives', 'financeownerconversationarchives', 'financecompanypublicsources', 'users', 'auditlogs', 'usedauthchallenges', 'authverificationattempts', 'sessions']);
const APP_ENV_KEYS = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'APPDATA', 'PROGRAMDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'CommonProgramFiles', 'ComSpec', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS'];
const SETUP_READY_MS = 300000, CYCLE_BOUND_MS = 1200000, TOKEN_REFRESH_MS = 600000, PASSWORD = 'Synthetic-password-Only1!';
const pause = ms => new Promise(r => setTimeout(r, ms));
const rid = () => randomBytes(16).toString('hex');
class SetupError extends Error { constructor(message) { super(message); this.layer = 'setup'; } }

export function populationReport() {
  const counts = verifyDeclaration(), extra = verifySupplementalDeclaration();
  const view = r => ({ id: r.id, cohort: r.cohort, realm: r.realm, page: r.page, nativePage: r.nativePage, transport: r.transport, family: r.family, placeholders: r.placeholders, textSha256: r.textSha256 });
  return { mode: 'population', declared: counts, cases: population.map(view), supplemental: supplementalPopulation.map(view), supplementalDeclared: { ...extra, countsTowardOriginal62: false, selection: 'explicit additional attempt with a named reason, in its own batch' }, modelCalls: 0, appCalls: 0, providerCalls: 0, note: 'Declared population only. Explicit modes run only through scripts/zoomer-fixtures/omf-navi-agent-model.mjs with OMF_NAVI_AGENT_MODEL_MODE and a declared case list.' };
}

// Pure validation of an explicit run. Throws a named error before anything starts; never reads a credential value.
export function parsePlan(env = {}) {
  const mode = env[ENV.mode];
  if (!MODES.includes(mode)) throw Error('plan:mode-required ' + MODES.join('|'));
  const attempt = env[ENV.attempt] || 'initial';
  if (!['initial', 'additional'].includes(attempt)) throw Error('plan:attempt-kind');
  const reason = env[ENV.reason] || null;
  if (attempt === 'additional' && (!reason || reason.trim().length < 8)) throw Error('plan:additional-attempt-needs-named-reason');
  const outputDirectory = () => { const out = env[ENV.out]; if (typeof out !== 'string' || !path.isAbsolute(out)) throw Error('plan:absolute-output-directory-required'); if (fs.existsSync(out) && fs.readdirSync(out).length) throw Error('plan:output-directory-must-be-new'); return out; };
  // lifecycle: owned startup/cleanup controls only; no case, model, CLI, frozen manifest, auth or variant.
  if (mode === 'lifecycle') {
    if (env[ENV.cases]) throw Error('plan:lifecycle-takes-no-case-list');
    if (attempt !== 'initial' || env[ENV.cli] || env[ENV.frozen] || env[ENV.variant] || env[ENV.claims] || (env[ENV.auth] && env[ENV.auth] !== 'default')) throw Error('plan:lifecycle-takes-only-an-output-directory');
    return { mode, attempt, reason: null, rows: [], out: outputDirectory(), batch: 'lifecycle', claims: null, auth: 'default', cli: null, frozen: null, variant: null };
  }
  const rows = selectCases(env[ENV.cases], { attempt });
  const out = outputDirectory();
  const batch = env[ENV.batch] || (mode === 'manual' ? null : mode);
  if (!batch || !/^[A-Za-z0-9._-]{1,64}$/.test(batch)) throw Error('plan:batch-label-required');
  const plan = { mode, attempt, reason, rows, out, batch, claims: env[ENV.claims] || null, auth: env[ENV.auth] || 'default', cli: env[ENV.cli] || null, frozen: env[ENV.frozen] || null, variant: env[ENV.variant] || 'ideal' };
  // selftest 'defects': every selected case runs its scripted WRONG native turn, which must flip its named oracle.
  if (!SELFTEST_VARIANTS.includes(plan.variant) || (plan.variant !== 'ideal' && mode !== 'selftest')) throw Error('plan:selftest-variant ' + SELFTEST_VARIANTS.join('|') + ' (selftest only)');
  if (plan.variant === 'defects') { const missing = rows.filter(r => !designFor(r)?.defect).map(r => r.id); if (missing.length) throw Error('plan:defect-not-defined ' + missing.join(',')); }
  if (plan.variant === 'p02-missing' && !['P01', 'P02'].every(id => rows.some(r => r.id === id))) throw Error('plan:p02-missing-needs-P01-and-P02');
  if (plan.claims && !path.isAbsolute(plan.claims)) throw Error('plan:absolute-claims-directory-required');
  if (!AUTH_MODES.includes(plan.auth)) throw Error('plan:auth-' + AUTH_MODES.join('-or-'));
  if (mode === 'manual') {
    if (!plan.cli || !path.isAbsolute(plan.cli) || !fs.existsSync(plan.cli) || !fs.statSync(plan.cli).isFile()) throw Error('plan:native-cli-path-required');
    if (!plan.frozen || !fs.existsSync(plan.frozen)) throw Error('plan:frozen-manifest-required');
    if (plan.auth === 'connected') {
      if (typeof env[ENV.token] !== 'string' || !env[ENV.token]) throw Error('plan:connected-auth-token-missing');
      const dir = env[ENV.configDir]; if (!dir || !path.isAbsolute(dir) || !fs.existsSync(dir)) throw Error('plan:connected-auth-config-directory-required');
      plan.configDirectory = dir; plan.slot = env[ENV.slot] || null;
    } else if (plan.auth === 'vault') {
      // The same private inputs as connected; the value is validated by the product's own rule and never echoed or kept in the plan.
      const value = env[ENV.token];
      if (typeof value !== 'string' || !value) throw Error('plan:vault-auth-token-missing');
      if (!validNativeCliToken(value)) throw Error('plan:vault-auth-token-invalid');
      const dir = env[ENV.configDir];
      if (dir !== undefined && dir !== '' && (!path.isAbsolute(dir) || !fs.existsSync(dir))) throw Error('plan:vault-auth-config-directory-invalid');
      plan.configDirectory = dir || null; plan.slot = env[ENV.slot] || null;
    }
  } else if (plan.auth !== 'default') throw Error('plan:auth-only-in-manual-mode');
  return plan;
}

// A supplemental question (separately declared, not one of the 62) has its design in the supplemental module; every original row is unchanged.
const designFor = row => row.cohort === SUPPLEMENTAL_COHORT ? supplementalCases.get(row.id) : row.realm === 'company' ? companyCases.get(row.id) : ownerCases.get(row.id);
const evaluatorOf = id => EVALUATOR_ONLY[id] || SUPPLEMENTAL_EVALUATOR_ONLY[id] || null;
const sha256File = file => sha256(fs.readFileSync(file));
function treeSha256(dir) {
  const files = [], walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.isFile()) files.push(path.relative(dir, f).split(path.sep).join('/') + ':' + sha256File(f)); } };
  if (!fs.existsSync(dir)) return null; walk(dir); return sha256(files.join('\n'));
}
export function sourceIdentity(root) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  let revision = null, tracked = null; try { revision = git('rev-parse', 'HEAD'); tracked = git('status', '--porcelain', '--untracked-files=no'); } catch {}
  return { revision, trackedChanges: tracked === null ? null : tracked.split(/\r?\n/).filter(Boolean), buildSha256: treeSha256(path.join(root, '.output', 'server')), harnessSha256: Object.fromEntries(HARNESS_FILES.map(f => [f, fs.existsSync(path.join(root, f)) ? sha256File(path.join(root, f)) : null])), declarationSha256: sha256(canonicalJson(DECLARED_TEXT_SHA256)), supplementalDeclarationSha256: sha256(canonicalJson({ text: SUPPLEMENTAL_TEXT_SHA256, rubric: SUPPLEMENTAL_RUBRIC_SHA256 })) };
}
async function writeExclusive(file, value) { await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
async function writeReplace(file, value) { const tmp = file + '.' + rid() + '.tmp'; await fsp.writeFile(tmp, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); await fsp.rename(tmp, file); }

// ---- Owned runtime
async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
function appEnvironment(extra) { const env = {}; for (const k of APP_ENV_KEYS) if (process.env[k]) env[k] = process.env[k]; return { ...env, ...extra }; }
// Exit state of an owned child, read from its own ChildProcess handle (never by probing a PID that may have been reused).
const unexited = child => !!child && child.exitCode === null && child.signalCode === null;
const handleState = child => child ? { pid: child.pid ?? null, exited: !unexited(child), exitCode: child.exitCode ?? null, signal: child.signalCode ?? null } : null;
const waitExit = (child, ms) => unexited(child) ? Promise.race([new Promise(r => child.once('exit', r)), pause(ms)]) : Promise.resolve();
// The owned mongod and its killer process, kept from the instance while it holds them (MongoInstance.stop() drops its references).
function mongoHandles(rt) { const i = rt?.mongo?.instanceInfo?.instance; if (i?.mongodProcess) rt.mongodProcess = i.mongodProcess; if (i?.killerProcess) rt.killerProcess = i.killerProcess; return [rt?.mongodProcess, rt?.killerProcess].filter(Boolean); }
export const ownedProcessStates = rt => ({ app: handleState(rt?.app), mongod: handleState(rt?.mongodProcess), killer: handleState(rt?.killerProcess) });
const ownedProcessesExited = rt => Object.values(ownedProcessStates(rt)).every(s => !s || s.exited);
// rt is created by the caller and filled as each resource exists, so cleanup reaches every partial resource. fault(point) is the
// lifecycle mode's injection seam (a no-op in every other mode).
async function startRuntime(root, plan, log, rt, fault = async () => {}) {
  Object.assign(rt, { root, logs: '', timing: {} });
  const requireApp = createRequire(path.join(root, 'package.json'));
  const { MongoMemoryServer } = requireApp('mongodb-memory-server'), { MongoClient, ObjectId } = requireApp('mongodb');
  rt.ObjectId = ObjectId;
  rt.dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'omf-navi-agent-model-'));
  for (const d of ['data', 'vault', 'inference']) await fsp.mkdir(path.join(rt.dir, d));
  const binary = [path.join(root, 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe'), path.resolve(root, '../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe')].find(f => fs.existsSync(f));
  let started = Date.now();
  // The instance exists before its start finishes: cleanup waits for a pending start and stops what it launched.
  rt.mongo = new MongoMemoryServer({ binary: binary ? { systemBinary: binary, version: '8.2.1' } : undefined, instance: { launchTimeout: SETUP_READY_MS } });
  rt.mongoStarting = rt.mongo.start(); rt.mongoStarting.then(() => { rt.mongoStarted = true; }, () => { rt.mongoStarted = false; });
  await fault('during-mongo-start');
  await rt.mongoStarting; rt.mongoStarting = null; mongoHandles(rt);
  rt.timing.mongoMs = Date.now() - started;
  await fault('after-mongo-start');
  rt.dbName = 'navi_agent_model_' + rid().slice(0, 12); const uri = rt.mongo.getUri(rt.dbName);
  const port = await freePort(); rt.origin = 'http://127.0.0.1:' + port;
  const marker = 'disabled-navi-agent-model-' + rid().slice(0, 8);
  rt.app = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: appEnvironment({ MONGO_URI: uri, MONGODB_URI: uri, NUXT_MONGO_URI: uri, OMF_DATA_DIR: path.join(rt.dir, 'data'), JWT_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port), OMF_SYNC_SCHEDULE_MS: '0', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: marker, OPENAI_API_KEY: marker, SLACK_BOT_TOKEN: marker, BASE_URL: rt.origin, OMF_COLLECTOR_PUBLIC_ORIGIN: '', OMF_TRUST_CLOUDFLARE_LOOPBACK: '' }) });
  rt.appClosed = new Promise(r => rt.app.once('close', r));
  for (const s of [rt.app.stdout, rt.app.stderr]) { s.setEncoding('utf8'); s.on('data', v => { rt.logs = (rt.logs + v).slice(-20000); }); }
  await fault('after-app-spawn');
  started = Date.now(); let healthy = false;
  while (!healthy && Date.now() - started < SETUP_READY_MS) { try { const r = await fetch(rt.origin + '/api/health', { signal: AbortSignal.timeout(5000) }), d = await r.json(); if (d.database?.connected) { if (d.database.name !== rt.dbName) throw new SetupError('owned database name mismatch'); healthy = true; } } catch (e) { if (e instanceof SetupError) throw e; } if (!healthy) await pause(500); }
  rt.timing.appMs = Date.now() - started;
  if (!healthy) throw new SetupError('owned application unavailable after ' + rt.timing.appMs + ' ms');
  await fault('after-health');
  rt.client = await MongoClient.connect(uri); rt.db = rt.client.db(rt.dbName);
  if (rt.db.databaseName !== rt.dbName) throw new SetupError('owned database client mismatch');
  rt.http = await openHttpObserver(rt.origin);
  log('owned runtime ready ' + JSON.stringify(rt.timing));
  return rt;
}
// Every step runs and reports separately. A process is confirmed stopped only by its own handle; the forced tree kill is sent only
// to a handle that has not exited (its PID is still this child's), never to a bare or reused PID. The checked temp directory is
// deleted only after the application and mongod steps confirmed exit. failStep is the lifecycle mode's cleanup-fault seam.
async function stopRuntime(rt, { failStep = null } = {}) {
  const status = {};
  const step = async (name, fn) => { try { if (failStep === name) throw Error('injected ' + name + ' cleanup fault (lifecycle control)'); await fn(); status[name] = 'ok'; } catch (e) { status[name] = 'failed: ' + String(e?.message || e).slice(0, 200); } };
  const forceTree = child => { if (unexited(child) && child.pid) { try { execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true }); } catch {} } };
  if (rt?.keepAlive) clearInterval(rt.keepAlive);
  await step('http-observer', async () => { if (rt?.http) await rt.http.close(); });
  await step('app', async () => {
    const app = rt?.app; if (!app) return;
    if (unexited(app)) { app.kill(); await waitExit(app, 15000); }
    if (unexited(app)) { forceTree(app); await waitExit(app, 10000); }
    if (unexited(app)) throw Error('owned application process ' + app.pid + ' did not exit');
  });
  await step('mongo-client', async () => { if (rt?.client) await rt.client.close(); });
  await step('mongod', async () => {
    if (!rt?.mongo) return;
    if (rt.mongoStarting) { try { await rt.mongoStarting; } catch {} rt.mongoStarting = null; }
    const handles = mongoHandles(rt); let stopError = null;
    try { await rt.mongo.stop(); } catch (e) { stopError = e; }
    for (const h of handles) { await waitExit(h, 15000); if (unexited(h)) { forceTree(h); await waitExit(h, 10000); } }
    const running = handles.filter(unexited);
    if (running.length) throw Error('owned mongod process(es) did not exit: ' + running.map(h => h.pid).join(','));
    if (stopError) throw Error('mongod stop: ' + String(stopError.message || stopError).slice(0, 160));
  });
  await step('temp-directory', async () => {
    if (!rt?.dir) return;
    if (status.app !== 'ok' || status.mongod !== 'ok') throw Error('owned process exit not confirmed; temp directory kept: ' + rt.dir);
    const resolved = path.resolve(rt.dir), base = path.resolve(os.tmpdir());
    if (!resolved.startsWith(base + path.sep) || !path.basename(resolved).startsWith('omf-navi-agent-model-')) throw Error('unsafe owned cleanup ' + resolved);
    await fsp.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    if (fs.existsSync(resolved)) throw Error('temp directory still present ' + resolved);
  });
  return status;
}

// ---- Native HTTP helpers bound to one runtime
function bindHttp(rt) {
  const api = async (route, opts = {}) => {
    const token = typeof opts.token === 'function' ? await opts.token() : await opts.token, raw = Buffer.isBuffer(opts.raw) ? opts.raw : null;
    const r = await fetch(rt.origin + route, { method: opts.method || (opts.body !== undefined || raw ? 'POST' : 'GET'), headers: { 'Content-Type': raw ? 'text/csv' : 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(raw ? { body: raw } : opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}), signal: AbortSignal.timeout(opts.timeoutMs || 60000) });
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = undefined; }
    return { status: r.status, data, raw: text };
  };
  const ok = async (route, opts = {}) => { const r = await api(route, opts); if (r.status !== 200) throw new SetupError((opts.method || 'GET') + ' ' + route.split('?')[0] + ' ' + r.status + ' ' + r.raw.slice(0, 300)); return r.data; };
  return { api, ok };
}

async function buildContext(rt, plan, log) {
  const { api, ok } = bindHttp(rt), ObjectId = rt.ObjectId, now = new Date();
  // Every synthetic credential is also kept in rt.secrets (memory only) so retained evidence can be scanned for it, even when setup
  // stops part-way.
  const keep = (...values) => { for (const v of values) if (typeof v === 'string' && v.length >= 8) rt.secrets?.add(v); return values[0]; };
  keep(PASSWORD);
  const register = async (email, name) => { for (let attempt = 0; ; attempt++) { const r = await api('/api/auth/register', { method: 'POST', body: { email, password: PASSWORD, name } }); if (r.status === 429 && attempt < 3) { await pause(61000); continue; } if (r.status !== 200) throw new SetupError('register ' + r.status); keep(r.data.tokens.accessToken, r.data.tokens.refreshToken); const u = await rt.db.collection('users').findOne({ email }); return { id: u._id, pair: { access: r.data.tokens.accessToken, refresh: r.data.tokens.refreshToken, at: Date.now() } }; } };
  // Synthetic token pairs stay in memory and are renewed through the native refresh route, which keeps the selected company.
  const refreshing = pair => async () => { if (Date.now() - pair.at > TOKEN_REFRESH_MS) { const r = await ok('/api/auth/refresh', { method: 'POST', body: { refreshToken: pair.refresh } }); keep(r.tokens.accessToken, r.tokens.refreshToken); pair.access = r.tokens.accessToken; pair.refresh = r.tokens.refreshToken || pair.refresh; pair.at = Date.now(); } return pair.access; };
  const owner = await register('navi-agent-model-owner-' + rid().slice(0, 8) + '@example.invalid', 'Synthetic Navi owner'), outsider = await register('navi-agent-model-outsider-' + rid().slice(0, 8) + '@example.invalid', 'Synthetic outsider');
  const ownerPlain = refreshing(owner.pair), member = { userId: owner.id, role: 'owner', joinedAt: now };
  const organization = async (name, members = [member]) => { const _id = new ObjectId(); await rt.db.collection('organizations').insertOne({ _id, name, slug: 'navi-agent-model-' + String(_id), type: 'business', isActive: true, members, settings: { defaultCurrency: 'JPY', fiscalYearStart: 11, timezone: 'Asia/Tokyo' }, createdAt: now, updatedAt: now }); return _id; };
  const switchTo = async (token, orgId) => { const r = await ok('/api/auth/switch-organization', { token, method: 'POST', body: { organizationId: String(orgId) } }); keep(r.tokens.accessToken, r.tokens.refreshToken); return { access: r.tokens.accessToken, refresh: r.tokens.refreshToken, at: Date.now() }; };
  const orgs = new Map();
  const orgFor = async key => { if (orgs.has(key)) return orgs.get(key); const id = await organization('テスト株式会社'), pair = await switchTo(ownerPlain, id), org = { key, id, token: refreshing(pair) }; orgs.set(key, org); return org; };
  // Owner card accounts (native route) before the agent, which is assigned to them at creation.
  const account = async (token, body) => (await ok('/api/finance/accounts', { token, method: 'POST', body })).account;
  const accounts = { amex: await account(ownerPlain, { name: 'AMEX_MAIN', provider: 'amex', primaryCard: '12345', cardIdentifiers: ['12345'], otpRecipient: 'synthetic@example.invalid', otpMailbox: 'synthetic@example.invalid' }), aplus: await account(ownerPlain, { name: 'APLUS_TEST_CARD', provider: 'aplus', primaryCard: '5678', cardIdentifiers: ['5678'] }), aplusOther: await account(ownerPlain, { name: 'APLUS_OTHER', provider: 'aplus', primaryCard: '9012', cardIdentifiers: ['9012'] }) };
  const ownerCompanyId = await organization('テスト商事株式会社'), ownerCompany = refreshing(await switchTo(ownerPlain, ownerCompanyId));
  // Synthetic privacy markers: a company the owner belongs to but never selects, and another owner with its own records.
  const foreignId = await organization('FOREIGN_PRIVATE_MARKER 株式会社');
  await rt.db.collection('transactions').insertMany([{ organizationId: foreignId, referenceNumber: 'FOREIGN_PRIVATE_MARKER-1', date: new Date('2026-09-15T03:00:00Z'), amount: 987654, type: '支出', status: 'completed', productName: 'PRIVATE_FOREIGN_LEDGER_ROW FOREIGN_PRIVATE_MARKER', hasReceipt: false, items: [], timeline: [], metadata: { currency: 'JPY' }, createdAt: now, updatedAt: now }]);
  const outsiderCompany = await organization('OUTSIDER_PRIVATE_MARKER 合同会社', [{ userId: outsider.id, role: 'owner', joinedAt: now }]);
  await rt.db.collection('transactions').insertOne({ organizationId: outsiderCompany, referenceNumber: 'OUTSIDER_PRIVATE_MARKER-1', date: new Date('2026-09-16T03:00:00Z'), amount: 123987, type: '支出', status: 'completed', productName: 'OUTSIDER_PRIVATE_MARKER', hasReceipt: false, items: [], timeline: [], metadata: { currency: 'JPY' }, createdAt: now, updatedAt: now });
  await ok('/api/finance-intake/records', { token: refreshing(outsider.pair), method: 'POST', body: { values: { orderId: 'OUTSIDER_PRIVATE_MARKER-ORDER', description: 'OUTSIDER_PRIVATE_MARKER purchase', amount: '1' } } });
  const createAgent = async body => { const a = await ok('/api/finance-chat/agents', { token: ownerPlain, method: 'POST', body }); keep(a.token); return { id: a.id, token: a.token }; };
  const agent = await createAgent({ accountIds: Object.values(accounts).map(a => String(a._id)), workspaceEnabled: true });
  const worker = (route, body = {}, token = agent.token) => api('/api/finance-chat/worker/' + route, { token, method: 'POST', body });
  const workerOk = async (route, body, label) => { const r = await worker(route, body); if (r.status !== 200) throw new SetupError(label + ' ' + r.status + ' ' + r.raw.slice(0, 300)); return r.data; };
  const sendCompany = async (org, text, context, requestId = rid()) => { const view = await ok('/api/finance-chat/company-workspace', { token: org.token }); return ok('/api/finance-chat/company-workspace', { token: org.token, method: 'POST', body: { requestId, chatRevision: view.conversation?.revision || 0, text, context } }); };
  const reply = summary => ({ kind: 'unclear', summary, patch: {}, quotes: {} });
  const ctx = {
    mode: plan.mode, db: rt.db, ObjectId, api, ok, rid, plan,
    importApp: rel => import(pathToFileURL(path.join(rt.root, rel)).href),
    owner: { id: owner.id, plainToken: ownerPlain, companyToken: ownerCompany, companyId: ownerCompanyId, accounts },
    outsider: { id: outsider.id }, foreignCompanyId: foreignId, agent, worker, workerOk, orgFor, createAgent, sendCompany, ownerRealm: null,
    async heartbeat() { await workerOk('heartbeat', {}, 'SETUP heartbeat'); },
    async newCompanyChat(org) { const view = await ok('/api/finance-chat/company-workspace', { token: org.token }); await ok('/api/finance-chat/company-workspace/new', { token: org.token, method: 'POST', body: { chatRevision: view.conversation?.revision || 0, requestId: rid() } }); },
    async newWorkspaceChat() { const view = await ok('/api/finance-chat/workspace', { token: ownerCompany }); if (view.conversation) await ok('/api/finance-chat/workspace/new', { token: ownerCompany, method: 'POST', body: { chatRevision: view.conversation.revision, requestId: rid() } }); },
    // Declared reconstructed earlier turns: sent through the native company conversation and answered (or lost) through the native
    // worker result route by the synthetic agent; their declared actions run through the native lease-bound action route.
    async seedCompanyTurns(org, context, turns) {
      for (const t of turns) {
        await ctx.heartbeat(); await sendCompany(org, t.user, context);
        const job = (await workerOk('workspace-claim', {}, 'SETUP seed claim')).job; if (!job || job.text !== t.user) throw new SetupError('seeded turn not claimed');
        let slot = 1; for (const a of t.actions || []) { const r = await workerOk('workspace/' + job.id + '/actions', { lease: job.lease, slot: slot++, name: a.name, args: a.args }, 'SETUP seed action ' + a.name); if (r.receipt?.state !== 'done') throw new SetupError('seeded action not done ' + a.name); }
        await workerOk('workspace/' + job.id + '/result', t.outcome === 'lost' ? { lease: job.lease, failed: true } : { lease: job.lease, proposal: reply(t.reply) }, 'SETUP seed result');
      }
    },
    async seedArchivedCompanyResearch(org, context, s) {
      await ctx.heartbeat(); await sendCompany(org, s.user, context);
      const job = (await workerOk('workspace-claim', { capabilities: { publicResearch: { version: 1, webSearch: true, publicPage: true, chrome: false, registry: 'connection_required' } } }, 'SETUP seed claim')).job;
      if (!job || job.text !== s.user) throw new SetupError('seeded research turn not claimed');
      const source = (await workerOk('workspace/' + job.id + '/sources', { lease: job.lease, op: 'capture', capture: { captureId: rid(), kind: s.source.kind, requestedUrl: s.source.requestedUrl, url: s.source.url, title: s.source.title, text: s.source.text, hash: sha256(s.source.text), capturedAt: new Date().toISOString(), truncated: false } }, 'SETUP seed capture')).source;
      await workerOk('workspace/' + job.id + '/result', { lease: job.lease, proposal: { ...reply(s.reply), citations: [{ sourceId: source.id, quote: s.quote, claim: s.claim }] } }, 'SETUP seed result');
      await ctx.newCompanyChat(org);
      const history = await ok('/api/finance-chat/company-workspace/history', { token: org.token }), archive = history.archives?.[0];
      if (!archive?.id) throw new SetupError('archive not created'); return String(archive.id);
    }
  };
  log('synthetic owner, companies, cards and agent ready');
  return ctx;
}

// ---- Snapshots and evidence
// Native internal lock fields that every draft save sets on its card account (financeDraftService withLease); not a business effect.
const VOLATILE = Object.freeze({ financialaccounts: ['commitLease', 'commitLeaseUntil', 'updatedAt'] });
async function snapshot(db) {
  const out = {};
  for (const c of (await db.listCollections({}, { nameOnly: true }).toArray()).map(x => x.name).sort()) {
    if (EXCLUDED.has(c) || c.startsWith('system.')) continue;
    const strip = VOLATILE[c] || [], docs = await db.collection(c).find({}).toArray();
    out[c] = Object.fromEntries(docs.map(d => { const plain = plainDocument(d); for (const k of strip) delete plain[k]; return [String(d._id), canonicalJson(plain)]; }));
  }
  return out;
}
const conversationOf = async (ctx, row, binding) => {
  if (row.endpoint === 'company') return (await ctx.ok('/api/finance-chat/company-workspace', { token: binding.org.token })).conversation;
  if (row.endpoint === 'workspace') return (await ctx.ok('/api/finance-chat/workspace', { token: ctx.owner.companyToken })).conversation;
  return (await ctx.ok('/api/finance-chat/imports/' + binding.purchase.importId + '/drafts/' + binding.purchase.line, { token: ctx.owner.companyToken })).conversation;
};
async function sendDraw(ctx, row, binding, request, requestId) {
  if (row.endpoint === 'company') return ctx.sendCompany(binding.org, request.text, request.context, requestId);
  if (row.endpoint === 'workspace') { const view = await ctx.ok('/api/finance-chat/workspace', { token: ctx.owner.companyToken }); return ctx.ok('/api/finance-chat/workspace', { token: ctx.owner.companyToken, method: 'POST', body: { requestId, chatRevision: view.conversation?.revision || 0, text: request.text, context: request.context } }); }
  const route = '/api/finance-chat/imports/' + binding.purchase.importId + '/drafts/' + binding.purchase.line, d = await ctx.ok('/api/finance/imports/' + binding.purchase.importId + '/drafts/' + binding.purchase.line, { token: ctx.owner.plainToken }), view = await ctx.ok(route, { token: ctx.owner.companyToken });
  return ctx.ok(route, { token: ctx.owner.companyToken, method: 'POST', body: { requestId, chatRevision: view.conversation?.revision || 0, text: request.text, revision: d.revision, key: d.key, sourceHash: d.sourceHash } });
}
// Boundary of the actual native input: computed in memory from the observed stdin bytes; only booleans and key names are kept.
const boundaryFor = (request, row) => text => { let input; try { input = JSON.parse(text); } catch { return { parsed: false }; } const evaluator = evaluatorOf(row.id); return { parsed: true, currentMessageMatchesFrozen: input.currentMessage === request.text, evaluatorExpectationAbsent: !evaluator || !text.includes(evaluator.expected), rubricLabelAbsent: !text.includes('manual-grading.md'), keys: Object.keys(input).sort() }; };

// ---- Manual authentication handoff
// The connected or vault credential (explicit manual options only) is taken into memory and removed from the given environment and
// this process environment before any child starts (git, mongod, the application, the Vault helper, the worker's native and MCP
// children), so no other child can inherit it.
export function takeNativeCredential(env, plan) {
  if (plan?.mode !== 'manual' || !['connected', 'vault'].includes(plan.auth)) return null;
  const taken = { mode: plan.auth, token: env[ENV.token], slot: plan.slot ?? null, configDirectory: plan.configDirectory ?? null };
  delete env[ENV.token]; delete process.env[ENV.token];
  return taken;
}
// The auth source recorded in batch.json: never the credential itself.
export function authRecord(plan, connected, vaultAuth) {
  if (plan.mode !== 'manual') return null;
  if (connected) return { source: 'connected-resource-overlay', slot: connected.slot, configDirectory: connected.configDirectory, oneKeyOverlay: 'CLAUDE_CODE_OAUTH_TOKEN on the exact matched native CLI spawn only' };
  if (vaultAuth) return { source: 'owned-vault-native-credential', slot: vaultAuth.slot, configDirectory: vaultAuth.configDirectory, delivery: 'nativeOAuthToken in the owned DPAPI worker Vault, applied by shared/finance-native-cli-auth.mjs to the native CLI child (clean explicit-credential environment, blank MCP value)', observerOverlay: false };
  return { source: 'unchanged-default-native-login' };
}
// Manual mode: the spawn observer (installed before the worker/interpreter is imported), the owned DPAPI worker Vault and the actual
// TeachingWorker built as teaching-worker/run.mjs builds it (Vault config plus its directory, native defaults for everything else).
// Vault mode writes the credential only into this owned Vault as nativeOAuthToken and installs the observer with connectedAuth null:
// no overlay, custom loader or alternate model transport; the product helper alone delivers it.
export async function startManualWorker({ root, cli, connected = null, vaultAuth = null, agentToken, origin, vaultDir, inferenceDirectory, secretValues, log = () => {} }) {
  if (connected && vaultAuth) throw Error('manual:one-auth-source-only');
  const spawnObserver = installSpawnObserver({ cliPath: cli, connectedAuth: connected, secretValues });
  try {
    const { Vault } = await import(pathToFileURL(path.join(root, 'collector/vault.mjs')).href);
    const configDirectory = connected?.configDirectory || vaultAuth?.configDirectory || null;
    await new Vault(vaultDir).update(() => ({ enabled: true, token: agentToken, baseUrl: origin, cliPath: cli, inferenceDirectory, publicResearch: true, ...(configDirectory ? { claudeConfigDirectory: configDirectory } : {}), ...(vaultAuth ? { nativeOAuthToken: vaultAuth.token } : {}) }));
    const { TeachingWorker } = await import(pathToFileURL(path.join(root, 'teaching-worker/worker.mjs')).href);
    const worker = new TeachingWorker({ ...await new Vault(vaultDir).read(), directory: vaultDir }, { log: line => { worker.lines.push({ at: new Date().toISOString(), line: String(line).slice(0, 200) }); log('worker: ' + line); } });
    worker.lines = [];
    return { spawnObserver, worker };
  } catch (e) { try { spawnObserver.restore(); } catch {} throw e; }
}

// ---- Main explicit-mode entry (called by the fixture with process.env)
export async function runCorpusFromEnvironment(env, { root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), log = s => process.stderr.write('[navi-agent-model] ' + s + '\n') } = {}) {
  const plan = parsePlan(env);
  if (plan.mode === 'lifecycle') return runLifecycle(plan, root, log);
  // The connected or vault credential (explicit manual options only) is taken into memory and removed from this process environment
  // before any child starts, so no other child (git, application, mongod, Vault helper, MCP) can inherit it.
  const credential = takeNativeCredential(env, plan);
  const connected = credential?.mode === 'connected' ? { token: credential.token, slot: credential.slot, configDirectory: credential.configDirectory } : null;
  const vaultAuth = credential?.mode === 'vault' ? { token: credential.token, slot: credential.slot, configDirectory: credential.configDirectory } : null;
  verifyDeclaration(); verifySupplementalDeclaration();
  try { os.setPriority(0, os.constants.priority.PRIORITY_LOW); } catch {}
  await fsp.mkdir(plan.out, { recursive: true });
  const identity = sourceIdentity(root), startedAt = new Date().toISOString();
  let frozen = null;
  if (plan.mode === 'manual') {
    frozen = JSON.parse(await fsp.readFile(plan.frozen, 'utf8'));
    const mismatch = !identity.revision || identity.trackedChanges?.length ? 'tracked source changes or no revision' : frozen.source?.revision !== identity.revision ? 'source revision' : frozen.source?.buildSha256 !== identity.buildSha256 ? 'built application' : canonicalJson(frozen.source?.harnessSha256) !== canonicalJson(identity.harnessSha256) ? 'harness files' : frozen.declarationSha256 !== identity.declarationSha256 ? 'declaration' : frozen.source?.supplementalDeclarationSha256 !== identity.supplementalDeclarationSha256 ? 'supplemental declaration' : null;
    if (mismatch) { await writeExclusive(path.join(plan.out, 'batch.json'), { batch: plan.batch, mode: plan.mode, startedAt, refused: 'frozen manifest does not match the current candidate: ' + mismatch, identity, frozenSource: frozen.source }); return { pass: false, summary: { mode: plan.mode, refused: 'frozen-candidate-mismatch: ' + mismatch, nativeCliProcesses: 0, processesReportingModelUsage: 0 } }; }
  }
  const batchRecord = { batch: plan.batch, mode: plan.mode, attempt: plan.attempt, reason: plan.reason, startedAt, selected: plan.rows.map(r => r.id), denominators: denominators(plan.rows), auth: authRecord(plan, connected, vaultAuth), cliPath: plan.mode === 'manual' ? plan.cli : null, identity, frozenManifestSha256: plan.frozen ? sha256File(plan.frozen) : null, processPriority: (() => { try { return os.getPriority(0); } catch { return null; } })(), countingUnit: 'one initial queued native product job and its native CLI process; internal model/tool turns are recorded separately' };
  await writeExclusive(path.join(plan.out, 'batch.json'), batchRecord);
  // Caller-owned runtime: every resource startRuntime creates is reachable by stopRuntime, even when startup throws part-way.
  const rt = { secrets: new Set() };
  let ctx = null, spawnObserver = null, worker = null, fatal = null, cleanup = null;
  // Known synthetic credentials (memory only): agent/research/owner tokens, every lease and bearer token the loopback observer
  // forwarded and, when used, the connected or vault credential. Used to withhold a native input and to scan every written artifact.
  const secretValues = () => [...rt.secrets, ...(rt.http ? rt.http.secretValues() : []), ...(connected ? [connected.token] : []), ...(vaultAuth ? [vaultAuth.token] : [])].filter(v => typeof v === 'string' && v.length >= 8);
  const attempts = [], families = new Map(), manifest = { kind: 'navi-agent-model resolved request manifest', createdAt: startedAt, mode: plan.mode, batch: plan.batch, source: identity, declarationSha256: identity.declarationSha256, cases: {} };
  try {
    await startRuntime(root, plan, log, rt);
    ctx = await buildContext(rt, plan, log);
    ctx.secretValues = secretValues;
    if (plan.mode === 'manual') ({ spawnObserver, worker } = await startManualWorker({ root, cli: plan.cli, connected, vaultAuth, agentToken: ctx.agent.token, origin: rt.http.origin, vaultDir: path.join(rt.dir, 'vault'), inferenceDirectory: path.join(rt.dir, 'inference'), secretValues, log }));
    else spawnObserver = installSpawnObserver({ cliPath: plan.cli || path.join(os.homedir(), '.local/bin/claude.exe'), secretValues });
    for (let i = 0; i < plan.rows.length; i++) {
      const row = plan.rows[i], a = await runCase({ row, plan, rt, ctx, worker, spawnObserver, frozen, families, manifest, index: i, log, secretValues });
      attempts.push(a); await writeReplace(path.join(plan.out, 'result-table.json'), resultTable(plan, attempts));
      if (a.abortBatch) { fatal = Error(a.abortBatch); for (const rest of plan.rows.slice(i + 1)) attempts.push({ attemptId: rest.id + '.' + plan.attempt, caseId: rest.id, cohort: rest.cohort, status: 'not-run', layer: 'batch-aborted', detail: a.abortBatch }); break; }
    }
  } catch (e) { fatal = e; log('fatal: ' + String(e?.stack || e).slice(0, 1200)); for (const row of plan.rows) if (!attempts.some(x => x.caseId === row.id)) attempts.push({ attemptId: row.id + '.' + plan.attempt, caseId: row.id, cohort: row.cohort, status: 'not-run', layer: e?.layer || 'setup', detail: String(e?.message || e).slice(0, 600) }); }
  finally {
    try { spawnObserver?.restore(); } catch (e) { fatal ||= e; }
    cleanup = await stopRuntime(rt);
  }
  const processes = ownedProcessStates(rt);
  if (plan.mode !== 'manual') await writeExclusive(path.join(plan.out, 'frozen-manifest.json'), manifest);
  const table = resultTable(plan, attempts, { fatal: fatal ? String(fatal.message || fatal).slice(0, 600) : null, cleanup, ownedProcesses: processes, spawnStats: spawnObserver?.stats() || null, logsTail: fatal ? redactLogs(rt.logs || '') : undefined });
  await writeReplace(path.join(plan.out, 'result-table.json'), table); await writeReplace(path.join(plan.out, 'result-table.md'), tableMarkdown(table));
  // Every written artifact is scanned for every known synthetic credential; a hit is scrubbed on disk and the run is not a pass.
  const secretScan = await scanArtifacts(plan.out, secretValues());
  const expected = plan.mode === 'prepare' ? 'prepared' : plan.variant === 'defects' ? 'defect-detected' : 'deterministic-pass';
  const passed = overallPass({ fatal, attempts, expected, selected: plan.rows.length, cleanup, secretFindings: secretScan.findings.length });
  const counters = nativeCounters(plan, spawnObserver);
  const outcome = { batch: plan.batch, mode: plan.mode, variant: plan.mode === 'selftest' ? plan.variant : undefined, pass: passed, expectedStatus: expected, fatal: fatal ? String(fatal.message || fatal).slice(0, 400) : null, cleanup, ownedProcesses: processes, secretScan, ...counters, finishedAt: new Date().toISOString() };
  await writeExclusive(path.join(plan.out, 'outcome.json'), outcome);
  return { pass: passed, summary: { mode: plan.mode, variant: outcome.variant, batch: plan.batch, attempt: plan.attempt, out: plan.out, denominators: table.denominators, counts: table.counts, ...counters, manualGrades: plan.mode === 'manual' ? 'PENDING for every attempt (manual-grading.md)' : 'not applicable', cleanup, ownedProcesses: processes, secretScan: { files: secretScan.files, findings: secretScan.findings.length }, fatal: outcome.fatal, limits: limitsFor(plan.mode) }, databaseCoverage: { executed: !!rt.db, ownedProcess: !!rt.mongo } };
}
// Separate counts, never one "model calls" number: matched spawns of the configured CLI path, processes whose final envelope
// reported model usage, and whether that CLI is this Node executable (a stand-in, never any of the 62 actual-model draws).
function nativeCounters(plan, spawnObserver) {
  const processes = spawnObserver?.processes || [], reported = processes.filter(p => (p.envelope?.modelNames || []).length > 0);
  const standIn = !!plan.cli && path.resolve(plan.cli).toLowerCase() === path.resolve(process.execPath).toLowerCase();
  return { nativeCliProcesses: spawnObserver?.stats()?.matched ?? 0, processesReportingModelUsage: reported.length, modelNamesReported: [...new Set(reported.flatMap(p => p.envelope.modelNames))].sort(), cliIsNodeExecutable: standIn, actualModelDraws: plan.mode !== 'manual' || standIn ? 0 : 'not inferred by the runner: read processesReportingModelUsage and each attempt envelope', externalNetwork: plan.mode === 'manual' && !standIn ? 'the configured native CLI and its public research only' : 'none (owned loopback application, mongod and observer only)' };
}
const limitsFor = mode => mode === 'manual' ? 'Finite declared corpus draws on synthetic owned data. Deterministic record/receipt/HTTP checks only; accountant reasoning, citations and public-source facts need the separate manual grade. Not a reliability percentage, tax advice or production replay.' : 'Zero model, provider or native CLI calls and no EXTERNAL network: owned loopback application, mongod and synthetic setup' + (mode === 'selftest' ? ' with scripted synthetic worker turns' : '') + ' only. Grants no product-model coverage.';
const redactLogs = text => String(text).replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, '$1[REDACTED]').replace(/omft_[a-f0-9]{64}/g, '[REDACTED]').slice(-4000);
async function scanArtifacts(dir, secrets) {
  const findings = []; let files = 0;
  const walk = async d => { for (const e of (await fsp.readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) { const f = path.join(d, e.name); if (e.isDirectory()) await walk(f); else if (e.isFile()) { files++; let text = await fsp.readFile(f, 'utf8'); const hits = secrets.filter(s => text.includes(s)); if (hits.length) { for (const s of hits) text = text.split(s).join('[REDACTED]'); await fsp.writeFile(f, text); findings.push({ file: path.relative(dir, f).split(path.sep).join('/'), markers: hits.length, scrubbed: true }); } } } };
  await walk(dir);
  return { files, markersChecked: secrets.length, findings };
}

// Context pointers whose native documents are retained (before and after) with every attempt, beside the design's protected ones.
const POINTER_COLLECTIONS = Object.freeze({ transactionId: 'transactions', invoiceId: 'invoices', paymentId: 'payments', budgetId: 'budgets', recurringPaymentId: 'recurringpayments', receiptId: 'receipts', recordId: 'financeintakerecords', importId: 'financeimports', paymentImportId: 'financeimports' });
function selectedDocuments(design, state, context) {
  const pairs = [...(design.protect ? design.protect(state) : [])];
  for (const [key, collection] of Object.entries(POINTER_COLLECTIONS)) { const v = context?.[key]; if (typeof v === 'string' && /^[a-f0-9]{24}$/.test(v)) pairs.push([collection, v]); }
  if (typeof state?.draftDocId === 'string') pairs.push(['financedrafts', state.draftDocId]);
  return [...new Map(pairs.map(([c, id]) => [c + ':' + id, [c, String(id)]])).values()];
}
async function runCase({ row, plan, rt, ctx, worker, spawnObserver, frozen, families, manifest, log, secretValues = null }) {
  const design = designFor(row), attemptId = row.id + '.' + (plan.attempt === 'initial' ? 'initial' : 'additional-' + new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15));
  const rec = { attemptId, caseId: row.id, cohort: row.cohort, realm: row.realm, endpoint: row.endpoint, page: row.page, nativePage: row.nativePage, transport: row.transport, family: row.family, batch: plan.batch, mode: plan.mode, attemptKind: plan.attempt, reason: plan.reason, startedAt: new Date().toISOString(), rubric: evaluatorOf(row.id)?.rubric || null, manualGrade: plan.mode === 'manual' ? 'PENDING' : 'not-applicable' };
  const secrets = () => secretValues ? secretValues() : [ctx.agent.token];
  let binding = null, request = null, state = null;
  try {
    if (!design) throw new SetupError('no case design');
    if (plan.mode === 'manual' && plan.attempt === 'initial' && plan.claims) await writeExclusive(path.join(plan.claims, row.id + '.initial'), { batch: plan.batch, attemptId, claimedAt: new Date().toISOString() });
    // Prepare synthetic native state, then the declared reconstructed turns, then freeze the request.
    const familyKey = design.family || null, family = familyKey ? (families.get(familyKey) || families.set(familyKey, {}).get(familyKey)) : null;
    let org = null;
    if (row.realm === 'company') org = await ctx.orgFor(familyKey || row.id);
    else if (row.endpoint === 'workspace' && !(familyKey && family.started)) await ctx.newWorkspaceChat();
    if (family) family.started = true;
    const prepared = row.realm === 'company' ? await design.prepare(ctx, org, family) : await design.prepare(ctx);
    state = { ...(prepared.state || {}), org };
    binding = { org, purchase: prepared.purchase || null };
    if (design.preceding?.length) await ctx.seedCompanyTurns(org, prepared.context, design.preceding);
    const placeholders = {}; for (const [k, v] of Object.entries(design.placeholders || {})) if (typeof v === 'string') placeholders[k] = { value: v };
    Object.assign(placeholders, prepared.placeholders || {});
    request = resolveRequest(row, { context: prepared.context, labels: prepared.labels || {}, placeholders, preceding: [...(prepared.archivedPreceding || []), ...(design.preceding || []).map(t => ({ user: t.user, ...(t.reply !== undefined ? { reply: t.reply } : {}), outcome: t.outcome || 'answered' }))] });
    rec.request = { text: request.text, context: request.context, preceding: request.preceding, resolvedSha256: request.resolvedSha256, normalizedSha256: request.normalizedSha256, declaredTextSha256: request.declaredTextSha256 };
    manifest.cases[row.id] = { normalizedSha256: request.normalizedSha256, declaredTextSha256: request.declaredTextSha256, cohort: row.cohort, transport: row.transport, normalized: request.normalized };
    if (frozen) { const f = frozen.cases?.[row.id]; rec.frozenMatch = !!f && f.normalizedSha256 === request.normalizedSha256; if (!rec.frozenMatch) throw new SetupError('resolved request differs from the frozen manifest'); }
    await writeExclusive(path.join(plan.out, 'requests', attemptId + '.json'), { attemptId, frozenBeforeDraw: new Date().toISOString(), request: rec.request, normalized: request.normalized });
    // Before-state: every business collection, the protected selected documents and this company's captured sources.
    const before = await snapshot(ctx.db), beforeDocs = {};
    for (const [collection, id] of (design.protect ? design.protect(state) : [])) { const d = await ctx.db.collection(collection).findOne({ _id: new ctx.ObjectId(id) }); beforeDocs[collection + ':' + id] = d ? plainDocument(d) : null; }
    const sourcesBefore = org ? (await ctx.db.collection('financecompanypublicsources').find({ organizationId: org.id }).project({ _id: 1 }).toArray()).map(x => String(x._id)) : [];
    rec.setup = { status: 'ok', snapshotSha256: sha256(canonicalJson(before)) };
    if (plan.mode === 'prepare') {
      const baseline = await safeChecks(design, ctx, state, { mode: 'prepare', request, turn: null, diff: {}, events: [], native: { processes: [] }, beforeDocs, sourcesBefore });
      rec.baseline = baseline; rec.status = 'prepared'; rec.layer = null; return finishRecord(plan, rec, secrets);
    }
    // The draw.
    const eventStart = rt.http.events.length, requestId = rid();
    let keepAlive = null;
    if (design.researchAgent) { const beat = () => ctx.worker('heartbeat', {}, ctx.ownerRealm.research.token).catch(() => {}); await beat(); keepAlive = setInterval(beat, 20000); rt.keepAlive = keepAlive; }
    rt.http.setCase(attemptId);
    try {
      if (plan.mode === 'manual') {
        await worker.api('heartbeat');
        spawnObserver.setCase({ caseId: row.id, attemptId, transport: row.transport, boundary: boundaryFor(request, row), binding: { resolvedSha256: request.resolvedSha256, normalizedSha256: request.normalizedSha256 } });
        await sendDraw(ctx, row, binding, request, requestId); rec.queuedAt = new Date().toISOString();
        const linesBefore = worker.lines.length;
        const handled = await Promise.race([worker.cycle().then(v => ({ v }), e => ({ e })), pause(CYCLE_BOUND_MS).then(() => ({ bound: true }))]);
        rec.workerLog = worker.lines.slice(linesBefore);
        if (handled.bound) { rec.abortBatch = 'worker cycle exceeded the ' + CYCLE_BOUND_MS + ' ms wrapper bound (native limits are 90/240/480 s)'; throw Object.assign(Error(rec.abortBatch), { layer: 'harness' }); }
        if (handled.e) throw Object.assign(Error('TeachingWorker.cycle threw: ' + String(handled.e?.message || handled.e).slice(0, 300)), { layer: 'worker' });
        rec.cycleHandledJob = handled.v === true;
      } else {
        await ctx.heartbeat(); await sendDraw(ctx, row, binding, request, requestId); rec.queuedAt = new Date().toISOString();
        rec.selftestProposal = await scriptedTurn(ctx, rt, row, design, state, plan.variant === 'defects' ? design.defect.turn : design.ideal);
      }
    } finally { spawnObserver?.clearCase(); rt.http.setCase(null); if (keepAlive) { clearInterval(keepAlive); rt.keepAlive = null; } }
    // After-state and evidence.
    const conversation = await conversationOf(ctx, row, binding), turn = conversation?.turns?.find(t => t.id === requestId) || null;
    const after = await snapshot(ctx.db), diff = diffSnapshots(before, after), events = rt.http.since(eventStart).filter(e => e.caseId === attemptId);
    const processes = spawnObserver ? spawnObserver.processes.filter(p => p.attemptId === attemptId) : [];
    // Captured public sources of this attempt, retained with their literal text and a recomputed hash (they outlive the owned DB).
    const sources = org ? (await ctx.db.collection('financecompanypublicsources').find({ organizationId: org.id }).toArray()).filter(x => !sourcesBefore.includes(String(x._id))).map(retainedSource) : [];
    // Every added/removed/changed native document and the selected/protected ones, before and after (credential-shaped keys removed).
    rec.documents = redact(retainedDocuments(before, after, diff, selectedDocuments(design, state, request.context)));
    rec.conversationState = conversation?.state ?? null;
    rec.turn = turn ? { id: turn.id, text: turn.text, proposal: turn.proposal || null, actions: turn.actions || [], answeredAt: turn.answeredAt || null, sources: turn.sources || [] } : null;
    rec.native = { processes, processCount: processes.length, internalTurns: processes.map(p => p.envelope?.num_turns ?? null), requestedModel: processes[0]?.args?.find(x => x[0] === '--model')?.[1] ?? null, effort: processes[0]?.args?.find(x => x[0] === '--effort')?.[1] ?? null };
    rec.http = { events };
    rec.research = { capturedSources: sources, webSearchRequests: processes.reduce((n, p) => n + (p.envelope?.usage?.serverToolUse?.web_search_requests || 0), 0), captureAttempts: events.filter(e => e.kind === 'source' && e.op === 'capture').map(e => ({ status: e.status, kind: e.capture?.kind, url: e.capture?.url, result: e.source?.status || e.error })) };
    rec.effects = diff;
    const ev = { mode: plan.mode, request, turn: rec.turn, diff, events, native: { processes }, beforeDocs, sourcesBefore };
    const checks = [];
    if (plan.mode === 'manual') checks.push(...nativeChecks(processes, row, request, plan.auth));
    checks.push(check('product:reply-saved', !!turn?.proposal?.summary && ['ready', 'confirmed'].includes(conversation?.state), 'state ' + conversation?.state));
    const visible = JSON.stringify({ proposal: turn?.proposal || null, events: events.map(e => e.responseText || e.job || '') });
    checks.push(check('scope:no-foreign-or-outsider-marker', !FOREIGN_MARKERS.some(m => visible.includes(m)), 'reply, citations and tool results scanned'));
    checks.push(...gradeEffects(diff, design.allowed ? design.allowed(state) : {}));
    checks.push(...await safeChecks(design, ctx, state, ev));
    rec.checks = checks;
    const failed = checks.filter(c => !c.pass), transport = failed.filter(c => c.name.startsWith('transport:') || c.name.startsWith('evidence:'));
    rec.status = transport.length ? 'harness-failure' : failed.some(c => c.name.startsWith('native:')) ? 'native-failure' : failed.some(c => c.name === 'product:reply-saved') ? 'product-failure' : failed.length ? 'deterministic-fail' : 'deterministic-pass';
    rec.layer = rec.status === 'deterministic-pass' ? null : rec.status === 'harness-failure' ? 'transport' : rec.status === 'native-failure' ? 'native' : rec.status === 'product-failure' ? 'product' : 'deterministic';
    if (plan.variant === 'defects') { const flipped = checks.find(c => c.name === design.defect.flips); rec.defect = { flips: design.defect.flips, detected: !!flipped && !flipped.pass, detail: flipped?.detail || 'named check absent' }; rec.status = rec.defect.detected ? 'defect-detected' : 'defect-missed'; rec.layer = null; }
  } catch (e) {
    rec.status = e?.layer === 'setup' || !request ? 'setup-failure' : 'harness-failure'; rec.layer = e?.layer || (request ? 'harness' : 'setup'); rec.error = String(e?.message || e).slice(0, 800);
    log(row.id + ' ' + rec.status + ': ' + rec.error);
  }
  return finishRecord(plan, rec, secrets);
}
async function safeChecks(design, ctx, state, ev) { try { return await design.check(ctx, state, ev); } catch (e) { return [check('oracle:check-executed', false, 'check threw: ' + String(e?.message || e).slice(0, 300))]; } }
function nativeChecks(processes, row, request, auth = 'default') {
  const p = processes[0] || {}, env = p.envelope || {};
  const exactInput = p.nativeInput?.exact === true && typeof p.nativeInput.text === 'string' && sha256(Buffer.from(p.nativeInput.text, 'utf8')) === p.stdin?.sha256;
  return [
    check('transport:one-native-process', processes.length === 1 && !p.outOfCase && !p.unexpectedShape, processes.length + ' native CLI process(es)'),
    // The retained native input is the exact stdin bytes (its hash recomputed) and is bound to this attempt's frozen request.
    check('evidence:native-input-exact', processes.length === 1 && exactInput && p.binding?.resolvedSha256 === request?.resolvedSha256 && p.binding?.normalizedSha256 === request?.normalizedSha256, p.nativeInput?.withheld ? 'withheld: ' + p.nativeInput.reason : exactInput ? 'exact input retained; binding ' + JSON.stringify(p.binding || null) : 'native input missing or not matching its byte hash'),
    check('transport:observer-clean', processes.length === 1 && !p.observerFailure && (row.transport !== 'stream-json' || p.forwardedBeforeClose === true), p.observerFailure || (row.transport === 'stream-json' ? 'forwardedBeforeClose ' + p.forwardedBeforeClose : 'passive')),
    check('transport:native-input-boundary', !!p.boundary?.parsed && p.boundary.currentMessageMatchesFrozen === true && p.boundary.evaluatorExpectationAbsent === true && p.boundary.rubricLabelAbsent === true, JSON.stringify(p.boundary || null)),
    check('transport:native-envelope', !!p.envelope, p.envelopeParse || 'final result envelope ' + (p.envelope ? 'present' : 'missing')),
    check('native:exit-zero', p.exitCode === 0 && !p.signal && !env.isError, 'exit ' + p.exitCode + (p.signal ? ' signal ' + p.signal : '') + (env.isError ? ' is_error' : '')),
    // The requested accountant model must be among the models the native envelope reports; any other (internal helper) model is
    // recorded in the detail as an observation, never hidden.
    check('native:requested-model-observed', Array.isArray(env.modelNames) && env.modelNames.some(n => n.startsWith(p.args?.find(x => x[0] === '--model')?.[1] || '\u0000')), 'requested ' + (p.args?.find(x => x[0] === '--model')?.[1] || null) + '; observed ' + JSON.stringify(env.modelNames || [])),
    // Vault option only: the credential reached the native child through the product's own environment (its key name is present in
    // the options the interpreter built) and the observer added nothing.
    ...(auth === 'vault' ? [check('transport:vault-credential-in-native-env-without-overlay', processes.length === 1 && p.auth?.overlay === false && p.optionsIdentityPreserved === true && (p.envKeys || []).includes(AUTH_KEY), 'overlay ' + p.auth?.overlay + '; key ' + ((p.envKeys || []).includes(AUTH_KEY) ? 'present' : 'absent'))] : [])
  ];
}
// Zero-model selftest: the synthetic agent claims the queued job through the owned observer (so the evidence has the same shape as a
// draw), runs the case's scripted native actions, and posts its synthetic reply through the native result route.
async function scriptedTurn(ctx, rt, row, design, state, turn) {
  const post = async (route, body) => { const r = await fetch(rt.http.origin + '/api/finance-chat/worker/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ctx.agent.token }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) }); const text = await r.text(); let data; try { data = JSON.parse(text); } catch {} return { status: r.status, data, raw: text }; };
  const capability = { publicResearch: { version: 1, webSearch: true, publicPage: true, chrome: true, registry: 'connection_required' } };
  let claimed = await post('workspace-claim', row.realm === 'company' ? { capabilities: capability } : {}), job = claimed.data?.job;
  if (!job && row.endpoint === 'purchase') { claimed = await post('claim', {}); job = claimed.data?.job; }
  if (!job) throw new SetupError('selftest claim found no job ' + claimed.status);
  const prefix = (job.mode === 'workspace' ? 'workspace/' : '') + job.id; let slot = 1;
  const j = { job, async act(name, args = {}) { const r = await post(prefix + '/actions', { lease: job.lease, slot: slot++, name, args }); if (r.status !== 200) throw new SetupError('selftest action ' + name + ' ' + r.status + ' ' + r.raw.slice(0, 300)); return r.data; }, async source(body) { const r = await post(prefix + '/sources', { lease: job.lease, ...body }); if (r.status !== 200) throw new SetupError('selftest source ' + r.status + ' ' + r.raw.slice(0, 300)); return r.data; } };
  const proposal = await turn(ctx, state, j);
  const r = await post(prefix + '/result', { lease: job.lease, proposal });
  if (r.status !== 200) throw new SetupError('selftest result ' + r.status + ' ' + r.raw.slice(0, 300));
  return proposal;
}
// The attempt file keeps the full evidence; a known credential found in it is replaced, the attempt becomes a harness failure and
// the replaced file is never presented as exact.
async function finishRecord(plan, rec, secrets) {
  rec.finishedAt = new Date().toISOString();
  const known = (typeof secrets === 'function' ? secrets() : secrets || []).filter(s => typeof s === 'string' && s.length >= 8);
  let text = JSON.stringify(rec, null, 2);
  for (const s of known) if (text.includes(s)) { text = text.split(s).join('[REDACTED]'); rec.secretRedacted = true; }
  if (rec.secretRedacted) { rec.status = 'harness-failure'; rec.layer = 'evidence-redaction'; text = JSON.stringify({ ...JSON.parse(text), status: rec.status, layer: rec.layer, evidenceNote: 'a known synthetic credential was found and replaced: this file is not the exact evidence' }, null, 2); }
  await writeExclusive(path.join(plan.out, 'attempts', rec.attemptId + '.json'), text + '\n');
  const { request, turn, native, http, effects, checks, baseline, documents, research, ...summary } = rec;
  return { ...summary, ...(research ? { research: { webSearchRequests: research.webSearchRequests, capturedSources: research.capturedSources.length, captureAttempts: research.captureAttempts.length } } : {}), checks: (checks || baseline || []).map(c => ({ name: c.name, pass: c.pass })), failed: (checks || []).filter(c => !c.pass).map(c => c.name + ': ' + c.detail).slice(0, 12), processCount: native?.processCount ?? null, internalTurns: native?.internalTurns ?? null, requestedModel: native?.requestedModel ?? null, observedModels: [...new Set((native?.processes || []).flatMap(p => p.envelope?.modelNames || []))], normalizedSha256: request?.normalizedSha256 ?? null };
}
function resultTable(plan, attempts, extra = {}) {
  const statuses = ['deterministic-pass', 'deterministic-fail', 'product-failure', 'native-failure', 'harness-failure', 'setup-failure', 'not-run', 'prepared', 'defect-detected', 'defect-missed'];
  const by = cohort => Object.fromEntries(statuses.map(s => [s, attempts.filter(a => a.status === s && (!cohort || a.cohort === cohort)).length]));
  return { batch: plan.batch, mode: plan.mode, attemptKind: plan.attempt, reason: plan.reason, denominators: denominators(plan.rows), counts: { total: by(null), core: by(COHORT.core), historical: by(COHORT.historical), ...(plan.rows.some(r => r.cohort === SUPPLEMENTAL_COHORT) ? { supplemental: by(SUPPLEMENTAL_COHORT) } : {}) }, manualGrades: plan.mode === 'manual' ? 'PENDING' : 'not-applicable', note: 'Every selected case stays in its denominator: a setup, transport, native or product failure is a failed attempt with its layer, never a pass. Additional attempts are separate batches with a named reason and never replace an initial attempt.', attempts, ...extra };
}
function tableMarkdown(t) {
  const lines = ['# Navi agent model corpus — ' + t.batch + ' (' + t.mode + ', ' + t.attemptKind + ')', '', (t.denominators.supplemental ? 'Selected supplemental questions: ' + t.denominators.selected + ' of the separately declared ' + t.denominators.declaredSupplemental + ' (not part of the original 62 or any of its cohorts)' : 'Selected population: ' + t.denominators.selected + ' (core ' + t.denominators.core + ', historical wording ' + t.denominators.historical + ') of the declared 62 (56 + 6)') + '. Manual grades: ' + t.manualGrades + '.', '', '| case | cohort | status | layer | native processes | internal turns | failed checks |', '|---|---|---|---|---|---|---|'];
  for (const a of t.attempts) lines.push('| ' + a.caseId + ' | ' + (a.cohort === COHORT.core ? 'core' : a.cohort === SUPPLEMENTAL_COHORT ? 'supplemental' : 'historical') + ' | ' + a.status + ' | ' + (a.layer || '') + ' | ' + (a.processCount ?? '') + ' | ' + (a.internalTurns || []).join(',') + ' | ' + String((a.failed || []).join('; ') || a.error || a.detail || '').replace(/\|/g, '/').slice(0, 300) + ' |');
  lines.push('', 'Counts (total): ' + JSON.stringify(t.counts.total), 'Counts (core): ' + JSON.stringify(t.counts.core), 'Counts (historical): ' + JSON.stringify(t.counts.historical), ...(t.counts.supplemental ? ['Counts (supplemental): ' + JSON.stringify(t.counts.supplemental)] : []), '', t.note);
  return lines.join('\n') + '\n';
}

// ---- Lifecycle mode (explicit, zero model, no case): the corpus's own startRuntime/stopRuntime under injected faults, with an
// owned mongod and the built application. No synthetic owner, agent, worker or CLI is created; the only HTTP is owned loopback.
const LIFECYCLE_SCENARIOS = Object.freeze([
  { id: 'normal' },
  { id: 'fault-during-mongo-start', point: 'during-mongo-start' },
  { id: 'fault-after-mongo-start', point: 'after-mongo-start' },
  { id: 'fault-after-app-spawn', point: 'after-app-spawn' },
  { id: 'fault-after-health', point: 'after-health' },
  { id: 'cleanup-failure', failStep: 'temp-directory' },
  { id: 'fault-and-cleanup-failure', point: 'after-health', failStep: 'temp-directory' },
  // The first source's defect, reintroduced on purpose: cleanup without the partial runtime (the caller's reference stayed null).
  { id: 'defect-lost-partial-reference', point: 'after-app-spawn', lostReference: true }
]);
export const LIFECYCLE = Object.freeze(LIFECYCLE_SCENARIOS.map(s => s.id));
const STAGES = ['during-mongo-start', 'after-mongo-start', 'after-app-spawn', 'after-health'];
async function safetyRemove(dir) {
  if (!dir || !fs.existsSync(dir)) return 'nothing-left';
  const resolved = path.resolve(dir), base = path.resolve(os.tmpdir());
  if (!resolved.startsWith(base + path.sep) || !path.basename(resolved).startsWith('omf-navi-agent-model-')) return 'refused: unsafe path';
  try { await fsp.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch (e) { return 'failed: ' + String(e?.message || e).slice(0, 160); }
  return fs.existsSync(resolved) ? 'failed: still present' : 'ok';
}
async function lifecycleScenario(sc, plan, root, log) {
  const rt = { secrets: new Set() }, r = { scenario: sc.id, injectedFault: sc.point || null, injectedCleanupFault: sc.failStep || null, startedAt: new Date().toISOString() };
  let primary = null;
  const fault = async point => {
    if (point !== sc.point) return;
    if (point === 'during-mongo-start') r.mongoStartPendingAtFault = !!rt.mongoStarting && rt.mongoStarted === undefined;
    throw Object.assign(new SetupError('injected lifecycle fault at ' + point), { injected: true });
  };
  try {
    await startRuntime(root, plan, log, rt, fault);
    // A normal start must stay usable: owned health through the loopback observer and an owned database read.
    const health = await (await fetch(rt.http.origin + '/api/health', { signal: AbortSignal.timeout(10000) })).json();
    r.normalUse = { healthThroughObserver: health?.database?.connected === true && health.database.name === rt.dbName, observedEvents: rt.http.events.length, ownedOrganizations: await rt.db.collection('organizations').countDocuments() };
  } catch (e) { primary = e; }
  r.primaryError = primary ? String(primary.message || primary).slice(0, 300) : null; r.primaryInjected = primary?.injected === true;
  r.reached = { tempDirectory: !!rt.dir, mongoInstance: !!rt.mongo, mongoStartPending: !!rt.mongoStarting, app: !!rt.app, databaseClient: !!rt.client, observer: !!rt.http };
  if (sc.lostReference) {
    r.defectCleanup = await stopRuntime(null);
    mongoHandles(rt);
    r.afterDefectCleanup = ownedProcessStates(rt);
    r.defect = { cleanupReported: Object.values(r.defectCleanup).every(v => v === 'ok') ? 'every step ok (the false green)' : 'a step failed', detected: !ownedProcessesExited(rt), by: 'lifecycle:owned-processes-exited' };
  }
  r.cleanup = await stopRuntime(rt, { failStep: sc.failStep || null });
  r.ownedProcesses = ownedProcessStates(rt); r.processesExited = ownedProcessesExited(rt);
  r.tempDirectoryPresentAfterCleanup = rt.dir ? fs.existsSync(rt.dir) : null;
  r.overallPass = overallPass({ fatal: primary, attempts: [{ status: 'control' }], expected: 'control', selected: 1, cleanup: r.cleanup, secretFindings: 0 });
  if (sc.failStep) r.safetyRemoval = await safetyRemove(rt.dir);
  const cleanupOk = Object.values(r.cleanup).every(v => v === 'ok'), stage = STAGES.indexOf(sc.point), expect = [];
  const want = (name, pass, detail) => expect.push(check(name, pass, detail));
  want('lifecycle:owned-processes-exited', r.processesExited, JSON.stringify(r.ownedProcesses));
  want('lifecycle:temp-directory-removed', sc.failStep ? r.tempDirectoryPresentAfterCleanup === true && r.safetyRemoval === 'ok' : r.tempDirectoryPresentAfterCleanup === false, sc.failStep ? 'kept by the injected cleanup fault, then safety removal ' + r.safetyRemoval : 'present after cleanup: ' + r.tempDirectoryPresentAfterCleanup);
  if (!sc.point) want('lifecycle:normal-start-usable', r.normalUse?.healthThroughObserver === true && r.normalUse.ownedOrganizations === 0 && r.normalUse.observedEvents >= 1, JSON.stringify(r.normalUse || null));
  else {
    want('lifecycle:primary-error-kept', r.primaryInjected && r.primaryError.includes(sc.point), r.primaryError);
    want('lifecycle:partial-resources-reached', r.reached.mongoInstance && (stage < 2 || r.reached.app) && !!r.ownedProcesses.mongod && (stage < 2 || !!r.ownedProcesses.app), JSON.stringify({ reached: r.reached, captured: Object.fromEntries(Object.entries(r.ownedProcesses).map(([k, v]) => [k, !!v])) }));
  }
  if (sc.point === 'during-mongo-start') want('lifecycle:fault-while-mongo-start-pending', r.mongoStartPendingAtFault === true, 'pending at fault: ' + r.mongoStartPendingAtFault);
  if (sc.failStep) want('lifecycle:cleanup-failure-reported-separately', String(r.cleanup[sc.failStep] || '').startsWith('failed') && Object.entries(r.cleanup).every(([k, v]) => k === sc.failStep || v === 'ok') && (sc.point ? r.primaryInjected : r.primaryError === null), JSON.stringify({ cleanup: r.cleanup, primaryError: r.primaryError }));
  else want('lifecycle:cleanup-all-ok', cleanupOk, JSON.stringify(r.cleanup));
  want(sc.point || sc.failStep ? 'lifecycle:overall-false' : 'lifecycle:overall-true', r.overallPass === !(sc.point || sc.failStep), 'overallPass ' + r.overallPass);
  if (sc.lostReference) want('lifecycle:lost-reference-detected', r.defect.detected === true && r.defect.cleanupReported.startsWith('every step ok'), JSON.stringify(r.defect));
  r.expectations = expect; r.asExpected = expect.every(c => c.pass); r.finishedAt = new Date().toISOString();
  log('lifecycle ' + sc.id + ': ' + (r.asExpected ? 'as expected' : 'NOT as expected ' + expect.filter(c => !c.pass).map(c => c.name).join(',')));
  return r;
}
async function runLifecycle(plan, root, log) {
  verifyDeclaration();
  try { os.setPriority(0, os.constants.priority.PRIORITY_LOW); } catch {}
  await fsp.mkdir(plan.out, { recursive: true });
  const identity = sourceIdentity(root), startedAt = new Date().toISOString();
  await writeExclusive(path.join(plan.out, 'batch.json'), { batch: plan.batch, mode: plan.mode, startedAt, identity, scenarios: LIFECYCLE, processPriority: (() => { try { return os.getPriority(0); } catch { return null; } })(), note: 'Explicit zero-model lifecycle controls: owned mongod and built application on loopback, injected startup and cleanup faults, no case, owner, agent, worker or CLI.' });
  const results = [];
  for (const sc of LIFECYCLE_SCENARIOS) {
    try { results.push(await lifecycleScenario(sc, plan, root, log)); } catch (e) { results.push({ scenario: sc.id, asExpected: false, harnessError: String(e?.stack || e).slice(0, 600) }); }
  }
  await writeExclusive(path.join(plan.out, 'lifecycle.json'), { batch: plan.batch, startedAt, finishedAt: new Date().toISOString(), results });
  const secretScan = await scanArtifacts(plan.out, []);
  const pass = results.length === LIFECYCLE_SCENARIOS.length && results.every(r => r.asExpected === true);
  const summary = { mode: plan.mode, batch: plan.batch, out: plan.out, scenarios: results.map(r => ({ scenario: r.scenario, asExpected: r.asExpected, primaryError: r.primaryError ?? null, cleanup: r.cleanup ?? null, failed: (r.expectations || []).filter(c => !c.pass).map(c => c.name + ': ' + c.detail), harnessError: r.harnessError })), nativeCliProcesses: 0, processesReportingModelUsage: 0, actualModelDraws: 0, externalNetwork: 'none (owned loopback application, mongod and observer only)', secretScan: { files: secretScan.files, findings: secretScan.findings.length, markersChecked: 0 }, limits: 'Owned startup/cleanup controls only; no product-model, case or reliability coverage.' };
  await writeExclusive(path.join(plan.out, 'outcome.json'), { ...summary, pass, finishedAt: new Date().toISOString() });
  return { pass, summary, databaseCoverage: { executed: results.some(r => r.normalUse?.healthThroughObserver === true), ownedProcess: true } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length > 2) { console.error('This entry only prints the declared population. Explicit modes run through scripts/zoomer-fixtures/omf-navi-agent-model.mjs (docs/navi-agent-model-evaluation.md).'); process.exitCode = 2; }
  else console.log(JSON.stringify(populationReport()));
}
