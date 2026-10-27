// Fixture for plan omf-bank-hourly-balances-20261027: hourly background bank balances on the existing exclusive bank queue
// (shared/finance-bank-balance.mjs, server/models/FinanceBankBalance.ts, server/services/financeBankBalanceService.ts, the widened
// financeBankCollectionService/financeBankScheduleService, the owner and collector routes, server/plugins/bankSchedule.ts,
// collector/bank-balance.mjs with the 楽天銀行/PayPay銀行/池田泉州銀行 balance readers, collector/index.mjs, collector/package/stage.mjs,
// components/intake/BankConnections.vue).
// Run ONLY through the hub verifier (never directly):
//   node <hub>/scripts/zoomer-verify.mjs --run-fixture omf-bank-balances.mjs --cwd <this worktree>
// Evidence, stated exactly: synthetic only. Fictional owners, accounts, PCs, saved logins, amounts and bank times; owned
// mongodb-memory-server databases; owned headless Chrome whose every request outside the owned app or the fictional bank pages is
// aborted. No bank, network, credential, vault, model or production database is touched. The fictional bank pages follow the parent's
// SAFE-BANK-CONTRACT.json / RAKUTEN-LOGOUT-CONTRACT.json facts only; the real pages are validated by the parent separately.
// Legs:
//   U  node --test scripts/finance-bank-balance.test.mjs (the portable rules).
//   K  node --test collector/test/bank-balance.test.mjs (the three bank readers on intercepted Chromium; the durable receipt).
//   S  scripts/finance-bank-balance-integration.cjs: services, owner/collector routes and the real collector on an owned MongoDB (S1-S9).
//   C  the same script --ui: the built app with its real plugin timer in an owned headless Chrome on BankConnections.vue.
//   P  the collector package: the new runtime modules staged with their repo hashes, the staged graph resolves, no test code.
//   R  affected existing suites unchanged (daily schedule rules; PayPay/楽天銀行/池田泉州銀行 collector suites).
//   M  deliberately reintroduced defects: copies of server/+shared/ through leg S, copies of the collector modules through leg K and of
//      the shared module through leg U — each must fail its named assertion.
// Fail-first: OMF_BALANCE_SRC (leg S) and OMF_BALANCE_OUTPUT (leg C) point at the base revision's tree / built app; OMF_BALANCES_ONLY
// selects legs; OMF_BALANCES_EVIDENCE keeps leg logs and screenshots.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 14400000;
const SELF = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(SELF), '..', '..');
const sha256 = v => createHash('sha256').update(v).digest('hex');
const EVIDENCE = process.env.OMF_BALANCES_EVIDENCE || '';
const ONLY = (process.env.OMF_BALANCES_ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
const COVERS = ['shared/finance-bank-balance.mjs', 'shared/finance-bank-balance.d.mts', 'server/models/FinanceBankBalance.ts', 'server/services/financeBankBalanceService.ts', 'server/models/FinancePaymentMatch.ts', 'server/services/financeBankCollectionService.ts', 'server/services/financeBankScheduleService.ts', 'server/api/finance-payments/[...path].ts', 'server/api/finance-payments/collector/[...path].ts', 'server/plugins/bankSchedule.ts', 'collector/bank-balance.mjs', 'collector/index.mjs', 'collector/bank.mjs', 'collector/banks/rakuten.mjs', 'collector/banks/paypay.mjs', 'collector/banks/ikeda.mjs', 'collector/package/stage.mjs', 'components/intake/BankConnections.vue', 'scripts/finance-bank-balance.test.mjs', 'collector/test/bank-balance.test.mjs', 'scripts/finance-bank-balance-integration.cjs', 'scripts/zoomer-fixtures/omf-bank-balances.mjs'];
const INTEGRATION = 'scripts/finance-bank-balance-integration.cjs', UNIT = 'scripts/finance-bank-balance.test.mjs', COLLECTOR_TEST = 'collector/test/bank-balance.test.mjs';
const EXISTING = ['test/finance-bank-schedule.test.mjs', 'collector/test/rakuten-standard.test.mjs', 'collector/test/rakuten-auto-login.test.mjs', 'collector/test/paypay-routine.test.mjs', 'collector/test/paypay-logout.test.mjs', 'collector/test/paypay-standard.test.mjs', 'collector/test/paypay-guided-capture.test.mjs', 'collector/test/ikeda-portal.test.mjs', 'collector/test/statement.test.mjs'];

// ── M: each entry [label, file, anchor (exactly one hit), replacement, leg ('S'|'K'|'U'), the S legs or K test name pattern, the expected failure] ──
const BAL = 'server/services/financeBankBalanceService.ts', COL = 'server/services/financeBankCollectionService.ts', SH = 'shared/finance-bank-balance.mjs', RUN = 'collector/bank-balance.mjs';
const line = guard => new RegExp('^[^\\n]*// guard:' + guard + '\\n', 'm');
export const MUTANTS = [
  // the cadence, the queue and the claim (leg S on a copy of server/ + shared/)
  ['MB1-cooldown-dropped', SH, '(last >= slotStart || at < cooled)', '(last >= slotStart)', 'S', 'S3', /balance:cooldown-after-late-claim/],
  ['MB2-capability-ignored', BAL, "return capable ? { $or: [{ kind: { $ne: 'balance' } }, { kind: 'balance', 'balance.collectorId': device._id }] } : { kind: { $ne: 'balance' } }", "return { $or: [{ kind: { $ne: 'balance' } }, { kind: 'balance', 'balance.collectorId': device._id }] }", 'S', 'S0,S6', /balance:old-claim-never-receives-balance|balance:old-collector-never-receives/],
  ['MB3-target-pc-ignored', BAL, "{ kind: 'balance', 'balance.collectorId': device._id }", "{ kind: 'balance' }", 'S', 'S6', /balance:(other-pc-never-receives|chosen-receives)/],
  ['MB4-claim-binding-unchecked', BAL, " || !sameBalanceBinding(job.balance?.binding, balanceBinding(account.connection))) reason = 'connection-changed'", ") reason = 'connection-changed'", 'S', 'S4', /balance:(old-pc-and-changed-connection-never-received|changed-connection-claim-refused)/],
  ['MB5-claim-setting-unchecked', BAL, line('balance-claim-setting'), '', 'S', 'S4', /balance:(old-pc-and-changed-connection-never-received|stale-setting-claim-refused|off-claim-refused)/],
  ['MB6-complete-without-receipt', COL, "const receipt=body.state==='complete'?{$or:[{kind:{$ne:'balance'}},{'balance.snapshotId':{$exists:true}}]}:{}", 'const receipt={}', 'S', 'S7', /balance:complete-needs-receipt/],
  ['MB7-receipt-identity-unchecked', BAL, line('balance-receipt-identity'), '', 'S', 'S7', /balance:identity-changed-refused/],
  ['MB8-receipt-conflict-accepted', BAL, 'if (!stored || stored.receiptHash !== receiptHash) refused(', 'if (!stored) refused(', 'S', 'S7', /balance:receipt-conflict/],
  ['MB9-missed-hours-not-coalesced', BAL, line('balance-coalesce'), '', 'S', 'S3', /balance:(coalesce|offline-tick)/],
  ['MB10-statement-priority-dropped', BAL, "  let n = 0; for (const job of await queuedBalance({ ownerId, _id: bankAccountId })) if (await supersede(job, now, BALANCE_YIELDED)) n++ // guard:balance-statement-priority", '  let n = 0', 'S', 'S5', /manual 取得 over a queued balance run|balance:statement-priority/],
  ['MB11-daily-state-counts-balance', 'server/services/financeBankScheduleService.ts', "bankAccountId: account._id, kind: { $ne: 'balance' } }, live", 'bankAccountId: account._id }, live', 'S', 'S5', /balance:(daily-queued-despite-balance|statement-priority-daily|daily-done-by-statement-only|daily-state-ignores-balance|balance-failure-not-statement-failure)/],
  ['MB12-save-keeps-queued', BAL, line('balance-save-closes'), '', 'S', 'S4', /balance:save-closes-queued/],
  ['MB13-tick-ignores-revoked-pc', BAL, line('balance-tick-authorization'), '', 'S', 'S6', /balance:revoked-closes-queued/],
  ['MB14-balance-job-takes-csv', COL, line('balance-no-statement-upload'), '', 'S', 'S7', /balance:no-csv-for-balance/],
  ['MB15-pc-grant-unchecked', BAL, line('balance-pc-granted'), '', 'S', 'S1', /balance:pc-must-be-granted/],
  ['MB16-receipt-from-any-pc', BAL, 'if (!job || sid(job.balance?.collectorId) !== sid(device._id) || !job.balance?.claimedAt) fail(409', 'if (!job) fail(409', 'S', 'S7', /balance:receipt-other-pc/],
  // the real collector index (leg S with a mutant copy of collector/index.mjs)
  ['MI1-claim-not-advertised', 'collector/index.mjs', '{capabilities:[BALANCE_CAPABILITY]}', '{}', 'S', 'S0', /balance:native-claim-advertises/],
  ['MI2-balance-not-delegated', 'collector/index.mjs', line('balance-delegated'), '', 'S', 'S8', /statement path was used|balance:native/],
  ['MI3-no-saved-login-for-balance', 'collector/index.mjs', "const balance=job?.kind==='balance'&&bankBalanceSupported(provider,job.snapshot.variant);", 'const balance=false;', 'S', 'S8', /balance:login-handle/],
  // the portable rules (leg U)
  ['MU1-stale-shown-fresh', SH, "now.getTime() - t <= minutes * MINUTE ? 'fresh'", "true ? 'fresh'", 'U', 'freshness', /balance:stale/],
  ['MU2-sign-dropped', SH, 'value(m[5], !!m[4])', 'value(m[5], false)', 'U', 'yen', /balance:yen -1,234/],
  ['MU3-receipt-keys-unchecked', SH, 'if (Object.keys(body).sort().join() !== KEYS.join()) throw bad(', 'if (false) throw bad(', 'U', 'receipt', /balance:receipt-refused (unknown-key|raw-dom)/],
  // the collector runner and readers (leg K on a mutant copy beside the original)
  ['MK1-asks-a-person', RUN, "if (state === 'verification_required') throw coded('balance-attention', text); ", '', 'K', 'protected failure', /balance-protected:/],
  ['MK2-resend-needs-inquiry', RUN, line('balance-resend-without-inquiry'), '', 'K', 'receipt: written durably', /✖ receipt: written durably/],
  ['MK3-second-login', RUN, line('balance-one-inquiry'), '', 'K', 'receipt: written durably', /✖ receipt: written durably/],
  ['MK4-refusal-resent', RUN, 'const reason = balanceRefusal(error); if (!reason) throw error;', 'throw error;', 'K', 'receipt: written durably', /✖ receipt: written durably/],
  ['MK5-receipt-not-retained', RUN, 'item = await retain(dir, bound, balanceReceiptOf(bound, job, reading, now()), now);', 'void reading;', 'K', 'receipt: written durably', /✖ receipt: written durably/],
  ['MK6-no-logout', RUN, 'finally { if (signed) logout = ', 'finally { if (false) logout = ', 'K', 'one saved-login submission', /rakuten-balance:image-logout-pressed/],
  ['MK7-rakuten-duplicate-label', 'collector/banks/rakuten.mjs', 'if (count(c.primary) !== 1) throw', 'if (count(c.primary) < 1) throw', 'K', 'duplicated or hidden label', /rakuten-balance:refused duplicate/],
  ['MK8-rakuten-two-amounts', 'collector/banks/rakuten.mjs', 'if (hits.length !== 1 || /\\d/.test(part.slice(0, hits[0].index) + part.slice(hits[0].end))) throw fieldError', 'if (!hits.length) throw fieldError', 'K', 'duplicated or hidden label', /rakuten-balance:refused two-amounts/],
  ['MK9-rakuten-logout-inferred', 'collector/banks/rakuten.mjs', 'if (s && (s.password || (s.thanks && s.controls === 0)))', 'if (s)', 'K', 'explicit logout text', /rakuten-balance:logout-not-inferred/],
  ['MK10-paypay-other-account', 'collector/banks/paypay.mjs', 'if (saved?.account && numbers.some(n => n !== saved.account)) throw', 'if (false) throw', 'K', 'four saved logins', /paypay-balance:refused other-account/],
  ['MK11-ikeda-change-as-balance', 'collector/banks/ikeda.mjs', 'else if (hits.length === 2 && change > hits[0].end && change < hits[1].index) amount = hits[0].value;', 'else if (hits.length === 2) amount = hits[1].value;', 'K', '池田泉州銀行', /ikeda-balance:exact-card/],
  ['MK12-ikeda-change-only', 'collector/banks/ikeda.mjs', 'if (hits.length === 1 && change < 0) amount = hits[0].value;', 'if (hits.length === 1) amount = hits[0].value;', 'K', '池田泉州銀行', /ikeda-balance:refused change-only/]
];

function runChild(args, env, timeout) {
  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, args, { cwd: root, windowsHide: true, timeout, maxBuffer: 128 * 1024 * 1024, env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      const text = String(stdout || ''), lines = text.split(/\r?\n/);
      resolve({ ms: Date.now() - started, code: error ? (error.code ?? 1) : 0, text, stderr: String(stderr || ''), passes: lines.filter(l => l.startsWith('PASS ')), fails: lines.filter(l => l.startsWith('FAIL ')), setup: lines.find(l => l.startsWith('SETUP ')) || null, receipt: (() => { try { return JSON.parse((lines.find(l => l.startsWith('RECEIPT ')) || '').slice(8)); } catch { return null; } })() });
    });
  });
}
// node --test TAP-ish summary: pass/fail counts and the failing test names with their first assertion message.
function tests(r) {
  const out = r.text + '\n' + r.stderr, pass = Number((out.match(/ℹ pass (\d+)/) || [])[1] || 0), fail = Number((out.match(/ℹ fail (\d+)/) || [])[1] || 0);
  const failures = [...out.matchAll(/✖ (.+?) \(\d/g)].map(x => x[1]).filter(n => !/^(failing tests|tests)/.test(n));
  return { pass, fail, failures, message: (out.match(/(?:AssertionError|Error)[^\n]*\n[^\n]*\n?[^\n]*/) || [''])[0].replace(/\s+/g, ' ').slice(0, 600), out };
}
async function walkImports(entry, seen = new Set()) {
  if (seen.has(entry)) return seen; seen.add(entry);
  const text = await readFile(entry, 'utf8');
  for (const m of text.matchAll(/(?:^|\n)\s*import[^'"\n]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
    const rel = m[1] || m[2], target = path.resolve(path.dirname(entry), rel);
    if (!existsSync(target)) throw new Error('staged import missing: ' + path.relative(path.dirname(entry), target) + ' from ' + path.basename(entry));
    await walkImports(target, seen);
  }
  return seen;
}

export default { name: 'omf-bank-balances', covers: COVERS, async run() {
  const started = Date.now(), lines = [], green = new Set(); let pass = true, executed = false;
  const counts = { unitTests: 0, collectorTests: 0, harnessLegs: 0, ui: 0, existing: {}, mutantsCaught: 0, mutantsTotal: MUTANTS.length };
  const want = name => !ONLY.length || ONLY.includes(name);
  const keep = async (name, text) => { if (EVIDENCE) { await mkdir(EVIDENCE, { recursive: true }); await writeFile(path.join(EVIDENCE, 'leg-' + name + '.txt'), text); } };
  const leg = async (name, fn) => { const key = name.split(' ')[0]; if (!want(key)) return; const t = Date.now(); try { lines.push(name + ': ' + await fn() + ' (' + Math.round((Date.now() - t) / 1000) + 's)'); green.add(key); } catch (e) { pass = false; const msg = String(e?.message || e).replace(/\s+/g, ' ').slice(0, 2400); lines.push(name + ': ' + (/^(SETUP|NOT RUN)/.test(msg) ? '' : 'RED ') + msg); } };
  const unit = async (file, env = {}, pattern = null) => runChild(['--test', '--test-concurrency=1', ...(pattern ? ['--test-name-pattern=' + pattern] : []), file], env, 2400000);
  const harness = async (env = {}, ui = false) => runChild(['--import', 'tsx', INTEGRATION, ...(ui ? ['--ui'] : [])], { MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', ...(EVIDENCE && ui ? { OMF_BALANCE_EVIDENCE: EVIDENCE } : {}), ...env }, 2400000);
  try {
    await leg('U node --test ' + UNIT, async () => {
      const r = await unit(UNIT), t = tests(r); await keep('U', t.out); counts.unitTests = t.pass;
      if (r.code !== 0 || t.fail || !t.pass) throw new Error((/Cannot find module|ERR_MODULE_NOT_FOUND/.test(t.out) ? 'shared module absent (no balance rules exist): ' : t.fail + ' failed: ' + t.failures.join(' | ') + ' — ') + t.message);
      return t.pass + ' unit tests green';
    });
    await leg('K node --test ' + COLLECTOR_TEST + ' (owned headless Chrome, fictional bank pages, every other request refused)', async () => {
      if (process.platform !== 'win32') throw new Error('NOT RUN: owned Chrome and the collector need Windows');
      const r = await unit(COLLECTOR_TEST), t = tests(r); await keep('K', t.out); counts.collectorTests = t.pass;
      if (r.code !== 0 || t.fail || !t.pass) throw new Error((/Cannot find module|ERR_MODULE_NOT_FOUND/.test(t.out) ? 'collector balance module absent (no balance inquiry exists): ' : t.fail + ' failed: ' + t.failures.join(' | ') + ' — ') + t.message);
      return t.pass + ' collector tests green';
    });
    await leg('S services, routes and the real collector on an owned MongoDB with an injected JST clock (S1-S9' + (process.env.OMF_BALANCE_SRC ? ', SRC ' + process.env.OMF_BALANCE_SRC : '') + ')', async () => {
      const r = await harness(); executed = true; await keep('S', r.text + '\n--- stderr ---\n' + r.stderr); counts.harnessLegs = r.passes.length;
      if (r.setup) throw new Error(r.setup + ' (no behavioural result)');
      if (r.code !== 0 || !r.receipt?.pass || r.fails.length) throw new Error(r.fails.length + ' failed / ' + r.passes.length + ' green: ' + (r.fails.join(' | ') || r.stderr.slice(-800)).slice(0, 2000));
      return r.passes.length + ' legs green — ' + r.passes.map(p => p.slice(5, 8).trim()).join(' ');
    });
    await leg('C built app with its real plugin timer in an owned headless Chrome (' + (process.env.OMF_BALANCE_OUTPUT || 'this tree') + ')', async () => {
      const out = process.env.OMF_BALANCE_OUTPUT || root; if (!existsSync(path.join(out, '.output/server/index.mjs'))) throw new Error('NOT RUN: built app absent');
      const r = await harness({}, true); executed = true; await keep('C', r.text + '\n--- stderr ---\n' + r.stderr); counts.ui = r.passes.length;
      if (r.setup) throw new Error(r.setup);
      if (r.code !== 0 || !r.receipt?.pass) throw new Error((r.fails.join(' | ') || r.stderr.slice(-800)).slice(0, 1500));
      return r.passes.join(' ').slice(5) + (EVIDENCE ? '; screenshots ' + path.join(EVIDENCE, 'screenshots') : '');
    });
    await leg('P collector package: the balance runtime modules staged with their repo hashes, the staged graph resolves from index.mjs, the staged balance module and readers load without node_modules, no test code staged', async () => {
      const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-balance-stage-'));
      try {
        const stageModule = await import(pathToFileURL(path.join(root, 'collector/package/stage.mjs')).href), into = path.join(temp, 'staged');
        const { manifest } = await stageModule.stage({ into, origin: 'https://omf.example', install: false, log: () => {} });
        for (const entry of ['collector/bank-balance.mjs', 'shared/finance-bank-balance.mjs', 'collector/index.mjs', 'collector/bank.mjs', 'collector/banks/rakuten.mjs', 'collector/banks/paypay.mjs', 'collector/banks/ikeda.mjs']) { if (!manifest.files[entry]) throw new Error('balance:staged ' + entry + ' is not in the package'); if (manifest.files[entry] !== sha256(await readFile(path.join(root, entry)))) throw new Error('balance:staged-hash ' + entry); }
        if (Object.keys(manifest.files).some(f => f.includes('/test/') || /mutant|zoomer/.test(f))) throw new Error('balance:no-test-code-staged');
        await walkImports(path.join(into, 'collector', 'index.mjs'));
        const staged = await import(pathToFileURL(path.join(into, 'collector/bank-balance.mjs')).href);
        if (Object.keys(staged.BALANCE_ADAPTERS || {}).sort().join() !== 'ikeda,paypay,rakuten') throw new Error('balance:staged-adapters');
        const ui = staged.BALANCE_ADAPTERS.rakuten.ui({}, {}, null); if (typeof ui.readBalance !== 'function' || typeof ui.balanceFinish !== 'function') throw new Error('balance:staged-reader-constructs');
        const shared = await import(pathToFileURL(path.join(into, 'shared/finance-bank-balance.mjs')).href); if (shared.BALANCE_CAPABILITY !== 'balance-v1') throw new Error('balance:staged-shared');
        return Object.keys(manifest.files).length + ' files staged; balance modules hashed; graph resolves; staged readers construct without a page';
      } finally { await rm(temp, { recursive: true, force: true }).catch(() => {}); }
    });
    await leg('R affected existing suites unchanged: ' + EXISTING.join(', '), async () => {
      const out = [];
      for (const file of EXISTING) { const r = await unit(file), t = tests(r); counts.existing[file] = t.pass; out.push(file + ' ' + t.pass + '/' + (t.pass + t.fail)); await keep('R-' + path.basename(file), t.out); if (r.code !== 0 || t.fail || !t.pass) throw new Error(file + ': ' + t.fail + ' failed: ' + t.failures.join(' | ') + ' — ' + t.message); }
      return out.join('; ');
    });
    await leg('M reintroduced defects (each through its own leg; an unchanged copy first)', async () => {
      for (const need of ['U', 'K', 'S']) if (!green.has(need)) throw new Error('NOT RUN: legs U, K and S must be green first');
      if (!MUTANTS.length) throw new Error('no mutants defined');
      const copyTree = async label => { const dir = path.join(root, '.cache', 'omf-balance-' + label); await rm(dir, { recursive: true, force: true }); for (const d of ['server', 'shared']) await cp(path.join(root, d), path.join(dir, d), { recursive: true }); return dir; };
      const control = await copyTree('control'); try { const r = await harness({ OMF_BALANCE_SRC: control, OMF_BALANCE_ONLY: 'S2,S7' }); if (r.code !== 0 || r.fails.length) throw new Error('unchanged copy failed: ' + r.fails.join(' | ').slice(0, 500)); } finally { await rm(control, { recursive: true, force: true }); }
      const caught = [], ENV = { 'collector/bank-balance.mjs': 'OMF_TEST_BALANCE_MODULE', 'collector/banks/rakuten.mjs': 'OMF_TEST_RAKUTEN_MODULE', 'collector/banks/paypay.mjs': 'OMF_TEST_PAYPAY_MODULE', 'collector/banks/ikeda.mjs': 'OMF_TEST_IKEDA_MODULE', 'shared/finance-bank-balance.mjs': 'OMF_TEST_BALANCE_MODULE' };
      for (const [label, file, anchor, replacement, via, select, expect] of MUTANTS) {
        // a string anchor is literal text; a RegExp anchor (a whole guarded line) is a pattern
        const source = (await readFile(path.join(root, file), 'utf8')).replace(/\r\n/g, '\n'), hits = typeof anchor === 'string' ? source.split(anchor).length - 1 : (source.match(new RegExp(anchor.source, anchor.flags.replace('g', '') + 'g')) || []).length;
        if (hits !== 1) throw new Error(label + ' anchor hits ' + hits + ' in ' + file);
        const mutated = typeof anchor === 'string' ? source.split(anchor).join(replacement) : source.replace(anchor, () => replacement); let r;
        if (via === 'S' && file.startsWith('collector/')) {
          const copy = path.join(root, 'collector', '.zoomer-balance-mutant-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-index.mjs');
          try { await writeFile(copy, mutated); r = await harness({ OMF_TEST_INDEX_MODULE: copy, OMF_BALANCE_ONLY: select }); } finally { await rm(copy, { force: true }).catch(() => {}); }
          if (!r.fails.length || !expect.test(r.fails.join(' | '))) throw new Error(label + ' did not fail ' + expect + ': ' + (r.fails.join(' | ') || r.passes.join(' ') || r.setup || r.stderr.slice(-300)).slice(0, 500));
          caught.push(label + '→' + r.fails.join(' | ').match(expect)[0]);
        } else if (via === 'S') {
          const dir = await copyTree(label.toLowerCase()); try { await writeFile(path.join(dir, file), mutated); r = await harness({ OMF_BALANCE_SRC: dir, OMF_BALANCE_ONLY: select }); } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
          if (!r.fails.length || !expect.test(r.fails.join(' | '))) throw new Error(label + ' did not fail ' + expect + ': ' + (r.fails.join(' | ') || r.passes.join(' ') || r.setup || r.stderr.slice(-300)).slice(0, 500));
          caught.push(label + '→' + r.fails.join(' | ').match(expect)[0]);
        } else {
          const copy = path.join(root, path.dirname(file), '.zoomer-balance-mutant-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + path.basename(file));
          try { await writeFile(copy, mutated); r = await unit(via === 'U' ? UNIT : COLLECTOR_TEST, { [ENV[file]]: copy }, select); } finally { await rm(copy, { force: true }).catch(() => {}); }
          const t = tests(r); if (!t.fail || !expect.test(t.out)) throw new Error(label + ' did not fail ' + expect + ' (pass ' + t.pass + ', fail ' + t.fail + '): ' + t.message);
          caught.push(label + '→' + t.out.match(expect)[0]);
        }
        counts.mutantsCaught++;
      }
      await keep('M', caught.join('\n')); return 'control green; ' + caught.length + '/' + MUTANTS.length + ' caught: ' + caught.join(', ');
    });
  } catch (e) { pass = false; lines.push('setup: ' + String(e?.message || e).slice(0, 800)); }
  return { pass, databaseCoverage: { executed, ownedProcess: executed }, message: (pass ? 'green' : 'RED') + ' in ' + Math.round((Date.now() - started) / 1000) + 's ' + JSON.stringify(counts) + '\n' + lines.join('\n') };
} };
