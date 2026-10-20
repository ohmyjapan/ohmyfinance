import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { writeFileSync, readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic executable boundary only: actual interpretChat, actual child process and stdout.
// Each split waits for the receiver's first data event before writing the rest. No timing guess,
// model, credentials, network, action service or financial records are involved.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = path.join(root, 'scripts', 'synthetic-interpreter-marker');
const nativeSpawn = cp.spawn;
let scenario;
const emitter = `
 const s=JSON.parse(require('node:fs').readFileSync(process.argv[1],'utf8'));
 process.stdin.resume();
 if(s.hang) { setInterval(()=>{},1000); }
 else {
  let i=0;
  const next=()=>{
   process.stdout.write(Buffer.from(s.chunks[i++],'base64'));
   if(i===s.chunks.length){process.stdout.end();process.exitCode=s.exit||0;process.disconnect();}
  };
  process.on('message',next);next();
 }
`;
cp.spawn = function(command, args, options) {
 if (command !== marker) return nativeSpawn.apply(this, arguments);
 const s = scenario;
 assert.ok(s, 'Owned scenario must exist');
 s.args = args;
 // The private job file is read while the child exists (it is removed after the child exits).
 try { const configured = JSON.parse(args[args.indexOf('--mcp-config') + 1]); const file = configured.mcpServers?.omf_actions?.env?.OMF_ACTIONS_JOB_FILE; s.jobFile = file ? JSON.parse(readFileSync(file, 'utf8')) : null; } catch { s.jobFile = null; }
 const payloadFile = path.join(directory, 'synthetic-output.json'); writeFileSync(payloadFile, JSON.stringify(s.payload));
 s.child = nativeSpawn(process.execPath, ['-e', emitter, payloadFile], { ...options, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
 s.closed = new Promise(resolve => s.child.once('close', resolve));
 s.events = 0;
 s.child.stdout.on('data', () => { s.events++; if (s.events < s.payload.chunks?.length && s.child.connected) s.child.send('next'); });
 return s.child;
};
syncBuiltinESMExports();
const source = process.env.OMF_UTF8_TEST_SOURCE || path.join(root, 'teaching-worker/interpreter.mjs');
const { interpretChat } = await import(pathToFileURL(source));
const directory = await mkdtemp(path.join(os.tmpdir(), 'omf-navi-utf8-'));
after(async () => {
 cp.spawn = nativeSpawn; syncBuiltinESMExports();
 assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'omf-navi-utf8-'));
 await rm(directory, { recursive: true, force: true });
});
const reply = summary => ({ kind: 'unclear', summary, patch: {}, quotes: {} });
const workspace = { text: 'Explain without saving.', context: { mode: 'workspace', pageName: 'Synthetic', facts: {}, capabilities: [], messages: [] } };
const config = { cliPath: marker, inferenceDirectory: directory, directory };
function prepare(raw, cut, extra = {}) {
 const bytes = Buffer.from(raw, 'utf8');
 const chunks = cut === undefined ? [bytes] : [bytes.subarray(0, cut), bytes.subarray(cut)];
 scenario = { payload: { chunks: chunks.map(b => b.toString('base64')), ...extra } };
 return scenario;
}
async function invoke(raw, { cut, job = workspace, extra, error } = {}) {
 const s = prepare(raw, cut, extra);
 try {
  if (error) { await assert.rejects(interpretChat(config, job), error); return; }
  return await interpretChat(config, job);
 } finally { if (s.closed) await s.closed; }
}
const wire = summary => JSON.stringify({ is_error: false, structured_output: reply(summary) });
const text = '\u4f1a\u793e\u7528\u3067\u3059\u3002 \ud55c\uad6d\uc5b4 \uc751\ub2f5\uc785\ub2c8\ub2e4. \ud83d\ude80';
test('whole Japanese/Korean/four-byte reply is exact', async () => {
 assert.deepEqual(await invoke(wire(text)), reply(text), 'utf8:whole');
});
for (const [label, character] of [['ja', '\u3002'], ['ko', '\ud55c'], ['four-byte', '\ud83d\ude80']]) {
 for (let boundary = 1; boundary < Buffer.byteLength(character); boundary++) {
  test(`${label} split boundary ${boundary} preserves the final reply`, async () => {
   const raw = wire(text), cut = Buffer.from(raw).indexOf(Buffer.from(character)) + boundary;
   assert.deepEqual(await invoke(raw, { cut }), reply(text), `utf8:${label}-boundary-${boundary}`);
   assert.equal(scenario.events, 2, 'Two separately acknowledged stdout events reached the real receiver');
  });
 }
}
test('literal replacement character survives alongside a split four-byte character', async () => {
 const summary = 'Literal \ufffd remains. \ud83d\ude80', raw = wire(summary);
 assert.deepEqual(await invoke(raw, { cut: Buffer.from(raw).indexOf(Buffer.from('\ud83d\ude80')) + 2 }), reply(summary), 'utf8:literal-replacement');
});
test('fallback result JSON keeps split Unicode', async () => {
 const raw = JSON.stringify({ result: JSON.stringify(reply(text)) });
 assert.deepEqual(await invoke(raw, { cut: Buffer.from(raw).indexOf(Buffer.from('\ud55c')) + 1 }), reply(text), 'utf8:fallback-result');
});
test('purchase proposal preserves verbatim Unicode values and current-message quotes', async () => {
 const productName = '\u96fb\u6c17\u81ea\u52d5\u8eca \ucda9\uc804 \ud83d\ude80';
 const proposal = { kind: 'proposal', summary: text, patch: { productName }, quotes: { productName } };
 const job = { text: productName, context: { source: { description: 'Synthetic', purchaseDate: '2026-01-01', amount: 1, account: { name: 'Synthetic card' } }, values: { purpose: 'company' }, study: {}, customers: [], messages: [] } };
 const raw = JSON.stringify({ structured_output: proposal });
 // Split the value, not just its displayed summary.
 const cut = Buffer.from(raw).indexOf(Buffer.from(productName)) + 1;
 assert.deepEqual(await invoke(raw, { cut, job }), proposal, 'utf8:purchase-quote');
});
test('tool job retains model arguments and removes its private job after success and failure', async () => {
 const job = { ...workspace, tools: [{ name: 'get_draft' }], actionEndpoint: 'http://127.0.0.1/synthetic', lease: 'synthetic-only' };
 await invoke(wire(text), { job });
 assert.equal(scenario.args[scenario.args.indexOf('--model') + 1], 'claude-opus-5-5');
 assert.equal(scenario.args[scenario.args.indexOf('--effort') + 1], 'high');
 assert.deepEqual(await readdir(path.join(directory, 'jobs')), [], 'utf8:success-cleanup');
 await invoke('not JSON', { job, error: /Invalid teaching response/ });
 assert.deepEqual(await readdir(path.join(directory, 'jobs')), [], 'utf8:failure-cleanup');
});
test('malformed, error and nonzero outputs retain their existing failures', async () => {
 await invoke('not JSON', { error: /Invalid teaching response/ });
 await invoke(JSON.stringify({ is_error: true, structured_output: reply(text) }), { error: /Invalid teaching response/ });
 await invoke(wire(text), { extra: { exit: 7 }, error: /Teaching interpreter failed/ });
 await invoke(JSON.stringify({ structured_output: { ...reply(text), patch: { purpose: 'company' } } }), { error: /A general conversation cannot change a purchase/ });
 await assert.rejects(interpretChat({ ...config, cliPath: path.join(directory, 'does-not-exist.exe') }, workspace), /Teaching interpreter unavailable/);
});
test('the existing 200000 UTF-16 character limit accepts the boundary and rejects overflow', async () => {
 const base = { structured_output: reply(text), padding: '' };
 base.padding = '\u3042'.repeat(200000 - JSON.stringify(base).length);
 const raw = JSON.stringify(base); assert.equal(raw.length, 200000);
 assert.deepEqual(await invoke(raw), reply(text), 'utf8:size-boundary');
 await invoke(raw + ' ', { error: /Teaching response too large/ });
});
for (const tooled of [false, true]) test(`${tooled ? 'tool' : 'plain'} timeout kills its owned child and cleans up`, async t => {
 t.mock.timers.enable({ apis: ['setTimeout'] });
 const s = prepare('', undefined, { hang: true });
 const job = tooled ? { ...workspace, tools: [{ name: 'get_draft' }], actionEndpoint: 'http://127.0.0.1/synthetic', lease: 'synthetic-only' } : workspace;
 try {
  const pending = interpretChat(config, job);
  const rejected = assert.rejects(pending, /Teaching interpretation timed out/);
  while (!s.child) await new Promise(resolve => setImmediate(resolve));
  const duration = tooled ? 240000 : 90000;
  t.mock.timers.tick(duration - 1); assert.equal(s.child.killed, false);
  t.mock.timers.tick(1); await rejected; await s.closed;
  assert.equal(s.child.killed, true);
  await mkdir(path.join(directory, 'jobs'), { recursive: true });
  assert.deepEqual(await readdir(path.join(directory, 'jobs')), [], 'utf8:timeout-cleanup');
 } finally { t.mock.timers.reset(); if (s.child && !s.child.killed) s.child.kill(); }
});
// Company public research (2026-10-20): only a company job whose claim carried an actual public-research capability gets the
// built-in WebSearch, the owned public tools in the same MCP server, more tool turns and a longer bound. Others are unchanged.
const research = { ...workspace, companyScoped: true, mode: 'workspace', tools: [{ name: 'list_company_invoices' }], actionEndpoint: 'http://127.0.0.1/api/finance-chat/worker/workspace/0123456789abcdef01234567/actions', lease: 'synthetic-only', publicResearch: { version: 1, webSearch: true, publicPage: true, chrome: true, registry: 'connection_required', today: '2026-10-20' } };
const flag = (args, name) => args[args.indexOf(name) + 1];
test('a capable company job gets WebSearch and the owned public tools; other jobs keep the original CLI contract', async () => {
 await invoke(wire(text), { job: research });
 assert.equal(flag(scenario.args, '--tools'), 'WebSearch', 'research-cli:builtin-websearch-only');
 const allowed = scenario.args.slice(scenario.args.indexOf('--allowedTools') + 1, scenario.args.indexOf('--max-turns'));
 assert.deepEqual(allowed, ['mcp__omf_actions__*', 'WebSearch'], 'research-cli:allowed');
 assert.equal(flag(scenario.args, '--max-turns'), '40', 'research-cli:turns');
 assert.equal(flag(scenario.args, '--model'), 'claude-opus-5-5'); assert.equal(flag(scenario.args, '--effort'), 'high');
 assert.deepEqual(scenario.jobFile.publicResearch, { chrome: true, registry: 'connection_required' }, 'research-cli:job-capability');
 assert.ok(!JSON.stringify(scenario.jobFile).includes('omft_') && !/ntaApplicationId|token/.test(JSON.stringify(scenario.jobFile)), 'research-cli:no-secret-in-job');
 assert.ok(JSON.parse(flag(scenario.args, '--json-schema')).properties.citations, 'research-cli:citations-schema');
 assert.ok(flag(scenario.args, '--system-prompt').includes('read_public_page'));
 assert.ok(['--setting-sources', '--strict-mcp-config', '--no-session-persistence'].every(f => scenario.args.includes(f)), 'research-cli:isolation-kept');
 for (const job of [{ ...research, publicResearch: undefined }, { ...workspace, tools: [{ name: 'get_draft' }], actionEndpoint: 'http://127.0.0.1/synthetic', lease: 'synthetic-only', publicResearch: research.publicResearch }, workspace]) {
  await invoke(wire(text), { job });
  assert.equal(flag(scenario.args, '--tools'), '', 'research-cli:others-no-builtin-tools');
  assert.ok(!scenario.args.includes('WebSearch'), 'research-cli:others-no-websearch');
  if (job.tools) { assert.equal(flag(scenario.args, '--max-turns'), '16'); assert.equal(scenario.jobFile.publicResearch, undefined, 'research-cli:others-no-public-tools'); }
  assert.equal(JSON.parse(flag(scenario.args, '--json-schema')).properties.citations, undefined);
 }
 assert.deepEqual(await readdir(path.join(directory, 'jobs')), [], 'research-cli:cleanup');
});
test('a research job has a longer bound and is still killed and cleaned up at its limit', async t => {
 t.mock.timers.enable({ apis: ['setTimeout'] });
 const s = prepare('', undefined, { hang: true });
 try {
  const rejected = assert.rejects(interpretChat(config, research), /Teaching interpretation timed out/);
  while (!s.child) await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(480000 - 1); assert.equal(s.child.killed, false, 'research-cli:bounded-time');
  t.mock.timers.tick(1); await rejected; await s.closed; assert.equal(s.child.killed, true);
  assert.deepEqual(await readdir(path.join(directory, 'jobs')), [], 'research-cli:timeout-cleanup');
 } finally { t.mock.timers.reset(); if (s.child && !s.child.killed) s.child.kill(); }
});
// Owner realm (plan omf-navi-owner-continuation-20261020): the actual child receives the owner workspace schema (4000 characters, one
// fixed page link) and a prompt naming only the tools the job carries; the purchase/plain contracts above are unchanged.
test('owner workspace tool job keeps a 4000-character reply and one page link through the actual child', async () => {
 const job = { ...workspace, mode: 'workspace', tools: [{ name: 'get_draft' }, { name: 'list_navi_features' }], actionEndpoint: 'http://127.0.0.1/synthetic', lease: 'synthetic-only' };
 const result = await invoke(JSON.stringify({ is_error: false, structured_output: { ...reply('説'.repeat(4000)), navigation: { feature: 'connections' } } }), { job });
 assert.equal(result.summary.length, 4000, 'owner-realm:child-4000'); assert.deepEqual(result.navigation, { feature: 'connections' }, 'owner-realm:child-link');
 const schemaArg = JSON.parse(scenario.args[scenario.args.indexOf('--json-schema') + 1]); assert.equal(schemaArg.properties.summary.maxLength, 4000);
 const prompt = scenario.args[scenario.args.indexOf('--system-prompt') + 1]; assert.ok(prompt.includes('list_navi_features') && !prompt.includes('remember_company_knowledge') && !prompt.includes('queue_card_sync'), 'owner-realm:prompt-names-only-carried-tools');
 await invoke(JSON.stringify({ is_error: false, structured_output: reply('x'.repeat(4001)) }), { job, error: /cannot change a purchase/ });
 await invoke(JSON.stringify({ is_error: false, structured_output: { ...reply('s'), navigation: { feature: 'transactions', transactionId: 'a'.repeat(24) } } }), { job, error: /Invalid navigation/ });
 assert.deepEqual(await readdir(path.join(directory, 'jobs')), [], 'owner-realm:cleanup');
});
// Company business adapters (2026-10-20): a plain company job (no research capability) passes the whole business catalogue to the
// same isolated CLI contract; its system carries the explicit-instruction, unknown-not-repeated and local-date rules; the general and
// purchase prompts keep their own rules and no business tool names.
test('a company job carries the business catalogue and the dialogue/date rules; other prompts are unchanged', async () => {
 const { companyBusinessTools } = await import('../shared/finance-navi-business.mjs');
 const { systemFor, chatSystem } = await import('../teaching-worker/interpreter.mjs');
 const job = { ...research, publicResearch: undefined, tools: [{ name: 'list_company_invoices' }, ...companyBusinessTools] };
 await invoke(wire(text), { job });
 assert.deepEqual(scenario.jobFile.tools.map(t => t.name), job.tools.map(t => t.name), 'business-cli:catalogue-in-job-file');
 assert.equal(flag(scenario.args, '--tools'), '', 'business-cli:no-builtin-tools'); assert.equal(flag(scenario.args, '--max-turns'), '16');
 const prompt = flag(scenario.args, '--system-prompt');
 for (const rule of ['do not ask that question again', 'explicit instruction in the CURRENT message', 'never authority to change anything', 'clock.localDate', 'UTC instants', 'instead of assuming April', 'never add different currencies together', 'never repeated: read get_company_action_status', 'no bank balance, money movement'])
  assert.ok(prompt.includes(rule), 'business-prompt:' + rule);
 assert.ok(prompt.includes('never ask for it again'), 'business-prompt:accountant-role-unknown');
 // 2026-10-20 (invoice calendar): the stored one-entry link replaces "not established"; a repeat is reported, never re-created or resynced.
 for (const rule of ['returns the one existing entry unchanged', 'never kept in sync', 'never infer one from amounts, titles or dates', 'refused, never converted']) assert.ok(prompt.includes(rule), 'invoice-calendar-prompt:' + rule);
 assert.ok(!prompt.includes('Invoice and calendar linkage is not established'), 'invoice-calendar-prompt:old-limit-removed');
 for (const other of [systemFor({ tools: [{ name: 'get_draft' }] }), chatSystem]) { assert.ok(!other.includes('create_company_transaction'), 'business-prompt:owner-prompts-unchanged'); assert.ok(other.includes('do not repeat that question'), 'business-prompt:legacy-rule-kept'); }
});
