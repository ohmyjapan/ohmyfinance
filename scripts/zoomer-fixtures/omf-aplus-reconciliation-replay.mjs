// Replay for plan omf-aplus-reconciliation-resolution-20261104 and its statement-payment-review step (omf-aplus-statement-payment-review-
// 20261105, acceptance P7/P8; house rules 5 and 7): the exported production rows of one Aplus account (format omf-scoped-replay-v1: every
// financeimports row with its financialaccounts, financedrafts, financeentries, financepurchaselinks and financedocuments companions)
// loaded as production had them into an owned ephemeral MongoDB, then the CHANGED code's entry points:
//   A  baseline: rebuildSourceReferences apply=false over the whole account history and pendingSettlements for every pending import — per
//      import the stored binding (what production recorded) against the rebuilt one (what the changed code produces), rows whose active
//      state would flip, verify failures, stale decisions. Nothing is written; a business write here is a failure.
//   B  the proposed six-pair scenario ON THE OWNED COPY ONLY: the explicitly identified decisions, derived by code from the loaded rows
//      (an unresolved forecast line whose one finalized candidate is the same card, date, amount, currency and billing month: an expense
//      row = the ordinary pairing; a statement_review row the shared eligibility accepts = the same purchase kept under individual
//      review), applied through the real resolveForecastLine (its lease on the owned account), then every import's binding and every
//      pending import's settlements again. Expected (P7): the ordinary pairs finalize, the exceptions stay source-linked review with their
//      original purchase/payment values, the later snapshots stop targeting the resolved forecasts, other holds remain; no ledger, entry,
//      payment-anchor, calendar or account-flag write.
// Every function in plan.replay.sends is intercepted and listed: Transaction.updateOne and FinanceEntry.findOneAndUpdate are refused always;
// FinanceImport.updateOne is refused in phase A and recorded (owned copy) in phase B; the two FinancialAccount lease writes are recorded.
// The result names import ids, line numbers, counts, states and booleans only — no amounts, merchants or document contents.
// Run ONLY through the hub verifier:
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
const COVERS = ['shared/finance-import-overlap.mjs', 'server/services/financeService.ts', 'server/models/Finance.ts', 'server/services/financeSourceReferenceRebuildService.ts', 'server/services/financeForecastResolutionService.ts', 'server/services/financePaymentMatchService.ts', 'scripts/zoomer-fixtures/omf-aplus-reconciliation-replay.mjs'];
const execute = (file, args, options = {}) => new Promise(resolve => execFile(file, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', ...options }, (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, stdout: String(stdout), stderr: String(stderr) })));
const PLAN = '5-plan-build.json (omf-aplus-statement-payment-review-20261105)';

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
  const sends = [], result = { exported: data.rows.length, replayed: 0, unexplained: 0, notRun: data.rows.length, refusedWrites: 0, productionHead: data.productionHead, startedAt: new Date().toISOString(), rows: [], scenario: null, sends, summary: '' };
  let phase = 'A';
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 }); assert.equal(mongoose.connection.name, dbName);
    for (const [name, docs] of Object.entries(data.collections || {})) if (Array.isArray(docs) && docs.length) await mongoose.connection.db.collection(name).insertMany(docs);
    const loaded = data.collections?.financeimports || [];
    assert.deepEqual(loaded.map(b => String(b._id)).sort(), data.rows.map(b => String(b._id)).sort(), 'the rows are the exported imports');
    const { FinancialAccount, FinanceImport, FinanceEntry, initializeFinance } = await import(u('server/models/Finance.ts')), Transaction = (await import(u('server/models/Transaction.ts'))).default, { Payment } = await import(u('server/models/Payment.ts'));
    const finance = await import(u('server/services/financeService.ts')), overlap = await import(u('shared/finance-import-overlap.mjs'));
    const rebuild = await import(u('server/services/financeSourceReferenceRebuildService.ts')), resolution = await import(u('server/services/financeForecastResolutionService.ts')), payments = await import(u('server/services/financePaymentMatchService.ts'));
    await initializeFinance();
    const intercept = (model, name, method, mode) => { const original = model[method].bind(model); model[method] = (...args) => { const [filter, update] = args; const text = `${name}.${method} filter{${Object.keys(filter || {}).join(',')}} update{${Object.entries(update || {}).map(([k, v]) => k + (v && typeof v === 'object' ? '(' + Object.keys(v).map(x => x.replace(/\.\d+(\.|$)/g, '.<line>$1')).join(',') + ')' : '')).join(',')}}`; const refused = mode === 'refuse' || (mode === 'owned-copy-decision' && phase !== 'B'); sends.push({ phase, model: name, method, text, mode: refused ? 'refused' : mode, at: new Date().toISOString() }); if (refused) throw new Error('replay refused a business write: ' + name + '.' + method); return original(...args); }; };
    intercept(FinanceImport, 'FinanceImport', 'updateOne', 'owned-copy-decision'); intercept(FinancialAccount, 'FinancialAccount', 'findOneAndUpdate', 'lease-on-owned-db'); intercept(FinancialAccount, 'FinancialAccount', 'updateOne', 'lease-on-owned-db');
    intercept(Transaction, 'Transaction', 'updateOne', 'refuse'); intercept(FinanceEntry, 'FinanceEntry', 'findOneAndUpdate', 'refuse'); intercept(Payment, 'Payment', 'updateOne', 'refuse'); intercept(Payment, 'Payment', 'findOneAndUpdate', 'refuse');
    const ownerId = String(data.scope.ownerId), accountId = String(data.scope.accountId);
    const stored = Object.fromEntries(loaded.map(b => [String(b._id), b]));
    const summarize = b => { let groups = [], ok = true; try { groups = overlap.sourceReferenceGroups(b); } catch { ok = false; } const review = groups.filter(g => g.state === 'source_overlap_review'); return { version: b.sourceReferences?.version ?? null, groups: groups.length, exact: groups.length - review.length, exactRows: groups.filter(g => g.state === 'existing_import').reduce((n, g) => n + g.lines.length, 0), review: review.length, resolution: groups.filter(g => g.match === 'pending_resolution').length, candidateTargetLines: new Set(review.flatMap(g => g.targets.flatMap(t => t.lines.map(l => t.importId + ':' + l)))).size, heldRows: review.reduce((n, g) => n + g.lines.length, 0), activeRows: ok ? overlap.activeImportRows(b).length : null, verifies: ok }; };
    const settlementCounts = async id => { const batch = await FinanceImport.findById(id).lean(), map = await finance.pendingSettlements(batch), counts = {}, linked = [], unresolved = []; for (const [line, s] of map) { const key = s.state === 'review' && s.source?.match === 'pending_resolution' ? 'review_linked' : s.state; counts[key] = (counts[key] || 0) + 1; if (key === 'review_linked') linked.push(line); else if (s.state !== 'finalized') unresolved.push(line); } return { importId: id, rows: batch.rows.length, activeRows: map.size, counts, linkedLines: linked, unresolvedLines: unresolved, map }; };
    const pendingIds = data.rows.filter(b => b.sourceStatus === 'pending').map(b => String(b._id)).sort();
    const accountScalar = async () => { const { commitLease: _l, commitLeaseUntil: _u, updatedAt: _t, ...rest } = await FinancialAccount.findById(accountId).lean(); return JSON.stringify(rest); };
    const accountBefore = await accountScalar(), paymentsBefore = await Payment.countDocuments({}), entriesBefore = await FinanceEntry.countDocuments({});
    // ── phase A: the baseline dry run over the whole history and the settlement reads (nothing may be written) ──
    const dry = await rebuild.rebuildSourceReferences(ownerId, accountId, { apply: false, revision: 'replay-dry-run' });
    const baselineSettlements = {}; for (const id of pendingIds) baselineSettlements[id] = await settlementCounts(id);
    const phaseASends = sends.length;
    for (const row of data.rows) {
      const id = String(row._id), batch = stored[id], report = dry.imports.find(r => r.importId === id), stored_ = summarize(batch);
      const kind = batch.sourceStatus === 'pending' ? 'pending' : 'statement', month = batch.period?.statementMonth || '';
      const flips = report ? report.flipping : [], toActive = flips.filter(f => f.after === 'active').length, toExcluded = flips.filter(f => f.after === 'excluded').length;
      const before = report ? { ...report.before, activeRows: report.activeBefore, verifies: report.storedVerify } : stored_;
      const after = report ? { ...report.after, activeRows: report.activeAfter, verifies: !dry.failures.some(f => f.importId === id) } : null;
      const same = !!report && !report.changed && (report.storedVerify !== false);
      let label;
      if (same) label = 'SAME';
      else if (!report) label = 'UNEXPLAINED: not in the rebuild report';
      else if (!report.storedVerify || !after.verifies) label = 'UNEXPLAINED: a verify failure';
      else label = 'UNEXPLAINED: the baseline rebuild changes a stored binding without any owner decision (the plan predicts no baseline change)';
      const settlements = kind === 'pending' ? { counts: baselineSettlements[id].counts, unresolvedLines: baselineSettlements[id].unresolvedLines } : null;
      result.rows.push({ id, kind, statementMonth: month, rows: batch.rows.length, productionOutcome: { binding: before, settlements }, newOutcome: { binding: after, settlements }, flippingToActive: toActive, flippingToExcluded: toExcluded, same, label, sends: sends.slice(0, phaseASends).map(s => s.text + ' [' + s.mode + ']') });
    }
    result.replayed = result.rows.length; result.notRun = data.rows.length - result.rows.length; result.unexplained = result.rows.filter(r => r.label.startsWith('UNEXPLAINED')).length;
    // ── phase B: the six identified decisions on the owned copy ──
    phase = 'B';
    const first = pendingIds[0], baseline = baselineSettlements[first], hashes = Object.fromEntries(loaded.map(b => [String(b._id), b.hash]));
    const forecastBatch = stored[first], identified = [], ambiguous = [];
    for (const line of baseline.unresolvedLines) {
      const s = baseline.map.get(line), forecast = forecastBatch.rows.find(r => r.line === line);
      const finals = (s.candidates || []).filter(c => c.final).flatMap(c => c.rows.map(r => ({ ...r, importId: c.importId })));
      const identity = r => r.pairable === true && r.purchaseDate === forecast.purchaseDate && r.amount === forecast.amount && r.statementMonth === forecast.pendingPaymentMonth;
      const ordinary = finals.filter(r => r.kind === 'expense' && identity(r)), exception = finals.filter(r => r.kind === 'statement_review' && identity(r));
      const chosen = ordinary.length === 1 && !exception.length ? { ...ordinary[0], pairing: 'ordinary' } : exception.length === 1 && !ordinary.length ? { ...exception[0], pairing: 'exception' } : null;
      if (chosen) identified.push({ line, target: { importId: chosen.importId, line: chosen.line }, pairing: chosen.pairing, targetKind: chosen.kind, paymentFieldBlank: chosen.paymentAmount === null, paymentFieldDiffers: chosen.paymentAmount !== null && chosen.paymentAmount !== chosen.purchaseAmount, purchaseAmountEqualsForecast: chosen.purchaseAmount === forecast.amount, candidateRowsSeen: finals.length });
      else ambiguous.push({ line, ordinary: ordinary.length, exception: exception.length, candidateRowsSeen: finals.length });
    }
    const decisions = [];
    for (const d of identified) {
      let outcome;
      try { const r = await resolution.resolveForecastLine(ownerId, first, { line: d.line, action: 'billed', sourceHash: hashes[first], revision: 0, note: 'replay on the owned copy: ' + d.pairing + ' same-purchase pairing', target: { importId: d.target.importId, sourceHash: hashes[d.target.importId], lines: [d.target.line] } }); outcome = { ok: true, state: r.settlement?.state, sourceMatch: r.settlement?.source?.match ?? null, sourceKind: r.settlement?.source?.row?.kind ?? null, resolutionState: r.settlement?.resolution?.state ?? null, superseded: r.settlement?.resolution?.superseded ?? null, changed: r.rebuild.changed, released: r.rebuild.released, held: r.rebuild.held, stale: r.rebuild.stale.length, verified: r.rebuild.verified }; }
      catch (error) { outcome = { ok: false, status: error?.statusCode || 500, message: String(error?.data?.message || error?.statusMessage || error?.message || error).slice(0, 160) }; }
      decisions.push({ ...d, outcome });
    }
    const afterAll = await FinanceImport.find({ ownerId, accountId }).lean(), byId = Object.fromEntries(afterAll.map(b => [String(b._id), b]));
    const verifyFailures = []; for (const b of afterAll) { try { overlap.verifySourceReferences(b, afterAll); } catch (error) { verifyFailures.push({ importId: String(b._id), error: String(error?.message || error).slice(0, 120) }); } }
    const scenarioSettlements = {}; for (const id of pendingIds) scenarioSettlements[id] = await settlementCounts(id);
    const resolvedKeys = new Set(identified.map(d => first + ':' + d.line));
    const targetsOf = id => new Set(overlap.sourceReferenceGroups(byId[id]).filter(g => g.state === 'source_overlap_review').flatMap(g => g.targets.flatMap(t => t.lines.map(l => t.importId + ':' + l))));
    const { listPayments } = payments, listed = (await listPayments(ownerId)).payments.filter(p => p.kind === 'card');
    const matching = identified.map(d => { const p = listed.find(x => x.importId === first && x.line === d.line); return { line: d.line, found: !!p, confirmedKind: p?.confirmed?.kind ?? null, confirmedImportId: p?.confirmed?.importId ?? null, amountEqualsForecast: !!p && p.amount === forecastBatch.rows.find(r => r.line === d.line).amount, paymentFieldBlank: p?.confirmed ? p.confirmed.paymentAmount === null : null, allocations: p?.allocations?.length ?? null, state: p?.state ?? null, statementRowListedAsPayment: listed.some(x => x.importId === d.target.importId && x.line === d.target.line) }; });
    const scenarioRows = data.rows.map(row => {
      const id = String(row._id), before = summarize(stored[id]), after = summarize(byId[id]), kind = row.sourceStatus === 'pending' ? 'pending' : 'statement', month = row.period?.statementMonth || '';
      const settlementsBefore = kind === 'pending' ? baselineSettlements[id] : null, settlementsAfter = kind === 'pending' ? scenarioSettlements[id] : null;
      const same = JSON.stringify(before) === JSON.stringify(after) && (!settlementsBefore || JSON.stringify(settlementsBefore.counts) === JSON.stringify(settlementsAfter.counts));
      const targetsResolved = kind === 'pending' && id !== first ? [...targetsOf(id)].filter(k => resolvedKeys.has(k)).length : null;
      let label;
      if (same) label = 'SAME';
      else if (!after.verifies) label = 'UNEXPLAINED: the scenario binding does not verify';
      else if (id === first) label = 'INTENDED: ' + PLAN + ' P7 — the four ordinary pairs finalize and the two statement exceptions become source-linked review on the forecast import';
      else if (kind === 'statement' && after.resolution > before.resolution && after.exact - after.resolution === before.exact && after.review <= before.review) label = 'INTENDED: ' + PLAN + ' P7 — the chosen statement rows become version-4 resolution references of the forecast (ordinary and same-purchase alike)';
      // A later snapshot's rows were held as candidates of the unresolved forecasts only (candidateTargetLines ≤ 6 before). Once those are resolved the
      // holds end: rows that repeat an earlier snapshot are referenced exactly (counted once), rows still held are held by another open line, the rest
      // become this snapshot's own forecasts. Nothing targets a resolved forecast; no row becomes excluded that was active; no resolution group appears.
      else if (kind === 'pending' && targetsResolved === 0 && after.candidateTargetLines < before.candidateTargetLines && after.review <= before.review && after.resolution === 0 && after.exact >= before.exact && after.activeRows >= before.activeRows) label = 'INTENDED: ' + PLAN + ' P7 — a later snapshot no longer targets the resolved forecasts; its legitimate overlaps/repeats remain (' + (after.exact - before.exact) + ' repeat rows now referenced exactly to the earlier snapshot, ' + after.heldRows + ' rows still held by another open line, ' + (after.activeRows - before.activeRows) + ' rows released as this snapshot\'s own forecasts)';
      else label = 'UNEXPLAINED: the scenario changed this import in a way P7 does not describe';
      return { id, kind, statementMonth: month, productionOutcome: { binding: before, settlements: settlementsBefore ? { counts: settlementsBefore.counts, unresolvedLines: settlementsBefore.unresolvedLines } : null }, newOutcome: { binding: after, settlements: settlementsAfter ? { counts: settlementsAfter.counts, linkedLines: settlementsAfter.linkedLines, unresolvedLines: settlementsAfter.unresolvedLines } : null }, targetsToResolvedForecasts: targetsResolved, same, label };
    });
    const firstAfter = scenarioSettlements[first], linked = firstAfter.linkedLines.map(line => { const s = firstAfter.map.get(line), f = forecastBatch.rows.find(r => r.line === line); return { line, state: s.state, sourceMatch: s.source?.match, sourceImportId: s.source?.importId, sourceLine: s.source?.row?.line, sourceKind: s.source?.row?.kind, purchaseAmountEqualsForecast: s.source?.row?.purchaseAmount === f.amount && s.source?.row?.amount === f.amount, paymentFieldBlank: s.source?.row?.paymentAmount === null, paymentFieldDiffersFromPurchase: s.source?.row?.paymentAmount !== null && s.source?.row?.paymentAmount !== s.source?.row?.purchaseAmount, reasonPresent: typeof s.reason === 'string' && s.reason.length > 0, resolutionState: s.resolution?.state, superseded: s.resolution?.superseded }; });
    result.scenario = {
      identified: identified.map(({ ...d }) => d), ambiguous, decisions: decisions.map(d => ({ line: d.line, target: d.target, pairing: d.pairing, outcome: d.outcome })),
      expectations: {
        identifiedPairs: { predicted: 6, actual: identified.length, ordinary: identified.filter(d => d.pairing === 'ordinary').length, exception: identified.filter(d => d.pairing === 'exception').length },
        decisionsAccepted: { predicted: identified.length, actual: decisions.filter(d => d.outcome.ok).length },
        firstForecastFinalized: { before: baseline.counts.finalized || 0, after: firstAfter.counts.finalized || 0, predictedIncrease: identified.filter(d => d.pairing === 'ordinary').length },
        firstForecastLinkedReview: { predicted: identified.filter(d => d.pairing === 'exception').length, actual: firstAfter.linkedLines.length, lines: linked },
        firstForecastUnresolvedAfter: { predicted: baseline.unresolvedLines.length - identified.length, actual: firstAfter.unresolvedLines.length, lines: firstAfter.unresolvedLines },
        laterSnapshotsTargetResolvedForecasts: { predicted: 0, actual: pendingIds.filter(id => id !== first).reduce((n, id) => n + [...targetsOf(id)].filter(k => resolvedKeys.has(k)).length, 0) },
        laterSnapshots: pendingIds.filter(id => id !== first).map(id => { const b = summarize(stored[id]), a = summarize(byId[id]); return { id, rows: stored[id].rows.length, heldBefore: b.heldRows, heldAfter: a.heldRows, candidateTargetLinesBefore: b.candidateTargetLines, candidateTargetLinesAfter: a.candidateTargetLines, exactBefore: b.exact, exactAfter: a.exact, exactRowsBefore: b.exactRows, exactRowsAfter: a.exactRows, activeBefore: b.activeRows, activeAfter: a.activeRows, targetsToResolvedForecasts: [...targetsOf(id)].filter(k => resolvedKeys.has(k)).length, verifies: a.verifies }; }),
        verifyFailures: { predicted: 0, actual: verifyFailures.length, failures: verifyFailures },
        paymentMatching: matching,
        nonEffects: { accountUnchanged: await accountScalar() === accountBefore, calendarPaymentsBefore: paymentsBefore, calendarPaymentsAfter: await Payment.countDocuments({}), entriesBefore, entriesAfter: await FinanceEntry.countDocuments({}), transactions: await Transaction.countDocuments({}), refusedWrites: sends.filter(s => s.mode === 'refused').length }
      },
      rows: scenarioRows
    };
    result.refusedWrites = sends.filter(s => s.mode === 'refused').length;
    const e = result.scenario.expectations, scenarioUnexplained = scenarioRows.filter(r => r.label.startsWith('UNEXPLAINED')).length;
    const scenarioOk = e.identifiedPairs.actual === 6 && e.identifiedPairs.ordinary === 4 && e.identifiedPairs.exception === 2 && !ambiguous.length && e.decisionsAccepted.actual === 6
      && e.firstForecastFinalized.after === e.firstForecastFinalized.before + 4 && e.firstForecastLinkedReview.actual === 2 && linked.every(l => l.state === 'review' && l.sourceMatch === 'pending_resolution' && l.sourceKind === 'statement_review' && l.purchaseAmountEqualsForecast && l.reasonPresent && l.resolutionState === 'billed' && l.superseded === false)
      && linked.filter(l => l.paymentFieldBlank).length === 1 && linked.filter(l => l.paymentFieldDiffersFromPurchase).length === 1
      && e.firstForecastUnresolvedAfter.actual === e.firstForecastUnresolvedAfter.predicted && e.laterSnapshotsTargetResolvedForecasts.actual === 0 && e.laterSnapshots.every(x => x.verifies && x.targetsToResolvedForecasts === 0 && x.candidateTargetLinesAfter < x.candidateTargetLinesBefore && x.exactAfter >= x.exactBefore && x.activeAfter >= x.activeBefore && x.heldAfter + x.exactRowsAfter + x.activeAfter === x.rows)
      && !verifyFailures.length && matching.every(m => m.found && m.amountEqualsForecast && m.allocations === 0 && !m.statementRowListedAsPayment) && matching.filter(m => m.confirmedKind === 'statement_review').length === 2
      && e.nonEffects.accountUnchanged && e.nonEffects.calendarPaymentsAfter === e.nonEffects.calendarPaymentsBefore && e.nonEffects.entriesAfter === e.nonEffects.entriesBefore && e.nonEffects.transactions === 0 && e.nonEffects.refusedWrites === 0 && scenarioUnexplained === 0;
    result.scenario.pass = scenarioOk; result.scenario.unexplained = scenarioUnexplained;
    if (!scenarioOk) result.unexplained += Math.max(1, scenarioUnexplained);
    const same = result.rows.filter(r => r.same).length, intended = result.rows.filter(r => r.label.startsWith('INTENDED')).length;
    const sSame = scenarioRows.filter(r => r.same).length, sIntended = scenarioRows.filter(r => r.label.startsWith('INTENDED')).length;
    result.summary = `${result.exported} exported, ${result.replayed} replayed on ${String(data.productionHead).slice(0, 8)}: baseline ${same} same, ${intended} INTENDED different, ${result.rows.filter(r => r.label.startsWith('UNEXPLAINED')).length} UNEXPLAINED, ${result.notRun} not run; refused writes ${result.refusedWrites}; scenario (owned copy) ${identified.length} identified (${e.identifiedPairs.ordinary} ordinary, ${e.identifiedPairs.exception} exception), ${e.decisionsAccepted.actual} accepted, forecast finalized ${e.firstForecastFinalized.before}→${e.firstForecastFinalized.after}, linked review ${e.firstForecastLinkedReview.actual}, unresolved ${e.firstForecastUnresolvedAfter.actual}, later snapshots targeting resolved forecasts ${e.laterSnapshotsTargetResolvedForecasts.actual}, scenario rows ${sSame} same / ${sIntended} INTENDED / ${scenarioUnexplained} UNEXPLAINED, verify failures ${verifyFailures.length}, scenario ${scenarioOk ? 'as predicted' : 'DIFFERS'}`;
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
  const pass = r.code === 0 && !!result && result.replayed === exported && result.unexplained === 0 && result.notRun === 0 && result.refusedWrites === 0 && result.scenario?.pass === true;
  return { pass, databaseCoverage: { executed: r.code === 0, ownedProcess: r.code === 0 }, message: (pass ? 'green: ' : 'RED: ') + (result ? result.summary : 'no result file; ' + String(r.stderr + r.stdout).slice(-2000)) };
} };

if (process.argv.includes('--child')) await child(process.argv[process.argv.indexOf('--child') + 1], process.argv[process.argv.indexOf('--child') + 2]).catch(error => { console.error(String(error?.stack || error)); process.exit(1); });
