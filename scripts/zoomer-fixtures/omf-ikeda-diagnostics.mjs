// Fixture for plan omf-ikeda-trace-20261030: private, value-free 池田泉州銀行 sign-in diagnostics on actual statement and balance jobs
// (collector/banks/ikeda.mjs authDiagnostic(), recorded by collector/bank.mjs and collector/bank-balance.mjs). Run ONLY through the hub verifier:
//   node C:/Users/Junsan2/Documents/ohmycode/scripts/zoomer-verify.mjs --run-fixture omf-ikeda-diagnostics --cwd <this worktree>
// Evidence basis, stated exactly: synthetic only. collector/test/ikeda-diagnostics.test.mjs drives the real modules on owned HEADLESS Chrome
// against the fictional BusinessGate of omf-ikeda-collector.mjs (request interception; host resolution refused for everything else) with a
// fictional certificate helper. The old failed job (ed791288) kept no helper/page/network timeline: nothing here replays or explains it, and
// nothing proves what the real portal or chooser does. No bank, database, owner AppData, credential, certificate store, ordinary browser,
// cursor or keyboard is touched.
// Legs: F fail-first — the new test against the exact 74f49b34 modules (git blobs as sibling copies, the balance copy's imports pointed at
// the baseline bank/ikeda copies) fails, and ONLY at its named missing-record assertions (every business assertion before them passes on
// the baseline); U the new test plus the affected collector suites, each a complete green TAP run (no skip/todo/cancel); M the named
// mutants, each caught by its named assertion; P the staged customer package carries the three changed runtime files (already allowlisted)
// and they load without node_modules with the reader and the whitelist. M and P run only on a green U.
// Test processes run at Normal priority through the exported preload of omf-ikeda-balance-freshness.mjs (imported, never edited; the
// verifier's own children run at Idle). Its qualified legacy copies are not used here: every suite runs from its own unchanged file.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 7200000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IKEDA = 'collector/banks/ikeda.mjs', BANK = 'collector/bank.mjs', BALANCE = 'collector/bank-balance.mjs', TEST = 'collector/test/ikeda-diagnostics.test.mjs', BASE = '74f49b348eaf402e19360f17f027b8eedfde78a0';
const COVERS = [IKEDA, BANK, BALANCE, 'docs/bank-balances.md', TEST, 'scripts/zoomer-fixtures/omf-ikeda-diagnostics.mjs'];
// The affected suites: every collector test importing a changed module (bank.mjs, bank-balance.mjs or banks/ikeda.mjs), except frame-init
// (it imports none of them; it reads browser.mjs). Each runs from its own unchanged file.
const LEGACY = ['collector/test/ikeda-portal.test.mjs', 'collector/test/bank-balance.test.mjs', 'collector/test/ikeda-balance-freshness.test.mjs', 'collector/test/paypay-live-period.test.mjs', 'collector/test/paypay-routine.test.mjs', 'collector/test/paypay-logout.test.mjs', 'collector/test/paypay-ready.test.mjs', 'collector/test/paypay-standard.test.mjs', 'collector/test/paypay-guided-capture.test.mjs', 'collector/test/rakuten-standard.test.mjs', 'collector/test/rakuten-auto-login.test.mjs'];
const ENV = { MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '' };
const ENV_OF = { [IKEDA]: 'OMF_TEST_IKEDA_MODULE', [BANK]: 'OMF_TEST_BANK_MODULE', [BALANCE]: 'OMF_TEST_BALANCE_MODULE' };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (file, args, env = {}, timeout = 600000) => new Promise(resolve => execFile(file, args, { cwd: root, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, ...ENV, ...env } }, (e, stdout, stderr) => resolve({ code: e ? e.code ?? 1 : 0, killed: !!e?.killed, stdout: String(stdout), stderr: String(stderr) })));
// OMF_IKEDA_DIAGNOSTICS_EVIDENCE_DIR (optional, an existing directory): the complete stdout/stderr of each child run is kept there.
const keep = async (name, r) => { const dir = process.env.OMF_IKEDA_DIAGNOSTICS_EVIDENCE_DIR; if (dir) await writeFile(path.join(dir, 'child-' + name + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt'), 'exit ' + r.code + (r.killed ? ' (killed)' : '') + '\n--- stdout ---\n' + r.stdout + '\n--- stderr ---\n' + r.stderr + '\n--- priorities ---\n' + JSON.stringify({ preload: r.preload ?? null, samples: r.samples ?? null }, null, 2), { flag: 'wx' }).catch(() => {}); return r; };
function tapReport(text) {
  const total = name => Number(text.match(new RegExp('^# ' + name + ' (\\d+)', 'm'))?.[1] ?? NaN);
  const tests = [...text.matchAll(/^(\s*)(ok|not ok) \d+ - (.+?)(?: # (SKIP|TODO).*)?$/gm)].filter(m => m[1].length <= 4).map(m => ({ ok: m[2] === 'ok', name: m[3].trim(), directive: m[4] || null }));
  return { tests: total('tests'), pass: total('pass'), fail: total('fail'), skipped: total('skipped'), todo: total('todo'), cancelled: total('cancelled'), list: tests };
}
const green = t => t.fail === 0 && t.pass > 0 && t.pass === t.tests && !t.skipped && !t.todo && !t.cancelled && !t.list.some(x => x.directive);
// A sibling copy of a module (so its relative imports resolve) with named edits (each exact anchor must hit exactly once) or one
// `// guard:<name>` line removed; `imports` rewrites import specifiers. An anchor or marker that does not hit exactly once is a harness
// failure, never a catch.
async function sibling(file, text, tag) {
  const source = path.join(root, file), target = path.join(path.dirname(source), path.basename(file, '.mjs') + `.${tag}-${process.pid}-${randomUUID().slice(0, 8)}.mjs`);
  await writeFile(target, text, { flag: 'wx' });
  return { file: target, async dispose() { await unlink(target).catch(() => {}); } };
}
function edit(text, file, { guard = null, edits = [] } = {}) {
  text = text.replace(/\r\n/g, '\n');
  if (guard) { const lines = text.split('\n'), hits = lines.filter(l => l.includes('// guard:' + guard + ' ') || l.trimEnd().endsWith('// guard:' + guard)); if (hits.length !== 1) throw new Error('FAIL guard marker hits ' + hits.length + ' for ' + guard); lines.splice(lines.indexOf(hits[0]), 1); text = lines.join('\n'); }
  for (const [anchor, replacement] of edits) { const hits = text.split(anchor).length - 1; if (hits !== 1) throw new Error('FAIL mutant anchor hits ' + hits + ' for ' + file + ' ' + anchor.slice(0, 80)); text = text.replace(anchor, () => replacement); }
  return text;
}

const LOGIN_CATCH = '.catch(async error => { await loginFailed(error); throw error; }); }';
const READ_BOUND = 'export const diagnosticRead = fn => within(fn, DIAGNOSTIC_MS);';
const WRITE_BOUND = 'export const diagnosticWrite = (root, bound, fields) => within(() => persistDiagnostic(root, bound, diagnosticRecord({ bound, ...fields })), DIAGNOSTIC_MS);';
// This plan's named defects, each caught by its named assertion in the new test (the name pattern selects only that test).
export const DIAGNOSTIC_MUTANTS = [
  { name: 'D-M1-statement-login-stage-not-recorded', parts: [{ file: BANK, edits: [[LOGIN_CATCH, '.catch(async error => { throw error; }); }']] }], test: '^statement, pre-password failures', expect: /ikeda-diag:login-stage-persisted no-dialog/ },
  { name: 'D-M2-balance-not-recorded', parts: [{ file: BALANCE, guard: 'balance-auth-diagnostic' }], test: '^balance, pre-password failures', expect: /ikeda-diag:balance-login-stage-persisted no-dialog/ },
  { name: 'D-M3-helper-outcome-not-whitelisted', parts: [{ file: BANK, edits: [['outcome: one(e?.outcome, AUTH_OUTCOMES)', 'outcome: e?.outcome ?? null']] }], test: '^statement, pre-password failures', expect: /ikeda-diag:no-private hostile-helper HELPERCANARY9914/ },
  { name: 'D-M4-raw-page-surface', parts: [{ file: IKEDA, edits: [["const surfaceOf = x => x.top !== true ? 'frame'", "const surfaceOf = x => x.origin + x.path; void (x => x.top !== true ? 'frame'"], ["x.origin === c.bank ? 'bank-site' : 'other';", "x.origin === c.bank ? 'bank-site' : 'other');"]] }, { file: BANK, edits: [['surface: one(x?.surface, AUTH_SURFACES)', 'surface: x?.surface ?? null']] }], test: '^statement, pre-password failures', expect: /ikeda-diag:no-private no-dialog/ },
  { name: 'D-M5-sign-in-error-swallowed', parts: [{ file: BANK, edits: [[LOGIN_CATCH, '.catch(async error => { await loginFailed(error); }); }']] }], test: '^statement, pre-password failures', expect: /ikeda-diag:pre-password-(no-result|same-error) no-dialog/ },
  { name: 'D-M6-balance-logout-without-sign-in', parts: [{ file: BALANCE, edits: [['finally { if (signed) logout = ', 'finally { if (true) logout = ']] }], test: '^balance, pre-password failures', expect: /ikeda-diag:balance-same-result no-dialog/ },
  { name: 'D-M7-reader-requests', parts: [{ file: IKEDA, edits: [['const current = waiting ? null : await evaluate(READ, c, 2500);', "await evaluate(() => fetch(location.href).then(() => true, () => false), null, 2500); const current = waiting ? null : await evaluate(READ, c, 2500);"]] }], test: '^statement, selected and the page moves on', expect: /ikeda-diag:no-extra-request-or-action/ },
  { name: 'D-M8-reader-unbounded', parts: [{ file: BANK, edits: [[READ_BOUND, 'export const diagnosticRead = fn => Promise.resolve().then(fn).catch(() => null);']] }], test: '^a broken diagnostic never changes', expect: /ikeda-diag:diagnostic-bounded/ },
  { name: 'D-M9-write-failure-escapes', parts: [{ file: BANK, edits: [[WRITE_BOUND, 'export const diagnosticWrite = (root, bound, fields) => persistDiagnostic(root, bound, diagnosticRecord({ bound, ...fields }));']] }], test: '^a broken diagnostic never changes', expect: /ikeda-diag:unwritable-same-result/ },
  { name: 'D-M10-events-uncapped', parts: [{ file: BANK, edits: [['events: list.slice(0, AUTH_EVENTS_MAX).map(', 'events: list.map(']] }], test: '^record \\(pure\\)', expect: /ikeda-diag:events-capped/ }
];
// Each mutant part becomes a sibling copy; a changed bank.mjs or banks/ikeda.mjs is also wired into a sibling copy of bank-balance.mjs
// (its own imports) so the balance path sees the same mutant.
async function wire(parts, read) {
  const mods = {}, made = [];
  try {
    for (const p of parts) { const m = await sibling(p.file, edit(await read(p.file), p.file, p), 'mutant'); made.push(m); mods[p.file] = m.file; }
    if ((mods[BANK] || mods[IKEDA]) && !mods[BALANCE]) {
      const imports = []; if (mods[BANK]) imports.push(["from './bank.mjs';", `from './${path.basename(mods[BANK])}';`]); if (mods[IKEDA]) imports.push(["from './banks/ikeda.mjs';", `from './banks/${path.basename(mods[IKEDA])}';`]);
      const m = await sibling(BALANCE, edit(await read(BALANCE), BALANCE, { edits: imports }), 'wired'); made.push(m); mods[BALANCE] = m.file;
    } else if (mods[BALANCE] && (mods[BANK] || mods[IKEDA])) throw new Error('FAIL harness: a balance mutant together with a bank/ikeda part is not wired');
    return { env: Object.fromEntries(Object.entries(mods).map(([f, t]) => [ENV_OF[f], t])), async dispose() { for (const m of made) await m.dispose(); } };
  } catch (e) { for (const m of made) await m.dispose(); throw e; }
}
const current = rel => readFile(path.join(root, rel), 'utf8');

export default { name: 'omf-ikeda-diagnostics', covers: COVERS, async run() {
  const started = Date.now(), lines = []; let pass = true, unitGreen = false;
  const counts = { legs: 0, green: 0, unitTests: 0, suites: 0, mutantsCaught: 0, mutantsTotal: 0, failFirstRed: 0 };
  const leg = async (name, fn) => { counts.legs++; const t = Date.now(); try { lines.push(name + ': ' + await fn() + ` (${Math.round((Date.now() - t) / 1000)}s)`); counts.green++; return true; } catch (e) { pass = false; lines.push(name + ': RED ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 3000)); return false; } };
  const assert = (await import('node:assert/strict')).default;
  if (process.platform !== 'win32') return { pass: false, message: 'owned Chrome and the collector need Windows' };
  const { nodeTest, normalProof } = await import(pathToFileURL(path.join(root, 'scripts/zoomer-fixtures/omf-ikeda-balance-freshness.mjs')).href);
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-ikeda-diagnostics-fixture-'));
  try {
    // ── F ──
    await leg('F fail-first: the new test against the exact ' + BASE.slice(0, 8) + ' modules fails only at its named missing-record assertions', async () => {
      const blob = async rel => { const r = await run('git', ['show', BASE + ':' + rel]); if (r.code !== 0) throw new Error('baseline ' + rel + ' not readable: ' + r.stderr.slice(0, 200)); return r.stdout; };
      const [ik, bk, bb] = await Promise.all([blob(IKEDA), blob(BANK), blob(BALANCE)]);
      if (/authDiagnostic|diagnosticWrite/.test(ik + bk + bb)) throw new Error('the baseline copies already hold the change');
      const ikm = await sibling(IKEDA, ik, 'baseline'), bkm = await sibling(BANK, bk, 'baseline');
      const bbm = await sibling(BALANCE, edit(bb, BALANCE, { edits: [["from './bank.mjs';", `from './${path.basename(bkm.file)}';`], ["from './banks/ikeda.mjs';", `from './banks/${path.basename(ikm.file)}';`]] }), 'baseline');
      try {
        const r = await keep('F-baseline', await nodeTest(['--test', '--test-concurrency=1', '--test-reporter=tap', TEST], { OMF_TEST_IKEDA_MODULE: ikm.file, OMF_TEST_BANK_MODULE: bkm.file, OMF_TEST_BALANCE_MODULE: bbm.file }, 2400000, temp)), t = tapReport(r.stdout), text = r.stdout + '\n' + r.stderr;
        if (/ERR_MODULE_NOT_FOUND|SyntaxError/.test(text)) throw new Error('harness failure: ' + text.replace(/\s+/g, ' ').slice(-500));
        const p = normalProof(r, 'F');
        assert.notEqual(r.code, 0, 'diag:baseline-red exit');
        // every failed test failed at a missing-record assertion; no business assertion (result, text, submission, logout) failed
        const errors = [...r.stdout.matchAll(/^  error: (?:'([^'\n]*)'|\|-\n {4}([^\n]*))/gm)].map(m => m[1] ?? m[2]);
        const missing = /^ikeda-diag:(fixed-schema top pure|recorded-before-cleanup|login-stage-persisted |one-record |balance-login-stage-persisted |concurrent-one-each)/;
        assert.equal(errors.length, t.fail, 'diag:baseline-one-error-per-failed-test ' + errors.length + '/' + t.fail);
        assert.deepEqual(errors.filter(e => !missing.test(e)), [], 'diag:baseline-only-missing-records');
        assert.equal(t.fail, t.tests, 'diag:baseline-every-test-red'); counts.failFirstRed = t.fail;
        return `baseline blobs ${BASE.slice(0, 8)}: ${t.fail}/${t.tests} red, each at its missing-record assertion (${[...new Set(errors.map(e => e.split(' ')[0]))].join(', ')}); ${p.testProcesses} test process(es) Normal`;
      } finally { await ikm.dispose(); await bkm.dispose(); await bbm.dispose(); }
    });
    // ── U ──
    unitGreen = await leg('U the new test and the affected collector suites (' + LEGACY.length + '), each from its own file, complete green TAP', async () => {
      const out = [], bad = [];
      for (const file of [TEST, ...LEGACY]) {
        const r = await keep('U-' + path.basename(file, '.test.mjs'), await nodeTest(['--test', '--test-concurrency=1', '--test-reporter=tap', file], {}, 2700000, temp)), t = tapReport(r.stdout);
        normalProof(r, 'U ' + file); counts.suites++; counts.unitTests += t.pass || 0;
        out.push(`${path.basename(file)} ${t.pass}/${t.tests}`);
        if (r.code !== 0 || !green(t)) bad.push(`${file} exit ${r.code}${r.killed ? ' (killed)' : ''} tests ${t.tests} pass ${t.pass} fail ${t.fail} skipped ${t.skipped} todo ${t.todo} cancelled ${t.cancelled}; failing: ${t.list.filter(x => !x.ok).map(x => x.name.slice(0, 90)).join(' | ')} :: ` + (r.stdout.split('\n').filter(l => /error: |AssertionError|:[a-z-]+ /.test(l)).slice(0, 10).join(' | ') || r.stderr.slice(-500)).slice(0, 1500));
      }
      if (bad.length) throw new Error(out.join('; ') + ' ;; ' + bad.join(' ;; '));
      return out.join('; ') + `; ${counts.unitTests} tests green in ${counts.suites} suites, 0 skipped/todo/cancelled`;
    });
    if (!unitGreen) { lines.push('M, P: NOT RUN — U is red (a mutant is only meaningful against a green control)'); counts.legs += 2; }
    // ── M ──
    if (unitGreen) await leg('M mutants: D-M1…D-M' + DIAGNOSTIC_MUTANTS.length + ' (new test, named assertions)', async () => {
      const caught = [], missed = [];
      for (const m of DIAGNOSTIC_MUTANTS) {
        counts.mutantsTotal++;
        try {
          const w = await wire(m.parts, current);
          try {
            const r = await keep('M-' + m.name, await nodeTest(['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-name-pattern=' + m.test, TEST], w.env, 1200000, temp)), text = r.stdout + '\n' + r.stderr;
            if (/FAIL mutant|FAIL guard|ERR_MODULE_NOT_FOUND|SyntaxError/.test(text)) throw new Error(m.name + ' harness failure: ' + text.replace(/\s+/g, ' ').slice(-600));
            normalProof(r, m.name);
            if (!/^# tests [1-9]/m.test(r.stdout)) throw new Error(m.name + ' selected no test for ' + m.test);
            if (r.code === 0 || !m.expect.test(text)) throw new Error(m.name + ' did not flip ' + m.expect + ' (exit ' + r.code + '): ' + (text.split('\n').filter(l => /error: |ikeda-diag:/.test(l)).slice(0, 6).join(' | ') || text.slice(-500)).slice(0, 700));
            caught.push(m.name); counts.mutantsCaught++;
          } finally { await w.dispose(); }
        } catch (e) { missed.push(String(e?.message || e).slice(0, 700)); }
      }
      if (missed.length) throw new Error(caught.length + '/' + counts.mutantsTotal + ' caught (' + caught.join(', ') + '); NOT caught or harness failure: ' + missed.join(' ;; '));
      return caught.length + '/' + counts.mutantsTotal + ' mutants caught: ' + caught.join(', ');
    });
    // ── P ──
    if (unitGreen) await leg('P package: stage (no install) carries the three changed runtime files with their repo hashes; the staged copies load without node_modules and expose the reader, the bounded helpers and the whitelist', async () => {
      const { stage } = await import(pathToFileURL(path.join(root, 'collector/package/stage.mjs')).href), into = path.join(temp, 'staged');
      const { manifest } = await stage({ into, origin: 'https://omf.example', install: false, log: () => {} });
      for (const rel of [IKEDA, BANK, BALANCE]) assert.equal(manifest.files?.[rel], sha256(await readFile(path.join(root, rel))), 'diag:staged-hash ' + rel);
      assert.ok(!Object.keys(manifest.files || {}).some(f => f.includes('/test/') || /mutant|baseline|wired|zoomer/.test(f)), 'diag:no-test-code-staged');
      const url = rel => pathToFileURL(path.join(into, rel)).href;
      const stagedBank = await import(url(BANK)), stagedIkeda = await import(url(IKEDA)), stagedBalance = await import(url(BALANCE));
      assert.deepEqual([typeof stagedBank.diagnosticRead, typeof stagedBank.diagnosticWrite, typeof stagedBank.diagnosticCode, typeof stagedBalance.inquireFromPage], ['function', 'function', 'function', 'function'], 'diag:staged-helpers');
      assert.equal(typeof stagedIkeda.portalUi({}, {}).authDiagnostic, 'function', 'diag:staged-reader'); assert.equal(typeof stagedIkeda.portalBalance.ui({}, {}, null).authDiagnostic, 'function', 'diag:staged-balance-reader');
      const rec = stagedBank.diagnosticRecord({ bound: { provider: 'ikeda', bankAccountId: 'c3'.repeat(12), jobId: randomUUID() }, variant: 'portal', at: new Date(0).toISOString(), outcome: 'failed', step: 'login', code: 'uncoded', auth: { attention: 'secret', events: [{ event: 'moved', surface: 'https://secret', outcome: 'secret' }], current: { title: 'secret' } } });
      assert.ok(!JSON.stringify(rec).includes('secret'), 'diag:staged-whitelist'); assert.equal('auth' in stagedBank.diagnosticRecord({ bound: {}, at: 'x', outcome: 'failed', step: 'period' }), false, 'diag:staged-no-auth-without-trace');
      return Object.keys(manifest.files || {}).length + ' files staged; ikeda/bank/bank-balance hashes equal the repo; staged graph loads; whitelist drops raw values';
    });
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
  return { pass, counts, message: `${pass ? 'green' : 'RED'} in ${Math.round((Date.now() - started) / 1000)}s; legs ${counts.green}/${counts.legs} green; fail-first ${counts.failFirstRed} red at missing records; unit ${counts.unitTests} in ${counts.suites} suites; mutants ${counts.mutantsCaught}/${counts.mutantsTotal}\n` + lines.join('\n') };
} };
