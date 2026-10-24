// Fixture for plan omf-navi-api-actions-20261016 (5-plan-build-20261016.json): Navi executes named, lease-bound actions on the
// owner's records through a durable operation journal; proposals are server-owned immutable references; accounting and
// classification memories are independent events.
// Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-navi-api-actions.mjs --cwd <this worktree>
// Legs: 1 proposal reference helpers (pure) · 2 the owned actions MCP server against a synthetic HTTP service and a private Vault
// (stdio JSON-RPC, no model) · 3 the built app (scripts/finance-navi-actions-integration.cjs chained by the assistant scope
// harness on its own ephemeral MongoDB; NOT RUN and red when .output/server/index.mjs is missing) · 4 node --test of the sibling
// unit tests · 5 an unmutated packaged control, then the plan's seven mutants and the heartbeat-expiry defect (2026-10-23), each
// reintroduced into an isolated copy of the built output and required to flip its named final-state assertion · 6 the native CLI
// tool-only smoke, which uses the model and runs only with OMF_NAVI_CLI_SMOKE=1;
// otherwise it is declared NOT RUN (separate evidence, never counted as coverage). No model, no network and no production
// database in legs 1-5. `covers` is decided at load: built-app files are listed only when the build exists.
// Fail-first on acc7d78: leg 3 is the behavioural failure (the existing message/worker/result flow finishes, the requested
// draft change and its receipt are absent). Legs 1-2 fail on a missing module there; that is setup, not evidence.
// Maintenance 2026-10-23 (plan omf-navi-agent-replay-20261022): leg 5 first runs an unmutated packaged copy of the build (positive
// control: it must pass exactly like leg 3 before any defect counts) and gains an eighth defect, the native job heartbeat renewing a
// job whose deadline already passed (its exact existing navi:purchase-expired-not-resurrected assertion must flip).
// OMF_NAVI_RENEWAL_TIMING_DIAGNOSTIC=1 is a separately labeled controlled timing diagnostic, never part of a normal run and never
// coverage (covers [] at load, always reported as a failure): a packaged copy whose native job heartbeat waits a declared 1500 ms
// before reading its clock runs the same integration and reports whether the positive renewal case still depends on a short
// scheduling window. The delay is induced; it is not the cause of the original unexplained navi:purchase-renewal-accepted failure,
// whose timing was never captured.
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 2400000;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const BUILT = existsSync(path.join(REPO_ROOT, '.output', 'server', 'index.mjs'));
const TIMING_DIAGNOSTIC = process.env.OMF_NAVI_RENEWAL_TIMING_DIAGNOSTIC === '1';
const PURE_COVERS = ['shared/finance-action-proposal.mjs', 'shared/finance-action-proposal.d.mts', 'shared/finance-research.mjs', 'shared/finance-research.d.mts', 'teaching-worker/actions-mcp.mjs', 'teaching-worker/interpreter.mjs', 'teaching-worker/worker.mjs', 'teaching-worker/run.mjs', 'research-worker/run.mjs', 'scripts/finance-chat.test.mjs', 'scripts/finance-assistant-worker.test.mjs', 'scripts/finance-assistant.test.mjs', 'scripts/finance-research.test.mjs'];
const APP_COVERS = ['server/services/financeActionService.ts', 'server/services/financeAssistantService.ts', 'server/services/financeChatService.ts', 'server/services/financeDraftService.ts', 'server/services/financeLearningService.ts', 'server/services/financeResearchService.ts', 'server/models/FinanceActionOperation.ts', 'server/models/FinanceDecisionMemory.ts', 'server/api/finance-chat/[...path].ts', 'server/api/finance-learning/[...path].ts', 'components/finance/AssistantConversation.vue', 'components/finance/PurchaseChat.vue', 'pages/learning.vue', 'scripts/finance-integration.cjs', 'scripts/finance-navi-actions-integration.cjs', 'scripts/finance-navi-recovery-integration.cjs', 'scripts/finance-assistant-scope-integration.cjs', 'docs/purchase-chat.md'];
const u = p => pathToFileURL(path.join(REPO_ROOT, p)).href;

function run(args, env, timeout, cwd = REPO_ROOT) {
  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, args, { cwd, windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024, env }, (error, stdout, stderr) => {
      const text = String(stdout || '');
      resolve({ ms: Date.now() - started, code: error ? (error.code ?? 1) : 0, killed: !!error?.killed, stdout: text, stderr: String(stderr || ''), passes: text.split(/\r?\n/).filter(l => l.startsWith('PASS ')).map(l => l.slice(5)) });
    });
  });
}
const integrationTail = r => (r.stderr.split('\n').filter(l => /Error|assert|expected|actual|navi:|at /i.test(l)).slice(0, 8).join(' | ') || r.stdout.slice(-800)).replace(/\s+/g, ' ');

// A JSON-RPC client over the MCP child's stdio (newline-delimited, the same framing research-worker/mcp.mjs uses).
function rpcClient(child) {
  let buffer = '', seq = 0; const waiting = new Map(); const events = [];
  child.stdout.on('data', chunk => { buffer += chunk; let i; while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); events.push(line); let m; try { m = JSON.parse(line); } catch { continue; } if (m.id !== undefined && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } });
  return { events, call(method, params = {}, ms = 30000) { const id = ++seq; return new Promise((resolve, reject) => { const t = setTimeout(() => { waiting.delete(id); reject(new Error(method + ' timed out')); }, ms); waiting.set(id, m => { clearTimeout(t); resolve(m); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }); } };
}
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const body = req => new Promise(resolve => { let t = ''; req.on('data', c => t += c); req.on('end', () => resolve(t)); });
const safeTemp = async dir => { const resolved = await (await import('node:fs/promises')).realpath(dir), temp = await (await import('node:fs/promises')).realpath(os.tmpdir()); if (!resolved.startsWith(temp + path.sep)) throw new Error('Unsafe temp cleanup'); await rm(resolved, { recursive: true, force: true }); };

// The plan's seven mutants and the 2026-10-23 heartbeat-expiry defect: a whitespace-tolerant anchor in the built nitro chunks
// (esbuild reprints the services), the defect text, and the `navi:` assertion the integration must then fail with.
export const MUTANTS = [
  { name: 'remove-accounting-memory-start-date', anchor: /,\s*\$or:\s*\[\s*\{\s*effectiveFrom:\s*\{\s*\$lte:\s*row\.purchaseDate\s*\}\s*\},\s*\{\s*effectiveFrom:\s*null\s*\}\s*\]/g, replacement: '', expect: /navi:accounting-memory-before-start-excluded/ },
  { name: 'remove-domain-save', anchor: /await saveDraft\(\s*ownerId,\s*importId,\s*line,\s*saveBody,/g, replacement: 'await ((...a) => readDraft(a[0], a[1], a[2]))(ownerId, importId, line, saveBody,', expect: /navi:save-accepted-revision|navi:read-after-write/ },
  { name: 'cached-pre-write-read', anchor: /if \(definition\.effect === ["']read["']\)\s*return \{\s*name: definition\.name,\s*effect: ["']read["'],\s*result: await definition\.run\(scope, args, target, null\)\s*\};?/g, replacement: 'if (definition.effect === "read") { const readHash = sha(canonicalJson({ name: definition.name, args })); const cached = await FinanceActionOperation.findOne({ conversationKind: scope.kind, conversationId: scope.conversation._id, turnId: scope.turnId, payloadHash: readHash, "receipt.cachedResult": { $exists: true } }).lean(); if (cached) return { name: definition.name, effect: "read", result: cached.receipt.cachedResult }; const result = await definition.run(scope, args, target, null); await FinanceActionOperation.updateOne({ conversationKind: scope.kind, conversationId: scope.conversation._id, turnId: scope.turnId, slot: 1000 + body.slot }, { $setOnInsert: { ownerId: scope.agent.ownerId, operationId: sha(["read", scope.conversationId, scope.turnId, body.slot].join(":")).slice(0, 32), name: definition.name, payloadHash: readHash, state: "done", receipt: { cachedResult: result } } }, { upsert: true }); return { name: definition.name, effect: "read", result }; }', expect: /navi:read-after-write/ },
  { name: 'latest-report-instead-of-reference', anchor: /pickReference\(\s*turn\.references,\s*kind\s*\)/g, replacement: '(kind === "research" ? await (async () => { const v = await researchView(ownerId, importId, line); return { ...v.research.reference, snapshot: { findings: v.research.report.findings.map(f => ({ field: f.field, value: f.value })) } }; })() : pickReference(turn.references, kind))', expect: /navi:changed-report-refused-during-execution|navi:no-different-report-applied/ },
  { name: 'drop-operation-history-marker', anchor: [/\.\.\.\(?\s*operation\s*\?\s*\{\s*operation\s*\}\s*:\s*\{\}\s*\)?/g, /h\.operation\?\.operationId\s*===\s*operation\.operationId/g], replacement: ['...{}', 'false'], expect: /navi:crash-after-write-reconciled|navi:crash-after-write-no-second-write/ },
  { name: 'ignore-lease-scope', anchor: /const lease = \{\s*lease:\s*body\.lease,\s*leaseUntil:\s*\{\s*\$gt:\s*(?:\/\*[^*]*\*\/\s*)?new Date\(\)\s*\}\s*\}/g, replacement: 'const lease = {}', expect: /navi:expired-lease-cannot-act|navi:expired-lease-cannot-replace-receipt/ },
  { name: 'remember-approves-draft', anchor: /const inserted\s*=\s*await insertMemoryEvent\(event\)/g, replacement: 'const inserted = await insertMemoryEvent(event); await FinanceDraft.updateOne({ ownerId, importId, line }, { $set: { approvedAt: new Date() } })', expect: /navi:remember-no-approval/ },
  { name: 'lose-journal-receipts', anchor: /return \(await recoverRows\(kind, conversationId, rows\)\)\.map\(receiptOf\)/g, replacement: 'return []', expect: /navi:register-receipt/ },
  // The native job heartbeat drops its own deadline: a working purchase or owner-workspace job whose lease already expired is
  // renewed (resurrected) by its old worker instead of refused.
  { name: 'remove-heartbeat-expiry', anchor: /state:\s*["']working["'],\s*lease:\s*job\.lease,\s*leaseUntil:\s*\{\s*\$gt:\s*now\s*\},/g, replacement: 'state: "working", lease: job.lease,', expect: /navi:purchase-expired-not-resurrected/ }
];
// The separately labeled controlled timing diagnostic (header): the copy's native job heartbeat waits a declared interval before it
// reads the clock that both its deadline check and its renewal use. Applied only to a disposable packaged copy, like a defect.
export const TIMING_DELAY = { name: 'induced-renewal-delay', delayMs: 1500, anchor: /const now = (?:\/\*[^*]*\*\/\s*)?new Date\(\), leaseUntil = new Date\(now\.getTime\(\) \+ 12e4\), model = job\.mode === ["']purchase["']/g, replacement: 'await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500)); $&' };
async function chunkFiles(dir) { const out = []; for (const entry of await readdir(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) out.push(...await chunkFiles(full)); else if (entry.name.endsWith('.mjs')) out.push(full); } return out; }
async function applyMutant(outputDir, mutant) {
  const anchors = Array.isArray(mutant.anchor) ? mutant.anchor : [mutant.anchor], replacements = Array.isArray(mutant.replacement) ? mutant.replacement : [mutant.replacement];
  const files = await chunkFiles(path.join(outputDir, 'server', 'chunks')), touched = [];
  for (let i = 0; i < anchors.length; i++) {
    let hits = 0, target = null;
    for (const file of files) { const text = await readFile(file, 'utf8'); const n = (text.match(anchors[i]) || []).length; if (n) { hits += n; target = { file, text }; } }
    if (hits !== 1) throw new Error(`mutant ${mutant.name}: anchor ${i + 1} matched ${hits} times (expected exactly 1)`);
    await writeFile(target.file, target.text.replace(anchors[i], replacements[i]));
    touched.push(path.relative(outputDir, target.file));
  }
  return touched;
}

export default {
  name: 'omf-navi-api-actions',
  covers: TIMING_DIAGNOSTIC ? [] : BUILT ? [...PURE_COVERS, ...APP_COVERS] : PURE_COVERS,
  async run() {
    const started = Date.now();
    const lines = [], setupFailures = [];
    let pass = true;
    const leg = async (name, fn) => { try { const note = await fn(); lines.push(`${name}: ok${note ? ' (' + note + ')' : ''}`); } catch (error) { pass = false; const text = String(error?.message || error).replace(/\s+/g, ' ').slice(0, 500); if (/^SETUP:|^NOT RUN:|Cannot find module|ERR_MODULE_NOT_FOUND/.test(text)) setupFailures.push(name); lines.push(`${name}: RED — ${text}`); } };
    const assert = (await import('node:assert/strict')).default;
    const env = { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '' };

    // Separately labeled controlled timing diagnostic (header): never a normal run, never coverage, always reported as a failure.
    if (TIMING_DIAGNOSTIC) {
      const base = path.join(REPO_ROOT, '.zoomer-renewal-timing');
      let outcome = { diagnostic: 'controlled timing diagnostic; never a normal run, never coverage', inducedDelayMs: TIMING_DELAY.delayMs };
      try {
        if (!BUILT) throw new Error('NOT RUN: .output/server/index.mjs is missing');
        await rm(base, { recursive: true, force: true }); await mkdir(base, { recursive: true });
        for (const part of ['scripts', 'shared', 'collector/package.json']) await cp(path.join(REPO_ROOT, part), path.join(base, part), { recursive: true });
        await cp(path.join(REPO_ROOT, '.output'), path.join(base, '.output'), { recursive: true, dereference: true });
        const touched = await applyMutant(path.join(base, '.output'), TIMING_DELAY);
        const r = await run([path.join(base, 'scripts/finance-integration.cjs')], { ...env, OMF_TEST_ASSISTANT_ONLY: '1' }, 900000, base);
        const output = r.stdout + '\n' + r.stderr, done = r.stdout.match(/(\d+) targeted assistant checks passed/);
        outcome = { ...outcome, touched, exit: r.killed ? 'timeout' : r.code, ms: r.ms, passes: r.passes.length, reproduced: r.code !== 0 && /navi:purchase-renewal-accepted\s+409 !== 200/.test(output), tolerated: r.code === 0 && !!done && Number(done[1]) === r.passes.length, failure: r.code === 0 ? null : integrationTail(r).slice(0, 1200) };
      } catch (error) { outcome.setupError = String(error?.message || error).replace(/\s+/g, ' ').slice(0, 500); }
      finally { await rm(base, { recursive: true, force: true }).catch(() => {}); }
      return { pass: false, message: JSON.stringify({ ...outcome, limits: 'Induced 1500 ms wait inside the native job heartbeat of a disposable packaged copy only (the worktree build is untouched); owned synthetic app and MongoDB, no model, provider, network or production. Shows whether the positive renewal case depends on a short scheduling window; it is not evidence of the cause of the original unexplained navi:purchase-renewal-accepted failure and grants no coverage.' }) };
    }

    // 1 proposal reference helpers: canonical hash, immutable identity, strict shape, no inferred latest report.
    await leg('1 proposal reference helpers', async () => {
      const mod = await import(u('shared/finance-action-proposal.mjs'));
      const { proposalReference, proposalHash, validateProposalReference, sameProposalReference, canonicalJson } = mod;
      assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }), 'key order does not change the canonical form');
      const content = { summary: 's', findings: [{ field: 'invoiceNumber', value: 'T1234567890123' }], supplier: null };
      const base = { kind: 'research', id: 'a'.repeat(24), requestId: '11111111-2222-3333-4444-555555555555', revision: 3, content, importId: 'b'.repeat(24), line: 2, key: 'k', sourceHash: 'ab12', draftRevision: 1 };
      const ref = proposalReference(base);
      assert.deepEqual(Object.keys(ref).sort(), ['draftRevision', 'hash', 'id', 'importId', 'key', 'kind', 'line', 'requestId', 'revision', 'sourceHash']);
      assert.equal(ref.hash, proposalHash(content)); assert.equal(ref.hash.length, 64);
      assert.notEqual(proposalReference({ ...base, content: { ...content, summary: 'changed' } }).hash, ref.hash, 'content change changes the hash');
      const chat = proposalReference({ kind: 'chat', id: 'c'.repeat(24), turnId: 'd'.repeat(32), revision: 2, content: { summary: 'x', patch: { purpose: 'company' } }, importId: 'b'.repeat(24), line: 2, key: 'k', sourceHash: 'ab12', draftRevision: 0 });
      assert.equal(chat.kind, 'chat'); assert.equal(chat.turnId, 'd'.repeat(32)); assert.equal(chat.requestId, undefined);
      assert.deepEqual(validateProposalReference({ ...ref }), ref, 'a valid reference round-trips');
      assert.deepEqual(validateProposalReference({ ...ref, snapshot: { any: 1 }, extra: true }), ref, 'unknown keys are dropped');
      for (const bad of [null, 'x', { ...ref, kind: 'latest' }, { ...ref, id: 'short' }, { ...ref, hash: 'nothex' }, { ...ref, revision: -1 }, { ...ref, line: 1.5 }, { ...ref, draftRevision: 'a' }, { ...chat, turnId: 'bad turn' }, { ...ref, requestId: undefined }]) assert.throws(() => validateProposalReference(bad), undefined, 'rejects ' + JSON.stringify(bad)?.slice(0, 60));
      assert.equal(sameProposalReference(ref, { ...ref }), true); assert.equal(sameProposalReference(ref, { ...ref, revision: 4 }), false); assert.equal(sameProposalReference(ref, { ...ref, hash: ref.hash.replace(/^./, '0') }), false);
      assert.equal(mod.latestProposal, undefined, 'no helper infers a latest report');
      const { researchSummary } = await import(u('shared/finance-research.mjs'));
      const row = { _id: 'e'.repeat(24), state: 'ready', instruction: 'i', requestId: base.requestId, revision: 5, importId: 'b'.repeat(24), line: 2, context: { key: 'k', sourceHash: 'ab12', revision: 1 }, report: { summary: 's', question: '', findings: [{ field: 'invoiceNumber', value: 'T1234567890123', basis: 'literal', reason: 'r', citations: [] }], supplier: null } };
      const rowRef = mod.researchProposalReference(row);
      assert.ok(rowRef && rowRef.kind === 'research' && rowRef.id === 'e'.repeat(24) && rowRef.requestId === base.requestId && rowRef.revision === 5 && rowRef.draftRevision === 1 && rowRef.hash === proposalHash(mod.researchReportContent(row.report)), 'the research row reference binds id, request, revision, content and draft');
      assert.equal(mod.researchProposalReference({ ...row, report: null }), null, 'no report, no reference');
      assert.deepEqual(researchSummary(row, {}, false, rowRef).reference, rowRef, 'researchSummary carries the server-computed reference');
      assert.equal(researchSummary(row, {}, true, rowRef).reference, null, 'a stale row carries no reference');
      assert.equal(researchSummary(row, {}, false).reference, null, 'no reference passed, none invented');
      assert.ok(!Object.keys(await import(u('shared/finance-research.mjs'))).includes('researchProposalReference'), 'the browser-shared module computes no hash');
      const chatRef = mod.chatProposalReference({ _id: 'c'.repeat(24), revision: 4, importId: 'b'.repeat(24), line: 2, context: { key: 'k', sourceHash: 'ab12', revision: 0 } }, { id: 'd'.repeat(32), proposal: { kind: 'proposal', summary: 'x', patch: { purpose: 'company' }, quotes: { purpose: 'q' } } }, 0);
      assert.ok(chatRef && chatRef.kind === 'chat' && chatRef.turnId === 'd'.repeat(32) && chatRef.hash === proposalHash({ summary: 'x', patch: { purpose: 'company' } }), 'the chat turn reference hashes summary and patch only');
      assert.equal(mod.chatProposalReference({}, { id: 'd'.repeat(32), proposal: { kind: 'unclear', summary: 'x', patch: {}, quotes: {} } }, 0), null, 'an explanation is not a proposal');
      return 'hash canonical, shape strict, summary carries reference';
    });

    // 2 the owned actions MCP server: tools/list from the job file, tools/call → one lease-bound POST per slot, a timed-out
    // first attempt retried with the SAME slot, a 409 surfaced as an error, the token read from the private Vault only.
    await leg('2 owned actions MCP server', async () => {
      const mcpFile = path.join(REPO_ROOT, 'teaching-worker/actions-mcp.mjs');
      if (!existsSync(mcpFile)) throw new Error('SETUP: teaching-worker/actions-mcp.mjs is missing');
      const { Vault } = await import(u('collector/vault.mjs'));
      const dir = await mkdtemp(path.join(os.tmpdir(), 'omf-navi-mcp-')), token = 'omft_' + randomBytes(32).toString('hex'), lease = randomUUID();
      const requests = []; let slow = true;
      const server = http.createServer(async (req, res) => {
        const text = await body(req); const parsed = JSON.parse(text || '{}');
        requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: parsed });
        if (parsed.name === 'get_draft' && slow) { slow = false; await new Promise(r => setTimeout(r, 900)); res.statusCode = 200; res.end(JSON.stringify({ late: true })); return; }
        if (parsed.name === 'save_draft_fields') { res.statusCode = 409; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ statusCode: 409, message: 'Conversation job changed', data: { message: '会話が更新されました。' } })); return; }
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ name: parsed.name, effect: 'read', result: { echo: parsed.args, slot: parsed.slot } }));
      });
      const port = await listen(server);
      let child;
      try {
        await new Vault(dir).update(() => ({ enabled: true, token }));
        const jobDir = path.join(dir, 'jobs', randomUUID()); await mkdir(jobDir, { recursive: true });
        const tools = [{ name: 'get_draft', description: 'd', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, effect: 'read' }, { name: 'save_draft_fields', description: 's', inputSchema: { type: 'object', properties: { fields: { type: 'object' } }, additionalProperties: false }, effect: 'write' }];
        await writeFile(path.join(jobDir, 'job.json'), JSON.stringify({ endpoint: `http://127.0.0.1:${port}/api/finance-chat/worker/${'f'.repeat(24)}/actions`, lease, tools, nextSlot: 7, timeoutMs: 400 }));
        child = spawn(process.execPath, [mcpFile], { env: { ...env, OMF_ACTIONS_DIR: dir, OMF_ACTIONS_JOB_FILE: path.join(jobDir, 'job.json') }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        let stderr = ''; child.stderr.on('data', c => stderr += c);
        const rpc = rpcClient(child);
        const init = await rpc.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fixture', version: '0' } });
        assert.ok(init.result?.capabilities?.tools, 'initialize advertises tools: ' + JSON.stringify(init).slice(0, 200) + ' ' + stderr.slice(0, 200));
        const list = await rpc.call('tools/list');
        assert.deepEqual(list.result.tools.map(t => t.name), ['get_draft', 'save_draft_fields'], 'tools/list is exactly the job catalogue');
        assert.ok(list.result.tools.every(t => Object.keys(t).sort().join(',') === 'description,inputSchema,name'), 'each MCP tool carries exactly name, description and inputSchema');
        assert.ok(!JSON.stringify(list.result.tools).match(/Bash|Read|Write|Edit|WebFetch|shell|filesystem/i), 'no shell/filesystem tool in the catalogue');
        const first = await rpc.call('tools/call', { name: 'get_draft', arguments: {} });
        const posts = requests.filter(r => r.body.name === 'get_draft');
        assert.equal(posts.length, 2, 'the timed-out first attempt is retried once');
        assert.ok(posts.every(p => p.body.slot === 7 && p.body.lease === lease), 'the retry keeps the SAME slot and lease');
        assert.ok(posts.every(p => p.authorization === 'Bearer ' + token && p.method === 'POST' && p.url.endsWith('/actions')), 'Bearer token from the Vault on every POST');
        assert.equal(first.result.isError, undefined); assert.deepEqual(JSON.parse(first.result.content[0].text).result.slot, 7);
        const second = await rpc.call('tools/call', { name: 'get_draft', arguments: {} });
        assert.equal(requests.filter(r => r.body.name === 'get_draft').at(-1).body.slot, 8, 'the next call takes the next slot');
        assert.equal(second.result.isError, undefined);
        const refused = await rpc.call('tools/call', { name: 'save_draft_fields', arguments: { fields: { taxRate: 10 } } });
        assert.equal(refused.result.isError, true); assert.match(refused.result.content[0].text, /409/); assert.match(refused.result.content[0].text, /会話が更新されました/);
        assert.equal(requests.filter(r => r.body.name === 'save_draft_fields').length, 1, 'a 4xx answer is final, not retried');
        assert.deepEqual(requests.at(-1).body, { lease, slot: 9, name: 'save_draft_fields', args: { fields: { taxRate: 10 } } });
        const unknown = await rpc.call('tools/call', { name: 'not_a_tool', arguments: {} });
        assert.equal(unknown.result.isError, true); assert.equal(requests.filter(r => r.body.name === 'not_a_tool').length, 0, 'an unknown tool never reaches the service');
        const method = await rpc.call('resources/list'); assert.equal(method.error?.code, -32601);
        assert.equal((await rpc.call('ping')).error, undefined);
        assert.ok(!rpc.events.join('\n').includes(token) && !stderr.includes(token), 'the token never appears on stdout/stderr');
        assert.equal(requests.some(r => r.body.token || r.url.includes(token)), false, 'the token is sent only as the Authorization header');
        return `tools/list ${list.result.tools.length}, ${requests.length} POSTs, retry kept slot 7`;
      } finally { if (child) { child.stdin.end(); await new Promise(r => { child.once('close', r); setTimeout(() => { child.kill(); r(); }, 3000); }); } server.close(); await safeTemp(dir); }
    });

    // 3 built app: the navi integration chained in the assistant scope harness, on its own ephemeral MongoDB.
    let integration = null;
    await leg('3 built app navi legs', async () => {
      if (!BUILT) throw new Error('NOT RUN: .output/server/index.mjs is missing (run nuxt build in this worktree first); no HTTP coverage claimed');
      if (!existsSync(path.join(REPO_ROOT, 'scripts/finance-navi-actions-integration.cjs'))) throw new Error('NOT RUN: scripts/finance-navi-actions-integration.cjs is missing');
      if (!/finance-navi-actions-integration/.test(readFileSync(path.join(REPO_ROOT, 'scripts/finance-assistant-scope-integration.cjs'), 'utf8'))) throw new Error('NOT RUN: the navi integration is not chained in scripts/finance-assistant-scope-integration.cjs');
      integration = await run(['scripts/finance-integration.cjs'], { ...env, OMF_TEST_ASSISTANT_ONLY: '1' }, 900000);
      await writeFile(path.join(REPO_ROOT, '.zoomer-navi-integration.txt'), integration.stdout + (integration.stderr ? '\n--- stderr ---\n' + integration.stderr : '')).catch(() => {});
      const done = integration.stdout.match(/(\d+) targeted assistant checks passed/), navi = integration.passes.filter(p => /^N[1-6]b? /.test(p));
      if (integration.code !== 0 || !done || Number(done[1]) !== integration.passes.length || navi.length < 7) throw new Error(`exit ${integration.killed ? 'timeout' : integration.code}, ${integration.passes.length} green (${navi.length} navi): ${integrationTail(integration).slice(0, 900)}`);
      return `${integration.passes.length} legs green in ${Math.round(integration.ms / 1000)}s: ${navi.map(p => p.split(' ')[0]).join(' ')}`;
    });

    // 4 unit tests the plan names
    await leg('4 unit tests', async () => {
      const tests = ['scripts/finance-chat.test.mjs', 'scripts/finance-assistant.test.mjs', 'scripts/finance-assistant-worker.test.mjs', 'scripts/finance-research.test.mjs'];
      const r = await run(['--test', ...tests], env, 180000);
      const summary = r.stdout.match(/[#ℹ] pass (\d+)[\s\S]*?[#ℹ] fail (\d+)/);
      if (r.code !== 0 || !summary || summary[2] !== '0') throw new Error(`node --test exit ${r.code}: ${(r.stdout + r.stderr).split('\n').filter(l => /not ok|Error|failed/i.test(l)).slice(0, 6).join(' | ').slice(0, 500)}`);
      return `${summary[1]} tests, 0 failed`;
    });

    // 5 mutants: an unmutated packaged copy must pass first (positive control); then each defect reintroduced into an isolated copy
    // of the built output must make its named assertion fail.
    const mutantNotes = [];
    await leg('5 mutants flip their assertions', async () => {
      if (!integration || integration.code !== 0) throw new Error('NOT RUN: leg 3 is not green, mutants prove nothing');
      const base = path.join(REPO_ROOT, '.zoomer-mutants');
      await rm(base, { recursive: true, force: true }); await mkdir(base, { recursive: true });
      const transcript = [];
      const packaged = async name => { const dir = path.join(base, name); for (const part of ['scripts', 'shared', 'collector/package.json']) await cp(path.join(REPO_ROOT, part), path.join(dir, part), { recursive: true }); await cp(path.join(REPO_ROOT, '.output'), path.join(dir, '.output'), { recursive: true, dereference: true }); return dir; };
      try {
        {
          const dir = await packaged('unmutated-packaged-control');
          const r = await run([path.join(dir, 'scripts/finance-integration.cjs')], { ...env, OMF_TEST_ASSISTANT_ONLY: '1' }, 600000, dir);
          const done = r.stdout.match(/(\d+) targeted assistant checks passed/), green = r.code === 0 && !!done && Number(done[1]) === r.passes.length && r.passes.length === integration.passes.length;
          transcript.push(`=== unmutated-packaged-control exit ${r.code} green=${green} (${r.passes.length}/${integration.passes.length} legs)\n${integrationTail(r).slice(0, 1200)}\n`);
          mutantNotes.push(`unmutated-packaged-control:${green ? 'green' : 'RED'}`);
          if (!green) throw new Error(`the unmutated packaged control must pass before defects (exit ${r.code}, ${r.passes.length}/${integration.passes.length} legs): ${integrationTail(r).slice(0, 500)}`);
          await rm(dir, { recursive: true, force: true });
        }
        for (const mutant of MUTANTS) {
          const dir = await packaged(mutant.name);
          const touched = await applyMutant(path.join(dir, '.output'), mutant);
          const r = await run([path.join(dir, 'scripts/finance-integration.cjs')], { ...env, OMF_TEST_ASSISTANT_ONLY: '1' }, 600000, dir);
          const output = r.stdout + '\n' + r.stderr, flipped = r.code !== 0 && mutant.expect.test(output);
          transcript.push(`=== ${mutant.name} (${touched.join(', ')}) exit ${r.code} flipped=${flipped}\n${integrationTail(r).slice(0, 1200)}\n`);
          mutantNotes.push(`${mutant.name}:${flipped ? 'flipped' : 'NOT FLIPPED'}`);
          if (!flipped) throw new Error(`mutant ${mutant.name} did not flip ${mutant.expect} (exit ${r.code}): ${integrationTail(r).slice(0, 500)}`);
          await rm(dir, { recursive: true, force: true });
        }
      } finally { await writeFile(path.join(REPO_ROOT, '.zoomer-navi-mutants.txt'), transcript.join('\n')).catch(() => {}); await rm(base, { recursive: true, force: true }); }
      return mutantNotes.join(' ');
    });

    // 6 native CLI tool-only smoke (uses the model; explicit separate evidence, never default coverage).
    let cliNote = 'NOT RUN: set OMF_NAVI_CLI_SMOKE=1 for the native CLI tool smoke (model evidence declared separately)';
    if (process.env.OMF_NAVI_CLI_SMOKE === '1') await leg('6 native CLI tool smoke', async () => {
      const { Vault } = await import(u('collector/vault.mjs')), { accountantModel, accountantEffort } = await import(u('shared/finance-accountant-role.mjs'));
      const cli = process.env.OMF_NAVI_CLI_PATH || 'claude', dir = await mkdtemp(path.join(os.tmpdir(), 'omf-navi-cli-')), token = 'omft_' + randomBytes(32).toString('hex'), lease = randomUUID();
      const draft = { revision: 0, values: { taxRate: null, purpose: 'company' } }, requests = [];
      const server = http.createServer(async (req, res) => { const parsed = JSON.parse(await body(req) || '{}'); requests.push(parsed); res.setHeader('Content-Type', 'application/json'); if (req.headers.authorization !== 'Bearer ' + token || parsed.lease !== lease) { res.statusCode = 401; res.end(JSON.stringify({ message: 'unauthorized' })); return; } if (parsed.name === 'get_draft') { res.end(JSON.stringify({ name: 'get_draft', effect: 'read', result: draft })); return; } if (parsed.name === 'save_draft_fields') { Object.assign(draft.values, parsed.args.fields); draft.revision++; res.end(JSON.stringify({ name: 'save_draft_fields', effect: 'write', receipt: { operationId: 'op' + parsed.slot, state: 'done', acceptedRevision: draft.revision, requestedFields: Object.keys(parsed.args.fields) } })); return; } res.statusCode = 400; res.end(JSON.stringify({ message: 'unknown' })); });
      const port = await listen(server);
      try {
        await new Vault(dir).update(() => ({ enabled: true, token }));
        const jobDir = path.join(dir, 'jobs', randomUUID()); await mkdir(jobDir, { recursive: true });
        const tools = [{ name: 'get_draft', description: 'Read the current synthetic draft (values, revision).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }, { name: 'save_draft_fields', description: 'Save the given fields on the synthetic draft. Arguments: fields (object of field -> value).', inputSchema: { type: 'object', required: ['fields'], properties: { fields: { type: 'object' } }, additionalProperties: false } }];
        await writeFile(path.join(jobDir, 'job.json'), JSON.stringify({ endpoint: `http://127.0.0.1:${port}/api/finance-chat/worker/${'f'.repeat(24)}/actions`, lease, tools, nextSlot: 1, timeoutMs: 20000 }));
        const mcp = { mcpServers: { omf_actions: { command: process.execPath, args: [path.join(REPO_ROOT, 'teaching-worker/actions-mcp.mjs')], env: { OMF_ACTIONS_DIR: dir, OMF_ACTIONS_JOB_FILE: path.join(jobDir, 'job.json') } } } };
        const schema = { type: 'object', additionalProperties: false, required: ['summary'], properties: { summary: { type: 'string', maxLength: 400 } } };
        const args = ['-p', '--model', accountantModel, '--effort', accountantEffort, '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--tools', '', '--allowedTools', 'mcp__omf_actions__*', '--mcp-config', JSON.stringify(mcp), '--strict-mcp-config', '--setting-sources', '', '--settings', '{"disableAllHooks":true}', '--no-session-persistence', '--max-turns', '8', '--system-prompt', 'You operate a synthetic test draft through the omf_actions tools only. Use get_draft, then save_draft_fields to set taxRate to 10, then answer with a one-sentence summary. Never claim a save you did not perform.'];
        const startedAt = Date.now();
        const result = await new Promise(resolve => { const childEnv = { ...env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }; const child = spawn(cli, args, { env: childEnv, windowsHide: true, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] }); let out = '', err = ''; child.stdout.on('data', c => out += c); child.stderr.on('data', c => err += c); const t = setTimeout(() => child.kill(), 240000); child.once('close', code => { clearTimeout(t); resolve({ code, out, err }); }); child.stdin.end('Please set the consumption tax rate of this draft to 10 percent.'); });
        const version = await new Promise(resolve => execFile(cli, ['--version'], { shell: process.platform === 'win32', windowsHide: true }, (e, so) => resolve(String(so || e?.message || '').trim())));
        const saved = requests.some(r => r.name === 'save_draft_fields' && r.args?.fields?.taxRate === 10), listed = existsSync(path.join(jobDir, 'events.log')) && /tools\/list/.test(await readFile(path.join(jobDir, 'events.log'), 'utf8'));
        await writeFile(path.join(REPO_ROOT, '.zoomer-navi-cli-smoke.txt'), JSON.stringify({ cli: version, args: args.map(a => a.length > 200 ? a.slice(0, 200) + '…' : a), ms: Date.now() - startedAt, exit: result.code, requests, draft, listed, stdout: result.out.slice(0, 4000), stderr: result.err.slice(0, 2000) }, null, 2));
        assert.equal(result.code, 0, 'CLI exit ' + result.code + ': ' + result.err.slice(0, 300));
        let parsed; try { parsed = JSON.parse(result.out); } catch { throw new Error('CLI output is not JSON'); }
        assert.ok(listed, 'tools/list observed by the owned MCP server');
        assert.ok(requests.some(r => r.name === 'get_draft'), 'at least one real tool call reached the synthetic service');
        assert.ok(saved && draft.values.taxRate === 10 && draft.revision >= 1, 'the synthetic result was persisted through save_draft_fields');
        assert.ok(parsed.structured_output?.summary || parsed.result, 'a final receipt-aware reply came back');
        cliNote = `${version}; ${requests.length} tool calls; ${Math.round((Date.now() - startedAt) / 1000)}s`;
        return cliNote;
      } finally { server.close(); await safeTemp(dir); }
    });

    const databaseCoverage = integration && integration.code === 0 ? { executed: true, ownedProcess: true } : { executed: false, ownedProcess: false };
    const verdict = pass ? 'navi actions green' : setupFailures.length && setupFailures.length === lines.filter(l => / RED /.test(l)).length ? 'FAILED (setup only — not behavioural evidence)' : 'FAILED';
    return { pass, databaseCoverage, message: `${verdict} in ${Math.round((Date.now() - started) / 1000)}s — ${lines.join(' · ')} · 6 native CLI tool smoke: ${cliNote}` };
  }
};
