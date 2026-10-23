// Fixture for plan omf-paypay-live-period-20261023: the actual default PayPay statement view (no CSV before the period query) and the
// private pre-cleanup diagnostics. Run ONLY through the hub verifier:
//   node scripts/zoomer-verify.mjs --run-fixture omf-paypay-live-period --cwd <this worktree>
// Evidence basis, stated exactly: synthetic only. The fake statement page follows the parent's value-free real-Chrome page shape (hub
// output/plan/omf-paypay-live-period-20261023/ACTUAL-BASELINE.md); its DOM is invented and proves nothing about the real portal. Every page
// of every owned HEADLESS Chrome is served by request interception; host resolution is refused for everything else. No bank, database,
// owner AppData, ordinary browser or OS input is touched. It does not reproduce or explain the unexplained 13:02 six-missing-field event.
// Fail-first on 93a5625 (behaviour, not a missing file): the actual-shaped statement page has no CSV before the requested-period query, so
// the unchanged classifier never recognizes it, openStatements stops with statements-unidentified and no query or original is reached.
// Legs: U the collector unit tests (TAP, per test; the new paypay-live-period test plus the affected legacy collector tests); M the named
// mutants — this plan's L-M1…L-M8 on the new test and the legacy C-M1…C-M18 (routine test) and C-M16 (楽天銀行 test) whose modules changed;
// P the customer package still carries and loads the changed modules. M and P run only on a green U (a mutant needs a green control).
// Not re-run, with the reason: C-M14 (collector/index.mjs unchanged), C-M19 and the native/HTTP walkthroughs (index.mjs, the daemon, the
// server and the importer are unchanged; see the build report for the source-linked compatibility of that prior evidence).
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 7200000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COVERS = ['collector/banks/paypay.mjs', 'collector/bank.mjs', 'collector/test/paypay-routine.test.mjs', 'collector/test/paypay-live-period.test.mjs', 'docs/paypay-bank-connection.md', 'scripts/zoomer-fixtures/omf-paypay-live-period.mjs'];
const run = (args, env = {}, timeout = 2400000) => new Promise(resolve => execFile(process.execPath, args, { cwd: root, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', ...env } }, (e, stdout, stderr) => resolve({ code: e ? e.code ?? 1 : 0, killed: !!e?.killed, stdout: String(stdout), stderr: String(stderr) })));
// OMF_LIVE_PERIOD_EVIDENCE_DIR (optional, an existing directory): the complete stdout/stderr of each child run is kept there, never truncated.
const keep = async (name, r) => { const dir = process.env.OMF_LIVE_PERIOD_EVIDENCE_DIR; if (dir) await writeFile(path.join(dir, 'child-' + name + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt'), 'exit ' + r.code + (r.killed ? ' (killed)' : '') + '\n--- stdout ---\n' + r.stdout + '\n--- stderr ---\n' + r.stderr, { flag: 'wx' }).catch(() => {}); return r; };
function tapReport(text) {
  const total = name => Number(text.match(new RegExp('^# ' + name + ' (\\d+)', 'm'))?.[1] ?? NaN);
  const tests = [...text.matchAll(/^(\s*)(ok|not ok) \d+ - (.+?)(?: # (SKIP|TODO).*)?$/gm)].filter(m => m[1].length <= 4).map(m => ({ ok: m[2] === 'ok', name: m[3].trim(), directive: m[4] || null }));
  return { tests: total('tests'), pass: total('pass'), fail: total('fail'), skipped: total('skipped'), todo: total('todo'), cancelled: total('cancelled'), list: tests };
}
// A sibling copy of a module with named edits (each exact anchor must hit exactly once) or one `// guard:<name>` line removed; `imports`
// rewrites import specifiers of the copy (a test file pointed at mutant module copies). Same rule as omf-paypay-routine.mjs.
async function mutantModule(file, { guard = null, edits = [], imports = [] } = {}) {
  const source = path.join(root, file); let text = (await readFile(source, 'utf8')).replace(/\r\n/g, '\n');
  if (guard) { const lines = text.split('\n'), hits = lines.filter(l => l.includes('// guard:' + guard + ' ') || l.trimEnd().endsWith('// guard:' + guard)); if (hits.length !== 1) throw new Error('FAIL guard marker hits ' + hits.length + ' for ' + guard); lines.splice(lines.indexOf(hits[0]), 1); text = lines.join('\n'); }
  for (const [anchor, replacement] of [...edits, ...imports]) { const hits = text.split(anchor).length - 1; if (hits !== 1) throw new Error('FAIL mutant anchor hits ' + hits + ' for ' + file + ' ' + anchor.slice(0, 70)); text = text.replace(anchor, () => replacement); }
  const ext = file.endsWith('.test.mjs') ? '.test.mjs' : '.mjs', target = path.join(path.dirname(source), path.basename(file, ext) + `.mutant-${process.pid}-${randomUUID().slice(0, 8)}${ext}`);
  await writeFile(target, text, { flag: 'wx' });
  return { file: target, async dispose() { await unlink(target).catch(() => {}); } };
}
const PAYPAY = 'collector/banks/paypay.mjs', BANK = 'collector/bank.mjs', LIVE_TEST = 'collector/test/paypay-live-period.test.mjs', ROUTINE_TEST = 'collector/test/paypay-routine.test.mjs';
const FINISH_LINE = "if (typeof ui.finish === 'function') finished = await Promise.race([Promise.resolve().then(() => ui.finish()).catch(() => null), pause(15000).then(() => null)]); // guard:finish-after-login";
const READER_LINE = "const page = reader && !completed ? await within(() => ui.diagnostic(), DIAGNOSTIC_MS) : null; // guard:diagnostic-before-finish";
const PERSIST_LINE = "if (reader) await within(() => persistDiagnostic(root, bound, diagnosticRecord({ bound, variant: adapter.variant ?? null, at: stamp(), outcome: completed ? 'completed' : 'failed', step, code, page, finish: finished })), DIAGNOSTIC_MS); // guard:diagnostic-persisted";
// This plan's named defects, each caught by its named assertion in the new test.
export const LIVE_MUTANTS = [
  { name: 'L-M1-csv-required-before-period', parts: [{ file: PAYPAY, guard: 'routine-statements-navigation' }], test: 'actual-shaped empty default view', expect: /live-period:empty-default-query-then-csv/ },
  { name: 'L-M2-statement-title-alone', parts: [{ file: PAYPAY, edits: [["if (read.title === c.statements.title && controls.filter(t => t === c.period).length === 1 && controls.includes(c.logout)) return 'statements';", "if (read.title === c.statements.title) return 'statements';"]] }], test: 'fail closed', expect: /live-period:two-period-links/ },
  { name: 'L-M3-diagnostic-dropped', parts: [{ file: BANK, guard: 'diagnostic-persisted' }], test: 'private diagnostics on a failure', expect: /live-period:recorded-before-cleanup/ },
  { name: 'L-M4-finish-outcome-discarded', parts: [{ file: BANK, edits: [[FINISH_LINE, FINISH_LINE.replace('finished = await', 'await')]] }], test: 'private diagnostics on a failure', expect: /live-period:finish-outcome-kept/ },
  { name: 'L-M5-diagnostic-after-logout', parts: [{ file: BANK, edits: [[READER_LINE, 'let page = null;'], [PERSIST_LINE, PERSIST_LINE.replace('if (reader) await within(', "if (reader && !completed) page = await within(() => ui.diagnostic(), DIAGNOSTIC_MS); if (reader) await within(")]] }], test: 'private diagnostics on a failure', expect: /live-period:diagnostic-before-logout/ },
  { name: 'L-M6-diagnostic-unbounded', parts: [{ file: BANK, edits: [[READER_LINE, READER_LINE.replace('await within(() => ui.diagnostic(), DIAGNOSTIC_MS)', 'await Promise.resolve().then(() => ui.diagnostic()).catch(() => null)')]] }], test: 'a broken diagnostic', expect: /live-period:diagnostic-bounded/ },
  { name: 'L-M7-raw-title-recorded', parts: [{ file: PAYPAY, edits: [["title: titles[t] || (/ - PayPay銀行$/.test(t) ? 'other-bank' : 'other'),", 'title: t,']] }, { file: BANK, edits: [["title: one(p.title, DIAGNOSTIC_TITLES),", 'title: p.title,']] }], test: 'private diagnostics on a failure', expect: /live-period:no-canary/ },
  { name: 'L-M8-write-failure-escapes', parts: [{ file: BANK, edits: [[PERSIST_LINE, PERSIST_LINE.replace('if (reader) await within(() => persistDiagnostic(', 'if (reader) await persistDiagnostic(').replace(')), DIAGNOSTIC_MS); // guard:diagnostic-persisted', ')); // guard:diagnostic-persisted')]] }], test: 'a broken diagnostic', expect: /live-period:unwritable-same-result/ }
];
const envOf = (file, target) => ({ [file === PAYPAY ? 'OMF_TEST_PAYPAY_MODULE' : 'OMF_TEST_BANK_MODULE']: target });

export default { name: 'omf-paypay-live-period', covers: COVERS, async run() {
  const started = Date.now(), lines = []; let pass = true, unitGreen = false;
  const counts = { legs: 0, green: 0, unitTests: 0, mutantsCaught: 0, mutantsTotal: 0 };
  const leg = async (name, fn) => { counts.legs++; const t = Date.now(); try { lines.push(name + ': ' + await fn() + ` (${Math.round((Date.now() - t) / 1000)}s)`); counts.green++; return true; } catch (e) { pass = false; lines.push(name + ': RED ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 3000)); return false; } };
  const assert = (await import('node:assert/strict')).default;
  if (process.platform !== 'win32') return { pass: false, message: 'owned Chrome and the collector need Windows' };
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-paypay-live-period-fixture-'));
  try {
    // ── U: the new behaviour-first test and the affected legacy collector tests (node --test, TAP per test) ──
    unitGreen = await leg('U collector unit tests (node --test, TAP): paypay-live-period (new), paypay-routine, paypay-standard, paypay-guided-capture, paypay-setup, rakuten-standard, rakuten-auto-login, rakuten-setup', async () => {
      const files = [LIVE_TEST, ROUTINE_TEST, 'collector/test/paypay-standard.test.mjs', 'collector/test/paypay-guided-capture.test.mjs', 'collector/test/paypay-setup.test.mjs', 'collector/test/rakuten-standard.test.mjs', 'collector/test/rakuten-auto-login.test.mjs', 'collector/test/rakuten-setup.test.mjs'];
      const r = await keep('U', await run(['--test', '--test-concurrency=1', '--test-reporter=tap', ...files], {}, 4800000)), t = tapReport(r.stdout), failed = t.list.filter(x => !x.ok), directives = t.list.filter(x => x.directive);
      counts.unitTests = t.pass;
      if (r.code !== 0 || t.fail || !(t.pass > 0) || t.skipped || t.todo || t.cancelled || directives.length || t.pass !== t.tests) throw new Error(`node --test exit ${r.code} tests ${t.tests} pass ${t.pass} fail ${t.fail} skipped ${t.skipped} todo ${t.todo} cancelled ${t.cancelled}; failing: ` + failed.map(x => x.name.slice(0, 120)).join(' | ') + ' :: ' + (r.stdout.split('\n').filter(l => /live-period:|paypay-routine:|paypay:|auto-login:|code: '|AssertionError/.test(l)).slice(0, 24).join(' | ') || r.stderr.slice(-800)).slice(0, 2400));
      const named = [/^page state \(pure\): the exact statement title with one visible 期間選択/, /^actual-shaped empty default view \(no CSV\)/, /^fail closed: the requested period without CSV after the query/, /^private diagnostics on a failure/, /^private diagnostics on success/, /^a broken diagnostic never changes the result/, /^page state \(pure\): only the exact Welcome/, /^happy path: one native submission reaches the Welcome page directly/, /^hidden duplicate date fields before the visible ones/, /^fail closed before any CSV/, /^session in use: one submission/, /^a reclaimed retrieve job whose folder holds login\.json/];
      for (const n of named) assert.ok(t.list.some(x => x.ok && n.test(x.name)), 'live-period:unit-test-present ' + n.source);
      return `${t.pass}/${t.tests} tests green, 0 skipped/todo/cancelled; ${named.length} named tests present`;
    });
    if (!unitGreen) { lines.push('M, P: NOT RUN — U is red (a mutant is only meaningful against a green control)'); counts.legs += 2; }
    // ── M: deliberately reintroduced defects, each caught by its named assertion ──
    if (unitGreen) await leg('M mutants: L-M1…L-M8 (this plan, new test), the legacy routine C-M1…C-M18 on the changed modules, C-M16 (PayPay exits kept out of 楽天銀行)', async () => {
      const caught = [], flip = async (name, expect, fn) => {
        counts.mutantsTotal++; const r = await fn(), text = r.stdout + '\n' + r.stderr;
        if (/FAIL mutant|FAIL guard|ERR_MODULE_NOT_FOUND|SyntaxError/.test(text)) throw new Error(name + ' harness failure: ' + text.replace(/\s+/g, ' ').slice(-600));
        if (r.code === 0 || !expect.test(text)) throw new Error(name + ' did not flip ' + expect + ' (exit ' + r.code + '): ' + (text.split('\n').filter(l => /AssertionError|live-period:|paypay-routine:|auto-login:|Error/.test(l)).slice(0, 6).join(' | ') || text.slice(-500)).slice(0, 700));
        caught.push(name); counts.mutantsCaught++;
      };
      for (const m of LIVE_MUTANTS) {
        const mods = []; try { for (const p of m.parts) mods.push({ file: p.file, mod: await mutantModule(p.file, { guard: p.guard || null, edits: p.edits || [] }) });
          const env = Object.assign({}, ...mods.map(x => envOf(x.file, x.mod.file)));
          await flip(m.name, m.expect, async () => keep('M-' + m.name, await run(['--test', '--test-concurrency=1', '--test-name-pattern=' + m.test, LIVE_TEST], env, 1200000)));
        } finally { for (const x of mods) await x.mod.dispose(); }
      }
      const { MUTANTS } = await import(pathToFileURL(path.join(root, 'scripts/zoomer-fixtures/omf-paypay-routine.mjs')).href);
      for (const m of MUTANTS) {
        const mod = await mutantModule(m.file, { guard: m.guard || null, edits: m.edits || [] });
        try { await flip(m.name, m.expect, () => run(['--test', '--test-concurrency=1', '--test-name-pattern=' + m.test, ROUTINE_TEST], envOf(m.file, mod.file), 900000)); } finally { await mod.dispose(); }
      }
      { const bankMutant = await mutantModule(BANK, { edits: [['exits: adapter.loginExits ?? null', 'exits: adapter.loginExits ?? { inUse: true, markRefused: true, acceptDirectOnly: true }']] });
        const testMutant = await mutantModule('collector/test/rakuten-auto-login.test.mjs', { imports: [["await import('../bank.mjs')", "await import('../" + path.basename(bankMutant.file) + "')"]] });
        try { await flip('C-M16-paypay-exits-for-rakuten', /auto-login:refusal-remembered/, () => run(['--test', '--test-concurrency=1', '--test-name-pattern=the bank refuses the saved login', testMutant.file], {}, 600000)); } finally { await testMutant.dispose(); await bankMutant.dispose(); }
        const control = await mutantModule('collector/test/rakuten-auto-login.test.mjs', {}); try { const r = await run(['--test', '--test-concurrency=1', '--test-name-pattern=the bank refuses the saved login', control.file], {}, 600000); if (r.code !== 0) throw new Error('C-M16 control (real bank.mjs) failed: ' + (r.stdout + r.stderr).slice(-500)); } finally { await control.dispose(); } }
      return caught.length + '/' + counts.mutantsTotal + ' mutants caught: ' + caught.join(', ');
    });
    // ── P: the customer package still carries the changed modules and they load without node_modules ──
    if (unitGreen) await leg('P package: stage (no install) carries bank.mjs and banks/paypay.mjs with their repo hashes; the staged copies load and expose the reader and the record shape', async () => {
      const { stage } = await import(pathToFileURL(path.join(root, 'collector/package/stage.mjs')).href), into = path.join(temp, 'staged');
      const { manifest } = await stage({ into, origin: 'https://omf.example', install: false, log: () => {} });
      const { createHash } = await import('node:crypto'), sha = async rel => createHash('sha256').update(await readFile(path.join(root, rel))).digest('hex');
      for (const rel of [BANK, PAYPAY]) assert.equal(manifest.files?.[rel], await sha(rel), 'live-period:staged-hash ' + rel);
      const stagedBank = await import(pathToFileURL(path.join(into, BANK)).href), stagedPaypay = await import(pathToFileURL(path.join(into, PAYPAY)).href);
      assert.equal(typeof stagedBank.diagnosticRecord, 'function', 'live-period:staged-record');
      assert.equal(typeof stagedPaypay.routineUi({}, {}).diagnostic, 'function', 'live-period:staged-reader');
      assert.equal(stagedPaypay.classifyRoutinePage({ origin: 'https://login.paypay-bank.co.jp', top: true, title: '普通預金取引明細照会 - PayPay銀行', controls: ['期間選択', 'ログアウト'], password: false }), 'statements', 'live-period:staged-default-view');
      const rec = stagedBank.diagnosticRecord({ bound: { provider: 'paypay', bankAccountId: 'b1'.repeat(12), jobId: randomUUID() }, variant: 'standard', at: new Date(0).toISOString(), outcome: 'failed', step: 'period', code: 'period-unidentified', page: { title: 'エラー secret', kind: 'x', controls: { csv: 2, extra: 1 }, dates: [{ total: 1, value: 'secret' }], extra: 'secret' }, finish: { loggedOut: true, reason: 'secret' } });
      assert.ok(!JSON.stringify(rec).includes('secret'), 'live-period:record-whitelist'); assert.deepEqual([rec.page.title, rec.page.kind, rec.page.controls.csv, rec.finish.reason], ['other', 'other', 2, 'other'], 'live-period:record-whitelist values');
      return Object.keys(manifest.files || {}).length + ' files staged; changed modules hashed and loadable; record whitelist drops unknown keys and raw strings';
    });
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
  return { pass, counts, message: `${pass ? 'green' : 'RED'} in ${Math.round((Date.now() - started) / 1000)}s; legs ${counts.green}/${counts.legs} green; unit ${counts.unitTests}, mutants ${counts.mutantsCaught}/${counts.mutantsTotal}\n` + lines.join('\n') };
} };
