// Fixture for plan omf-paypay-logout-20261023: the observed PayPay logout confirmation. Run ONLY through the hub verifier:
//   node scripts/zoomer-verify.mjs --run-fixture omf-paypay-logout.mjs --cwd <this worktree>
// Evidence basis, stated exactly: synthetic only. The fake pages replay the value-free actual trace (hub output/plan/omf-paypay-logout-20261023
// CAUSE.md / LIVE-LOGOUT-TRACE.jsonl: a `confirm` with logout and confirmation wording on the statement page right after the job's own
// ログアウト press, never answered); the message text is fictional (the real one was not retained). Every page of every owned HEADLESS
// Chrome is served by request interception; host resolution is refused for everything else. No bank, database, owner AppData, ordinary
// browser or OS input is touched. Nothing here is a live logout proof.
// Fail-first on 1284d40 (behaviour, not a missing file): the original is captured, but the logout confirm stays unanswered and the
// post-logout page is never reached (finish() reports timeout).
// Legs: U the collector unit tests (TAP, per test: the new paypay-logout test and the affected PayPay/Rakuten collector tests); M the named
// mutants — this plan's G-M1…G-M8 on the new test, the legacy routine C-M1…C-M18 (paypay.mjs changed) and the live-period L-M1…L-M8 (the
// finish()/diagnostic contract); P the staged customer package carries and loads the exact changed module. M and P run only on a green U.
// Not re-run, with the reason (see the build report): C-M14/C-M16/C-M19 and the native/HTTP walkthroughs — collector/bank.mjs, index.mjs,
// browser.mjs, the daemon, the server and the importer are unchanged at this commit.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 7200000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COVERS = ['collector/banks/paypay.mjs', 'collector/test/paypay-routine.test.mjs', 'collector/test/paypay-logout.test.mjs', 'docs/paypay-bank-connection.md', 'scripts/zoomer-fixtures/omf-paypay-logout.mjs'];
const run = (args, env = {}, timeout = 2400000) => new Promise(resolve => execFile(process.execPath, args, { cwd: root, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', ...env } }, (e, stdout, stderr) => resolve({ code: e ? e.code ?? 1 : 0, killed: !!e?.killed, stdout: String(stdout), stderr: String(stderr) })));
// OMF_LOGOUT_EVIDENCE_DIR (optional, an existing directory): the complete stdout/stderr of each child run is kept there, never truncated.
const keep = async (name, r) => { const dir = process.env.OMF_LOGOUT_EVIDENCE_DIR; if (dir) await writeFile(path.join(dir, 'child-' + name + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt'), 'exit ' + r.code + (r.killed ? ' (killed)' : '') + '\n--- stdout ---\n' + r.stdout + '\n--- stderr ---\n' + r.stderr, { flag: 'wx' }).catch(() => {}); return r; };
function tapReport(text) {
  const total = name => Number(text.match(new RegExp('^# ' + name + ' (\\d+)', 'm'))?.[1] ?? NaN);
  const tests = [...text.matchAll(/^(\s*)(ok|not ok) \d+ - (.+?)(?: # (SKIP|TODO).*)?$/gm)].filter(m => m[1].length <= 4).map(m => ({ ok: m[2] === 'ok', name: m[3].trim(), directive: m[4] || null }));
  return { tests: total('tests'), pass: total('pass'), fail: total('fail'), skipped: total('skipped'), todo: total('todo'), cancelled: total('cancelled'), list: tests };
}
// A sibling copy of a module with named edits (each exact anchor must hit exactly once) or one `// guard:<name>` line removed (same rule as
// omf-paypay-routine.mjs / omf-paypay-live-period.mjs; an anchor that does not hit exactly once is a harness failure, never a catch).
async function mutantModule(file, { guard = null, edits = [] } = {}) {
  const source = path.join(root, file); let text = (await readFile(source, 'utf8')).replace(/\r\n/g, '\n');
  if (guard) { const lines = text.split('\n'), hits = lines.filter(l => l.includes('// guard:' + guard + ' ') || l.trimEnd().endsWith('// guard:' + guard)); if (hits.length !== 1) throw new Error('FAIL guard marker hits ' + hits.length + ' for ' + guard); lines.splice(lines.indexOf(hits[0]), 1); text = lines.join('\n'); }
  for (const [anchor, replacement] of edits) { const hits = text.split(anchor).length - 1; if (hits !== 1) throw new Error('FAIL mutant anchor hits ' + hits + ' for ' + file + ' ' + anchor.slice(0, 70)); text = text.replace(anchor, () => replacement); }
  const ext = file.endsWith('.test.mjs') ? '.test.mjs' : '.mjs', target = path.join(path.dirname(source), path.basename(file, ext) + `.mutant-${process.pid}-${randomUUID().slice(0, 8)}${ext}`);
  await writeFile(target, text, { flag: 'wx' });
  return { file: target, async dispose() { await unlink(target).catch(() => {}); } };
}
const PAYPAY = 'collector/banks/paypay.mjs', BANK = 'collector/bank.mjs', LOGOUT_TEST = 'collector/test/paypay-logout.test.mjs', ROUTINE_TEST = 'collector/test/paypay-routine.test.mjs', LIVE_TEST = 'collector/test/paypay-live-period.test.mjs';
const ACCEPT = "const accept = scope => { scope.answered = true; dialogs?.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); };";
const LISTEN = "dialogs.on('Page.javascriptDialogOpening', logoutConfirm);";
const SCOPE = "if (!scope || scope.seen || Date.now() > scope.until) return; // guard:routine-logout-scope";
// This plan's named defects, each caught by its named assertion in the new test.
export const LOGOUT_MUTANTS = [
  { name: 'G-M1-logout-confirm-unanswered', edits: [[ACCEPT, 'const accept = scope => { scope.answered = true; };']], test: "the observed logout confirm", expect: /logout:confirm-continuation/ },
  { name: 'G-M2-accept-any-dialog', edits: [[LISTEN, "dialogs.on('Page.javascriptDialogOpening', () => { dialogs.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); });"]], test: 'dialogs before the own', expect: /logout:out-of-scope-unanswered csv/ },
  { name: 'G-M3-scope-not-bound-to-own-press', edits: [['let logout = null;', 'let logout = { until: Infinity, pressed: true, seen: false, pending: false, answered: false };']], test: 'dialogs before the own', expect: /logout:out-of-scope-unanswered csv/ },
  { name: 'G-M4-late-answer', guard: null, edits: [[SCOPE, 'if (!scope || scope.seen) return; // guard:routine-logout-scope'], ['} finally { if (logout === scope) logout = null; } // guard:routine-logout-lifetime', '} finally { /* scope kept */ } // guard:routine-logout-lifetime']], test: 'lifetime', expect: /logout:late-unanswered/ },
  { name: 'G-M5-any-dialog-type', guard: 'routine-logout-confirm-type', test: 'after the own', expect: /logout:out-of-scope-unanswered alert/ },
  { name: 'G-M6-wording-unchecked', guard: 'routine-logout-confirm-words', test: 'after the own', expect: /logout:out-of-scope-unanswered generic/ },
  { name: 'G-M7-page-unchecked', guard: 'routine-logout-confirm-page', test: 'after the own', expect: /logout:out-of-scope-unanswered frame/ },
  { name: 'G-M8-answer-twice', edits: [['    scope.seen = true;\n', '']], test: 'once only', expect: /logout:answer-once/ }
];

export default { name: 'omf-paypay-logout', covers: COVERS, async run() {
  const started = Date.now(), lines = []; let pass = true, unitGreen = false;
  const counts = { legs: 0, green: 0, unitTests: 0, mutantsCaught: 0, mutantsTotal: 0 };
  const leg = async (name, fn) => { counts.legs++; const t = Date.now(); try { lines.push(name + ': ' + await fn() + ` (${Math.round((Date.now() - t) / 1000)}s)`); counts.green++; return true; } catch (e) { pass = false; lines.push(name + ': RED ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 3000)); return false; } };
  const assert = (await import('node:assert/strict')).default;
  if (process.platform !== 'win32') return { pass: false, message: 'owned Chrome and the collector need Windows' };
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-paypay-logout-fixture-'));
  try {
    // ── U ──
    unitGreen = await leg('U collector unit tests (node --test, TAP): paypay-logout (new), paypay-routine, paypay-live-period, paypay-standard, paypay-guided-capture, paypay-setup, rakuten-standard, rakuten-auto-login, rakuten-setup', async () => {
      const files = [LOGOUT_TEST, ROUTINE_TEST, LIVE_TEST, 'collector/test/paypay-standard.test.mjs', 'collector/test/paypay-guided-capture.test.mjs', 'collector/test/paypay-setup.test.mjs', 'collector/test/rakuten-standard.test.mjs', 'collector/test/rakuten-auto-login.test.mjs', 'collector/test/rakuten-setup.test.mjs'];
      const r = await keep('U', await run(['--test', '--test-concurrency=1', '--test-reporter=tap', ...files], {}, 5400000)), t = tapReport(r.stdout), failed = t.list.filter(x => !x.ok), directives = t.list.filter(x => x.directive);
      counts.unitTests = t.pass;
      if (r.code !== 0 || t.fail || !(t.pass > 0) || t.skipped || t.todo || t.cancelled || directives.length || t.pass !== t.tests) throw new Error(`node --test exit ${r.code} tests ${t.tests} pass ${t.pass} fail ${t.fail} skipped ${t.skipped} todo ${t.todo} cancelled ${t.cancelled}; failing: ` + failed.map(x => x.name.slice(0, 110)).join(' | ') + ' :: ' + (r.stdout.split('\n').filter(l => /logout:|live-period:|paypay-routine:|paypay:|auto-login:|code: '|AssertionError|actual:|expected:/.test(l)).slice(0, 30).join(' | ') || r.stderr.slice(-800)).slice(0, 2600));
      const named = [/^the observed logout confirm after the job's own/, /^a bank that logs out without any dialog/, /^once only: a second confirm/, /^lifetime: a confirm that opens after finish/, /^after the own ログアウト press, out-of-scope dialogs/, /^dialogs before the own ログアウト press are never answered/, /^a failed retrieval still logs out through the observed confirm/, /^a confirm dialog on CSV is never accepted/, /^happy path: one native submission reaches the Welcome page directly/, /^private diagnostics on a failure/, /^a broken diagnostic never changes the result/, /^actual-shaped empty default view/];
      for (const n of named) assert.ok(t.list.some(x => x.ok && n.test(x.name)), 'logout:unit-test-present ' + n.source);
      return `${t.pass}/${t.tests} tests green, 0 skipped/todo/cancelled; ${named.length} named tests present`;
    });
    if (!unitGreen) { lines.push('M, P: NOT RUN — U is red (a mutant is only meaningful against a green control)'); counts.legs += 2; }
    // ── M ──
    if (unitGreen) await leg('M mutants: G-M1…G-M8 (this plan, new test), legacy routine C-M1…C-M18 (routine test), live-period L-M1…L-M8 (live-period test)', async () => {
      const caught = [], flip = async (name, expect, fn) => {
        counts.mutantsTotal++; const r = await fn(), text = r.stdout + '\n' + r.stderr;
        if (/FAIL mutant|FAIL guard|ERR_MODULE_NOT_FOUND|SyntaxError/.test(text)) throw new Error(name + ' harness failure: ' + text.replace(/\s+/g, ' ').slice(-600));
        if (r.code === 0 || !expect.test(text)) throw new Error(name + ' did not flip ' + expect + ' (exit ' + r.code + '): ' + (text.split('\n').filter(l => /AssertionError|logout:|live-period:|paypay-routine:|Error/.test(l)).slice(0, 6).join(' | ') || text.slice(-500)).slice(0, 700));
        caught.push(name); counts.mutantsCaught++;
      };
      const envOf = (file, target) => ({ [file === PAYPAY ? 'OMF_TEST_PAYPAY_MODULE' : 'OMF_TEST_BANK_MODULE']: target });
      for (const m of LOGOUT_MUTANTS) {
        const mod = await mutantModule(PAYPAY, { guard: m.guard || null, edits: m.edits || [] });
        try { await flip(m.name, m.expect, async () => keep('M-' + m.name, await run(['--test', '--test-concurrency=1', '--test-name-pattern=' + m.test, LOGOUT_TEST], envOf(PAYPAY, mod.file), 1500000))); } finally { await mod.dispose(); }
      }
      const { MUTANTS } = await import(pathToFileURL(path.join(root, 'scripts/zoomer-fixtures/omf-paypay-routine.mjs')).href);
      for (const m of MUTANTS) {
        const mod = await mutantModule(m.file, { guard: m.guard || null, edits: m.edits || [] });
        try { await flip(m.name, m.expect, async () => keep('M-' + m.name, await run(['--test', '--test-concurrency=1', '--test-name-pattern=' + m.test, ROUTINE_TEST], envOf(m.file, mod.file), 900000))); } finally { await mod.dispose(); }
      }
      const { LIVE_MUTANTS } = await import(pathToFileURL(path.join(root, 'scripts/zoomer-fixtures/omf-paypay-live-period.mjs')).href);
      for (const m of LIVE_MUTANTS) {
        const mods = []; try { for (const p of m.parts) mods.push({ file: p.file, mod: await mutantModule(p.file, { guard: p.guard || null, edits: p.edits || [] }) });
          const env = Object.assign({}, ...mods.map(x => envOf(x.file, x.mod.file)));
          await flip(m.name, m.expect, async () => keep('M-' + m.name, await run(['--test', '--test-concurrency=1', '--test-name-pattern=' + m.test, LIVE_TEST], env, 1200000)));
        } finally { for (const x of mods) await x.mod.dispose(); }
      }
      return caught.length + '/' + counts.mutantsTotal + ' mutants caught: ' + caught.join(', ');
    });
    // ── P ──
    if (unitGreen) await leg('P package: stage (no install) carries banks/paypay.mjs with its repo hash; the staged copy itself loads and builds the routine ui', async () => {
      const { stage } = await import(pathToFileURL(path.join(root, 'collector/package/stage.mjs')).href), into = path.join(temp, 'staged');
      const { manifest } = await stage({ into, origin: 'https://omf.example', install: false, log: () => {} });
      const sha = bytes => createHash('sha256').update(bytes).digest('hex'), repo = sha(await readFile(path.join(root, PAYPAY))), staged = sha(await readFile(path.join(into, PAYPAY)));
      assert.equal(manifest.files?.[PAYPAY], repo, 'logout:staged-hash'); assert.equal(staged, repo, 'logout:staged-bytes');
      const mod = await import(pathToFileURL(path.join(into, PAYPAY)).href), ui = mod.standard.ui({}, {}, null);
      for (const k of ['open', 'login', 'openStatements', 'selectPeriod', 'snapshot', 'exportCsv', 'finish', 'diagnostic']) assert.equal(typeof ui[k], 'function', 'logout:staged-ui ' + k);
      const bank = await import(pathToFileURL(path.join(into, BANK)).href); assert.equal(bank.adapterFor('paypay', 'standard'), bank.ADAPTERS.paypay.variants.standard, 'logout:staged-adapter');
      return Object.keys(manifest.files || {}).length + ' files staged; staged paypay.mjs sha256 ' + repo.slice(0, 12) + '… equals the repo; it loads and builds the routine ui';
    });
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
  return { pass, counts, message: `${pass ? 'green' : 'RED'} in ${Math.round((Date.now() - started) / 1000)}s; legs ${counts.green}/${counts.legs} green; unit ${counts.unitTests}, mutants ${counts.mutantsCaught}/${counts.mutantsTotal}\n` + lines.join('\n') };
} };
