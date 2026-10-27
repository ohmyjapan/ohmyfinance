// collector/test/paypay-routine.test.mjs — routine PayPay銀行 標準 retrieval (plan omf-paypay-routine-20261022 Phase C): the observed
// page states, the statement steps, the routine login exits of bank.mjs ensureBankLogin and the cleanup after sign-in, end to end
// through bank.collectBankFromPage on an owned HEADLESS Chrome. A fake portal is served by request interception on every page of that
// Chrome (popups included) at https://login.paypay-bank.co.jp; host resolution is refused for everything else, so no bank or other
// site can be reached. The fake pages follow the value-free observations only (titles, control texts, the six named selects, an
// image/button 照会, a CSV link opening a 'ダウンロード中' tab, ログアウト); their DOM is invented for the test and proves nothing
// about the real portal. Fictional branch/account/password and statement values only.
// Under OMF_TEST_PAYPAY_MODULE / OMF_TEST_BANK_MODULE the named mutant copies are tested instead (fixture omf-paypay-routine.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import puppeteer from 'rebrowser-puppeteer-core';

const moduleOf = (env, rel) => process.env[env] ? pathToFileURL(process.env[env]).href : new URL(rel, import.meta.url).href;
const paypay = await import(moduleOf('OMF_TEST_PAYPAY_MODULE', '../banks/paypay.mjs'));
const bank = await import(moduleOf('OMF_TEST_BANK_MODULE', '../bank.mjs'));
const { findChrome, LAUNCH_ARGS } = await import('../browser.mjs');

const ORIGIN = 'https://login.paypay-bank.co.jp', ENTRY = '/wctx/1D1DFxFDg.do', ACTION = '/wctx/NBCW2101.do';
const SECRET = Object.freeze({ branch: '012', account: '0012345', password: ' Fictional Pw/1 ' });
const OWNER = 'd4d4d4d4d4d4d4d4d4d4d4d4', ACCOUNT = 'b1b1b1b1b1b1b1b1b1b1b1b1', OMF = 'https://omf.example';
const NAMES = ['ShokaiStartDateNenIn', 'ShokaiStartDateTsukiIn', 'ShokaiStartDateHiIn', 'ShokaiEndDateNenIn', 'ShokaiEndDateTsukiIn', 'ShokaiEndDateHiIn'];
const COVERAGE = Object.freeze({ from: '2025-11-01', to: '2026-10-20' });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = p => access(p).then(() => true, () => false);
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-paypay-routine-test-'));
const profiles = [];
test.after(async () => {
  for (const profile of profiles) if (!(await released(profile))) throw new Error('owned Chrome still holds ' + path.basename(profile) + ' at cleanup');
  if (path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(temp, { recursive: true, force: true });
});

// ── the fake portal ──
const STYLE = '<style>a,button,input,select{display:inline-block;margin:4px;padding:4px}</style>';
const doc = (title, body) => `<!doctype html><html lang="ja"><meta charset="utf-8"><title>${title}</title>${STYLE}<body>${body}</body></html>`;
const loginDoc = ({ heading = '', error = '' } = {}) => doc('ログイン - PayPay銀行', `${heading ? `<h1>${heading}</h1><a href="${ACTION}?p=overwrite">上書きログイン</a>` : ''}${error ? `<p>${error}</p>` : ''}
<form method="post" action="NBCW2101.do" name="HOST" onSubmit="return g(document.HOST)" target="_self"><input type="hidden" name="T" value="${randomUUID()}">
店番号 <input type="tel" name="TenNo" id="idTenNo" maxlength="3"> 口座番号 <input type="tel" name="KozaNo" id="idKozaNo" maxlength="7"> パスワード <input type="password" name="Pw" id="idPw" maxlength="32"> <input type="submit" name="login" value="ログイン"></form>
<a href="/balogin_L.html">BA-PLUS専用ログイン</a><script>function g(){return true}</script>`);
const welcomeDoc = s => doc('Welcome Page - PayPay銀行', `<a href="${ACTION}?p=balance">各種残高</a> <a href="${ACTION}?p=transfer">振込明細照会</a> ${`<a href="${ACTION}?p=statements">普通預金取引明細照会</a> `.repeat(s.statementsLinks)}<a href="${ACTION}?p=logout">ログアウト</a>`);
const noticeDoc = () => doc('お知らせ - PayPay銀行', `<p>重要なお知らせ</p><a href="${ACTION}?p=next">次へ</a> <a href="${ACTION}?p=logout">ログアウト</a>`);
function statementDoc(s, period) {
  const [fy, fm, fd] = period.from.split('-').map(Number), [ty, tm, td] = period.to.split('-').map(Number), values = [fy, fm, fd, ty, tm, td];
  const select = (name, i) => { if (s.textInput && i === 0) return `<input type="text" name="${name}" value="${values[i]}">`; const [lo, hi, unit] = [[2016, 2026, '年'], [1, 12, '月'], [1, 31, '日']][i % 3]; return `<select name="${name}">${Array.from({ length: hi - lo + 1 }, (_, k) => lo + k).map(n => `<option value="${n}"${n === values[i] ? ' selected' : ''}>${n}${unit}</option>`).join('')}</select>`; };
  const query = { image: '<input type="image" alt="照会" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" style="width:40px;height:20px" onclick="q();return false;">', button: '<input type="button" value="照会" onclick="q()">', none: '' }[s.query] ?? '';
  return doc('普通預金取引明細照会 - PayPay銀行', `<div id="account">普通 カクウ商事</div><a href="#">表示順</a> <a href="#" onclick="document.getElementById('panel').style.display='block';return false;">期間選択</a> <a href="${ACTION}?p=pdf">PDF</a> ${'<a href="#" onclick="csv();return false;">CSV</a> '.repeat(s.csvLinks)}<a href="#">インボイス</a> <a href="${ACTION}?p=welcome">Welcome Page</a> <a href="${ACTION}?p=${s.logout === 'abort' ? 'logout-broken' : 'logout'}">ログアウト</a>
<div id="panel" style="display:${s.panelSticks && period.queried ? 'block' : 'none'}">${s.hiddenDuplicates ? NAMES.map(select).map(h => h.replace('<select ', '<select style="display:none" ')).join(' ') + ' ' : ''}${NAMES.map(select).join(' ')} ${s.query === 'two' ? query.replace('two', '') + ([1, 2].map(() => '<input type="image" alt="照会" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" style="width:40px;height:20px" onclick="q();return false;">').join(' ')) : query} <a href="#" onclick="document.getElementById('panel').style.display='none';return false;">閉じる</a></div>
<p>${period.queried ? '照会結果 ' + period.from + '〜' + period.to : '最近の取引'}</p>
<script>const N=${JSON.stringify(NAMES)},from=${JSON.stringify(period.from)},to=${JSON.stringify(period.to)};
const v=n=>{const e=[...document.getElementsByName(n)].find(x=>x.getClientRects().length);return String(e.value).padStart(2,'0')};
function q(){location.href='${ACTION}?p=result&from='+v(N[0])+'-'+v(N[1])+'-'+v(N[2])+'&to='+v(N[3])+'-'+v(N[4])+'-'+v(N[5]);}
${s.revert ? `for(const n of N){const e=document.getElementsByName(n)[0];const o=e.value;e.addEventListener('change',()=>setTimeout(()=>{e.value=o},0));}` : ''}
function csv(){${s.csvDialog ? "if(!confirm('CSVファイルを出力しますか'))return;" : ''}const w=window.open('about:blank','_blank');w.document.title='ダウンロード中 - PayPay銀行';setTimeout(()=>{w.location.href=${s.foreignCsv ? "'https://cdn.paypay-bank.example/meisai.csv'" : `location.origin+'${ACTION}?p=csv&from='+from+'&to='+to`};},800);}</script>`);
}
const CSV_HEAD = '操作日(年),操作日(月),操作日(日),操作時刻(時),操作時刻(分),操作時刻(秒),取引順番号,摘要,お支払金額,お預り金額,残高,メモ';
const csvBytes = (from, to) => Buffer.from([CSV_HEAD, `${from.slice(0, 4)},${Number(from.slice(5, 7))},${Number(from.slice(8))},9,00,00,1,振込 カクウ,,50000,150000,`].join('\r\n') + '\r\n');
function bankSite(options = {}) {
  const s = { mode: 'ok', statementsLinks: 1, query: 'image', csvLinks: 1, logout: 'ok', ...options };
  const stats = { posts: 0, requests: [], foreign: [], downloads: [], queried: [] }, count = p => stats.requests.filter(r => r === p).length;
  let period = { from: '2026-09-21', to: '2026-10-20', queried: false };
  const respond = request => {
    let url; try { url = new URL(request.url()); } catch { return request.abort(); }
    const html = body => request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body });
    // the inline image of the image-type 照会 (a data: URL, never a network request) is drawn locally and not counted as foreign
    if (url.protocol === 'data:') return request.continue();
    if (url.origin !== ORIGIN) {
      stats.foreign.push(url.origin);
      if (s.foreignCsv && url.origin === 'https://cdn.paypay-bank.example') { stats.downloads.push({ host: url.hostname }); return request.respond({ status: 200, contentType: 'text/csv', headers: { 'Content-Disposition': 'attachment; filename="meisai.csv"' }, body: csvBytes(period.from, period.to) }); }
      return request.abort();
    }
    const p = url.searchParams.get('p') || (url.pathname === ENTRY ? 'entry' : request.method() === 'POST' ? 'post' : 'other'); stats.requests.push(p);
    if (p === 'entry') return html(loginDoc());
    if (p === 'post') { stats.posts++; if (s.mode === 'reject') return html(loginDoc({ error: '店番号・口座番号またはパスワードが正しくありません' })); if (s.mode === 'in-use') return html(loginDoc({ heading: '上書きログイン（ログイン中です）' })); if (s.mode === 'notice') return html(noticeDoc()); return html(welcomeDoc(s)); }
    if (p === 'welcome' || p === 'next') return html(welcomeDoc(s));
    if (p === 'statements') { period = { ...period, queried: false }; return html(statementDoc(s, period)); }
    if (p === 'result') { stats.queried.push([url.searchParams.get('from'), url.searchParams.get('to')]); period = { from: url.searchParams.get('from'), to: url.searchParams.get('to'), queried: true }; return html(statementDoc(s, period)); }
    if (p === 'csv') { stats.downloads.push({ host: url.hostname, from: url.searchParams.get('from'), to: url.searchParams.get('to') }); return request.respond({ status: 200, contentType: 'text/csv', headers: { 'Content-Disposition': 'attachment; filename="meisai.csv"' }, body: csvBytes(url.searchParams.get('from'), url.searchParams.get('to')) }); }
    if (p === 'logout') return html(loginDoc());
    if (p === 'logout-broken') return request.abort();
    // a tab of the bank's origin already showing the download title (an older or a later tab that this job did not open)
    if (p === 'downloading') return html(doc('ダウンロード中 - PayPay銀行', '<p>another tab</p>'));
    return html(doc('PayPay銀行', '<p>other</p>'));
  };
  return { s, stats, count, respond };
}
// An owned headless Chrome on its own profile, host resolution refused, every page (popups included) intercepted by the fake bank.
// Fixture-owned Chrome start-up (plan omf-bank-hourly-balances-20261027 build-06: under a saturated machine the launch or the first page's
// CDP setup timed out — Target.setDiscoverTargets / Network.enable — before any fictional bank page ran). The start-up (launch and the
// first intercepted page) is retried ONCE, logged, only after the failed Chrome released its profile and before any test step; a profile
// is removed only once its Chrome left. No timeout is raised and no business assertion is touched.
async function owned(site, fn) {
  for (let attempt = 1; ; attempt++) {
    const profile = path.join(temp, 'profile-' + randomUUID().slice(0, 8)), t = Date.now(); profiles.push(profile);
    let browser = null, started = null;
    // No implicit startup tab (the production quiet browser's options, collector/browser.mjs): the default about:blank target was the one
    // whose Network.enable timed out while the pages were listed (parent PARENT-STARTUP-TARGET-FINDING.json); ownedStart opens it explicitly.
    try { browser = await puppeteer.launch({ executablePath: findChrome(), pipe: true, headless: true, userDataDir: profile, defaultViewport: null, protocolTimeout: 30000, ignoreDefaultArgs: ['about:blank'], waitForInitialPage: false, args: [...LAUNCH_ARGS, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--no-startup-window'] }); started = await ownedStart(site, browser); }
    catch (error) {
      if (browser) await closeOwned(browser); const free = await released(profile);
      console.log('# owned Chrome start-up attempt ' + attempt + ' failed after ' + (Date.now() - t) + ' ms (' + (error?.name || 'Error') + ': ' + String(error?.message || '').slice(0, 100) + '); its profile ' + (free ? 'released' : 'STILL HELD'));
      if (attempt >= 2 || !free) throw error; continue;
    }
    if (attempt > 1) console.log('# owned Chrome ready on attempt ' + attempt);
    try { return await fn({ page: started.page, browser, dialogs: started.dialogs, open: started.open }); }
    finally { await closeOwned(browser); }
  }
}
const execute = (file, args) => new Promise(resolve => execFile(file, args, { windowsHide: true, timeout: 20000 }, (error, stdout) => resolve(error ? null : String(stdout))));
async function released(profile, ms = 30000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { const out = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ForEach-Object { $_.CommandLine }"]); if (out !== null && !out.split(/\r?\n/).some(l => l.includes(profile))) return true; await new Promise(r => setTimeout(r, 500)); }
  return false;
}
async function closeOwned(browser) {
  const child = browser.process();
  await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 10000))]);
  if (child && child.exitCode === null && child.signalCode === null) { try { child.kill(); } catch { /* gone */ } await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 10000))]); }
}
// The original page setup of owned(): interception of every page (popups included) by the fake bank and the dialog record.
async function ownedStart(site, browser) {
  const dialogs = [];
  const attach = async page => { await page.setRequestInterception(true); page.on('request', r => site.respond(r)); const cdp = await page.createCDPSession(); await cdp.send('Page.enable'); cdp.on('Page.javascriptDialogOpening', e => dialogs.push({ type: e.type, message: e.message, handled: false, cdp })); cdp.on('Page.javascriptDialogClosed', () => { const d = dialogs.findLast(x => !x.handled); if (d) d.closedByCollector = true; }); };
  // one interception per page, awaited by whoever opens it first (a page opened by the test navigates only once it is intercepted)
  const ready = page => (page.__attached ??= attach(page));
  browser.on('targetcreated', async target => { if (target.type() !== 'page') return; try { const page = await target.page(); if (page) await ready(page); } catch { /* closed */ } });
  const open = async () => { const page = await browser.newPage(); await ready(page); return page; };
  await open(); // explicitly keep the original unrelated blank tab, fully initialized (the cases count it among the pages left open)
  return { page: await open(), dialogs, open };
}
// A fictional saved login with the interface bank.mjs expects, counting every call.
function savedLogin(state = 'ready') {
  const calls = { state: 0, open: 0, rejected: [], accepted: 0 }; let current = state;
  return { calls, async state() { calls.state++; return current; }, async open() { calls.open++; return { ...SECRET }; }, async rejected(kind = 'uncertain') { /* the real index.mjs bankLoginFor default */ calls.rejected.push(kind); current = kind === 'refused' ? 'refused' : 'blocked'; }, async accepted() { calls.accepted++; current = 'ready'; }, get current() { return current; } };
}
const snapshotOf = (extra = {}) => ({ templateId: null, templateRevision: 0, headers: [], mapping: {}, amountSign: 'outflow-positive', transactionIdConfirmed: false, parserVersion: 'bank-template-1', currency: 'JPY', provider: 'paypay', accountLabel: null, variant: 'standard', coverage: { ...COVERAGE }, interpretation: 'unmapped', ...extra });
const jobOf = (kind = 'retrieve', extra = {}) => { const snapshot = snapshotOf(extra); return { jobId: randomUUID(), kind, snapshot, snapshotHash: sha256(JSON.stringify(snapshot)), provider: 'paypay' }; };
const boundOf = job => ({ bankAccountId: ACCOUNT, ownerId: OWNER, origin: OMF, jobId: job.jobId, snapshotHash: job.snapshotHash, provider: 'paypay' });
// The routine adapter with the test's settle/step windows (raised toward the production defaults so a loaded machine does not end a step early) (the ui of the shipped adapter, same object otherwise).
const adapter = (o = {}) => ({ ...paypay.standard, ui(page, browser, snapshot) { return paypay.routineUi(page, browser, this, snapshot, { settleMs: 20000, stableMs: 800, stepMs: 30000, finishMs: 10000, ...o }); } });
// `others`: before the job a tab of the bank's origin already titled ダウンロード中 is open (older), and one more such tab is opened while
// the statement is being saved (newer, not opened by the job's page). Every page except the tab the job's CSV press opened must survive.
async function collect(site, { job = jobOf(), login = savedLogin(), person = null, others = false, ...rest } = {}) {
  const root = path.join(temp, 'root-' + randomUUID().slice(0, 8)); await mkdir(root, { recursive: true }); const statuses = [];
  return owned(site, async ({ page, browser, dialogs, open }) => {
    let result = null, error = null, newer = null; const opened = [];
    const kept = [...await browser.pages()]; // the launch's initial blank tab and the job's page
    if (others) { const older = await open(); await older.goto(ORIGIN + ACTION + '?p=downloading', { waitUntil: 'domcontentloaded' }); kept.push(older); }
    browser.on('targetcreated', target => { if (target.type() === 'page' && target.opener() === page.target()) opened.push(target); });
    const status = async (state, text) => { statuses.push([state, text]); if (state === 'verification_required' && person) setTimeout(() => person(page).catch(() => {}), 300); if (others && text === '明細を保存' && !newer) { newer = await open(); await newer.goto(ORIGIN + ACTION + '?p=downloading', { waitUntil: 'domcontentloaded' }); kept.push(newer); } };
    try { result = await bank.collectBankFromPage(page, browser, adapter(), boundOf(job), job, root, status, { login, pollMs: 300, loginTimeoutMs: 45000, downloadTimeoutMs: 45000, extensionMs: 0, ...rest }); } catch (e) { error = e; }
    const remaining = await browser.pages(), pages = remaining.length, closedBeforeTest = dialogs.map(d => d.closedByCollector === true);
    const preserved = kept.every(p => remaining.includes(p)), ownTabsLeft = opened.filter(t => remaining.some(p => p.target() === t)).length;
    for (const d of dialogs) await d.cdp.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
    return { result, error, statuses, login, root, job, pages, kept: kept.length, preserved, ownTabsOpened: opened.length, ownTabsLeft, dialogs, closedBeforeTest, jobDir: path.join(root, 'outbox', 'bank', ACCOUNT, job.jobId) };
  });
}
const asked = r => r.statuses.filter(([s]) => s === 'verification_required').map(([, t]) => t);
const noSecret = (...values) => { const text = JSON.stringify(values); for (const v of [SECRET.account, SECRET.password, SECRET.password.trim()]) assert.ok(!text.includes(v), 'paypay-routine:no-secret'); };

test('page state (pure): only the exact Welcome/statement titles with their observed controls on the official top document count; ログアウト alone, a similar title, a frame or another origin do not', () => {
  const c = paypay.STANDARD_PAGES, read = o => ({ origin: ORIGIN, top: true, title: '', controls: [], password: false, ...o });
  assert.equal(paypay.classifyRoutinePage(read({ title: c.welcome.title, controls: ['各種残高', 'ログアウト', '普通預金取引明細照会'] })), 'authenticated', 'paypay-routine:welcome-authenticated');
  assert.equal(paypay.classifyRoutinePage(read({ title: 'お知らせ - PayPay銀行', controls: ['次へ', 'ログアウト', '普通預金取引明細照会'] })), 'unknown', 'paypay-routine:notice-page-not-authenticated');
  assert.equal(paypay.classifyRoutinePage(read({ title: c.welcome.title, controls: ['ログアウト'] })), 'unknown', 'paypay-routine:welcome-needs-both-controls');
  assert.equal(paypay.classifyRoutinePage(read({ title: 'ログイン - PayPay銀行', controls: ['ログイン', 'ログアウト'], password: true })), 'login', 'paypay-routine:refusal-page-not-authenticated');
  assert.equal(paypay.classifyRoutinePage(read({ title: 'ログイン - PayPay銀行', controls: ['ログアウト', '普通預金取引明細照会'] })), 'unknown', 'paypay-routine:refusal-page-not-authenticated (no password, same pathname)');
  assert.equal(paypay.classifyRoutinePage(read({ title: c.welcome.title, controls: ['ログアウト', '普通預金取引明細照会'], top: false })), 'unknown', 'paypay-routine:frame-not-authenticated');
  assert.equal(paypay.classifyRoutinePage(read({ origin: 'https://www.paypay-bank.co.jp', title: c.welcome.title, controls: ['ログアウト', '普通預金取引明細照会'] })), 'unknown', 'paypay-routine:other-origin-not-authenticated');
  assert.equal(paypay.classifyRoutinePage(read({ title: c.statements.title, controls: ['期間選択', 'CSV', 'ログアウト'] })), 'export_ready', 'paypay-routine:statements-export-ready');
  assert.equal(paypay.classifyRoutinePage(read({ title: c.statements.title, controls: ['期間選択', 'CSV', 'ログアウト', '閉じる'] })), 'statements', 'paypay-routine:panel-open-not-ready');
  assert.throws(() => paypay.routinePeriodValues(null), e => e.code === 'period-required'); assert.throws(() => paypay.routinePeriodValues({ from: '2026-10-02', to: '2026-10-01' }), e => e.code === 'period-required');
  assert.deepEqual(paypay.routinePeriodValues(COVERAGE), [2025, 11, 1, 2026, 10, 20]);
});

test('happy path: one native submission reaches the Welcome page directly (accepted once), the statement opens, the six selects are set and read back, 照会 once, CSV once from the bank host through its download tab, the tab is closed and ログアウト pressed once', { timeout: 400000 }, async () => {
  for (const query of ['image', 'button']) {
    const site = bankSite({ query }), r = await collect(site, { others: true });
    assert.deepEqual([site.count('transfer'), site.count('pdf'), site.count('balance'), site.count('overwrite')], [0, 0, 0, 0], 'paypay-routine:transfer-link-never-clicked');
    assert.equal(r.error, null, 'paypay-routine:happy-path ' + query + ' ' + String(r.error?.stack || r.error));
    assert.equal(r.result.failed, null, 'paypay-routine:happy-path ' + query); assert.equal(r.result.items.length, 1, 'paypay-routine:happy-path one file');
    const m = r.result.items[0].manifest; assert.deepEqual([m.jobId, m.snapshotHash, m.sourceHost, m.period, m.labelChecked], [r.job.jobId, r.job.snapshotHash, 'login.paypay-bank.co.jp', '2025-11-01〜2026-10-20', false], 'paypay-routine:manifest-bound');
    assert.equal(sha256(await readFile(path.join(r.jobDir, m.filename))), m.sha256);
    assert.equal(site.count('logout'), 1, 'paypay-routine:logout-after-success ' + JSON.stringify(site.stats.requests));
    assert.deepEqual([site.stats.posts, site.count('statements'), site.count('result'), site.count('csv'), site.count('logout')], [1, 1, 1, 1, 1], 'paypay-routine:happy-path once each ' + JSON.stringify(site.stats.requests));
    assert.deepEqual(site.stats.downloads.map(d => [d.from, d.to]), [['2025-11-01', '2026-10-20']], 'paypay-routine:query-before-export (the exported period is the requested one)');
    assert.equal(r.login.calls.accepted, 1, 'paypay-routine:direct-accepted'); assert.deepEqual(r.login.calls.rejected, ['uncertain'], 'paypay-routine:pending-before-submit'); assert.equal(r.login.calls.open, 1);
    assert.equal(asked(r).length, 0, 'paypay-routine:no-attention'); assert.deepEqual([r.ownTabsOpened, r.ownTabsLeft], [1, 0], 'paypay-routine:download-tab-closed (the tab its CSV press opened)');
    assert.deepEqual([r.preserved, r.pages, r.kept], [true, 4, 4], 'paypay-routine:other-pages-preserved (initial blank, job page, older and newer same-title tabs)'); assert.equal(site.stats.foreign.length, 0, 'paypay-routine:no-foreign-request ' + JSON.stringify(site.stats.foreign));
    noSecret(r.statuses, r.result);
  }
});

// Build-resume-03 (parent finding PARENT-PERIOD-FINDING.md): a hidden duplicate of each date field placed before the visible one must never
// be the field that is set or read back; the bank's 照会 uses the visible fields, so the query and the export carry the frozen period.
test('hidden duplicate date fields before the visible ones: only the visible fields are set, read back and queried; the export carries the frozen period', { timeout: 300000 }, async () => {
  const site = bankSite({ hiddenDuplicates: true }), r = await collect(site);
  assert.deepEqual(site.stats.queried, [[COVERAGE.from, COVERAGE.to]], 'paypay-routine:hidden-duplicates-visible-query ' + JSON.stringify({ queried: site.stats.queried, error: String(r.error?.message || '') }));
  assert.equal(r.error, null, String(r.error?.stack || r.error)); assert.equal(r.result.items.length, 1, 'paypay-routine:hidden-duplicates-export');
  assert.deepEqual(site.stats.downloads.map(d => [d.from, d.to]), [[COVERAGE.from, COVERAGE.to]], 'paypay-routine:hidden-duplicates-export-period');
  assert.equal(r.result.items[0].manifest.period, COVERAGE.from + '〜' + COVERAGE.to);
});

test('session in use: one submission, 上書きログイン never pressed, the marker stays uncertain, no export, the job fails with the in-use explanation', { timeout: 300000 }, async () => {
  const site = bankSite({ mode: 'in-use' }), r = await collect(site);
  assert.equal(r.error, null, String(r.error)); assert.equal(r.result.items.length, 0);
  assert.match(String(r.result.failed), /ログイン中だった/, 'paypay-routine:in-use-not-refusal'); assert.doesNotMatch(String(r.result.failed), /受け付けませんでした/, 'paypay-routine:in-use-not-refusal');
  assert.deepEqual([site.stats.posts, site.count('overwrite'), site.count('csv')], [1, 0, 0], 'paypay-routine:no-overwrite'); assert.deepEqual(r.login.calls.rejected, ['uncertain'], 'paypay-routine:in-use-not-refusal (marker stays uncertain)'); assert.equal(r.login.calls.accepted, 0);
  assert.match(asked(r)[0] || '', /上書きログイン/, 'paypay-routine:in-use-explained');
});

test('refusal: the exact form again → marker refused with the PayPay wording, no export', { timeout: 300000 }, async () => {
  const site = bankSite({ mode: 'reject' }), r = await collect(site);
  assert.equal(r.error, null, String(r.error)); assert.equal(r.result.items.length, 0); assert.deepEqual(r.login.calls.rejected, ['uncertain', 'refused'], 'paypay-routine:refused-kind');
  assert.match(String(r.result.failed), /店番号・口座番号・パスワード/, 'paypay-routine:refused-wording'); assert.equal(site.count('csv'), 0); assert.equal(r.login.calls.accepted, 0);
});

test('an unknown page after the submission (a notice): the person is asked, nothing is clicked there, nothing accepted, the job fails unconfirmed; when the person continues to the Welcome page the labelled export runs, still without acceptance', { timeout: 400000 }, async () => {
  const site = bankSite({ mode: 'notice' }), r = await collect(site);
  assert.equal(r.error, null, String(r.error)); assert.match(String(r.result.failed), /確認できませんでした/, 'paypay-routine:notice-unconfirmed');
  assert.deepEqual([site.count('next'), site.count('csv'), site.count('logout'), r.login.calls.accepted], [0, 0, 0, 0], 'paypay-routine:notice-nothing-clicked'); assert.deepEqual(r.login.calls.rejected, ['uncertain']);
  // the person continues (次へ) after being asked: the Welcome page is reached, but not by this job's submission alone (plan D1)
  const next = async page => { await page.evaluate(() => [...document.querySelectorAll('a')].find(a => a.textContent.trim() === '次へ').click()); };
  const cont = bankSite({ mode: 'notice' }), r2 = await collect(cont, { person: next, job: jobOf('retrieve', { accountLabel: 'カクウ商事' }) });
  assert.equal(r2.error, null, String(r2.error)); assert.deepEqual([cont.stats.posts, cont.count('next'), r2.result.items.length], [1, 1, 1], 'paypay-routine:notice-person-continued');
  assert.equal(r2.login.calls.accepted, 0, 'paypay-routine:manual-sign-in-not-accepted (after attention)'); assert.deepEqual(r2.login.calls.rejected, ['uncertain']); assert.equal(r2.result.items[0].manifest.labelChecked, true);
});

test('saved login blocked → the person signs in: authenticated but not direct — not accepted; without a label no export (logout still pressed); with a matching label the export runs and is label-checked; a different label stops it', { timeout: 500000 }, async () => {
  const person = async page => { await page.evaluate(s => { document.getElementById('idTenNo').value = s.branch; document.getElementById('idKozaNo').value = s.account; document.getElementById('idPw').value = s.password; document.querySelector('input[name="login"]').click(); }, SECRET); };
  const site = bankSite(), r = await collect(site, { login: savedLogin('blocked'), person });
  assert.equal(r.error?.code, 'identity-unconfirmed', 'paypay-routine:manual-no-label-no-export ' + String(r.error)); assert.equal(r.login.calls.accepted, 0, 'paypay-routine:manual-sign-in-not-accepted'); assert.equal(r.login.calls.open, 0);
  assert.deepEqual([site.count('csv'), site.count('logout')], [0, 1], 'paypay-routine:manual-no-label-no-export (logout after the failure)');
  const labelled = bankSite(), ok = await collect(labelled, { login: savedLogin('blocked'), person, job: jobOf('retrieve', { accountLabel: 'カクウ商事' }) });
  assert.equal(ok.error, null, String(ok.error)); assert.equal(ok.result.items[0]?.manifest.labelChecked, true, 'paypay-routine:manual-with-label'); assert.equal(ok.login.calls.accepted, 0, 'paypay-routine:manual-sign-in-not-accepted');
  const other = bankSite(), wrong = await collect(other, { login: savedLogin('blocked'), person, job: jobOf('retrieve', { accountLabel: '別の会社' }) });
  assert.match(String(wrong.error?.message), /一致しません/, 'paypay-routine:label-mismatch'); assert.equal(other.count('csv'), 0);
});

test('fail closed before any CSV: two statement links, a year outside the bank\'s choices, a reverting select, a text field instead of a select, two or no 照会, a panel that stays open, two CSV links', { timeout: 900000 }, async () => {
  for (const [label, options, job, code] of [
    ['two statement links', { statementsLinks: 2 }, null, 'statements-unidentified'],
    ['year absent', {}, jobOf('retrieve', { coverage: { from: '2015-01-01', to: '2026-10-20' } }), 'period-mismatch'],
    ['reverting select', { revert: true }, null, 'period-mismatch'],
    ['text field', { textInput: true }, null, 'period-unidentified'],
    ['two 照会', { query: 'two' }, null, 'period-query'],
    ['no 照会', { query: 'none' }, null, 'period-query'],
    ['panel stays open', { panelSticks: true }, null, 'period-query'],
    ['two CSV links', { csvLinks: 2 }, null, 'export-unidentified']]) {
    const site = bankSite(options), r = await collect(site, job ? { job } : {});
    assert.equal(r.error?.code, code, 'paypay-routine:fail-closed ' + label + ' ' + String(r.error?.message || JSON.stringify(r.result)));
    assert.equal(site.count('csv'), 0, 'paypay-routine:fail-closed no CSV ' + label); assert.equal(site.count('logout'), 1, 'paypay-routine:logout-after-period-mismatch ' + label);
    if (label === 'year absent' || label === 'reverting select') assert.equal(site.count('result'), 0, 'paypay-routine:reverting-select-held / year-absent-held (no 照会) ' + label);
    if (label === 'year absent') assert.match(String(r.error?.message), /選べません/, 'paypay-routine:year-absent-held (explained as a date the bank does not offer)');
    if (label === 'two 照会') assert.equal(site.count('result'), 0, 'paypay-routine:ambiguous-query-held');
  }
});

test('a confirm dialog on CSV is never accepted (the person decides); the download times out; no logout under an open dialog', { timeout: 300000 }, async () => {
  const site = bankSite({ csvDialog: true }), r = await collect(site);
  assert.equal(r.error, null, String(r.error)); assert.match(String(r.result.failed), /ダウンロードが完了しませんでした/, 'paypay-routine:dialog-never-accepted');
  assert.equal(r.dialogs.length, 1, 'paypay-routine:dialog-opened'); assert.deepEqual(r.closedBeforeTest, [false], 'paypay-routine:dialog-never-accepted (still open when the job ended)'); assert.equal(site.count('csv'), 0);
  assert.ok(r.statuses.some(([s]) => s === 'verification_required'), 'paypay-routine:dialog-asks-person'); assert.equal(site.count('logout'), 0, 'paypay-routine:no-logout-under-dialog');
});

test('a download that does not come from the bank host is refused and not kept', { timeout: 300000 }, async () => {
  const site = bankSite({ foreignCsv: true }), r = await collect(site);
  assert.match(String(r.error?.message), /銀行サイトではありません/, 'paypay-routine:foreign-download'); assert.equal(await exists(path.join(r.jobDir, 'manifest.json')), false);
});

test('a failing ログアウト leaves the result unchanged', { timeout: 300000 }, async () => {
  const site = bankSite({ logout: 'abort' }), r = await collect(site);
  assert.equal(r.error, null, String(r.error)); assert.equal(r.result.items.length, 1, 'paypay-routine:logout-failure-harmless'); assert.equal(site.count('logout-broken'), 1);
});

test('the export step refuses to run without this job\'s 照会', { timeout: 300000 }, async () => {
  const site = bankSite();
  await owned(site, async ({ page, browser }) => {
    const ui = adapter().ui(page, browser, snapshotOf()); await ui.open(); await page.goto(ORIGIN + ACTION + '?p=statements', { waitUntil: 'domcontentloaded' });
    assert.equal((await ui.state()).kind, 'export_ready'); await assert.rejects(ui.exportCsv(), e => e.code === 'period-query', 'paypay-routine:no-export-without-query'); assert.equal(site.count('csv'), 0);
  });
});

test('an observe job queued before (historical guided snapshot) on the same adapter: one submission reaching Welcome is still only "submitted" — no acceptance, the marker stays uncertain (P1)', { timeout: 300000 }, async () => {
  const site = bankSite(), job = jobOf('observe', { coverage: null }), login = savedLogin(), root = path.join(temp, 'obs-' + randomUUID().slice(0, 8)); await mkdir(root, { recursive: true });
  const r = await owned(site, ({ page, browser }) => bank.observeFromPage(page, browser, adapter(), boundOf(job), job, root, async () => {}, { login, pollMs: 300, timeoutMs: 4000 }));
  assert.equal(site.stats.posts, 1); assert.equal(login.calls.accepted, 0, 'paypay-routine:guided-p1-kept'); assert.deepEqual(login.calls.rejected, ['uncertain'], 'paypay-routine:guided-p1-kept'); assert.match(String(r.failed), /確認できません/, 'paypay-routine:guided-p1-kept');
});

test('a reclaimed retrieve job whose folder holds login.json submits nothing; attempt.json with a completed file recovers it without a second export', { timeout: 300000 }, async () => {
  const site = bankSite(), job = jobOf(), r0 = await collect(site, { job });
  assert.equal(r0.result.items.length, 1); const jobDir = r0.jobDir, files = (await readdir(jobDir)).sort();
  assert.ok(files.includes('login.json') && files.includes('attempt.json'), 'paypay-routine:journal-and-attempt-written ' + files.join(','));
  // a crash after the file completed but before the manifest: recovered from attempt.json + download.json, no sign-in, no export
  await rm(path.join(jobDir, 'manifest.json'));
  const again = bankSite(), r1 = await owned(again, async ({ page, browser }) => bank.collectBankFromPage(page, browser, adapter(), boundOf(job), job, r0.root, async () => {}, { login: savedLogin(), pollMs: 300, loginTimeoutMs: 8000 }));
  assert.equal(r1.recovered, true, 'paypay-routine:attempt-recovered'); assert.deepEqual([again.stats.posts, again.count('csv')], [0, 0], 'paypay-routine:no-second-submission-or-export');
  // a crash after the submission but before any attempt: the journal alone stops a second submission (the person is asked)
  const job2 = jobOf(), root2 = path.join(temp, 'reclaim-' + randomUUID().slice(0, 8)), dir2 = path.join(root2, 'outbox', 'bank', ACCOUNT, job2.jobId); await mkdir(dir2, { recursive: true });
  const { writeFile } = await import('node:fs/promises'); await writeFile(path.join(dir2, 'login.json'), JSON.stringify({ ...boundOf(job2), submittedAt: new Date().toISOString() }));
  const third = bankSite(), login3 = savedLogin(), statuses3 = [];
  const r2 = await owned(third, async ({ page, browser }) => { try { return await bank.collectBankFromPage(page, browser, adapter(), boundOf(job2), job2, root2, async (s, t) => { statuses3.push([s, t]); }, { login: login3, pollMs: 300, loginTimeoutMs: 6000 }); } catch (e) { return { error: e }; } });
  assert.deepEqual([third.stats.posts, login3.calls.open, third.count('csv')], [0, 0, 0], 'paypay-routine:reclaimed-journal-no-resubmission'); assert.ok(r2.error || r2.failed, 'paypay-routine:reclaimed-journal-no-resubmission');
  assert.ok(statuses3.some(([s, t]) => s === 'verification_required' && /もう一度は送信しません/.test(t)), 'paypay-routine:reclaimed-journal-explained');
});
