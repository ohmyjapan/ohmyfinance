// Fixture for plan omf-bank-collection-amended-20261018 (5-plan-package.json §4): web-bank collection through the connected
// PC + CSV upload into the same bank account, with the interpretation frozen on the job. Run ONLY through the hub verifier
// (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-bank-collection.mjs --cwd <this worktree>
// Every leg runs on synthetic data: the built app on the harness's owned ephemeral MongoDB (scripts/finance-integration.cjs
// → finance-bank-collection-integration.cjs), an owned headless Chrome on a fake bank page served by request interception
// (no bank is reached), an HTTP stub standing in for OMF for the collector transport, temporary directories, and the two
// recorded Aplus corpora read from the hub's evidence folder. No production address, credential or send is involved.
// Fail-first on b7305e6: bank owner routes answer 404 (finance-payments/[...path].ts:31), collector/bank.mjs is absent,
// runBankJob/claimWork are not exported, financebankjobs does not exist, the package allowlist lacks the bank modules.
import { execFile } from 'node:child_process';
import { registerHooks } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 900000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HUB = 'C:/Users/Junsan2/Documents/ohmycode/output/plan';
const APLUS_CORPUS = path.join(HUB, 'omf-aplus-automation-20261013', '8-replay-input.json');
const AUTO_SYNC_CORPUS = path.join(HUB, 'omf-auto-sync-build-20261014', '8-replay-input.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = p => access(p).then(() => true, () => false);
const GUID = /^[a-f\d-]{36}$/;
const u = rel => pathToFileURL(path.join(root, rel)).href;

// ── Test-mode control (fixture-only; review fold F1/F5). Every Chrome this test process launches through a collector
// browser.mjs (the repo module, a mutant sibling importing it, or a staged copy) is forced headless, without a startup
// window, with external host-name resolution refused — whatever its caller asked (profile-reuse fallback, background/quiet
// mode, fault paths). The production module on disk is untouched; the hook lives only in this test process from run() start,
// is proven by the __fixtureHeadless marker before any browser leg (otherwise every browser leg is refused), and is
// deregistered in finally. Owner browsers are never attached: launch keeps pipe transport and the fixture's own profiles.
const FIXTURE_LAUNCH = "\n;{const __fixtureLaunch=puppeteer.launch.bind(puppeteer);puppeteer.launch=o=>__fixtureLaunch({...o,headless:true,args:[...(o?.args||[]).filter(a=>a!=='--no-startup-window'),'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1']});}\nexport const __fixtureHeadless=true;\n";
const isLauncher = (url, source) => /\/browser\.mjs$/.test(url) && /export const LAUNCH_ARGS/.test(source);
const fixtureHeadlessControl = () => registerHooks({ load(url, context, next) { const r = next(url, context); return isLauncher(url, String(r.source)) ? { ...r, source: String(r.source) + FIXTURE_LAUNCH } : r; } });
const headlessProven = m => m instanceof Error || m.__fixtureHeadless === true ? m : new Error('test-mode headless control not applied to collector/browser.mjs; every browser leg refused');
// The node subprocesses this fixture runs (HTTP/V leg, server mutants, unit checks) preload the same control; a loaded
// launcher writes a receipt line to stderr that the HTTP leg requires.
const FIXTURE_HOOK_IMPORT = 'data:text/javascript,' + encodeURIComponent(`import{registerHooks}from'node:module';registerHooks({load(url,c,n){const r=n(url,c);return /\\/browser\\.mjs$/.test(url)&&/export const LAUNCH_ARGS/.test(String(r.source))?{...r,source:String(r.source)+${JSON.stringify(FIXTURE_LAUNCH + "process.stderr.write('[fixture-headless-control] '+import.meta.url+'\\n');\n")}}:r}});`);
const run = (args, extra = {}, timeout = 600000, cwd = root) => new Promise(resolve => execFile(process.execPath, ['--import', FIXTURE_HOOK_IMPORT, ...args], { cwd, windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', ...extra } }, (e, stdout, stderr) => resolve({ code: e ? e.code || 1 : 0, killed: !!e?.killed, stdout: String(stdout), stderr: String(stderr) })));

// ── Server-side mutants: one anchor each in the built server chunks (shape of omf-payment-match.mjs MUTANTS); the
// integration run under OMF_TEST_BANK_MUTANT must then fail on the named assertion.
export const SERVER_MUTANTS = [
  { name: 'M1-scope-filter-dropped', anchor: /bankAccountId:\s*\{\s*\$in:\s*device\.bankAccountIds\s*\|\|\s*\[\]\s*\}/g, replacement: 'bankAccountId:{$exists:true}', expect: 'bank:foreign-device-claims' },
  { name: 'M3-needs-review-writes-rows', anchor: /if\s*\(planned\d*\.held\)/g, replacement: 'if(false)', expect: 'bank:needs-review-no-rows' },
  { name: 'M5-live-template-read', anchor: /const frozen\s*=\s*interpretationOf\(job\.snapshot\)/g, replacement: 'const frozen=interpretationOf({...job.snapshot,...((await BankTemplate.findOne({_id:job.snapshot.templateId}).lean())||{})})', expect: 'bank:frozen-snapshot' },
  { name: 'M6-differs-updated-silently', anchor: /if\s*\(changed\s*&&\s*collector\)/g, replacement: 'if(false)', expect: 'bank:no-silent-reinterpret' },
  { name: 'M7-snapshot-hash-check-dropped', anchor: /if\s*\(String\(query\?\.snapshotHash\s*\|\|\s*["']{2}\)\s*!==\s*job\.snapshotHash\)/g, replacement: 'if(false)', expect: 'bank:wrong-snapshot-400' },
  { name: 'M8-observe-downgraded', anchor: /support\s*===\s*["']verified["']\s*\?\s*["']retrieve["']\s*:\s*["']observe["']/g, replacement: "'retrieve'", expect: 'bank:observe-only' }
];
// ── Collector-side mutants: a sibling copy of the module with one guard removed or one order swapped.
const COLLECTOR_MUTANTS = {
  'M2-ack-before-response': { file: 'collector/index.mjs', anchor: /(const result=await api\(config,route,bytes,query\|\|uploadQuery\(m,account\),live,\{contentType:m\.sourceFormat==='json'\?'application\/json':'text\/csv',base\}\);)\s*(await replaceVaultFile\(path\.join\(item\.directory,'manifest\.json'\),JSON\.stringify\(\{\.\.\.m,acknowledgedAt:new Date\(\)\.toISOString\(\),importId:result\.id\},null,2\)\);)/, replacement: "await replaceVaultFile(path.join(item.directory,'manifest.json'),JSON.stringify({...m,acknowledgedAt:new Date().toISOString()},null,2));$1" },
  'M4-host-check-dropped': { file: 'collector/bank.mjs', guard: 'download-host' },
  'g9-account-label-dropped': { file: 'collector/bank.mjs', guard: 'account-label' }
};
async function mutantModule(spec) {
  const source = path.join(root, spec.file); let text = await readFile(source, 'utf8');
  if (spec.guard) { const lines = text.split('\n'), index = lines.findIndex(l => l.includes('// guard:' + spec.guard)); if (index < 0) throw new Error('guard marker missing: ' + spec.guard); lines.splice(index, 1); text = lines.join('\n'); }
  else { const hits = (text.match(new RegExp(spec.anchor.source, spec.anchor.flags.includes('g') ? spec.anchor.flags : spec.anchor.flags + 'g')) || []).length; if (hits !== 1) throw new Error('mutant anchor hits ' + hits + ' for ' + spec.file); text = text.replace(spec.anchor, spec.replacement); }
  const file = path.join(path.dirname(source), path.basename(spec.file, '.mjs') + `.mutant-${process.pid}-${randomUUID().slice(0, 8)}.mjs`);
  await writeFile(file, text, { flag: 'wx' });
  return { file, async load() { try { return await import(pathToFileURL(file).href); } catch (error) { throw new Error('FAIL mutant invalid: ' + (error?.message || error)); } }, async dispose() { await unlink(file).catch(() => {}); } };
}

// ── The fake bank page (states login → verification → authenticated → statements → export_ready), served by request
// interception; clicks are counted so the automated steps can be shown to make none before authentication.
function bankPage({ exportUrl, accountLabel = '普通 1234567 サンプル商事' }) {
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>Fixture Bank</title><style>button,a,select,input{display:block;margin:8px;padding:8px}</style><body data-state="login"><div id="screen"></div><script>
  window.__clicks=0;window.__clicksBeforeAuth=0;const AUTH=['authenticated','statements','export_ready'];
  document.addEventListener('click',()=>{window.__clicks++;if(!AUTH.includes(document.body.dataset.state))window.__clicksBeforeAuth++;},true);
  const screen=document.getElementById('screen'),set=s=>{document.body.dataset.state=s;draw();};
  function draw(){const s=document.body.dataset.state;
   if(s==='login')screen.innerHTML='<h1>ログイン</h1><input id="userid" type="text" placeholder="ID"><input id="password" type="password" placeholder="password"><button id="login">ログイン</button><a id="english" href="#">English</a>';
   else if(s==='verification')screen.innerHTML='<h1>認証</h1><input id="code" type="tel"><button id="verify">認証する</button>';
   else if(s==='authenticated')screen.innerHTML='<a id="logout" href="#">ログアウト</a><a id="statements" href="/statements">入出金明細</a>';
   else if(s==='statements')screen.innerHTML='<a id="logout" href="#">ログアウト</a><div id="account">${accountLabel}</div><select id="period"><option value="">期間を選択</option><option value="2026-08">2026年8月</option><option value="2026-09">2026年9月</option></select>';
   else if(s==='export_ready')screen.innerHTML='<a id="logout" href="#">ログアウト</a><div id="account">${accountLabel}</div><select id="period"><option value="2026-08">2026年8月</option><option value="2026-09" selected>2026年9月</option></select><a id="csv" href="${exportUrl}" download="meisai.csv">CSV出力</a>';
   wire();}
  function wire(){const q=id=>document.getElementById(id);q('login')?.addEventListener('click',()=>set('verification'));q('verify')?.addEventListener('click',()=>set('authenticated'));
   q('statements')?.addEventListener('click',e=>{e.preventDefault();history.pushState({},'','/statements');set('statements');});
   q('period')?.addEventListener('change',e=>{if(e.target.value)set('export_ready');});}
  window.__signIn=()=>{set('verification');setTimeout(()=>set('authenticated'),50);};
  draw();</script></body></html>`;
}
const BANK_ORIGIN = 'https://bank.fixture.example', CSV_BYTES = Buffer.from('取引日,摘要,出金,入金,残高,メモ\r\n2026/09/01,振込 サンプル商事,,50000,950000,入金\r\n2026/09/02,カード引落,30000,,920000,\r\n');
// Request interception for one page: the bank page at its origin, the export URL (allowed or foreign) as an attachment,
// everything else aborted or left hanging (`hang` keeps the export request pending so a download never arrives).
function intercept(page, { exportUrl, accountLabel, hang = false, stats }) {
  return page.setRequestInterception(true).then(() => page.on('request', request => {
    const url = request.url(); stats.requests++;
    if (url === BANK_ORIGIN + '/' || url === BANK_ORIGIN + '/statements') return request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: bankPage({ exportUrl, accountLabel }) });
    if (url === exportUrl) { stats.exportRequests++; if (hang) return; return request.respond({ status: 200, contentType: 'text/csv; charset=utf-8', headers: { 'Content-Disposition': 'attachment; filename="meisai.csv"' }, body: CSV_BYTES }); }
    return request.abort();
  }));
}
// The fixture-only adapter: the contract shape of collector/bank.mjs (provider, label, start, hosts, support, contract, ui).
// It is `verified` only here — no real bank adapter is verified by this build.
function fixtureAdapter(poll, { label = 'Fixture Bank', counts = {} } = {}) {
  return { provider: 'fixture', label, start: BANK_ORIGIN + '/', hosts: ['bank.fixture.example'], support: 'verified', contract: { recordedAt: 'fixture' }, counts,
    ui(page, browser) {
      const count = k => { counts[k] = (counts[k] || 0) + 1; };
      return {
        async open() { count('open'); await page.goto(BANK_ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 60000 }); },
        async state() { try { return { kind: await page.evaluate(() => document.body.dataset.state) }; } catch { return { kind: 'unknown' }; } },
        async show() { count('show'); await page.bringToFront(); },
        async login() { throw new Error('the fixture adapter never types a credential'); },
        async openStatements() { count('openStatements'); await page.click('#statements'); if (!await poll(() => page.evaluate(() => document.body.dataset.state === 'statements'), 15000, 100)) throw new Error('statements did not open'); },
        async selectPeriod() { count('selectPeriod'); await page.select('#period', '2026-09'); if (!await poll(() => page.evaluate(() => document.body.dataset.state === 'export_ready'), 15000, 100)) throw new Error('period did not apply'); },
        async snapshot() { return page.evaluate(() => ({ accountLabel: document.getElementById('account')?.textContent || '', period: document.getElementById('period')?.value || '' })); },
        async exportCsv() { count('exportCsv'); await page.click('#csv'); },
        async downloadSession(jobDir) { const session = await browser.target().createCDPSession(); await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: jobDir, eventsEnabled: true }); return { on: (event, handler) => session.on(event, handler), async close() { await session.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: false }).catch(() => {}); await session.detach().catch(() => {}); } }; }
      };
    } };
}
// A page-less fake ui with a virtual clock for the recovery/guard legs (shape of aplus-collector.mjs fakeUi).
function fakeUi({ host = 'bank.fixture.example', accountLabel = '普通 1234567 サンプル商事', start = 'authenticated', deliver = true } = {}) {
  const clock = { t: 1_800_000_000_000 }, counts = { open: 0, show: 0, openStatements: 0, selectPeriod: 0, exportCsv: 0 }; let kind = start, jobDir = null, handlers = {};
  const emit = (event, value) => { for (const h of handlers[event] || []) h(value); };
  return { counts, clock, now: () => clock.t, async wait(ms) { clock.t += ms; },
    async open() { counts.open++; }, async state() { return { kind }; }, async show() { counts.show++; }, async login() { throw new Error('never'); },
    async openStatements() { counts.openStatements++; kind = 'statements'; }, async selectPeriod() { counts.selectPeriod++; kind = 'export_ready'; },
    async snapshot() { return { accountLabel, period: '2026-09' }; },
    downloadSession(dir) { jobDir = dir; handlers = {}; return { on(event, handler) { (handlers[event] ||= []).push(handler); }, async close() { handlers = {}; } }; },
    async exportCsv() { counts.exportCsv++; if (!deliver) return; const guid = randomUUID(); await writeFile(path.join(jobDir, guid), CSV_BYTES); emit('Browser.downloadWillBegin', { guid, url: 'https://' + host + '/export/meisai.csv', suggestedFilename: 'meisai.csv' }); emit('Browser.downloadProgress', { guid, state: 'completed', totalBytes: CSV_BYTES.length, receivedBytes: CSV_BYTES.length }); },
    signIn() { kind = 'authenticated'; } };
}
// The upload query shape of b7305e6 (collector/index.mjs:217-224), copied verbatim: the expectation H1 is checked against
// is fixed here before the changed code runs.
function legacyUploadQuery(m, account) {
  const query = { accountId: account._id, jobId: account.jobId, kind: m.kind };
  if (m.start !== undefined) query.start = m.start; if (m.end !== undefined) query.end = m.end;
  if (m.pageCount !== undefined && m.pageCount !== null) query.pageCount = String(m.pageCount);
  if (m.kind === 'statement' && m.statementMonth !== undefined) { query.statementMonth = m.statementMonth; query.statementTotal = String(m.statementTotal); if (m.refundTotal !== undefined && m.refundTotal !== null) query.refundTotal = String(m.refundTotal); if (typeof m.paymentDueDate === 'string' && m.paymentDueDate) query.paymentDueDate = m.paymentDueDate; }
  if (m.kind === 'notice' && m.mailId !== undefined) query.mailId = String(m.mailId);
  return query;
}
const oid = v => typeof v === 'string' ? v : v && typeof v === 'object' && typeof v.$oid === 'string' ? v.$oid : String(v ?? '');
// An HTTP stub standing in for OMF: records every request and answers from `routes` (path → handler(req, body)).
async function stub(routes) {
  const requests = [];
  const server = http.createServer((req, res) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { const body = Buffer.concat(chunks), url = new URL(req.url, 'http://x'); requests.push({ path: url.pathname, search: url.search, query: Object.fromEntries(url.searchParams), type: req.headers['content-type'], authorization: req.headers.authorization, body, method: req.method }); const handler = routes[url.pathname] || routes['*']; const reply = handler ? handler({ query: Object.fromEntries(url.searchParams), body, type: req.headers['content-type'] }) : { status: 404, data: { statusMessage: 'Collector endpoint not found' } }; res.writeHead(reply.status || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(reply.data ?? reply)); }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { requests, origin: 'http://127.0.0.1:' + server.address().port, config: { baseUrl: 'http://127.0.0.1:' + server.address().port, token: 'omfc_' + 'a'.repeat(64) }, close: () => new Promise(r => server.close(r)) };
}
async function files(dir) { const out = []; for (const e of await readdir(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) out.push(...await files(f)); else if (e.name.endsWith('.mjs')) out.push(f); } return out; }
async function removeOwned(dir) { if (!path.resolve(dir).startsWith(path.resolve(root) + path.sep)) throw Error('Unsafe mutation directory'); await rm(dir, { recursive: true, force: true }); }
async function walkRelativeImports(file, seen = new Set()) {
  const text = await readFile(file, 'utf8'), dir = path.dirname(file);
  for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*)'(\.[^']+)'/g)) { const target = path.resolve(dir, m[1]); if (!await exists(target)) throw new Error(path.relative(root, file).replaceAll('\\', '/') + ' imports ' + m[1] + ' which is not staged'); if (!seen.has(target)) { seen.add(target); await walkRelativeImports(target, seen); } }
  return seen;
}
const BANK_PACKAGE_ENTRIES = ['collector/bank.mjs', 'collector/banks/rakuten.mjs', 'collector/banks/paypay.mjs', 'collector/banks/resona.mjs', 'collector/banks/ikeda.mjs', 'shared/finance-payment-match.mjs'];
async function packageClosure(stageModule, into) {
  const { manifest } = await stageModule.stage({ into, origin: 'https://omf.example', install: false, log: () => {} });
  for (const entry of BANK_PACKAGE_ENTRIES) { if (!manifest.files[entry]) throw new Error('package:bank-modules-staged missing ' + entry); if (manifest.files[entry] !== sha256(await readFile(path.join(root, entry)))) throw new Error('package:bank-modules-staged hash differs for ' + entry); }
  await walkRelativeImports(path.join(into, 'collector', 'index.mjs'));
  return manifest;
}

export default { name: 'omf-bank-collection', covers: ['server/models/FinancePaymentMatch.ts', 'server/models/Finance.ts', 'server/api/finance-payments/collector/[...path].ts', 'server/api/finance-payments/[...path].ts', 'server/services/financeBankStatementService.ts', 'server/services/financeBankCollectionService.ts', 'shared/finance-payment-match.mjs', 'shared/finance-payment-match.d.mts', 'collector/index.mjs', 'collector/bank.mjs', 'collector/banks/rakuten.mjs', 'collector/banks/paypay.mjs', 'collector/banks/resona.mjs', 'collector/banks/ikeda.mjs', 'collector/banks/contract.mjs', 'collector/aplus.mjs', 'collector/package/stage.mjs', 'components/intake/BankStatementImporter.vue', 'components/intake/BankConnections.vue', 'pages/intake/payments.vue', 'components/intake/IntakePaymentMatches.vue', 'docs/payment-matching.md', 'scripts/finance-integration.cjs', 'scripts/finance-bank-collection-integration.cjs', 'scripts/zoomer-fixtures/omf-payment-match.mjs', 'scripts/zoomer-fixtures/omf-bank-collection.mjs', 'scripts/zoomer-fixtures/omf-bank-collection-replay.mjs'], async run() {
  const started = Date.now(), lines = []; let pass = true;
  const headless = fixtureHeadlessControl(); // test-mode control (see FIXTURE_LAUNCH); deregistered in finally
  const leg = async (name, fn) => { const t = Date.now(); try { lines.push(name + ': ' + await fn() + ` (${Math.round((Date.now() - t) / 1000)}s)`); } catch (e) { pass = false; lines.push(name + ': RED ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 1200)); } };
  const assert = (await import('node:assert/strict')).default;
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-bank-fixture-'));
  process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector-dir');
  let app = null;
  try {
    // ── 1. owned HTTP + hidden Chrome: U, O1-O3, D1-D4, T1-T7, C5-C7, V ──
    await leg('HTTP U/O/D/T/C5-C7/V on the built app (owned MongoDB, hidden Chrome)', async () => {
      if (!existsSync(path.join(root, '.output/server/index.mjs'))) throw Error('built app absent; no HTTP coverage');
      app = await run(['scripts/finance-integration.cjs'], { OMF_TEST_BANK_COLLECTION_ONLY: '1' });
      await writeFile(path.join(root, '.zoomer-bank-integration.txt'), app.stdout + app.stderr);
      if (app.code !== 0) throw Error((app.stdout + app.stderr).slice(-2600));
      if (!app.stdout.includes('V hidden real Chrome')) throw Error('mandatory Chrome leg missing');
      // plan omf-paypay-split-dates-retry-20261022: the actual PayPay split-date statement shape (year/month/day columns) is a required leg
      if (!/^PASS P PayPay銀行 split dates/m.test(app.stdout)) throw Error('mandatory split-date leg missing');
      if (!app.stderr.includes('[fixture-headless-control] ' + u('collector/browser.mjs'))) throw Error('test-mode headless control receipt missing in the HTTP/V subprocess');
      return app.stdout.match(/\d+ targeted bank collection checks passed/)?.[0] || 'missing summary';
    });
    // ── 2. collector: A1/A2 on owned Chrome with the fake page, C1/C3 dispatch, C4 recovery, C8 abort, H1/H2 corpora ──
    const browserModule = headlessProven(await import(u('collector/browser.mjs')).catch(e => e)), interaction = await import(u('collector/interaction.mjs')).catch(e => e);
    const bankModule = await import(u('collector/bank.mjs')).catch(e => e), index = await import(u('collector/index.mjs')).catch(e => e);
    const need = (m, what) => { if (m instanceof Error) throw new Error(what + ' missing or broken: ' + m.message); return m; };
    const ACCOUNT = { _id: 'c3c3c3c3c3c3c3c3c3c3c3c3', ownerId: 'd4d4d4d4d4d4d4d4d4d4d4d4', name: 'Synthetic bank', currency: 'JPY' }, ORIGIN = 'https://omf.example';
    const SNAPSHOT = { templateId: 'e5e5e5e5e5e5e5e5e5e5e5e5', templateRevision: 3, headers: ['取引日', '摘要', '出金', '入金', '残高', 'メモ'], mapping: { date: '0', description: '1', outflow: '2', inflow: '3', balance: '4', reference: '5' }, amountSign: 'outflow-positive', transactionIdConfirmed: false, parserVersion: 'bank-template-1', currency: 'JPY', provider: 'fixture', accountLabel: 'サンプル商事', coverage: null };
    const jobOf = (kind = 'retrieve') => ({ jobId: randomUUID(), kind, snapshot: SNAPSHOT, snapshotHash: sha256(JSON.stringify(SNAPSHOT)), provider: 'fixture', support: 'verified' });
    const boundOf = job => ({ bankAccountId: ACCOUNT._id, ownerId: ACCOUNT.ownerId, origin: ORIGIN, jobId: job.jobId, snapshotHash: job.snapshotHash, provider: 'fixture' });
    const launched = async (dir, batch, options) => { const { browserFor, ephemeralProfile } = need(browserModule, 'collector/browser.mjs'); const profile = ephemeralProfile(dir, ACCOUNT.ownerId, 'bank', ACCOUNT._id, batch); const browser = await browserFor(profile, { ephemeral: true, root: dir, headless: true }); const original = browser.newPage.bind(browser); const stats = { requests: 0, exportRequests: 0 }; let page = null; browser.newPage = async () => { page = await original(); await intercept(page, { ...options, stats }); return page; }; return { browser, profile, stats, page: () => page }; };
    await leg('A1 automatic run on the fake bank page (owned headless Chrome): one intervention at login, zero clicks before authenticated, routine steps automated, host-checked download, manifest bound to job+snapshot', async () => {
      const bank = need(bankModule, 'collector/bank.mjs'), { poll } = need(interaction, 'collector/interaction.mjs'), dir = path.join(temp, 'a1'); await mkdir(dir, { recursive: true });
      const job = jobOf(), bound = boundOf(job), adapter = fixtureAdapter(poll), statuses = [], l = await launched(dir, 'a1', { exportUrl: BANK_ORIGIN + '/export/meisai.csv' });
      let clicksBeforeAuth = null;
      const status = async (state, text) => { statuses.push([state, text]); if (state === 'verification_required') { clicksBeforeAuth = await l.page().evaluate(() => window.__clicksBeforeAuth); await l.page().evaluate(() => window.__signIn()); } };
      const result = await bank.collectBankStatement(bound, job, dir, status, { adapter, batch: 'a1', pollMs: 200, loginTimeoutMs: 20000, downloadTimeoutMs: 20000, extensionMs: 0 });
      assert.equal(result.failed, null, JSON.stringify(result)); assert.equal(result.items.length, 1);
      const m = result.items[0].manifest; assert.equal(m.jobId, job.jobId, 'bank:manifest-job'); assert.equal(m.snapshotHash, job.snapshotHash, 'bank:manifest-snapshot'); assert.equal(m.bankAccountId, ACCOUNT._id); assert.equal(m.ownerId, ACCOUNT.ownerId); assert.equal(m.origin, ORIGIN); assert.equal(m.kind, 'statement'); assert.equal(m.channel, 'collector'); assert.equal(m.sourceHost, 'bank.fixture.example'); assert.ok(GUID.test(m.filename)); assert.equal(m.sha256, sha256(CSV_BYTES)); assert.equal(sha256(await readFile(path.join(result.items[0].directory, m.filename))), m.sha256);
      assert.equal(path.relative(dir, result.items[0].directory).replaceAll('\\', '/'), 'outbox/bank/' + ACCOUNT._id + '/' + job.jobId, 'bank:outbox-layout'); assert.ok(await exists(path.join(result.items[0].directory, 'attempt.json')), 'bank:attempt-marker-written');
      assert.equal(statuses.filter(([s]) => s === 'verification_required').length, 1, 'bank:one-intervention'); assert.equal(clicksBeforeAuth, 0, 'bank:zero-clicks-before-auth'); assert.equal(adapter.counts.show, 1); assert.deepEqual([adapter.counts.openStatements, adapter.counts.selectPeriod, adapter.counts.exportCsv], [1, 1, 1], 'bank:routine-automated'); assert.equal(adapter.counts.login, undefined, 'bank:no-credential-typed');
      assert.equal(l.stats.exportRequests, 1); assert.ok(statuses.some(([s, t]) => s === 'running' && /CSV/.test(t)));
      // browser.mjs keeps a disconnected map entry after a bank job closes its Chrome (closeEntry is private there; closeOwnedBrowsers purges it at lock/expiry); live ownership is what matters
      assert.equal(browserModule.ownedBrowsers().filter(b => b.connected).length, 0, 'bank:browser-closed'); assert.equal(await exists(l.profile), false, 'bank:ephemeral-profile-removed');
      // a run that must fail: the actual error is reported when it is not the expected one
      const expectFailure = async (promise, pattern, label) => { let error = null; try { await promise; } catch (e) { error = e; } assert.ok(error && pattern.test(String(error.message)), label + ' — ' + (error ? 'threw: ' + String(error.stack || error.message).replace(/\s+/g, ' ').slice(0, 400) : 'resolved without an error')); return error; };
      // account-label mismatch fails before any export click
      const mismatch = await launched(dir, 'a1-label', { exportUrl: BANK_ORIGIN + '/export/meisai.csv', accountLabel: '普通 9999999 ほかの会社' }), adapter2 = fixtureAdapter(poll), job2 = jobOf();
      await expectFailure(bank.collectBankStatement(boundOf(job2), job2, dir, async (s) => { if (s === 'verification_required') await mismatch.page().evaluate(() => window.__signIn()); }, { adapter: adapter2, batch: 'a1-label', pollMs: 200, loginTimeoutMs: 20000 }), /一致しません/, 'bank:account-label');
      assert.equal(adapter2.counts.exportCsv, undefined, 'bank:account-label-no-export'); assert.equal(browserModule.ownedBrowsers().filter(b => b.connected).length, 0); assert.equal(await exists(mismatch.profile), false);
      // export from a foreign host fails and the file is not retained
      const foreign = await launched(dir, 'a1-foreign', { exportUrl: 'https://cdn.evil.example/meisai.csv' }), adapter3 = fixtureAdapter(poll), job3 = jobOf();
      await expectFailure(bank.collectBankStatement(boundOf(job3), job3, dir, async (s) => { if (s === 'verification_required') await foreign.page().evaluate(() => window.__signIn()); }, { adapter: adapter3, batch: 'a1-foreign', pollMs: 200, loginTimeoutMs: 20000, downloadTimeoutMs: 20000, extensionMs: 0 }), /銀行サイトではありません/, 'bank:foreign-download');
      const foreignDir = path.join(dir, 'outbox', 'bank', ACCOUNT._id, job3.jobId); assert.equal(await exists(path.join(foreignDir, 'manifest.json')), false, 'bank:foreign-download-no-manifest'); assert.equal((await readdir(foreignDir)).filter(n => GUID.test(n)).length, 0, 'bank:foreign-download-file-removed');
      return `one verification_required, 0 clicks before auth, ${l.stats.requests} intercepted requests, manifest ${m.sha256.slice(0, 8)}; label mismatch and foreign host refused`;
    });
    await leg('A2 observe recorder (owned headless Chrome, filled fields): no typed value in the record, controls/inputs/selects/downloads only; preparatory CSV retained; runBankJob never retrieves for observe', async () => {
      const bank = need(bankModule, 'collector/bank.mjs'), idx = need(index, 'collector/index.mjs'), { poll } = need(interaction, 'collector/interaction.mjs'), dir = path.join(temp, 'a2'); await mkdir(dir, { recursive: true });
      const job = jobOf('observe'), bound = boundOf(job), adapter = { ...fixtureAdapter(poll), support: 'contract-pending', contract: null }, l = await launched(dir, 'a2', { exportUrl: BANK_ORIGIN + '/export/meisai.csv' });
      const statuses = []; let person = null, personError = null;
      // the person acts on their own time (not inside the collector's status call): types a secret into the login form, signs in, opens the statements, exports once, closes the tab
      const status = async (state, text) => { statuses.push([state, text]); if (state !== 'verification_required' || person) return; person = (async () => { const page = l.page(); await new Promise(r => setTimeout(r, 300));
        await page.type('#userid', 'secret-user-id'); await page.type('#password', 'Secret-Pass-9981'); await new Promise(r => setTimeout(r, 400)); await page.evaluate(() => window.__signIn()); await poll(() => page.evaluate(() => document.body.dataset.state === 'authenticated'), 5000, 50);
        await page.click('#statements'); await poll(() => page.evaluate(() => document.body.dataset.state === 'statements'), 5000, 50); await page.select('#period', '2026-09'); await poll(() => page.evaluate(() => document.body.dataset.state === 'export_ready'), 5000, 50); await page.click('#csv'); await new Promise(r => setTimeout(r, 1500)); await page.close(); })().catch(e => { personError = e; }); };
      const result = await bank.observeBankPortal(bound, job, dir, status, { adapter, batch: 'a2', pollMs: 100, timeoutMs: 30000 });
      await person; assert.equal(personError, null, 'fixture person flow failed: ' + String(personError?.message || personError));
      const text = JSON.stringify(result.observation); assert.ok(result.observation.length >= 2, 'bank:observation-pages ' + result.observation.length); assert.ok(!/secret-user-id|Secret-Pass-9981/.test(text), 'bank:observation-no-values');
      for (const r of result.observation) assert.deepEqual(Object.keys(r).sort(), ['at', 'clicks', 'downloadEvents', 'eventChannel', 'eventsDropped', 'inputs', 'pathname', 'selects', 'title', 'typedInto', 'visibleControls'], 'bank:observation-keys'); for (const i of result.observation.flatMap(r => r.inputs)) assert.deepEqual(Object.keys(i).sort(), ['id', 'type'], 'bank:observation-input-keys');
      assert.ok(result.observation.some(r => r.pathname === '/' && r.visibleControls.includes('ログイン') && r.inputs.some(i => i.id === 'password' && i.type === 'password')), 'bank:observation-login-page'); assert.ok(result.observation.some(r => r.pathname === '/statements' && r.selects.length === 1), 'bank:observation-statements-page'); assert.ok(result.observation.every(r => r.title === 'Fixture Bank'));
      assert.equal(result.items.length, 1, 'bank:observe-preparatory-csv'); assert.equal(result.items[0].manifest.channel, 'collector-observe'); assert.equal(result.items[0].manifest.sourceHost, 'bank.fixture.example'); assert.equal(result.items[0].manifest.sha256, sha256(CSV_BYTES)); assert.equal(result.items[0].manifest.jobId, job.jobId); assert.equal(result.items[0].manifest.snapshotHash, job.snapshotHash);
      assert.ok(result.observation.some(r => r.downloadEvents.some(d => d.host === 'bank.fixture.example' && d.suggestedFilename === 'meisai.csv')), 'bank:observation-download-event');
      assert.equal(statuses.filter(([s]) => s === 'verification_required').length, 1); assert.equal(browserModule.ownedBrowsers().filter(b => b.connected).length, 0); assert.equal(await exists(l.profile), false);
      // runBankJob: an observe job never calls collect; the observation is retained as an artifact and sent as kind=observation; items go to bank/upload with the job's own jobId/snapshotHash
      const s = await stub({ '/api/finance-payments/collector/bank/upload': ({ query }) => ({ data: query.kind === 'observation' ? { stored: true } : { id: 'f'.repeat(24), state: 'imported', duplicate: false } }) });
      try {
        let collected = 0, observed = 0; const uploads = [];
        // the job binds its artifacts to the OMF origin the collector is paired with (the stub here), never to a constant
        const outcome = await idx.runBankJob({ job, account: ACCOUNT }, s.config, null, { status: async () => {}, directory: dir, collect: async () => { collected++; return { items: [], failed: null }; }, observe: async (b, j) => { observed++; assert.deepEqual(b, { ...bound, origin: s.config.baseUrl }, 'bank:bound-to-paired-origin'); assert.equal(j.jobId, job.jobId); return result; }, upload: async (config, account, item, live, options) => { uploads.push({ manifest: item.manifest, options }); return idx.upload(config, account, item, live, options); } });
        assert.equal(collected, 0, 'bank:observe-only'); assert.equal(observed, 1); assert.equal(outcome.failed, null); assert.equal(outcome.observation, true);
        const sent = s.requests.filter(r => r.path === '/api/finance-payments/collector/bank/upload'); assert.equal(sent.length, 2, 'bank:observe-sends'); const obs = sent.find(r => r.query.kind === 'observation'), csv = sent.find(r => r.query.kind === 'statement');
        assert.ok(obs && csv); assert.equal(obs.type, 'application/json'); assert.deepEqual(JSON.parse(obs.body.toString()), result.observation, 'bank:observation-sent-verbatim'); assert.equal(obs.query.jobId, job.jobId); assert.equal(obs.query.snapshotHash, job.snapshotHash); assert.equal(csv.type, 'text/csv'); assert.equal(sha256(csv.body), sha256(CSV_BYTES)); assert.equal(csv.query.channel, 'collector-observe'); assert.equal(csv.query.sourceHost, 'bank.fixture.example');
        for (const up of uploads) { assert.equal(up.options.route, 'bank/upload'); assert.equal(up.options.base, idx.BANK_BASE); const acked = JSON.parse(await readFile(path.join(path.dirname(path.join(dir, 'outbox', 'bank', ACCOUNT._id, up.manifest.jobId + (up.manifest.kind === 'observation' ? '-observation' : '-observe'))), 'x'), 'utf8').catch(() => 'null')); void acked; }
        for (const name of await readdir(path.join(dir, 'outbox', 'bank', ACCOUNT._id))) { const mf = JSON.parse(await readFile(path.join(dir, 'outbox', 'bank', ACCOUNT._id, name, 'manifest.json'), 'utf8')); assert.ok(mf.acknowledgedAt, 'bank:observe-artifacts-acknowledged ' + name); }
        return `${result.observation.length} page records, no typed value, preparatory CSV retained from the allowed host; runBankJob: collect 0, observe 1, 2 sends (observation JSON + CSV) acknowledged`;
      } finally { await s.close(); }
    });
    await leg('C1/C3/H2 dispatch: card claim first; bank/claim only after a null card claim through the base option; 404 = no bank job; the auto-sync account claims as a card job', async () => {
      const idx = need(index, 'collector/index.mjs'); assert.equal(typeof idx.claimWork, 'function', 'claimWork not exported');
      const corpus = JSON.parse(await readFile(AUTO_SYNC_CORPUS, 'utf8')), account = corpus.rows[0]; assert.ok(account, 'auto-sync corpus has no account row');
      const cardAccount = { _id: oid(account._id), ownerId: oid(account.ownerId), name: account.name, provider: account.provider, primaryCard: account.primaryCard, cardIdentifiers: account.cardIdentifiers, jobId: randomUUID(), jobState: 'running' };
      let mode = 'card';
      const s = await stub({ '/api/finance/collector/claim': () => ({ data: mode === 'card' ? { account: cardAccount, covered: { statements: [], notices: [] } } : { account: null } }), '/api/finance-payments/collector/bank/claim': () => mode === 'bank' ? { data: { job: { jobId: 'j1', kind: 'observe' }, account: ACCOUNT } } : { status: 404, data: { statusMessage: 'Payment matching endpoint not found' } } });
      try {
        const card = await idx.claimWork(s.config, null); assert.deepEqual(card.account, cardAccount, 'bank:card-claim-first'); assert.equal(card.bank, null); assert.deepEqual(s.requests.map(r => r.path), ['/api/finance/collector/claim'], 'bank:no-bank-claim-while-card');
        mode = 'none'; s.requests.length = 0; const idle = await idx.claimWork(s.config, null); assert.equal(idle.account, null); assert.equal(idle.bank, null, 'bank:404-means-no-job'); assert.deepEqual(s.requests.map(r => r.path), ['/api/finance/collector/claim', '/api/finance-payments/collector/bank/claim'], 'bank:bank-claim-after-null-card');
        mode = 'bank'; s.requests.length = 0; const bank = await idx.claimWork(s.config, null); assert.equal(bank.account, null); assert.equal(bank.bank.job.jobId, 'j1', 'bank:bank-claim-returned'); assert.equal(s.requests[1].method, 'POST'); assert.ok(s.requests.every(r => r.authorization === 'Bearer ' + s.config.token));
        return 'card first (1 request), null card → bank/claim 404 tolerated, bank job returned when offered; H2 account ' + cardAccount._id.slice(0, 6) + ' claimed as a card job';
      } finally { await s.close(); }
    });
    await leg('H1 Aplus corpus byte-identical through the changed upload()/api(): route, query and content type fixed before the run', async () => {
      const idx = need(index, 'collector/index.mjs'); if (!existsSync(APLUS_CORPUS)) throw new Error('NOT RUN: Aplus corpus absent at ' + APLUS_CORPUS);
      const corpus = JSON.parse(await readFile(APLUS_CORPUS, 'utf8')); assert.equal(corpus.readOnly, true); assert.ok(corpus.rows.length >= 11, 'corpus rows ' + corpus.rows.length);
      const s = await stub({ '/api/finance/collector/upload': () => ({ data: { id: 'f'.repeat(24), rowCount: 1, duplicateFile: true } }) });
      try {
        let compared = 0;
        for (const row of corpus.rows) {
          const account = { _id: oid(row.account?._id ?? row.accountId), jobId: randomUUID(), primaryCard: row.account?.primaryCard };
          const bytes = Buffer.from(row.sourceBase64, 'base64'); assert.equal(sha256(bytes), row.hash, 'corpus bytes hash');
          const m = { accountId: account._id, primaryCard: account.primaryCard, jobId: account.jobId, kind: row.period.kind, sourceFormat: row.sourceFormat || 'csv', start: row.period.start, end: row.period.end, ...(row.period.kind === 'statement' ? { statementMonth: row.period.statementMonth, statementTotal: row.reconciliation?.statementTotal, ...(row.reconciliation?.separateRefundTotal != null ? { refundTotal: row.reconciliation.separateRefundTotal } : {}), ...(row.period.paymentDueDate ? { paymentDueDate: row.period.paymentDueDate } : {}) } : { pageCount: row.pageCount ?? row.sourcePageCount ?? 1 }), sha256: row.hash, filename: randomUUID() };
          const expected = { path: '/api/finance/collector/upload', search: '?' + new URLSearchParams(legacyUploadQuery(m, account)).toString(), type: m.sourceFormat === 'json' ? 'application/json' : 'text/csv', hash: row.hash };
          const dir = path.join(temp, 'h1', String(row._id?.$oid || row._id)); await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, m.filename), bytes); await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(m));
          s.requests.length = 0; await idx.upload(s.config, account, { directory: dir, manifest: m }, null);
          const [request] = s.requests; assert.equal(request.path, expected.path, 'bank:h1-route'); assert.equal(request.search, expected.search, 'bank:h1-query ' + String(row._id?.$oid || row._id)); assert.equal(request.type, expected.type, 'bank:h1-content-type'); assert.equal(sha256(request.body), expected.hash, 'bank:h1-bytes');
          assert.ok(JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')).acknowledgedAt); compared++;
        }
        return compared + ' Aplus imports (statement CSV + pending JSON) sent byte-identical: route, query and content type equal the b7305e6 shape';
      } finally { await s.close(); }
    });
    await leg('C4 recovery and collector guards with a page-less fake ui: completed attempt → no second export; marker without file → failed, no click; foreign host → refused; acknowledgement only after the response', async () => {
      const bank = need(bankModule, 'collector/bank.mjs'), idx = need(index, 'collector/index.mjs'), dir = path.join(temp, 'c4'); await mkdir(dir, { recursive: true });
      const adapter = { provider: 'fixture', label: 'Fixture Bank', start: BANK_ORIGIN + '/', hosts: ['bank.fixture.example'], support: 'verified', contract: {} };
      const runFake = async (ui, job, extra = {}) => bank.collectBankFromPage(null, null, adapter, boundOf(job), job, dir, async () => {}, { ui, now: ui.now, wait: ui.wait, pollMs: 1000, ...extra });
      // happy path with the fake ui (control)
      const ok = fakeUi(), jobOk = jobOf(); const r0 = await runFake(ok, jobOk); assert.equal(r0.items.length, 1); assert.equal(ok.counts.exportCsv, 1); assert.equal(r0.items[0].manifest.sourceHost, 'bank.fixture.example');
      // C4: a crash after the file completed but before the manifest → recovered from the bound attempt and the recorded download, zero export clicks
      const jobR = jobOf(), jobDir = path.join(dir, 'outbox', 'bank', ACCOUNT._id, jobR.jobId); await mkdir(jobDir, { recursive: true }); const guid = randomUUID();
      await writeFile(path.join(jobDir, 'attempt.json'), JSON.stringify({ ...boundOf(jobR), period: '2026-09', requestedAt: new Date(1_800_000_000_000).toISOString() })); await writeFile(path.join(jobDir, 'download.json'), JSON.stringify({ guid, host: 'bank.fixture.example', suggestedFilename: 'meisai.csv' })); await writeFile(path.join(jobDir, guid), CSV_BYTES);
      const rec = fakeUi(); const recovered = await runFake(rec, jobR); assert.equal(recovered.items.length, 1, 'bank:one-export'); assert.equal(rec.counts.exportCsv, 0, 'bank:one-export'); assert.equal(recovered.items[0].manifest.filename, guid); assert.equal(recovered.items[0].manifest.sha256, sha256(CSV_BYTES)); assert.equal(recovered.items[0].manifest.recovered, true); assert.equal(recovered.items[0].manifest.labelChecked,false,'bank:legacy-recovery-label-unchecked');
      // marker without a complete file → failed, no second export
      const jobM = jobOf(), markerDir = path.join(dir, 'outbox', 'bank', ACCOUNT._id, jobM.jobId); await mkdir(markerDir, { recursive: true }); await writeFile(path.join(markerDir, 'attempt.json'), JSON.stringify({ ...boundOf(jobM), requestedAt: 'x' }));
      const marked = fakeUi(); const failed = await runFake(marked, jobM); assert.equal(failed.items.length, 0); assert.match(failed.failed || '', /ダウンロードが完了しませんでした/, 'bank:attempt-marker'); assert.equal(marked.counts.exportCsv, 0, 'bank:attempt-marker');
      // recovery refuses a download whose recorded host is foreign
      const jobF = jobOf(), fDir = path.join(dir, 'outbox', 'bank', ACCOUNT._id, jobF.jobId); await mkdir(fDir, { recursive: true }); const g2 = randomUUID(); await writeFile(path.join(fDir, 'attempt.json'), JSON.stringify({ ...boundOf(jobF), requestedAt: 'x' })); await writeFile(path.join(fDir, 'download.json'), JSON.stringify({ guid: g2, host: 'cdn.evil.example' })); await writeFile(path.join(fDir, g2), CSV_BYTES);
      const fr = fakeUi(); const refused = await runFake(fr, jobF); assert.equal(refused.items.length, 0, 'bank:foreign-download'); assert.equal(fr.counts.exportCsv, 0);
      // live foreign host → thrown, file removed (the mutant M4 flips this)
      const foreignUi = fakeUi({ host: 'cdn.evil.example' }), jobX = jobOf(); await assert.rejects(runFake(foreignUi, jobX), /銀行サイトではありません/, 'bank:foreign-download'); assert.equal((await readdir(path.join(dir, 'outbox', 'bank', ACCOUNT._id, jobX.jobId))).filter(n => GUID.test(n)).length, 0, 'bank:foreign-download-file-removed');
      // account label mismatch (g9)
      await assert.rejects(runFake(fakeUi({ accountLabel: 'ほかの口座' }), jobOf()), /一致しません/, 'bank:account-label');
      // acknowledgement only after the response (M2): a 500 leaves the manifest unacknowledged; a 200 acknowledges
      let fail = true; const s = await stub({ '*': () => fail ? { status: 500, data: { statusMessage: 'synthetic failure' } } : { data: { id: 'f'.repeat(24), state: 'imported' } } });
      try {
        const item = r0.items[0]; assert.equal(item.manifest.labelChecked,true,'bank:matched-label-checked'); assert.equal(idx.bankUploadQuery(item.manifest).labelChecked,'true','bank:label-check-transport');
        const blankJob=jobOf();blankJob.snapshot={...blankJob.snapshot,accountLabel:null};blankJob.snapshotHash=sha256(JSON.stringify(blankJob.snapshot));const unchecked=await runFake(fakeUi(),blankJob);
        assert.equal(unchecked.items[0].manifest.labelChecked,false,'bank:blank-label-unchecked');assert.equal(idx.bankUploadQuery(unchecked.items[0].manifest).labelChecked,'false','bank:unchecked-label-transport'); await assert.rejects(idx.upload(s.config, ACCOUNT, item, null, { route: 'bank/upload', base: idx.BANK_BASE, query: idx.bankUploadQuery(item.manifest) }), /synthetic failure/); assert.equal(JSON.parse(await readFile(path.join(item.directory, 'manifest.json'), 'utf8')).acknowledgedAt, undefined, 'bank:ack-after-response');
        fail = false; await idx.upload(s.config, ACCOUNT, item, null, { route: 'bank/upload', base: idx.BANK_BASE, query: idx.bankUploadQuery(item.manifest) }); const acked = JSON.parse(await readFile(path.join(item.directory, 'manifest.json'), 'utf8')); assert.ok(acked.acknowledgedAt, 'bank:ack-after-response'); assert.equal(acked.importId, 'f'.repeat(24));
        assert.equal(s.requests.at(-1).path, '/api/finance-payments/collector/bank/upload'); assert.equal(s.requests.at(-1).query.jobId, jobOk.jobId); assert.equal(s.requests.at(-1).query.snapshotHash, jobOk.snapshotHash);
        assert.equal(JSON.parse(await readFile(path.join(item.directory,'attempt.json'),'utf8')).labelChecked,true,'bank:label-check-journal');
        await idx.upload(s.config,ACCOUNT,unchecked.items[0],null,{route:'bank/upload',base:idx.BANK_BASE,query:idx.bankUploadQuery(unchecked.items[0].manifest)});assert.equal(s.requests.at(-1).query.labelChecked,'false','bank:unchecked-label-sent');
        // drain: an older retained manifest bound to THIS OMF origin goes out with ITS OWN jobId/snapshotHash; one bound to another origin is left alone
        const older = jobOf(), olderDir = path.join(dir, 'outbox', 'bank', ACCOUNT._id, older.jobId); await mkdir(olderDir, { recursive: true }); const gf = randomUUID(); await writeFile(path.join(olderDir, gf), CSV_BYTES); await writeFile(path.join(olderDir, 'manifest.json'), JSON.stringify({ ...boundOf(older), origin: s.config.baseUrl, kind: 'statement', channel: 'collector', sourceFormat: 'csv', sha256: sha256(CSV_BYTES), filename: gf, sourceHost: 'bank.fixture.example', downloadedAt: '2026-10-01T00:00:00.000Z' }));
        const foreignOrigin = jobOf(), foreignDir = path.join(dir, 'outbox', 'bank', ACCOUNT._id, foreignOrigin.jobId); await mkdir(foreignDir, { recursive: true }); const gf2 = randomUUID(); await writeFile(path.join(foreignDir, gf2), CSV_BYTES); await writeFile(path.join(foreignDir, 'manifest.json'), JSON.stringify({ ...boundOf(foreignOrigin), origin: 'https://other-omf.example', kind: 'statement', channel: 'collector', sourceFormat: 'csv', sha256: sha256(CSV_BYTES), filename: gf2, sourceHost: 'bank.fixture.example', downloadedAt: '2026-10-01T00:00:00.000Z' }));
        const current = jobOf(); s.requests.length = 0; const outcome = await idx.runBankJob({ job: current, account: ACCOUNT }, s.config, null, { status: async () => {}, directory: dir, collect: async () => ({ items: [], failed: null }) });
        const drained = s.requests.filter(r => r.path.endsWith('/bank/upload')); assert.equal(drained.length, 1, 'bank:drain-count'); assert.equal(drained[0].query.jobId, older.jobId, 'bank:drain-own-snapshot'); assert.equal(drained[0].query.snapshotHash, older.snapshotHash, 'bank:drain-own-snapshot'); assert.equal(outcome.drained, 1);
        assert.equal(JSON.parse(await readFile(path.join(foreignDir, 'manifest.json'), 'utf8')).acknowledgedAt, undefined, 'bank:drain-foreign-origin-untouched');
        return 'recovered without a second export; marker-only failed with 0 clicks; foreign host refused live and on recovery; label mismatch refused; ack only after 200; drain carries the older manifest\'s own job/snapshot';
      } finally { await s.close(); }
    });
    await leg('C8 session end mid-download (owned Chrome): the bank job fails closed, its profile is removed, a sibling owned browser survives, a card claim still works', async () => {
      const bank = need(bankModule, 'collector/bank.mjs'), idx = need(index, 'collector/index.mjs'), { browserFor, ownedBrowsers, closeOwnedBrowsers } = need(browserModule, 'collector/browser.mjs'), { poll } = need(interaction, 'collector/interaction.mjs'), dir = path.join(temp, 'c8'); await mkdir(dir, { recursive: true });
      const sibling = await browserFor(path.join(dir, 'sibling-profile'), { headless: true });
      try {
        const job = jobOf(), controller = new AbortController(), l = await launched(dir, 'c8', { exportUrl: BANK_ORIGIN + '/export/meisai.csv', hang: true }), adapter = fixtureAdapter(poll);
        const status = async (state, text) => { if (state === 'verification_required') await l.page().evaluate(() => window.__signIn()); if (state === 'running' && /CSV/.test(text)) setTimeout(() => controller.abort(), 700); };
        await assert.rejects(bank.collectBankStatement(boundOf(job), job, dir, status, { adapter, batch: 'c8', pollMs: 200, loginTimeoutMs: 20000, downloadTimeoutMs: 30000, extensionMs: 0, signal: controller.signal }), e => e?.name === 'AbortError' || /abort/i.test(String(e?.message)), 'bank:abort-fails-closed');
        assert.equal(adapter.counts.exportCsv, 1); assert.equal(await exists(path.join(dir, 'outbox', 'bank', ACCOUNT._id, job.jobId, 'manifest.json')), false, 'bank:abort-no-manifest');
        const remaining = ownedBrowsers().filter(b => b.connected); assert.equal(remaining.length, 1, 'bank:no-sibling-teardown'); assert.ok(remaining[0].connected && remaining[0].profile === path.join(dir, 'sibling-profile'), 'bank:no-sibling-teardown'); assert.equal(await exists(l.profile), false, 'bank:aborted-profile-removed');
        const s = await stub({ '/api/finance/collector/claim': () => ({ data: { account: { _id: 'a'.repeat(24), jobId: 'card-job', name: 'card' } } }) });
        try { const next = await idx.claimWork(s.config, null); assert.equal(next.account?.jobId, 'card-job', 'bank:card-job-unaffected'); } finally { await s.close(); }
        return 'aborted mid-download: no manifest, bank profile removed, sibling browser still owned, next card claim fine';
      } finally { await closeOwnedBrowsers(); }
    });
    // ── 3. deliberately reintroduced defects ──
    await leg('M1/M3/M5/M6/M7/M8 server mutants flip their named assertion (built chunks, integration under OMF_TEST_BANK_MUTANT)', async () => {
      if (!app || app.code !== 0) throw Error('integration not green');
      const base = path.join(root, '.output'), target = path.join(root, '.bank-mutants'), copy = path.join(target, 'copy'); await removeOwned(target); await mkdir(copy, { recursive: true });
      for (const part of ['scripts', 'shared']) await cp(path.join(root, part), path.join(copy, part), { recursive: true }); await cp(base, path.join(copy, '.output'), { recursive: true, dereference: true });
      const chunkFiles = await files(path.join(copy, '.output/server/chunks')), originals = new Map(); for (const f of chunkFiles) originals.set(f, await readFile(f, 'utf8'));
      const notes = [];
      try {
        for (const m of SERVER_MUTANTS) {
          let hits = 0; for (const [f, text] of originals) { const n = (text.match(m.anchor) || []).length; if (n) { hits += n; await writeFile(f, text.replace(m.anchor, m.replacement)); } }
          if (hits !== 1) throw Error(m.name + ' anchor hits ' + hits);
          const r = await run([path.join(copy, 'scripts/finance-integration.cjs')], { OMF_TEST_BANK_COLLECTION_ONLY: '1', OMF_TEST_BANK_MUTANT: '1' }, 600000, copy);
          await writeFile(path.join(root, '.zoomer-bank-mutant-' + m.name + '.txt'), r.stdout + '\n' + r.stderr);
          const caught = r.code !== 0 && (r.stdout + r.stderr).includes(m.expect); notes.push({ name: m.name, expected: m.expect, anchorHits: hits, code: r.code, caught });
          for (const [f, text] of originals) await writeFile(f, text);
          await writeFile(path.join(root, '.zoomer-bank-mutants.json'), JSON.stringify(notes, null, 2));
          if (!caught) throw Error(m.name + ' did not flip ' + m.expect + ': ' + (r.stdout + r.stderr).slice(-700));
        }
      } finally { await removeOwned(target); }
      return notes.length + '/' + SERVER_MUTANTS.length + ' caught: ' + notes.map(n => n.name + '→' + n.expected).join(', ');
    });
    await leg('M2/M4/g9 collector mutants: ack before response, download-host guard removed, account-label guard removed — each flips its named assertion; a missing marker is a harness fault', async () => {
      need(bankModule, 'collector/bank.mjs'); need(index, 'collector/index.mjs');
      const dir = path.join(temp, 'cm'); await mkdir(dir, { recursive: true }); const adapter = { provider: 'fixture', label: 'Fixture Bank', start: BANK_ORIGIN + '/', hosts: ['bank.fixture.example'], support: 'verified', contract: {} };
      const caught = [];
      // M2
      { const m = await mutantModule(COLLECTOR_MUTANTS['M2-ack-before-response']); try { const mod = await m.load(); const ui = fakeUi(), job = jobOf(); const r = await bankModule.collectBankFromPage(null, null, adapter, boundOf(job), job, dir, async () => {}, { ui, now: ui.now, wait: ui.wait, pollMs: 1000 }); const item = r.items[0];
          const s = await stub({ '*': () => ({ status: 500, data: { statusMessage: 'synthetic failure' } }) }); try { await assert.rejects(mod.upload(s.config, ACCOUNT, item, null, { route: 'bank/upload', base: mod.BANK_BASE, query: mod.bankUploadQuery(item.manifest) })); const acked = JSON.parse(await readFile(path.join(item.directory, 'manifest.json'), 'utf8')); if (acked.acknowledgedAt === undefined) throw new Error('M2 did not flip bank:ack-after-response'); caught.push('M2→bank:ack-after-response'); } finally { await s.close(); } } finally { await m.dispose(); } }
      // M4
      { const m = await mutantModule(COLLECTOR_MUTANTS['M4-host-check-dropped']); try { const mod = await m.load(); const ui = fakeUi({ host: 'cdn.evil.example' }), job = jobOf(); const r = await mod.collectBankFromPage(null, null, adapter, boundOf(job), job, dir, async () => {}, { ui, now: ui.now, wait: ui.wait, pollMs: 1000 }); if (r.items.length !== 1 || r.items[0].manifest.sourceHost !== 'cdn.evil.example') throw new Error('M4 mutant did not accept the foreign host: ' + JSON.stringify(r).slice(0, 200)); caught.push('M4→bank:foreign-download');
          await assert.rejects(mod.collectBankFromPage(null, null, adapter, boundOf(jobOf()), jobOf(), dir, async () => {}, { ui: fakeUi({ accountLabel: 'ほか' }), now: ui.now, wait: ui.wait }), /一致しません/, 'the M4 mutant must keep the account-label guard'); } finally { await m.dispose(); } }
      // g9
      { const m = await mutantModule(COLLECTOR_MUTANTS['g9-account-label-dropped']); try { const mod = await m.load(); const ui = fakeUi({ accountLabel: 'ほかの口座' }), job = jobOf(); const r = await mod.collectBankFromPage(null, null, adapter, boundOf(job), job, dir, async () => {}, { ui, now: ui.now, wait: ui.wait, pollMs: 1000 }); if (r.items.length !== 1) throw new Error('g9 mutant did not accept the mismatched label'); caught.push('g9→bank:account-label');
          await assert.rejects(mod.collectBankFromPage(null, null, adapter, boundOf(jobOf()), jobOf(), dir, async () => {}, { ui: fakeUi({ host: 'cdn.evil.example' }), now: ui.now, wait: ui.wait }), /銀行サイトではありません/, 'the g9 mutant must keep the host guard'); } finally { await m.dispose(); } }
      let invalid = false; try { await mutantModule({ file: 'collector/bank.mjs', guard: 'no-such-marker' }); } catch (error) { invalid = /guard marker missing/.test(error.message); } assert.ok(invalid, 'a missing marker must be a harness fault');
      return caught.join(', ');
    });
    // ── 4. P: the customer package carries and hashes the bank modules; the staged graph resolves and loads without a live bank ──
    await leg('P package closure: five entries staged and hashed, staged index→bank→adapters→shared graph resolves, dependency-free staged modules load; a stage copy missing one entry fails the named package assertion', async () => {
      const stageModule = await import(u('collector/package/stage.mjs')), into = path.join(temp, 'staged');
      const manifest = await packageClosure(stageModule, into);
      for (const entry of ['collector/banks/rakuten.mjs', 'collector/banks/paypay.mjs', 'collector/banks/resona.mjs', 'collector/banks/ikeda.mjs']) { const mod = await import(pathToFileURL(path.join(into, entry)).href); assert.equal(mod.default.support, 'contract-pending', entry + ' support'); assert.equal(mod.default.contract, null); assert.ok(Array.isArray(mod.default.hosts) && mod.default.hosts.length); assert.match(mod.default.start, /^https:\/\//); }
      const shared = await import(pathToFileURL(path.join(into, 'shared', 'finance-payment-match.mjs')).href); assert.deepEqual(shared.BANK_PROVIDERS.map(p => p[0]), ['rakuten', 'paypay', 'resona', 'ikeda'], 'package:shared-providers'); assert.ok(shared.BANK_PROVIDERS.every(p => p[2] === 'contract-pending'), 'no provider is verified by this build');
      const stagedBank = await import(pathToFileURL(path.join(into, 'collector', 'bank.mjs')).href); assert.equal(typeof stagedBank.collectBankStatement, 'function'); assert.equal(typeof stagedBank.observeBankPortal, 'function'); assert.equal(typeof stagedBank.adapterFor, 'function'); assert.equal(stagedBank.adapterFor('rakuten').label, '楽天銀行'); assert.equal(stagedBank.adapterFor('nope'), null);
      await assert.rejects(stagedBank.adapterFor('rakuten').ui({}, {}).openStatements(), /contract-pending/, 'routine adapter methods throw contract-pending');
      // the mutant: a stage copy whose allowlist lacks collector/bank.mjs must fail the NAMED package assertion, not harness setup
      const source = path.join(root, 'collector/package/stage.mjs'), text = await readFile(source, 'utf8'), hits = (text.match(/'bank',/g) || []).length; if (hits !== 1) throw new Error('stage.mjs allowlist anchor hits ' + hits);
      const mutant = path.join(path.dirname(source), `stage.mutant-${process.pid}.mjs`); await writeFile(mutant, text.replace(/'bank',/, ''), { flag: 'wx' });
      try { const mod = await import(pathToFileURL(mutant).href); let failure = null; try { await packageClosure(mod, path.join(temp, 'staged-mutant')); } catch (e) { failure = e; } if (!failure || !/package:bank-modules-staged missing collector\/bank\.mjs/.test(failure.message)) throw new Error('the stage mutant did not fail the named assertion: ' + (failure?.message || 'passed')); } finally { await unlink(mutant).catch(() => {}); }
      return Object.keys(manifest.files).length + ' files staged; 5 bank entries present with repo hashes; graph resolves; adapters/shared/bank.mjs load from the staged tree; mutant caught by package:bank-modules-staged';
    });
    // ── 5. R-lite: the released unit/Vue checks of the shared module and importer stay green ──
    await leg('R unit/Vue checks (scripts/finance-payment-match.test.mjs)', async () => { const r = await run(['--test', 'scripts/finance-payment-match.test.mjs']); await writeFile(path.join(root, '.zoomer-bank-unit.txt'), r.stdout + r.stderr); if (r.code !== 0) throw Error((r.stdout + r.stderr).slice(-1600)); return 'green'; });
  } finally { headless.deregister(); await rm(temp, { recursive: true, force: true }).catch(() => {}); }
  return { pass, databaseCoverage: { executed: !!app && app.code === 0, ownedProcess: !!app && app.code === 0 }, message: `${pass ? 'green' : 'RED'} in ${Math.round((Date.now() - started) / 1000)}s\n` + lines.join('\n') };
} };
