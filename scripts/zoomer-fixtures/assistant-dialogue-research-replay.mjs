// Replay for plan omf-assistant-actions-20261015 (plan.replay): the owner's real purchase conversations with a proposal in the last
// 3 weeks, exported read-only into a private hub file together with their import, account, references and learning companions, are
// loaded as production had them into an owned ephemeral MongoDB and driven through the CHANGED finishChat (pass A: the recorded reply,
// compared with the recorded outcome) and confirmChat (pass B: beyond production's recorded path — the recorded turn was never
// confirmed — writing only the isolated draft). No model, no worker, no network: teaching-worker/interpreter.mjs and
// research-worker/worker.mjs are never loaded (the entry does not import them), so interpretChat and ResearchWorker.cycle run 0 times;
// saveDraft runs against the owned database only and is counted through the draft history it writes. The recorded reply predates the
// prompt change and carries no research request, so the new research branch is not exercised by a recorded row: the 5+3 fresh
// interpretChat draws the plan names are the parent's. Run ONLY through the hub verifier (never directly):
//   REPLAY_INPUT=<abs 8-replay-input.json> REPLAY_OUT=<abs 8-replay-result.json> node scripts/zoomer-verify.mjs --run-fixture assistant-dialogue-research-replay.mjs --cwd <worktree>
// With REPLAY_INPUT unset (decided at load) it exports covers: [] and passes with the note "no replay input": it grants no coverage.
// Customer text never enters this file or the result: ids, states, kinds, field names, lengths and counts only.
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
import { createHash, randomBytes } from 'node:crypto';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = process.argv[2], INPUT = process.argv[3], OUT = process.argv[4];
const u = p => pathToFileURL(path.join(ROOT, p)).href;
const { EJSON } = await import('bson');
const exported = EJSON.parse(await readFile(INPUT, 'utf8'), { relaxed: true });
assert.equal(exported.readOnly, true); assert.equal(exported.database, 'ohmyfinance'); assert.equal(exported.collection, 'financechats');
const rows = Array.isArray(exported.rows) ? exported.rows : [];
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-dialogue-replay-'));
process.env.OMF_DATA_DIR = path.join(temp, 'data'); process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = randomBytes(32).toString('hex');
const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default;
const mongo = await MongoMemoryServer.create({ instance: { dbName: 'assistant_dialogue_replay_isolated' } });
process.env.MONGO_URI = mongo.getUri('assistant_dialogue_replay_isolated');
let revision = 'unknown';
try { revision = (await (await import('node:util')).promisify((await import('node:child_process')).execFile)('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { windowsHide: true })).stdout.trim(); } catch { /* not a checkout */ }
const results = [], problems = [];
const fp = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
try {
  const { connectDB } = await import(u('server/config/database.ts'));
  await connectDB(); assert.equal(mongoose.connection.name, 'assistant_dialogue_replay_isolated'); assert.equal(mongoose.connection.host, '127.0.0.1');
  const { FinanceChat, FinanceChatAgent } = await import(u('server/models/FinanceChat.ts'));
  const { FinanceResearch } = await import(u('server/models/FinanceResearch.ts'));
  const { FinanceDraft } = await import(u('server/models/FinanceDraft.ts'));
  const { finishChat, confirmChat } = await import(u('server/services/financeChatService.ts'));
  const { readDraft } = await import(u('server/services/financeDraftService.ts'));
  // Companions as production had them (raw inserts: the export already carries the stored shapes).
  const companions = exported.companions || {};
  const loaded = {};
  for (const [name, docs] of Object.entries(companions)) { if (Array.isArray(docs) && docs.length) { await mongoose.connection.collection(name).insertMany(docs); loaded[name] = docs.length; } }
  const summarize = t => ({ kind: t?.proposal?.kind ?? null, patch: t?.proposal?.patch ? { purpose: t.proposal.patch.purpose ?? null, customerId: t.proposal.patch.customerId ?? null, productNameLength: String(t.proposal.patch.productName || '').length } : null, summaryLength: String(t?.proposal?.summary || '').length, research: t?.research ? { when: t.research.when, requestId: !!t.research.requestId, unavailable: t.research.unavailable || null } : null, confirmed: !!t?.confirmedAt, answered: !!t?.answeredAt });
  for (const r of rows) {
    const entry = { id: String(r._id), production: null, replay: null, sends: [], same: false, label: null };
    try {
      const turn = r.turns.find(t => t.id === r.currentId); assert.ok(turn, 'current turn missing');
      const productionResearch = (companions.financeresearches || []).filter(x => String(x.importId) === String(r.importId) && x.line === r.line).length;
      entry.production = { state: r.state, turn: summarize(turn), textLength: String(turn.text || '').length, researchRows: productionResearch, proposalHasResearch: Object.hasOwn(turn.proposal || {}, 'research') };
      // A synthetic agent in the row's owner/account scope (tokens are not exported; the service checks only that scope).
      const agentId = new mongoose.Types.ObjectId();
      await FinanceChatAgent.collection.insertOne({ _id: agentId, ownerId: r.ownerId, accountIds: [r.accountId], tokenHash: 'replay-' + randomBytes(16).toString('hex'), enabled: true, workspaceEnabled: false, documentEnabled: false, researchEnabled: true, lastSeenAt: new Date(), chatLastSeenAt: new Date(), createdAt: new Date(), updatedAt: new Date() });
      const agent = { _id: agentId, ownerId: r.ownerId, accountIds: [r.accountId], enabled: true, researchEnabled: true };
      // The row as production had it right before the reply landed: working, leased to that agent, the current turn unanswered.
      const lease = 'replay-lease-' + randomBytes(8).toString('hex');
      const { proposal, answeredAt, research, ...pending } = turn;
      await FinanceChat.collection.insertOne({ ...r, state: 'working', lease, leaseUntil: new Date(Date.now() + 120000), agentId, turns: r.turns.map(t => t.id === r.currentId ? pending : t) });
      // Pass A: the changed finishChat with the recorded reply.
      const finished = await finishChat(agent, String(r._id), { lease, proposal });
      assert.equal(finished.success, true);
      const afterA = await FinanceChat.findById(r._id).lean(); const turnA = afterA.turns.find(t => t.id === r.currentId);
      const researchA = await FinanceResearch.countDocuments({ importId: r.importId, line: r.line });
      entry.replay = { finishChat: { state: afterA.state, turn: summarize(turnA), researchRows: researchA } };
      const sameA = afterA.state === r.state && turnA.proposal?.kind === proposal?.kind && JSON.stringify(turnA.proposal?.patch) === JSON.stringify(proposal?.patch) && !turnA.research === !research && researchA === productionResearch;
      // Pass B: the changed confirmChat — production never confirmed this turn, so this is beyond its recorded path; only the isolated draft is written.
      const ownerId = String(r.ownerId), importId = String(r.importId);
      const d = await readDraft(ownerId, importId, r.line);
      const binding = { revision: d.revision === r.context.revision, key: d.key === r.context.key, sourceHash: d.sourceHash === r.context.sourceHash, fingerprint: fp(d.values) === r.context.fingerprint };
      if (Object.values(binding).every(Boolean)) {
        const confirmed = await confirmChat(ownerId, importId, r.line, { revision: d.revision, key: d.key, sourceHash: d.sourceHash, chatRevision: afterA.revision, turnId: r.currentId, remember: false });
        const afterB = await FinanceChat.findById(r._id).lean(); const turnB = afterB.turns.find(t => t.id === r.currentId);
        const draft = await FinanceDraft.findOne({ importId: r.importId, line: r.line }).lean();
        const history = (draft?.history || []).map(h => ({ action: h.action, channel: h.channel, fields: h.fields, revision: h.revision }));
        entry.replay.confirmChat = { beyondProduction: true, state: afterB.state, turn: summarize(turnB), draftRevision: confirmed.draft.revision, draftValues: { purpose: confirmed.draft.values.purpose, customerId: confirmed.draft.values.customerId, productNameLength: String(confirmed.draft.values.productName || '').length }, history, researchRows: await FinanceResearch.countDocuments({ importId: r.importId, line: r.line }), stale: confirmed.stale };
        entry.sends.push({ name: 'server/services/financeDraftService.ts saveDraft', calls: history.length, scope: 'owned throwaway database only', text: history.map(h => h.action + ' ' + (h.fields || []).join('+')).join('; ') });
      } else {
        entry.replay.confirmChat = { notRun: 'the isolated draft does not reproduce the recorded binding', binding, isolatedRevision: d.revision, recordedRevision: r.context.revision };
        problems.push(entry.id + ': confirm pass not run — the isolated draft does not reproduce the recorded binding ' + JSON.stringify(binding));
      }
      entry.sends.push({ name: 'teaching-worker/interpreter.mjs interpretChat', calls: 0, text: null, note: 'not reachable from finishChat/confirmChat and never loaded; the fresh draws of the recorded text are the parent\'s (plan §4)' });
      entry.sends.push({ name: 'research-worker/worker.mjs ResearchWorker.cycle', calls: 0, text: null, note: 'never run; research rows for this purchase in the owned database after both passes: ' + (entry.replay.confirmChat?.researchRows ?? researchA) });
      entry.same = sameA;
      entry.label = sameA ? 'same: the changed finishChat stores the recorded reply exactly as production did (state, kind, patch, no research marker, no research row); the recorded reply carries no research request because it predates the prompt' : 'UNEXPLAINED: ' + JSON.stringify(entry.replay.finishChat);
    } catch (error) { entry.error = String(error?.stack || error?.message || error).replace(/\s+/g, ' ').slice(0, 600); problems.push(entry.id + ': ' + entry.error); }
    results.push(entry);
  }
  const failed = results.filter(r => r.error).length, same = results.filter(r => r.same && !r.error).length, different = results.length - failed - same;
  const unexplained = results.filter(r => !r.error && !r.same && !r.intended).length;
  let database = { executed: false, ownedProcess: false };
  try { const stats = await mongoose.connection.db.stats(); database = { executed: stats.objects > 0, ownedProcess: Number(mongoose.connection.port) === Number(mongo.instanceInfo?.port || 0) && mongoose.connection.host === '127.0.0.1', name: mongoose.connection.name, objects: stats.objects, collections: stats.collections }; } catch { /* reported as not executed */ }
  const result = { capturedAt: new Date().toISOString(), input: INPUT, revision, entry: 'finishChat(agent, chatId, {lease, proposal: recorded}) then confirmChat(ownerId, importId, line, {binding, turnId, remember:false}) in server/services/financeChatService.ts; interpretChat and ResearchWorker.cycle never loaded; saveDraft isolated', exported: rows.length, loaded: results.length, replayed: results.length - failed, same, different, unexplainedDifferent: unexplained, intendedDifferent: different - unexplained, failed, companionsLoaded: loaded, modelDraws: 'pending — the 5 fresh draws of the recorded text and the 3 controls (plan §4) are collected by the parent after this deterministic replay', database, problems, rows: results };
  if (OUT) await writeFile(OUT, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ __replay__: { pass: results.length > 0 && failed === 0 && unexplained === 0, database, message: rows.length + ' exported, ' + results.length + ' loaded, ' + (results.length - failed) + ' replayed on ' + revision.slice(0, 8) + ': ' + same + ' same, ' + different + ' different (' + (different - unexplained) + ' intended, ' + unexplained + ' unexplained), ' + failed + ' not run; interpretChat 0 calls, ResearchWorker.cycle 0 calls, saveDraft isolated; database ' + (database.executed ? 'executed ' + database.objects + ' objects in owned ' + database.name : 'no database work') + (OUT ? '; result ' + OUT : '') + (problems.length ? ' — ' + problems.join(' | ').slice(0, 600) : '') } }));
} finally {
  await import(u('server/services/tokenBlacklistService.ts')).then(m => (m.stopCleanup || m.default?.stopCleanup)?.()).catch(() => {});
  await mongoose.disconnect(); await mongo.stop();
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
`;

export default {
  name: 'assistant-dialogue-research-replay',
  covers: INPUT ? ['server/services/financeChatService.ts', 'server/services/financeResearchService.ts', 'shared/finance-chat.mjs', 'shared/finance-research.mjs'] : [],
  async run() {
    if (!INPUT) return { pass: true, message: 'no replay input (REPLAY_INPUT unset): nothing exercised, no coverage claimed' };
    const started = Date.now();
    const cache = path.join(REPO_ROOT, '.cache'); await mkdir(cache, { recursive: true });
    const harness = path.join(cache, 'assistant-dialogue-research-replay-' + process.pid + '.mts');
    await writeFile(harness, CHILD, { flag: 'wx' });
    try {
      const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', harness, REPO_ROOT, INPUT, OUT], { cwd: REPO_ROOT, windowsHide: true, timeout: 540000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '' } }).catch(error => { throw new Error(String(error.stderr || error.stdout || error.message).slice(-2500)); });
      const line = stdout.split(/\r?\n/).find(l => l.startsWith('{') && l.includes('__replay__'));
      if (!line) throw new Error('the replay harness produced no result: ' + String(stderr || stdout).slice(-1500));
      const result = JSON.parse(line).__replay__;
      const database = result.database || {};
      return { pass: result.pass, databaseCoverage: { executed: database.executed === true, ownedProcess: database.ownedProcess === true }, message: result.message + ' in ' + Math.round((Date.now() - started) / 1000) + 's' };
    } catch (error) { return { pass: false, message: 'Replay failed: ' + String(error?.message || error).replace(/\s+/g, ' ').slice(-2500) }; }
    finally { await unlink(harness).catch(() => {}); }
  }
};
