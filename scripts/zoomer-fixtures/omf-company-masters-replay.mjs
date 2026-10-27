// Replay of the real supplier, customer and tax-category rows (plan omf-tenant-masters-20261026 §4 replay) on an owned throwaway
// database through the hub verifier only:
//   REPLAY_INPUT=<export> REPLAY_OUT=<result> node scripts/zoomer-verify.mjs --run-fixture omf-company-masters-replay.mjs --cwd <tree>
// The export (extended JSON, read by path at run time, never copied into this public repository) carries `collections`:
// suppliers, customers, taxcategories (the rows) and organizations (companions: name, isActive, createdAt). Every row is loaded
// verbatim into an empty memory MongoDB; the companion organizations are loaded as exported plus the one addition a company token
// needs (a synthetic member user and a slug). The entry is the three GET list handlers (and the id handlers) of the BUILT app, driven
// as each exported company; per row the result records production's outcome (listed to every authenticated caller at 0727c0c), the
// changed code's outcome, the sends (none: reads only) and `same`. A row no company lists is the plan's intended no-backfill outcome.
// With REPLAY_INPUT unset this fixture exports `covers: []`, passes with the note "no replay input" and grants NO coverage.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), input = process.env.REPLAY_INPUT || '', out = process.env.REPLAY_OUT || '';
const require = createRequire(import.meta.url);
const exported = input ? JSON.parse(readFileSync(input, 'utf8')) : null;
const ROW_COLLECTIONS = [['suppliers', '/api/suppliers'], ['customers', '/api/customers'], ['taxcategories', '/api/tax-categories']];
const rowCount = exported ? ROW_COLLECTIONS.reduce((n, [c]) => n + (exported.collections?.[c]?.length || 0), 0) : 0;
const covers = rowCount ? ['server/api/suppliers/index.ts', 'server/api/suppliers/[id].ts', 'server/api/customers/index.ts', 'server/api/customers/[id].ts', 'server/api/tax-categories/index.ts', 'server/models/Supplier.ts', 'server/models/Customer.ts', 'server/models/TaxCategory.ts'] : [];
export const timeoutMs = 900000;
const pause = ms => new Promise(r => setTimeout(r, ms));
export default { name: 'omf-company-masters-replay', covers, async run() {
  if (!input) return { pass: true, message: 'no replay input: REPLAY NOT RUN (REPLAY_INPUT unset); this fixture exports covers: [] and grants no coverage' };
  if (!rowCount) return { pass: false, message: 'REPLAY NOT RUN: zero exported rows' };
  if (!out) return { pass: false, message: 'REPLAY_OUT required' };
  if (!existsSync(path.join(root, '.output', 'server', 'index.mjs'))) return { pass: false, message: 'REPLAY NOT RUN: .output/server/index.mjs is missing (run nuxt build first)' };
  const { EJSON } = require('bson'), { MongoMemoryServer } = require('mongodb-memory-server'), { MongoClient, ObjectId } = require('mongodb');
  // The hand-read export carries ids as 24-hex strings and dates as ISO strings (not extended JSON): restore production's
  // BSON shapes (ObjectId, Date) for the id and timestamp fields only; every other field stays verbatim.
  const hex24 = v => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v), iso = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) && Number.isFinite(Date.parse(v));
  const revive = row => { const r = { ...row }; if (hex24(r._id)) r._id = new ObjectId(r._id); if (hex24(r.organizationId)) r.organizationId = new ObjectId(r.organizationId); for (const k of ['createdAt', 'updatedAt']) if (iso(r[k])) r[k] = new Date(r[k]); return r; };
  const data = EJSON.deserialize(exported); for (const k of Object.keys(data.collections || {})) data.collections[k] = (data.collections[k] || []).map(revive);
  const organizations = data.collections.organizations || [];
  if (organizations.length !== 2) return { pass: false, message: 'REPLAY NOT RUN: expected the 2 exported organizations, found ' + organizations.length };
  const binary = path.resolve(root, '../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  let mongo, child, client, directory, logs = '';
  const results = [], sends = [];
  try {
    directory = await mkdtemp(path.join(os.tmpdir(), 'omf-masters-replay-'));
    // A loaded machine (another fixture building or booting) must not turn into a false harness failure: generous launch budget.
    mongo = await MongoMemoryServer.create({ binary: existsSync(binary) ? { systemBinary: binary, version: '8.2.1' } : undefined, instance: { launchTimeout: 120000 } });
    const dbName = 'company_masters_replay_owned', uri = mongo.getUri(dbName), secret = randomBytes(32).toString('hex');
    const listener = net.createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r)); const port = listener.address().port; await new Promise(r => listener.close(r)); const origin = 'http://127.0.0.1:' + port;
    child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: root, windowsHide: true, env: { ...process.env, MONGO_URI: uri, MONGODB_URI: uri, NUXT_MONGO_URI: uri, OMF_DATA_DIR: directory, JWT_SECRET: secret, NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.closed = new Promise(r => child.once('close', r)); for (const s of [child.stdout, child.stderr]) s.on('data', v => { logs = (logs + v).slice(-8000); });
    let spawnError = '', lastHealth = ''; child.on('error', e => { spawnError = String(e?.message || e); });
    let healthy = false; for (let i = 0; i < 300; i++) { try { const r = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) }), d = await r.json(); lastHealth = r.status + ' ' + JSON.stringify(d).slice(0, 200); if (d.database?.connected && d.database.name === dbName) { healthy = true; break; } } catch (e) { lastHealth = 'error ' + String(e?.cause?.message || e?.message || e); } await pause(200); }
    if (!healthy) throw Error('owned app did not become healthy: exit=' + child.exitCode + ' spawnError=' + spawnError + ' lastHealth=' + lastHealth + ' execPath=' + process.execPath + ' logs=' + logs.slice(-1200));
    client = await MongoClient.connect(uri); const db = client.db(dbName);
    const call = async (route, token, method = 'GET', body) => { const r = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) }), raw = await r.text(); let json; try { json = JSON.parse(raw); } catch {} return { status: r.status, data: json, raw }; };
    // The rows exactly as exported; the companion organizations as exported plus the synthetic member the token needs.
    for (const [name] of ROW_COLLECTIONS) if (data.collections[name]?.length) await db.collection(name).insertMany(data.collections[name]);
    const registered = await call('/api/auth/register', null, 'POST', { email: 'replay-member@example.invalid', password: 'Synthetic-password-Only1!', name: 'Replay member' });
    if (registered.status !== 200) throw Error('register failed ' + registered.raw.slice(0, 300));
    const member = (await db.collection('users').findOne({ email: 'replay-member@example.invalid' }))._id, now = new Date();
    await db.collection('organizations').insertMany(organizations.map((o, i) => ({ ...o, slug: o.slug || 'replay-company-' + i, members: [{ userId: member, role: 'owner', joinedAt: now }] })));
    const companies = [];
    for (const o of organizations) { const r = await call('/api/auth/switch-organization', registered.data.tokens.accessToken, 'POST', { organizationId: String(o._id) }); if (r.status !== 200) throw Error('switch-organization failed for an exported company: ' + r.raw.slice(0, 300)); companies.push({ id: String(o._id), token: r.data.tokens.accessToken }); }
    // The entry: the list handlers as each company (and the id handlers where they exist).
    const listed = new Map();
    for (const [name, route] of ROW_COLLECTIONS) for (const company of companies) { const r = await call(route, company.token); if (r.status !== 200) throw Error('list failed ' + route + ' ' + r.status + ' ' + r.raw.slice(0, 200)); for (const row of r.data) { const key = name + ':' + String(row._id || row.id); listed.set(key, [...(listed.get(key) || []), company.id]); } }
    for (const [name, route] of ROW_COLLECTIONS) for (const row of data.collections[name] || []) {
      const id = String(row._id), key = name + ':' + id, byCompany = listed.get(key) || [];
      const idReads = [];
      if (name !== 'taxcategories') for (const company of companies) idReads.push((await call(route + '/' + id, company.token)).status);
      const stored = await db.collection(name).findOne({ _id: row._id });
      const identical = JSON.stringify(EJSON.serialize(stored)) === JSON.stringify(EJSON.serialize(row));
      const newOutcome = byCompany.length ? 'listed to company ' + byCompany.join(',') : 'listed to no company' + (idReads.length ? ' (id read ' + idReads.join('/') + ')' : '');
      results.push({ collection: name, id, productionOutcome: 'listed to every authenticated caller (row carries no company at 0727c0c)', newOutcome, byteIdentical: identical, sends: [], same: false,
        label: !identical ? 'UNEXPLAINED: row bytes changed' : byCompany.length ? 'UNEXPLAINED: a company lists a row that carries no organizationId' : 'INTENDED: plan §2 "No backfill" and §4 replay expect 0 rows listed to either company; the one-time assignment is the owner\'s decision' });
    }
  } catch (error) {
    results.push({ id: null, productionOutcome: null, newOutcome: 'harness error: ' + String(error?.message || error).slice(0, 400), same: false, label: 'UNEXPLAINED: the harness could not run' });
  } finally { if (child) { child.kill(); await child.closed; } if (client) await client.close(); if (mongo) await mongo.stop({ doCleanup: true, force: true }).catch(() => {}); if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {}); }
  const unexplained = results.filter(r => r.label.startsWith('UNEXPLAINED')).length, intended = results.filter(r => r.label.startsWith('INTENDED')).length;
  await writeFile(out, JSON.stringify({ source: exported.source, readAt: exported.readAt, exported: rowCount, replayed: results.filter(r => r.id).length, same: 0, intended, unexplained, sends: [...new Set(sends)], companions: { organizations: organizations.length, adjustment: 'each organization loaded as exported plus a slug and one synthetic member user (needed for a company token)' }, inputShape: 'the export carries ids as 24-hex strings and dates as ISO strings; _id, organizationId, createdAt and updatedAt were restored to ObjectId/Date before loading, every other field verbatim', rows: results }, null, 2));
  return { pass: unexplained === 0 && results.filter(r => r.id).length === rowCount, databaseCoverage: { executed: true, ownedProcess: true }, message: `replayed ${results.filter(r => r.id).length}/${rowCount} rows as ${organizations.length} companies — ${intended} INTENDED different (listed to nobody, byte-identical), ${unexplained} UNEXPLAINED (listed in ${out}; the owner decides)` };
} };
