// Replay for plan omf-aplus-reconciliation-resolution-20261104 (house rules 5 and 7): the exported production rows of one Aplus account
// (format omf-scoped-replay-v1: every financeimports row with its financialaccounts, financedrafts, financeentries, financepurchaselinks
// and financedocuments companions) loaded as production had them into an owned ephemeral MongoDB, then the CHANGED code's entry points:
//   A  rebuildSourceReferences apply=false over the whole account history — per import the stored binding (what production recorded)
//      against the rebuilt one (what the changed code produces), rows whose active state would flip, verify failures, stale decisions;
//   B  the same rebuild APPLIED ON THE OWNED COPY ONLY (nothing reaches production), then pendingSettlements for every unresolved forecast
//      line and resolveForecastLine in dry-run — closed, and billed against each statement candidate row — NO decision is recorded.
// Every function in plan.replay.sends is intercepted and listed: FinanceImport.updateOne, Transaction.updateOne and
// FinanceEntry.findOneAndUpdate are refused (a call during phase A or a dry run is a failure); the two FinancialAccount lease writes are
// recorded and pass through to the owned database. The output names import ids, line numbers, counts and states only — no amounts,
// merchants or document contents. Run ONLY through the hub verifier:
//   REPLAY_INPUT=<abs> REPLAY_OUT=<abs> node <hub>/scripts/zoomer-verify.mjs --run-fixture omf-aplus-reconciliation-replay.mjs --cwd <this worktree>
// With REPLAY_INPUT unset the fixture exports no coverage and passes with the note "no replay input"; it exercised nothing.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 2400000;
const SELF = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(SELF), '..', '..');
const input = process.env.REPLAY_INPUT || '', out = process.env.REPLAY_OUT || '';
const exported = input ? (() => { try { const raw = JSON.parse(readFileSync(input, 'utf8')); return Array.isArray(raw.rows) ? raw.rows.length : 0; } catch { return 0; } })() : 0;
const COVERS = ['shared/finance-import-overlap.mjs', 'server/services/financeService.ts', 'server/models/Finance.ts', 'server/services/financeSourceReferenceRebuildService.ts', 'server/services/financeForecastResolutionService.ts', 'scripts/zoomer-fixtures/omf-aplus-reconciliation-replay.mjs'];
const execute = (file, args, options = {}) => new Promise(resolve => execFile(file, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', ...options }, (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, stdout: String(stdout), stderr: String(stderr) })));

async function child(inputFile, outFile) {
  const require = createRequire(path.join(root, 'package.json')), u = p => pathToFileURL(path.join(root, p)).href;
  const { EJSON } = require('bson'), data = EJSON.deserialize(JSON.parse(await readFile(inputFile, 'utf8')));
  assert.equal(data.readOnly, true, 'the export must be read-only'); assert.equal(data.project, 'ohmyfinance'); assert.equal(data.format, 'omf-scoped-replay-v1');
  const nodeModules = require.resolve('mongodb-memory-server').split(path.sep + 'node_modules' + path.sep)[0] + path.sep + 'node_modules';
  const binary = path.join(nodeModules, '.cache', 'mongodb-memory-server', 'mongod-x64-win32-8.2.1.exe');
  const { MongoMemoryServer } = require('mongodb-memory-server'), dbName = 'omf_aplus_replay_owned';
  const mongo = await MongoMemoryServer.create({ binary: existsSync(binary) ? { systemBinary: binary, version: '8.2.1' } : undefined, instance: { dbName, launchTimeout: 120000 } });
  const uri = mongo.getUri(dbName);
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri) || /:27017\//.test(uri)) throw new Error('SETUP refused: not an owned ephemeral database address');
  Object.assign(process.env, { MONGO_URI: uri, MONGODB_URI: uri, NUXT_MONGO_URI: uri, JWT_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'test' });
  const mongoose = (await import(pathToFileURL(require.resolve('mongoose')).href)).default;
  const sends = [], result = { exported: data.rows.length, replayed: 0, unexplained: 0, notRun: data.rows.length, refusedWrites: 0, productionHead: data.productionHead, startedAt: new Date().toISOString(), rows: [], phaseB: null, sends, summary: '' };
  let allowImportWrites = false;
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 }); assert.equal(mongoose.connection.name, dbName);
    for (const [name, docs] of Object.entries(data.collections || {})) if (Array.isArray(docs) && docs.length) await mongoose.connection.db.collection(name).insertMany(docs);
    const loaded = data.collections?.financeimports || [];
    assert.deepEqual(loaded.map(b => String(b._id)).sort(), data.rows.map(b => String(b._id)).sort(), 'the rows are the exported imports');
    const { FinancialAccount, FinanceImport, FinanceEntry, initializeFinance } = await import(u('server/models/Finance.ts')), Transaction = (await import(u('server/models/Transaction.ts'))).default;
    const finance = await import(u('server/services/financeService.ts')), overlap = await import(u('shared/finance-import-overlap.mjs'));
    const rebuild = await import(u('server/services/financeSourceReferenceRebuildService.ts')), resolution = await import(u('server/services/financeForecastResolutionService.ts'));
    await initializeFinance();
    const intercept = (model, name, method, mode) => { const original = model[method].bind(model); model[method] = (...args) => { const [filter, update] = args; const text = `${name}.${method} filter{${Object.keys(filter || {}).join(',')}} update{${Object.entries(update || {}).map(([k, v]) => k + (v && typeof v === 'object' ? '(' + Object.keys(v).map(x => x.replace(/\.\d+$/, '.<line>')).join(',') + ')' : '')).join(',')}}`; const refused = mode === 'refuse' && !(name === 'FinanceImport' && allowImportWrites); sends.push({ model: name, method, text, mode: refused ? 'refused' : mode === 'refuse' ? 'owned-copy-apply' : mode, at: new Date().toISOString() }); if (refused) throw new Error('replay refused a business write: ' + name + '.' + method); return original(...args); }; };
    intercept(FinanceImport, 'FinanceImport', 'updateOne', 'refuse'); intercept(FinancialAccount, 'FinancialAccount', 'findOneAndUpdate', 'lease-on-owned-db'); intercept(FinancialAccount, 'FinancialAccount', 'updateOne', 'lease-on-owned-db'); intercept(Transaction, 'Transaction', 'updateOne', 'refuse'); intercept(FinanceEntry, 'FinanceEntry', 'findOneAndUpdate', 'refuse');
    const ownerId = String(data.scope.ownerId), accountId = String(data.scope.accountId);
    const stored = Object.fromEntries(loaded.map(b => [String(b._id), b]));
    const summarize = b => { let groups = [], ok = true; try { groups = overlap.sourceReferenceGroups(b); } catch { ok = false; } const review = groups.filter(g => g.state === 'source_overlap_review'); return { version: b.sourceReferences?.version ?? null, groups: groups.length, exact: groups.length - review.length, review: review.length, resolution: groups.filter(g => g.match === 'pending_resolution').length, candidateTargetLines: new Set(review.flatMap(g => g.targets.flatMap(t => t.lines.map(l => t.importId + ':' + l)))).size, heldRows: review.reduce((n, g) => n + g.lines.length, 0), activeRows: ok ? overlap.activeImportRows(b).length : null, verifies: ok }; };
    // ── phase A: the dry run over the whole history (nothing may be written) ──
    const dry = await rebuild.rebuildSourceReferences(ownerId, accountId, { apply: false, revision: 'replay-dry-run' });
    const phaseASends = sends.length;
    for (const row of data.rows) {
      const id = String(row._id), batch = stored[id], report = dry.imports.find(r => r.importId === id), stored_ = summarize(batch);
      const kind = batch.sourceStatus === 'pending' ? 'pending' : 'statement', month = batch.period?.statementMonth || '';
      const flips = report ? report.flipping : [], toActive = flips.filter(f => f.after === 'active').length, toExcluded = flips.filter(f => f.after === 'excluded').length;
      // Production's outcome is the stored binding; the changed code's outcome is the planner's rebuilt binding (the report carries both summaries).
      const before = report ? { ...report.before, activeRows: report.activeBefore, verifies: report.storedVerify } : stored_;
      const after = report ? { ...report.after, activeRows: report.activeAfter, verifies: !dry.failures.some(f => f.importId === id) } : null;
      const same = !!report && !report.changed;
      let label;
      if (same) label = 'SAME';
      else if (!report) label = 'UNEXPLAINED: not in the rebuild report';
      else if (!report.storedVerify || !after.verifies) label = 'UNEXPLAINED: a verify failure';
      else if (toExcluded > 0) label = 'UNEXPLAINED: a row became excluded (the plan predicts releases only)';
      else if (before.exact !== after.exact || after.resolution) label = 'UNEXPLAINED: exact groups changed';
      else if (!(after.candidateTargetLines < before.candidateTargetLines || after.review < before.review || after.heldRows < before.heldRows)) label = 'UNEXPLAINED: the binding changed without a narrowed review hold';
      else if (kind === 'statement' && month && month < '2026-09') label = 'INTENDED: 5-plan-build.md §2 S1(c) (retained first plan S1(c)) — a statement whose coverage closed before the forecast purchases holds nothing; its historical rows are released';
      else if (kind === 'statement') label = 'INTENDED: 5-plan-build.md §2 S1(b) (retained first plan S1(b)) — a forecast settled exactly by a statement is excluded from every other statement\'s candidates';
      else label = 'INTENDED: 5-plan-build.md §2 S1(b) — the later snapshot\'s rows are held only by forecast lines no statement settled (recurrence rule on settled lines)';
      result.rows.push({ id, kind, statementMonth: month, rows: batch.rows.length, productionOutcome: before, newOutcome: after, flippingToActive: toActive, flippingToExcluded: toExcluded, onFlippingRows: { entries: flips.reduce((n, f) => n + f.entries.length, 0), drafts: flips.reduce((n, f) => n + f.drafts.length, 0), links: flips.reduce((n, f) => n + f.links.length, 0), documents: flips.reduce((n, f) => n + f.documents.length, 0) }, same, label, sends: sends.slice(0, phaseASends).map(s => s.text + ' [' + s.mode + ']') });
    }
    result.replayed = result.rows.length; result.notRun = data.rows.length - result.rows.length; result.unexplained = result.rows.filter(r => r.label.startsWith('UNEXPLAINED')).length;
    // ── phase B: applied on the owned copy only, then the settlements and the dry-run decisions ──
    allowImportWrites = true;
    const applied = await rebuild.rebuildSourceReferences(ownerId, accountId, { apply: true, revision: 'replay-apply-on-the-owned-copy' });
    allowImportWrites = false;
    const pendingIds = data.rows.filter(b => b.sourceStatus === 'pending').map(b => String(b._id)), settlements = [], unresolved = [];
    for (const id of pendingIds) {
      const batch = await FinanceImport.findById(id).lean(), map = await finance.pendingSettlements(batch), counts = {};
      for (const [line, s] of map) { counts[s.state] = (counts[s.state] || 0) + 1; if (s.state !== 'finalized') unresolved.push({ importId: id, line, state: s.state, hash: batch.hash, candidates: (s.candidates || []).map(c => ({ importId: c.importId, final: c.final, lines: c.lines })) }); }
      settlements.push({ importId: id, rows: batch.rows.length, activeRows: map.size, counts });
    }
    const hashes = Object.fromEntries((await FinanceImport.find({ ownerId, accountId }).select('hash').lean()).map(b => [String(b._id), b.hash]));
    const dryRun = async (importId, body) => { try { const r = await resolution.resolveForecastLine(ownerId, importId, body, { dryRun: true }); const flips = {}; for (const f of r.rebuild.flipping) flips[f.importId] = (flips[f.importId] || '') + (f.after === 'active' ? '+' : '-'); return { ok: true, passes: r.rebuild.passes, changed: r.rebuild.changed, released: r.rebuild.released, held: r.rebuild.held, verified: r.rebuild.verified, stale: r.rebuild.stale.length, flips: Object.fromEntries(Object.entries(flips).map(([k, v]) => [k, { toActive: (v.match(/\+/g) || []).length, toExcluded: (v.match(/-/g) || []).length }])) }; } catch (error) { return { ok: false, status: error?.statusCode || 500, message: String(error?.data?.message || error?.statusMessage || error?.message || error).slice(0, 160) }; } };
    for (const line of unresolved) {
      line.closed = await dryRun(line.importId, { line: line.line, action: 'closed', sourceHash: line.hash });
      line.billed = [];
      for (const c of line.candidates.filter(c => c.final)) for (const target of c.lines.slice(0, 40)) line.billed.push({ importId: c.importId, line: target, ...(await dryRun(line.importId, { line: line.line, action: 'billed', sourceHash: line.hash, target: { importId: c.importId, sourceHash: hashes[c.importId], lines: [target] } })) });
    }
    const afterAll = await FinanceImport.find({ ownerId, accountId }).lean(), byId = Object.fromEntries(afterAll.map(b => [String(b._id), b]));
    const heldBy = ids => { const lines = new Set(); for (const id of ids) for (const g of overlap.sourceReferenceGroups(byId[id])) if (g.state === 'source_overlap_review') for (const t of g.targets) for (const l of t.lines) lines.add(t.importId + ':' + l); return lines.size; };
    const heldRows = ids => ids.reduce((n, id) => n + summarize(byId[id]).heldRows, 0);
    const first = pendingIds[0], later = pendingIds.slice(1), finals = (m => data.rows.filter(b => b.sourceStatus !== 'pending' && m(b.period?.statementMonth || '')).map(b => String(b._id)));
    const drafts = data.collections?.financedrafts || [], entries = data.collections?.financeentries || [];
    const unresolvedKeys = new Set(unresolved.map(x => x.importId + ':' + x.line)), flippingKeys = new Set(dry.flipping.map(f => f.importId + ':' + f.line));
    result.phaseB = { applied: { written: applied.written.length, verified: applied.verified, released: applied.released, held: applied.held, stale: applied.stale.length }, settlements, unresolved: unresolved.map(({ hash: _hash, ...rest }) => rest), predictions: {
      firstForecastLinesFinalized: { predicted: 80, actual: settlements.find(s => s.importId === first)?.counts.finalized ?? null },
      unresolvedForecastLines: { predicted: 6, actual: unresolved.filter(x => x.importId === first).length, candidateCounts: unresolved.filter(x => x.importId === first).map(x => x.candidates.reduce((n, c) => n + c.lines.length, 0)) },
      historicalRowsReleased: { predicted: 107, actual: dry.flipping.filter(f => f.after === 'active' && finals(m => m < '2026-09').includes(f.importId)).length },
      laterSnapshotRowsHeld: { predicted: '60 held by at most 6 lines', actual: { held: heldRows(later), heldBy: heldBy(later) } },
      unmatched2026StatementRowsHeld: { predicted: '56 held by at most 6 lines', actual: { held: heldRows(finals(m => m >= '2026-09')), heldBy: heldBy(finals(m => m >= '2026-09')) } },
      verifyFailures: { predicted: 0, actual: dry.failures.length, failures: dry.failures },
      draftsOnAffectedLines: { predicted: 3, actual: drafts.filter(d => unresolvedKeys.has(String(d.importId) + ':' + d.line) || flippingKeys.has(String(d.importId) + ':' + d.line)).map(d => String(d.importId) + ':' + d.line), total: drafts.length },
      entriesOnAffectedLines: { predicted: 0, actual: entries.filter(e => unresolvedKeys.has(String(e.importId) + ':' + e.line) || flippingKeys.has(String(e.importId) + ':' + e.line)).length, total: entries.length },
      staleResolutions: { predicted: 0, actual: dry.stale.length }
    } };
    result.refusedWrites = sends.filter(s => s.mode === 'refused').length;
    const same = result.rows.filter(r => r.same).length, intended = result.rows.filter(r => r.label.startsWith('INTENDED')).length;
    result.summary = `${result.exported} exported, ${result.replayed} replayed on ${String(data.productionHead).slice(0, 8)}: ${same} same, ${intended} INTENDED different, ${result.unexplained} UNEXPLAINED, ${result.notRun} not run; phase A refused writes ${result.refusedWrites}; phase B (owned copy) applied ${applied.written.length} bindings, released ${applied.released}, held ${applied.held}; first forecast lines finalized ${result.phaseB.predictions.firstForecastLinesFinalized.actual}/80, unresolved ${result.phaseB.predictions.unresolvedForecastLines.actual}/6, historical rows released ${result.phaseB.predictions.historicalRowsReleased.actual}/107, verify failures ${dry.failures.length}`;
  } catch (error) { result.summary = 'HARNESS: ' + String(error?.stack || error).slice(0, 1200); result.notRun = data.rows.length - result.rows.length; if (!result.rows.length) result.unexplained = data.rows.length; }
  finally {
    result.endedAt = new Date().toISOString();
    await writeFile(outFile, JSON.stringify(result, null, 2));
    try { const { stopCleanup } = await import(u('server/services/tokenBlacklistService.ts')); stopCleanup(); } catch {}
    await mongoose.disconnect().catch(() => {}); await mongo.stop().catch(() => {});
  }
  console.log(result.summary);
  process.exit(result.summary.startsWith('HARNESS') ? 1 : 0);
}

export default { name: 'omf-aplus-reconciliation-replay', covers: exported ? COVERS : [], async run() {
  if (!input) return { pass: true, message: 'no replay input (REPLAY_INPUT unset): nothing exercised, no coverage granted' };
  if (!exported) return { pass: false, message: 'REPLAY NOT RUN: zero exported cases in ' + input };
  if (!out) return { pass: false, message: 'REPLAY_OUT required' };
  const r = await execute(process.execPath, ['--import', 'tsx', SELF, '--child', input, out], { cwd: root, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '' }, timeout: 2100000 });
  let result = null; try { result = JSON.parse(await readFile(out, 'utf8')); } catch {}
  const pass = r.code === 0 && !!result && result.replayed === exported && result.unexplained === 0 && result.notRun === 0 && result.refusedWrites === 0;
  return { pass, databaseCoverage: { executed: r.code === 0, ownedProcess: r.code === 0 }, message: (pass ? 'green: ' : 'RED: ') + (result ? result.summary : 'no result file; ' + String(r.stderr + r.stdout).slice(-2000)) };
} };

if (process.argv.includes('--child')) await child(process.argv[process.argv.indexOf('--child') + 1], process.argv[process.argv.indexOf('--child') + 2]).catch(error => { console.error(String(error?.stack || error)); process.exit(1); });
