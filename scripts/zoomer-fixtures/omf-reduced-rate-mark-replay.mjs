// Replay of the real transaction rows (plan omf-keigen-mark-20261030 §4 replay) on an owned throwaway database through the hub
// verifier only:
//   REPLAY_INPUT=<export> REPLAY_OUT=<result> node scripts/zoomer-verify.mjs --run-fixture omf-reduced-rate-mark-replay.mjs --cwd <tree>
// The export (MongoDB extended JSON, read by path at run time, never copied into this public repository) carries the transactions and
// their companions: taxcategories, organizations, suppliers, customers, accountcategories, transactioncategories. Every row is loaded
// as exported (canonical types kept) into an empty memory MongoDB; the companion organizations are loaded as exported plus what a
// company token needs (isActive, a slug and one synthetic member user). The entry is the BUILT app's export route (csv, json) and
// GET /api/transactions feeding the list page, driven as each exported company, first on the origin build (the unchanged revision,
// REPLAY_ORIGIN_APP or <tree>/.zoomer/replay-origin: production's outcome) and then on the candidate build (<tree>/.output) against the
// same database. The list page's mark is the shared rule applied to each listed row, exactly as the page renders it. Per row the
// result records the production outcome, the changed code's outcome, the sends (none: reads only, plan.replay.sends is empty) and
// `same`; cell text is recorded only as hash prefixes. With REPLAY_INPUT unset this fixture exports `covers: []`, passes with the note
// "no replay input" and grants NO coverage.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), input = process.env.REPLAY_INPUT || '', out = process.env.REPLAY_OUT || '';
const originRoot = path.resolve(process.env.REPLAY_ORIGIN_APP || path.join(root, '.zoomer', 'replay-origin'));
const require = createRequire(import.meta.url);
const COMPANIONS = ['taxcategories', 'suppliers', 'customers', 'accountcategories', 'transactioncategories'];
let data = null, rowCount = 0;
if (input) { const { EJSON } = require('bson'); data = EJSON.parse(readFileSync(input, 'utf8'), { relaxed: false }); rowCount = Array.isArray(data.transactions) ? data.transactions.length : 0; }
const covers = rowCount ? ['server/api/transactions/export.ts', 'server/api/transactions/index.ts', 'shared/finance-reduced-rate.mjs'] : [];
export const timeoutMs = 900000;
const pause = ms => new Promise(r => setTimeout(r, ms));
const MARK_HEADER = '軽減税率', RATE_HEADER = '税率';
const hash = v => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex').slice(0, 12);
// RFC 4180 cells of one CSV text (the route quotes a cell holding a comma, quote or line break).
const parseCsv = text => { const rows = []; let row = [], cell = '', quoted = false; for (let i = 0; i < text.length; i++) { const ch = text[i]; if (quoted) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch; } else if (ch === '"') quoted = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch; } row.push(cell); rows.push(row); return rows; };
export default { name: 'omf-reduced-rate-mark-replay', covers, async run() {
  if (!input) return { pass: true, message: 'no replay input: REPLAY NOT RUN (REPLAY_INPUT unset); this fixture exports covers: [] and grants no coverage' };
  if (!rowCount) return { pass: false, message: 'REPLAY NOT RUN: zero exported transaction rows' };
  if (!out) return { pass: false, message: 'REPLAY_OUT required' };
  for (const [label, appRoot] of [['candidate', root], ['origin', originRoot]]) if (!existsSync(path.join(appRoot, '.output', 'server', 'index.mjs'))) return { pass: false, message: 'REPLAY NOT RUN: the ' + label + ' build is missing at ' + appRoot + ' (run nuxt build first)' };
  const originRevision = existsSync(path.join(originRoot, 'revision.txt')) ? readFileSync(path.join(originRoot, 'revision.txt'), 'utf8').trim() : null;
  const { EJSON } = require('bson'), { MongoMemoryServer } = require('mongodb-memory-server'), { MongoClient } = require('mongodb');
  const { reducedRateMark } = await import(pathToFileURL(path.join(root, 'shared', 'finance-reduced-rate.mjs')).href);
  const organizations = data.organizations || [];
  if (organizations.length !== 2) return { pass: false, message: 'REPLAY NOT RUN: expected the 2 exported organizations, found ' + organizations.length };
  const binary = path.resolve(root, '../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  let mongo, client, directory, child = null;
  const rows = [], harness = [], fileChecks = {};
  try {
    directory = await mkdtemp(path.join(os.tmpdir(), 'omf-reduced-rate-replay-'));
    mongo = await MongoMemoryServer.create({ binary: existsSync(binary) ? { systemBinary: binary, version: '8.2.1' } : undefined, instance: { launchTimeout: 120000 } });
    const dbName = 'reduced_rate_mark_replay_owned', uri = mongo.getUri(dbName), secret = randomBytes(32).toString('hex');
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) throw Error('the owned database is not the local memory server');
    client = await MongoClient.connect(uri); const db = client.db(dbName);
    // The rows and companions exactly as exported (canonical extended JSON: ObjectId, Date, Int32/Double kept).
    await db.collection('transactions').insertMany(data.transactions);
    const loaded = { transactions: await db.collection('transactions').countDocuments() };
    for (const name of COMPANIONS) { const list = data[name] || []; if (list.length) await db.collection(name).insertMany(list); loaded[name] = list.length; }
    const before = JSON.stringify(EJSON.serialize(await db.collection('transactions').find().sort({ _id: 1 }).toArray()));
    const boot = async appRoot => {
      const listener = net.createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r)); const port = listener.address().port; await new Promise(r => listener.close(r)); const origin = 'http://127.0.0.1:' + port;
      let logs = '';
      child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: appRoot, windowsHide: true, env: { ...process.env, MONGO_URI: uri, MONGODB_URI: uri, NUXT_MONGO_URI: uri, OMF_DATA_DIR: directory, JWT_SECRET: secret, NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
      child.closed = new Promise(r => child.once('close', r)); for (const s of [child.stdout, child.stderr]) s.on('data', v => { logs = (logs + v).slice(-4000); });
      let healthy = false; for (let i = 0; i < 1500; i++) { try { const r = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) }), d = await r.json(); if (d.database?.connected && d.database.name === dbName) { healthy = true; break; } } catch {} await pause(200); }
      if (!healthy) throw Error('owned app did not become healthy at ' + appRoot + ': exit=' + child.exitCode + ' logs=' + logs.slice(-800));
      return origin;
    };
    const stop = async () => { if (child) { child.kill(); await child.closed; child = null; } };
    const call = async (origin, route, token, method = 'GET', body) => { const r = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) }), raw = await r.text(); let json; try { json = JSON.parse(raw); } catch {} return { status: r.status, data: json, raw }; };
    // The entry as each exported company: export csv + json, and the list the page reads.
    const drive = async (origin, companies) => { const got = {}; for (const c of companies) {
      const csv = await call(origin, '/api/transactions/export?format=csv', c.token), json = await call(origin, '/api/transactions/export?format=json', c.token), list = await call(origin, '/api/transactions', c.token);
      for (const [n, r] of [['csv', csv], ['json', json], ['list', list]]) if (r.status !== 200) throw Error(n + ' failed for an exported company: ' + r.status);
      got[c.id] = { csv: csv.raw, json: json.data, list: list.data.transactions };
    } return got; };
    // Origin build (production's outcome): register the synthetic member, load the organizations, take a token per company.
    let origin = await boot(originRoot);
    const registered = await call(origin, '/api/auth/register', null, 'POST', { email: 'replay-member@example.invalid', password: 'Synthetic-password-Only1!', name: 'Replay member' });
    if (registered.status !== 200) throw Error('register failed ' + registered.status);
    const member = (await db.collection('users').findOne({ email: 'replay-member@example.invalid' }))._id, now = new Date();
    await db.collection('organizations').insertMany(organizations.map((o, i) => ({ ...o, isActive: o.isActive ?? true, slug: o.slug || 'replay-company-' + i, members: [...(o.members || []), { userId: member, role: 'owner', joinedAt: now }] })));
    const companies = [];
    for (const o of organizations) { const r = await call(origin, '/api/auth/switch-organization', registered.data.tokens.accessToken, 'POST', { organizationId: String(o._id) }); if (r.status !== 200) throw Error('switch-organization failed for an exported company: ' + r.status); companies.push({ id: String(o._id), token: r.data.tokens.accessToken }); }
    const productionRun = await drive(origin, companies); await stop();
    // Candidate build: same database, same secret, same tokens.
    origin = await boot(root);
    const candidateRun = await drive(origin, companies); await stop();
    const after = JSON.stringify(EJSON.serialize(await db.collection('transactions').find().sort({ _id: 1 }).toArray()));
    fileChecks.transactionsUnchanged = before === after;
    // File level: the candidate header is the origin header with 軽減税率 inserted after 税率 (plan §2 B); no other header change.
    const perCompany = {};
    for (const c of companies) {
      const p = parseCsv(productionRun[c.id].csv), n = parseCsv(candidateRun[c.id].csv), ph = p[0], nh = n[0], at = nh.indexOf(MARK_HEADER);
      if (ph.includes(MARK_HEADER)) throw Error('the origin build already carries the 軽減税率 column: wrong origin build');
      const headerIntended = at === ph.indexOf(RATE_HEADER) + 1 && JSON.stringify(nh.filter((_, i) => i !== at)) === JSON.stringify(ph);
      const strip = cells => cells.filter((_, i) => i !== at);
      perCompany[c.id] = { at, headerIntended, csvRows: { production: p.slice(1), candidate: n.slice(1) }, strip };
      fileChecks[c.id] = { headerIntended, header: headerIntended ? 'INTENDED: 軽減税率 inserted right after 税率 (plan §2 B); every other header cell identical' : 'UNEXPLAINED: header differs beyond the inserted column', productionRows: p.length - 1, candidateRows: n.length - 1, listProduction: productionRun[c.id].list.length, listCandidate: candidateRun[c.id].list.length };
    }
    const find = (run, id, kind) => { for (const c of companies) { const hit = kind === 'csv' ? perCompany[c.id].csvRows[run].find(cells => cells[0] === id) : (run === 'production' ? productionRun : candidateRun)[c.id][kind].find(x => String(x.id ?? x._id) === id); if (hit) return { company: c.id, value: hit }; } return null; };
    for (const tx of data.transactions) {
      const id = String(tx._id);
      try {
        const pc = find('production', id, 'csv'), nc = find('candidate', id, 'csv'), pj = find('production', id, 'json'), nj = find('candidate', id, 'json'), pl = find('production', id, 'list'), nl = find('candidate', id, 'list');
        const listedP = [pc, pj, pl].map(x => x?.company || null), listedN = [nc, nj, nl].map(x => x?.company || null);
        const company = listedP[0] || listedP[2];
        const productionOutcome = company ? 'listed to company ' + company + ' (export csv+json and list); no 軽減税率 cell; the page shows no mark' : 'listed to no company (the row carries no organizationId: neither the export nor the list shows it)';
        if (!company && listedN.every(x => !x) && listedP.every(x => !x)) { rows.push({ id, company: null, productionOutcome, newOutcome: 'listed to no company', sends: [], same: true, label: 'SAME: not listed on either build' }); continue; }
        const cellN = nc ? nc.value[perCompany[nc.company].at] : undefined, markJ = nj ? nj.value.reducedMark : undefined, pageMark = nl ? reducedRateMark(nl.value) : undefined;
        const otherCells = !!pc && !!nc && JSON.stringify(perCompany[nc.company].strip(nc.value)) === JSON.stringify(pc.value);
        const jsonRest = !!pj && !!nj && (() => { const { reducedMark, ...rest } = nj.value; return JSON.stringify(rest) === JSON.stringify(pj.value) && Object.keys(nj.value)[Object.keys(nj.value).indexOf('taxRate') + 1] === 'reducedMark'; })();
        const listSame = !!pl && !!nl && JSON.stringify(nl.value) === JSON.stringify(pl.value);
        const sameCompanies = JSON.stringify(listedP) === JSON.stringify(listedN);
        const unmarked = cellN === '' && markJ === '' && pageMark === '';
        const same = sameCompanies && otherCells && jsonRest && listSame && unmarked;
        const newOutcome = 'listed to company ' + (listedN[0] || listedN[2]) + '; 軽減税率 cell ' + JSON.stringify(cellN) + '; json reducedMark ' + JSON.stringify(markJ) + '; page mark ' + JSON.stringify(pageMark) + '; other csv cells ' + (otherCells ? 'byte-identical' : 'DIFFER') + ' (hash ' + hash(pc?.value || null) + ' -> ' + hash(nc ? perCompany[nc.company].strip(nc.value) : null) + '); json other keys ' + (jsonRest ? 'identical' : 'DIFFER') + '; list row ' + (listSame ? 'identical' : 'DIFFER');
        // A marked row is INTENDED only where the plan's rule says rate 8 from 2019-10-01 JST (§2 A conditions 1-4).
        const ruleSays = reducedRateMark(nl?.value || {});
        let label;
        if (same) label = 'SAME: unmarked on every surface; the inserted 軽減税率 cell is empty and every other cell byte-identical';
        else if (sameCompanies && otherCells && listSame && ruleSays && cellN === ruleSays && markJ === ruleSays && pageMark === ruleSays) label = 'INTENDED: plan §1 "Every transaction at the reduced 8% rate shows ※軽減" (§2 A conditions 1-4)';
        else label = 'UNEXPLAINED: ' + [!sameCompanies && 'listed to different companies', !otherCells && 'other csv cells changed', !jsonRest && 'json keys changed', !listSame && 'list row changed', !unmarked && 'marked where the rule does not say rate 8'].filter(Boolean).join(', ');
        rows.push({ id, company, productionOutcome, newOutcome, sends: [], same, label });
      } catch (e) { rows.push({ id, productionOutcome: null, newOutcome: 'harness error: ' + String(e?.message || e).slice(0, 300), sends: [], same: false, label: 'UNEXPLAINED: the harness could not run this row' }); }
    }
    fileChecks.loaded = loaded;
  } catch (error) {
    harness.push(String(error?.message || error).slice(0, 600));
  } finally { if (child) { child.kill(); await child.closed; } if (client) await client.close(); if (mongo) await mongo.stop({ doCleanup: true, force: true }).catch(() => {}); if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {}); }
  const unexplained = rows.filter(r => r.label.startsWith('UNEXPLAINED')).length, intended = rows.filter(r => r.label.startsWith('INTENDED')).length, same = rows.filter(r => r.same === true).length;
  const headersOk = Object.values(fileChecks).filter(v => v && typeof v === 'object' && 'headerIntended' in v).every(v => v.headerIntended);
  await writeFile(out, JSON.stringify({ source: data.source, exportedAt: data.exportedAt, originBuild: { root: 'tree/.zoomer/replay-origin', revision: originRevision }, candidateBuild: 'tree/.output', exported: rowCount, replayed: rows.length, same, intended, unexplained, harness, sends: [], fileChecks, companions: { organizations: organizations.length, adjustment: 'each organization loaded as exported plus isActive true, a slug and one synthetic member user appended (needed for a company token)', loaded: fileChecks.loaded }, inputShape: 'canonical extended JSON parsed with relaxed:false (ObjectId, Date, Int32/Double kept); every row loaded verbatim', rows }, null, 2));
  const pass = harness.length === 0 && rows.length === rowCount && unexplained === 0 && headersOk && fileChecks.transactionsUnchanged === true;
  return { pass, databaseCoverage: { executed: harness.length === 0, ownedProcess: true }, message: `replayed ${rows.length}/${rowCount} rows as ${organizations.length} companies on the origin build (${originRevision || 'revision unrecorded'}) and the candidate — ${same} same, ${intended} INTENDED different, ${unexplained} UNEXPLAINED; header ${headersOk ? 'INTENDED (軽減税率 inserted after 税率)' : 'UNEXPLAINED'}; transactions ${fileChecks.transactionsUnchanged ? 'unchanged' : 'CHANGED'}; sends none (reads only)${harness.length ? '; HARNESS: ' + harness.join(' | ') : ''} (listed in ${out}; the owner decides)` };
} };
