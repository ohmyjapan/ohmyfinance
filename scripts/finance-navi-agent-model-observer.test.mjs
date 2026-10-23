// Default contracts of the Navi product-model corpus (scripts/zoomer-fixtures/omf-navi-agent-model.mjs, no mode set).
// Real disposable local node children (an owned fake CLI script in an owned temp directory), a loopback fake upstream, the actual
// product interpreter's spawn seam with node as a stand-in executable (it exits on its first unknown option), pure manifest/grade/
// evidence/format checks and seven deliberately seeded defects in owned copies. No model, provider, application or database is
// reached and no EXTERNAL network (owned local children and loopback HTTP only); these contracts give transport/manifest/evidence/
// grade evidence only, never product-model, privacy or reliability coverage.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import cp, { spawn as esmSpawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as cases from './finance-navi-agent-model-cases.mjs';
import { installSpawnObserver, openHttpObserver, streamArguments, NativeStreamObserver, AUTH_KEY, redact } from './finance-navi-agent-model-observer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha = v => createHash('sha256').update(v).digest('hex');
// The fake native final result: deliberately non-canonical spacing and multibyte text, so any reserialization changes its bytes.
const FINAL_PAYLOAD = '{"type":"result","subtype":"success","is_error":false,  "num_turns":3,"modelUsage":{"transport-fixture-not-live":{"inputTokens":3,"outputTokens":2,"webSearchRequests":1}},"usage":{"input_tokens":3,"output_tokens":2,"server_tool_use":{"web_search_requests":1}},"structured_output":{"summary":"返信 테스트 — 確認","kind":"unclear","patch":{},"quotes":{}}}';
const FAKE_CLI = `
const scenario = process.argv[process.argv.indexOf('--scenario') + 1], format = process.argv[process.argv.indexOf('--output-format') + 1];
const expected = process.argv.includes('--expect-auth-sha') ? process.argv[process.argv.indexOf('--expect-auth-sha') + 1] : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function chunked(bytes, size) { for (let i = 0; i < bytes.length; i += size) { process.stdout.write(bytes.subarray(i, i + size)); await sleep(1); } }
let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => input += c);
process.stdin.on('end', async () => {
  const final = ${JSON.stringify(FINAL_PAYLOAD)};
  const events = [{ type: 'system', subtype: 'init', model: 'transport-fixture-not-live', tools: ['WebSearch', 'mcp__omf_actions__get_company_transaction'], mcp_servers: [{ name: 'omf_actions', status: 'connected' }], apiKeySource: 'DO_NOT_RECORD_SECRET' },
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'DO_NOT_RECORD_HIDDEN_REASONING' }, { type: 'tool_use', name: 'WebSearch', input: { query: 'テスラ 日本 インボイス 登録番号' } }, { type: 'tool_use', name: 'mcp__omf_actions__get_company_transaction', input: { transactionId: 'DO_NOT_RECORD_SECRET' } }] } }];
  if (scenario === 'env-report') { const keys = Object.keys(process.env).sort(), v = process.env['${AUTH_KEY}']; process.stdout.write(JSON.stringify({ type: 'result', is_error: false, structured_output: { keys, authPresent: v !== undefined, authMatches: expected !== null && v !== undefined && require('node:crypto').createHash('sha256').update(v).digest('hex') === expected, inputSha: require('node:crypto').createHash('sha256').update(input).digest('hex') } })); return; }
  if (scenario === 'hang') { setInterval(() => {}, 1000); return; }
  if (format === 'json') { if (scenario === 'json-ok') await chunked(Buffer.from(final), 3); else if (scenario === 'json-nonzero') { await chunked(Buffer.from(final.slice(0, 40)), 7); process.exitCode = 3; } return; }
  const lines = events.map(e => JSON.stringify(e));
  if (scenario === 'stream-ok') await chunked(Buffer.from(lines.join('\\n') + '\\r\\n' + final + '\\r\\n'), 2);
  else if (scenario === 'stream-missing') await chunked(Buffer.from(lines.join('\\n') + '\\n'), 5);
  else if (scenario === 'stream-malformed') { await chunked(Buffer.from(lines[0] + '\\nnot-json\\n'), 4); process.stdout.write(Buffer.alloc(300000, 0x78)); process.stdout.write('\\n' + final + '\\n'); }
  else if (scenario === 'stream-duplicate') await chunked(Buffer.from(final + '\\n' + final + '\\n'), 9);
  else if (scenario === 'stream-error') { process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'synthetic native failure' }) + '\\n'); process.exitCode = 1; }
});
`;

// Vault auth (manual-only option, plan omf-navi-native-auth-followup-20261024): an owned stand-in for the configured CLI path that
// records what the actual interpreter handed it (the credential only as a digest) and returns one synthetic final result. It lays the
// MCP server entry's env over its own environment for a probe child, as the worst case for an inherited credential.
const VAULT_STANDIN = String.raw`
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const [records,...args]=process.argv.slice(2),KEY='CLAUDE_CODE_OAUTH_TOKEN',token=process.env[KEY];
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);
process.stdin.on('end',()=>{
 let mcp=null;try{mcp=JSON.parse(args[args.indexOf('--mcp-config')+1])}catch{}
 const servers=Object.entries((mcp&&mcp.mcpServers)||{}).map(([name,s])=>{const env=s.env||{},probe=cp.spawnSync(process.execPath,['-e',"const v=process.env.CLAUDE_CODE_OAUTH_TOKEN;process.stdout.write(JSON.stringify({present:v!==undefined,sha:v?require('crypto').createHash('sha256').update(v).digest('hex'):''}))"],{env:{...process.env,...env},encoding:'utf8',windowsHide:true});return {name,envAuth:Object.prototype.hasOwnProperty.call(env,KEY)?(env[KEY]===''?'blank':'value'):'absent',probe:JSON.parse(probe.stdout||'null')}});
 fs.mkdirSync(records,{recursive:true});
 fs.writeFileSync(path.join(records,process.pid+'.json'),JSON.stringify({authSha:token===undefined?null:sha(token),envNames:Object.keys(process.env).filter(k=>k!==KEY).sort(),argsHaveToken:!!token&&args.some(a=>a.includes(token)),inputHasToken:!!token&&input.includes(token),servers}));
 process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,num_turns:1,modelUsage:{'vault-contract-not-live':{inputTokens:1,outputTokens:1}},structured_output:{kind:'unclear',summary:'保管庫 테스트',patch:{},quotes:{}}}));
});
`;

// The interpreter's child handling (teaching-worker/interpreter.mjs interpretChat), with the test's own spawn binding and timeout.
function interpreterShaped(spawnImpl, file, args, options, input, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(file, args, options); let output = '', settled = false;
    const done = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); done(Error('Teaching interpretation timed out')); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 200000) { child.kill(); done(Error('Teaching response too large')); } });
    child.stderr.resume(); child.stdin.on('error', () => {}); child.once('error', () => done(Error('Teaching interpreter unavailable'))); child.once('close', code => done(code === 0 ? null : Error('Teaching interpreter failed'), output)); child.stdin.end(JSON.stringify(input));
  }).then(raw => { let result; try { result = JSON.parse(raw); if (result.is_error) throw Error(); result = result.structured_output || JSON.parse(result.result || '{}'); } catch { throw Error('Invalid teaching response'); } return { raw, result }; });
}

export async function runContracts({ root = path.resolve(here, '..') } = {}) {
  const checks = [], failures = [], deliberateDefects = [];
  const run = async (name, fn) => { try { await fn(); checks.push(name); } catch (e) { failures.push({ name, error: String(e?.message || e).slice(0, 500) }); } };
  try { os.setPriority(0, os.constants.priority.PRIORITY_LOW); } catch {}
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'omf-navi-agent-model-contract-'));
  const fake = path.join(temporary, 'fake-cli.cjs'); await fs.writeFile(fake, FAKE_CLI);
  const node = process.execPath, baseEnv = { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '', SYNTHETIC_CONTRACT_MARK: 'present' };
  const argv = (scenario, format = 'json', extra = []) => [fake, '-p', '--model', 'transport-fixture-not-live', '--effort', 'high', '--output-format', format, '--scenario', scenario, '--settings', '{"disableAllHooks":true}', ...extra];
  const options = () => ({ cwd: temporary, env: { ...baseEnv }, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const input = { mode: 'workspace', currentMessage: '契約テスト 메시지', evidence: { synthetic: true } };
  const originalSpawn = cp.spawn;
  try {
    // ---- First, before anything else imports them: the runner and case modules start nothing at import.
    await run('manifest:imports-side-effect-free-and-no-argument-entry', async () => {
      const handles = () => process.getActiveResourcesInfo().filter(r => r !== 'TTYWrap').length, before = handles(), spawnBefore = cp.spawn;
      await import('./finance-navi-agent-model.mjs'); await import('./finance-navi-agent-model-company-cases.mjs'); await import('./finance-navi-agent-model-owner-cases.mjs');
      assert.equal(cp.spawn, spawnBefore); assert.ok(handles() <= before, 'new handle after import');
      const out = await new Promise((resolve, reject) => { const c = originalSpawn(node, [path.join(here, 'finance-navi-agent-model.mjs')], { cwd: root, windowsHide: true, env: { ...baseEnv }, stdio: ['ignore', 'pipe', 'pipe'] }); let s = ''; c.stdout.on('data', b => s += b); c.once('error', reject); c.once('close', code => resolve({ code, s })); });
      assert.equal(out.code, 0); const report = JSON.parse(out.s); assert.equal(report.mode, 'population'); assert.equal(report.modelCalls, 0); assert.equal(report.cases.length, 62);
      // Deliberate addition (plan omf-navi-context-truth-20261024): the separately declared supplemental question is reported apart.
      assert.deepEqual((report.supplemental || []).map(r => r.id), ['CAP01', 'MEM01'], 'supplemental:population-report-separate'); assert.ok(!report.cases.some(r => ['CAP01', 'MEM01'].includes(r.id)));
    });
    // ---- Manifest and selection
    await run('manifest:declared-population-56-6-62', () => { assert.deepEqual(cases.verifyDeclaration(), { core: 56, historical: 6, total: 62 }); });
    await run('manifest:designs-bound-one-per-case', async () => {
      const { companyCaseIds } = await import('./finance-navi-agent-model-company-cases.mjs'), { ownerCaseIds } = await import('./finance-navi-agent-model-owner-cases.mjs');
      assert.deepEqual([...companyCaseIds].sort(), cases.population.filter(r => r.realm === 'company').map(r => r.id).sort());
      assert.deepEqual([...ownerCaseIds].sort(), cases.population.filter(r => r.realm !== 'company').map(r => r.id).sort());
    });
    await run('manifest:selection-rules', () => {
      for (const bad of [undefined, '', [], 'R01,R01', 'R99', 'K02', 'P02', 'O11', 'C02']) assert.throws(() => cases.selectCases(bad), /selection:/);
      assert.equal(cases.selectCases('ALL').length, 62);
      const subset = cases.selectCases('H05,R01,K01,K02,K03,K04');
      assert.deepEqual(subset.map(r => r.id), ['R01', 'K01', 'K02', 'K03', 'K04', 'H05']);
      assert.deepEqual(cases.denominators(subset), { selected: 6, core: 5, historical: 1, declaredTotal: 62, declaredCore: 56, declaredHistorical: 6, selectedIsWholePopulation: false });
      assert.equal(cases.selectCases('K03', { attempt: 'additional' }).length, 1);
    });
    await run('manifest:placeholders-and-pointers', () => {
      const j05 = cases.caseById('J05'), o12 = cases.caseById('O12');
      assert.throws(() => cases.resolveRequest(j05, { context: { page: 'transactions' } }), /missing-placeholder/);
      assert.throws(() => cases.resolveRequest(cases.caseById('R01'), { placeholders: { selectedLine: { value: '3' } } }), /undeclared-placeholder/);
      assert.throws(() => cases.resolveRequest(cases.caseById('R03'), { context: { page: 'invoices', invoiceId: 'a'.repeat(24) } }), /unlabelled-pointer/);
      const r = cases.resolveRequest(o12, { context: { page: 'intake-payments', paymentKind: 'card', paymentImportId: 'b'.repeat(24), paymentLine: 8 }, labels: { paymentImportId: 'O:statement-1' }, placeholders: { intakeRecordLabel: { value: '受付「O12-ORDER-7」' }, allocationAmount: { value: '7,700円' } } });
      assert.ok(!/\{[A-Za-z]+\}/.test(r.text) && r.text.includes('7,700円') && r.text.includes('O12-ORDER-7'));
    });
    await run('manifest:normalized-hash-stable-resolved-hash-per-runtime', () => {
      const row = cases.caseById('J05'), make = id => cases.resolveRequest(row, { context: { page: 'transactions' }, placeholders: { untrustedArchiveId: { value: id, label: '<J05:untrusted-archive>' } } });
      const a = make('c'.repeat(24)), b = make('d'.repeat(24));
      assert.equal(a.normalizedSha256, b.normalizedSha256); assert.notEqual(a.resolvedSha256, b.resolvedSha256); assert.ok(a.text.includes('c'.repeat(24)) && a.normalized.text.includes('<J05:untrusted-archive>'));
    });
    await run('manifest:evaluator-expectations-never-in-product-input', async () => {
      const { companyCases } = await import('./finance-navi-agent-model-company-cases.mjs');
      for (const row of cases.population.filter(r => r.cohort === cases.COHORT.historical)) {
        const design = companyCases.get(row.id), expected = cases.EVALUATOR_ONLY[row.id].expected;
        assert.ok(expected && cases.sha256(expected) === cases.DECLARED_RUBRIC_SHA256[row.id]);
        const request = cases.resolveRequest(row, { context: { page: row.page, transactionId: 'e'.repeat(24) }, labels: { transactionId: row.id + ':selected' }, preceding: design.preceding || [] }), payload = JSON.stringify(cases.productPayload(request));
        assert.ok(!payload.includes(expected) && !payload.includes(row.syntheticContext) && !payload.includes(row.historicalSource), row.id + ' evaluator text in product payload');
        for (const sentence of expected.split(/[.;:]/).map(s => s.trim()).filter(s => s.length > 24)) assert.ok(!payload.includes(sentence), row.id + ' expectation sentence in product payload');
      }
    });
    await run('manifest:explicit-mode-validation-before-any-start', async () => {
      const { parsePlan } = await import('./finance-navi-agent-model.mjs'), out = path.join(temporary, 'not-created');
      assert.throws(() => parsePlan({}), /plan:mode-required/);
      assert.throws(() => parsePlan({ OMF_NAVI_AGENT_MODEL_MODE: 'manual', OMF_NAVI_AGENT_MODEL_OUT: out }), /selection:declared-nonempty/);
      assert.throws(() => parsePlan({ OMF_NAVI_AGENT_MODEL_MODE: 'manual', OMF_NAVI_AGENT_MODEL_CASES: 'R01', OMF_NAVI_AGENT_MODEL_OUT: out, OMF_NAVI_AGENT_MODEL_BATCH: 'b1' }), /plan:native-cli-path-required/);
      assert.throws(() => parsePlan({ OMF_NAVI_AGENT_MODEL_MODE: 'manual', OMF_NAVI_AGENT_MODEL_CASES: 'R01', OMF_NAVI_AGENT_MODEL_OUT: out, OMF_NAVI_AGENT_MODEL_BATCH: 'b1', OMF_NAVI_AGENT_MODEL_CLI: node }), /plan:frozen-manifest-required/);
      assert.throws(() => parsePlan({ OMF_NAVI_AGENT_MODEL_MODE: 'manual', OMF_NAVI_AGENT_MODEL_CASES: 'R01', OMF_NAVI_AGENT_MODEL_OUT: out, OMF_NAVI_AGENT_MODEL_ATTEMPT: 'additional' }), /needs-named-reason/);
      assert.throws(() => parsePlan({ OMF_NAVI_AGENT_MODEL_MODE: 'prepare', OMF_NAVI_AGENT_MODEL_CASES: 'R01', OMF_NAVI_AGENT_MODEL_OUT: out, OMF_NAVI_AGENT_MODEL_AUTH: 'connected' }), /auth-only-in-manual-mode/);
      assert.equal(parsePlan({ OMF_NAVI_AGENT_MODEL_MODE: 'prepare', OMF_NAVI_AGENT_MODEL_CASES: 'R01', OMF_NAVI_AGENT_MODEL_OUT: out }).rows.length, 1);
      await assert.rejects(fs.access(out));
    });

    // ---- 2026-10-24 (plan omf-navi-context-truth-20261024, independent review F3/F4): the original 62 stay exactly as declared; one
    // supplemental capability question (CAP01) is declared separately before any inference, selectable only as an explicit additional
    // attempt with a named reason, in its own batch and denominator; the reviewed O03 evaluator expects a focused scope question and zero
    // writes. A deterministic zero-write pass never grades whether a question or explanation is focused or correct (manual grade).
    await run('original62:declaration-selection-and-denominator-unchanged', () => {
      assert.equal(cases.sha256(cases.canonicalJson(cases.DECLARED_TEXT_SHA256)), 'f6621314d154ec2c6322bd2a645a9f573c2196436ffc24d4da56d88e4eba95cb', 'original62:declaration-hash');
      assert.deepEqual(cases.verifyDeclaration(), { core: 56, historical: 6, total: 62 });
      for (const id of ['CAP01', 'MEM01']) { assert.ok(!cases.population.some(r => r.id === id), 'original62:no-supplemental-row'); assert.equal(cases.caseById(id), null, 'original62:no-supplemental-row'); }
      assert.deepEqual(cases.selectCases('ALL').map(r => r.id), cases.population.map(r => r.id), 'original62:all-is-original');
      assert.deepEqual(cases.selectCases('ALL', { attempt: 'additional' }).map(r => r.id), cases.population.map(r => r.id), 'original62:all-is-original');
      assert.equal(cases.caseById('O03').textSha256, '3a15b79d52ea21781b8feff8206c03a36faf561703aba920a49f884c87373b19', 'original62:o03-text-unchanged');
      assert.deepEqual(cases.denominators(cases.selectCases('O12,O03')), { selected: 2, core: 2, historical: 0, declaredTotal: 62, declaredCore: 56, declaredHistorical: 6, selectedIsWholePopulation: false }, 'original62:denominator-shape');
    });
    await run('supplemental:declared-separately-initial-refused-distinct-denominator', () => {
      // Deliberate change (plan omf-navi-scope-facts-20261024): MEM01 is the second supplemental declaration, in a group of its own.
      assert.deepEqual(cases.verifySupplementalDeclaration(), { supplemental: 2, groups: { 'capability-question': 1, 'positive-memory-control': 1 } }, 'supplemental:declaration');
      assert.equal(cases.SUPPLEMENTAL_RUBRIC_SHA256.CAP01, 'e6c4747717fdd5a548bff9c98cf375d7d65737e3e81a3d21dd123cff295e4f12', 'supplemental:cap01-rubric-pinned'); assert.equal(cases.SUPPLEMENTAL_EVALUATOR_ONLY.CAP01.rubric, 'Supplemental CAP01 (manual explanation grade required)');
      const cap = cases.supplementalCaseById('CAP01');
      assert.equal(cap.textSha256, 'ce6962ef228facb92b95040f8a13f6e796d179d4819f3d501f69f6aad1176cd1', 'supplemental:cap01-text-pinned');
      assert.equal(cap.cohort, cases.SUPPLEMENTAL_COHORT); assert.equal(cap.realm, 'owner'); assert.equal(cap.nativePage, 'intake-payments'); assert.deepEqual(cap.placeholders, []); assert.equal(cap.family, null);
      assert.throws(() => cases.selectCases('CAP01'), /selection:supplemental-additional-only/, 'supplemental:initial-refused');
      assert.throws(() => cases.selectCases('CAP01,O12', { attempt: 'additional' }), /selection:supplemental-separate-batch/, 'supplemental:never-mixed-into-original');
      const rows = cases.selectCases('CAP01', { attempt: 'additional' });
      assert.deepEqual(rows.map(r => r.id), ['CAP01']);
      assert.deepEqual(cases.denominators(rows), { selected: 1, supplemental: 1, declaredSupplemental: 1, cohort: cases.SUPPLEMENTAL_COHORT, supplementalGroup: 'capability-question', countsTowardOriginal62: false, selectedIsWholePopulation: false }, 'supplemental:distinct-denominator');
      assert.throws(() => cases.denominators([...rows, cases.caseById('O12')]), /denominators:supplemental-separate/, 'supplemental:never-mixed-into-original');
    });
    await run('supplemental:explicit-plan-needs-additional-and-named-reason', async () => {
      const { parsePlan } = await import('./finance-navi-agent-model.mjs'), out = path.join(temporary, 'not-created-supplemental');
      for (const mode of ['prepare', 'selftest', 'manual']) {
        assert.throws(() => parsePlan({ OMF_NAVI_AGENT_MODEL_MODE: mode, OMF_NAVI_AGENT_MODEL_CASES: 'CAP01', OMF_NAVI_AGENT_MODEL_OUT: out }), /selection:supplemental-additional-only/, 'supplemental:initial-refused ' + mode);
        assert.throws(() => parsePlan({ OMF_NAVI_AGENT_MODEL_MODE: mode, OMF_NAVI_AGENT_MODEL_CASES: 'CAP01', OMF_NAVI_AGENT_MODEL_OUT: out, OMF_NAVI_AGENT_MODEL_ATTEMPT: 'additional' }), /needs-named-reason/, 'supplemental:reason-required ' + mode);
      }
      for (const mode of ['prepare', 'selftest']) assert.deepEqual(parsePlan({ OMF_NAVI_AGENT_MODEL_MODE: mode, OMF_NAVI_AGENT_MODEL_CASES: 'CAP01', OMF_NAVI_AGENT_MODEL_OUT: out, OMF_NAVI_AGENT_MODEL_ATTEMPT: 'additional', OMF_NAVI_AGENT_MODEL_REASON: 'F3 capability question CAP01 declared before inference' }).rows.map(r => r.id), ['CAP01']);
      await assert.rejects(fs.access(out));
    });
    await run('supplemental:frozen-input-is-the-declared-text-evaluator-separate', async () => {
      const cap = cases.supplementalCaseById('CAP01'), expected = cases.SUPPLEMENTAL_EVALUATOR_ONLY.CAP01.expected;
      assert.equal(cases.sha256(expected), cases.SUPPLEMENTAL_RUBRIC_SHA256.CAP01, 'supplemental:evaluator-pinned');
      const make = id => cases.resolveRequest(cap, { context: { page: 'intake-payments', paymentKind: 'card', paymentImportId: id, paymentLine: 8 }, labels: { paymentImportId: 'O:statement-1' } });
      const a = make('b'.repeat(24)), b = make('c'.repeat(24));
      assert.equal(a.text, cap.text); assert.equal(a.normalized.text, cap.text, 'supplemental:exact-declared-text'); assert.equal(a.declaredTextSha256, cap.textSha256); assert.deepEqual(a.preceding, []);
      assert.equal(a.normalizedSha256, b.normalizedSha256); assert.notEqual(a.resolvedSha256, b.resolvedSha256);
      const payload = JSON.stringify(cases.productPayload(a));
      assert.ok(!payload.includes(expected), 'supplemental:evaluator-not-in-input');
      for (const sentence of expected.split(/[.;:]/).map(s => s.trim()).filter(s => s.length > 24)) assert.ok(!payload.includes(sentence), 'supplemental:evaluator-not-in-input');
      assert.throws(() => cases.resolveRequest({ ...cap }, { context: { page: 'intake-payments' } }), /resolve:declared-case-required/);
      // The declaration is part of the source identity (and so of every frozen manifest), and the new evaluator module is a harness file.
      const { sourceIdentity, HARNESS_FILES } = await import('./finance-navi-agent-model.mjs'), identity = sourceIdentity(root);
      assert.ok(HARNESS_FILES.includes('scripts/finance-navi-agent-model-supplemental.mjs'), 'supplemental:harness-file');
      assert.match(String(identity.harnessSha256['scripts/finance-navi-agent-model-supplemental.mjs']), /^[a-f0-9]{64}$/, 'supplemental:harness-file');
      assert.equal(identity.declarationSha256, 'f6621314d154ec2c6322bd2a645a9f573c2196436ffc24d4da56d88e4eba95cb', 'original62:declaration-hash');
      assert.equal(identity.supplementalDeclarationSha256, cases.sha256(cases.canonicalJson({ text: cases.SUPPLEMENTAL_TEXT_SHA256, rubric: cases.SUPPLEMENTAL_RUBRIC_SHA256 })), 'supplemental:source-identity');
    });
    await run('evaluator:o03-reviewed-scope-question-zero-writes-future-memory-rejected', async () => {
      const { ownerCases, EVALUATOR_CORRECTIONS } = await import('./finance-navi-agent-model-owner-cases.mjs'), o03 = ownerCases.get('O03');
      assert.deepEqual(o03.allowed({}), {}, 'evaluator:o03-zero-writes');
      assert.equal(o03.defect.flips, 'protected:no-future-memory', 'evaluator:o03-wrong-future-memory-defect');
      assert.equal(EVALUATOR_CORRECTIONS.O03.finding, 'F4'); assert.equal(EVALUATOR_CORRECTIONS.O03.manualGradeRequired, true, 'evaluator:o03-manual-grade-kept');
      const memoryWritten = { financedecisionmemories: { added: ['a'.repeat(24)], removed: [], changed: [] }, financeactionoperations: { added: ['b'.repeat(24)], removed: [], changed: [] } };
      assert.equal(cases.gradeEffects(memoryWritten, o03.allowed({}))[0].pass, false, 'evaluator:o03-future-memory-rejected');
      assert.equal(cases.gradeEffects({}, o03.allowed({}))[0].pass, true, 'evaluator:o03-zero-write-accepted');
    });
    await run('evaluator:cap01-zero-writes-wrong-allocation-rejected', async () => {
      const { ownerCases } = await import('./finance-navi-agent-model-owner-cases.mjs'), { supplementalCases } = await import('./finance-navi-agent-model-supplemental.mjs'), cap = supplementalCases.get('CAP01');
      assert.deepEqual([...supplementalCases.keys()], ['CAP01', 'MEM01']); assert.equal(ownerCases.has('CAP01'), false, 'supplemental:not-an-original-design'); assert.equal(ownerCases.has('MEM01'), false, 'supplemental:not-an-original-design');
      assert.deepEqual(cap.allowed({}), {}, 'evaluator:cap01-zero-writes'); assert.equal(cap.defect.flips, 'protected:no-allocation-or-write', 'evaluator:cap01-wrong-allocation-defect');
      assert.equal(cap.prepare, ownerCases.get('O12').prepare, 'supplemental:reuses-native-o12-setup');
      const allocated = { financepayments: { added: ['c'.repeat(24)], removed: [], changed: [] }, financeactionoperations: { added: ['d'.repeat(24)], removed: [], changed: [] } };
      assert.equal(cases.gradeEffects(allocated, cap.allowed({}))[0].pass, false, 'evaluator:cap01-allocation-rejected');
    });

    // ---- 2026-10-24 (plan omf-navi-scope-facts-20261024, additional independent review F1/F2). MEM01, the positive control of the
    // future-rule scope, is declared separately before any inference: its own supplemental group, batch and denominator, never one of
    // the 62 and never counted with CAP01. Its oracle requires exactly one future customer/purpose memory and rejects both an omission
    // (refusal) and a draft write. The budget reads the model receives state that ordinary pages and imports neither set nor show the
    // matched category text.
    await run('supplemental:mem01-declared-separately-own-group-batch-and-denominator', async () => {
      const mem = cases.supplementalCaseById('MEM01'), cap = cases.supplementalCaseById('CAP01'), expected = cases.SUPPLEMENTAL_EVALUATOR_ONLY.MEM01.expected;
      assert.equal(mem.textSha256, 'f8560d29e4d86e8d6a8647a306fe4cc2eb32507f46c2449a3434ff9cb768b836', 'supplemental:mem01-text-pinned'); assert.equal(cases.SUPPLEMENTAL_TEXT_SHA256.MEM01, mem.textSha256);
      assert.equal(cases.sha256(expected), '43533bf6df374674dfc5da74de3139aba576a36046a012a90e79b505984cb8ae', 'supplemental:mem01-evaluator-pinned'); assert.equal(cases.SUPPLEMENTAL_RUBRIC_SHA256.MEM01, cases.sha256(expected));
      assert.equal(cap.textSha256, 'ce6962ef228facb92b95040f8a13f6e796d179d4819f3d501f69f6aad1176cd1', 'supplemental:cap01-text-pinned');
      assert.deepEqual([mem.cohort, mem.realm, mem.endpoint, mem.page, mem.nativePage, mem.family, mem.supplementalGroup], [cases.SUPPLEMENTAL_COHORT, 'purchase', 'purchase', 'draft', null, null, 'positive-memory-control'], 'supplemental:mem01-shape');
      assert.deepEqual(mem.placeholders, []); assert.equal(cap.supplementalGroup, 'capability-question');
      assert.throws(() => cases.selectCases('MEM01'), /selection:supplemental-additional-only/, 'supplemental:mem01-initial-refused');
      assert.throws(() => cases.selectCases('MEM01,O03', { attempt: 'additional' }), /selection:supplemental-separate-batch/, 'supplemental:never-mixed-into-original');
      assert.throws(() => cases.selectCases('CAP01,MEM01', { attempt: 'additional' }), /selection:supplemental-group-separate-batch/, 'supplemental:mem01-never-with-cap01');
      const rows = cases.selectCases('MEM01', { attempt: 'additional' });
      assert.deepEqual(cases.denominators(rows), { selected: 1, supplemental: 1, declaredSupplemental: 1, cohort: cases.SUPPLEMENTAL_COHORT, supplementalGroup: 'positive-memory-control', countsTowardOriginal62: false, selectedIsWholePopulation: false }, 'supplemental:mem01-distinct-denominator');
      assert.throws(() => cases.denominators([cap, mem]), /denominators:supplemental-group-separate/, 'supplemental:mem01-never-with-cap01');
      assert.throws(() => cases.denominators([mem, cases.caseById('O03')]), /denominators:supplemental-separate/, 'supplemental:never-mixed-into-original');
      const { parsePlan } = await import('./finance-navi-agent-model.mjs'), out = path.join(temporary, 'not-created-mem01');
      for (const mode of ['prepare', 'selftest', 'manual']) assert.throws(() => parsePlan({ OMF_NAVI_AGENT_MODEL_MODE: mode, OMF_NAVI_AGENT_MODEL_CASES: 'MEM01', OMF_NAVI_AGENT_MODEL_OUT: out, OMF_NAVI_AGENT_MODEL_ATTEMPT: 'additional' }), /needs-named-reason/, 'supplemental:reason-required ' + mode);
      assert.deepEqual(parsePlan({ OMF_NAVI_AGENT_MODEL_MODE: 'selftest', OMF_NAVI_AGENT_MODEL_CASES: 'MEM01', OMF_NAVI_AGENT_MODEL_OUT: out, OMF_NAVI_AGENT_MODEL_ATTEMPT: 'additional', OMF_NAVI_AGENT_MODEL_REASON: 'F1 positive control MEM01 declared before inference' }).rows.map(r => r.id), ['MEM01']);
      await assert.rejects(fs.access(out));
      const make = id => cases.resolveRequest(mem, { context: { importId: id, line: 4 }, labels: { importId: 'O:statement-1' } }), a = make('b'.repeat(24)), b = make('c'.repeat(24));
      assert.equal(a.text, mem.text); assert.equal(a.normalized.text, mem.text, 'supplemental:mem01-exact-declared-text'); assert.deepEqual(a.preceding, []); assert.equal(a.normalizedSha256, b.normalizedSha256);
      const payload = JSON.stringify(cases.productPayload(a));
      assert.ok(!payload.includes(expected), 'supplemental:evaluator-not-in-input');
      for (const sentence of expected.split(/[.;:]/).map(s => s.trim()).filter(s => s.length > 24)) assert.ok(!payload.includes(sentence), 'supplemental:evaluator-not-in-input');
      assert.equal(cases.denominators(cases.selectCases('O03,O02')).declaredTotal, 62, 'original62:denominator-shape');
    });
    await run('evaluator:mem01-one-future-memory-omission-and-draft-write-rejected', async () => {
      const { ownerCases } = await import('./finance-navi-agent-model-owner-cases.mjs'), sup = await import('./finance-navi-agent-model-supplemental.mjs'), mem = sup.supplementalCases.get('MEM01');
      assert.equal(mem.prepare, ownerCases.get('O03').prepare, 'supplemental:mem01-reuses-native-o03-setup');
      assert.deepEqual(mem.allowed({}), { financedecisionmemories: { added: 1 }, financeactionoperations: { added: 1 } }, 'evaluator:mem01-one-memory-allowed');
      assert.equal(mem.defect.flips, 'protected:saved-draft-values-unchanged', 'evaluator:mem01-draft-write-defect');
      const draft = 'd'.repeat(24), acct = 'a'.repeat(24), customer = 'c'.repeat(24), statement = 'e'.repeat(24), saved = { purpose: 'company', customerId: '', accountCategoryId: 'f'.repeat(24) };
      const s = { draftDocId: draft, importId: statement, line: 4, customer, memoriesBefore: 1, before: { values: saved } };
      const source = { account: { id: acct, name: 'AMEX_MAIN' }, description: 'SYNTHETIC_SHOP', purchaseDate: '2026-08-03' };
      const earlier = { kind: 'accounting', status: 'active' }, future = { kind: 'classification', status: 'active', purpose: 'customer', customerId: customer, decision: { purpose: 'customer', customerId: customer }, accountId: acct, merchantLabel: 'SYNTHETIC_SHOP', effectiveFrom: '2026-08-03', source: { importId: statement, line: 4 } };
      const turn = actions => ({ actions: actions.map(([name, state]) => ({ name, state })) });
      const evidence = over => ({ mode: 'manual', rows: [earlier, future], view: { values: saved, source, approvedAt: null }, storedBefore: saved, storedAfter: saved, turn: turn([['remember_customer_purpose', 'done']]), diff: { financedecisionmemories: { added: ['m'] }, financeactionoperations: { added: ['o'] } }, ...over });
      const verdict = e => Object.fromEntries(sup.memoryControlChecks(s, e).map(c => [c.name, c.pass]));
      const ideal = verdict(evidence({}));
      assert.ok(Object.values(ideal).every(Boolean) && Object.keys(ideal).length === 7, 'evaluator:mem01-ideal-accepted ' + JSON.stringify(ideal));
      // Omission or refusal: no memory and no receipt (a scope question in place of the explicitly requested rule).
      const refused = verdict(evidence({ rows: [earlier], turn: turn([]), diff: {} }));
      assert.equal(refused['receipts:done-remember_customer_purpose'], false, 'evaluator:mem01-omission-rejected'); assert.equal(refused['effect:one-future-customer-memory'], false, 'evaluator:mem01-omission-rejected');
      assert.equal(refused['protected:saved-draft-values-unchanged'], true); assert.equal(refused['protected:draft-not-saved'], true);
      // Wrong draft write: the rule is saved, but the saved company-use draft is also changed to the customer.
      const written = { ...saved, purpose: 'customer', customerId: customer };
      const draftWrite = verdict(evidence({ view: { values: written, source, approvedAt: null }, storedAfter: written, turn: turn([['remember_customer_purpose', 'done'], ['save_draft_fields', 'done']]), diff: { financedecisionmemories: { added: ['m'] }, financeactionoperations: { added: ['o', 'p'] }, financedrafts: { added: [], removed: [], changed: [{ id: draft, fields: ['values'] }] } } }));
      assert.equal(draftWrite['protected:saved-draft-values-unchanged'], false, 'evaluator:mem01-draft-write-rejected'); assert.equal(draftWrite['protected:draft-not-saved'], false, 'evaluator:mem01-draft-write-rejected');
      // Wider or wrong memories are not the requested rule: an accounting memory, another customer or a paused row.
      assert.equal(verdict(evidence({ rows: [earlier, future, { kind: 'accounting', status: 'active' }] }))['effect:one-future-customer-memory'], false, 'evaluator:mem01-exactly-one-memory');
      assert.equal(verdict(evidence({ rows: [earlier, { ...future, kind: 'accounting' }], turn: turn([['remember_accounting_fields', 'done']]) }))['protected:no-accounting-memory'], false, 'evaluator:mem01-no-accounting-memory');
      assert.equal(verdict(evidence({ rows: [earlier, { ...future, customerId: 'b'.repeat(24), decision: { purpose: 'customer', customerId: 'b'.repeat(24) } }] }))['effect:one-future-customer-memory'], false, 'evaluator:mem01-registered-customer');
      assert.equal(verdict(evidence({ rows: [earlier, { ...future, status: 'paused' }] }))['effect:one-future-customer-memory'], false, 'evaluator:mem01-active-memory');
      assert.equal(verdict(evidence({ rows: [earlier, { ...future, effectiveFrom: '2026-08-04' }] }))['effect:one-future-customer-memory'], false, 'evaluator:mem01-from-purchase-date');
      assert.equal(verdict(evidence({ view: { values: saved, source, approvedAt: '2026-10-24T00:00:00.000Z' } }))['protected:not-approved-or-posted'], false, 'evaluator:mem01-no-approval');
      assert.equal(cases.gradeEffects({ financedecisionmemories: { added: ['m'], removed: [], changed: [] }, financeactionoperations: { added: ['o'], removed: [], changed: [] } }, mem.allowed({}))[0].pass, true, 'evaluator:mem01-one-memory-allowed');
      assert.equal(cases.gradeEffects({ financedecisionmemories: { added: ['m'], removed: [], changed: [] }, financeactionoperations: { added: ['o'], removed: [], changed: [] }, financeentries: { added: ['x'], removed: [], changed: [] } }, mem.allowed({}))[0].pass, false, 'evaluator:mem01-posting-rejected');
      // Selftest only: the remember descriptions the claimed job delivered must state the future scope (synthetic catalogues here).
      const stated = Object.fromEntries(sup.REMEMBER_TOOLS.map(n => [n, 'Save a rule for later purchases: used from this purchase date on. It is not a note about this one purchase.']));
      assert.equal(verdict(evidence({ mode: 'selftest' }))['catalogue:remember-tools-state-future-rule-scope'], false, 'evaluator:mem01-catalogue-required-in-selftest');
      assert.equal(sup.memoryControlChecks({ ...s, claimedCatalogue: stated }, evidence({ mode: 'selftest' })).every(c => c.pass), true, 'evaluator:mem01-catalogue-stated');
      assert.equal(sup.memoryControlChecks({ ...s, claimedCatalogue: { ...stated, remember_accounting_fields: 'Remember the named fields. Explicit instruction only.' } }, evidence({ mode: 'selftest' })).find(c => c.name === 'catalogue:remember-tools-state-future-rule-scope').pass, false, 'evaluator:mem01-catalogue-both-tools');
    });
    await run('budget-facts:returned-catalogue-states-ordinary-pages-and-imports-neither-set-nor-show-category-text', async () => {
      const { companyBusinessTools } = await import('../shared/finance-navi-business.mjs');
      for (const name of ['list_company_budgets', 'get_company_budget']) {
        const d = companyBusinessTools.find(t => t.name === name)?.description || '';
        assert.match(d, /saved category text \(category or metadata\.category\)/, 'budget-facts:basis ' + name);
        assert.match(d, /No ordinary OMF transaction page, form or import \(card statement, bank or file\) sets or shows that text/, 'budget-facts:ordinary-pages-and-imports ' + name);
        assert.match(d, /column labelled 勘定科目 \(카테고리 in Korean\) shows the account category, which this match does not use/, 'budget-facts:transactions-page-column ' + name);
        assert.match(d, /only a generated recurring-payment forecast copies its recurring payment's saved category/, 'budget-facts:only-forecast-copies ' + name);
      }
    });

    // ---- Real disposable child transport
    await run('transport:default-json-passive-exact-bytes-split-utf8', async () => {
      const ob = installSpawnObserver({ cliPath: node });
      try {
        ob.setCase({ caseId: 'CONTRACT', attemptId: 'CONTRACT.json', transport: 'default-json', boundary: text => ({ parsed: true, currentMessageMatchesFrozen: JSON.parse(text).currentMessage === input.currentMessage }) });
        const args = argv('json-ok'), opts = options(), r = await interpreterShaped(esmSpawn, node, args, opts, input);
        assert.equal(r.raw, FINAL_PAYLOAD); assert.equal(r.result.summary, '返信 테스트 — 確認');
        const p = ob.processes[0]; assert.equal(ob.processes.length, 1); assert.equal(p.optionsIdentityPreserved, true); assert.equal(p.argsIdentityPreserved, true); assert.equal(p.auth.overlay, false);
        assert.deepEqual(p.envKeys, Object.keys(baseEnv).sort()); assert.equal(p.exitCode, 0); assert.equal(p.stdout.sha256, sha(Buffer.from(FINAL_PAYLOAD))); assert.equal(p.envelopeSha256, sha(FINAL_PAYLOAD));
        assert.deepEqual(p.envelope.modelNames, ['transport-fixture-not-live']); assert.equal(p.envelope.num_turns, 3); assert.equal(p.envelope.usage.serverToolUse.web_search_requests, 1);
        assert.equal(p.stdin.sha256, sha(JSON.stringify(input))); assert.deepEqual(p.boundary, { parsed: true, currentMessageMatchesFrozen: true });
        // Deliberate change (2026-10-24, scope item 1): the exact native input is retained as the interpreter wrote it, unchanged.
        assert.deepEqual(p.nativeInput, { exact: true, text: JSON.stringify(input) }, 'evidence:native-input-exact');
      } finally { ob.restore(); }
    });
    await run('transport:native-nonzero-exit-preserved', async () => {
      const ob = installSpawnObserver({ cliPath: node });
      try { ob.setCase({ caseId: 'CONTRACT', attemptId: 'x', transport: 'default-json' }); await assert.rejects(interpreterShaped(esmSpawn, node, argv('json-nonzero'), options(), input), /Teaching interpreter failed/); assert.equal(ob.processes[0].exitCode, 3); assert.equal(ob.processes[0].envelopeParse, 'invalid-json'); } finally { ob.restore(); }
    });
    await run('transport:spawn-error-preserved', async () => {
      const missing = path.join(temporary, 'missing-cli.exe'), ob = installSpawnObserver({ cliPath: missing });
      try { ob.setCase({ caseId: 'CONTRACT', attemptId: 'x', transport: 'default-json' }); await assert.rejects(interpreterShaped(esmSpawn, missing, argv('json-ok'), options(), input), /Teaching interpreter unavailable/); assert.equal(ob.processes[0].spawnError, 'ENOENT'); } finally { ob.restore(); }
    });
    await run('transport:native-timer-kill-preserved', async () => {
      const ob = installSpawnObserver({ cliPath: node });
      try { ob.setCase({ caseId: 'CONTRACT', attemptId: 'x', transport: 'stream-json' }); await assert.rejects(interpreterShaped(esmSpawn, node, argv('hang'), options(), input, 1500), /timed out/); const p = ob.processes[0]; for (let i = 0; i < 200 && !p.closedAt; i++) await new Promise(r => setTimeout(r, 50)); assert.ok(p.closedAt, 'killed child closed'); assert.ok(p.signal || p.exitCode !== 0); assert.match(p.observerFailure, /Missing native final result/); } finally { ob.restore(); }
    });
    await run('transport:stream-exact-final-forwarded-before-close', async () => {
      const ob = installSpawnObserver({ cliPath: node });
      try {
        ob.setCase({ caseId: 'P01', attemptId: 'P01.contract', transport: 'stream-json' });
        const args = argv('stream-ok'), r = await interpreterShaped(esmSpawn, node, args, options(), input);
        assert.equal(r.raw, FINAL_PAYLOAD, 'observer:exact-native-forwarding');
        const p = ob.processes[0]; assert.equal(p.forwardedBeforeClose, true); assert.equal(p.stream.nativePayloadSha256, sha(FINAL_PAYLOAD)); assert.equal(p.stream.forwardedPayloadSha256, sha(FINAL_PAYLOAD));
        assert.deepEqual(p.stream.events, [{ kind: 'public_query', name: 'WebSearch', query: 'テスラ 日本 インボイス 登録番号' }, { kind: 'native_tool', name: 'mcp__omf_actions__get_company_transaction' }]);
        assert.deepEqual(p.stream.init, { model: 'transport-fixture-not-live', tools: ['WebSearch', 'mcp__omf_actions__get_company_transaction'], mcpServers: [{ name: 'omf_actions', status: 'connected' }] });
        assert.deepEqual(p.loggingChanges, { outputFormat: ['json', 'stream-json'], verboseAdded: true }); assert.equal(p.originalArgsSha256, sha(JSON.stringify(args))); assert.notEqual(p.spawnedArgsSha256, p.originalArgsSha256);
        assert.ok(!JSON.stringify(ob.processes).includes('DO_NOT_RECORD'), 'hidden reasoning, auth source or tool arguments retained');
        const mapped = streamArguments(args).args, expected = [...args]; expected[expected.indexOf('json')] = 'stream-json'; expected.push('--verbose'); assert.deepEqual(mapped, expected);
      } finally { ob.restore(); }
    });
    for (const [scenario, pattern] of [['stream-missing', /Missing native final result/], ['stream-malformed', /JSON|Unexpected token|not valid/i], ['stream-duplicate', /after final/]]) {
      await run('transport:' + scenario + '-is-named-observer-failure-drained-no-repair', async () => {
        const ob = installSpawnObserver({ cliPath: node });
        try { ob.setCase({ caseId: 'P01', attemptId: 'x', transport: 'stream-json' }); await assert.rejects(interpreterShaped(esmSpawn, node, argv(scenario), options(), input), /Invalid teaching response/); const p = ob.processes[0]; assert.match(p.observerFailure, pattern); assert.equal(p.forwardedBeforeClose, false); assert.equal(p.stdout.drained, true); if (scenario === 'stream-malformed') assert.ok(p.stdout.bytes > 300000, 'stream drained after parser failure'); } finally { ob.restore(); }
      });
    }
    await run('transport:stream-native-error-forwarded-unchanged', async () => {
      const ob = installSpawnObserver({ cliPath: node });
      try { ob.setCase({ caseId: 'P01', attemptId: 'x', transport: 'stream-json' }); await assert.rejects(interpreterShaped(esmSpawn, node, argv('stream-error'), options(), input), /Teaching interpreter failed/); const p = ob.processes[0]; assert.equal(p.exitCode, 1); assert.equal(p.envelope.isError, true); assert.equal(p.forwardedBeforeClose, true); assert.equal(p.observerFailure, undefined); } finally { ob.restore(); }
    });
    await run('transport:spawn-and-esm-binding-restored-unrelated-untouched', async () => {
      const ob = installSpawnObserver({ cliPath: node });
      assert.notEqual(cp.spawn, originalSpawn); assert.equal(esmSpawn, cp.spawn); assert.throws(() => installSpawnObserver({ cliPath: node }), /already-installed/);
      const other = process.execPath.split(path.sep).join('/');
      if (other !== node) { const r = await interpreterShaped(esmSpawn, other, argv('json-ok'), options(), input); assert.equal(r.raw, FINAL_PAYLOAD); }
      assert.equal(ob.stats().matched, 0); assert.equal(ob.stats().unrelated, other !== node ? 1 : 0);
      ob.restore(); ob.restore(); assert.equal(cp.spawn, originalSpawn); assert.equal(esmSpawn, originalSpawn);
    });

    // ---- Connected-auth: one key on the exact matched CLI child only; never retained
    await run('auth:connected-one-key-exact-child-only-redacted', async () => {
      const token = 'synthetic-contract-token-' + randomUUID(), tokenSha = sha(token), report = extra => argv('env-report', 'json', ['--expect-auth-sha', tokenSha, ...extra]);
      // Baseline: the same options through the default observer (no overlay). The platform adds its required variables (libuv) to any
      // custom environment, so the comparison is child against child, and the only allowed difference is the one added key.
      const plain = installSpawnObserver({ cliPath: node }); let baseline;
      try { plain.setCase({ caseId: 'CONTRACT', attemptId: 'default', transport: 'default-json' }); baseline = (await interpreterShaped(esmSpawn, node, report([]), options(), input)).result; assert.equal(baseline.authPresent, false); assert.ok(!baseline.keys.includes(AUTH_KEY)); assert.equal(plain.processes[0].optionsIdentityPreserved, true); assert.equal(plain.processes[0].auth.overlay, false); } finally { plain.restore(); }
      const ob = installSpawnObserver({ cliPath: node, connectedAuth: { token, slot: 'contract-slot', configDirectory: 'C:/synthetic/config' } });
      try {
        ob.setCase({ caseId: 'CONTRACT', attemptId: 'auth', transport: 'default-json' });
        const matched = (await interpreterShaped(esmSpawn, node, report([]), options(), input)).result;
        assert.deepEqual(matched.keys, [...baseline.keys, AUTH_KEY].sort(), 'auth:exactly-one-added-key'); assert.equal(matched.authMatches, true, 'auth:selected-credential-reaches-matched-child'); assert.equal(matched.inputSha, baseline.inputSha, 'auth:input-bytes-unchanged');
        const p = ob.processes[0]; assert.deepEqual(p.auth, { overlay: true, key: AUTH_KEY, preexistingKey: false, slot: 'contract-slot', configDirectory: 'C:/synthetic/config' }); assert.equal(p.optionsIdentityPreserved, false); assert.equal(p.argsIdentityPreserved, true); assert.deepEqual(p.envKeys, Object.keys(baseEnv).sort());
        const other = process.execPath.split(path.sep).join('/');
        if (other !== node) { const unrelated = (await interpreterShaped(esmSpawn, other, report([]), options(), input)).result; assert.equal(unrelated.authPresent, false, 'auth:unrelated-child-untouched'); assert.deepEqual(unrelated.keys, baseline.keys, 'auth:unrelated-child-untouched'); }
        const noEnv = { ...options() }; delete noEnv.env;
        await interpreterShaped(esmSpawn, node, report([]), noEnv, input).then(r => assert.equal(r.result.authMatches, false));
        assert.match(ob.processes.at(-1).observerFailure, /environment missing; overlay refused/);
        assert.ok(!JSON.stringify(ob.processes).includes(token) && !JSON.stringify(ob.processes).includes(tokenSha), 'auth:credential-never-retained');
      } finally { ob.restore(); }
      assert.throws(() => installSpawnObserver({ cliPath: node, connectedAuth: { token: '' } }), /connected-auth-token-required/);
    });

    // ---- Vault auth (explicit manual-only option, plan omf-navi-native-auth-followup-20261024). The credential is validated without
    // ever being echoed, taken into memory and removed from the environment before any child, written only into the owned DPAPI
    // worker Vault as nativeOAuthToken, and delivered by the actual TeachingWorker/interpreter/helper; the spawn observer runs with
    // connectedAuth null (no overlay). The default and connected options stay as they were.
    const runnerModule = await import('./finance-navi-agent-model.mjs');
    const vaultToken = () => 'synthetic-vault-native-' + randomUUID().replace(/-/g, '');
    const planExercise = async mod => {
      const out = path.join(temporary, 'not-created-vault'), frozen = path.join(temporary, 'frozen-placeholder.json'); await fs.writeFile(frozen, '{}');
      const manual = { OMF_NAVI_AGENT_MODEL_MODE: 'manual', OMF_NAVI_AGENT_MODEL_CASES: 'R01', OMF_NAVI_AGENT_MODEL_OUT: out, OMF_NAVI_AGENT_MODEL_BATCH: 'b1', OMF_NAVI_AGENT_MODEL_CLI: node, OMF_NAVI_AGENT_MODEL_FROZEN: frozen, OMF_NAVI_AGENT_MODEL_AUTH: 'vault' };
      assert.throws(() => mod.parsePlan(manual), /plan:vault-auth-token-missing/, 'auth:vault-plan-validation');
      for (const bad of ['short-token', 'synthetic vault with a space ' + 'x'.repeat(20), 'synthetic-vault\n' + 'y'.repeat(24), 'あ'.repeat(30)]) assert.throws(() => mod.parsePlan({ ...manual, OMF_NAVI_AGENT_MODEL_CONNECTED_OAUTH: bad }), e => /plan:vault-auth-token-invalid/.test(e.message) && !e.message.includes(bad), 'auth:vault-plan-validation');
      const token = vaultToken();
      assert.throws(() => mod.parsePlan({ ...manual, OMF_NAVI_AGENT_MODEL_CONNECTED_OAUTH: token, OMF_NAVI_AGENT_MODEL_CONFIG_DIR: 'relative-profile' }), /plan:vault-auth-config-directory-invalid/, 'auth:vault-plan-validation');
      const plan = mod.parsePlan({ ...manual, OMF_NAVI_AGENT_MODEL_CONNECTED_OAUTH: token, OMF_NAVI_AGENT_MODEL_AUTH_SLOT: 'contract-slot', OMF_NAVI_AGENT_MODEL_CONFIG_DIR: temporary });
      assert.equal(plan.auth, 'vault', 'auth:vault-plan-validation'); assert.equal(plan.slot, 'contract-slot'); assert.equal(plan.configDirectory, temporary);
      assert.ok(!JSON.stringify(plan).includes(token), 'auth:vault-plan-never-holds-credential');
      for (const mode of ['prepare', 'selftest']) assert.throws(() => mod.parsePlan({ OMF_NAVI_AGENT_MODEL_MODE: mode, OMF_NAVI_AGENT_MODEL_CASES: 'R01', OMF_NAVI_AGENT_MODEL_OUT: out, OMF_NAVI_AGENT_MODEL_AUTH: 'vault', OMF_NAVI_AGENT_MODEL_CONNECTED_OAUTH: token }), /auth-only-in-manual-mode/, 'auth:vault-manual-only');
      assert.throws(() => mod.parsePlan({ ...manual, OMF_NAVI_AGENT_MODEL_AUTH: 'overlay-or-vault' }), /plan:auth-/, 'auth:vault-plan-validation');
      // The existing connected option is unchanged: it still requires its configuration directory.
      assert.throws(() => mod.parsePlan({ ...manual, OMF_NAVI_AGENT_MODEL_AUTH: 'connected', OMF_NAVI_AGENT_MODEL_CONNECTED_OAUTH: token }), /plan:connected-auth-config-directory-required/, 'auth:connected-unchanged');
      assert.equal(mod.parsePlan({ ...manual, OMF_NAVI_AGENT_MODEL_AUTH: 'connected', OMF_NAVI_AGENT_MODEL_CONNECTED_OAUTH: token, OMF_NAVI_AGENT_MODEL_CONFIG_DIR: temporary }).auth, 'connected', 'auth:connected-unchanged');
      await assert.rejects(fs.access(out));
    };
    await run('auth:vault-plan-validation-manual-only-never-echoed', () => planExercise(runnerModule));
    const takeExercise = async mod => {
      const name = 'OMF_NAVI_AGENT_MODEL_CONNECTED_OAUTH', token = vaultToken(), saved = process.env[name];
      try {
        const env = { [name]: token }; process.env[name] = token;
        const taken = mod.takeNativeCredential(env, { mode: 'manual', auth: 'vault', slot: 'contract-slot', configDirectory: null });
        assert.equal(taken?.token, token, 'auth:vault-credential-taken-before-any-child'); assert.equal(taken.mode, 'vault');
        assert.ok(!Object.hasOwn(env, name) && process.env[name] === undefined && !Object.values(process.env).includes(token), 'auth:vault-credential-taken-before-any-child');
        const record = mod.authRecord({ mode: 'manual', auth: 'vault' }, null, taken);
        assert.equal(record.source, 'owned-vault-native-credential', 'auth:vault-batch-record'); assert.equal(record.observerOverlay, false, 'auth:vault-batch-record'); assert.equal(record.slot, 'contract-slot', 'auth:vault-batch-record');
        assert.ok(!JSON.stringify(record).includes(token), 'auth:vault-batch-record-never-holds-credential');
        assert.deepEqual(mod.authRecord({ mode: 'manual', auth: 'connected' }, { token, slot: 's', configDirectory: 'C:/synthetic' }, null), { source: 'connected-resource-overlay', slot: 's', configDirectory: 'C:/synthetic', oneKeyOverlay: 'CLAUDE_CODE_OAUTH_TOKEN on the exact matched native CLI spawn only' }, 'auth:connected-unchanged');
        assert.deepEqual(mod.authRecord({ mode: 'manual', auth: 'default' }, null, null), { source: 'unchanged-default-native-login' }, 'auth:default-unchanged');
        const untouched = { [name]: token }; assert.equal(mod.takeNativeCredential(untouched, { mode: 'manual', auth: 'default' }), null); assert.equal(untouched[name], token, 'auth:default-unchanged');
      } finally { if (saved === undefined) delete process.env[name]; else process.env[name] = saved; }
    };
    await run('auth:vault-credential-taken-before-any-child-and-batch-record', () => takeExercise(runnerModule));
    // The actual TeachingWorker.cycle() through startManualWorker: owned DPAPI Vault, a loopback stand-in for the OMF worker API, the
    // spawn observer of the corpus and, beneath it, the owned stand-in child for the configured CLI path. No model or provider.
    const vaultHandoffExercise = async (mod, sourceCredential = null) => {
      const { Vault } = await import(pathToFileURL(path.join(root, 'collector/vault.mjs')).href);
      const token = sourceCredential?.token || vaultToken(), agentToken = 'omft_' + createHash('sha256').update(randomUUID()).digest('hex');
      const dir = await fs.mkdtemp(path.join(temporary, 'vault-handoff-')), vaultDir = path.join(dir, 'vault'), inference = path.join(dir, 'inference'), records = path.join(dir, 'records');
      for (const d of [vaultDir, inference]) await fs.mkdir(d);
      const cli = path.join(dir, 'native-cli-standin.exe'), standin = path.join(dir, 'standin.cjs'); await fs.writeFile(cli, ''); await fs.writeFile(standin, VAULT_STANDIN);
      const id = '0123456789abcdef01234567', job = { id, mode: 'workspace', lease: 'synthetic-vault-lease', text: '保管庫 경로', context: { mode: 'workspace', pageName: 'Synthetic', facts: {}, capabilities: [], messages: [] }, tools: [{ name: 'get_draft', description: 'Synthetic', inputSchema: { type: 'object', properties: {} } }], nextSlot: 1 };
      const seen = { auth: new Set(), bodies: [], result: null }; let claimed = false;
      const server = http.createServer((req, res) => { const c = []; req.on('data', b => c.push(b)); req.on('end', () => { const body = Buffer.concat(c).toString('utf8'); seen.auth.add(req.headers.authorization); seen.bodies.push(body); const route = req.url.replace('/api/finance-chat/worker/', ''); let answer = {}; if (route === 'workspace-claim') { answer = { job: claimed ? null : job }; claimed = true; } else if (route === 'claim') answer = { job: null }; else if (route === 'workspace/' + id + '/result') { seen.result = JSON.parse(body); answer = { success: true }; } res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(JSON.stringify(answer)); }); });
      await new Promise(r => server.listen(0, '127.0.0.1', r));
      const below = cp.spawn;
      cp.spawn = function (file, args, options) { return file === cli ? below.call(this, node, [standin, records, ...args], options) : below.apply(this, arguments); };
      (await import('node:module')).syncBuiltinESMExports();
      let started = null;
      try {
        started = await mod.startManualWorker({ root, cli, connected: null, vaultAuth: { token, slot: 'contract-slot', configDirectory: null }, agentToken, origin: 'http://127.0.0.1:' + server.address().port, vaultDir, inferenceDirectory: inference, secretValues: () => [agentToken, token], log: () => {} });
        const { spawnObserver, worker } = started;
        spawnObserver.setCase({ caseId: 'VAULT', attemptId: 'vault', transport: 'default-json' });
        assert.equal(await worker.cycle(), true, 'auth:vault-setup-cycle-handled');
        assert.equal(spawnObserver.processes.length, 1, 'auth:vault-setup-one-native-process');
        const p = spawnObserver.processes[0];
        assert.equal(p.auth?.overlay, false, 'auth:vault-no-observer-overlay'); assert.equal(p.optionsIdentityPreserved, true, 'auth:vault-no-observer-overlay');
        assert.ok(p.envKeys.includes(AUTH_KEY), 'auth:vault-child-receives-credential');
        const files = await fs.readdir(records); assert.equal(files.length, 1, 'auth:vault-setup-one-native-process');
        const r = JSON.parse(await fs.readFile(path.join(records, files[0]), 'utf8'));
        assert.equal(r.authSha, sha(token), 'auth:vault-child-receives-credential');
        assert.equal(r.argsHaveToken || r.inputHasToken, false, 'auth:vault-credential-not-in-arguments-or-input');
        assert.equal(r.servers.length, 1, 'auth:vault-setup-mcp'); assert.equal(r.servers[0].envAuth, 'blank', 'auth:vault-mcp-blank'); assert.notEqual(r.servers[0].probe?.sha, sha(token), 'auth:vault-mcp-blank');
        assert.equal(seen.result?.proposal?.summary, '保管庫 테스트', 'auth:vault-setup-result');
        assert.deepEqual([...seen.auth], ['Bearer ' + agentToken], 'auth:vault-server-bearer-distinct'); assert.ok(!seen.bodies.some(b => b.includes(token)), 'auth:vault-credential-never-sent-to-omf');
        assert.ok(!JSON.stringify(spawnObserver.processes).includes(token) && !JSON.stringify(worker.lines).includes(token), 'auth:vault-credential-never-retained');
        const raw = await fs.readFile(path.join(vaultDir, 'credentials.dpapi')); assert.ok(!raw.includes(Buffer.from(token)) && !raw.includes(Buffer.from(token, 'utf16le')), 'auth:vault-owned-vault-encrypted');
        const stored = await new Vault(vaultDir).read(); assert.equal(stored.nativeOAuthToken, token, 'auth:vault-owned-vault'); assert.equal(stored.token, agentToken, 'auth:vault-owned-vault'); assert.equal(stored.cliPath, cli, 'auth:vault-owned-vault');
      } finally { try { started?.spawnObserver?.restore(); } catch {} cp.spawn = below; (await import('node:module')).syncBuiltinESMExports(); await new Promise(r => server.close(r)); }
      assert.equal(cp.spawn, below, 'auth:vault-spawn-restored');
    };
    await run('auth:vault-owned-worker-handoff-real-child-no-observer-overlay', () => vaultHandoffExercise(runnerModule));

    // Path-only input survives the normal hub verifier bootstrap without carrying a native token in any ancestor environment.
    // The source is an actual owned DPAPI Vault; only its nativeOAuthToken is eligible for the owned worker configuration.
    const sourceVaultExercise = async (mod, handoff = false) => {
      const { Vault } = await import(pathToFileURL(path.join(root, 'collector/vault.mjs')).href);
      const sourceDir = await fs.mkdtemp(path.join(temporary, 'credential-source-')), source = new Vault(sourceDir), token = vaultToken();
      await source.update(() => ({ nativeOAuthToken: token, token: 'different-source-server-bearer-' + randomUUID(), cliPath: 'untrusted-source-executable', baseUrl: 'https://source-must-not-be-used.invalid', enabled: false }));
      const before = await fs.readFile(source.file), frozen = path.join(sourceDir, 'frozen-placeholder.json'); await fs.writeFile(frozen, '{}');
      const out = path.join(sourceDir, 'no-runtime-started'), env = { OMF_NAVI_AGENT_MODEL_MODE: 'manual', OMF_NAVI_AGENT_MODEL_CASES: 'R01', OMF_NAVI_AGENT_MODEL_OUT: out, OMF_NAVI_AGENT_MODEL_BATCH: 'source-vault', OMF_NAVI_AGENT_MODEL_AUTH: 'vault', OMF_NAVI_AGENT_MODEL_CLI: node, OMF_NAVI_AGENT_MODEL_FROZEN: frozen, OMF_NAVI_AGENT_MODEL_AUTH_VAULT: sourceDir, OMF_NAVI_AGENT_MODEL_AUTH_SLOT: 'source-slot' };
      let plan; assert.doesNotThrow(() => { plan = mod.parsePlan(env); }, 'auth:source-vault-path-accepted');
      assert.equal(plan.sourceVaultDirectory, sourceDir, 'auth:source-vault-path-accepted');
      assert.ok(!JSON.stringify(plan).includes(token) && !Object.values(env).some(v => String(v).includes(token)) && !Object.values(process.env).includes(token), 'auth:source-vault-no-environment-token');
      const taken = mod.takeNativeCredential(env, plan);
      assert.equal(taken.sourceVaultDirectory, sourceDir, 'auth:source-vault-descriptor'); assert.equal(taken.token, undefined, 'auth:source-vault-no-environment-token');
      const credential = await mod.resolveNativeCredential(taken, root);
      assert.deepEqual(credential, { mode: 'vault', token, slot: 'source-slot', configDirectory: null }, 'auth:source-vault-native-token-only');
      assert.ok(!before.includes(Buffer.from(token)) && !before.includes(Buffer.from(token, 'utf16le')), 'auth:source-vault-encrypted');
      assert.deepEqual(await fs.readFile(source.file), before, 'auth:source-vault-read-only');
      assert.throws(() => mod.parsePlan({ ...env, OMF_NAVI_AGENT_MODEL_CONNECTED_OAUTH: token }), e => /plan:vault-auth-source-conflict/.test(e.message) && !e.message.includes(token), 'auth:source-vault-conflict');
      for (const invalid of ['relative-source', path.join(sourceDir, 'absent'), frozen]) assert.throws(() => mod.parsePlan({ ...env, OMF_NAVI_AGENT_MODEL_AUTH_VAULT: invalid }), /plan:vault-auth-source-directory-invalid/, 'auth:source-vault-invalid-directory');
      for (const auth of ['default', 'connected']) assert.throws(() => mod.parsePlan({ ...env, OMF_NAVI_AGENT_MODEL_AUTH: auth }), /plan:vault-auth-source-mode/, 'auth:source-vault-explicit-mode');
      assert.equal(await mod.resolveNativeCredential(null, root), null, 'auth:source-vault-default-unchanged');
      const legacy = { mode: 'connected', token, slot: null, configDirectory: null }; assert.equal(await mod.resolveNativeCredential(legacy, root), legacy, 'auth:source-vault-connected-unchanged');
      if (handoff) await vaultHandoffExercise(mod, credential);
      const badDir = await fs.mkdtemp(path.join(temporary, 'invalid-credential-source-')), bad = new Vault(badDir);
      await bad.update(() => ({ nativeOAuthToken: 'bad token ' + token, token }));
      const descriptor = { ...taken, sourceVaultDirectory: badDir };
      await assert.rejects(mod.resolveNativeCredential(descriptor, root), e => /plan:vault-auth-source-token-invalid/.test(e.message) && !e.message.includes(token), 'auth:source-vault-invalid-token');
      await assert.rejects(mod.runCorpusFromEnvironment({ ...env, OMF_NAVI_AGENT_MODEL_AUTH_VAULT: badDir }, { root, log: () => {} }), /plan:vault-auth-source-token-invalid/, 'auth:source-vault-fails-before-runtime');
      await assert.rejects(fs.access(out), 'auth:source-vault-no-runtime-directory');
      await fs.writeFile(bad.file, 'synthetic-not-DPAPI');
      await assert.rejects(mod.resolveNativeCredential(descriptor, root), /plan:vault-auth-source-unavailable/, 'auth:source-vault-safe-decrypt-error');
    };
    await run('auth:path-only-source-vault-real-DPAPI-and-native-handoff', () => sourceVaultExercise(runnerModule, true));

    // ---- The actual product interpreter seam: node stands in for the CLI and exits on its first unknown option (no network).
    await run('seam:actual-interpreter-spawn-observed-unchanged', async () => {
      const ob = installSpawnObserver({ cliPath: node });
      try {
        ob.setCase({ caseId: 'SEAM', attemptId: 'seam', transport: 'default-json' });
        const { interpretChat } = await import(pathToFileURL(path.join(root, 'teaching-worker/interpreter.mjs')).href), { accountantModel, accountantEffort } = await import(pathToFileURL(path.join(root, 'shared/finance-accountant-role.mjs')).href);
        const job = { text: 'contract seam', context: { source: { description: 'synthetic', purchaseDate: '2026-09-01', amount: 1, account: { name: 'synthetic' } }, values: { purpose: 'unresolved', customerId: '', productName: '' }, mapping: null, study: null, research: null, customers: [], messages: [] } };
        await assert.rejects(interpretChat({ cliPath: node, inferenceDirectory: temporary }, job), /Teaching interpreter failed/);
        const p = ob.processes[0]; assert.equal(ob.processes.length, 1); assert.equal(p.optionsIdentityPreserved, true); assert.equal(p.argsIdentityPreserved, true); assert.equal(p.exitCode, 9);
        const flag = f => p.args.find(x => x[0] === f)?.[1]; assert.equal(flag('--model'), accountantModel); assert.equal(flag('--effort'), accountantEffort); assert.equal(flag('--output-format'), 'json');
        const allowed = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'APPDATA', 'PROGRAMDATA', 'ComSpec', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'];
        assert.ok(p.envKeys.every(k => allowed.includes(k)) && p.envKeys.includes('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC') && !p.envKeys.includes(AUTH_KEY), JSON.stringify(p.envKeys));
        assert.ok(p.stdin.bytes > 0);
      } finally { ob.restore(); }
      assert.equal(cp.spawn, originalSpawn);
    });

    // ---- Owned loopback HTTP observer
    await run('http:forwards-bytes-and-headers-records-whitelist-only', async () => {
      const seen = []; const upstream = http.createServer((req, res) => { const c = []; req.on('data', b => c.push(b)); req.on('end', () => { seen.push({ url: req.url, auth: req.headers.authorization, body: Buffer.concat(c).toString('utf8') }); res.writeHead(200, { 'content-type': 'application/json' }); if (req.url.endsWith('/actions')) res.end(JSON.stringify({ name: 'get_company_transaction', effect: 'read', receipt: { operationId: 'f'.repeat(32), name: 'x', state: 'done', nativeResourceIds: { transactionId: 'a'.repeat(24) }, lease: 'LEASE_SECRET' }, result: { transaction: { id: 'a'.repeat(24), productName: '合成 RECORD_MARKER' } } })); else if (req.url.endsWith('workspace-claim')) res.end(JSON.stringify({ job: { id: 'b'.repeat(24), mode: 'workspace', companyScoped: true, lease: 'LEASE_SECRET', text: 'x', tools: [{ name: 'get_company_transaction' }], context: { page: 'transactions', facts: { selection: { page: 'transactions' } }, messages: [] }, actions: [], publicResearch: { version: 1, webSearch: true, publicPage: true, chrome: true, registry: 'connection_required', today: '2026-10-24', lease: 'LEASE_SECRET' } } })); else res.end('{}'); }); });
      await new Promise(r => upstream.listen(0, '127.0.0.1', r));
      const ob = await openHttpObserver('http://127.0.0.1:' + upstream.address().port);
      try {
        ob.setCase('CONTRACT.http');
        const body = JSON.stringify({ lease: 'LEASE_SECRET', slot: 1, name: 'get_company_transaction', args: { transactionId: 'a'.repeat(24) } });
        const r = await fetch(ob.origin + '/api/finance-chat/worker/workspace/' + 'b'.repeat(24) + '/actions', { method: 'POST', headers: { Authorization: 'Bearer omft_' + 'c'.repeat(64), 'Content-Type': 'application/json' }, body });
        const text = await r.text(); assert.equal(r.status, 200); assert.ok(text.includes('合成 RECORD_MARKER'));
        await fetch(ob.origin + '/api/finance-chat/worker/workspace-claim', { method: 'POST', headers: { Authorization: 'Bearer omft_' + 'c'.repeat(64), 'Content-Type': 'application/json' }, body: JSON.stringify({ capabilities: { publicResearch: { version: 1, webSearch: true, publicPage: true, chrome: true, registry: 'connection_required' } } }) }).then(x => x.text());
        assert.equal(seen[0].body, body); assert.equal(seen[0].auth, 'Bearer omft_' + 'c'.repeat(64));
        const recorded = JSON.stringify(ob.events); assert.ok(!recorded.includes('LEASE_SECRET') && !recorded.includes('omft_') && !recorded.includes('Bearer'), 'secret recorded');
        // The forwarded lease and bearer token are known in memory (for withholding and artifact scans), never in the events.
        assert.ok(ob.secretValues().includes('LEASE_SECRET') && ob.secretValues().includes('omft_' + 'c'.repeat(64)), 'evidence:observed-secrets-known-in-memory');
        const action = ob.events.find(e => e.kind === 'action'); assert.equal(action.tool, 'get_company_transaction'); assert.equal(action.status, 200); assert.equal(action.caseId, 'CONTRACT.http'); assert.ok(action.responseText.includes('RECORD_MARKER')); assert.equal(action.receipt.state, 'done');
        const claim = ob.events.find(e => e.kind === 'claim'); assert.deepEqual(claim.job.toolNames, ['get_company_transaction']); assert.equal(claim.job.publicResearch.chrome, true); assert.equal(claim.reportedCapability.webSearch, true);
        assert.deepEqual(cases.observedCalls(ob.events, ['get_company_transaction'], { includes: ['RECORD_MARKER'] }).length, 1);
      } finally { await ob.close(); await new Promise(r => upstream.close(r)); }
    });
    await run('http:upstream-failure-is-a-connection-failure-never-a-status', async () => {
      const s = http.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r));
      const ob = await openHttpObserver('http://127.0.0.1:' + port);
      try { await assert.rejects(fetch(ob.origin + '/api/finance-chat/worker/heartbeat', { method: 'POST', body: '{}' })); assert.equal(ob.events[0].kind, 'upstream_error'); } finally { await ob.close(); }
      assert.deepEqual(redact({ a: 1, lease: 'x', nested: { Authorization: 'y', token: 'z', keep: [{ refreshToken: 'r', ok: true }] } }), { a: 1, nested: { keep: [{ ok: true }] } });
    });

    // ---- Grade contracts on synthetic Mongo-shaped evidence
    const oid = hex => ({ _bsontype: 'ObjectId', toHexString: () => hex });
    const snap = docs => ({ transactions: Object.fromEntries(docs.map(d => [d._id.toHexString(), cases.canonicalJson(cases.plainDocument(d))])) });
    const row = (amount, extra = {}) => ({ _id: oid('a'.repeat(24)), organizationId: oid('b'.repeat(24)), amount, date: new Date('2026-09-22T03:00:00Z'), ...extra });
    const gradeContract = mod => {
      const unchanged = mod.diffSnapshots(snap([row(800)]), snap([row(800)])), written = mod.diffSnapshots(snap([row(800)]), snap([row(900)]));
      assert.equal(mod.gradeNoBusinessWrite(unchanged).pass, true, 'grade:no-write-accepts-unchanged');
      assert.equal(mod.gradeNoBusinessWrite(written).pass, false, 'grade:no-business-write-detects-write');
      assert.equal(mod.gradeEffects(written, {})[0].pass, false, 'grade:effects-detects-undeclared-write');
      assert.equal(mod.gradeEffects(written, { transactions: { changed: { ['a'.repeat(24)]: ['amount'] } } })[0].pass, true, 'grade:effects-accepts-declared-field');
      assert.equal(mod.gradeEffects(written, { transactions: { changed: { ['a'.repeat(24)]: ['notes'] } } })[0].pass, false, 'grade:effects-detects-other-field');
      const added = mod.diffSnapshots(snap([row(800)]), snap([row(800), { ...row(800), _id: oid('c'.repeat(24)) }]));
      assert.equal(mod.gradeEffects(added, { transactions: { added: 1 } })[0].pass, true); assert.equal(mod.gradeEffects(added, { transactions: { added: 2 } })[0].pass, false, 'grade:effects-counts-exactly');
    };
    await run('grade:no-write-and-effect-oracles', () => gradeContract(cases));

    // ---- Evidence, format and outcome contracts (2026-10-24 continuation). Pure helpers plus a real child; still no app/model.
    const formatContract = mod => {
      const t = text => mod.publishedTNumbers(text);
      assert.deepEqual(t('適格請求書発行事業者登録番号：T8010401087388'), ['T8010401087388'], 'format:published-t-number-plain');
      assert.deepEqual(t('登録番号 T 8010 4010 8738 8 です'), ['T8010401087388'], 'format:published-t-number-display-whitespace');
      assert.deepEqual(t('T 8010401087388\nT　8010401087389'), ['T8010401087388', 'T8010401087389'], 'format:published-t-number-display-whitespace');
      assert.deepEqual(t('登録番号：T8010401087388\n2023/10/01 登録'), ['T8010401087388'], 'format:published-t-number-plain');
      assert.deepEqual(t('法人番号 8010401087388'), [], 'format:bare-corporation-number-rejected');
      for (const bad of ['T80104010873881', 'T801040108738', 'T8010401\u0001087388', 'T8010​401087388', 'XT8010401087388', 'T8010401087388X', '1T8010401087388', 'T8010-4010-87388']) assert.deepEqual(t(bad), [], 'format:malformed-identifier-rejected ' + JSON.stringify(bad));
      // Full-width forms are not display whitespace: not recognized here (the retained source text stays available to the grader).
      assert.deepEqual(t('Ｔ８０１０４０１０８７３８８'), [], 'format:full-width-form-not-recognized');
      // A horizontally spaced longer identifier is never truncated to 13 digits (parent counterexample 2026-10-24); a separate next line stays legitimate.
      for (const longer of ['T 1 2 3 4 5 6 7 8 9 0 1 2 3 4', 'T 8010 4010 8738 8 1', 'T8010401087388\t9']) assert.deepEqual(t(longer), [], 'format:spaced-longer-identifier-rejected ' + JSON.stringify(longer));
      assert.deepEqual(t('T 8010 4010 8738 8\n2023/10/01 登録'), ['T8010401087388'], 'format:published-t-number-next-line-date');
    };
    await run('format:published-t-number-positive-and-negative', () => formatContract(cases));
    const quoteContract = async mod => {
      const text = 'Tesla Japan  合同会社\n\t登録番号 T8010401087388\n住所 東京都', sources = [{ id: 'a'.repeat(24), status: 'captured', text }, { id: 'b'.repeat(24), status: 'failed', text: 'Tesla Japan 合同会社' }];
      const ok = quote => mod.citationsResolve([{ sourceId: 'a'.repeat(24), quote, claim: 'c' }], sources).pass;
      assert.equal(ok('Tesla Japan 合同会社 登録番号 T8010401087388'), true, 'grade:native-whitespace-quote-accepted');
      assert.equal(ok('Tesla Japan 合同会社 登録番号 T8010401087389'), false, 'grade:altered-quote-rejected');
      assert.equal(ok('   '), false, 'grade:empty-quote-rejected');
      assert.equal(mod.citationsResolve([{ sourceId: 'b'.repeat(24), quote: 'Tesla Japan 合同会社', claim: 'c' }], sources).pass, false, 'grade:failed-capture-not-a-source');
      assert.equal(mod.citationsResolve([{ sourceId: 'c'.repeat(24), quote: 'Tesla Japan', claim: 'c' }], sources).pass, false, 'grade:uncaptured-source-rejected');
      assert.equal(mod.citationsResolve([], sources).pass, false, 'grade:no-citation-no-pass');
      const { literalQuoteIn } = await import(pathToFileURL(path.join(root, 'shared/finance-company-public-research.mjs')).href);
      assert.equal(literalQuoteIn(text, 'Tesla Japan 合同会社 登録番号 T8010401087388'), true, 'grade:native-contract-agrees');
    };
    await run('grade:native-whitespace-citations', async () => quoteContract(await import('./finance-navi-agent-model-company-cases.mjs')));
    const retentionContract = mod => {
      const text = '会社概要\nTesla Japan 合同会社 T8010401087388', doc = { _id: oid('d'.repeat(24)), kind: 'chrome', status: 'captured', url: 'https://example.com/', requestedUrl: 'https://example.com/', title: 't', text, hash: sha(text), chars: text.length, truncated: false, capturedAt: new Date('2026-10-24T00:00:00Z'), evidence: 'published_page' };
      const r = mod.retainedSource(doc);
      assert.equal(r.text, text, 'evidence:source-text-retained'); assert.equal(r.textSha256, sha(text), 'evidence:source-hash-recomputed'); assert.equal(r.hashMatches, true, 'evidence:source-hash-recomputed'); assert.equal(r.id, 'd'.repeat(24));
      assert.equal(mod.retainedSource({ ...doc, hash: 'e'.repeat(64) }).hashMatches, false, 'evidence:source-hash-mismatch-visible');
      const failed = mod.retainedSource({ _id: oid('f'.repeat(24)), kind: 'web', status: 'failed', requestedUrl: 'https://example.com/x', safeError: 'refused', capturedAt: new Date('2026-10-24T00:00:00Z') });
      assert.equal(failed.status, 'failed'); assert.equal(failed.text, null); assert.equal(failed.hashMatches, null, 'evidence:failed-capture-kept-as-activity'); assert.equal(failed.safeError, 'refused');
      const before = { transactions: { ['a'.repeat(24)]: cases.canonicalJson({ _id: 'a'.repeat(24), amount: 800 }), ['b'.repeat(24)]: cases.canonicalJson({ _id: 'b'.repeat(24), amount: 5 }) } };
      const after = { transactions: { ['a'.repeat(24)]: cases.canonicalJson({ _id: 'a'.repeat(24), amount: 900 }), ['c'.repeat(24)]: cases.canonicalJson({ _id: 'c'.repeat(24), amount: 7 }), ['b'.repeat(24)]: cases.canonicalJson({ _id: 'b'.repeat(24), amount: 5 }) } };
      const kept = mod.retainedDocuments(before, after, mod.diffSnapshots(before, after), [['transactions', 'b'.repeat(24)]]);
      assert.deepEqual(kept.transactions['a'.repeat(24)], { before: { _id: 'a'.repeat(24), amount: 800 }, after: { _id: 'a'.repeat(24), amount: 900 }, change: 'changed' }, 'evidence:affected-documents-retained');
      assert.deepEqual(kept.transactions['c'.repeat(24)], { before: null, after: { _id: 'c'.repeat(24), amount: 7 }, change: 'added' }, 'evidence:affected-documents-retained');
      assert.deepEqual(kept.transactions['b'.repeat(24)], { before: { _id: 'b'.repeat(24), amount: 5 }, after: { _id: 'b'.repeat(24), amount: 5 }, change: 'selected-unchanged' }, 'evidence:selected-documents-retained');
    };
    await run('evidence:source-text-hash-and-affected-documents-retained', () => retentionContract(cases));
    const outcomeContract = mod => {
      const cleanup = { 'http-observer': 'ok', app: 'ok', 'mongo-client': 'ok', mongod: 'ok', 'temp-directory': 'ok' };
      const base = { fatal: null, attempts: [{ status: 'deterministic-pass' }], expected: 'deterministic-pass', selected: 1, cleanup, secretFindings: 0 };
      assert.equal(mod.overallPass(base), true, 'grade:overall-true-only-when-everything-held');
      assert.equal(mod.overallPass({ ...base, cleanup: { ...cleanup, mongod: 'failed: still running' } }), false, 'grade:overall-false-after-cleanup-failure');
      assert.equal(mod.overallPass({ ...base, secretFindings: 1 }), false, 'grade:overall-false-after-secret-finding');
      assert.equal(mod.overallPass({ ...base, fatal: 'x' }), false); assert.equal(mod.overallPass({ ...base, attempts: [] }), false); assert.equal(mod.overallPass({ ...base, attempts: [{ status: 'harness-failure' }] }), false);
      // Removed or partial cleanup evidence is never a pass (parent counterexample 2026-10-24: null and {} were accepted).
      for (const missing of [null, undefined, {}, { app: 'ok', mongod: 'ok' }]) assert.equal(mod.overallPass({ ...base, cleanup: missing }), false, 'grade:overall-false-without-cleanup-evidence ' + JSON.stringify(missing ?? null));
      assert.equal(mod.overallPass({ ...base, secretFindings: undefined }), false, 'grade:overall-false-without-secret-scan');
    };
    await run('grade:overall-outcome-includes-cleanup-and-secret-scan', () => outcomeContract(cases));
    // Real child: the exact native input bytes are retained (not a reparsed copy); a known secret marker withholds the raw text.
    const nativeInputExercise = async mod => {
      const marker = 'SYNTHETIC_LEASE_MARKER_' + randomUUID(), ob = mod.installSpawnObserver({ cliPath: node, secretValues: () => [marker] });
      const raw = '{"mode" : "workspace",  "currentMessage": "契約テスト 메시지", "evidence": {"synthetic": true}}';
      const run1 = (text, attemptId) => new Promise((resolve, reject) => { ob.setCase({ caseId: 'CONTRACT', attemptId, transport: 'default-json' }); const c = esmSpawn(node, argv('json-ok'), options()); c.stdout.setEncoding('utf8'); c.stdout.on('data', () => {}); c.stderr.resume(); c.once('error', reject); c.once('close', () => resolve(ob.processes.find(p => p.attemptId === attemptId))); c.stdin.end(text); });
      try {
        const kept = await run1(raw, 'input-exact');
        assert.equal(kept.nativeInput?.exact, true, 'evidence:native-input-exact'); assert.equal(kept.nativeInput.text, raw, 'evidence:native-input-exact'); assert.equal(kept.stdin.sha256, sha(Buffer.from(raw)), 'evidence:native-input-exact');
        const secret = await run1(raw.replace('契約テスト', marker), 'input-secret');
        assert.equal(secret.nativeInput?.exact, false, 'evidence:native-input-secret-withheld'); assert.equal(secret.nativeInput.withheld, true, 'evidence:native-input-secret-withheld'); assert.ok(!JSON.stringify(ob.processes).includes(marker), 'evidence:native-input-secret-withheld');
      } finally { ob.restore(); }
    };
    await run('evidence:native-input-exact-and-secret-withheld-real-child', () => nativeInputExercise({ installSpawnObserver }));
    await run('evidence:redaction-fail-closed-beyond-depth', () => {
      let deep = { lease: 'DEEP_LEASE_SECRET', keep: 'value' }; for (let i = 0; i < 16; i++) deep = { level: i, nested: deep, token: 'TOKEN_' + i };
      const out = JSON.stringify(redact(deep)); assert.ok(!out.includes('DEEP_LEASE_SECRET') && !/TOKEN_\d/.test(out), 'evidence:redaction-fail-closed-beyond-depth'); assert.ok(out.includes('[REDACTED:depth]'), 'evidence:redaction-fail-closed-beyond-depth');
    });

    // ---- Deliberate defects in owned copies: each must flip its named assertion. A copy's relative imports are rewritten to the
    // actual worktree modules, so a copied module runs against the real code around it.
    const defect = async (name, file, anchor, replacement, exercise, assertion) => {
      const source = await fs.readFile(path.join(here, file), 'utf8');
      if (source.split(anchor).length !== 2) throw Error('defect anchor must occur once: ' + name);
      const absolute = text => text.replace(/from '(\.\.?\/[^']+)'/g, (m, rel) => "from '" + pathToFileURL(path.resolve(here, rel)).href + "'");
      const dir = await fs.mkdtemp(path.join(temporary, 'defect-')), copy = path.join(dir, file); await fs.writeFile(copy, absolute(source.replace(anchor, replacement)));
      let detected = false, message = null;
      try { await exercise(await import(pathToFileURL(copy).href + '?' + randomUUID())); } catch (e) { message = String(e?.message || e); detected = e?.code === 'ERR_ASSERTION' && message.includes(assertion); } finally { try { cp.spawn = originalSpawn; (await import('node:module')).syncBuiltinESMExports(); } catch {} }
      deliberateDefects.push({ name, assertion, detected, message: message ? message.slice(0, 200) : 'not detected' });
      if (!detected) throw Error('deliberate defect ' + name + ' was not caught by ' + assertion);
    };
    await run('defect:reserialized-forwarding-flips-exact-byte-assertion', () => defect('reserialized-final-forwarding', 'finance-navi-agent-model-observer.mjs', 'const forwardedPayload = nativePayload;', 'const forwardedPayload = JSON.stringify(this.final.value);', async mod => {
      const ob = mod.installSpawnObserver({ cliPath: node });
      try { ob.setCase({ caseId: 'P01', attemptId: 'defect', transport: 'stream-json' }); const r = await interpreterShaped(esmSpawn, node, argv('stream-ok'), options(), input); assert.equal(r.raw, FINAL_PAYLOAD, 'observer:exact-native-forwarding'); } finally { ob.restore(); }
    }, 'observer:exact-native-forwarding'));
    await run('defect:inverted-no-write-grade-flips-named-assertion', () => defect('inverted-no-write-grade', 'finance-navi-agent-model-cases.mjs', "pass: changed.length === 0, detail: changed.length ? 'changed: '", "pass: changed.length !== 0, detail: changed.length ? 'changed: '", gradeContract, 'grade:no-write-accepts-unchanged'));
    await run('defect:reserialized-native-input-flips-exact-input-assertion', () => defect('reserialized-native-input', 'finance-navi-agent-model-observer.mjs', ': { exact: true, text };', ': { exact: true, text: JSON.stringify(JSON.parse(text)) };', nativeInputExercise, 'evidence:native-input-exact'));
    await run('defect:dropped-source-text-flips-retention-assertion', () => defect('dropped-source-text', 'finance-navi-agent-model-cases.mjs', "text: typeof doc?.text === 'string' ? doc.text : null,", 'text: null,', retentionContract, 'evidence:source-text-retained'));
    await run('defect:strict-quote-predicate-flips-native-whitespace-assertion', () => defect('strict-raw-includes-quote', 'finance-navi-agent-model-company-cases.mjs', "literalQuoteIn(String(source.text || ''), String(c.quote || ''))", "String(source.text || '').includes(String(c.quote || ''))", quoteContract, 'grade:native-whitespace-quote-accepted'));
    await run('defect:optional-t-prefix-flips-bare-number-assertion', () => defect('optional-t-prefix', 'finance-navi-agent-model-cases.mjs', '(?<![0-9A-Za-z])T((?:', '(?<![0-9A-Za-z])T?((?:', formatContract, 'format:bare-corporation-number-rejected'));
    await run('defect:ignored-cleanup-flips-overall-assertion', () => defect('cleanup-ignored-in-overall-pass', 'finance-navi-agent-model-cases.mjs', "const cleanupOk = CLEANUP_STEPS.every(step => cleanup?.[step] === 'ok');", 'const cleanupOk = true;', outcomeContract, 'grade:overall-false-after-cleanup-failure'));
    await run('defect:vacuous-cleanup-evidence-flips-missing-cleanup-assertion', () => defect('vacuous-cleanup-evidence', 'finance-navi-agent-model-cases.mjs', "const cleanupOk = CLEANUP_STEPS.every(step => cleanup?.[step] === 'ok');", "const cleanupOk = Object.values(cleanup || {}).every(v => v === 'ok');", outcomeContract, 'grade:overall-false-without-cleanup-evidence'));
    await run('defect:truncated-spaced-identifier-flips-longer-identifier-assertion', () => defect('spaced-longer-identifier-truncated', 'finance-navi-agent-model-cases.mjs', "(?![0-9A-Za-z])' + NO_SPACED_CONTINUATION, 'g');", "(?![0-9A-Za-z])', 'g');", formatContract, 'format:spaced-longer-identifier-rejected'));
    // Vault auth defects in owned copies of the runner (plan omf-navi-native-auth-followup-20261024); the unmutated runner passes the
    // same exercises above.
    await run('defect:vault-token-overlaid-by-observer-flips-no-overlay-assertion', () => defect('vault-token-overlaid-by-observer', 'finance-navi-agent-model.mjs', 'installSpawnObserver({ cliPath: cli, connectedAuth: connected, secretValues })', 'installSpawnObserver({ cliPath: cli, connectedAuth: connected || vaultAuth, secretValues })', vaultHandoffExercise, 'auth:vault-no-observer-overlay'));
    await run('defect:vault-credential-not-written-flips-child-credential-assertion', () => defect('vault-credential-not-written', 'finance-navi-agent-model.mjs', '...(vaultAuth ? { nativeOAuthToken: vaultAuth.token } : {})', '...({})', vaultHandoffExercise, 'auth:vault-child-receives-credential'));
    await run('defect:vault-token-left-in-environment-flips-taken-assertion', () => defect('vault-token-left-in-environment', 'finance-navi-agent-model.mjs', 'delete env[ENV.token]; delete process.env[ENV.token];', '', takeExercise, 'auth:vault-credential-taken-before-any-child'));
    await run('defect:vault-plan-accepts-invalid-token-flips-validation-assertion', () => defect('vault-plan-accepts-invalid-token', 'finance-navi-agent-model.mjs', "if (!validNativeCliToken(value)) throw Error('plan:vault-auth-token-invalid');", '', planExercise, 'auth:vault-plan-validation'));
    await run('defect:source-vault-reads-server-token', () => defect('source-vault-reads-server-token', 'finance-navi-agent-model.mjs', 'const value = saved?.nativeOAuthToken;', 'const value = saved?.token;', sourceVaultExercise, 'auth:source-vault-native-token-only'));
    await run('defect:source-vault-accepts-invalid-native-token', () => defect('source-vault-accepts-invalid-native-token', 'finance-navi-agent-model.mjs', "if (!validNativeCliToken(value)) throw Error('plan:vault-auth-source-token-invalid');", '', sourceVaultExercise, 'auth:source-vault-invalid-token'));
    // The unmutated observer passes the same exact-byte exercise (control for the defect above).
    await run('defect-control:unmutated-forwarding-passes', async () => { const ob = installSpawnObserver({ cliPath: node }); try { ob.setCase({ caseId: 'P01', attemptId: 'control', transport: 'stream-json' }); const r = await interpreterShaped(esmSpawn, node, argv('stream-ok'), options(), input); assert.equal(r.raw, FINAL_PAYLOAD, 'observer:exact-native-forwarding'); } finally { ob.restore(); } });
    await run('stream-parser:split-utf8-bound-and-invalid-input', () => {
      const p = new NativeStreamObserver(), bytes = Buffer.from(FINAL_PAYLOAD + '\n'); for (let i = 0; i < bytes.length; i++) p.push(bytes.subarray(i, i + 1)); assert.equal(p.finish().forwardedPayload, FINAL_PAYLOAD);
      assert.throws(() => new NativeStreamObserver().push(Buffer.from([0xff]))); assert.throws(() => new NativeStreamObserver({ maxLineBytes: 16 }).push(Buffer.from('x'.repeat(17))), /line bound/);
      const u = new NativeStreamObserver(); u.push(Buffer.from(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'server_tool_use', name: 'web_search', input: { queries: ['x'] } }] } }) + '\n' + FINAL_PAYLOAD)); assert.equal(u.finish().events[0].kind, 'unsupported_search_shape');
      assert.throws(() => streamArguments(['--output-format', 'stream-json']), /Expected native JSON output mode/);
    });
  } finally {
    if (cp.spawn !== originalSpawn) { cp.spawn = originalSpawn; (await import('node:module')).syncBuiltinESMExports(); failures.push({ name: 'cleanup:spawn-restored', error: 'a contract left child_process.spawn patched' }); }
    const resolved = await fs.realpath(temporary), base = await fs.realpath(os.tmpdir());
    if (resolved.startsWith(base + path.sep) && path.basename(resolved).startsWith('omf-navi-agent-model-contract-')) await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  const expectedDefects = 15;
  return { pass: failures.length === 0 && deliberateDefects.length === expectedDefects && deliberateDefects.every(d => d.detected), checks, failures, deliberateDefects, limits: 'Transport/manifest/evidence/format/grade contracts only: owned disposable local node children, loopback HTTP to an owned fake upstream and the actual interpreter spawn seam with node as a stand-in executable. No model, provider, application or database call and no EXTERNAL network (local child processes and loopback HTTP only). Fake model names and messages are synthetic; no product-model, query-privacy or reliability claim.' };
}
