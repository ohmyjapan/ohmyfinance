// Optional native CLI credential delivery (plan output/plan/omf-navi-native-auth-20261024). Normal owned fixture: no database,
// provider, model, OMF server, bank, mail, Slack or real Vault. It runs scripts/finance-native-cli-auth.test.mjs (the five actual
// native CLI callers, the research correction leg and the real teaching worker entrypoint against real Node stand-in children at
// the spawn seam, and the stdin-only provisioning command against an owned temporary Windows DPAPI Vault), then the same test on
// an unchanged copied source tree (control) and on meaningful source mutants of that copy. A mutant counts as detected only when
// an assertion carrying its expected tag fails; a missing module, syntax error or crashed setup is never detection. Finally the
// source-importing sibling tests run, with the one known inherited stale assertion recorded, not hidden.
// Follow-up (plan omf-navi-native-auth-followup-20261024): the explicit-credential child must be clean of competing ambient provider,
// injection, profile and arbitrary keys while every absent default (the review worker's ambient inheritance) stays as it was; and
// the corpus contracts (scripts/finance-navi-agent-model-observer.test.mjs runContracts, run in its own child) must pass, including
// the manual-only vault option's owned-Vault handoff through the actual TeachingWorker with no observer overlay and its four seeded
// runner defects. Both legs run on every invocation, so a fail-first run reports both.
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const timeoutMs = 1200000;
const test = 'scripts/finance-native-cli-auth.test.mjs';
const clip = text => text.length > 2500 ? '…' + text.slice(-2500) : text;
// Heavy helpers: hidden windows, idle priority (inherited by their children).
const run = (files, extra = {}, pattern = null, limit = 400000) => new Promise(resolve => {
  const child = execFile(process.execPath, ['--test', '--test-reporter=spec', ...(pattern ? ['--test-name-pattern', pattern] : []), ...files.map(f => path.join(root, f))], { cwd: root, windowsHide: true, env: { ...process.env, OMF_NATIVE_AUTH_TEST_ROOT: '', ...extra }, timeout: limit, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, text: stdout + stderr }));
  try { os.setPriority(child.pid, os.constants.priority.PRIORITY_LOW); } catch {}
});
const classify = text => ({
  behavioral: [...new Set([...text.matchAll(/AssertionError[^\n]*?(native-auth:(?!setup:)[a-z0-9-]+)/g)].map(m => m[1]))],
  setup: [...new Set([...text.matchAll(/native-auth:setup:[a-z0-9-]+/g)].map(m => m[0]))],
  moduleOrSyntax: /ERR_MODULE_NOT_FOUND|SyntaxError/.test(text),
  pass: (text.match(/ℹ pass (\d+)/) || [])[1], fail: (text.match(/ℹ fail (\d+)/) || [])[1],
});
// The corpus contracts in their own Node child (they patch child_process.spawn and count handles); their JSON follows a marker.
const MARK = '@@omf-navi-agent-model-contracts@@';
const contracts = () => new Promise(resolve => {
  const script = "import { pathToFileURL } from 'node:url'; const m = await import(pathToFileURL(process.argv[1]).href); const r = await m.runContracts({ root: process.argv[2] }); process.stdout.write('" + MARK + "' + JSON.stringify({ pass: r.pass, checks: r.checks.length, failures: r.failures, deliberateDefects: r.deliberateDefects.map(d => ({ name: d.name, detected: d.detected })) }));";
  const child = execFile(process.execPath, ['--input-type=module', '-e', script, path.join(root, 'scripts/finance-navi-agent-model-observer.test.mjs'), root], { cwd: root, windowsHide: true, timeout: 600000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => { let parsed = null; try { parsed = JSON.parse(stdout.split(MARK).pop()); } catch {} resolve({ code: error ? error.code ?? 1 : 0, result: parsed, text: parsed ? '' : clip(stdout + stderr) }); });
  try { os.setPriority(child.pid, os.constants.priority.PRIORITY_LOW); } catch {}
});
const copied = ['shared', 'teaching-worker', 'research-worker', 'review-worker', 'finalization-worker', 'collector/windows', 'collector/vault.mjs', 'scripts/configure-native-cli-token.mjs'];
// [name, file, anchor, replacement, expected tag, test-name pattern]
const mutants = [
  ['helper-drops-configured-credential', 'shared/finance-native-cli-auth.mjs', 'env[NATIVE_CLI_AUTH_KEY]=token;', '', 'native-auth:configured-teaching', '^configured:'],
  ['helper-inherits-credential-into-mcp', 'shared/finance-native-cli-auth.mjs', "{...env,[NATIVE_CLI_AUTH_KEY]:''}", 'env', 'native-auth:mcp-blank-teaching', '^MCP tools'],
  ['helper-mutates-global-env', 'shared/finance-native-cli-auth.mjs', 'env[NATIVE_CLI_AUTH_KEY]=token;', 'process.env[NATIVE_CLI_AUTH_KEY]=token;env[NATIVE_CLI_AUTH_KEY]=token;', 'native-auth:process-env-unchanged-teaching', '^configured:'],
  ['helper-silent-fallback-on-invalid', 'shared/finance-native-cli-auth.mjs', "throw Error('Native CLI credential configuration is invalid');", 'return null;', 'native-auth:invalid-fails-closed-teaching', '^invalid explicit'],
  ['teaching-serializes-credential-to-job-file', 'teaching-worker/interpreter.mjs', 'nextSlot:job.nextSlot||1,', 'nextSlot:job.nextSlot||1,auth:config.nativeOAuthToken,', 'native-auth:job-file-no-leak-teaching', '^MCP tools'],
  ['teaching-serializes-credential-to-input', 'teaching-worker/interpreter.mjs', 'const input=interpreterInput(job);', 'const input={...interpreterInput(job),auth:config.nativeOAuthToken};', 'native-auth:input-unchanged-teaching', '^configured:'],
  ['teaching-lets-job-select-credential', 'teaching-worker/interpreter.mjs', 'applyNativeCliAuth(env,config);', 'applyNativeCliAuth(env,{...config,...job});', 'native-auth:job-override-teaching-mcp-absent', '^untrusted'],
  ['teaching-drops-credential', 'teaching-worker/interpreter.mjs', 'applyNativeCliAuth(env,config);', '', 'native-auth:configured-teaching', '^configured:'],
  ['document-drops-credential', 'teaching-worker/document-interpreter.mjs', 'applyNativeCliAuth(env,config);', '', 'native-auth:configured-document', '^configured:'],
  ['review-drops-credential', 'review-worker/interpreter.mjs', 'applyNativeCliAuth(env, config);', '', 'native-auth:configured-review', '^configured:'],
  ['review-converted-to-allowlist', 'review-worker/interpreter.mjs', "const env = { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };", "const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };", 'native-auth:review-ambient-inherited', '^default:'],
  ['finalization-drops-credential', 'finalization-worker/interpreter.mjs', 'applyNativeCliAuth(env,config);', '', 'native-auth:configured-finalization', '^configured:'],
  ['research-drops-credential', 'research-worker/worker.mjs', 'applyNativeCliAuth(env,this.config);', '', 'native-auth:configured-research', '^research: initial'],
  ['research-correction-leg-without-credential', 'research-worker/worker.mjs', 'const repaired=await this.invokeInterpreter(this.config.cliPath,noTools(schema,prompt),{cwd:this.config.inferenceDirectory,env},', 'const repaired=await this.invokeInterpreter(this.config.cliPath,noTools(schema,prompt),{cwd:this.config.inferenceDirectory,env:{...env,CLAUDE_CODE_OAUTH_TOKEN:undefined}},', 'native-auth:configured-research', '^research: initial'],
  ['research-mcp-inherits-credential', 'research-worker/worker.mjs', 'env:nativeMcpEnv({OMF_RESEARCH_DATA_DIR:this.directory,OMF_RESEARCH_JOB_FILE:env.OMF_RESEARCH_JOB_FILE},this.config)', 'env:{OMF_RESEARCH_DATA_DIR:this.directory,OMF_RESEARCH_JOB_FILE:env.OMF_RESEARCH_JOB_FILE}', 'native-auth:mcp-blank-research', '^research: initial'],
  ['research-hash-omits-helper', 'research-worker/worker.mjs', ",'../shared/finance-native-cli-auth.mjs']", ']', 'native-auth:research-hash-includes-helper', '^research runtime'],
  ['configure-prints-credential', 'scripts/configure-native-cli-token.mjs', "process.stdout.write(JSON.stringify({nativeOAuthToken:'configured'})+'\\n');", "process.stdout.write(JSON.stringify({nativeOAuthToken:'configured',value})+'\\n');", 'native-auth:configure-set-output', '^owned DPAPI'],
  ['configure-drops-other-fields', 'scripts/configure-native-cli-token.mjs', '{...object(current),[NATIVE_CLI_TOKEN_FIELD]:value}', '{[NATIVE_CLI_TOKEN_FIELD]:value}', 'native-auth:vault-preserve', '^owned DPAPI'],
  ['configure-clear-removes-server-bearer', 'scripts/configure-native-cli-token.mjs', 'delete next[NATIVE_CLI_TOKEN_FIELD];', 'delete next[NATIVE_CLI_TOKEN_FIELD];delete next.token;', 'native-auth:vault-clear-preserve', '^owned DPAPI'],
  ['configure-ignores-writer-lease', 'scripts/configure-native-cli-token.mjs', 'const withWriter = fn => new SealedStore(resolved).withLock(fn);', 'const withWriter = fn => fn();', 'native-auth:configure-held-writer', '^provisioning: respects'],
  ['configure-hides-writer-retry', 'scripts/configure-native-cli-token.mjs', "const failUpdate = error => fail(error?.code === 'locked' ? error.message : 'The worker Vault could not be updated');", "const failUpdate = () => fail('The worker Vault could not be updated');", 'native-auth:configure-held-writer-retry', '^provisioning: respects'],
  ['configure-exposes-other-update-errors', 'scripts/configure-native-cli-token.mjs', "const failUpdate = error => fail(error?.code === 'locked' ? error.message : 'The worker Vault could not be updated');", 'const failUpdate = error => fail(error.message);', 'native-auth:configure-update-failure-generic', '^provisioning: non-lock'],
  // Explicit-credential isolation defects (follow-up): each keeps or drops something the clean child selection must not.
  ['helper-keeps-ambient-in-explicit-mode', 'shared/finance-native-cli-auth.mjs', 'for(const key of Object.keys(env))delete env[key];', '', 'native-auth:explicit-clean-review-provider', '^configured:'],
  ['helper-keeps-provider-keys', 'shared/finance-native-cli-auth.mjs', 'for(const key of Object.keys(env))delete env[key];', 'for(const key of Object.keys(env))if(!/^(ANTHROPIC_|CLAUDE_CODE_USE_)/.test(key))delete env[key];', 'native-auth:explicit-clean-review-provider', '^configured:'],
  ['helper-keeps-proxy-and-runtime-injection', 'shared/finance-native-cli-auth.mjs', 'for(const key of Object.keys(env))delete env[key];', 'for(const key of Object.keys(env))if(!/PROXY|^NODE_/.test(key))delete env[key];', 'native-auth:explicit-clean-review-runtime-injection', '^configured:'],
  ['helper-keeps-arbitrary-ambient-keys', 'shared/finance-native-cli-auth.mjs', 'for(const key of Object.keys(env))delete env[key];', "for(const key of Object.keys(env))if(!key.startsWith('OMF_NATIVE_AUTH_'))delete env[key];", 'native-auth:explicit-clean-review arbitrary ambient key', '^configured:'],
  ['helper-keeps-ambient-profile-directory', 'shared/finance-native-cli-auth.mjs', "if(config.claudeConfigDirectory&&typeof env.CLAUDE_CONFIG_DIR==='string')", "if(typeof env.CLAUDE_CONFIG_DIR==='string')", 'native-auth:explicit-clean-review-config-dir', '^review worker: explicit'],
  ['helper-cleans-the-absent-default', 'shared/finance-native-cli-auth.mjs', 'if(token===null)return env;', 'if(token===null){if(env&&typeof env==="object"&&env!==process.env){const clean=explicitChildEnv(env,config||{});for(const key of Object.keys(env))delete env[key];Object.assign(env,clean);}return env;}', 'native-auth:review-ambient-inherited', '^default:'],
  ['helper-drops-research-job-paths', 'shared/finance-native-cli-auth.mjs', "const EXPLICIT_KEYS=['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC','OMF_RESEARCH_DATA_DIR','OMF_RESEARCH_JOB_FILE'];", "const EXPLICIT_KEYS=['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'];", 'native-auth:env-unchanged-research', '^research: initial'],
  ['helper-drops-traffic-switch', 'shared/finance-native-cli-auth.mjs', "const EXPLICIT_KEYS=['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC','OMF_RESEARCH_DATA_DIR','OMF_RESEARCH_JOB_FILE'];", "const EXPLICIT_KEYS=['OMF_RESEARCH_DATA_DIR','OMF_RESEARCH_JOB_FILE'];", 'native-auth:env-unchanged-teaching', '^configured:'],
  ['configure-reads-environment', 'scripts/configure-native-cli-token.mjs', 'const value = singleLine(bytes);', 'const value = process.env.OMF_NATIVE_OAUTH_TOKEN || singleLine(bytes);', 'native-auth:configure-refuses-environment', '^provisioning refuses'],
];
async function noLinks(dir) { for (const e of await readdir(dir)) { const f = path.join(dir, e), s = await lstat(f); if (s.isSymbolicLink()) throw Error('Owned copy contains a link: ' + f); if (s.isDirectory()) await noLinks(f); } }
export default {
  name: 'omf-native-cli-auth',
  covers: ['scripts/finance-navi-agent-model.mjs', 'scripts/finance-navi-agent-model-observer.test.mjs', 'teaching-worker/interpreter.mjs', 'teaching-worker/document-interpreter.mjs', 'research-worker/worker.mjs', 'review-worker/interpreter.mjs', 'finalization-worker/interpreter.mjs', 'shared/finance-native-cli-auth.mjs', 'scripts/configure-native-cli-token.mjs', 'scripts/finance-native-cli-auth.test.mjs', 'scripts/zoomer-fixtures/omf-native-cli-auth.mjs'],
  async run() {
    const main = await run([test]);
    const corpus = await contracts();
    const corpusOk = corpus.code === 0 && corpus.result?.pass === true;
    const evidence = { main: { code: main.code, ...classify(main.text), text: clip(main.text) }, corpusContracts: { code: corpus.code, pass: corpus.result?.pass ?? null, checks: corpus.result?.checks ?? null, failures: corpus.result?.failures ?? null, deliberateDefects: corpus.result?.deliberateDefects ?? null, text: corpus.text }, control: null, mutants: [], siblings: null, database: 'none; owned temporary DPAPI Vaults and real Node stand-in children; 0 provider/model/business calls' };
    if (main.code !== 0 || !corpusOk) return { pass: false, message: JSON.stringify(evidence) };
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omf-native-auth-mutant-'));
    try {
      for (const entry of copied) { await mkdir(path.dirname(path.join(directory, entry)), { recursive: true }); await cp(path.join(root, entry), path.join(directory, entry), { recursive: true, dereference: false, verbatimSymlinks: true }); }
      await noLinks(directory);
      const control = await run([test], { OMF_NATIVE_AUTH_TEST_ROOT: directory });
      evidence.control = { code: control.code, ...classify(control.text), text: control.code ? clip(control.text) : '' };
      if (control.code === 0) for (const [name, file, anchor, replacement, expected, pattern] of mutants) {
        const target = path.join(directory, file), source = await readFile(target, 'utf8');
        if (source.split(anchor).length !== 2) { evidence.mutants.push({ name, detected: false, error: 'Expected exactly one mutant anchor' }); continue; }
        await writeFile(target, source.replace(anchor, () => replacement));
        try {
          const outcome = await run([test], { OMF_NATIVE_AUTH_TEST_ROOT: directory }, pattern, 240000);
          const c = classify(outcome.text);
          evidence.mutants.push({ name, expected, detected: outcome.code !== 0 && outcome.text.includes(expected) && outcome.text.includes('AssertionError') && !c.moduleOrSyntax, behavioral: c.behavioral, setup: c.setup, moduleOrSyntax: c.moduleOrSyntax });
        } finally { await writeFile(target, source); }
      }
    } finally {
      if (!path.resolve(directory).startsWith(path.join(path.resolve(os.tmpdir()), 'omf-native-auth-mutant-'))) throw Error('Unsafe owned mutant path');
      await noLinks(directory);
      await rm(directory, { recursive: true, force: true });
    }
    // Source-importing siblings of the changed callers. Known inherited failure at 416676bc, not fixed here: the evaluation poll
    // order assertion that predates the intake/claim route.
    const inherited = 'worker only polls evaluations after the regular research queue is empty';
    const siblingFiles = ['scripts/finance-interpreter-stream.test.mjs', 'scripts/finance-evidence-stream.test.mjs', 'scripts/finance-research-accounting.test.mjs', 'scripts/finance-search-review.test.mjs', 'scripts/finance-review.test.mjs', 'scripts/finance-workflow-worker.test.mjs', 'scripts/finance-assistant-worker.test.mjs', 'scripts/finance-research-evidence-repair.test.mjs', 'scripts/finance-research-questions.test.mjs', 'scripts/finance-research.test.mjs', 'scripts/finance-document-evidence.test.mjs', 'scripts/finance-evaluation.test.mjs', 'collector/test/vault.test.mjs'];
    const siblings = [];
    for (const file of siblingFiles) {
      const r = await run([file]);
      const failed = [...r.text.matchAll(/^✖ (.+?) \(\d/gm)].map(m => m[1]).filter(n => !n.startsWith('scripts') && !n.startsWith('collector') && n !== 'failing tests:');
      const unique = [...new Set(failed)];
      siblings.push({ file, code: r.code, pass: classify(r.text).pass, fail: classify(r.text).fail, failed: unique, ok: r.code === 0 || (file === 'scripts/finance-evaluation.test.mjs' && unique.length === 1 && unique[0] === inherited) });
    }
    evidence.siblings = { inherited, results: siblings };
    const pass = corpusOk && evidence.control?.code === 0 && evidence.mutants.length === mutants.length && evidence.mutants.every(m => m.detected) && siblings.every(s => s.ok);
    return { pass, message: JSON.stringify(evidence) };
  }
};
