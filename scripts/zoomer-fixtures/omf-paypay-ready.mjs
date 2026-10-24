// Fixture for plan omf-paypay-ready-20261024: the routine PayPay statement page is recognized while still loading and its one 期間選択
// press came before the page's handlers. Run ONLY through the hub verifier:
//   node scripts/zoomer-verify.mjs --run-fixture omf-paypay-ready.mjs --cwd <this worktree>
// Evidence basis, stated exactly: synthetic only. The fake pages replay the mechanism of the parent's value-free native trace and fictional
// proof (hub output/plan/omf-paypay-ready-20261024 CAUSE.md / OBSERVATION.json / READINESS-POC.json): controls parsed and visible first,
// handlers attached later. No live listener-registration timing was measured, so nothing here claims the real portal attaches its handlers
// this way. Every page of every owned HEADLESS Chrome is served by request interception; host resolution is refused for everything else.
// No bank, database, owner AppData, ordinary browser or OS input is touched.
// Fail-first on daa4ec3 (behaviour, not a missing file): the delayed-handler statement page gets exactly one 期間選択 press while loading,
// before its handlers attach; it is lost, the six fields stay hidden, the step ends period-unidentified with no query and no export.
// Legs: U1 the new paypay-ready test (TAP per test; a failing `setup:` assertion or a harness error is reported as SETUP FAILURE, never as
// behavioural RED); U2 the affected legacy PayPay and shared bank/楽天銀行 collector tests (unit regression, unchanged files); M the
// named mutants — this plan's R-M1…R-M9 on the new test and the live-period L-M1…L-M8 (the period step and its failure diagnostic, the
// lane this change feeds); P the staged customer package carries and loads the exact changed adapter. M and P run only on a green U1 and
// U2 (a mutant needs a green control).
// Not re-run, with the reason (parent continuation note, build-01 GUARD-CALLER-AUDIT.md): the routine C-M1…C-M18 and logout G-M1…G-M8 —
// their guard bodies are byte-identical at this commit; their behaviour is covered here by U2 only, and their earlier mutation evidence
// (1262ca3) is historical. C-M14/C-M16/C-M19 and the native/HTTP walkthroughs — collector/bank.mjs, index.mjs, browser.mjs, the daemon,
// the server and the importer are unchanged.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 7200000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COVERS = ['collector/banks/paypay.mjs', 'collector/test/paypay-ready.test.mjs', 'docs/paypay-bank-connection.md', 'scripts/zoomer-fixtures/omf-paypay-ready.mjs'];
const run = (args, env = {}, timeout = 2400000) => new Promise(resolve => execFile(process.execPath, args, { cwd: root, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', ...env } }, (e, stdout, stderr) => resolve({ code: e ? e.code ?? 1 : 0, killed: !!e?.killed, stdout: String(stdout), stderr: String(stderr) })));
// OMF_READY_EVIDENCE_DIR (optional, an existing directory): the complete stdout/stderr of each child run is kept there, never truncated.
const keep = async (name, r) => { const dir = process.env.OMF_READY_EVIDENCE_DIR; if (dir) await writeFile(path.join(dir, 'child-' + name + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt'), 'exit ' + r.code + (r.killed ? ' (killed)' : '') + '\n--- stdout ---\n' + r.stdout + '\n--- stderr ---\n' + r.stderr, { flag: 'wx' }).catch(() => {}); return r; };
function tapReport(text) {
  const total = name => Number(text.match(new RegExp('^# ' + name + ' (\\d+)', 'm'))?.[1] ?? NaN);
  const tests = [...text.matchAll(/^(\s*)(ok|not ok) \d+ - (.+?)(?: # (SKIP|TODO).*)?$/gm)].filter(m => m[1].length <= 4).map(m => ({ ok: m[2] === 'ok', name: m[3].trim(), directive: m[4] || null }));
  return { tests: total('tests'), pass: total('pass'), fail: total('fail'), skipped: total('skipped'), todo: total('todo'), cancelled: total('cancelled'), list: tests };
}
// A sibling copy of a module with named edits (each exact anchor must hit exactly once) or one `// guard:<name>` line removed (same rule as
// omf-paypay-routine.mjs / omf-paypay-logout.mjs; an anchor that does not hit exactly once is a harness failure, never a catch).
async function mutantModule(file, { guard = null, edits = [] } = {}) {
  const source = path.join(root, file); let text = (await readFile(source, 'utf8')).replace(/\r\n/g, '\n');
  if (guard) { const lines = text.split('\n'), hits = lines.filter(l => l.includes('// guard:' + guard + ' ') || l.trimEnd().endsWith('// guard:' + guard)); if (hits.length !== 1) throw new Error('FAIL guard marker hits ' + hits.length + ' for ' + guard); lines.splice(lines.indexOf(hits[0]), 1); text = lines.join('\n'); }
  for (const [anchor, replacement] of edits) { const hits = text.split(anchor).length - 1; if (hits !== 1) throw new Error('FAIL mutant anchor hits ' + hits + ' for ' + file + ' ' + anchor.slice(0, 70)); text = text.replace(anchor, () => replacement); }
  const ext = file.endsWith('.test.mjs') ? '.test.mjs' : '.mjs', target = path.join(path.dirname(source), path.basename(file, ext) + `.mutant-${process.pid}-${randomUUID().slice(0, 8)}${ext}`);
  await writeFile(target, text, { flag: 'wx' });
  return { file: target, async dispose() { await unlink(target).catch(() => {}); } };
}
const PAYPAY = 'collector/banks/paypay.mjs', BANK = 'collector/bank.mjs', READY_TEST = 'collector/test/paypay-ready.test.mjs', ROUTINE_TEST = 'collector/test/paypay-routine.test.mjs', LIVE_TEST = 'collector/test/paypay-live-period.test.mjs', LOGOUT_TEST = 'collector/test/paypay-logout.test.mjs';
const LEGACY = [ROUTINE_TEST, LIVE_TEST, LOGOUT_TEST, 'collector/test/paypay-standard.test.mjs', 'collector/test/paypay-guided-capture.test.mjs', 'collector/test/paypay-setup.test.mjs', 'collector/test/rakuten-standard.test.mjs', 'collector/test/rakuten-auto-login.test.mjs', 'collector/test/rakuten-setup.test.mjs'];
const PREDICATE = "ready: document.readyState === 'complete' || (document.readyState !== 'loading' && nav?.domContentLoadedEventEnd > 0)";
const WAIT = 'const ready = await settled(seen?.document || null); // guard:routine-period-ready';
const TIMEOUT = "throw coded('period-unidentified', `${label}の入出金明細の画面が読み込みを終える前に変わったか、読み込みが終わりませんでした（期間選択は押していません）。Chromeを確認してください`); // guard:routine-period-ready-timeout";
const PERIOD_PRESS = "await press('link', c.period, [c.statements.title], 'period-unidentified', ready);";
// This plan's named defects, each caught by its named assertion in the new test.
export const READY_MUTANTS = [
  { name: 'R-M1-readiness-wait-removed', edits: [[WAIT, 'const ready = null; // guard:routine-period-ready']], test: 'delayed handlers', expect: /ready:one-handled-click blocking/ },
  { name: 'R-M2-always-ready', edits: [[PREDICATE, 'ready: true']], test: 'delayed handlers', expect: /ready:one-handled-click blocking/ },
  { name: 'R-M3-window-end-taken-as-ready', edits: [[TIMEOUT, 'return doc; // guard:routine-period-ready-timeout']], test: 'never ready', expect: /ready:never-ready-no-press/ },
  { name: 'R-M4-interactive-before-domcontentloaded', edits: [[PREDICATE, "ready: document.readyState !== 'loading'"]], test: 'delayed handlers', expect: /ready:one-handled-click defer/ },
  { name: 'R-M5-press-not-bound-to-ready-document', edits: [[PERIOD_PRESS, "await press('link', c.period, [c.statements.title], 'period-unidentified');"]], test: 'another document', expect: /ready:no-press between-ready-and-press/ },
  { name: 'R-M6-document-change-ignored', guard: 'routine-period-ready-document', test: 'another document', expect: /ready:stops-promptly moved-loading/ },
  // a finite overrun of the step window (three windows): the test's deadline catches it without leaving an endless poll in the child
  { name: 'R-M7-step-window-overrun', edits: [['const end = Date.now() + stepMs; // guard:routine-period-ready-bound', 'const end = Date.now() + stepMs * 3; // guard:routine-period-ready-bound']], test: 'never ready', expect: /ready:never-ready-bounded/ },
  { name: 'R-M8-dialog-ignored', guard: 'routine-period-ready-dialog', test: 'a dialog during the wait', expect: /ready:dialog-stops/ },
  { name: 'R-M9-no-recheck-on-ready-document', guard: 'routine-period-ready-recheck', test: 'page initialization', expect: /ready:init-shown-no-press/ }
];
const envOf = (file, target) => ({ [file === PAYPAY ? 'OMF_TEST_PAYPAY_MODULE' : 'OMF_TEST_BANK_MODULE']: target });
const HARNESS = /FAIL mutant|FAIL guard|ERR_MODULE_NOT_FOUND|SyntaxError|Failed to launch|Could not find Chrome|ENOENT.*chrome/i;

export default { name: 'omf-paypay-ready', covers: COVERS, async run() {
  const started = Date.now(), lines = []; let pass = true, newGreen = false, legacyGreen = false;
  const counts = { legs: 0, green: 0, unitTests: 0, mutantsCaught: 0, mutantsTotal: 0, setupFailures: 0 };
  const leg = async (name, fn) => { counts.legs++; const t = Date.now(); try { lines.push(name + ': ' + await fn() + ` (${Math.round((Date.now() - t) / 1000)}s)`); counts.green++; return true; } catch (e) { pass = false; lines.push(name + ': ' + (e?.setup ? 'SETUP FAILURE ' : 'RED ') + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 4000)); return false; } };
  const assert = (await import('node:assert/strict')).default;
  if (process.platform !== 'win32') return { pass: false, message: 'owned Chrome and the collector need Windows' };
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-paypay-ready-fixture-'));
  const unit = async (name, files, named, prefix) => {
    const r = await keep(name, await run(['--test', '--test-concurrency=1', '--test-reporter=tap', ...files], {}, 5400000)), t = tapReport(r.stdout), failed = t.list.filter(x => !x.ok), directives = t.list.filter(x => x.directive);
    counts.unitTests += Number.isFinite(t.pass) ? t.pass : 0;
    const detail = (r.stdout.split('\n').filter(l => /ready:|setup:|logout:|live-period:|paypay-routine:|paypay:|auto-login:|code: '|AssertionError|actual:|expected:/.test(l)).slice(0, 40).join(' | ') || r.stderr.slice(-800)).slice(0, 3200);
    // a setup assertion, a harness error or no test result at all is a setup failure — never relabelled as the behavioural RED
    const setup = HARNESS.test(r.stdout + r.stderr) || /error:\s*(?:\|-?\s*\n\s*)?['"]?setup:/.test(r.stdout) || failed.some(x => /^setup:/.test(x.name)) || !(t.tests > 0);
    if (r.code !== 0 || t.fail || !(t.pass > 0) || t.skipped || t.todo || t.cancelled || directives.length || t.pass !== t.tests) throw Object.assign(new Error(`node --test exit ${r.code} tests ${t.tests} pass ${t.pass} fail ${t.fail} skipped ${t.skipped} todo ${t.todo} cancelled ${t.cancelled}; failing: ` + failed.map(x => x.name.slice(0, 110)).join(' | ') + ' :: ' + detail), { setup });
    for (const n of named) assert.ok(t.list.some(x => x.ok && n.test(x.name)), prefix + ':unit-test-present ' + n.source);
    return `${t.pass}/${t.tests} tests green, 0 skipped/todo/cancelled; ${named.length} named tests present`;
  };
  try {
    // ── U1: the new behaviour-first test ──
    newGreen = await leg('U1 new test (node --test, TAP): paypay-ready', () => unit('U1', [READY_TEST], [/^setup: the fictional replica itself/, /^delayed handlers:/, /^already ready and normal views keep their contract/, /^page initialization that shows the period fields itself/, /^never ready:/, /^another document, title, login page or origin during the wait/, /^a dialog during the wait is never answered/, /^ambiguity or a non-select date field/, /^end to end \(collectBankFromPage\): a slowly initializing statement page/, /^end to end: a statement page that never finishes loading/], 'ready'));
    if (!newGreen && /SETUP FAILURE/.test(lines.at(-1))) counts.setupFailures++;
    // ── U2: the affected legacy collector tests (unchanged files) ──
    legacyGreen = await leg('U2 legacy collector tests (node --test, TAP): paypay-routine, paypay-live-period, paypay-logout, paypay-standard, paypay-guided-capture, paypay-setup, rakuten-standard, rakuten-auto-login, rakuten-setup', () => unit('U2', LEGACY, [/^happy path: one native submission reaches the Welcome page directly/, /^hidden duplicate date fields before the visible ones/, /^fail closed before any CSV/, /^actual-shaped empty default view/, /^private diagnostics on a failure/, /^a broken diagnostic never changes the result/, /^the observed logout confirm after the job's own/, /^dialogs before the own ログアウト press are never answered/, /^a confirm dialog on CSV is never accepted/], 'legacy'));
    if (!legacyGreen && /SETUP FAILURE/.test(lines.at(-1))) counts.setupFailures++;
    const unitGreen = newGreen && legacyGreen;
    if (!unitGreen) { lines.push('M, P: NOT RUN — U1/U2 not green (a mutant is only meaningful against a green control)'); counts.legs += 2; }
    // ── M: deliberately reintroduced defects, each caught by its named assertion ──
    if (unitGreen) await leg('M mutants: R-M1…R-M9 (this plan, new test), live-period L-M1…L-M8 (live-period test); routine C and logout G not re-run (unchanged guard bodies)', async () => {
      const caught = [], flip = async (name, expect, fn) => {
        counts.mutantsTotal++; const r = await fn(), text = r.stdout + '\n' + r.stderr;
        if (/FAIL mutant|FAIL guard|ERR_MODULE_NOT_FOUND|SyntaxError/.test(text)) throw new Error(name + ' harness failure: ' + text.replace(/\s+/g, ' ').slice(-600));
        if (r.code === 0 || !expect.test(text)) throw new Error(name + ' did not flip ' + expect + ' (exit ' + r.code + '): ' + (text.split('\n').filter(l => /AssertionError|ready:|logout:|live-period:|paypay-routine:|Error/.test(l)).slice(0, 6).join(' | ') || text.slice(-500)).slice(0, 700));
        caught.push(name); counts.mutantsCaught++;
      };
      for (const m of READY_MUTANTS) {
        const mod = await mutantModule(PAYPAY, { guard: m.guard || null, edits: m.edits || [] });
        try { await flip(m.name, m.expect, async () => keep('M-' + m.name, await run(['--test', '--test-concurrency=1', '--test-name-pattern=' + m.test, READY_TEST], envOf(PAYPAY, mod.file), 1500000))); } finally { await mod.dispose(); }
      }
      const { LIVE_MUTANTS } = await import(pathToFileURL(path.join(root, 'scripts/zoomer-fixtures/omf-paypay-live-period.mjs')).href);
      for (const m of LIVE_MUTANTS) {
        const mods = []; try { for (const p of m.parts) mods.push({ file: p.file, mod: await mutantModule(p.file, { guard: p.guard || null, edits: p.edits || [] }) });
          const env = Object.assign({}, ...mods.map(x => envOf(x.file, x.mod.file)));
          await flip(m.name, m.expect, async () => keep('M-' + m.name, await run(['--test', '--test-concurrency=1', '--test-name-pattern=' + m.test, LIVE_TEST], env, 1200000)));
        } finally { for (const x of mods) await x.mod.dispose(); }
      }
      // routine C and logout G: NOT run as mutants; each anchor/marker must still hit exactly once in the changed module (its guard
      // text is unchanged) — the copy is built and discarded, no test runs and no catch is claimed for them
      const { MUTANTS } = await import(pathToFileURL(path.join(root, 'scripts/zoomer-fixtures/omf-paypay-routine.mjs')).href), { LOGOUT_MUTANTS } = await import(pathToFileURL(path.join(root, 'scripts/zoomer-fixtures/omf-paypay-logout.mjs')).href);
      const anchored = [];
      for (const m of [...MUTANTS.filter(x => x.file === PAYPAY), ...LOGOUT_MUTANTS.map(x => ({ ...x, file: PAYPAY }))]) { const mod = await mutantModule(m.file, { guard: m.guard || null, edits: m.edits || [] }); await mod.dispose(); anchored.push(m.name); }
      return caught.length + '/' + counts.mutantsTotal + ' mutants caught: ' + caught.join(', ') + '; not run, anchors still exact in the changed module: ' + anchored.join(', ');
    });
    // ── P: the customer package carries the exact changed adapter, and the staged copy itself loads ──
    if (unitGreen) await leg('P package: stage (no install) carries banks/paypay.mjs with its repo hash; the staged copy itself loads and builds the routine ui', async () => {
      const { stage } = await import(pathToFileURL(path.join(root, 'collector/package/stage.mjs')).href), into = path.join(temp, 'staged');
      const { manifest } = await stage({ into, origin: 'https://omf.example', install: false, log: () => {} });
      const sha = bytes => createHash('sha256').update(bytes).digest('hex'), repo = sha(await readFile(path.join(root, PAYPAY))), staged = sha(await readFile(path.join(into, PAYPAY)));
      assert.equal(manifest.files?.[PAYPAY], repo, 'ready:staged-hash'); assert.equal(staged, repo, 'ready:staged-bytes');
      assert.ok((await readFile(path.join(into, PAYPAY), 'utf8')).includes('guard:routine-period-ready'), 'ready:staged-carries-readiness');
      const mod = await import(pathToFileURL(path.join(into, PAYPAY)).href), ui = mod.standard.ui({}, {}, null);
      for (const k of ['open', 'login', 'openStatements', 'selectPeriod', 'snapshot', 'exportCsv', 'finish', 'diagnostic']) assert.equal(typeof ui[k], 'function', 'ready:staged-ui ' + k);
      await assert.rejects(ui.selectPeriod(null), e => e?.code === 'period-required', 'ready:staged-period-required-before-page');
      const bank = await import(pathToFileURL(path.join(into, BANK)).href); assert.equal(bank.adapterFor('paypay', 'standard'), bank.ADAPTERS.paypay.variants.standard, 'ready:staged-adapter');
      return Object.keys(manifest.files || {}).length + ' files staged; staged paypay.mjs sha256 ' + repo.slice(0, 12) + '… equals the repo; it loads and builds the routine ui';
    });
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
  return { pass, counts, message: `${pass ? 'green' : 'RED'} in ${Math.round((Date.now() - started) / 1000)}s; legs ${counts.green}/${counts.legs} green; unit ${counts.unitTests}, mutants ${counts.mutantsCaught}/${counts.mutantsTotal}, setup failures ${counts.setupFailures}\n` + lines.join('\n') };
} };
