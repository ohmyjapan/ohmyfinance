// Fixture for plan omf-assistant-actions-20261015 (5-plan.json): a purchase reply that would tell the owner to look up
// company identity / invoice number / 勘定科目・区分・税区分・消費税率 starts OMF's own purchase research instead.
// Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture assistant-dialogue-research.mjs --cwd <this worktree>
// Legs (plan §4): 1 validator research legs · 2 interpreter input/schema · 3 researchSummary bounded shape ·
// 4 built app (scripts/finance-dialogue-integration.cjs through OMF_TEST_DIALOGUE_ONLY=1 on its own ephemeral MongoDB, synthetic
// merchant/date/amount; NOT RUN and red when .output/server/index.mjs is missing or the hook is not wired) · 5 node --test of the
// chat/assistant/worker/research unit tests. No model, no network, no production database. `covers` is decided at load: the
// built-app files are listed only when the build exists. Fail-first on 8192d2e: legs 1-4 red (no research on the validator
// result, no chatSchema/researchSummary export, dialogue hook not wired), leg 5 green.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 900000;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const BUILT = existsSync(path.join(REPO_ROOT, '.output', 'server', 'index.mjs'));
const PURE_COVERS = ['teaching-worker/interpreter.mjs', 'shared/finance-chat.mjs', 'shared/finance-chat.d.mts', 'shared/finance-research.mjs', 'shared/finance-research.d.mts', 'scripts/finance-chat.test.mjs'];
const APP_COVERS = ['server/services/financeChatService.ts', 'server/services/financeResearchService.ts', 'scripts/finance-integration.cjs', 'scripts/finance-dialogue-integration.cjs'];
const u = p => pathToFileURL(path.join(REPO_ROOT, p)).href;

function run(args, env, timeout) {
  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, args, { cwd: REPO_ROOT, windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, env }, (error, stdout, stderr) => {
      const text = String(stdout || '');
      resolve({ ms: Date.now() - started, code: error ? (error.code ?? 1) : 0, killed: !!error?.killed, stdout: text, stderr: String(stderr || ''), passes: text.split(/\r?\n/).filter(l => l.startsWith('PASS ')).map(l => l.slice(5)) });
    });
  });
}

export default {
  name: 'assistant-dialogue-research',
  covers: BUILT ? [...PURE_COVERS, ...APP_COVERS] : PURE_COVERS,
  async run() {
    const started = Date.now();
    const lines = [];
    let pass = true;
    const leg = async (name, fn) => { try { const note = await fn(); lines.push(`${name}: ok${note ? ' (' + note + ')' : ''}`); } catch (error) { pass = false; lines.push(`${name}: RED — ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 400)}`); } };
    const assert = (await import('node:assert/strict')).default;
    const env = { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '' };

    // 1 validator: research accepted on proposal|unclear, rejected on defer/shape/length/control chars, dropped in workspace mode
    await leg('1 validator research legs', async () => {
      const { validateChatProposal } = await import(u('shared/finance-chat.mjs'));
      const context = { values: { purpose: 'unresolved', customerId: '' }, customers: [{ id: 'c1', name: 'Synthetic customer' }] }, text = '법인 차량의 충전 요금입니다';
      const instruction = ' 법인 차량 충전 요금: 勘定科目と運営会社を調査 ';
      const p = validateChatProposal({ kind: 'proposal', summary: '会社の費用として整理します。', patch: { purpose: 'company', productName: '충전 요금' }, quotes: { purpose: '법인 차량', productName: '충전 요금' }, research: { instruction } }, context, text);
      assert.deepEqual(p.research, { instruction: instruction.trim() }, 'proposal carries the trimmed research instruction');
      assert.equal(p.patch.customerId, '');
      const q = validateChatProposal({ kind: 'unclear', summary: '調べます。', patch: {}, quotes: {}, research: { instruction: '運営会社の確認' } }, context, text);
      assert.deepEqual(q.research, { instruction: '運営会社の確認' }, 'unclear carries research');
      const n = validateChatProposal({ kind: 'unclear', summary: '説明です。', patch: {}, quotes: {} }, context, text);
      assert.equal(n.research, undefined, 'no request → no research');
      const bad = [
        ['defer', { kind: 'defer', summary: '後で', patch: {}, quotes: {}, research: { instruction: 'x' } }],
        ['non-object', { kind: 'unclear', summary: 's', patch: {}, quotes: {}, research: 'x' }],
        ['null', { kind: 'unclear', summary: 's', patch: {}, quotes: {}, research: null }],
        ['array', { kind: 'unclear', summary: 's', patch: {}, quotes: {}, research: ['x'] }],
        ['missing instruction', { kind: 'unclear', summary: 's', patch: {}, quotes: {}, research: {} }],
        ['empty', { kind: 'unclear', summary: 's', patch: {}, quotes: {}, research: { instruction: '  ' } }],
        ['2001 chars', { kind: 'unclear', summary: 's', patch: {}, quotes: {}, research: { instruction: 'x'.repeat(2001) } }],
        ['control char', { kind: 'unclear', summary: 's', patch: {}, quotes: {}, research: { instruction: 'a\x07b' } }],
        ['extra key', { kind: 'unclear', summary: 's', patch: {}, quotes: {}, research: { instruction: 'x', tools: ['mail'] } }],
        ['non-string', { kind: 'unclear', summary: 's', patch: {}, quotes: {}, research: { instruction: 5 } }]
      ];
      for (const [label, input] of bad) assert.throws(() => validateChatProposal(input, context, text), undefined, label + ' must be rejected');
      const ok2000 = validateChatProposal({ kind: 'unclear', summary: 's', patch: {}, quotes: {}, research: { instruction: 'x'.repeat(2000) } }, context, text);
      assert.equal(ok2000.research.instruction.length, 2000);
      const w = validateChatProposal({ kind: 'unclear', summary: '画面の説明', patch: {}, quotes: {}, research: { instruction: 'x' } }, { mode: 'workspace' }, text);
      assert.equal(w.research, undefined, 'workspace mode drops research');
      assert.deepEqual(Object.keys(w).sort(), ['kind', 'patch', 'quotes', 'summary']);
      return '12 shapes';
    });

    // 2 interpreterInput carries research; chatSchema.properties.research present
    await leg('2 interpreter input and schema', async () => {
      const mod = await import(u('teaching-worker/interpreter.mjs'));
      assert.ok(mod.chatSchema, 'chatSchema is exported');
      const research = mod.chatSchema.properties.research;
      assert.ok(research, 'schema has research');
      assert.equal(research.type, 'object'); assert.equal(research.additionalProperties, false); assert.deepEqual(research.required, ['instruction']);
      assert.equal(research.properties.instruction.type, 'string'); assert.equal(research.properties.instruction.maxLength, 2000);
      assert.ok(!mod.chatSchema.required.includes('research'), 'research stays optional');
      assert.deepEqual(mod.chatSchema.required, ['kind', 'summary', 'patch', 'quotes']);
      const context = { source: { description: 'Synthetic EV charging station', purchaseDate: '2026-08-05', amount: 1980, account: { name: 'Synthetic Amex' } }, values: { purpose: 'unresolved', customerId: '', productName: '' }, mapping: null, study: {}, customers: [], messages: [] };
      const withResearch = mod.interpreterInput({ context: { ...context, research: { state: 'ready', summary: 's', question: '', findings: [], supplier: null, stale: false } }, text: 't' });
      assert.equal(withResearch.research.state, 'ready'); assert.equal(withResearch.currentMessage, 't');
      assert.equal(mod.interpreterInput({ context, text: 't' }).research, null, 'no research row → null');
      const workspace = mod.interpreterInput({ context: { mode: 'workspace', pageName: 'p', facts: {}, capabilities: [], messages: [] }, text: 't' });
      assert.equal(Object.hasOwn(workspace, 'research'), false, 'workspace input unchanged');
      assert.ok(/research/.test(String(mod.chatSchema && readFileSync(path.join(REPO_ROOT, 'teaching-worker/interpreter.mjs'), 'utf8'))), 'prompt names research');
      return 'optional object, instruction ≤2000';
    });

    // 3 researchSummary bounded shape; null row → null
    await leg('3 researchSummary bounded shape', async () => {
      const { researchSummary } = await import(u('shared/finance-research.mjs'));
      assert.equal(typeof researchSummary, 'function', 'researchSummary is exported');
      assert.equal(researchSummary(null, {}), null);
      const long = 'q'.repeat(400), references = { customers: [{ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Synthetic customer' }] };
      const row = {
        state: 'ready', instruction: 'i', requestId: 'r', updatedAt: new Date('2026-08-10T00:00:00Z'), applied: null,
        sources: [{ id: 's1', kind: 'web', title: 't', url: 'https://example.invalid/secret-page', text: 'SOURCE BODY MUST NOT LEAK', hash: 'h', capturedAt: '2026-08-10T00:00:00Z' }],
        report: { summary: 's', question: 'q?', findings: [
          { field: 'customerId', value: 'aaaaaaaaaaaaaaaaaaaaaaaa', valueJson: '"aaaaaaaaaaaaaaaaaaaaaaaa"', basis: 'reasoned', reason: 'r', citations: [1, 2, 3, 4, 5].map(i => ({ sourceId: 's1', quote: long + i })) },
          { field: 'invoiceNumber', value: 'T1234567890123', valueJson: '"T1234567890123"', basis: 'literal', reason: 'r', citations: [{ sourceId: 's1', quote: 'T1234567890123' }] }
        ], supplier: { shopName: 'shop', legalName: 'legal', invoiceNumber: 'T1234567890123', citations: [{ sourceId: 's1', quote: 'legal' }] } }
      };
      const s = researchSummary(row, references);
      assert.equal(s.state, 'ready'); assert.equal(s.summary, 's'); assert.equal(s.question, 'q?'); assert.equal(s.instruction, 'i'); assert.equal(s.stale, false);
      assert.equal(s.findings.length, 2); assert.equal(s.findings[0].quotes.length, 3, 'at most 3 quotes'); assert.ok(s.findings[0].quotes.every(q => q.length <= 300), 'quotes cut at 300');
      assert.equal(s.findings[0].displayValue, 'Synthetic customer', 'reference resolved to its name'); assert.equal(s.findings[0].label, '顧客'); assert.equal(s.findings[1].displayValue, 'T1234567890123');
      assert.deepEqual(s.supplier, { shopName: 'shop', legalName: 'legal', invoiceNumber: 'T1234567890123' });
      const text = JSON.stringify(s); assert.ok(!text.includes('SOURCE BODY'), 'no source text'); assert.ok(!text.includes('https://'), 'no URLs'); assert.equal(s.sources, undefined);
      const stale = researchSummary(row, references, true);
      assert.equal(stale.stale, true); assert.deepEqual(stale.findings, []); assert.equal(stale.supplier, null); assert.equal(stale.summary, 's'); assert.ok(stale.meaning && /stale|earlier|not current/i.test(stale.meaning));
      assert.equal(researchSummary({ state: 'queued', instruction: 'i', report: null }, references).findings.length, 0);
      return 'findings/quotes bounded, references named, stale marks';
    });

    // 4 built app: the dialogue integration on its own ephemeral MongoDB
    let integration = null;
    await leg('4 built app dialogue legs', async () => {
      if (!BUILT) throw new Error('NOT RUN: .output/server/index.mjs is missing (run nuxt build in this worktree first); no HTTP coverage claimed');
      if (!existsSync(path.join(REPO_ROOT, 'scripts/finance-dialogue-integration.cjs'))) throw new Error('NOT RUN: scripts/finance-dialogue-integration.cjs is missing');
      if (!/OMF_TEST_DIALOGUE_ONLY/.test(readFileSync(path.join(REPO_ROOT, 'scripts/finance-integration.cjs'), 'utf8'))) throw new Error('NOT RUN: OMF_TEST_DIALOGUE_ONLY hook is not wired in scripts/finance-integration.cjs');
      integration = await run(['scripts/finance-integration.cjs'], { ...env, OMF_TEST_DIALOGUE_ONLY: '1' }, 600000);
      // The transcript (PASS lines with the measured reply latencies, or the failing assertion) is kept beside the other receipts.
      await writeFile(path.join(REPO_ROOT, '.zoomer-dialogue-integration.txt'), integration.stdout + (integration.stderr ? '\n--- stderr ---\n' + integration.stderr : '')).catch(() => {});
      const done = integration.stdout.match(/(\d+) targeted dialogue checks passed/);
      if (integration.code !== 0 || !done || Number(done[1]) !== integration.passes.length || integration.passes.length < 7) {
        const tail = (integration.stderr.split('\n').filter(l => /Error|assert|expected|actual|at /i.test(l)).slice(0, 8).join(' | ') || integration.stdout.slice(-800)).replace(/\s+/g, ' ');
        throw new Error(`exit ${integration.killed ? 'timeout' : integration.code}, ${integration.passes.length} green: ${tail.slice(0, 700)}`);
      }
      return `${integration.passes.length} legs green in ${Math.round(integration.ms / 1000)}s: ${integration.passes.map(p => p.split(' ')[0]).join(' ')}`;
    });

    // 5 unit tests the plan names
    await leg('5 unit tests', async () => {
      const tests = ['scripts/finance-chat.test.mjs', 'scripts/finance-assistant.test.mjs', 'scripts/finance-assistant-worker.test.mjs', 'scripts/finance-research.test.mjs'];
      const r = await run(['--test', ...tests], env, 180000);
      const summary = r.stdout.match(/[#ℹ] pass (\d+)[\s\S]*?[#ℹ] fail (\d+)/);
      if (r.code !== 0 || !summary || summary[2] !== '0') throw new Error(`node --test exit ${r.code}: ${(r.stdout + r.stderr).split('\n').filter(l => /not ok|Error|failed/i.test(l)).slice(0, 6).join(' | ').slice(0, 500)}`);
      return `${summary[1]} tests, 0 failed`;
    });

    const databaseCoverage = integration && integration.code === 0 ? { executed: true, ownedProcess: true } : { executed: false, ownedProcess: false };
    return { pass, databaseCoverage, message: `${pass ? 'chat → research continuation green' : 'FAILED'} in ${Math.round((Date.now() - started) / 1000)}s — ${lines.join(' · ')}` };
  }
};
