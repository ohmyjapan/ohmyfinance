// Fixture for plan omf-navi-owner-continuation-20261020 (5-plan.json): the legacy owner workspace and purchase Navi chats gain explicit
// new chat and archived history, a realm-aware feature guide with longer owner explanations, the same-company teaching bridge and
// named owner actions (card sync, automatic sync, workflow review, assigned-card allocation) on the real native services.
// Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-navi-owner-continuation.mjs --cwd <this worktree>
// Legs: 1 the built app (scripts/finance-navi-owner-continuation-integration.cjs on its own disposable MongoDB and server process,
// with the real installed-Chrome leg scripts/finance-navi-owner-continuation-browser.cjs chained at its end; NOT RUN and red when
// .output/server/index.mjs is missing) · 2 node --test of the sibling unit tests · 3 an unchanged packaged copy of the build must
// pass · 4 named defects, each reintroduced into an isolated copy of the compiled output, must make the integration fail with its
// named assertion. No model, provider, network send or ambient database: every database address is a closed sentinel, every model
// or business credential a dummy, and the integration owns its in-memory MongoDB. `covers` is decided at load: built-app files are
// listed only when the build exists.
// Fail-first on 3b7d4ab: leg 1 is the behavioural failure (the owner workspace reply loses its fixed page link and longer text, and
// there is no new chat, history, teaching bridge or owner native action); legs 3-4 are NOT RUN until leg 1 is green.
// Plan omf-navi-agent-owner-retry-20261023 (docs/navi-turn-continuity.md) adds request identity across New chat and the uncertain-send
// exit of the owner workspace and purchase chats: six isolated native groups and ten installed-Chrome groups (31 groups in all). The
// packaged copy must pass all of them, Chrome included (the integration and Chrome scripts of this tree run against the copy's built app).
// Each defect leg runs only the groups that hold its assertion (OMF_OWNER_CONT_ONLY; the ten inherited defects run the original groups
// 1-8 alone, as before). A client defect edits the copy's compiled client asset and its recorded size in the copy's static asset
// manifest, and runs its Chrome group. A missing or non-unique anchor is a SETUP error, never a detection.
// Fail-first on aed09b4 (the unchanged final responsive build): leg 1 red at the 13 new groups' named assertions; legs 3-4 NOT RUN. The
// purchase hold group and the two groups of the parent's later leads (induced after-write refusal, capped History count) were added
// with their folds and have no unchanged-build witness; each is held by named compiled defects.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const timeoutMs = 9000000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILT = existsSync(path.join(root, '.output', 'server', 'index.mjs'));
// 9 original native + 6 request identity native groups, 6 original + 10 request identity installed-Chrome groups.
const EXPECTED = 31, EXPECTED_BROWSER = 16;
const SCRIPT_COVERS = ['scripts/finance-navi-owner-continuation-integration.cjs', 'scripts/finance-navi-owner-continuation-browser.cjs', 'scripts/zoomer-fixtures/omf-navi-owner-continuation.mjs', 'scripts/finance-assistant.test.mjs', 'scripts/finance-chat.test.mjs', 'scripts/finance-interpreter-stream.test.mjs', 'shared/finance-assistant.mjs', 'shared/finance-navi-features.mjs', 'shared/finance-chat.mjs', 'teaching-worker/interpreter.mjs'];
const APP_COVERS = ['server/models/FinanceOwnerConversationArchive.ts', 'server/services/financeOwnerConversationService.ts', 'server/services/financeOwnerCompanyKnowledgeService.ts', 'server/services/financeOwnerActionService.ts', 'server/services/financeAssistantService.ts', 'server/services/financeChatService.ts', 'server/services/financeActionService.ts', 'server/services/companyKnowledgeService.ts', 'server/services/financeService.ts', 'server/services/financePaymentMatchService.ts', 'server/services/financeWorkflowService.ts', 'server/models/FinanceAssistant.ts', 'server/models/FinanceChat.ts', 'server/models/FinanceActionOperation.ts', 'server/models/Finance.ts', 'server/api/finance-chat/[...path].ts', 'server/api/finance/[...path].ts', 'components/finance/AssistantConversation.vue', 'components/finance/PurchaseChat.vue', 'components/finance/AssistantPanel.vue', 'stores/assistant.ts'];
const binary = path.resolve(root, '..', 'node_modules', '.cache', 'mongodb-memory-server', 'mongod-x64-win32-8.2.1.exe');

// Each defect: an anchor in the compiled server chunks (regular expression, whitespace-tolerant) or, for `kind: 'client'`, a literal in
// the compiled client assets, that must match exactly once in exactly one file; its replacement; the groups its leg runs (`only`:
// 'original' runs the original groups alone; request identity keys (comma list) run only those groups; `browser` adds the
// installed-Chrome leg); and the `owner-cont:` assertion the integration must then fail with.
export const DEFECTS = [
  // The archive copies the live turns without the journal's current receipts: a stale working receipt then blocks every later reset
  // (or the archive misses the receipts).
  { only: 'original', name: 'archive-raw-turns', anchor: /const turns = \(await conversationReceipts\(kind, c\)\)\.turns/g, replacement: 'const turns = c.turns', expect: /owner-cont:archive-keeps-receipts|owner-cont:positive POST \/api\/finance-chat\/workspace\/new/ },
  // The cb49 rule broken for owner archives: a stale un-adopted copy is deleted and recreated under a new id instead of replaced in place.
  { only: 'original', name: 'stale-copy-recreated', anchor: /await FinanceOwnerConversationArchive(\$\d+)?\.collection\.replaceOne\(\{ _id: existing\._id, ownerId: c\.ownerId, conversationKind: kind,/g, replacement: (m, suffix = '') => `await FinanceOwnerConversationArchive${suffix}.deleteOne({ _id: existing._id }); existing._id = new existing._id.constructor(); await FinanceOwnerConversationArchive${suffix}.collection.insertOne({ ...candidate.toObject({ virtuals: false }), _id: existing._id }); if (false) await FinanceOwnerConversationArchive${suffix}.collection.replaceOne({ _id: existing._id, ownerId: c.ownerId, conversationKind: kind,`, expect: /owner-cont:stale-copy-keeps-id/ },
  { only: 'original', name: 'no-ui-company-mask', anchor: /function maskTurns(\$\d+)?\(turns, organizationId\) \{/g, replacement: m => m + ' return turns;', expect: /owner-cont:bridge-ui-masked-other-company|owner-cont:bridge-archive-masked/ },
  { only: 'original', name: 'no-model-history-withhold', anchor: /function withholdMessages(\$\d+)?\(messages, turns, organizationId\) \{/g, replacement: m => m + ' return messages;', expect: /owner-cont:bridge-switch-history-withheld|owner-cont:bridge-narrow-history-withheld/ },
  { only: 'original', name: 'claim-without-membership', anchor: /const checked = await companyMembership\(\s*String\(ownerId\),\s*String\(frozen\.organizationId\)\s*\)\.catch\(/g, replacement: 'const checked = await Promise.resolve(frozenCompanyId(frozen)).catch(', expect: /owner-cont:bridge-revoked-no-recall|owner-cont:bridge-revoked-action-refused|owner-cont:bridge-action-fresh-check/ },
  { only: 'original', name: 'teaching-for-narrow-worker', anchor: /if \(!\(agent == null \? void 0 : agent\.workspaceEnabled\)\) return null;|if \(!agent\?\.workspaceEnabled\) return null;/g, replacement: 'if (false) return null;', expect: /owner-cont:bridge-narrow-card-only/ },
  { only: 'original', name: 'sync-without-marker', anchor: /\.\.\.operation \? \{ jobOperation: \{ operationId: operation\.operationId, jobId, at: requestedAt \} \} : \{\}/g, replacement: '...{}', expect: /owner-cont:sync-native-marker/ },
  { only: 'original', name: 'auto-sync-whole-object', anchor: /\$set: \{ "autoSync\.enabled": input\.enabled, "autoSync\.hour": input\.hour,/g, replacement: '$set: { autoSync: { enabled: input.enabled, hour: input.hour },', expect: /owner-cont:auto-keeps-lastQueuedDay/ },
  { only: 'original', name: 'workflow-unscoped', anchor: /if \(readScope\) filter\.accountId = \{ \$in: readScope\.accountIds\.map\(\(a\) => id\(a\)\) \};/g, replacement: '', expect: /owner-cont:workflow-assigned-only|owner-cont:workflow-unassigned-refused/ },
  // The native allocation request id no longer derives from the journal operation: the receipt cannot be tied to its allocation.
  { only: 'original', name: 'allocation-unbound-request', anchor: /requestId: "navi_" \+ operation\.operationId/g, replacement: 'requestId: "navi_" + operation.operationId.split("").reverse().join("")', expect: /owner-cont:action confirm_card_allocation|owner-cont:alloc-request-marker|owner-cont:alloc-retry-same|owner-cont:alloc-recovery-save/ },
  // Request identity across New chat (plan omf-navi-agent-owner-retry-20261023), server. The send checks live turns only again: an archived
  // accepted request is queued and claimed again (the reproduced leads, owner and purchase).
  { only: 'owner-identity', name: 'owner-received-live-only', anchor: 'const archived = c ? await findOwnerReceivedRequest("workspace", { ownerId }, requestId, c, postingCompany?.organizationId || null) : null;', replacement: 'const archived = null;', expect: /owner-cont:owner-archived-request-never-requeued/ },
  { only: 'purchase-identity', name: 'purchase-received-live-only', anchor: 'const archived = c ? await findOwnerReceivedRequest("purchase", scope, requestId, c, postingCompany?.organizationId || null) : null;', replacement: 'const archived = null;', expect: /owner-cont:purchase-archived-request-never-requeued/ },
  // An archived id with another meaning is answered as the earlier request instead of the existing 409.
  { only: 'owner-identity', name: 'owner-received-meaning-unchecked', anchor: /if \(!sameOwnerRequestMeaning\(archived\.turn, \{ requestHash, text \}\)\) fail\(409, "[^"]*"\);(\s*return \{ \.\.\.await getAssistant\()/g, replacement: '$1', expect: /owner-cont:owner-archived-meaning-conflict/ },
  // The workspace meaning without its page context, the purchase meaning without its draft binding and references.
  { only: 'owner-identity', name: 'owner-meaning-without-context', anchor: 'canonicalJson({ text, context: body.context === void 0 ? null : body.context })', replacement: 'canonicalJson({ text })', expect: /owner-cont:owner-archived-context-conflict/ },
  { only: 'purchase-identity', name: 'purchase-meaning-without-binding', anchor: 'canonicalJson({ text, draft: { revision: body.revision ?? null, key: body.key ?? null, sourceHash: body.sourceHash ?? null }, references: body.references ?? null })', replacement: 'canonicalJson({ text })', expect: /owner-cont:purchase-binding-conflict/ },
  // The purchase recognition after the draft binding check: the request's own completed save turns its retry into a refusal.
  { only: 'purchase-identity', name: 'purchase-recognition-after-binding', anchor: 'const archived = c ? await findOwnerReceivedRequest("purchase",', replacement: 'bound(d, body); const archived = c ? await findOwnerReceivedRequest("purchase",', expect: /owner-cont:purchase-own-draft-change-recognised/ },
  // The send uses the raw id again: a JSON-number id is stored as a number but queued as a string, and the claim fails.
  { only: 'owner-numeric', name: 'owner-uncanonicalized-id', anchor: 'return { requestId: String(body.requestId), text, requestHash: createHash("sha256")', replacement: 'return { requestId: body.requestId, text, requestHash: createHash("sha256")', expect: /owner-cont:owner-canonical-id-claimable/ },
  { only: 'purchase-identity', name: 'purchase-uncanonicalized-id', anchor: 'return { requestId: String(body.requestId), text, requestHash: hash(canonicalJson(', replacement: 'return { requestId: body.requestId, text, requestHash: hash(canonicalJson(', expect: /owner-cont:purchase-canonical-id-claimable/ },
  // A legacy id kept as a number is looked up as a string only; a legacy turn (no hash) matches any meaning.
  { only: 'owner-numeric', name: 'legacy-numeric-unrecognised', anchor: 'return /^-?\\d+$/.test(requestId) && Number.isFinite(n) && String(n) === requestId ? [requestId, n] : [requestId];', replacement: 'return [requestId];', expect: /owner-cont:owner-legacy-numeric-recognised/ },
  { only: 'owner-apart', name: 'legacy-text-unchecked', anchor: 'turn?.requestHash ? turn.requestHash === meaning.requestHash : turn?.text === meaning.text', replacement: 'turn?.requestHash ? turn.requestHash === meaning.requestHash : true', expect: /owner-cont:owner-legacy-meaning-conflict/ },
  // An unadopted reset copy counts as accepted history; archives of another owner or conversation count; the answer is not masked.
  { only: 'owner-apart', name: 'received-unadopted', anchor: 'conversationId: c._id, segment: { $lt: c.segment || 0 }, "turns.id": { $in: forms } })', replacement: 'conversationId: c._id, "turns.id": { $in: forms } })', expect: /owner-cont:owner-unadopted-not-evidence/ },
  { only: 'owner-apart', name: 'received-any-conversation', anchor: 'FinanceOwnerConversationArchive.find({ ownerId: identity.ownerId, conversationKind: kind, conversationId: c._id, segment: { $lt: c.segment || 0 }, "turns.id"', replacement: 'FinanceOwnerConversationArchive.find({ segment: { $lt: c.segment || 0 }, "turns.id"', expect: /owner-cont:owner-foreign-archive-not-evidence/ },
  { only: 'owner-apart', name: 'received-unmasked', anchor: 'const m = maskTurns([archivedTurn(t)], organizationId)[0]', replacement: 'const m = [archivedTurn(t)][0]', expect: /owner-cont:owner-received-masked/ },
  // New chat with a named request: no fence row on an absent conversation, no fence on an empty segment (the reproduced no-op), no
  // second fence for a lost reset, a repeated reset id recognised whatever it names, the named request never looked up.
  { only: 'owner-pending', name: 'absent-reset-unfenced', anchor: 'created = (await model.create({ ...create, revision: 1, lastReset: { id: body.requestId, at: /* @__PURE__ */ new Date(), pending: meaning, outcome: "not_accepted", revision: 1 } })).toObject();', replacement: 'created = { ...create, _id: "unfenced" };', expect: /owner-cont:owner-absent-reset-fence/ },
  { only: 'owner-pending', name: 'empty-reset-unfenced', anchor: 'const fenced = await model.updateOne(ownerResetFence(kind, identity, c), {', replacement: 'const fenced = { matchedCount: 1 } || await model.updateOne(ownerResetFence(kind, identity, c), {', expect: /owner-cont:owner-empty-reset-fence/ },
  { only: 'owner-pending', name: 'lost-reset-not-refenced', anchor: 'const fenced = await modelOf(kind).updateOne({ ...ownerResetFence(kind, identity, c), "lastReset.id": body.requestId }, {', replacement: 'const fenced = { matchedCount: 1 } || await modelOf(kind).updateOne({ ...ownerResetFence(kind, identity, c), "lastReset.id": body.requestId }, {', expect: /owner-cont:owner-lost-reset-refenced/ },
  { only: 'owner-pending', name: 'lost-reset-meaning-unchecked', anchor: 'if (!sameOwnerResetMeaning(c.lastReset, meaning)) fail(409, ownerConflictRefusal);', replacement: '', expect: /owner-cont:owner-lost-reset-conflicting-meaning/ },
  { only: 'owner-pending', name: 'reset-pending-unrecognised', anchor: 'const found = meaning ? await findOwnerReceivedRequest(kind, identity, meaning.requestId, { ...c, turns }, pending.organizationId) : null;', replacement: 'const found = null;', expect: /owner-cont:owner-reset-recognises-accepted/ },
  // The purchase New chat loses the checked draft identity: an absent purchase conversation cannot be fenced.
  { only: 'purchase-pending', name: 'purchase-fence-without-identity', anchor: /(startNewOwnerConversation\("purchase", scope, body, pending\d*, )pending\d* \? \{ \.\.\.scope, accountId: d\.source\.account\.id \} : null/g, replacement: '$1null', expect: /owner-cont:purchase-absent-reset-status/ },
  // The bounded owner/purchase reader drops its truncation flag: a capped count reads as exact (parent lead A).
  { only: 'chrome-received-count', browser: true, name: 'received-count-truncation-dropped', anchor: 'occurrencesTruncated: rows.length > ownerReceivedLimit', replacement: 'occurrencesTruncated: false', expect: /owner-cont:chrome-owner-received-count-native|owner-cont:chrome-purchase-received-count-native/ },
  // Client (the compiled conversation chunk; minified names of the build they were recorded on, candidate-04, refreshed with it). Owner
  // realm: New chat needs turns again; New chat does not name the uncertain request; the owner answer is ignored; the selection hold is
  // gone; an accepted answer clears the edited text; no parent refresh from the archived receipt; a lost New chat reply drops the frozen
  // reset request; a capped History count reads as exact.
  { only: 'chrome-owner-fence', browser: true, kind: 'client', name: 'owner-empty-new-chat-disabled', anchor: 'disabled:e(b)||e(P)||!(e(l).pending[e(H)]||e(ee).length)', replacement: 'disabled:e(b)||e(P)||!e(ee).length', expect: /owner-cont:chrome-owner-empty-new-chat-entry/ },
  { only: 'chrome-owner-fence', browser: true, kind: 'client', name: 'owner-pending-not-named', anchor: 'async function He(){const s=l.pending[H]||null;', replacement: 'async function He(){const s=I.company?l.pending[H]||null:null;', expect: /owner-cont:chrome-owner-reset-names-pending/ },
  { only: 'chrome-owner-received', browser: true, kind: 'client', name: 'owner-answer-ignored', anchor: 'i.scope?.realm!=="workspace"', replacement: '!0', expect: /owner-cont:chrome-owner-received-history/ },
  { only: 'chrome-owner-hold', browser: true, kind: 'client', name: 'owner-pending-retargeted', anchor: 'return!I.company&&!!s&&s.org!==String(Re(o.token)?.organizationId||"")', replacement: 'return!1', expect: /owner-cont:chrome-owner-pending-held-other-company/ },
  { only: 'chrome-owner-received', browser: true, kind: 'client', name: 'owner-received-clears-edited', anchor: '(delete l.pending[H],G.value===s.rawText&&(G.value=""),i.where==="archive"', replacement: '(delete l.pending[H],G.value="",i.where==="archive"', expect: /owner-cont:chrome-owner-edited-text-kept/ },
  { only: 'chrome-owner-received', browser: true, kind: 'client', name: 'owner-received-no-refresh', anchor: '(I.company||Ce(i.turn?.actions||[]),Je(i))', replacement: '(Je(i))', expect: /owner-cont:chrome-owner-received-refreshes-draft/ },
  { only: 'chrome-owner-lost-reset', browser: true, kind: 'client', name: 'owner-reset-identity-not-frozen', anchor: 'catch(g){(g?.statusCode||g?.status)&&(j=null),O()&&ie(g)}', replacement: 'catch(g){j=null,O()&&ie(g)}', expect: /owner-cont:chrome-owner-lost-reset-same-identity/ },
  { only: 'chrome-received-count', browser: true, kind: 'client', name: 'owner-received-count-unqualified', anchor: '(e(A).truncated?"件以上":"件")', replacement: '"件"', expect: /owner-cont:chrome-owner-received-count-qualified/ },
  // Purchase: an edited text replaces the uncertain request (a new id); New chat needs turns again; a fenced request stays pending; an
  // accepted answer clears the edited text, hides History or skips the draft refresh; an HTTP 400/409 of a new request's first attempt
  // releases it again (the earlier build's rule; probed on the genuine stale refusal and on the induced after-write 409); a refused retry
  // releases it; the selection hold is gone; a capped History count reads as exact.
  { only: 'chrome-purchase-received', browser: true, kind: 'client', name: 'purchase-text-replaces-uncertain', anchor: 'x||(h.pending[b]={id:de(),', replacement: '(h.pending[b]={id:de(),', expect: /owner-cont:chrome-purchase-frozen-original/ },
  { only: 'chrome-purchase-fence', browser: true, kind: 'client', name: 'purchase-empty-new-chat-disabled', anchor: 'disabled:e(f)||e(F)||!(e(j).length||e(ze))', replacement: 'disabled:e(f)||e(F)||!e(j).length', expect: /owner-cont:chrome-purchase-empty-new-chat-entry/ },
  { only: 'chrome-purchase-fence', browser: true, kind: 'client', name: 'purchase-fenced-pending-kept', anchor: 'p.outcome==="not_accepted"&&(delete h.pending[b],w.value.trim()||(w.value=x.rawText))', replacement: 'p.outcome==="not_accepted"&&(w.value.trim()||(w.value=x.rawText))', expect: /owner-cont:chrome-purchase-fence-releases/ },
  { only: 'chrome-purchase-received', browser: true, kind: 'client', name: 'purchase-received-clears-edited', anchor: '(delete h.pending[b],w.value===x.rawText&&(w.value=""),p.where==="archive"', replacement: '(delete h.pending[b],w.value="",p.where==="archive"', expect: /owner-cont:chrome-purchase-edited-text-kept/ },
  { only: 'chrome-purchase-received', browser: true, kind: 'client', name: 'purchase-received-history-hidden', anchor: 'p.where==="archive"&&p.archive?.id&&(_e(p.turn?.actions||[]),nt(p))', replacement: 'p.where==="archive"&&p.archive?.id&&(_e(p.turn?.actions||[]),!1)', expect: /owner-cont:chrome-purchase-received-history/ },
  { only: 'chrome-purchase-received', browser: true, kind: 'client', name: 'purchase-received-no-refresh', anchor: '(_e(p.turn?.actions||[]),nt(p))', replacement: '(nt(p))', expect: /owner-cont:chrome-purchase-received-refreshes-draft/ },
  { only: 'chrome-purchase-refusal', browser: true, kind: 'client', name: 'purchase-first-refusal-released', anchor: 'requestId:p.id,references:p.references}})', replacement: 'requestId:p.id,references:p.references}}).catch(zq=>{throw!x&&h.pending[b]===p&&((zq?.statusCode||zq?.status)===400||(zq?.statusCode||zq?.status)===409)&&delete h.pending[b],zq})', expect: /owner-cont:chrome-purchase-fresh-refusal-kept/ },
  { only: 'chrome-purchase-induced-refusal', browser: true, kind: 'client', name: 'purchase-after-write-refusal-released', anchor: 'requestId:p.id,references:p.references}})', replacement: 'requestId:p.id,references:p.references}}).catch(zq=>{throw!x&&h.pending[b]===p&&((zq?.statusCode||zq?.status)===400||(zq?.statusCode||zq?.status)===409)&&delete h.pending[b],zq})', expect: /owner-cont:chrome-purchase-induced-refusal-kept/ },
  { only: 'chrome-purchase-refusal', browser: true, kind: 'client', name: 'purchase-retry-refusal-released', anchor: 'requestId:p.id,references:p.references}})', replacement: 'requestId:p.id,references:p.references}}).catch(zq=>{throw x&&h.pending[b]===p&&(zq?.statusCode||zq?.status)===409&&delete h.pending[b],zq})', expect: /owner-cont:chrome-purchase-retry-refusal-kept/ },
  { only: 'chrome-purchase-hold', browser: true, kind: 'client', name: 'purchase-pending-retargeted', anchor: 'Ee=M(()=>!!ze.value&&ze.value.org!==String(Re(u.token)?.organizationId||""))', replacement: 'Ee=M(()=>!1)', expect: /owner-cont:chrome-purchase-pending-held-other-company/ },
  { only: 'chrome-received-count', browser: true, kind: 'client', name: 'purchase-received-count-unqualified', anchor: '(e(re).truncated?"件以上":"件")', replacement: '"件"', expect: /owner-cont:chrome-purchase-received-count-qualified/ }
];

function scrubbedEnv(appRoot, browser, only) {
  const env = { ...process.env, OMF_OWNER_CONT_FIXTURE: 'owned', OMF_OWNER_CONT_APP_ROOT: appRoot, OMF_OWNER_CONT_BROWSER: browser ? '1' : '0', OMF_OWNER_CONT_ONLY: only || '', ...(existsSync(binary) ? { OMF_MONGOD_BINARY: binary, MONGOMS_SYSTEM_BINARY: binary } : {}) };
  for (const key of ['MONGO_URI', 'MONGODB_URI', 'NUXT_MONGO_URI', 'MONGO_URL', 'MONGODB_URL', 'DATABASE_URL']) env[key] = 'mongodb://127.0.0.1:1/zfx_no_ambient_database';
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_SETUP_TOKEN', 'SLACK_BOT_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) env[key] = 'no-model-or-business-send';
  for (const key of Object.keys(env)) if (key.startsWith('OMF_TEST_')) delete env[key];
  return env;
}
// This tree's integration (and its chained Chrome leg) always runs; `appRoot` is the built app it starts (this tree or a packaged copy).
function run(appRoot, { browser = false, only = '', timeout = 1500000 } = {}) {
  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, [path.join(root, 'scripts', 'finance-navi-owner-continuation-integration.cjs')], { cwd: appRoot, env: scrubbedEnv(appRoot, browser, only), windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      const text = String(stdout || '') + '\n' + String(stderr || '');
      resolve({ ms: Date.now() - started, code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0, killed: !!error?.killed, text, passes: String(stdout || '').split(/\r?\n/).filter(l => l.startsWith('PASS ')).map(l => l.slice(5)) });
    });
  });
}
function unitTests() {
  const tests = ['scripts/finance-assistant.test.mjs', 'scripts/finance-chat.test.mjs', 'scripts/finance-interpreter-stream.test.mjs', 'scripts/finance-navi-features.test.mjs'];
  return new Promise(resolve => execFile(process.execPath, ['--test', ...tests], { cwd: root, env: scrubbedEnv(root, false), windowsHide: true, timeout: 300000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0, text: String(stdout || '') + String(stderr || '') })));
}
const tail = r => (r.text.split(/\r?\n/).filter(l => /owner-cont:|AssertionError|Error|SETUP|^FAIL /.test(l)).slice(0, 6).join(' | ') || r.text.slice(-600)).replace(/\s+/g, ' ').slice(0, 900);
async function filesOf(dir, ext) { const out = []; if (!existsSync(dir)) return out; for (const entry of await readdir(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) out.push(...await filesOf(full, ext)); else if (entry.name.endsWith(ext)) out.push(full); } return out; }
const occurrences = (text, anchor) => typeof anchor === 'string' ? text.split(anchor).length - 1 : (text.match(anchor) || []).length;
// Applies one defect to the copy and returns the edited files with their original text (restored after the leg).
async function applyDefect(outputDir, defect) {
  const client = defect.kind === 'client', files = client ? await filesOf(path.join(outputDir, 'public', '_nuxt'), '.js') : await filesOf(path.join(outputDir, 'server', 'chunks'), '.mjs');
  let hits = 0, target = null;
  for (const file of files) { const text = await readFile(file, 'utf8'); const n = occurrences(text, defect.anchor); if (n) { hits += n; target = { file, text }; } }
  if (hits !== 1) throw new Error(`SETUP: defect ${defect.name}: anchor matched ${hits} times (expected exactly 1)`);
  const edited = typeof defect.anchor === 'string' ? target.text.replace(defect.anchor, () => defect.replacement) : target.text.replace(defect.anchor, defect.replacement);
  const writes = [{ file: target.file, text: target.text, edited }];
  if (client) {
    // The copy's static asset manifest records each public asset's size: it follows the edited bytes (exactly one entry). Everything
    // is checked before any file is written, so a setup error leaves the copy untouched.
    const manifest = (await filesOf(path.join(outputDir, 'server', 'chunks'), '.mjs')).find(f => f.endsWith(path.join('_', 'nitro.mjs')));
    if (!manifest) throw new Error(`SETUP: defect ${defect.name}: static asset manifest not found`);
    const m = await readFile(manifest, 'utf8'), name = path.basename(target.file), entry = new RegExp('("/_nuxt/' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '": \\{[^}]*?"size": )(\\d+)', 'g'), found = [...m.matchAll(entry)];
    if (found.length !== 1) throw new Error(`SETUP: defect ${defect.name}: asset manifest entry for ${name} matched ${found.length} times`);
    writes.push({ file: manifest, text: m, edited: m.replace(entry, (all, head) => head + Buffer.byteLength(edited)) });
  }
  for (const w of writes) await writeFile(w.file, w.edited);
  return writes.map(({ file, text }) => ({ file, text }));
}

export default {
  name: 'omf-navi-owner-continuation',
  covers: BUILT ? [...SCRIPT_COVERS, ...APP_COVERS] : SCRIPT_COVERS,
  async run() {
    const started = Date.now(), lines = [];
    let pass = true, positive = null, control = null, units = null;
    const defects = [];
    // 1 positive: the built app on its own owned database, with the installed-Chrome leg chained at its end.
    if (!BUILT) { pass = false; lines.push('1 built app: NOT RUN — .output/server/index.mjs is missing (run nuxt build first); no coverage claimed'); }
    else {
      positive = await run(root, { browser: true });
      await writeFile(path.join(root, '.zoomer-owner-continuation-integration.txt'), positive.text).catch(() => {});
      const done = positive.text.match(/(\d+) owner continuation groups passed/), browser = positive.passes.filter(p => /^browser /.test(p)), red = positive.text.split(/\r?\n/).filter(l => l.startsWith('FAIL ')).map(l => l.slice(5, 900));
      if (positive.code !== 0 || !done || Number(done[1]) !== positive.passes.length || positive.passes.length !== EXPECTED || browser.length !== EXPECTED_BROWSER) { pass = false; lines.push(`1 built app: RED — exit ${positive.killed ? 'timeout' : positive.code}, ${positive.passes.length}/${EXPECTED} groups green (${browser.length}/${EXPECTED_BROWSER} browser)${red.length ? ' · red groups: ' + red.join(' ‖ ') : ''}: ${tail(positive)}`); }
      else lines.push(`1 built app: ok (${positive.passes.length} groups incl. ${browser.length} installed-Chrome in ${Math.round(positive.ms / 1000)}s)`);
    }
    // 2 sibling unit tests (pure, no database or model).
    units = await unitTests();
    const summary = units.text.match(/[#ℹ] pass (\d+)[\s\S]*?[#ℹ] fail (\d+)/);
    if (units.code !== 0 || !summary || summary[2] !== '0') { pass = false; lines.push(`2 unit tests: RED — exit ${units.code}: ${units.text.split(/\r?\n/).filter(l => /not ok|Error|failed/i.test(l)).slice(0, 6).join(' | ').slice(0, 600)}`); }
    else lines.push(`2 unit tests: ok (${summary[1]} tests, 0 failed)`);
    // 3-4 packaged copy control and named compiled defects, only when leg 1 is green.
    if (pass) {
      const base = path.resolve(root, '.zoomer', 'owner-continuation-defects'), directory = path.resolve(base, randomUUID());
      if (!directory.startsWith(base + path.sep)) throw new Error('Unsafe owned test directory');
      try {
        await mkdir(directory, { recursive: true });
        await cp(path.join(root, '.output'), path.join(directory, '.output'), { recursive: true, dereference: true });
        await cp(path.join(root, 'shared'), path.join(directory, 'shared'), { recursive: true, dereference: true });
        control = await run(directory, { browser: true });
        const controlOk = control.code === 0 && control.passes.length === EXPECTED && control.passes.filter(p => /^browser /.test(p)).length === EXPECTED_BROWSER;
        lines.push(`3 unchanged packaged copy: ${controlOk ? `ok (${control.passes.length} groups incl. Chrome in ${Math.round(control.ms / 1000)}s)` : 'RED — ' + tail(control)}`);
        if (!controlOk) pass = false;
        else for (const defect of DEFECTS) {
          let touched = [];
          try {
            touched = await applyDefect(path.join(directory, '.output'), defect);
            const r = await run(directory, { browser: !!defect.browser, only: defect.only }), detected = r.code !== 0 && defect.expect.test(r.text) && !/SETUP/.test(r.text);
            defects.push({ name: defect.name, touched: touched.map(t => path.relative(path.join(directory, '.output'), t.file)).join(', '), detected, exit: r.code, ms: r.ms, tail: tail(r) });
            if (!detected) pass = false;
          } catch (error) { defects.push({ name: defect.name, detected: false, setupError: String(error.message).slice(0, 300) }); pass = false; }
          finally { for (const t of touched) await writeFile(t.file, t.text); }
        }
        lines.push(`4 defects: ${defects.map(d => d.name + ':' + (d.detected ? 'detected' : 'NOT DETECTED' + (d.setupError ? ' (' + d.setupError + ')' : ' — ' + d.tail))).join(' · ')}`);
      } finally { await rm(directory, { recursive: true, force: true }); }
    } else if (BUILT) lines.push('3-4 control and defects: NOT RUN — legs 1-2 are not green, defects prove nothing');
    pass = pass && !!control && defects.length === DEFECTS.length && defects.every(d => d.detected);
    const databaseCoverage = positive && positive.code === 0 ? { executed: true, ownedProcess: true } : { executed: false, ownedProcess: false };
    return { pass, databaseCoverage, message: `${pass ? 'navi owner continuation green' : 'FAILED'} in ${Math.round((Date.now() - started) / 1000)}s — ${lines.join(' · ')} · limits: synthetic owned native HTTP/worker protocol and installed-Chrome evidence with synthetic worker replies, no model draw; request identity groups use controlled worker sequences and induced network losses (a lost reply is a real accepted request whose browser copy of the reply is failed; a lost first copy never reaches the server), so they prove transport, identity, fence, masking and client recovery, not a model decision, a production duplicate or a payment; live model acceptance, historical/production observation, independent review and deployed replay remain open.` };
  }
};
