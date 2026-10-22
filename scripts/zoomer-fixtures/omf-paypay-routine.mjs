// Fixture for plan omf-paypay-routine-20261022 Phase C: routine PayPay銀行 標準 retrieval. Run ONLY through the hub verifier (never
// directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-paypay-routine.mjs --cwd <this worktree>
// Evidence basis, stated exactly: synthetic only. Fake PayPay pages follow the value-free observations (titles, control texts, the six
// named date selects, 照会, CSV opening a 'ダウンロード中' tab, ログアウト); their DOM is invented and proves nothing about the real portal.
// Every page of every owned HEADLESS Chrome (popups included) is served by request interception; host resolution is refused for
// everything else. The built app runs on owned ephemeral MongoDBs. Fictional branch/account/password and statement values only. No bank,
// production database, owner AppData, ordinary browser or OS input is touched; nothing here is a live login or a live export.
// Fail-first on 12cf98c (behaviour, not a missing file): queueBankSync returns an observe job for PayPay標準 (U/B paypay-routine-retrieve),
// bankLoginFor gives a retrieve job no handle (N first captures), collectBankFromPage stops at the support gate (contract-pending), the
// ensureBankLogin loop takes the in-use page for a refusal, a refusal leaves the marker 'uncertain', the panel shows the guided text.
// Legs: U the collector unit tests (TAP, per test), N the owned native four-account daemon walkthrough
// (scripts/finance-paypay-onboarding-integration.cjs), B the HTTP bank-collection integration with its hidden-Chrome UI checks, M the named
// collector mutants (each reintroduced defect must flip its own named assertion; an anchor that does not hit exactly once, an import
// failure or an unrelated error is a harness failure, never a catch).
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 14400000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const u = rel => pathToFileURL(path.join(root, rel)).href;
const COVERS = ['collector/banks/paypay.mjs', 'collector/bank.mjs', 'collector/index.mjs', 'collector/setup.js', 'components/intake/BankConnections.vue', 'shared/finance-payment-match.mjs', 'shared/finance-payment-match.d.mts', 'collector/test/paypay-routine.test.mjs', 'collector/test/paypay-standard.test.mjs', 'collector/test/paypay-guided-capture.test.mjs', 'collector/test/rakuten-standard.test.mjs', 'scripts/finance-paypay-onboarding-integration.cjs', 'scripts/finance-bank-collection-integration.cjs', 'scripts/finance-payment-match.test.mjs', 'scripts/zoomer-fixtures/omf-paypay-routine.mjs', 'docs/paypay-bank-connection.md', 'docs/rakuten-bank-connection.md'];
const MONGOD = [path.join(root, 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe'), path.join(root, '..', 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe')].find(p => existsSync(p)) || null;
// Every child runs without an ambient database address (the integrations start their own ephemeral MongoDB).
const run = (args, env = {}, timeout = 2400000, cwd = root) => new Promise(resolve => execFile(process.execPath, args, { cwd, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', ...(MONGOD ? { MONGOMS_SYSTEM_BINARY: MONGOD } : {}), ...env } }, (e, stdout, stderr) => resolve({ code: e ? e.code ?? 1 : 0, killed: !!e?.killed, stdout: String(stdout), stderr: String(stderr) })));
const receiptOf = text => { const line = text.split(/\r?\n/).reverse().find(l => l.startsWith('{"pass":')); try { return line ? JSON.parse(line) : null; } catch { return null; } };
const passesOf = text => text.split(/\r?\n/).filter(l => l.startsWith('PASS '));
// OMF_ROUTINE_EVIDENCE_DIR (optional, an existing directory): the complete stdout/stderr of each child run is kept there, never truncated.
const keep = async (name, r) => { const dir = process.env.OMF_ROUTINE_EVIDENCE_DIR; if (dir && existsSync(dir)) await writeFile(path.join(dir, (process.env.OMF_ROUTINE_EVIDENCE_PREFIX || 'R4') + '-child-' + name + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt'), 'exit ' + r.code + (r.killed ? ' (killed)' : '') + '\n--- stdout ---\n' + r.stdout + '\n--- stderr ---\n' + r.stderr, { flag: 'wx' }); return r; };
function tapReport(text) {
  const total = name => Number(text.match(new RegExp('^# ' + name + ' (\\d+)', 'm'))?.[1] ?? NaN);
  const tests = [...text.matchAll(/^(\s*)(ok|not ok) \d+ - (.+?)(?: # (SKIP|TODO).*)?$/gm)].filter(m => m[1].length <= 4).map(m => ({ ok: m[2] === 'ok', name: m[3].trim(), directive: m[4] || null }));
  return { tests: total('tests'), pass: total('pass'), fail: total('fail'), skipped: total('skipped'), todo: total('todo'), cancelled: total('cancelled'), list: tests };
}
// A sibling copy of a module with named edits (each exact anchor must hit exactly once) or one `// guard:<name>` line removed; `imports`
// rewrites relative import specifiers of the copy (a test file pointed at mutant module copies).
async function mutantModule(file, { guard = null, edits = [], imports = [] } = {}) {
  const source = path.join(root, file); let text = (await readFile(source, 'utf8')).replace(/\r\n/g, '\n');
  if (guard) { const lines = text.split('\n'), hits = lines.filter(l => l.includes('// guard:' + guard + ' ') || l.trimEnd().endsWith('// guard:' + guard)); if (hits.length !== 1) throw new Error('FAIL guard marker hits ' + hits.length + ' for ' + guard); lines.splice(lines.indexOf(hits[0]), 1); text = lines.join('\n'); }
  for (const [anchor, replacement] of [...edits, ...imports]) { const hits = text.split(anchor).length - 1; if (hits !== 1) throw new Error('FAIL mutant anchor hits ' + hits + ' for ' + file + ' ' + anchor.slice(0, 70)); text = text.replace(anchor, () => replacement); }
  const ext = file.endsWith('.test.mjs') ? '.test.mjs' : '.mjs', target = path.join(path.dirname(source), path.basename(file, ext) + `.mutant-${process.pid}-${randomUUID().slice(0, 8)}${ext}`);
  await writeFile(target, text, { flag: 'wx' });
  return { file: target, async dispose() { await unlink(target).catch(() => {}); } };
}

// ── M: the named collector mutants (plan C-M1..C-M16 plus this build's own download-tab rule) ──
const PAYPAY = 'collector/banks/paypay.mjs', BANK = 'collector/bank.mjs', ROUTINE_TEST = 'collector/test/paypay-routine.test.mjs';
export const MUTANTS = [
  { name: 'C-M1-signed-in-by-logout-alone', file: PAYPAY, edits: [["if (read.title === c.welcome.title && c.welcome.controls.every(t => controls.includes(t))) return 'authenticated'; // guard:routine-welcome", "if (controls.includes(c.logout)) return 'authenticated'; // guard:routine-welcome"]], test: 'page state', expect: /paypay-routine:notice-page-not-authenticated/ },
  // C-M2 (plan: authenticated by the shared pathname): the page reader never reads a pathname, so the nearest representable defects are the
  // Welcome title without its observed controls and a frame or another origin taken for the top document
  { name: 'C-M2a-title-without-controls', file: PAYPAY, edits: [["if (read.title === c.welcome.title && c.welcome.controls.every(t => controls.includes(t))) return 'authenticated'; // guard:routine-welcome", "if (read.title === c.welcome.title) return 'authenticated'; // guard:routine-welcome"]], test: 'page state', expect: /paypay-routine:welcome-needs-both-controls/ },
  { name: 'C-M2b-frame-or-origin-accepted', file: PAYPAY, edits: [["if (!read || read.origin !== c.origin || read.top !== true) return 'unknown';", "if (!read) return 'unknown';"]], test: 'page state', expect: /paypay-routine:frame-not-authenticated/ },
  { name: 'C-M3-in-use-exit-removed', file: BANK, edits: [["if (exits?.inUse && result?.outcome === 'session-in-use') { inUse = true; return T?.inUse ? T.inUse(label) : LOGIN_TEXT.verify(label); }", '']], test: 'session in use', expect: /paypay-routine:in-use-not-refusal/ },
  { name: 'C-M4-overwrite-pressed', file: PAYPAY, edits: [["if (result?.outcome !== 'submitted' || waiting) return result;", "if (result?.outcome === 'session-in-use') await page.evaluate(() => [...document.querySelectorAll('a')].find(a => a.textContent.trim() === '上書きログイン')?.click()).catch(() => {}); if (result?.outcome !== 'submitted' || waiting) return result;"]], test: 'session in use', expect: /paypay-routine:no-overwrite/ },
  { name: 'C-M5-accepted-after-attention', file: BANK, edits: [[' && (!exits?.acceptDirectOnly || direct)', '']], test: 'an unknown page after the submission', expect: /paypay-routine:manual-sign-in-not-accepted \(after attention\)/ },
  { name: 'C-M6-identity-rule-removed', file: PAYPAY, guard: 'routine-identity', test: 'saved login blocked', expect: /paypay-routine:manual-no-label-no-export/ },
  { name: 'C-M7-period-read-back-dropped', file: PAYPAY, guard: 'routine-period-readback', test: 'fail closed before any CSV', expect: /paypay-routine:fail-closed reverting select/ },
  { name: 'C-M8-nearest-option-chosen', file: PAYPAY, edits: [['const options = [...e.options].filter(o => toNumber(o) === wanted[i]); if (options.length !== 1) return { missing: ids[i] }; // guard:routine-period-option', 'const options = [[...e.options].sort((a, b) => Math.abs(toNumber(a) - wanted[i]) - Math.abs(toNumber(b) - wanted[i]))[0]]; // guard:routine-period-option']], test: 'fail closed before any CSV', expect: /paypay-routine:year-absent-held \(explained as a date the bank does not offer\)/ },
  { name: 'C-M9-first-of-several-query-controls', file: PAYPAY, edits: [["await press('control', c.query, [c.statements.title], 'period-query');", "await page.evaluate(() => [...document.querySelectorAll('input')].find(e => (e.value || e.alt) === '照会').click());"]], test: 'fail closed before any CSV', expect: /paypay-routine:fail-closed two 照会/ },
  { name: 'C-M10-statement-link-by-includes', file: PAYPAY, edits: [["await press('link', c.open, [c.welcome.title], 'statements-unidentified');", "await page.evaluate(() => [...document.querySelectorAll('a')].find(a => a.innerText.includes('明細照会')).click());"]], test: 'happy path', expect: /paypay-routine:transfer-link-never-clicked/ },
  { name: 'C-M11-dialog-accepted', file: PAYPAY, edits: [["dialogs.on('Page.javascriptDialogOpening', () => { waiting = true; });", "dialogs.on('Page.javascriptDialogOpening', () => { dialogs.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); });"]], test: 'a confirm dialog on CSV', expect: /paypay-routine:dialog-never-accepted/ },
  { name: 'C-M12-export-without-query', file: PAYPAY, guard: 'routine-query-before-export', test: 'the export step refuses', expect: /paypay-routine:no-export-without-query/ },
  { name: 'C-M13-finish-skipped', file: BANK, guard: 'finish-after-login', test: 'happy path', expect: /paypay-routine:logout-after-success/ },
  { name: 'C-M15-guided-accepts-direct', file: BANK, edits: [['return { submitted: true, refused: false, text: GUIDED_TEXT.submitted(label) };', "if (result?.outcome === 'authenticated') await login.accepted(); return { submitted: true, refused: false, text: GUIDED_TEXT.submitted(label) };"]], test: 'an observe job queued before', expect: /paypay-routine:guided-p1-kept/ },
  // C-M18 (build-resume-03, parent finding PARENT-PERIOD-FINDING.md): assignment and read-back take the first select carrying the name
  // (a hidden duplicate) while validation keeps the visible field — the defective selection the parent reproduced
  { name: 'C-M18-hidden-duplicate-set-and-read', file: PAYPAY, edits: [['const e = field(ids[i]).el; if (!e) return { missing: ids[i] };', 'const e = [...document.querySelectorAll(\'select\')].find(s => s.name === ids[i] || s.id === ids[i]); if (!e) return { missing: ids[i] };'], ["if (op === 'read') return ids.map(id => { const o = field(id).el?.selectedOptions?.[0]; return o ? toNumber(o) : null; });", "if (op === 'read') return ids.map(id => { const o = [...document.querySelectorAll('select')].find(s => s.name === id || s.id === id)?.selectedOptions?.[0]; return o ? toNumber(o) : null; });"]], test: 'hidden duplicate date fields', expect: /paypay-routine:hidden-duplicates-visible-query/ },
  { name: 'C-M17-any-same-title-tab-closed', file: PAYPAY, edits: [["if (known.has(target) || target.type() !== 'page' || target === page.target() || target.opener() !== page.target()) continue;", "if (target.type() !== 'page' || target === page.target()) continue;"]], test: 'happy path', expect: /paypay-routine:other-pages-preserved/ }
];
// C-M14 (index.mjs guard:bank-login-kind) and C-M16 (the PayPay exits applied without adapter.loginExits) are probed separately below.

export default { name: 'omf-paypay-routine', covers: COVERS, async run() {
  const started = Date.now(), lines = []; let pass = true, dbExecuted = false;
  const counts = { legs: 0, green: 0, unitTests: 0, nativeLegs: 0, httpLegs: 0, mutantsCaught: 0, mutantsTotal: 0 };
  const leg = async (name, fn) => { counts.legs++; const t = Date.now(); try { lines.push(name + ': ' + await fn() + ` (${Math.round((Date.now() - t) / 1000)}s)`); counts.green++; } catch (e) { pass = false; lines.push(name + ': RED ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 2000)); } };
  const assert = (await import('node:assert/strict')).default;
  if (process.platform !== 'win32') return { pass: false, message: 'the collector vault (DPAPI) and owned Chrome need Windows' };
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-paypay-routine-fixture-'));
  process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector-dir');
  const only = process.env.OMF_ROUTINE_LEGS ? process.env.OMF_ROUTINE_LEGS.split(',') : null, want = k => !only || only.includes(k);
  try {
    // ── U: the collector unit tests (node --test, TAP report parsed per test) ──
    if (want('U')) await leg('U collector unit tests (node --test, TAP): paypay-routine (owned headless Chrome on the intercepted fake portal), paypay-standard, paypay-guided-capture, paypay-setup, rakuten-standard, rakuten-auto-login, rakuten-setup', async () => {
      const files = [ROUTINE_TEST, 'collector/test/paypay-standard.test.mjs', 'collector/test/paypay-guided-capture.test.mjs', 'collector/test/paypay-setup.test.mjs', 'collector/test/rakuten-standard.test.mjs', 'collector/test/rakuten-auto-login.test.mjs', 'collector/test/rakuten-setup.test.mjs'];
      const r = await keep('U', await run(['--test', '--test-concurrency=1', '--test-reporter=tap', ...files], {}, 4800000)), t = tapReport(r.stdout), failed = t.list.filter(x => !x.ok), directives = t.list.filter(x => x.directive);
      counts.unitTests = t.pass;
      if (r.code !== 0 || t.fail || !(t.pass > 0) || t.skipped || t.todo || t.cancelled || directives.length || t.pass !== t.tests) throw new Error(`node --test exit ${r.code} tests ${t.tests} pass ${t.pass} fail ${t.fail} skipped ${t.skipped} todo ${t.todo} cancelled ${t.cancelled}; failing: ` + failed.slice(0, 12).map(x => x.name.slice(0, 140)).join(' | ') + ' :: ' + (r.stdout.split('\n').filter(l => /AssertionError|paypay[-:]|auto-login:|Error:/.test(l)).slice(0, 12).join(' | ') || r.stderr.slice(-800)).slice(0, 1600));
      const named = [/^page state \(pure\)/, /^happy path: one native submission reaches the Welcome page directly/, /^hidden duplicate date fields before the visible ones/, /^session in use: one submission, 上書きログイン never pressed/, /^refusal: the exact form again/, /^an unknown page after the submission \(a notice\)/, /^saved login blocked → the person signs in/, /^fail closed before any CSV/, /^a confirm dialog on CSV is never accepted/, /^a download that does not come from the bank host/, /^a failing ログアウト leaves the result unchanged/, /^the export step refuses to run without this job's 照会/, /^an observe job queued before \(historical guided snapshot\)/, /^a reclaimed retrieve job whose folder holds login\.json/];
      for (const n of named) assert.ok(t.list.some(x => x.ok && n.test(x.name)), 'paypay-routine:unit-test-present ' + n.source);
      return `${t.pass}/${t.tests} tests green, 0 skipped/todo/cancelled; ${named.length} named routine tests present`;
    });
    // ── N: the owned native four-account daemon walkthrough ──
    if (want('N')) await leg('N native routine walkthrough (scripts/finance-paypay-onboarding-integration.cjs): built app, real card-only enrollment, the real collector process, its tick and its real setup page in owned headless Chrome; four PayPay標準 accounts retrieving on the intercepted fake portal: first captures mapping-required, direct sign-in accepted, native mapping and overlapping/identical repeats, refusal/manual/re-save, current-key retry, in-use, the routine exits, one historical guided job, BA-PLUS, outbox refusals, the /bank/retry route, scope/type/revocation', async () => {
      if (!existsSync(path.join(root, '.output/server/index.mjs'))) throw new Error('NOT RUN: built app absent');
      // OMF_ROUTINE_BASE_ROOT (fail-first only): the same walkthrough read-only against the unmodified 12cf98c tree; that run is RED by design
      const base = process.env.OMF_ROUTINE_BASE_ROOT || '', r = await keep(base ? 'N-base' : 'N', await run(['scripts/finance-paypay-onboarding-integration.cjs'], base ? { OMF_PAYPAY_ONBOARDING_ROOT: base } : {}, 5400000)), passes = passesOf(r.stdout), receipt = receiptOf(r.stdout); counts.nativeLegs = passes.length;
      if (base) throw new Error('BASE ' + base + ' (fail-first, never green): exit ' + r.code + ', ' + passes.length + ' PASS; error: ' + r.stderr.replace(/\s+/g, ' ').slice(0, 1500));
      if (r.code !== 0 || !receipt?.pass || receipt.checks !== passes.length) throw new Error(`exit ${r.code}, ${passes.length} PASS; last: ${passes.at(-1)?.slice(5, 160) || 'none'}; error: ` + r.stderr.replace(/\s+/g, ' ').slice(0, 1800));
      assert.equal(receipt.accounts, 4); assert.equal(receipt.foreignRequests, 0, 'paypay-routine:native-no-foreign-request'); assert.equal(passes.length, 14, 'paypay-routine:native-leg-count');
      for (const n of [/^PASS four routine first captures through the real tick/, /^PASS native mapping: .*imported only the new rows over the overlap/, /^PASS the bank refused PayPay 3's changed password/, /^PASS a bank refusal of PayPay 3's CURRENT saved login/, /^PASS the observed active-session page for PayPay 3/, /^PASS the routine exits on the real daemon/, /^PASS a historical guided observe job of PayPay 2/, /^PASS BA-PLUS stays a manual observe/, /^PASS refused captures at the bank statement outbox/, /^PASS the actual \/bank\/retry route/]) assert.ok(passes.some(p => n.test(p)), 'paypay-routine:native-leg ' + n.source);
      assert.deepEqual([receipt.route?.whileJob, receipt.route?.claimedWhileInFlight, receipt.route?.afterCompletion, receipt.route?.resumed], [409, false, 200, 'complete'], 'paypay-routine:native-route-receipt');
      dbExecuted = true; return `${passes.length} legs; ${receipt.automaticSubmissions} automatic of ${receipt.loginSubmissions} submissions, ${receipt.exports} exports, ${receipt.logouts} ログアウト, ${receipt.keyReleases} key releases; route ${JSON.stringify(receipt.route)}`;
    });
    // ── B: the HTTP bank-collection integration (G/P PayPay legs) and its hidden real Chrome UI checks ──
    if (want('B')) await leg('B HTTP bank collection on the built app (scripts/finance-integration.cjs → finance-bank-collection-integration.cjs, owned MongoDB, hidden Chrome): PayPay標準 retrieve queue with its frozen period (400 without one), collector-channel captures, mapping, the mapped whole-period capture anchored, a historical guided job labelled, the routine capability/取得/connection-test texts', async () => {
      if (!existsSync(path.join(root, '.output/server/index.mjs'))) throw new Error('NOT RUN: built app absent');
      const r = await keep('B', await run(['scripts/finance-integration.cjs'], { OMF_TEST_BANK_COLLECTION_ONLY: '1' })), passes = passesOf(r.stdout); counts.httpLegs = passes.length;
      if (r.code !== 0) throw new Error(`exit ${r.code}; last PASS: ${passes.at(-1)?.slice(5, 120) || 'none'}; ` + (r.stdout + r.stderr).replace(/\s+/g, ' ').slice(-1800));
      for (const n of [/^PASS G PayPay銀行 標準: .*four retrieve jobs with their frozen period/, /^PASS P PayPay銀行 split dates/, /^PASS V hidden real Chrome/, /^PASS S 楽天銀行 standard/]) assert.ok(passes.some(p => n.test(p)), 'paypay-routine:http-leg ' + n.source);
      dbExecuted = true; return (r.stdout.match(/\d+ targeted bank collection checks passed/)?.[0] || 'summary missing') + `, ${passes.length} legs`;
    });
    // ── M: deliberately reintroduced defects, each caught by its named assertion ──
    if (want('M')) await leg('M collector mutants: the routine page state, the in-use/refusal/direct-acceptance exits, the identity rule, the period read-back and option choice, the single 照会/statement link, the dialog refusal, the query before export, the logout hook, the guided P1, the own-download-tab rule (routine unit test on mutant copies); the widened bank-login-kind boundary (bankLoginFor probe); the PayPay exits kept out of 楽天銀行 (rakuten-auto-login on a mutant copy)', async () => {
      const caught = [], flip = async (name, expect, fn) => {
        counts.mutantsTotal++; const r = await fn(), text = r.stdout + '\n' + r.stderr;
        if (/FAIL mutant|FAIL guard|ERR_MODULE_NOT_FOUND|SyntaxError/.test(text)) throw new Error(name + ' harness failure: ' + text.replace(/\s+/g, ' ').slice(-600));
        if (r.code === 0 || !expect.test(text)) throw new Error(name + ' did not flip ' + expect + ' (exit ' + r.code + '): ' + (text.split('\n').filter(l => /AssertionError|paypay-routine:|auto-login:|Error/.test(l)).slice(0, 6).join(' | ') || text.slice(-500)).slice(0, 700));
        caught.push(name); counts.mutantsCaught++;
      };
      for (const m of MUTANTS) {
        const mod = await mutantModule(m.file, { guard: m.guard || null, edits: m.edits || [] });
        try { await flip(m.name, m.expect, () => run(['--test', '--test-concurrency=1', '--test-name-pattern=' + m.test, ROUTINE_TEST], { [m.file === PAYPAY ? 'OMF_TEST_PAYPAY_MODULE' : 'OMF_TEST_BANK_MODULE']: mod.file }, 900000)); } finally { await mod.dispose(); }
      }
      // C-M14: guard:bank-login-kind removed — the widened guard's remaining boundary (a claim of any other kind gets no handle); the control
      // run on the real module proves the probe passes there (a retrieve job gets a handle; BA-PLUS and an unknown kind do not)
      const probe = async file => { const idx = await import(pathToFileURL(file).href), live = { mode: 'protected', installationId: 'f'.repeat(32), broker: {}, abort: new AbortController() }, config = { baseUrl: 'https://omf.example', token: 'omfc_' + 'c'.repeat(64), accountInfo: [] }, account = { _id: 'b1'.repeat(12), ownerId: 'd4'.repeat(12) };
        const jobOf = (kind, variant = 'standard') => ({ jobId: randomUUID(), kind, provider: 'paypay', snapshot: { provider: 'paypay', variant, interpretation: 'unmapped', headers: [], mapping: {} } }), handle = job => idx.bankLoginFor({ job, account }, config, live, { store: {}, root: temp, assert: () => {} });
        assert.notEqual(handle(jobOf('retrieve')), null, 'paypay-routine:login-kind-retrieve-handle'); assert.equal(handle(jobOf('retrieve', 'baplus')), null, 'paypay-routine:login-kind-baplus-none'); assert.equal(handle(jobOf('bogus')), null, 'paypay-routine:login-kind-boundary'); };
      await probe(path.join(root, 'collector/index.mjs'));
      { counts.mutantsTotal++; const m = await mutantModule('collector/index.mjs', { guard: 'bank-login-kind' }); let error = null; try { await probe(m.file); } catch (e) { error = e; } finally { await m.dispose(); } if (!error || !/paypay-routine:login-kind-boundary/.test(String(error.message))) throw new Error('C-M14 did not flip paypay-routine:login-kind-boundary: ' + String(error?.message || 'passed').slice(0, 300)); caught.push('C-M14-login-kind-any'); counts.mutantsCaught++; }
      // C-M16: the PayPay exits applied to an adapter that declares none (collectBankFromPage passes them by default; R6 full1 retained the earlier definition that changed only an unreachable default parameter) — the unchanged 楽天銀行 test, run
      // on a copy pointed at the mutant bank module, must flip its refusal-memory count
      { const bankMutant = await mutantModule(BANK, { edits: [['exits: adapter.loginExits ?? null', 'exits: adapter.loginExits ?? { inUse: true, markRefused: true, acceptDirectOnly: true }']] });
        const testMutant = await mutantModule('collector/test/rakuten-auto-login.test.mjs', { imports: [["await import('../bank.mjs')", "await import('../" + path.basename(bankMutant.file) + "')"]] });
        try { await flip('C-M16-paypay-exits-for-rakuten', /auto-login:refusal-remembered/, () => run(['--test', '--test-concurrency=1', '--test-name-pattern=the bank refuses the saved login', testMutant.file], {}, 600000)); } finally { await testMutant.dispose(); await bankMutant.dispose(); }
        // control: the same copied test on the real module passes
        // C-M19 (build-resume-06, trace R5-routine-N-diagnostic-2): a running bank job no longer renews its own session — under the
        // walkthrough's 150 s grant-window seam the refused job of the route leg can then never post its result (stuck open)
        { counts.mutantsTotal++; const r = await keep('M-C-M19', await run(['scripts/finance-paypay-onboarding-integration.cjs'], { OMF_TEST_PAYPAY_RETRY_MUTANT: 'no-job-session-renewal' }, 5400000)), text = r.stdout + r.stderr;
          if (/FAIL (retry mutant|trace anchor|unknown retry mutant)/.test(text)) throw new Error('C-M19 harness failure: ' + text.slice(-600));
          if (r.code === 0 || !/daemon timeout job route refusal 2/.test(text) || !/daemon:catch:forbidden:The connection has ended/.test(text)) throw new Error('C-M19-no-job-session-renewal did not flip /daemon timeout job route refusal 2/ with the expired-session trace daemon:catch:forbidden (exit ' + r.code + '): ' + text.replace(/\s+/g, ' ').slice(-700));
          caught.push('C-M19-no-job-session-renewal'); counts.mutantsCaught++; }
        const control = await mutantModule('collector/test/rakuten-auto-login.test.mjs', {}); try { const r = await run(['--test', '--test-concurrency=1', '--test-name-pattern=the bank refuses the saved login', control.file], {}, 600000); if (r.code !== 0) throw new Error('C-M16 control (real bank.mjs) failed: ' + (r.stdout + r.stderr).slice(-500)); } finally { await control.dispose(); } }
      return caught.length + '/' + counts.mutantsTotal + ' collector mutants caught: ' + caught.join(', ');
    });
  } finally {
    await import(u('collector/browser.mjs')).then(m => m.closeOwnedBrowsers()).catch(() => {});
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
  if (process.env.OMF_ROUTINE_BASE_ROOT) pass = false;
  return { pass: pass && !only, databaseCoverage: { executed: dbExecuted, ownedProcess: dbExecuted }, counts, message: `${pass && !only ? 'green' : 'RED'} in ${Math.round((Date.now() - started) / 1000)}s; legs ${counts.green}/${counts.legs} green${only ? ' (OMF_ROUTINE_LEGS=' + only.join(',') + ': a partial run is never green)' : ''}; unit ${counts.unitTests}, native ${counts.nativeLegs}, http ${counts.httpLegs}, mutants ${counts.mutantsCaught}/${counts.mutantsTotal}\n` + lines.join('\n') };
} };
