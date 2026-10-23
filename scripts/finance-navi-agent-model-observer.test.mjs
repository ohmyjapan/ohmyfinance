// Default contracts of the Navi product-model corpus (scripts/zoomer-fixtures/omf-navi-agent-model.mjs, no mode set).
// Real disposable local node children (an owned fake CLI script in an owned temp directory), a loopback fake upstream, the actual
// product interpreter's spawn seam with node as a stand-in executable (it exits on its first unknown option), pure manifest/grade
// checks and two deliberately seeded defects in owned copies. No model, provider, application, database or network is reached;
// these contracts give transport/manifest/grade evidence only, never product-model, privacy or reliability coverage.
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
        assert.ok(!JSON.stringify(ob.processes).includes('契約テスト'), 'raw stdin retained');
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

    // ---- Deliberate defects in owned copies: each must flip its named assertion.
    const defect = async (name, file, anchor, replacement, exercise, assertion) => {
      const source = await fs.readFile(path.join(here, file), 'utf8');
      if (source.split(anchor).length !== 2) throw Error('defect anchor must occur once: ' + name);
      const dir = await fs.mkdtemp(path.join(temporary, 'defect-')), copy = path.join(dir, file); await fs.writeFile(copy, source.replace(anchor, replacement));
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
  const expectedDefects = 2;
  return { pass: failures.length === 0 && deliberateDefects.length === expectedDefects && deliberateDefects.every(d => d.detected), checks, failures, deliberateDefects, limits: 'Transport/manifest/grade contracts only: owned disposable local node children, a loopback fake upstream and the actual interpreter spawn seam with node as a stand-in executable. No model, provider, application, database or network. Fake model names and messages are synthetic; no product-model, query-privacy or reliability claim.' };
}
