// Fixture for plan omf-navi-evaluation-reads-20261025 (5-plan.json): Navi reads the owner saved research evaluations (overview and one
// run) from the workspace conversation through two named read adapters over the SAME native readers the research-evaluation page
// uses, restricted in the database to the owner AND the claimed worker assigned card accounts before any batch, count or summary.
// Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-navi-evaluation-reads.mjs --cwd <this worktree>
// Legs: 1 the built app (scripts/finance-navi-evaluation-reads-integration.cjs on its own disposable MongoDB and server process; NOT
// RUN and red when .output/server/index.mjs is missing) · 2 node --test of the sibling unit tests · 3 the existing native evaluation
// integration (OMF_TEST_EVALUATION_ONLY through scripts/finance-integration.cjs on its own owned MongoDB; the queue lifecycle,
// worker claim, result validation and owner page reads must still pass unchanged) · 4 an unchanged packaged copy of the build must
// pass leg 1 · 5 named defects, each reintroduced into an isolated copy of the compiled output, must make the integration fail with
// its named assertion. No model, provider, network send or ambient database: every database address is a closed sentinel, every
// model or business credential a dummy, and each integration owns its in-memory MongoDB. The covers list is decided at load:
// built-app files are listed only when the build exists.
// Fail-first on 803f803 (its compiled runtime is the 37864ca7 build; 803f803 changed scripts and docs only): leg 1 red at
// eval-reads:job-carries-read-tools and at the HTTP 400 Unknown action of both reads; legs 4-5 NOT RUN until leg 1 is green.
// Plan omf-navi-card-scope-context-20261026: the integration gains group 7 (scope: owner-wide inventory facts.ownerCardAccounts beside the
// claiming worker's actual facts.cardToolScope, agreeing with native list_accounts for full/reduced/empty grants and a different-worker
// reclaim, legacy facts.accounts projected at claim, payment context without inventory, purchase and company jobs untouched) and leg 5
// three more compiled defects (owner-wide scope metadata, scope metadata dropped, stale first-claim scope reused at a reclaim).
// Fail-first on 016318c (its own compiled runtime): leg 1 red at eval-reads:owner-inventory-named (the claimed job carries only the
// ambiguous facts.accounts and no cardToolScope); legs 4-5 NOT RUN until leg 1 is green.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const timeoutMs = 3600000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILT = existsSync(path.join(root, '.output', 'server', 'index.mjs'));
const EXPECTED = 7;
const SCRIPT_COVERS = ['scripts/finance-navi-evaluation-reads-integration.cjs', 'scripts/zoomer-fixtures/omf-navi-evaluation-reads.mjs', 'scripts/finance-navi-features.test.mjs', 'scripts/finance-evaluation.test.mjs', 'scripts/finance-assistant.test.mjs', 'shared/finance-navi-features.mjs', 'shared/finance-assistant.mjs', 'shared/finance-evaluation.mjs', 'docs/navi-evaluation-reads.md', 'docs/navi-feature-coverage.md'];
const APP_COVERS = ['server/services/financeEvaluationService.ts', 'server/services/financeOwnerActionService.ts', 'server/services/financeActionService.ts', 'server/services/financeAssistantService.ts', 'server/api/finance-evaluation/[.' + '..path].ts', 'server/api/finance-chat/[.' + '..path].ts', 'server/models/FinanceEvaluation.ts', 'scripts/finance-integration.cjs', 'scripts/finance-evaluation-integration.cjs'];
const binary = path.resolve(root, '..', 'node_modules', '.cache', 'mongodb-memory-server', 'mongod-x64-win32-8.2.1.exe');

function scrubbedEnv(appRoot, only) {
  const env = { ...process.env, OMF_EVAL_READS_FIXTURE: 'owned', OMF_EVAL_READS_APP_ROOT: appRoot, OMF_EVAL_READS_ONLY: only || '', ...(existsSync(binary) ? { OMF_MONGOD_BINARY: binary, MONGOMS_SYSTEM_BINARY: binary } : {}) };
  for (const key of ['MONGO_URI', 'MONGODB_URI', 'NUXT_MONGO_URI', 'MONGO_URL', 'MONGODB_URL', 'DATABASE_URL']) env[key] = 'mongodb://127.0.0.1:1/zfx_no_ambient_database';
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_SETUP_TOKEN', 'SLACK_BOT_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) env[key] = 'no-model-or-business-send';
  for (const key of Object.keys(env)) if (key.startsWith('OMF_TEST_')) delete env[key];
  return env;
}
const exec = (file, cwd, env, timeout) => new Promise(resolve => {
  const started = Date.now();
  execFile(process.execPath, [file], { cwd, env, windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
    const text = String(stdout || '') + '\n' + String(stderr || '');
    resolve({ ms: Date.now() - started, code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0, killed: !!error?.killed, text, passes: String(stdout || '').split(/\r?\n/).filter(l => l.startsWith('PASS ')).map(l => l.slice(5)) });
  });
});
// This tree integration always runs; appRoot is the built app it starts (this tree or a packaged copy).
const run = (appRoot, only) => exec(path.join(root, 'scripts', 'finance-navi-evaluation-reads-integration.cjs'), appRoot, scrubbedEnv(appRoot, only), 900000);
// The existing native evaluation integration of the app root (its own owned MongoDB), unchanged by this plan.
const nativeEvaluation = appRoot => exec(path.join(appRoot, 'scripts', 'finance-integration.cjs'), appRoot, { ...scrubbedEnv(appRoot), OMF_TEST_EVALUATION_ONLY: '1' }, 900000);
// Leg 2 runs each sibling unit file on its own. scripts/finance-evaluation.test.mjs carries one failure inherited at 803f803 (its
// research-worker polling-order test expects [claim, evaluation/claim] while the worker also polls intake/claim; witness
// .zoomer-unit-baseline-evaluation.txt of this build). That one named test is reported as inherited, never counted green and never
// allowed to hide another failure; every other test of the three files must pass.
const UNIT_FILES = ['scripts/finance-navi-features.test.mjs', 'scripts/finance-evaluation.test.mjs', 'scripts/finance-assistant.test.mjs'];
const INHERITED = { file: 'scripts/finance-evaluation.test.mjs', test: 'worker only polls evaluations after the regular research queue is empty' };
function unitTest(file) {
  return new Promise(resolve => execFile(process.execPath, ['--test', file], { cwd: root, env: scrubbedEnv(root), windowsHide: true, timeout: 300000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
    const text = String(stdout || '') + String(stderr || ''), summary = text.match(/[#ℹ] pass (\d+)[\s\S]*?[#ℹ] fail (\d+)/);
    const failing = Array.from(new Set(text.split(/\r?\n/).map(l => l.trim()).filter(l => /^✖ /.test(l) && !/^✖ failing tests/.test(l)).map(l => l.replace(/^✖ /, '').replace(/ \(\d+(\.\d+)?ms\)$/, ''))));
    resolve({ file, code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0, text, pass: summary ? Number(summary[1]) : 0, fail: summary ? Number(summary[2]) : -1, failing });
  }));
}
async function unitTests() {
  const results = [];
  for (const file of UNIT_FILES) results.push(await unitTest(file));
  const inherited = results.find(r => r.file === INHERITED.file);
  const inheritedOnly = !!inherited && inherited.fail === 1 && inherited.failing.length === 1 && inherited.failing[0] === INHERITED.test;
  const ok = results.every(r => r.fail === 0 || (r.file === INHERITED.file && inheritedOnly));
  const passed = results.reduce((n, r) => n + r.pass, 0);
  const note = inheritedOnly ? '; ' + INHERITED.file + ': 1 inherited failure at 803f803 (' + INHERITED.test + ') reported, not counted green' : '';
  const red = results.filter(r => r.fail !== 0 && !(r.file === INHERITED.file && inheritedOnly)).map(r => r.file + ' (' + (r.fail < 0 ? 'no summary' : r.fail + ' failed') + ': ' + r.failing.join(' | ') + ')').join(' ‖ ');
  return { code: ok ? 0 : 1, text: results.map(r => r.text).join('\n'), passed, note, red };
}
const tail = r => (r.text.split(/\r?\n/).filter(l => /eval-reads:|AssertionError|Error|SETUP|^FAIL /.test(l)).slice(0, 6).join(' | ') || r.text.slice(-600)).replace(/\s+/g, ' ').slice(0, 900);
async function filesOf(dir, ext) { const out = []; if (!existsSync(dir)) return out; for (const entry of await readdir(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) out.push(...await filesOf(full, ext)); else if (entry.name.endsWith(ext)) out.push(full); } return out; }
const occurrences = (text, anchor) => typeof anchor === 'string' ? text.split(anchor).length - 1 : (text.match(anchor) || []).length;

// Each defect: an anchor in the compiled server chunks (string, or a whitespace-tolerant regular expression) that must match exactly
// once in exactly one file, its replacement, the integration groups its leg runs (OMF_EVAL_READS_ONLY) and the eval-reads: assertion
// the integration must then fail with. Declared after the candidate build, against the actual compiled text (never source-text
// assertions). An empty list keeps leg 5 red.
export const DEFECTS = [
  // The owner filter drops out of the Navi read filter: a grant naming another owner account reads that owner rows.
  { name: 'owner-filter-removed', only: 'isolation', anchor: 'const readFilter = (ownerId, accountIds) => accountIds ? { ownerId, accountId: { $in: accountIds } } : { ownerId };', replacement: 'const readFilter = (ownerId, accountIds) => accountIds ? { accountId: { $in: accountIds } } : { ownerId };', expect: /eval-reads:cross-owner-grant-bounded|eval-reads:cross-owner-grant-detail-404/ },
  // The account filter drops out: every card of the owner is read, the newest unassigned-card batch becomes the default.
  { name: 'account-filter-removed', only: 'overview', anchor: 'const readFilter = (ownerId, accountIds) => accountIds ? { ownerId, accountId: { $in: accountIds } } : { ownerId };', replacement: 'const readFilter = (ownerId, accountIds) => accountIds ? { ownerId } : { ownerId };', expect: /eval-reads:scoped-default-batch|eval-reads:scoped-batches|eval-reads:scoped-cases|eval-reads:aggregate-after-filter/ },
  // An empty assigned list is treated as the owner default instead of an empty read.
  { name: 'empty-grant-unrestricted', only: 'isolation', anchor: 'const readFilter = (ownerId, accountIds) => accountIds ? { ownerId, accountId: { $in: accountIds } } : { ownerId };', replacement: 'const readFilter = (ownerId, accountIds) => accountIds && accountIds.length ? { ownerId, accountId: { $in: accountIds } } : { ownerId };', expect: /eval-reads:empty-grant-empty-read/ },
  // The selected batch is read for the whole owner (the unassigned card rows return and are counted and summarised).
  { name: 'selected-batch-unfiltered', only: 'overview', anchor: 'let runQuery = FinanceEvaluationRun.find({ ...filter, batchId: selected })', replacement: 'let runQuery = FinanceEvaluationRun.find({ ownerId, batchId: selected })', expect: /eval-reads:aggregate-after-filter|eval-reads:unassigned-hidden|eval-reads:runs-population/ },
  // The summary aggregates the whole-owner batch before the account filter (the returned rows stay filtered).
  { name: 'aggregate-before-filter', only: 'overview', anchor: '}), summary: evaluationSummary(runs), connected };', replacement: '}), summary: evaluationSummary(selected ? await FinanceEvaluationRun.find({ ownerId, batchId: selected }).sort({ createdAt: 1 }).lean() : []), connected };', expect: /eval-reads:shared-summary-scoped|eval-reads:scoped-summary-counts/ },
  // The detail adapter returns the raw run beside the projection (definitions, context, binding, lease, raw diagnostics leak).
  { name: 'leaked-raw-detail', only: 'detail', anchor: 'async (scope, args) => evaluationRunDetailView((await (await evaluationService()).evaluationRunDetail(scope.ownerId, args.runId, { accountIds: scope.agent.accountIds })).run)', replacement: 'async (scope, args) => { const run = (await (await evaluationService()).evaluationRunDetail(scope.ownerId, args.runId, { accountIds: scope.agent.accountIds })).run; return { ...evaluationRunDetailView(run), raw: run }; }', expect: /eval-reads:detail-no-secrets/ },
  // The input context source is excerpted like any other source (raw context text leaks).
  { name: 'context-excerpt-leaked', only: 'detail', anchor: 'const pointer = s.kind === "context", excerpt = pointer ? null : clipText(', replacement: 'const pointer = false, excerpt = clipText(', expect: /eval-reads:context-source-pointer-only|eval-reads:detail-no-secrets/ },
  // The overview adapter is advertised to purchase jobs as well (mode boundary).
  { name: 'purchase-mode-advertised', only: 'isolation', anchor: /"get_evaluation_overview",\s*"read",\s*\["workspace"\],/, replacement: '"get_evaluation_overview", "read", ["workspace", "purchase"],', expect: /eval-reads:purchase-job-lacks-tools|eval-reads:purchase-job-no-tool/ },
  // The owner realm mapping of research-evaluation is dropped: the feature guide keeps the page handoff although the job carries the tools.
  { name: 'realm-mapping-dropped', only: 'tools', anchor: "'research-evaluation':['get_evaluation_overview','get_evaluation_run']", replacement: "'research-evaluation':[]", expect: /eval-reads:guide-navi-tool/ },
  // Plan omf-navi-card-scope-context-20261026 (claim-time card scope facts, compiled in the finance-chat route chunk):
  // the claim-time scope is built owner-wide (the assigned-id filter drops out): it names the unassigned card list_accounts never returns.
  { name: 'owner-wide-scope-metadata', only: 'scope', anchor: 'const accounts = await FinancialAccount.find({ ownerId: agent.ownerId, _id: { $in: agent.accountIds }, active: true }).select("name provider primaryCard").sort({ name: 1 }).lean();', replacement: 'const accounts = await FinancialAccount.find({ ownerId: agent.ownerId, active: true }).select("name provider primaryCard").sort({ name: 1 }).lean();', expect: /eval-reads:scope-agrees-with-list-accounts|eval-reads:full-grant-scope/ },
  // The scope metadata is dropped from the job facts (the inventory alone is forwarded again).
  { name: 'scope-metadata-dropped', only: 'scope', anchor: 'return { ...facts, cardToolScope: scope };', replacement: 'return { ...facts };', expect: /eval-reads:scope-shape/ },
  // The first claim's scope is written into the saved context and reused by every later claim: a reclaim by another worker carries the
  // first worker's cards (the frozen-at-send defect the native baseline reproduced).
  { name: 'stale-first-claim-scope', only: 'scope', anchor: 'const cardScope = await cardToolScope(agent);', replacement: 'const cardScope = c.context?.facts?.cardToolScope || await (async () => { const s = await cardToolScope(agent); await FinanceAssistant.updateOne({ _id: c._id }, { $set: { "context.facts.cardToolScope": s } }); return s; })();', expect: /eval-reads:scope-agrees-with-list-accounts reclaim-reduced|eval-reads:reclaim-scope-fresh/ }
];

// Applies one defect to the copy and returns the edited file with its original text (restored after the leg).
async function applyDefect(outputDir, defect) {
  const files = await filesOf(path.join(outputDir, 'server', 'chunks'), '.mjs');
  let hits = 0, target = null;
  for (const file of files) { const text = await readFile(file, 'utf8'); const n = occurrences(text, defect.anchor); if (n) { hits += n; target = { file, text }; } }
  if (hits !== 1) throw new Error('SETUP: defect ' + defect.name + ': anchor matched ' + hits + ' times (expected exactly 1)');
  const edited = typeof defect.anchor === 'string' ? target.text.replace(defect.anchor, () => defect.replacement) : target.text.replace(defect.anchor, defect.replacement);
  if (edited === target.text) throw new Error('SETUP: defect ' + defect.name + ': replacement changed nothing');
  await writeFile(target.file, edited);
  return { file: target.file, text: target.text };
}

export default {
  name: 'omf-navi-evaluation-reads',
  covers: BUILT ? SCRIPT_COVERS.concat(APP_COVERS) : SCRIPT_COVERS,
  async run() {
    const started = Date.now(), lines = [];
    let pass = true, positive = null, control = null, units = null, native = null;
    const defects = [];
    // 1 positive: the built app on its own owned database.
    if (!BUILT) { pass = false; lines.push('1 built app: NOT RUN — .output/server/index.mjs is missing (run nuxt build first); no coverage claimed'); }
    else {
      positive = await run(root, '');
      await writeFile(path.join(root, '.zoomer-evaluation-reads-integration.txt'), positive.text).catch(() => {});
      const done = positive.text.match(/(\d+) evaluation read groups passed/), red = positive.text.split(/\r?\n/).filter(l => l.startsWith('FAIL ')).map(l => l.slice(5, 900));
      if (positive.code !== 0 || !done || Number(done[1]) !== positive.passes.length || positive.passes.length !== EXPECTED) { pass = false; lines.push('1 built app: RED — exit ' + (positive.killed ? 'timeout' : positive.code) + ', ' + positive.passes.length + '/' + EXPECTED + ' groups green' + (red.length ? ' · red groups: ' + red.join(' ‖ ') : '') + ': ' + tail(positive)); }
      else lines.push('1 built app: ok (' + positive.passes.length + ' groups in ' + Math.round(positive.ms / 1000) + 's)');
    }
    // 2 sibling unit tests (pure, no database or model).
    units = await unitTests();
    if (units.code !== 0) { pass = false; lines.push('2 unit tests: RED — ' + units.red.slice(0, 600)); }
    else lines.push('2 unit tests: ok (' + units.passed + ' tests passed, no new failure' + units.note + ')');
    // 3 the existing native evaluation integration of this tree (queue lifecycle, worker protocol, owner page reads) must still pass.
    if (BUILT) {
      native = await nativeEvaluation(root);
      await writeFile(path.join(root, '.zoomer-evaluation-native-integration.txt'), native.text).catch(() => {});
      const done = native.text.match(/(\d+) targeted evaluation checks passed/);
      if (native.code !== 0 || !done || Number(done[1]) !== native.passes.length) { pass = false; lines.push('3 native evaluation integration: RED — exit ' + (native.killed ? 'timeout' : native.code) + ': ' + tail(native)); }
      else lines.push('3 native evaluation integration: ok (' + native.passes.length + ' checks in ' + Math.round(native.ms / 1000) + 's)');
    } else lines.push('3 native evaluation integration: NOT RUN — no build');
    // 4-5 packaged copy control and named compiled defects, only when legs 1-3 are green.
    if (pass && BUILT) {
      const base = path.resolve(root, '.zoomer', 'evaluation-reads-defects'), directory = path.resolve(base, randomUUID());
      if (!directory.startsWith(base + path.sep)) throw new Error('Unsafe owned test directory');
      try {
        await mkdir(directory, { recursive: true });
        for (const part of ['.output', 'shared', 'scripts']) await cp(path.join(root, part), path.join(directory, part), { recursive: true, dereference: true });
        control = await run(directory, '');
        const controlOk = control.code === 0 && control.passes.length === EXPECTED;
        lines.push('4 unchanged packaged copy: ' + (controlOk ? 'ok (' + control.passes.length + ' groups in ' + Math.round(control.ms / 1000) + 's)' : 'RED — ' + tail(control)));
        if (!controlOk) pass = false;
        else if (!DEFECTS.length) { pass = false; lines.push('5 defects: RED — no defect declared against the compiled candidate'); }
        else for (const defect of DEFECTS) {
          let touched = null;
          try {
            touched = await applyDefect(path.join(directory, '.output'), defect);
            const r = await run(directory, defect.only || ''), detected = r.code !== 0 && defect.expect.test(r.text) && !/SETUP/.test(r.text);
            defects.push({ name: defect.name, touched: path.relative(path.join(directory, '.output'), touched.file), detected, exit: r.code, ms: r.ms, tail: tail(r) });
            if (!detected) pass = false;
          } catch (error) { defects.push({ name: defect.name, detected: false, setupError: String(error.message).slice(0, 300) }); pass = false; }
          finally { if (touched) await writeFile(touched.file, touched.text); }
        }
        if (DEFECTS.length) lines.push('5 defects: ' + defects.map(d => d.name + ':' + (d.detected ? 'detected' : 'NOT DETECTED' + (d.setupError ? ' (' + d.setupError + ')' : ' — ' + d.tail))).join(' · '));
      } finally { await rm(directory, { recursive: true, force: true }); }
    } else if (BUILT) lines.push('4-5 control and defects: NOT RUN — legs 1-3 are not green, defects prove nothing');
    pass = pass && !!control && DEFECTS.length > 0 && defects.length === DEFECTS.length && defects.every(d => d.detected);
    const databaseCoverage = positive && positive.code === 0 ? { executed: true, ownedProcess: true } : { executed: false, ownedProcess: false };
    return { pass, databaseCoverage, message: (pass ? 'navi evaluation reads green' : 'FAILED') + ' in ' + Math.round((Date.now() - started) / 1000) + 's — ' + lines.join(' · ') + ' · limits: synthetic owned native HTTP/worker protocol evidence with synthetic worker replies and seeded records in the shapes the native service stores; no model draw, no production record, no reliability rate; live model acceptance, independent review and deployment remain open.' };
  }
};
