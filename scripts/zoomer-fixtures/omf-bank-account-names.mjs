// Fixture for plan omf-bank-account-names-20261024: the owner renames an EXISTING bank account (BankAccount.name) through
// PUT /api/finance-payments/bank/accounts/:id and the inline editor in components/intake/BankConnections.vue; only the name changes.
// Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-bank-account-names.mjs --cwd <this worktree>
// Evidence, stated exactly: synthetic only. The built app (.output) runs on an owned mongodb-memory-server (test commands enabled
// for one blocking fail point on the app's own connection) with fictional owners, banks, labels, rows, jobs and companies; the PC is
// the HTTP collector API with a synthetic device token; Chrome is owned and headless and opens only the owned app. No bank, network,
// credential, model or production database is touched. Legs:
//   A  scripts/finance-bank-account-names-integration.cjs world + API legs (O W A C N X D I B K) on its own app and database;
//   V  the same helper's world + Chrome leg on a fresh app and database (so a tree without the editor shows its own RED);
//   R  the existing bank collection integration, unchanged (scripts/finance-integration.cjs → finance-bank-collection-integration.cjs,
//      its own owned MongoDB, hidden Chrome V leg on BankConnections.vue);
//   M  an unchanged packaged copy (control) and four defects in copies of the built server chunks, each must flip its named assertion.
// OMF_NAMES_EVIDENCE (optional): a directory for the screenshots and leg logs of this run.
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const timeoutMs = 2400000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const requireRoot = createRequire(path.join(root, 'package.json'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const COVERS = ['server/services/financeBankStatementService.ts', 'server/api/finance-payments/[...path].ts', 'components/intake/BankConnections.vue', 'scripts/finance-bank-account-names-integration.cjs', 'scripts/zoomer-fixtures/omf-bank-account-names.mjs'];
const BINARY = path.join(root, '..', 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
const EVIDENCE = process.env.OMF_NAMES_EVIDENCE || '';

// ── The built app on the owned MongoDB (the bootstrap of omf-bank-classification-review-fold.mjs; the app's connection carries an
//    appName so one fail point blocks exactly its next findAndModify; the Aplus schedule is off) ──
async function availablePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function bootApp(outputRoot, mongo, dbName, directory) {
  const appName = 'omf-names-' + dbName, base = new URL(mongo.getUri(dbName)); base.searchParams.set('appName', appName);
  const uri = base.toString(), port = await availablePort(), origin = `http://127.0.0.1:${port}`; let logs = '';
  const child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: outputRoot, windowsHide: true, env: { ...process.env, MONGO_URI: uri, NUXT_MONGO_URI: uri, MONGODB_URI: '', OMF_DATA_DIR: directory, OMF_SYNC_SCHEDULE_MS: '0', JWT_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const { MongoClient } = requireRoot('mongodb'), client = await MongoClient.connect(mongo.getUri(dbName)), admin = client.db('admin');
  const failPoint = spec => admin.command(spec ? { configureFailPoint: 'failCommand', mode: spec.mode, data: { ...spec.data, appName } } : { configureFailPoint: 'failCommand', mode: 'off' });
  return { origin, call, token, other, client, db: client.db(dbName), failPoint, logs: () => logs, async close() { await client.close().catch(() => {}); if (child.exitCode === null) { const ended = new Promise(r => child.once('exit', r)); child.kill(); await ended; } } };
}
const contextOf = (app, passed, extra = {}) => ({ db: app.db, call: app.call, origin: app.origin, token: app.token, other: app.other, pass: name => passed.push(name.split(' ')[0]), root, pause, failPoint: app.failPoint, ...extra });

// ── M: one defect per copy of the built server chunks (anchors located in the compiled code, exactly one hit each) ──
const SERVER_MUTANTS = [
  ['MN1-owner-predicate-dropped', /_id:\s*id\(accountId\),\s*ownerId,\s*name:\s*\{\s*\$ne:\s*name\s*\}/g, '_id: id(accountId), name: { $ne: name }', /names:wrong-owner/],
  ['MN2-body-mass-assigned', /\$set:\s*\{\s*name\s*\}/g, '$set: { ...body, name }', /names:injection/],
  ['MN3-stale-connection-written', /\$set:\s*\{\s*name\s*\}/g, '$set: { name, connection: (await BankAccount.findOne({ _id: id(accountId), ownerId }).lean())?.connection }', /names:concurrent-connection/],
  ['MN4-rename-ignored', /const saved = await BankAccount\.findOneAndUpdate\(/g, 'const saved = null && await BankAccount.findOneAndUpdate(', /names:route-response|names:persisted/]
];
async function chunkFiles(dir) { const out = []; for (const e of await readdir(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) out.push(...await chunkFiles(f)); else if (e.name.endsWith('.mjs')) out.push(f); } return out; }

export default { name: 'omf-bank-account-names', covers: COVERS, async run() {
  const started = Date.now(), lines = []; let pass = true; const green = new Set(), counts = { apiLegs: 0, chromeLegs: 0, regressionChecks: null, mutantsCaught: 0, mutantsTotal: SERVER_MUTANTS.length };
  const leg = async (name, fn) => { const t = Date.now(); try { lines.push(name + ': ' + await fn() + ` (${Math.round((Date.now() - t) / 1000)}s)`); green.add(name.split(' ')[0]); } catch (e) { pass = false; lines.push(name + ': RED ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 1400)); } };
  const keep = async (name, text) => { if (EVIDENCE) { await mkdir(EVIDENCE, { recursive: true }); await writeFile(path.join(EVIDENCE, 'leg-' + name + '.txt'), text); } };
  const base = await mkdtemp(path.join(os.tmpdir(), 'omf-names-fixture-'));
  let mongo = null; const apps = []; let executed = false;
  try {
    if (!existsSync(path.join(root, '.output/server/index.mjs'))) throw new Error('NOT RUN: built app absent; no HTTP coverage');
    const { MongoMemoryServer } = requireRoot('mongodb-memory-server');
    mongo = await MongoMemoryServer.create({ binary: existsSync(BINARY) ? { systemBinary: BINARY, version: '8.2.1' } : undefined, instance: { args: ['--setParameter', 'enableTestCommands=1'] } });
    const boot = async (outputRoot, dbName) => { const app = await bootApp(outputRoot, mongo, dbName, path.join(base, 'data-' + dbName)); apps.push(app); executed = true; return app; };
    const integration = createRequire(import.meta.url)(path.join(root, 'scripts/finance-bank-account-names-integration.cjs'));
    await leg('A API legs on the built app: O creation, W world, A rename, C consumers, N refused, X owner scope, D duplicate/no-op, I injection, B boundary/second provider/unconnected, K concurrency (fail point)', async () => {
      const app = await boot(root, 'names_api'), passed = [];
      try { await integration(contextOf(app, passed)); } catch (e) { e.message += ' | app log: ' + app.logs().slice(-1200); throw e; } finally { counts.apiLegs = passed.length; await keep('A', passed.join('\n') + '\n--- app log ---\n' + app.logs()); }
      return passed.join(', ');
    });
    await leg('V Chrome leg on a fresh built app: inline edit, cancel, refused duplicate, save, reload, importer choice, Escape/Enter, 390/1440 px, dark', async () => {
      const app = await boot(root, 'names_ui'), passed = [], shots = EVIDENCE ? path.join(EVIDENCE, 'screenshots') : null;
      const ctx = contextOf(app, passed, { screenshots: shots });
      try { const w = await integration.world(ctx); await integration.chrome(ctx, w); } catch (e) { e.message += ' | app log: ' + app.logs().slice(-1200); throw e; } finally { counts.chromeLegs = passed.filter(n => n === 'V').length; await keep('V', passed.join('\n') + '\n--- app log ---\n' + app.logs()); }
      return passed.join(', ') + (shots ? '; screenshots ' + shots : '');
    });
    await leg('R existing bank collection integration, unchanged (scripts/finance-integration.cjs → finance-bank-collection-integration.cjs, own owned MongoDB, hidden Chrome)', async () => {
      const r = await new Promise(resolve => execFile(process.execPath, ['scripts/finance-integration.cjs'], { cwd: root, windowsHide: true, timeout: 900000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', OMF_TEST_BANK_COLLECTION_ONLY: '1', ...(existsSync(BINARY) ? { MONGOMS_SYSTEM_BINARY: BINARY } : {}) } }, (e, stdout, stderr) => resolve({ code: e ? e.code || 1 : 0, stdout: String(stdout), stderr: String(stderr) })));
      await keep('R', r.stdout + '\n--- stderr ---\n' + r.stderr);
      const passes = r.stdout.split('\n').filter(l => l.startsWith('PASS ')), summary = r.stdout.match(/(\d+) targeted bank collection checks passed/);
      if (r.code !== 0 || !summary) throw new Error(`exit ${r.code}; last PASS: ${passes.at(-1)?.slice(5, 140) || 'none'}; ` + (r.stdout + r.stderr).replace(/\s+/g, ' ').slice(-1500));
      if (!passes.some(p => /^PASS V hidden real Chrome/.test(p))) throw new Error('the existing Chrome leg on BankConnections.vue did not pass');
      counts.regressionChecks = Number(summary[1]); return summary[0] + `, ${passes.length} PASS lines`;
    });
    await leg('M unchanged packaged control + server mutants MN1 owner predicate, MN2 mass assignment, MN3 stale connection write, MN4 ignored rename (copies of the built chunks, each on its own app)', async () => {
      if (!green.has('A')) throw new Error('NOT RUN: the API legs must be green first');
      const runCopy = async (label, edit) => {
        const copy = path.join(base, 'copy-' + label); await mkdir(copy, { recursive: true }); await cp(path.join(root, '.output'), path.join(copy, '.output'), { recursive: true, dereference: true });
        if (edit) {
          const [anchor, replacement] = edit, chunks = await chunkFiles(path.join(copy, '.output/server/chunks')); let hits = 0;
          for (const f of chunks) { const text = await readFile(f, 'utf8'), n = (text.match(anchor) || []).length; if (n) { hits += n; await writeFile(f, text.replace(anchor, replacement)); } }
          if (hits !== 1) throw new Error(label + ' anchor hits ' + hits + ' ' + anchor);
        }
        const app = await bootApp(copy, mongo, 'names_' + label.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 40), path.join(base, 'data-' + label)); let error = null;
        try { await integration(contextOf(app, [])); } catch (e) { error = e; } finally { await app.close(); await rm(copy, { recursive: true, force: true }).catch(() => {}); }
        return error;
      };
      const control = await runCopy('control', null); if (control) throw new Error('unchanged packaged copy failed: ' + String(control.message).slice(0, 400));
      const caught = [];
      for (const [label, anchor, replacement, pattern] of SERVER_MUTANTS) {
        const error = await runCopy(label, [anchor, replacement]);
        if (!error || !pattern.test(String(error.message))) throw new Error(label + ' did not flip ' + pattern + ': ' + String(error?.message || 'passed').slice(0, 400) + ' (caught so far: ' + caught.join(', ') + ')');
        caught.push(label + '→' + String(error.message).match(pattern)[0]); counts.mutantsCaught++;
      }
      await keep('M', caught.join('\n'));
      return 'control green; ' + caught.join(', ');
    });
  } catch (e) { pass = false; lines.push('setup: RED ' + String(e?.message || e).slice(0, 800)); }
  finally {
    for (const app of apps) await app.close().catch(() => {});
    if (mongo) await mongo.stop().catch(() => {});
    await rm(base, { recursive: true, force: true }).catch(() => {});
  }
  return { pass, databaseCoverage: { executed, ownedProcess: executed }, message: `${pass ? 'green' : 'RED'} in ${Math.round((Date.now() - started) / 1000)}s ${JSON.stringify(counts)}\n` + lines.join('\n') };
} };
