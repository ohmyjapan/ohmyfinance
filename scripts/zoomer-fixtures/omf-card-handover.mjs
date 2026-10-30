// Fixture for plan omf-card-handover-20261030: the explicit protected import of the previous card setup's saved logins on the same PC
// (collector/legacy-card-import.mjs, collector/index.mjs /legacy-cards, collector/setup.html+setup.js, the keyService.legacyOwner of
// collector/omf-authorization.mjs, the legacy-owner route and service), routine Amex/Aplus downloads in the background owned Chrome
// (collector/browser.mjs, login.mjs, aplus.mjs), the staged importer (collector/package/stage.mjs) and Amex in the daily schedule
// (server/services/financeService.ts, financeSyncScheduler.ts) with its native setting (server/api/finance/[...path].ts, pages/connections.vue).
// Run ONLY through the hub verifier (never directly):
//   node <hub>/scripts/zoomer-verify.mjs --run-fixture omf-card-handover.mjs --cwd <this worktree>
// Evidence, stated exactly: synthetic only — fictional owners, cards, logins, tokens and addresses; owned mongodb-memory-server
// databases; owned temporary directories (previous setups written with this Windows user's DPAPI); loopback HTTP/TLS only (the previous
// address is a local listener that must receive nothing); owned stock Chrome whose every page request is answered from synthetic HTML
// or aborted, with a recording reveal — the real showWindow is never called (owner no-foreground order). No live directory, credential,
// issuer, model, network or production database is touched.
// Legs:
//   F  fail-first: the base revision 74f49b3 of every changed module, placed exactly where a defect copy goes, must fail the new legs
//      with their named findings (no importer, no keyService.legacyOwner, visible launch, unrouted attention, a navigation-interrupted
//      Aplus page read ending the job, no owner-proof route, no local routes, Amex not scheduled, the Amex daily setting refused,
//      importer not staged); and the revision 5e5ce0f before the settings-route and page-read corrections must fail L6 (the Amex save
//      refused with 400) and the Aplus page-read test; and the revision d067126 before the focus repair (case
//      omf-background-focus-repair-20261030) must fail the setup page opened while the collector's tick is busy (Check left disabled),
//      in owned headless Chrome.
//   U  node --test collector/test/legacy-card-import.test.mjs (planner/importer; real DPAPI and ACL helpers on owned roots).
//   K  node --test collector/test/card-background.test.mjs (Part A: the real wrappers over a recording launch; no Chrome).
//   N  the same file with OMF_CARD_NATIVE=1 (real background Chrome on synthetic pages). OMF_CARD_NATIVE=0 → NOT RUN (red).
//   S  scripts/finance-legacy-card-import-integration.cjs (service, route, the real collector over TLS, schedule, guard mutants).
//   C  the same with --ui and OMF_CARD_NATIVE=1: the setup page (L4) and the built connections page (L8, needs .output) in owned
//      headless Chrome. OMF_CARD_NATIVE=0 → NOT RUN (red).
//   P  the collector package: the importer staged with its repo hash, the staged graph resolves from index.mjs, the staged importer loads
//      without node_modules, no test code staged.
//   R  affected existing collector suites without Chrome; RN (native) the Chrome-launching collector suites of the shared browser lane.
//   M  reintroduced defects through their own legs (an unchanged copy of each selection first).
// Selection: OMF_CARD_LEGS (comma list of F,U,K,N,S,C,P,R,RN,M), OMF_CARD_MUTANTS (labels); OMF_CARD_EVIDENCE keeps every leg's log.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const timeoutMs = 14400000;
const SELF = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(SELF), '..', '..');
export const BASE = '74f49b348eaf402e19360f17f027b8eedfde78a0';
// The build revision before the settings-route admission and the Aplus page-read correction (card-handover/SETTINGS-ROUTE-COMPLETION.json).
export const PRE = '5e5ce0ff9f5e56798b83c43827dfb4f0b8d20849';
// The release candidate before the focus repair (focus-repair/6-build.md): its setup page renders the previous-setup section once, so a
// page opened during the collector's tick keeps Check disabled.
export const FOCUS = 'd067126af15fd9df3bbde56843dd2d7886963bb7';
const execute = promisify(execFile);
const sha256 = v => createHash('sha256').update(v).digest('hex');
const EVIDENCE = process.env.OMF_CARD_EVIDENCE || '';
const LEGS = (process.env.OMF_CARD_LEGS || '').split(',').map(s => s.trim()).filter(Boolean);
const NATIVE = process.env.OMF_CARD_NATIVE !== '0';
// Parent fold P5: a selected (OMF_CARD_LEGS / OMF_CARD_MUTANTS) or non-native run is development evidence and exports no coverage;
// only the complete run with its native legs may claim the covered files (the verifier reads `covers` at load).
export const PARTIAL = LEGS.length > 0 || !!process.env.OMF_CARD_MUTANTS || !NATIVE;
const COVERS = ['pages/connections.vue', 'server/api/finance/[...path].ts', 'collector/legacy-card-import.mjs', 'collector/index.mjs', 'collector/setup.html', 'collector/setup.js', 'collector/omf-authorization.mjs', 'collector/browser.mjs', 'collector/login.mjs', 'collector/aplus.mjs', 'collector/package/stage.mjs', 'server/api/finance/collector-security/[...path].ts', 'server/services/financeCollectorSecurityService.ts', 'server/services/financeService.ts', 'server/services/financeSyncScheduler.ts', 'docs/amex-connector.md', 'collector/test/legacy-card-import.test.mjs', 'collector/test/card-background.test.mjs', 'scripts/finance-legacy-card-import-integration.cjs', 'scripts/zoomer-fixtures/omf-card-handover.mjs'];
const UNIT = 'collector/test/legacy-card-import.test.mjs', BACKGROUND = 'collector/test/card-background.test.mjs', INTEGRATION = 'scripts/finance-legacy-card-import-integration.cjs';
// Existing collector suites that exercise the changed modules: no Chrome (R) and the Chrome-launching shared browser lane (RN, native).
const EXISTING = ['collector/test/login.test.mjs', 'collector/test/mail.test.mjs', 'collector/test/omf-authorization.test.mjs', 'collector/test/sealed-vault.test.mjs', 'collector/test/split-vault.test.mjs', 'collector/test/vault.test.mjs', 'collector/test/statement.test.mjs', 'collector/test/aplus-setup.test.mjs', 'collector/test/yayoi.test.mjs', 'collector/test/yayoi-setup.test.mjs', 'collector/test/startup.test.mjs'];
// paypay-setup/rakuten-setup drive the real setup.html + setup.js (changed) in owned headless Chrome against a stub /status.
const EXISTING_NATIVE = ['collector/test/frame-init.test.mjs', 'collector/test/rakuten-standard.test.mjs', 'collector/test/paypay-standard.test.mjs', 'collector/test/bank-balance.test.mjs', 'collector/test/paypay-setup.test.mjs', 'collector/test/rakuten-setup.test.mjs'];
// The module a copy replaces, by the test seam that loads it.
const ENV = { 'collector/legacy-card-import.mjs': 'OMF_TEST_IMPORT_MODULE', 'collector/omf-authorization.mjs': 'OMF_TEST_AUTHORIZATION_MODULE', 'collector/browser.mjs': 'OMF_TEST_BROWSER_MODULE', 'collector/login.mjs': 'OMF_TEST_LOGIN_MODULE', 'collector/aplus.mjs': 'OMF_TEST_APLUS_MODULE', 'collector/index.mjs': 'OMF_TEST_INDEX_MODULE' };
const SERVER_FILES = ['server/services/financeCollectorSecurityService.ts', 'server/api/finance/collector-security/[...path].ts', 'server/services/financeService.ts', 'server/services/financeSyncScheduler.ts', 'server/api/finance/[...path].ts'];
const ROUTE = 'server/api/finance/[...path].ts', SERVICE = 'server/services/financeService.ts';

// ── M: [label, file, [[anchor, replacement], …] (each anchor exactly once), leg (U|K|S|P), selection (test name pattern | S legs), expected failure] ──
const I = 'collector/legacy-card-import.mjs', BR = 'collector/browser.mjs';
export const MUTANTS = [
  ['MI1-read-before-grant', I, [['try { grant = await remote.legacyOwner(); } catch (error) { throw remoteFailure(error); } // guard:legacy-grant-first', 'grant = { ownerId, origin, accountIds: [] };']], 'U', '^grant-first', /grant-first:/],
  ['MI2-unproven-owner-imported', I, [["basis = proof.matched ? 'proved' : 'unproven'; scope = proof.matched ? proof.accountIds : []; // guard:legacy-proof", "basis = 'proved'; scope = proof.accountIds.length ? proof.accountIds : grant.accountIds;"]], 'U', '^unproven', /unproven:/],
  ['MI3-existing-destination-overwritten', I, [['keep = existing.has(entry); // guard:legacy-existing', 'keep = false;']], 'U', '^existing destination', /existing:amex-kept/],
  ['MI4-previous-directory-moved', I, [['return { result: { owner: basis, counts, items: outcomes', "await (await import('node:fs/promises')).rename(deps.source, deps.source + '-moved'); return { result: { owner: basis, counts, items: outcomes"]], 'U', '^real DPAPI round trip', /ENOENT|roundtrip:source-unchanged/],
  ['MI5-previous-address-trusted', I, [["else if (blob.baseUrl !== undefined && blob.baseUrl !== null && blob.baseUrl !== '') { basis = 'unproven'; scope = []; } // guard:legacy-address-unproven", '']], 'U', '^unproven', /unproven:address only/],
  ['MI6-mailbox-broadened', I, [["else if (!matched.includes(grant.mailbox)) add({ kind: 'mailbox', action: 'unmatched' }); // guard:legacy-mailbox", '']], 'U', '^mailbox', /mailbox:(other-mailbox|no-matched-amex)/],
  ['MI7-not-private-read', I, [["if (!await privateCheck(source, file)) throw legacyError('legacy-unsafe'); // guard:legacy-private", '']], 'U', '^source:', /expected legacy-unsafe but it resolved/],
  ['MI8-protected-store-read', I, [["if (!await rawSetup(source, names)) return { available: false, code: 'legacy-protected' }; // guard:legacy-raw-only", '']], 'U', '^source:', /expected legacy-protected/],
  ['MI9-changed-setup-imported', I, [["if (sourceHash !== record.sourceHash) throw legacyError('legacy-changed'); // guard:legacy-unchanged", '']], 'U', '^stale or changed', /expected legacy-changed/],
  ['MI10-write-after-cancel', I, [['try { deps.assertLive(); outcome = await deps.write(item); } // guard:legacy-live', 'try { outcome = await deps.write(item); }']], 'U', '^cancellation', /cancel:successor write/],
  ['MI11-own-directory-read', I, [["if (!source || !target || keyOf(source) === keyOf(target) || within(source, target) || within(target, source)) return { available: false, code: 'legacy-same' }; // guard:legacy-distinct", ''], ["if (keyOf(real) === keyOf(realTarget) || within(real, realTarget) || within(realTarget, real)) throw legacyError('legacy-same');", '']], 'U', '^source:', /expected legacy-same/],
  ['MI12-unchecked-entry-imported', I, [[' || !record.entries.includes(item.entry)) { counts.notImported++;', ') { counts.notImported++;']], 'U', '^checked entries only', /checked:not-checked entry written/],
  ['MI13-raw-token-sent', I, [['proof = await remote.legacyOwner(sha256(blob.token));', 'proof = await remote.legacyOwner(blob.token);']], 'U', '^same-owner proof', /proof:hash-only/],
  ['MI14-other-owner-grant-accepted', I, [["if (grant.ownerId !== ownerId || grant.origin !== origin) throw legacyError('legacy-owner'); // guard:legacy-owner-match", '']], 'U', '^grant-first', /grant-first:another (owner|origin) touched the previous setup/],
  ['MI15-parent-link-followed', I, [["if (keyOf(real) !== keyOf(source) || keyOf(realFile) !== keyOf(file)) throw legacyError('legacy-unsafe'); // guard:legacy-plain", '']], 'U', '^source:', /expected legacy-unsafe but it resolved|source:parent junction/],
  ['MB1-amex-visible-launch', BR, [['onLaunch, background: true }); // guard:card-background-amex', 'onLaunch });']], 'K', '^Amex wrapper', /card-background:amex-launch/],
  ['MB2-aplus-visible-launch', BR, [['onLaunch, background: true }); // guard:card-background-aplus', 'onLaunch });']], 'K', '^Aplus wrapper', /card-background:aplus-launch/],
  ['MB3-amex-attention-unrouted', BR, [[', ui: loginUi(page, { reveal }) }); // guard:card-reveal-amex', ' });']], 'K', '^Amex wrapper', /FOREGROUND/],
  ['MB4-aplus-attention-unrouted', BR, [['signal, ui, reveal }); // guard:card-reveal-aplus', 'signal, ui });']], 'K', '^Aplus wrapper', /FOREGROUND/],
  ['ML1-login-ui-ignores-reveal', 'collector/login.mjs', [['async show() { if (reveal) await reveal(page); else await page.bringToFront(); } // guard:login-reveal', 'async show() { await page.bringToFront(); }']], 'K', '^login UI', /card-reveal:login-ui-routes/],
  ['MA1-aplus-ui-ignores-reveal', 'collector/aplus.mjs', [['async show() { if (reveal) await reveal(page); else await page.bringToFront(); }, // guard:aplus-reveal', 'async show() { await page.bringToFront(); },']], 'K', '^Aplus default UI', /card-reveal:aplus-ui-background/],
  ['MP1-importer-not-staged', 'collector/package/stage.mjs', [[",'legacy-card-import']", ']']], 'P', '', /card-handover:staged|staged import missing/],
  ['MS1-amex-not-due', 'server/services/financeSyncScheduler.ts', [['AUTO_SYNC_PROVIDERS.includes(row?.provider)', "row?.provider === 'aplus'"]], 'S', 'L5', /schedule:amex-and-aplus-due/],
  ['MS2-amex-refused-by-the-atomic-write', 'server/services/financeService.ts', [['findOneAndUpdate({ _id: account._id, provider: { $in: [...AUTO_SYNC_PROVIDERS] }', "findOneAndUpdate({ _id: account._id, provider: 'aplus'"]], 'S', 'L5', /schedule:amex-and-aplus-due/],
  ['MS3-same-day-enqueued-again', 'server/services/financeService.ts', [["'autoSync.lastQueuedDay': { $ne: day }, ", '']], 'S', 'L5', /schedule:(atomic-already-queued-today|same-day-once|claimed-today-not-again|concurrent-exactly-once|manual-claim-same-day)/],
  ['MS4-amex-not-scanned', 'server/services/financeSyncScheduler.ts', [['FinancialAccount.find({ provider: { $in: [...AUTO_SYNC_PROVIDERS] }', "FinancialAccount.find({ provider: 'aplus'"]], 'S', 'L5', /schedule:amex-and-aplus-due/],
  ['MX1-check-confirmed-twice', 'collector/index.mjs', [['legacyCheck=null; // guard:legacy-one-confirm', '']], 'S', 'L3', /legacy:one-confirm/],
  ['MX2-target-metadata-rewritten', 'collector/index.mjs', [["return 'imported';", "await vault.update(old=>({...old,legacyImportedAt:new Date().toISOString()}));return 'imported';"]], 'S', 'L3', /legacy:target-unchanged/],
  // parent folds: P2b (the shared Aplus login kept inside the writer lease), P4/P4b (an automatic statement code stays hidden and never asks
  // the person), P6/P6b (a truthful panel; an account's own flag never counts the shared login)
  ['MX4-manual-save-overwritten', 'collector/index.mjs', [["if(await secrets.has(item.entry))return 'existing'; // guard:legacy-no-overwrite", '']], 'S', 'L3', /legacy:race-(kept|one-key)/],
  ['MX3-shared-aplus-overwritten', 'collector/index.mjs', [["if(item.account?.provider==='aplus'&&await secrets.has('aplus'))return 'existing'; // guard:legacy-shared-aplus-kept", '']], 'S', 'L3', /legacy:p2b-specific-not-written/],
  ['MA2-auto-code-reveals', 'collector/aplus.mjs', [["onVerification: quiet ? async () => { if (codeSource && now() - requestedAt <= STATEMENT_CODE_VALIDITY_MS) await status('running', 'My APLUSの認証コードをSMSから自動で入力します'); } : ask, // guard:aplus-quiet-notice", 'onVerification: ask, // guard:aplus-quiet-notice']], 'N', '^native Aplus statement code read automatically', /card-reveal:native-auto-(code-hidden|no-person-state)/],
  ['MA3-manual-attention-dropped', 'collector/aplus.mjs', [['if (!(codeSource && code) || now() - requestedAt > STATEMENT_CODE_VALIDITY_MS) await person(); // guard:aplus-manual-attention', '']], 'K', '^statement code', /card-reveal:(no-source-shown|expiry-shown-once)/],
  ['MA4-failed-read-silent', 'collector/aplus.mjs', [['match = null; await person(); } // a failed read', 'match = null; } // a failed read']], 'K', '^statement code', /card-reveal:reader-failure-shown-(once|at-the-failure)/],
  ['MA5-auto-code-asks-person', 'collector/aplus.mjs', [["await status('running', 'My APLUSの認証コードをSMSから自動で入力します'); } : ask, // guard:aplus-quiet-notice", "await status('verification_required', 'My APLUSの認証コードをChromeで入力してください'); } : ask, // guard:aplus-quiet-notice"]], 'N', '^native Aplus statement code read automatically', /card-reveal:native-auto-no-person-state/],
  ['MA6-manual-reveal-without-asking', 'collector/aplus.mjs', [['...(quiet ? { onManual: ask } : {}) }); // guard:aplus-manual-ask', '...(quiet ? { onManual: () => ui.show() } : {}) });']], 'N', '^native Aplus without a code source', /card-reveal:native-manual-asks-person-once/],
  ['MA7-custom-ui-quiet', 'collector/aplus.mjs', [['const quiet = !ui && !!reveal;', 'const quiet = !!reveal;']], 'K', '^custom Aplus UI with an SMS source', /card-reveal:custom-ui-asks-at-notice/],
  ['MU2-shared-login-reported-as-own', 'collector/index.mjs', [["hasCredentials:await boundSecret(provider+'-'+String(a._id),state?.installationId,provider,a,config)};", "hasCredentials:(await boundSecret(provider+'-'+String(a._id),state?.installationId,provider,a,config))||(provider==='aplus'&&aplus)};"]], 'S', 'L3', /legacy:p6b-shared-not-own/],
  ['MU1-aplus-panel-untruthful', 'collector/setup.js', [["$('#aplus-saved').textContent=aplusSavedText(!!data.hasCredentials,all.accounts);", "$('#aplus-saved').textContent=data.hasCredentials?'Login saved. Enter both fields to replace it.':'Enter the login you use for My APLUS.';"]], 'C', 'L3,L4', /ui:aplus-panel-truthful/],
  // the native Amex daily setting (card-handover/SETTINGS-ROUTE-COMPLETION.json): the route's opt-in and gate, the shared write's Aplus-only
  // default kept for the owner Navi action
  ['MR1-route-not-opted-in', ROUTE, [[', null, { providers: AUTO_SYNC_PROVIDERS })', ')']], 'S', 'L6', /route:amex-daily-setting-saved/],
  ['MR2-route-aplus-gate-restored', ROUTE, [["if (!AUTO_SYNC_PROVIDERS.includes(account.provider)) fail(400, 'Amex or Aplus account required')", "if (account.provider !== 'aplus') fail(400, 'Aplus account required')"]], 'S', 'L6', /route:amex-daily-setting-saved/],
  ['MR3-shared-write-any-provider', SERVICE, [["if (!providers.includes(account.provider)) fail(400, providers.includes('amex') ? 'Amex or Aplus account required' : 'Aplus account required') // guard:auto-sync-providers", '']], 'S', 'L6', /navi:(shared-default-aplus-only|amex-refused)/],
  ['MR4-shared-default-widened', SERVICE, [["{ providers = ['aplus'] }", '{ providers = AUTO_SYNC_PROVIDERS }']], 'S', 'L6', /navi:(shared-default-aplus-only|amex-refused)/],
  // the Aplus page read a navigation interrupts (the native N failures at 5e5ce0f): an unknown page for that poll, never a broader catch
  ['MA8-aplus-navigation-read-fails', 'collector/aplus.mjs', [["} catch (error) { if (NAVIGATED.test(String(error?.message))) return { kind: 'unknown' }; throw error; } // guard:aplus-state-navigation", '} catch (error) { throw error; }']], 'K', '^Aplus page read', /card-aplus:navigation-read-is-unknown/],
  ['MA9-aplus-any-read-failure-ignored', 'collector/aplus.mjs', [["if (NAVIGATED.test(String(error?.message))) return { kind: 'unknown' }; throw error; } // guard:aplus-state-navigation", "return { kind: 'unknown' }; }"]], 'K', '^Aplus page read', /card-aplus:closed-target-ends-job/],
  // the focus repair (focus-repair/6-build.md): the previous-setup section re-read while the collector's own tick is busy
  ['MU3-legacy-busy-not-reread', 'collector/setup.js', [["clearTimeout(legacyTimer);if(data.busy&&state==='legacy-ready')legacyTimer=setTimeout(()=>call('/status').then(next=>{current=next;showLegacy(next);}).catch(()=>{}),2000);", '']], 'C', 'L3,L4', /ui:legacy-busy-reread/]
];

function runChild(args, env, timeout) {
  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, args, { cwd: root, windowsHide: true, timeout, maxBuffer: 128 * 1024 * 1024, env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      const text = String(stdout || ''), lines = text.split(/\r?\n/);
      resolve({ ms: Date.now() - started, code: error ? (error.code ?? 1) : 0, text, stderr: String(stderr || ''), passes: lines.filter(l => l.startsWith('PASS ')), fails: lines.filter(l => l.startsWith('FAIL ')), setup: lines.find(l => l.startsWith('SETUP ')) || null, mutants: (lines.find(l => l.startsWith('MUTANTS ')) || '').slice(8), receipt: (() => { try { return JSON.parse((lines.find(l => l.startsWith('RECEIPT ')) || '').slice(8)); } catch { return null; } })() });
    });
  });
}
// node --test summary: pass/fail/skip counts and the failing test names with their first assertion message.
function tests(r) {
  const out = r.text + '\n' + r.stderr, n = name => Number((out.match(new RegExp('ℹ ' + name + ' (\\d+)')) || [])[1] || 0);
  const failures = [...out.matchAll(/✖ (.+?) \(\d/g)].map(x => x[1]).filter(name => !/^(failing tests|tests)/.test(name));
  return { pass: n('pass'), fail: n('fail'), skipped: n('skipped'), failures: [...new Set(failures)], message: (out.match(/(?:AssertionError|Error)[^\n]*\n[^\n]*\n?[^\n]*/) || [''])[0].replace(/\s+/g, ' ').slice(0, 600), out };
}
async function walkImports(entry, seen = new Set()) {
  if (seen.has(entry)) return seen; seen.add(entry);
  const text = await readFile(entry, 'utf8');
  for (const m of text.matchAll(/(?:^|\n)\s*import[^'"\n]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
    const target = path.resolve(path.dirname(entry), m[1] || m[2]);
    if (!existsSync(target)) throw new Error('staged import missing: ' + path.relative(path.dirname(entry), target) + ' from ' + path.basename(entry));
    await walkImports(target, seen);
  }
  return seen;
}
// Every node --test child gets LOCALAPPDATA at an owned empty root: a suite that starts this collector and reads /status (startup.test.mjs)
// then inspects <owned root>\OhMyFinance\collector, never the standard previous directory of this Windows user. Chrome is found under
// Program Files; the mongodb-memory-server binaries are under the home directory.
let ownedLocal = null;
const localRoot = async () => ownedLocal ??= await mkdtemp(path.join(os.tmpdir(), 'omf-card-local-'));
const unit = async (file, env = {}, pattern = null) => runChild(['--test', '--test-concurrency=1', '--test-timeout=900000', ...(pattern ? ['--test-name-pattern=' + pattern] : []), file], { LOCALAPPDATA: await localRoot(), ...env }, 3600000);
const harness = (env = {}, ui = false) => runChild(['--import', 'tsx', INTEGRATION, ...(ui ? ['--ui'] : [])], { MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', ...env }, 3600000);
// A copy of one module beside its original (relative imports resolve unchanged), removed afterwards.
async function withCopy(file, label, text, fn) {
  const copy = path.join(root, path.dirname(file), '.zoomer-card-' + label + '-' + path.basename(file));
  await writeFile(copy, text); try { return await fn(copy); } finally { await rm(copy, { force: true }).catch(() => {}); }
}
// A copy of aplus.mjs reaches the wrapper legs (Part B native Aplus) only through browser.mjs: a browser.mjs copy importing that copy is
// loaded as well, so the native legs run the copy. Other files: their own test seam only. Returns the env of the seams.
async function withRouted(file, label, text, fn) {
  return withCopy(file, label, text, async copy => {
    if (file !== 'collector/aplus.mjs') return fn({ [ENV[file]]: copy });
    const browserText = mutate(await readFile(path.join(root, BR), 'utf8'), [["from './aplus.mjs';", "from './" + path.basename(copy) + "';"]], label + ' browser route');
    return withCopy(BR, label, browserText, browserCopy => fn({ [ENV[file]]: copy, [ENV[BR]]: browserCopy }));
  });
}
// A copy of server/ + shared/ (inside the worktree so dependencies resolve) with the given files replaced.
async function withTree(label, replace, fn) {
  const dir = path.join(root, '.cache', 'omf-card-' + label); await rm(dir, { recursive: true, force: true });
  for (const d of ['server', 'shared']) await cp(path.join(root, d), path.join(dir, d), { recursive: true });
  for (const [file, text] of Object.entries(replace)) await writeFile(path.join(dir, file), text);
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
const baseText = async (file, revision = BASE) => { try { return (await execute('git', ['-C', root, 'show', revision + ':' + file], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 })).stdout; } catch { return null; } };
const mutate = (source, pairs, label) => { let text = source.replace(/\r\n/g, '\n'); for (const [anchor, replacement] of pairs) { const hits = text.split(anchor).length - 1; if (hits !== 1) throw new Error(label + ' anchor hits ' + hits + ': ' + anchor.slice(0, 80)); text = text.split(anchor).join(replacement); } return text; };
async function stageCheck(stageFile = path.join(root, 'collector/package/stage.mjs')) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-card-stage-'));
  try {
    const stageModule = await import(pathToFileURL(stageFile).href + '?' + Date.now()), into = path.join(temp, 'staged');
    const { manifest } = await stageModule.stage({ into, origin: 'https://omf.example', install: false, log: () => {} });
    for (const entry of ['collector/legacy-card-import.mjs', 'collector/index.mjs', 'collector/browser.mjs', 'collector/login.mjs', 'collector/aplus.mjs', 'collector/omf-authorization.mjs', 'collector/setup.html', 'collector/setup.js']) {
      if (!manifest.files[entry]) throw new Error('card-handover:staged ' + entry + ' is not in the package');
      if (manifest.files[entry] !== sha256(await readFile(path.join(root, entry)))) throw new Error('card-handover:staged-hash ' + entry);
    }
    if (Object.keys(manifest.files).some(f => f.includes('/test/') || /mutant|zoomer/.test(f))) throw new Error('card-handover:no-test-code-staged');
    const graph = await walkImports(path.join(into, 'collector', 'index.mjs'));
    if (![...graph].some(f => f.endsWith(path.join('collector', 'legacy-card-import.mjs')))) throw new Error('card-handover:importer-not-in-graph');
    const staged = await import(pathToFileURL(path.join(into, 'collector', 'legacy-card-import.mjs')).href);
    if (typeof staged.previewLegacyCards !== 'function' || staged.standardSource({ LOCALAPPDATA: 'C:\\Synthetic' }) !== path.resolve('C:\\Synthetic\\OhMyFinance\\collector')) throw new Error('card-handover:staged-importer-loads');
    return Object.keys(manifest.files).length + ' files staged; the importer hashed, in the graph from index.mjs and loadable without node_modules; no test code';
  } finally { await rm(temp, { recursive: true, force: true }).catch(() => {}); }
}

export default { name: 'omf-card-handover', covers: PARTIAL ? [] : COVERS, async run() {
  const started = Date.now(), lines = [], green = new Set(); let pass = true, executed = false;
  const chosenMutants = (process.env.OMF_CARD_MUTANTS || '').split(',').map(s => s.trim()).filter(Boolean);
  const unknown = chosenMutants.filter(x => !MUTANTS.some(mm => mm[0] === x)); if (unknown.length) return { pass: false, databaseCoverage: { executed: false, ownedProcess: false }, message: 'RED unknown OMF_CARD_MUTANTS: ' + unknown.join(', ') };
  const MUTANTS_RUN = chosenMutants.length ? MUTANTS.filter(mm => chosenMutants.includes(mm[0])) : MUTANTS;
  const counts = { unitTests: 0, backgroundTests: 0, nativeTests: 0, harnessLegs: 0, serviceGuardMutants: '', ui: 0, existing: {}, failFirst: {}, mutantsCaught: 0, mutantsTotal: MUTANTS_RUN.length, native: NATIVE };
  const want = name => !LEGS.length || LEGS.includes(name);
  const keep = async (name, text) => { if (EVIDENCE) { await mkdir(EVIDENCE, { recursive: true }); await writeFile(path.join(EVIDENCE, 'leg-' + name + '.txt'), text); } };
  const leg = async (name, fn) => { const key = name.split(' ')[0]; if (!want(key)) return; const t = Date.now(); try { lines.push(name + ': ' + await fn() + ' (' + Math.round((Date.now() - t) / 1000) + 's)'); green.add(key); } catch (e) { pass = false; const msg = String(e?.message || e).replace(/\s+/g, ' ').slice(0, 2400); lines.push(name + ': ' + (/^(SETUP|NOT RUN)/.test(msg) ? '' : 'RED ') + msg); } };
  const unitGreen = (r, t, what) => { if (r.code !== 0 || t.fail || !t.pass) throw new Error(t.fail + ' failed: ' + t.failures.join(' | ') + ' — ' + t.message + (/Cannot find module|ERR_MODULE_NOT_FOUND/.test(t.out) ? ' (' + what + ' absent)' : '')); };
  try {
    await leg('F fail-first on the base revision ' + BASE.slice(0, 7) + ' (each changed module in its defect seam), on ' + PRE.slice(0, 7) + ' before the settings-route and page-read corrections and on ' + FOCUS.slice(0, 7) + ' before the focus repair', async () => {
      const found = [];
      // U: no importer, keyService without legacyOwner
      { const authorization = await baseText('collector/omf-authorization.mjs'); const r = await withCopy('collector/omf-authorization.mjs', 'base', authorization, copy => unit(UNIT, { OMF_TEST_IMPORT_MODULE: path.join(root, 'collector', '.zoomer-card-base-absent-legacy-card-import.mjs'), OMF_TEST_AUTHORIZATION_MODULE: copy })), t = tests(r); await keep('F-U', t.out);
        if (t.pass !== 0 || !/is absent — no explicit protected previous-card import exists/.test(t.out) || !/keyService has no legacyOwner/.test(t.out)) throw new Error('U did not fail first on the base: pass ' + t.pass + ' fail ' + t.fail + ' ' + t.message);
        counts.failFirst.U = t.fail + '/' + (t.pass + t.fail); found.push('U ' + t.fail + ' red (importer absent; keyService without legacyOwner)'); }
      // K: the base wrappers launch a visible window and route attention to bringToFront
      { const texts = {}; for (const f of ['collector/browser.mjs', 'collector/login.mjs', 'collector/aplus.mjs']) texts[f] = await baseText(f);
        const r = await withCopy('collector/browser.mjs', 'base', texts['collector/browser.mjs'], b => withCopy('collector/login.mjs', 'base', texts['collector/login.mjs'], l => withCopy('collector/aplus.mjs', 'base', texts['collector/aplus.mjs'], a => unit(BACKGROUND, { OMF_TEST_BROWSER_MODULE: b, OMF_TEST_LOGIN_MODULE: l, OMF_TEST_APLUS_MODULE: a, OMF_CARD_NATIVE: '0' })))), t = tests(r); await keep('F-K', t.out);
        const named = ['card-reveal:login-ui-routes', 'card-reveal:ensure-login', 'card-reveal:aplus-ui-background', 'FOREGROUND', 'card-aplus:navigation-read-is-unknown'].filter(x => t.out.includes(x));
        if (t.fail < 7 || named.length !== 5) throw new Error('K did not fail first on the base: fail ' + t.fail + ', named ' + named.join(','));
        counts.failFirst.K = t.fail + '/' + (t.pass + t.fail); found.push('K ' + t.fail + ' red (' + named.join(', ') + ')'); }
      // S: no legacyOwner/route/local routes, Amex never scheduled, the Amex daily setting refused
      { const replace = {}; for (const f of SERVER_FILES) replace[f] = await baseText(f);
        const index = await baseText('collector/index.mjs');
        const r = await withTree('base', replace, dir => withCopy('collector/index.mjs', 'base', index, copy => harness({ OMF_CARD_SRC: dir, OMF_TEST_INDEX_MODULE: copy }))); executed = true; await keep('F-S', r.text + '\n--- stderr ---\n' + r.stderr);
        const fails = r.fails.join(' | '), named = ['legacy:service-exported', 'legacy:route', 'legacy-status', 'schedule:amex-and-aplus-due', 'route:amex-daily-setting-saved'].filter(x => fails.includes(x));
        if (r.receipt?.pass || named.length !== 5) throw new Error('S did not fail first on the base: ' + r.fails.length + ' failed, named ' + named.join(',') + ' — ' + fails.slice(0, 600));
        counts.failFirst.S = r.fails.length + ' red / ' + r.passes.length + ' green'; found.push('S ' + r.fails.length + ' red (' + named.join(', ') + ')'); }
      // PRE: the settings route and service of 5e5ce0f refuse the Amex save from the page with 400; its aplus.mjs ends a job on a page read
      // a navigation interrupts (the native N failures of the parent's prepared run at those bytes)
      { const replace = { [ROUTE]: await baseText(ROUTE, PRE), [SERVICE]: await baseText(SERVICE, PRE) };
        const r = await withTree('pre', replace, dir => harness({ OMF_CARD_SRC: dir, OMF_CARD_ONLY: 'L6' })); executed = true; await keep('F-PRE-S', r.text + '\n--- stderr ---\n' + r.stderr);
        const fails = r.fails.join(' | ');
        if (r.receipt?.pass || !/route:amex-daily-setting-saved \{"status":400,.*Aplus account required/.test(fails)) throw new Error('L6 did not fail first on ' + PRE.slice(0, 7) + ': ' + (fails || r.stderr.slice(-400)).slice(0, 600));
        counts.failFirst.PRE_S = 'L6 red (the Amex save 400)'; found.push(PRE.slice(0, 7) + ' L6 red (route:amex-daily-setting-saved: 400 Aplus account required)'); }
      { const r = await withCopy('collector/aplus.mjs', 'pre', await baseText('collector/aplus.mjs', PRE), a => unit(BACKGROUND, { OMF_TEST_APLUS_MODULE: a, OMF_CARD_NATIVE: '0' }, '^Aplus page read')), t = tests(r); await keep('F-PRE-K', t.out);
        if (t.fail !== 1 || !t.out.includes('card-aplus:navigation-read-is-unknown Execution context was destroyed')) throw new Error('the Aplus page read did not fail first on ' + PRE.slice(0, 7) + ': fail ' + t.fail + ' ' + t.message);
        counts.failFirst.PRE_K = t.fail + '/' + (t.pass + t.fail); found.push(PRE.slice(0, 7) + ' K red (card-aplus:navigation-read-is-unknown)'); }
      // FOCUS: d067126's setup page, opened while the collector's tick is held at OMF, keeps Check disabled after the tick ends (L4, headless
      // Chrome).
      { if (!NATIVE) throw new Error('NOT RUN: OMF_CARD_NATIVE=0 — the ' + FOCUS.slice(0, 7) + ' setup-page fail-first needs owned headless Chrome');
        const index = await readFile(path.join(root, 'collector/index.mjs'), 'utf8');
        const r = await withCopy('collector/setup.js', 'focus', await baseText('collector/setup.js', FOCUS), setupCopy => withCopy('collector/index.mjs', 'focus', mutate(index, [["'./setup.js'", "'./" + path.basename(setupCopy) + "'"]], 'focus index'), indexCopy => harness({ OMF_TEST_INDEX_MODULE: indexCopy, OMF_CARD_ONLY: 'L3,L4', OMF_CARD_NATIVE: '1' }, true))); executed = true; await keep('F-FOCUS-C', r.text + '\n--- stderr ---\n' + r.stderr);
        if (r.receipt?.pass || r.fails.length !== 1 || !/^FAIL L4 .*UI timed out: previous setup section enabled once the collector is idle \(ui:legacy-busy-reread\) \{"busy":true/.test(r.fails[0])) throw new Error('the setup page did not fail first on ' + FOCUS.slice(0, 7) + ': ' + (r.fails.join(' | ') || r.stderr.slice(-400)).slice(0, 700));
        counts.failFirst.FOCUS_C = 'L4 red (Check left disabled after the busy tick)'; found.push(FOCUS.slice(0, 7) + ' L4 red (ui:legacy-busy-reread: the page kept its busy render)'); }
      // P: the base allowlist does not stage the importer
      { const stage = await baseText('collector/package/stage.mjs'); let failure = null;
        await withCopy('collector/package/stage.mjs', 'base', stage, async copy => { try { await stageCheck(copy); } catch (e) { failure = String(e.message); } });
        if (!failure || !/card-handover:staged collector\/legacy-card-import\.mjs/.test(failure)) throw new Error('P did not fail first on the base: ' + failure);
        counts.failFirst.P = failure; found.push('P red (' + failure.slice(0, 80) + ')'); }
      return found.join('; ');
    });
    await leg('U node --test ' + UNIT, async () => { const r = await unit(UNIT), t = tests(r); await keep('U', t.out); counts.unitTests = t.pass; unitGreen(r, t, 'the importer'); return t.pass + ' tests green'; });
    await leg('K node --test ' + BACKGROUND + ' (Part A, no Chrome)', async () => { const r = await unit(BACKGROUND, { OMF_CARD_NATIVE: '0' }), t = tests(r); await keep('K', t.out); counts.backgroundTests = t.pass; unitGreen(r, t, 'the wrappers'); return t.pass + ' tests green, ' + t.skipped + ' skipped (geometry excluded; native legs are leg N)'; });
    await leg('N native background Chrome (OMF_CARD_NATIVE=1)', async () => {
      if (!NATIVE) throw new Error('NOT RUN: OMF_CARD_NATIVE=0 — no native background coverage is claimed');
      const r = await unit(BACKGROUND, { OMF_CARD_NATIVE: '1' }, '^native'), t = tests(r); await keep('N', t.out); counts.nativeTests = t.pass; unitGreen(r, t, 'the wrappers');
      if (t.pass !== 6) throw new Error('expected the 6 native legs, ran ' + t.pass);
      return t.pass + ' native legs green';
    });
    await leg('S services, route, the real collector over TLS, schedule and the service guard mutants (L1-L3, L5-L7)', async () => {
      const r = await harness(); executed = true; await keep('S', r.text + '\n--- stderr ---\n' + r.stderr); counts.harnessLegs = r.passes.length; counts.serviceGuardMutants = r.mutants;
      if (r.setup) throw new Error(r.setup + ' (no behavioural result)');
      if (r.code !== 0 || !r.receipt?.pass || r.fails.length) throw new Error(r.fails.length + ' failed / ' + r.passes.length + ' green: ' + (r.fails.join(' | ') || r.stderr.slice(-800)).slice(0, 2000));
      return r.passes.length + ' legs green; service guard mutants caught: ' + r.mutants;
    });
    await leg('C setup page and connections page in owned headless Chrome (--ui, OMF_CARD_NATIVE=1)', async () => {
      if (!NATIVE) throw new Error('NOT RUN: OMF_CARD_NATIVE=0 — no setup-page or connections-page coverage is claimed');
      const r = await harness({ OMF_CARD_NATIVE: '1', OMF_CARD_ONLY: 'L3,L4,L8' }, true); executed = true; await keep('C', r.text + '\n--- stderr ---\n' + r.stderr); counts.ui = r.passes.filter(p => /^PASS L[48] /.test(p)).length;
      if (r.code !== 0 || !r.receipt?.pass || counts.ui !== 2) throw new Error((r.fails.join(' | ') || r.stderr.slice(-800)).slice(0, 1500));
      return counts.ui + ' page legs green (L4 setup page; L8 connections page: the Amex daily setting saved from the page and kept after a refresh)';
    });
    await leg('P collector package', async () => stageCheck());
    await leg('R affected existing collector suites without Chrome: ' + EXISTING.map(f => path.basename(f)).join(', '), async () => {
      const out = [], failed = [];
      for (const file of EXISTING) { const r = await unit(file), t = tests(r); counts.existing[file] = { pass: t.pass, fail: t.fail, skipped: t.skipped }; out.push(path.basename(file) + ' ' + t.pass + '/' + (t.pass + t.fail)); await keep('R-' + path.basename(file), t.out); if (r.code !== 0 || t.fail || !t.pass) failed.push(file + ': ' + t.fail + ' failed: ' + t.failures.join(' | ') + ' — ' + t.message); }
      if (failed.length) throw new Error(failed.length + ' of ' + EXISTING.length + ' suites failed: ' + failed.join(' || ') + ' ; all: ' + out.join('; '));
      return out.join('; ');
    });
    await leg('RN the shared browser lane suites with Chrome: ' + EXISTING_NATIVE.map(f => path.basename(f)).join(', '), async () => {
      if (!NATIVE) throw new Error('NOT RUN: OMF_CARD_NATIVE=0');
      const out = [], failed = [];
      for (const file of EXISTING_NATIVE) { const r = await unit(file), t = tests(r); counts.existing[file] = { pass: t.pass, fail: t.fail, skipped: t.skipped }; out.push(path.basename(file) + ' ' + t.pass + '/' + (t.pass + t.fail)); await keep('RN-' + path.basename(file), t.out); if (r.code !== 0 || t.fail || !t.pass) failed.push(file + ': ' + t.fail + ' failed: ' + t.failures.join(' | ') + ' — ' + t.message); }
      if (failed.length) throw new Error(failed.length + ' of ' + EXISTING_NATIVE.length + ' suites failed: ' + failed.join(' || ') + ' ; all: ' + out.join('; '));
      return out.join('; ');
    });
    await leg('M reintroduced defects, each through its own leg after an unchanged copy of the same selection' + (chosenMutants.length ? ' (selected ' + MUTANTS_RUN.length + '/' + MUTANTS.length + ')' : ''), async () => {
      const caught = [], missed = [], controls = new Map();
      const record = async item => { if (EVIDENCE) { await mkdir(EVIDENCE, { recursive: true }); await writeFile(path.join(EVIDENCE, 'leg-M.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...item }) + '\n', { flag: 'a' }); } };
      // Runs one selection with `text` in place of `file` (the unchanged bytes for a control, the defect for a mutant).
      const harnessed = r => { executed = true; return { ok: r.code === 0 && !r.fails.length && r.passes.length > 0, out: r.fails.join(' | ') || r.stderr.slice(-400) }; };
      const through = async (file, via, select, label, text) => {
        if (via === 'P') { let failure = null; await withCopy(file, label, text, async copy => { try { await stageCheck(copy); } catch (e) { failure = String(e.message); } }); return { ok: !failure, out: failure || '' }; }
        if ((via === 'N' || via === 'C') && !NATIVE) return { ok: false, out: 'NOT RUN: OMF_CARD_NATIVE=0 (a native defect leg)' };
        // setup.js reaches the page through index.mjs: a copy of index.mjs serving the copied setup.js, the setup page in owned headless Chrome
        if (via === 'C') return withCopy(file, label, text, async setupCopy => withCopy('collector/index.mjs', label, mutate(await readFile(path.join(root, 'collector/index.mjs'), 'utf8'), [["'./setup.js'", "'./" + path.basename(setupCopy) + "'"]], label + ' index'), async indexCopy => harnessed(await harness({ OMF_TEST_INDEX_MODULE: indexCopy, OMF_CARD_ONLY: select, OMF_CARD_NATIVE: '1' }, true))));
        if (via === 'S' && file.startsWith('server/')) return harnessed(await withTree(label, { [file]: text }, dir => harness({ OMF_CARD_SRC: dir, OMF_CARD_ONLY: select })));
        if (via === 'S') return harnessed(await withCopy(file, label, text, copy => harness({ [ENV[file]]: copy, OMF_CARD_ONLY: select })));
        const r = await withRouted(file, label, text, seams => unit(via === 'U' ? UNIT : BACKGROUND, { ...seams, OMF_CARD_NATIVE: via === 'N' ? '1' : '0' }, select)), t = tests(r);
        return { ok: r.code === 0 && !t.fail && t.pass > 0, out: t.out };
      };
      for (const [label, file, pairs, via, select, expect] of MUTANTS_RUN) {
        try {
          const source = await readFile(path.join(root, file), 'utf8'), key = via + '|' + file + '|' + select;
          // a failed control and an uncaught mutant keep their whole output (EVIDENCE), so the actual exception is never lost to the clip below
          if (!controls.has(key)) { const c = await through(file, via, select, 'control', source.replace(/\r\n/g, '\n')); controls.set(key, c.ok); await record({ control: key, ok: c.ok }); if (!c.ok) await keep('M-control-' + label, String(c.out)); }
          if (!controls.get(key)) throw new Error(label + ': its unchanged control failed (' + key + ')');
          const result = await through(file, via, select, 'mutant-' + label.toLowerCase(), mutate(source, pairs, label));
          if (result.ok || !expect.test(result.out)) { await keep('M-' + label, String(result.out)); throw new Error(label + ' did not fail ' + expect + ': ' + String(result.out).replace(/\s+/g, ' ').slice(0, 400)); }
          caught.push(label + '→' + String(result.out).match(expect)[0]); counts.mutantsCaught++; await record({ label, caught: true, evidence: caught[caught.length - 1] });
        } catch (e) { missed.push(String(e?.message || e).slice(0, 600)); await record({ label, caught: false, reason: String(e?.message || e).slice(0, 600) }); }
      }
      await keep('M', caught.join('\n') + (missed.length ? '\n--- not caught ---\n' + missed.join('\n') : ''));
      if (missed.length) throw new Error(missed.length + ' of ' + MUTANTS_RUN.length + ' not caught: ' + missed.join(' || ').slice(0, 1800) + ' ; caught ' + caught.length);
      return controls.size + ' unchanged controls green; ' + caught.length + '/' + MUTANTS_RUN.length + ' caught: ' + caught.join(', ');
    });
  } catch (e) { pass = false; lines.push('setup: ' + String(e?.message || e).slice(0, 800)); }
  if (ownedLocal) await rm(ownedLocal, { recursive: true, force: true }).catch(() => {});
  return { pass, databaseCoverage: { executed, ownedProcess: executed }, message: (pass ? 'green' : 'RED') + ' in ' + Math.round((Date.now() - started) / 1000) + 's' + (PARTIAL ? ' (PARTIAL development run: legs ' + (LEGS.join(',') || 'all') + (process.env.OMF_CARD_MUTANTS ? ', selected mutants' : '') + (NATIVE ? '' : ', no native legs') + ' — no coverage exported)' : '') + ' ' + JSON.stringify(counts) + '\n' + lines.join('\n') };
} };
