// Fixture for plan omf-paypay-four-accounts-20261021 (5-plan.json): four PayPay銀行 標準ログイン accounts — protected one-time setup per
// account, the publicly observed login form only, the guided first capture without an uploaded template, the unmapped capture retained
// for native mapping, and the shared bank-key boundary widened to exactly paypay/standard. Run ONLY through the hub verifier (never
// directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-paypay-four-accounts.mjs --cwd <this worktree>
// Evidence basis, stated exactly: synthetic only. Fake PayPay pages are served by request interception at https://login.paypay-bank.co.jp
// (and the public homepage) inside the collector's owned Chrome; every other request is aborted — no network, no bank, no real
// credential (fictional branch/account/password values only). The built app runs on owned ephemeral MongoDBs. The actual authenticated
// PayPay statement controls and export have NOT been observed; nothing here is a live login, an actual export or automatic collection.
// Fail-first on 2361ec0 (behaviour, not a missing file): the bank connection of a PayPay標準 account without an uploaded template is
// refused (400, B and N), the live-granted PayPay key is refused by the shared key binding (400 binding:service, K), the setup refuses the
// PayPay body and the guided observe never receives a saved login (U), the default observe stage never signs in (C).
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 5400000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = p => access(p).then(() => true, () => false);
const u = rel => pathToFileURL(path.join(root, rel)).href;
// The plan's fixture.covers (every change site) plus the new files of this build.
const COVERS = ['collector/banks/paypay.mjs', 'collector/bank.mjs', 'collector/index.mjs', 'collector/setup.html', 'collector/setup.js', 'shared/finance-payment-match.mjs', 'server/services/financeCollectorSecurityService.ts', 'server/services/financeBankCollectionService.ts', 'server/services/financeBankStatementService.ts', 'components/intake/BankConnections.vue', 'scripts/collector-security-integration.ts', 'scripts/finance-bank-collection-integration.cjs', 'collector/test/rakuten-auto-login.test.mjs', 'collector/test/rakuten-setup.test.mjs', 'scripts/zoomer-fixtures/omf-bank-collection.mjs', 'docs/rakuten-bank-connection.md', 'collector/test/paypay-standard.test.mjs', 'collector/test/paypay-setup.test.mjs', 'collector/test/paypay-guided-capture.test.mjs', 'scripts/finance-paypay-onboarding-integration.cjs', 'scripts/zoomer-fixtures/omf-paypay-four-accounts.mjs', 'docs/paypay-bank-connection.md', 'scripts/zoomer-fixtures/omf-paypay-login-proof.mjs'];
const MONGOD = [path.join(root, 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe'), path.join(root, '..', 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe')].find(p => existsSync(p)) || null;
const run = (args, env = {}, timeout = 1800000, cwd = root) => new Promise(resolve => execFile(process.execPath, args, { cwd, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', ...(MONGOD ? { MONGOMS_SYSTEM_BINARY: MONGOD } : {}), ...env } }, (e, stdout, stderr) => resolve({ code: e ? e.code ?? 1 : 0, killed: !!e?.killed, stdout: String(stdout), stderr: String(stderr) })));
const receiptOf = text => { const line = text.split(/\r?\n/).reverse().find(l => l.startsWith('{"pass":')); try { return line ? JSON.parse(line) : null; } catch { return null; } };
const passesOf = text => text.split(/\r?\n/).filter(l => l.startsWith('PASS '));
const evidence = (name, text) => writeFile(path.join(root, '.zoomer-paypay-' + name + '.txt'), text);

// The node --test TAP report: totals and the ok/not ok line of every test (by name), so a skipped, missing or renamed test is visible.
function tapReport(text) {
  const total = name => Number(text.match(new RegExp('^# ' + name + ' (\\d+)', 'm'))?.[1] ?? NaN);
  const tests = [...text.matchAll(/^(\s*)(ok|not ok) \d+ - (.+?)(?: # (SKIP|TODO).*)?$/gm)].filter(m => m[1].length <= 4).map(m => ({ ok: m[2] === 'ok', name: m[3].trim(), directive: m[4] || null }));
  return { tests: total('tests'), pass: total('pass'), fail: total('fail'), skipped: total('skipped'), todo: total('todo'), cancelled: total('cancelled'), list: tests };
}

// A sibling copy of a module with named edits applied (each anchor must hit exactly once), or one `// guard:<name>` line removed.
async function mutantModule(file, { guard = null, edits = [] } = {}) {
  const source = path.join(root, file); let text = await readFile(source, 'utf8');
  if (guard) { const lines = text.split('\n'), hits = lines.filter(l => l.includes('// guard:' + guard + ' ') || l.trimEnd().endsWith('// guard:' + guard)); if (hits.length !== 1) throw new Error('FAIL guard marker hits ' + hits.length + ' for ' + guard); lines.splice(lines.indexOf(hits[0]), 1); text = lines.join('\n'); }
  for (const [anchor, replacement] of edits) { const hits = (text.match(new RegExp(anchor.source, anchor.flags.includes('g') ? anchor.flags : anchor.flags + 'g')) || []).length; if (hits !== 1) throw new Error('FAIL mutant anchor hits ' + hits + ' for ' + file + ' /' + anchor.source.slice(0, 60)); text = text.replace(anchor, () => replacement); }
  const target = path.join(path.dirname(source), path.basename(file, '.mjs') + `.mutant-${process.pid}-${randomUUID().slice(0, 8)}.mjs`);
  await writeFile(target, text, { flag: 'wx' });
  return { file: target, async load() { try { return await import(pathToFileURL(target).href); } catch (error) { throw new Error('FAIL mutant invalid: ' + (error?.message || error)); } }, async dispose() { await unlink(target).catch(() => {}); } };
}
async function walkRelativeImports(file, seen = new Set()) {
  const text = await readFile(file, 'utf8'), dir = path.dirname(file);
  for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*)'(\.[^']+)'/g)) { const target = path.resolve(dir, m[1]); if (!await exists(target)) throw new Error(path.relative(root, file).replaceAll('\\', '/') + ' imports ' + m[1] + ' which is not staged'); if (!seen.has(target)) { seen.add(target); await walkRelativeImports(target, seen); } }
  return seen;
}
async function chunkFiles(dir) { const out = []; for (const e of await readdir(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) out.push(...await chunkFiles(f)); else if (e.name.endsWith('.mjs')) out.push(f); } return out; }
async function removeOwned(dir) { if (!path.resolve(dir).startsWith(path.resolve(root) + path.sep)) throw Error('Unsafe mutation directory'); await rm(dir, { recursive: true, force: true }); }

// Server mutants in the built chunks: each must flip its named assertion of the HTTP bank-collection integration (B).
export const SERVER_MUTANTS = [
  { name: 'S1-unmapped-reason-dropped', anchor: /if\s*\(frozen\.unmapped\)/g, replacement: 'if(false)', expect: 'bank:paypay-mapping-required-reason' },
  { name: 'S2-template-bypass-unconditional', anchor: /const templateFree\s*=\s*firstCaptureOf\(/g, replacement: 'const templateFree=!body.templateId||firstCaptureOf(', expect: 'bank:template-required-outside-standard' },
  // review fold F3: without the stable code the collector cannot tell the permanent cross-account 409 from a transient one
  { name: 'S3-capture-code-dropped', anchor: /code:\s*["']capture-other-account["']/g, replacement: 'code:null', expect: 'bank:paypay-capture-other-account-code' }
];

// ── page-less guided ui and fictional saved login (the shape of collector/test/paypay-guided-capture.test.mjs) ──
const SECRET = Object.freeze({ branch: '012', account: '0012345', password: ' Fictional Pw/1 ' });
const CSV = Buffer.from('日付,内容,出金金額,入金金額,残高\r\n2026/10/01,振込 カクウ,,50000,150000\r\n');
const OWNER = 'd4d4d4d4d4d4d4d4d4d4d4d4', ACCOUNT = { _id: 'b1b1b1b1b1b1b1b1b1b1b1b1', ownerId: OWNER, name: 'PayPay 1' }, ORIGIN = 'https://omf.example';
const unmapped = (variant = 'standard') => ({ templateId: null, templateRevision: 0, headers: [], mapping: {}, amountSign: 'outflow-positive', transactionIdConfirmed: false, parserVersion: 'bank-template-1', currency: 'JPY', provider: 'paypay', accountLabel: null, variant, coverage: null, interpretation: 'unmapped' });
const jobOf = (variant = 'standard', kind = 'observe') => { const s = unmapped(variant); return { jobId: randomUUID(), kind, snapshot: s, snapshotHash: sha256(JSON.stringify(s)), provider: 'paypay' }; };
const boundOf = job => ({ bankAccountId: ACCOUNT._id, ownerId: OWNER, origin: ORIGIN, jobId: job.jobId, snapshotHash: job.snapshotHash, provider: 'paypay' });
function guidedUi({ deliver = 'csv', at = 3 } = {}) {
  const clock = { t: 1_800_000_000_000 }, calls = { login: 0 }; let handlers = {}, jobDir = null, polls = 0;
  const emit = (event, value) => { for (const h of handlers[event] || []) h(value); };
  const ui = { calls, clock, now: () => clock.t, async wait(ms) { clock.t += ms; if (++polls === at) await ui.deliver(); },
    async open() {}, async state() { return { kind: 'unknown' }; }, async show() {}, async loginForm() { return { ok: true, document: 'doc-1' }; }, async document() { return 'doc-1'; },
    async login() { calls.login++; return { outcome: 'submitted', document: 'doc-1' }; },
    downloadSession(dir) { jobDir = dir; handlers = {}; return { on(event, handler) { (handlers[event] ||= []).push(handler); }, async close() { handlers = {}; } }; },
    async deliver() { if (!deliver) return; const bytes = deliver === 'pdf' ? Buffer.from('%PDF-1.7\n') : CSV, guid = randomUUID(); await writeFile(path.join(jobDir, guid), bytes); emit('Browser.downloadWillBegin', { guid, url: 'https://login.paypay-bank.co.jp/wctx/x', suggestedFilename: 'm.' + (deliver === 'pdf' ? 'pdf' : 'csv') }); emit('Browser.downloadProgress', { guid, state: 'completed', totalBytes: bytes.length }); } };
  return ui;
}
function savedLogin(state = 'ready') { const calls = { state: 0, open: 0, rejected: 0, accepted: 0 }; let current = state; return { calls, get current() { return current; }, async state() { calls.state++; return current; }, async open() { calls.open++; return { ...SECRET }; }, async rejected() { calls.rejected++; current = 'blocked'; }, async accepted() { calls.accepted++; current = 'ready'; } }; }
const memoryStore = aadOf => { const entries = new Map(); return { entries, save(id, aad, value) { const keyId = randomUUID().replaceAll('-', '').padEnd(64, '0'); entries.set(id, { envelope: { v: 3, keyId, aad: { ...aad, v: 3, generation: 'g'.repeat(64), keyId } }, value }); }, async has(id) { return entries.has(id); }, async read(id) { return entries.get(id).envelope; }, async open(id, aad) { const e = entries.get(id); if (JSON.stringify(aadOf(e.envelope.aad)) !== JSON.stringify(aad)) throw new Error('aad'); return { ...e.value }; } }; };

export default { name: 'omf-paypay-four-accounts', covers: COVERS, async run() {
  const started = Date.now(), lines = []; let pass = true; let dbExecuted = false;
  const counts = { legs: 0, green: 0, unitTests: 0, securityLegs: 0, httpLegs: 0, nativeLegs: 0, mutantsCaught: 0, mutantsTotal: 0 };
  const leg = async (name, fn) => { counts.legs++; const t = Date.now(); try { lines.push(name + ': ' + await fn() + ` (${Math.round((Date.now() - t) / 1000)}s)`); counts.green++; } catch (e) { pass = false; lines.push(name + ': RED ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 1800)); } };
  const assert = (await import('node:assert/strict')).default;
  if (process.platform !== 'win32') return { pass: false, message: 'the collector vault (DPAPI) and owned Chrome need Windows' };
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-paypay-fixture-'));
  process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector-dir');
  let app = null;
  try {
    const load = async rel => import(u(rel)).catch(e => e), need = (m, what) => { if (m instanceof Error) throw new Error(what + ' missing or broken: ' + m.message); return m; };
    const browserModule = await load('collector/browser.mjs'), bankModule = await load('collector/bank.mjs'), indexModule = await load('collector/index.mjs'), paypayModule = await load('collector/banks/paypay.mjs'), vaultModule = await load('collector/vault.mjs');
    // ── U: the collector unit legs (node --test, TAP report parsed per test) ──
    const UNIT = { 'collector/test/paypay-standard.test.mjs': 6, 'collector/test/paypay-setup.test.mjs': 9, 'collector/test/paypay-guided-capture.test.mjs': 11, 'collector/test/rakuten-auto-login.test.mjs': 0, 'collector/test/rakuten-setup.test.mjs': 0, 'collector/test/rakuten-standard.test.mjs': 0 };
    await leg('U collector unit legs (node --test, TAP): paypay-standard (owned headless Chrome, intercepted fake login page), paypay-setup (real setup page, real collector process), paypay-guided-capture, and the unchanged rakuten-auto-login, rakuten-setup, rakuten-standard siblings', async () => {
      const r = await run(['--test', '--test-concurrency=1', '--test-reporter=tap', ...Object.keys(UNIT)], {}, 1500000); await evidence('unit', r.stdout + r.stderr);
      const t = tapReport(r.stdout), failed = t.list.filter(x => !x.ok), directives = t.list.filter(x => x.directive);
      counts.unitTests = t.pass;
      if (r.code !== 0 || t.fail || !(t.pass > 0) || t.skipped || t.todo || t.cancelled || directives.length || t.pass !== t.tests) throw new Error(`node --test exit ${r.code} tests ${t.tests} pass ${t.pass} fail ${t.fail} skipped ${t.skipped} todo ${t.todo} cancelled ${t.cancelled}; failing: ` + failed.slice(0, 12).map(x => x.name.slice(0, 140)).join(' | ') + ' :: ' + (r.stdout.split('\n').filter(l => /AssertionError|paypay[-:]|Error:/.test(l)).slice(0, 10).join(' | ') || r.stderr.slice(-800)).slice(0, 1400));
      const named = [/one decryption, journal and uncertain marker before the one submission/, /retryBankLogin: only the current key's uncertain marker/, /an uncertain PayPay account offers/, /four live-granted PayPay standard accounts are sealed as four separate entries/, /drift table/, /the real setup page: four independent PayPay sections/, /bankLoginFor: a handle only for a protected session/, /runBankJob hands the saved login to a guided PayPay/, /guided text gate: only nonempty, bounded/, /bank outbox refusal: a permanent 409 capture-other-account/, /the bank refuses the saved login: one submission/];
      for (const want of named) assert.ok(t.list.some(x => x.ok && want.test(x.name)), 'paypay:unit-test-present ' + want.source);
      return `${t.pass}/${t.tests} tests green, 0 skipped/todo/cancelled; ${named.length} named PayPay tests present`;
    });
    // ── K: the shared v3 key boundary on an owned ephemeral MongoDB ──
    await leg('K shared key boundary (scripts/collector-security-integration.ts, owned MongoDB): existing card/service/connect/楽天銀行 legs and mutants, plus four PayPay標準 accounts, PayPay↔楽天銀行/BA-PLUS/scope/owner confusion, after-save changes, post-I/O races and the bank binding mutants on PayPay attacks', async () => {
      const r = await run(['--import', 'tsx', 'scripts/collector-security-integration.ts']); await evidence('security', r.stdout + r.stderr);
      const passes = passesOf(r.stdout), receipt = receiptOf(r.stdout); counts.securityLegs = passes.length;
      if (r.code !== 0 || !receipt?.pass || receipt.checks !== passes.length) throw new Error(`exit ${r.code}, ${passes.length} PASS; last: ${passes.at(-1)?.slice(5, 140) || 'none'}; error: ` + r.stderr.replace(/\s+/g, ' ').slice(0, 1000));
      for (const want of [/bank key: a Rakuten standard account granted to the device after the card-only pairing/, /bank key attacks refused/, /bank binding mutants/, /same card-only grant still releases Amex/, /paypay key: four PayPay標準 accounts/, /paypay key attacks refused/, /stop that PayPay account's release/, /PayPay scope removal or BA-PLUS change .* post-I\/O recheck/, /lets through exactly the PayPay attacks/]) assert.ok(passes.some(p => want.test(p)), 'paypay:security-leg ' + want.source);
      assert.equal(receipt.paypayMutants, 5, 'paypay:security-mutant-count'); dbExecuted = true;
      return `${passes.length} legs; receipt ${JSON.stringify({ securityMutants: receipt.securityMutants, bankMutants: receipt.bankMutants, paypayMutants: receipt.paypayMutants, connectMutants: receipt.connectMutants })}`;
    });
    // ── B: the HTTP bank-collection integration on the built app (G = the PayPay legs; V = hidden real Chrome) ──
    await leg('B HTTP bank collection on the built app (scripts/finance-integration.cjs → finance-bank-collection-integration.cjs, owned MongoDB, hidden Chrome): G template-free PayPay標準 connection/claim/snapshot/needs_review/mapping/retry isolation and every existing lane', async () => {
      if (!existsSync(path.join(root, '.output/server/index.mjs'))) throw new Error('NOT RUN: built app absent');
      app = await run(['scripts/finance-integration.cjs'], { OMF_TEST_BANK_COLLECTION_ONLY: '1' }); await evidence('http', app.stdout + app.stderr);
      const passes = passesOf(app.stdout); counts.httpLegs = passes.length;
      if (app.code !== 0) throw new Error(`exit ${app.code}; last PASS: ${passes.at(-1)?.slice(5, 120) || 'none'}; ` + (app.stdout + app.stderr).replace(/\s+/g, ' ').slice(-1600));
      for (const want of [/^PASS G PayPay銀行 標準/, /^PASS S 楽天銀行 standard/, /^PASS V hidden real Chrome/, /^PASS D2\/T7 upload/, /^PASS T6 disagreement/]) assert.ok(passes.some(p => want.test(p)), 'paypay:http-leg ' + want.source);
      dbExecuted = true; return app.stdout.match(/\d+ targeted bank collection checks passed/)?.[0] + `, ${passes.length} legs`;
    });
    // ── N: the owned native end-to-end with the real collector process ──
    await leg('N native walkthrough (scripts/finance-paypay-onboarding-integration.cjs): built app, real card-only enrollment, four template-free PayPay accounts, the real collector process and its real setup page in owned headless Chrome, four guided first captures through its own tick, native mapping, refusal/blocked/re-save, BA-PLUS manual, scope/login-type/revocation stops', async () => {
      if (!existsSync(path.join(root, '.output/server/index.mjs'))) throw new Error('NOT RUN: built app absent');
      const r = await run(['scripts/finance-paypay-onboarding-integration.cjs']); await evidence('native', r.stdout + r.stderr);
      const passes = passesOf(r.stdout), receipt = receiptOf(r.stdout); counts.nativeLegs = passes.length;
      if (r.code !== 0 || !receipt?.pass || receipt.checks !== passes.length) throw new Error(`exit ${r.code}, ${passes.length} PASS; last: ${passes.at(-1)?.slice(5, 160) || 'none'}; error: ` + r.stderr.replace(/\s+/g, ' ').slice(0, 1500));
      assert.equal(receipt.accounts, 4); assert.equal(receipt.foreignRequests, 0, 'paypay:native-no-foreign-request'); assert.equal(passes.length, 10, 'paypay:native-leg-count');
      for (const want of [/^PASS refused captures at the bank statement outbox/, /^PASS the actual \/bank\/retry route/]) assert.ok(passes.some(p => want.test(p)), 'paypay:native-leg ' + want.source);
      assert.deepEqual([receipt.route?.whileJob, receipt.route?.claimedWhileInFlight, receipt.route?.afterCompletion, receipt.route?.resumed], [409, false, 200, 'complete'], 'paypay:native-route-receipt');
      dbExecuted = true; return `${passes.length} legs; ${receipt.loginSubmissions} submissions, ${receipt.exports} exports, ${receipt.keyReleases} key releases; route ${JSON.stringify(receipt.route)}`;
    });
    // ── C: the guided capture on a real owned HEADLESS page (real recorder and CDP binding; the guided adapter chosen from the frozen
    // snapshot by guidedAdapterFor). The fixture launches this browser itself with headless:true and hands its page to observeFromPage, so
    // no collector launch path (background/reveal/profile reuse) can open a window. ──
    await leg('C guided capture on an owned headless page (intercepted fake PayPay site, real recorder and CDP binding): one lazy decryption and one exact-form submission, the person exports, the kept CSV is NOT proof (plan P1: the saved key stays uncertain), the observation holds no login value or typing record; a PayPay job without a login type opens the plain observe', async () => {
      const bank = need(bankModule, 'collector/bank.mjs'), bm = need(browserModule, 'collector/browser.mjs');
      const require = createRequire(import.meta.url), { site } = require(path.join(root, 'scripts', 'finance-paypay-onboarding-integration.cjs'));
      const dir = path.join(temp, 'c'); await mkdir(dir, { recursive: true });
      const scenario = path.join(temp, 'c-scenario.json'), metrics = path.join(temp, 'c-metrics.json'); await writeFile(scenario, JSON.stringify({ passwords: ['Fictional-1 ', ' Fictional 2/<>', 'Fict3-' + 'x'.repeat(26), 'Fict"4&'] }));
      const fake = site(scenario, metrics), LOGIN = { branch: '001', account: '0000101', password: 'Fictional-1 ' };
      const headlessRun = async (label, fn) => { const browser = await bm.browserFor(path.join(temp, 'c-profile-' + label), { headless: true }); try { const page = await browser.newPage(); await page.setRequestInterception(true); page.on('request', r => fake.respond(r)); fake.person(page); return await fn(page, browser); } finally { await browser.close().catch(() => {}); } };
      const job = jobOf(), base = savedLogin(), login = { ...base, open: async () => { base.calls.open++; return { ...LOGIN }; } }, statuses = [];
      const adapter = bank.guidedAdapterFor(job); assert.equal(adapter?.guided, true, 'paypay:c-guided-adapter-from-snapshot');
      const result = await headlessRun('c1', (page, browser) => bank.observeFromPage(page, browser, adapter, boundOf(job), job, dir, async (s, t) => { statuses.push([s, t]); }, { login, pollMs: 200, timeoutMs: 90000 }));
      const m = JSON.parse(await readFile(metrics, 'utf8'));
      assert.deepEqual(m.posts.map(p => [p.index, p.ok, p.fresh, p.handler]), [[0, true, true, true]], 'paypay:c-one-exact-submission'); assert.equal(base.calls.open, 1, 'paypay:c-one-decryption');
      assert.equal(result.items.length, 1, 'paypay:c-csv-retained'); assert.equal(result.items[0].manifest.sourceHost, 'login.paypay-bank.co.jp'); assert.equal(result.items[0].manifest.channel, 'collector-observe');
      // Deliberate change (plan P1): the kept CSV does not confirm the automatic sign-in.
      assert.equal(base.calls.accepted, 0, 'paypay:c-file-not-proof'); assert.equal(base.current, 'blocked', 'paypay:c-uncertain-kept'); assert.equal(result.failed ?? null, null); assert.match(String(result.notice), /受け取った明細は保存/, 'paypay:c-kept-notice');
      const text = JSON.stringify([result.observation, statuses]); for (const v of [LOGIN.account, LOGIN.password.trim()]) assert.ok(!text.includes(v), 'paypay:c-no-login-value');
      assert.ok(!result.observation.some(p => p.typedInto.some(t => ['idTenNo', 'idKozaNo', 'idPw'].includes(t.id))), 'paypay:c-fill-not-recorded-as-typing');
      assert.ok(result.observation.some(p => p.pathname === '/wctx/1D1DFxFDg.do' && p.inputs.some(i => i.id === 'idPw')), 'paypay:c-login-page-recorded');
      assert.equal(result.observation.every(p => p.eventChannel === true), true, 'paypay:c-event-channel');
      assert.equal(bm.ownedBrowsers().filter(b => b.connected).length, 0, 'paypay:c-browser-closed');
      // a PayPay job without a login type: the provider's plain observe (homepage), the saved login never touched
      const plainJob = jobOf(null), plainLogin = savedLogin(), plainStatuses = [], plainAdapter = bank.guidedAdapterFor(plainJob) || bank.adapterFor(plainJob.provider);
      assert.equal(plainAdapter.guided, undefined, 'paypay:c-plain-adapter');
      const plain = await headlessRun('c2', (page, browser) => bank.observeFromPage(page, browser, plainAdapter, boundOf(plainJob), plainJob, dir, async (s, t) => { plainStatuses.push([s, t]); }, { login: plainLogin, pollMs: 200, timeoutMs: 60000 }));
      assert.deepEqual([plainLogin.calls.state, plainLogin.calls.open], [0, 0], 'paypay:c-plain-observe-no-login'); assert.equal(plain.failed, undefined);
      assert.ok(plainStatuses.some(([s, t]) => s === 'verification_required' && /観察取得・準備/.test(t)), 'paypay:c-plain-observe-message');
      assert.equal(JSON.parse(await readFile(metrics, 'utf8')).posts.length, 1, 'paypay:c-plain-no-submission');
      return `1 submission (fresh document, generated handler ran), 1 decryption, CSV retained from login.paypay-bank.co.jp and NOT taken as proof (key stays uncertain), ${result.observation.length} records without values; plain observe untouched`;
    });
    // ── P: the package carries the changed runtime files; the staged graph resolves; no test code ──
    await leg('P package closure: the changed runtime modules and setup files staged with their repo hashes, staged import graph resolves from index.mjs, the staged PayPay standard adapter and bank module load without node_modules, nothing under collector/test is staged', async () => {
      const stageModule = await import(u('collector/package/stage.mjs')), into = path.join(temp, 'staged');
      const { manifest } = await stageModule.stage({ into, origin: 'https://omf.example', install: false, log: () => {} });
      for (const entry of ['collector/index.mjs', 'collector/bank.mjs', 'collector/banks/paypay.mjs', 'collector/banks/rakuten.mjs', 'collector/banks/contract.mjs', 'collector/setup.html', 'collector/setup.js', 'shared/finance-payment-match.mjs']) { assert.ok(manifest.files[entry], 'paypay:staged ' + entry); assert.equal(manifest.files[entry], sha256(await readFile(path.join(root, entry))), 'paypay:staged-hash ' + entry); }
      assert.equal(Object.keys(manifest.files).some(f => f.includes('/test/') || f.includes('mutant')), false, 'paypay:no-test-code-staged');
      await walkRelativeImports(path.join(into, 'collector', 'index.mjs'));
      const staged = await import(pathToFileURL(path.join(into, 'collector/banks/paypay.mjs')).href); assert.equal(staged.STANDARD_LOGIN?.form, 'HOST', 'paypay:staged-login-contract'); assert.equal(typeof staged.standard?.ui({}, {}, null).login, 'function');
      const stagedBank = await import(pathToFileURL(path.join(into, 'collector/bank.mjs')).href); assert.equal(stagedBank.adapterFor('paypay', 'standard')?.guided, true, 'paypay:staged-guided-adapter'); assert.equal(stagedBank.adapterFor('paypay').support, 'contract-pending');
      const stagedShared = await import(pathToFileURL(path.join(into, 'shared/finance-payment-match.mjs')).href); assert.equal(stagedShared.BANK_FIRST_CAPTURE?.paypay?.standard, 'unmapped', 'paypay:staged-first-capture'); assert.ok(stagedShared.BANK_PROVIDERS.every(p => p[2] === 'contract-pending'), 'paypay:no-provider-verified');
      return Object.keys(manifest.files).length + ' files staged; changed runtime files hashed; graph resolves; staged PayPay adapter/bank/shared load';
    });
    // ── M: deliberately reintroduced defects, each caught by its named assertion ──
    await leg('M collector mutants: each removed PayPay login-form guard lets its drift be filled; the guided journal, pending marker and variant guards removed resubmit, forget or use the login on BA-PLUS; a kept CSV reintroduced as proof (plan P1) flips the permanent regression; the index blocked/shape/kind/retry guards removed unblock, accept a confused body, hand a retrieve job the PayPay login or retry a legacy block', async () => {
      const caught = [], flips = async (label, fn, pattern) => { counts.mutantsTotal++; let error = null; try { await fn(); } catch (e) { error = e; } if (!error) throw new Error(label + ' did not flip (the assertion passed on the mutant)'); if (/FAIL mutant|FAIL guard/.test(String(error.message))) throw error; if (!pattern.test(String(error.message))) throw new Error(label + ' flipped the wrong assertion: ' + String(error.message).slice(0, 300)); caught.push(label); counts.mutantsCaught++; };
      const bm = need(browserModule, 'collector/browser.mjs'), { aadOf } = need(vaultModule, 'collector/vault.mjs');
      // 1. the login-form guards (owned headless Chrome on the drift pages of collector/test/paypay-standard.test.mjs, served here)
      const require = createRequire(import.meta.url), { loginDoc } = require(path.join(root, 'scripts', 'finance-paypay-onboarding-integration.cjs'));
      // Each drift is caught by exactly the one guard named (so removing that line alone lets the fill and the submission through).
      const DRIFT = { 'login-surface': '/wctx/Other.do', 'login-form': 'extra-host-form', 'login-action': 'foreign-action', 'login-fields': 'id-mismatch', 'login-password-unique': 'second-password', 'login-control': 'two-submits' };
      const driftHtml = name => { let html = loginDoc().html; if (name === 'extra-host-form') html = html.replace('</form>', '</form><form name="HOST" method="post" action="NBCW2101.do"></form>'); if (name === 'foreign-action') html = html.replace('action="NBCW2101.do"', 'action="https://login.paypay-bank.example/wctx/NBCW2101.do"'); if (name === 'id-mismatch') html = html.replace('id="idTenNo"', 'id="idTen"'); if (name === 'second-password') html = html.replace('</form>', '</form><input type="password" name="Pw2" maxlength="4">'); if (name === 'two-submits') html = html.replace('<input type="submit" name="login" value="ログイン">', '<input type="submit" name="login" value="ログイン"> <input type="submit" name="login" value="ログイン">'); return html; };
      const fillAttempt = async (mod, variant) => {
        const browser = await bm.browserFor(path.join(temp, 'm-' + randomUUID().slice(0, 6)), { headless: true }); let posts = 0;
        try { const page = await browser.newPage(); await page.setRequestInterception(true); page.on('request', r => { const x = new URL(r.url()); if (r.method() === 'POST') { posts++; return x.origin === 'https://login.paypay-bank.co.jp' ? r.respond({ status: 200, contentType: 'text/html', body: '<title>x</title>ok' }) : r.abort(); } if (x.origin !== 'https://login.paypay-bank.co.jp') return r.abort(); const html = variant.startsWith('/') ? (x.pathname === '/wctx/1D1DFxFDg.do' ? `<script>location.replace(${JSON.stringify(variant)})</script>` : loginDoc().html) : driftHtml(variant); return r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html }); });
          const ui = mod.standardUi(page, browser, mod.standard, null, { settleMs: 2000, stableMs: 500 }); await ui.open(); await new Promise(r => setTimeout(r, 300));
          try { await ui.login({ ...SECRET }); } catch { /* refused */ }
          assert.equal(posts, 0, 'paypay:drift-refused ' + variant);
        } finally { await browser.close().catch(() => {}); }
      };
      for (const [guard, variant] of Object.entries(DRIFT)) { const m = await mutantModule('collector/banks/paypay.mjs', { guard }); try { const mod = await m.load(); await flips(guard, () => fillAttempt(mod, variant), /paypay:drift-refused/); } finally { await m.dispose(); } }
      // 2. the guided-capture guards (page-less, virtual clock)
      const observe = async (mod, ui, job, login, adapter) => mod.observeFromPage(null, null, adapter, boundOf(job), job, await mkdtemp(path.join(temp, 'g-')), async () => {}, { ui, login, now: ui.now, wait: ui.wait, pollMs: 1000, timeoutMs: 10000 });
      { const m = await mutantModule('collector/bank.mjs', { guard: 'guided-journal' }); try { const mod = await m.load(), pp = await import(u('collector/banks/paypay.mjs')); await flips('guided-journal', async () => { const job = jobOf(), dir = await mkdtemp(path.join(temp, 'j-')), jobDir = path.join(dir, 'outbox', 'bank', ACCOUNT._id, job.jobId + '-observe'); await mkdir(jobDir, { recursive: true }); await writeFile(path.join(jobDir, 'login.json'), '{}'); const ui = guidedUi(); await mod.observeFromPage(null, null, pp.standard, boundOf(job), job, dir, async () => {}, { ui, login: savedLogin(), now: ui.now, wait: ui.wait, pollMs: 1000, timeoutMs: 6000 }); assert.equal(ui.calls.login, 0, 'paypay-guided:reclaim-no-resubmit'); }, /paypay-guided:reclaim-no-resubmit/); } finally { await m.dispose(); } }
      { const m = await mutantModule('collector/bank.mjs', { guard: 'guided-pending' }); try { const mod = await m.load(), pp = await import(u('collector/banks/paypay.mjs')); await flips('guided-pending', async () => { const login = savedLogin(); await observe(mod, guidedUi({ deliver: null }), jobOf(), login, pp.standard); const next = guidedUi(); await observe(mod, next, jobOf(), login, pp.standard); assert.equal(next.calls.login, 0, 'paypay-guided:blocked-no-submit'); }, /paypay-guided:blocked-no-submit/); } finally { await m.dispose(); } }
      // Plan P1: the parent counterexample's defect reintroduced — a kept CSV accepted as proof of the automatic sign-in — must flip the
      // permanent regression's own assertion (scripts/zoomer-fixtures/omf-paypay-login-proof.mjs probeLoginProof).
      { const m = await mutantModule('collector/bank.mjs', { edits: [[/\/\/ The captured file is the person's statement for native mapping, not proof of the automatic sign-in: the marker stays\./, "if (items.length && !guided.refused) await login.accepted(); // MUTANT: a kept CSV taken as proof"]] }); try { const { probeLoginProof } = await import(u('scripts/zoomer-fixtures/omf-paypay-login-proof.mjs')); await flips('csv-acceptance-reintroduced', () => probeLoginProof(m.file), /An unrelated public CSV must not confirm the saved bank login/); } finally { await m.dispose(); } }
      { const m = await mutantModule('collector/bank.mjs', { guard: 'guided-variant' }); try { const mod = await m.load(), pp = await import(u('collector/banks/paypay.mjs')); await flips('guided-variant', async () => { const login = savedLogin(); await observe(mod, guidedUi(), jobOf('baplus'), login, pp.standard); assert.equal(login.calls.open, 0, 'paypay-guided:not-used baplus'); }, /paypay-guided:not-used/); } finally { await m.dispose(); } }
      // 3. the index guards (real bankLoginFor/saveBankLogin over an in-memory store)
      const LIVE = { mode: 'protected', installationId: 'f'.repeat(32), broker: {}, abort: new AbortController() }, CONFIG = { baseUrl: ORIGIN, token: 'omfc_' + 'c'.repeat(64), accountInfo: [{ _id: 'a1a1a1a1a1a1a1a1a1a1a1a1', ownerId: OWNER, provider: 'amex' }] };
      const ppAad = aadOf({ installationId: LIVE.installationId, origin: ORIGIN, ownerId: OWNER, provider: 'paypay', accountId: ACCOUNT._id });
      { const m = await mutantModule('collector/index.mjs', { guard: 'bank-login-blocked' }); try { const mod = await m.load(); await flips('bank-login-blocked (PayPay)', async () => { const store = memoryStore(aadOf), dir = await mkdtemp(path.join(temp, 'b-')); store.save('paypay-' + ACCOUNT._id, ppAad, SECRET); const h = () => mod.bankLoginFor({ job: jobOf(), account: ACCOUNT }, CONFIG, LIVE, { store, root: dir, assert: () => {} }); await h().rejected(); assert.equal(await h().state(), 'blocked', 'paypay-guided:refusal-isolated'); }, /paypay-guided:refusal-isolated/); } finally { await m.dispose(); } }
      { const m = await mutantModule('collector/index.mjs', { guard: 'bank-login-shape' }); try { const mod = await m.load(); await flips('bank-login-shape', async () => { const writes = []; let error = null; try { await mod.saveBankLogin(mod.bankLoginInput({ bankAccountId: 'c3c3c3c3c3c3c3c3c3c3c3c3', ...SECRET }), { live: LIVE, config: CONFIG, banks: async () => [{ _id: 'c3c3c3c3c3c3c3c3c3c3c3c3', name: 'R', ownerId: OWNER, provider: 'rakuten', variant: 'standard' }], write: async (...a) => { writes.push(a); }, root: temp }); } catch (e) { error = e; } assert.equal(error?.code, 'unsupported', 'paypay-setup:paypay-body-for-rakuten'); assert.equal(writes.length, 0); }, /paypay-setup:paypay-body-for-rakuten/); } finally { await m.dispose(); } }
      { const m = await mutantModule('collector/index.mjs', { guard: 'bank-login-kind' }); try { const mod = await m.load(); await flips('bank-login-kind', async () => { assert.equal(mod.bankLoginFor({ job: jobOf('standard', 'retrieve'), account: ACCOUNT }, CONFIG, LIVE, { store: memoryStore(aadOf), root: temp, assert: () => {} }), null, 'paypay-guided:no-handle retrieve kind'); }, /paypay-guided:no-handle/); } finally { await m.dispose(); } }
      { const m = await mutantModule('collector/index.mjs', { guard: 'bank-retry-uncertain' }); try { const mod = await m.load(); await flips('bank-retry-uncertain', async () => { const store = { ...memoryStore(aadOf), async withLock(fn) { return fn(); } }, dir = await mkdtemp(path.join(temp, 'r-')); store.save('paypay-' + ACCOUNT._id, ppAad, SECRET); await mkdir(path.join(dir, 'bank-login'), { recursive: true }); await writeFile(path.join(dir, 'bank-login', 'paypay-' + ACCOUNT._id + '.json'), JSON.stringify({ entry: 'paypay-' + ACCOUNT._id, keyId: (await store.read('paypay-' + ACCOUNT._id)).keyId, refusedAt: 'x' })); let error = null; try { await mod.retryBankLogin({ bankAccountId: ACCOUNT._id }, { live: LIVE, config: CONFIG, banks: async () => [{ _id: ACCOUNT._id, name: 'PayPay 1', ownerId: OWNER, provider: 'paypay', variant: 'standard' }], store, root: dir, assert: () => {} }); } catch (e) { error = e; } assert.equal(error?.code, 'conflict', 'paypay-retry:legacy-marker-not-guessed'); }, /paypay-retry:legacy-marker-not-guessed/); } finally { await m.dispose(); } }
      // 4. review fold F3: the guided text gate and the terminal outbox refusal
      { const m = await mutantModule('collector/bank.mjs', { guard: 'guided-text' }); try { const mod = await m.load(), pp = await import(u('collector/banks/paypay.mjs')); await flips('guided-text', async () => { const r = await observe(mod, guidedUi({ deliver: 'pdf' }), jobOf(), savedLogin(), pp.standard); assert.equal(r.items.length, 0, 'paypay-guided:pdf-not-statement'); }, /paypay-guided:pdf-not-statement/); } finally { await m.dispose(); } }
      const refusalRuns = async mod => { const dir = await mkdtemp(path.join(temp, 'o-')), config = { baseUrl: ORIGIN, token: 'omfc_' + 'd'.repeat(64) }, sent = [];
        const upload = async (c, a, item) => { sent.push(item.manifest.kind); if (item.manifest.kind === 'statement') throw Object.assign(new Error('Finance request failed'), { status: 409, serverCode: 'capture-other-account' }); await writeFile(path.join(item.directory, 'manifest.json'), JSON.stringify({ ...item.manifest, acknowledgedAt: new Date().toISOString(), importId: 'f'.repeat(24) })); return { id: 'f'.repeat(24) }; }; // acknowledged as upload() does
        const job = items => mod.runBankJob({ job: jobOf(), account: ACCOUNT }, config, null, { status: async () => {}, directory: dir, upload, observe: async bound => { const out = []; if (items) { const jobDir = path.join(dir, 'outbox', 'bank', ACCOUNT._id, bound.jobId + '-observe'), filename = randomUUID(); await mkdir(jobDir, { recursive: true }); await writeFile(path.join(jobDir, filename), CSV); const manifest = { ...bound, kind: 'statement', channel: 'collector-observe', sourceFormat: 'csv', sha256: sha256(CSV), filename, bytes: CSV.length, downloadedAt: new Date().toISOString() }; await writeFile(path.join(jobDir, 'manifest.json'), JSON.stringify(manifest)); out.push({ directory: jobDir, manifest }); } return { items: out, observation: [] }; } });
        let error = null; try { await job(true); } catch (e) { error = e; } assert.equal(error, null, 'bank-refusal:own-refusal-handled'); const first = sent.splice(0);
        await job(false); assert.deepEqual([first, sent], [['statement', 'observation'], ['observation']], 'bank-refusal:no-resend'); };
      { const m = await mutantModule('collector/index.mjs', { guard: 'bank-refusal-terminal' }); try { const mod = await m.load(); await flips('bank-refusal-terminal', () => refusalRuns(mod), /bank-refusal:no-resend/); } finally { await m.dispose(); } }
      { const m = await mutantModule('collector/index.mjs', { edits: [[/if\(!reason\)throw error;/, 'throw error; /* MUTANT: a permanent refusal propagates */']] }); try { const mod = await m.load(); await flips('bank-refusal-propagates', () => refusalRuns(mod), /bank-refusal:own-refusal-handled/); } finally { await m.dispose(); } }
      await refusalRuns(need(indexModule, 'collector/index.mjs')); // control: the real module passes the same probe
      return caught.length + '/' + counts.mutantsTotal + ' collector mutants caught: ' + caught.join(', ');
    });
    // ── R: review fold F4 — the ACTUAL /bank/retry route reservation, each defect reintroduced in the daemon's own module (N in route-only mode) ──
    await leg('R route-level retry mutants (scripts/finance-paypay-onboarding-integration.cjs route-only mode, real daemon HTTP and tick): the route reservation removed flips paypay:retry-409-while-job; the reservation moved after the body read flips paypay:retry-route-reserves-before-body', async () => {
      if (!existsSync(path.join(root, '.output/server/index.mjs'))) throw new Error('NOT RUN: built app absent');
      const notes = [];
      for (const [name, expect] of [['no-route-reservation', 'paypay:retry-409-while-job'], ['reserve-after-body', 'paypay:retry-route-reserves-before-body']]) {
        counts.mutantsTotal++; const r = await run(['scripts/finance-paypay-onboarding-integration.cjs'], { OMF_TEST_PAYPAY_RETRY_MUTANT: name }); await evidence('route-mutant-' + name, r.stdout + '\n' + r.stderr);
        const text = r.stdout + r.stderr, caught = r.code !== 0 && text.includes(expect) && !/FAIL retry mutant|FAIL unknown retry mutant/.test(text); notes.push({ name, expect, code: r.code, caught, legsBefore: passesOf(r.stdout).length });
        if (!caught) throw new Error(name + ' did not flip ' + expect + ' (exit ' + r.code + '): ' + text.replace(/\s+/g, ' ').slice(-900));
        assert.equal(passesOf(r.stdout).length, 3, 'paypay:route-mutant-reached-the-route-leg ' + name); counts.mutantsCaught++;
      }
      dbExecuted = true; return notes.map(n => n.name + '→' + n.expect).join(', ') + ' (each after the 3 setup legs, at the route leg)';
    });
    await leg('S server mutants in the built chunks (B under OMF_TEST_BANK_MUTANT): the unmapped mapping-required hold dropped and an unconditional template bypass each flip their named HTTP assertion', async () => {
      if (!app || app.code !== 0) throw Error('B not green; server mutants not run');
      const base = path.join(root, '.output'), target = path.join(root, '.paypay-mutants'), copy = path.join(target, 'copy'); await removeOwned(target); await mkdir(copy, { recursive: true });
      for (const part of ['scripts', 'shared']) await cp(path.join(root, part), path.join(copy, part), { recursive: true });
      await cp(base, path.join(copy, '.output'), { recursive: true, dereference: true });
      const chunks = await chunkFiles(path.join(copy, '.output/server/chunks')), originals = new Map(); for (const f of chunks) originals.set(f, await readFile(f, 'utf8'));
      const notes = [];
      try {
        for (const m of SERVER_MUTANTS) {
          counts.mutantsTotal++;
          let hits = 0; for (const [f, text] of originals) { const n = (text.match(m.anchor) || []).length; if (n) { hits += n; await writeFile(f, text.replace(m.anchor, m.replacement)); } }
          if (hits !== 1) throw Error(m.name + ' anchor hits ' + hits);
          const r = await run([path.join(copy, 'scripts/finance-integration.cjs')], { OMF_TEST_BANK_COLLECTION_ONLY: '1', OMF_TEST_BANK_MUTANT: '1' }, 900000, copy);
          await evidence('server-mutant-' + m.name, r.stdout + '\n' + r.stderr);
          const caught = r.code !== 0 && (r.stdout + r.stderr).includes(m.expect); notes.push({ name: m.name, expected: m.expect, anchorHits: hits, code: r.code, caught });
          for (const [f, text] of originals) await writeFile(f, text);
          if (!caught) throw Error(m.name + ' did not flip ' + m.expect + ': ' + (r.stdout + r.stderr).slice(-700));
          counts.mutantsCaught++;
        }
      } finally { await removeOwned(target); }
      return notes.length + '/' + SERVER_MUTANTS.length + ' caught: ' + notes.map(n => n.name + '→' + n.expected).join(', ');
    });
  } finally {
    await import(u('collector/browser.mjs')).then(m => m.closeOwnedBrowsers()).catch(() => {});
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
  return { pass, databaseCoverage: { executed: dbExecuted, ownedProcess: dbExecuted }, counts, message: `${pass ? 'green' : 'RED'} in ${Math.round((Date.now() - started) / 1000)}s; legs ${counts.green}/${counts.legs} green; unit ${counts.unitTests}, security ${counts.securityLegs}, http ${counts.httpLegs}, native ${counts.nativeLegs}, mutants ${counts.mutantsCaught}/${counts.mutantsTotal}\n` + lines.join('\n') };
} };
