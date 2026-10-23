// collector/test/paypay-live-period.test.mjs — plan omf-paypay-live-period-20261023: the actual default statement view of a routine
// PayPay銀行 標準 retrieval and the private pre-cleanup diagnostics, end to end through bank.collectBankFromPage on an owned HEADLESS Chrome.
// Every page (popups included) is served by request interception at https://login.paypay-bank.co.jp; host resolution is refused for
// everything else, so no bank or other site can be reached. The fake statement page follows the parent's value-free real-Chrome page shape
// (hub output/plan/omf-paypay-live-period-20261023/ACTUAL-BASELINE.md §1, PayPay 4): exact title; one visible 期間選択 and one visible
// ログアウト (a second ログアウト hidden); javascript: links without inline handlers; the six named date SELECTs (name only) hidden by an
// ancestor panel with display:none; two hidden 閉じる inside it; NO CSV control; the message 照会条件に該当する取引明細はございません。
// Its DOM is otherwise invented and proves nothing about the real portal. Whether the real FULL requested period can be empty is unobserved:
// no case here treats an empty view as an export. Fictional login, account, statement values and canaries only.
// Under OMF_TEST_PAYPAY_MODULE / OMF_TEST_BANK_MODULE the named mutant copies are tested instead (fixture omf-paypay-live-period.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'rebrowser-puppeteer-core';

const moduleOf = (env, rel) => process.env[env] ? pathToFileURL(process.env[env]).href : new URL(rel, import.meta.url).href;
const paypay = await import(moduleOf('OMF_TEST_PAYPAY_MODULE', '../banks/paypay.mjs'));
const bank = await import(moduleOf('OMF_TEST_BANK_MODULE', '../bank.mjs'));
const { findChrome, LAUNCH_ARGS } = await import('../browser.mjs');

const ORIGIN = 'https://login.paypay-bank.co.jp', ENTRY = '/wctx/1D1DFxFDg.do', ACTION = '/wctx/NBCW2101.do';
const SECRET = Object.freeze({ branch: '012', account: '0012345', password: 'CanaryPw-7713' });
const OWNER = 'd4d4d4d4d4d4d4d4d4d4d4d4', ACCOUNT = 'b1b1b1b1b1b1b1b1b1b1b1b1', OMF = 'https://omf.example';
const NAMES = ['ShokaiStartDateNenIn', 'ShokaiStartDateTsukiIn', 'ShokaiStartDateHiIn', 'ShokaiEndDateNenIn', 'ShokaiEndDateTsukiIn', 'ShokaiEndDateHiIn'];
const COVERAGE = Object.freeze({ from: '2025-11-01', to: '2026-10-23' }), DEFAULT = Object.freeze({ from: '2026-07-23', to: '2026-10-23' });
// Private canaries: none may ever appear in a diagnostic record.
const CANARY = Object.freeze({ account: 'ACCTCANARY9876543', title: 'TITLECANARY7731', body: 'BODYCANARY5512', value: 'VALUECANARY3391', password: 'PASSCANARY8812', option: 'OPTIONCANARY2290', query: 'QUERYCANARY4417', cookie: 'COOKIECANARY6623' });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-paypay-live-period-test-'));
process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector-dir'); // index.mjs (pendingBank) never resolves the real collector directory
test.after(async () => { if (path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(temp, { recursive: true, force: true }); });

// ── the fake portal ──
const STYLE = '<style>a,button,input,select{display:inline-block;margin:4px;padding:4px}</style>';
const doc = (title, body) => `<!doctype html><html lang="ja"><meta charset="utf-8"><title>${title}</title>${STYLE}<body>${body}</body></html>`;
const loginDoc = () => doc('ログイン - PayPay銀行', `<form method="post" action="NBCW2101.do" name="HOST" onSubmit="return g(document.HOST)" target="_self"><input type="hidden" name="T" value="${randomUUID()}">
店番号 <input type="tel" name="TenNo" id="idTenNo" maxlength="3"> 口座番号 <input type="tel" name="KozaNo" id="idKozaNo" maxlength="7"> パスワード <input type="password" name="Pw" id="idPw" maxlength="32"> <input type="submit" name="login" value="ログイン"></form><script>function g(){return true}</script>`);
const welcomeDoc = () => doc('Welcome Page - PayPay銀行', `<a href="${ACTION}?p=balance">各種残高</a> <a href="${ACTION}?p=statements">普通預金取引明細照会</a> <a href="${ACTION}?p=logout">ログアウト</a>`);
// An error page reached from 期間選択 (option periodNav:'error'), full of canaries.
const errorDoc = () => doc(`エラー ${CANARY.title} - PayPay銀行`, `<p>${CANARY.body}</p><input type="text" name="memo" value="${CANARY.value}"><input type="password" name="pw2" value="${CANARY.password}"><select name="x"><option>${CANARY.option}</option></select><script>document.cookie='sid=${CANARY.cookie}; path=/';</script>`);
const IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
function statementDoc(s, view) {
  const values = [...view.from.split('-'), ...view.to.split('-')].map(Number);
  const select = (name, i) => { const [lo, hi, unit] = [[2016, 2026, '年'], [1, 12, '月'], [1, 31, '日']][i % 3]; return `<div style="display:inline-block"><select name="${name}">${Array.from({ length: hi - lo + 1 }, (_, k) => lo + k).map(n => `<option value="${n}"${n === values[i] ? ' selected' : ''}>${n}${unit}</option>`).join('')}</select></div>`; };
  const csv = view.rows ? '<a href="javascript:void(0)" class="csv">CSV</a> '.repeat(s.csvAfterQuery) : '';
  const period = '<a href="javascript:void(0)" class="period">期間選択</a> '.repeat(s.periodLinks);
  return doc(s.title, `<div id="account">普通 カクウ商事 ${CANARY.account}</div><a href="javascript:void(0)" class="logout" style="display:none">ログアウト</a>
<a href="#">表示順</a> ${period}<a href="${ACTION}?p=pdf">PDF</a> ${csv}<a href="${ACTION}?p=welcome">Welcome Page</a> <a href="javascript:void(0)" class="logout"${s.logoutVisible ? '' : ' style="display:none"'}>ログアウト</a>
<div id="panel" style="display:none"><div><div><div><div>${s.dates === 'absent' ? '' : NAMES.map(select).join(' ')}</div></div></div></div>
<input type="image" alt="照会" src="${IMG}" style="width:40px;height:20px" class="query"> <a href="javascript:void(0)" class="close">閉じる</a><a href="javascript:void(0)" class="close">閉じる</a></div>
<p>${view.rows ? '照会結果 ' + view.from + '〜' + view.to : '照会条件に該当する取引明細はございません。'}</p>
<script>const N=${JSON.stringify(NAMES)};
const v=n=>{const e=[...document.getElementsByName(n)].find(x=>x.getClientRects().length);return String(e.value).padStart(2,'0')};
const on=(sel,fn)=>document.querySelectorAll(sel).forEach(e=>e.addEventListener('click',ev=>{ev.preventDefault();fn();}));
on('.period',()=>{${s.periodNav === 'error' ? `location.href='${ACTION}?p=error&q=${CANARY.query}';` : s.periodNav === 'inert' ? '' : "document.getElementById('panel').style.display='block';"}});
on('.close',()=>{document.getElementById('panel').style.display='none';});
on('.query',()=>{location.href='${ACTION}?p=result&from='+v(N[0])+'-'+v(N[1])+'-'+v(N[2])+'&to='+v(N[3])+'-'+v(N[4])+'-'+v(N[5]);});
on('.logout',()=>{location.href='${ACTION}?p=logout';});
on('.csv',()=>{const w=window.open('about:blank','_blank');w.document.title='ダウンロード中 - PayPay銀行';setTimeout(()=>{w.location.href=location.origin+'${ACTION}?p=csv&from=${view.from}&to=${view.to}';},800);});</script>`);
}
const CSV_HEAD = '操作日(年),操作日(月),操作日(日),操作時刻(時),操作時刻(分),操作時刻(秒),取引順番号,摘要,お支払金額,お預り金額,残高,メモ';
const csvBytes = (from, to) => Buffer.from([CSV_HEAD, `${from.slice(0, 4)},${Number(from.slice(5, 7))},${Number(from.slice(8))},9,00,00,1,振込 カクウ,,50000,150000,`].join('\r\n') + '\r\n');
// Options: title (exact by default), periodLinks, logoutVisible, periodNav 'panel'|'inert'|'error', dates 'present'|'absent', rowsAfterQuery,
// csvAfterQuery (count when the queried period has rows). The default view (DEFAULT, no rows) never shows CSV.
function bankSite(options = {}) {
  const s = { title: '普通預金取引明細照会 - PayPay銀行', periodLinks: 1, logoutVisible: true, periodNav: 'panel', dates: 'present', rowsAfterQuery: true, csvAfterQuery: 1, ...options };
  const stats = { posts: 0, requests: [], foreign: [], downloads: [], queried: [] }, count = p => stats.requests.filter(r => r === p).length;
  const respond = request => {
    let url; try { url = new URL(request.url()); } catch { return request.abort(); }
    const html = body => request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body });
    if (url.protocol === 'data:') return request.continue();
    if (url.origin !== ORIGIN) { stats.foreign.push(url.origin); return request.abort(); }
    const p = url.searchParams.get('p') || (url.pathname === ENTRY ? 'entry' : request.method() === 'POST' ? 'post' : 'other'); stats.requests.push(p);
    if (p === 'entry' || p === 'logout') return html(loginDoc());
    if (p === 'post') { stats.posts++; return html(welcomeDoc()); }
    if (p === 'welcome') return html(welcomeDoc());
    if (p === 'statements') return html(statementDoc(s, { ...DEFAULT, rows: false }));
    if (p === 'result') { const from = url.searchParams.get('from'), to = url.searchParams.get('to'); stats.queried.push([from, to]); return html(statementDoc(s, { from, to, rows: s.rowsAfterQuery })); }
    if (p === 'csv') { stats.downloads.push({ host: url.hostname, from: url.searchParams.get('from'), to: url.searchParams.get('to') }); return request.respond({ status: 200, contentType: 'text/csv', headers: { 'Content-Disposition': 'attachment; filename="meisai.csv"' }, body: csvBytes(url.searchParams.get('from'), url.searchParams.get('to')) }); }
    if (p === 'error') return html(errorDoc());
    return html(doc('PayPay銀行', '<p>other</p>'));
  };
  return { s, stats, count, respond };
}
async function owned(site, fn) {
  const profile = path.join(temp, 'profile-' + randomUUID().slice(0, 8));
  const browser = await puppeteer.launch({ executablePath: findChrome(), pipe: true, headless: true, userDataDir: profile, defaultViewport: null, protocolTimeout: 30000, args: [...LAUNCH_ARGS, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
  const attach = async page => { await page.setRequestInterception(true); page.on('request', r => site.respond(r)); };
  const ready = page => (page.__attached ??= attach(page));
  browser.on('targetcreated', async target => { if (target.type() !== 'page') return; try { const page = await target.page(); if (page) await ready(page); } catch { /* closed */ } });
  try { const page = await browser.newPage(); await ready(page); return await fn({ page, browser }); }
  finally { await browser.close().catch(() => {}); }
}
function savedLogin() {
  const calls = { open: 0, rejected: [], accepted: 0 }; let current = 'ready';
  return { calls, async state() { return current; }, async open() { calls.open++; return { ...SECRET }; }, async rejected(kind = 'uncertain') { calls.rejected.push(kind); current = kind === 'refused' ? 'refused' : 'blocked'; }, async accepted() { calls.accepted++; current = 'ready'; } };
}
const snapshotOf = (extra = {}) => ({ templateId: null, templateRevision: 0, headers: [], mapping: {}, amountSign: 'outflow-positive', transactionIdConfirmed: false, parserVersion: 'bank-template-1', currency: 'JPY', provider: 'paypay', accountLabel: null, variant: 'standard', coverage: { ...COVERAGE }, interpretation: 'unmapped', ...extra });
const jobOf = (extra = {}) => { const snapshot = snapshotOf(extra); return { jobId: randomUUID(), kind: 'retrieve', snapshot, snapshotHash: sha256(JSON.stringify(snapshot)), provider: 'paypay' }; };
const boundOf = job => ({ bankAccountId: ACCOUNT, ownerId: OWNER, origin: OMF, jobId: job.jobId, snapshotHash: job.snapshotHash, provider: 'paypay' });
// The shipped routine adapter with shorter step windows; `wrap` may replace parts of its ui (a broken reader, no reader).
const adapter = (wrap = ui => ui) => ({ ...paypay.standard, ui(page, browser, snapshot) { return wrap(paypay.routineUi(page, browser, this, snapshot, { settleMs: 20000, stableMs: 800, stepMs: 15000, finishMs: 10000 })); } });
async function collect(site, { job = jobOf(), wrap, root = null, ...rest } = {}) {
  root ??= path.join(temp, 'root-' + randomUUID().slice(0, 8)); await mkdir(root, { recursive: true });
  const statuses = [];
  return owned(site, async ({ page, browser }) => {
    let result = null, error = null; const started = Date.now();
    try { result = await bank.collectBankFromPage(page, browser, adapter(wrap), boundOf(job), job, root, async (state, text) => { statuses.push([state, text]); }, { login: savedLogin(), pollMs: 300, loginTimeoutMs: 45000, downloadTimeoutMs: 45000, extensionMs: 0, ...rest }); } catch (e) { error = e; }
    const elapsed = Date.now() - started;
    // read while the job's browser is still open: collectBankStatement's cleanup (withBankBrowser) only follows this return
    const atReturn = await records(root), open = browser.connected && !page.isClosed();
    return { result, error, statuses, root, job, elapsed, atReturn, open, jobDir: path.join(root, 'outbox', 'bank', ACCOUNT, job.jobId) };
  });
}
async function records(root) {
  const dir = path.join(root, 'diagnostics', 'bank', ACCOUNT); let names = [];
  try { names = await readdir(dir); } catch { return []; }
  return Promise.all(names.sort().map(async n => ({ name: n, text: await readFile(path.join(dir, n), 'utf8') }))).then(list => list.map(x => ({ ...JSON.parse(x.text), __text: x.text, __name: x.name })));
}
const TOP_KEYS = ['schema', 'at', 'provider', 'variant', 'bankAccountId', 'jobId', 'outcome', 'step', 'code', 'page', 'finish'];
const PAGE_KEYS = ['readable', 'dialog', 'origin', 'top', 'title', 'kind', 'readyState', 'visibility', 'focus', 'password', 'controls', 'dates', 'panelClose', 'frames', 'lastPress', 'changedSincePress'];
function noCanary(text) { for (const v of [...Object.values(CANARY), SECRET.account, SECRET.password, ORIGIN, 'login.paypay-bank', '照会条件', 'カクウ', '普通預金取引明細照会', 'エラー', 'NBCW2101']) assert.ok(!text.includes(v), 'live-period:no-canary ' + v); }
function fixedSchema(r) {
  assert.deepEqual(Object.keys(r).filter(k => !k.startsWith('__')).sort(), [...TOP_KEYS].sort(), 'live-period:fixed-schema top');
  if (r.page) { assert.deepEqual(Object.keys(r.page).sort(), [...PAGE_KEYS].sort(), 'live-period:fixed-schema page'); assert.deepEqual(Object.keys(r.page.controls).sort(), ['close', 'csv', 'logout', 'period', 'query'], 'live-period:fixed-schema controls'); assert.ok(r.page.dates.every(d => JSON.stringify(Object.keys(d).sort()) === JSON.stringify(['disabled', 'select', 'total', 'visible'])), 'live-period:fixed-schema dates'); }
  assert.deepEqual(Object.keys(r.finish).sort(), ['downloadTabsClosed', 'loggedOut', 'reason', 'settled'], 'live-period:fixed-schema finish');
}

test('page state (pure): the exact statement title with one visible 期間選択 and ログアウト is the statement page even without CSV — never export_ready; similar titles, frames, other origins, two 期間選択 or no ログアウト stay unknown', () => {
  const c = paypay.STANDARD_PAGES, read = o => ({ origin: ORIGIN, top: true, title: c.statements.title, controls: [], password: false, ...o });
  assert.equal(paypay.classifyRoutinePage(read({ controls: ['表示順', '期間選択', 'PDF', 'Welcome Page', 'ログアウト'] })), 'statements', 'live-period:default-view-is-statements');
  assert.equal(paypay.classifyRoutinePage(read({ controls: ['期間選択', 'ログアウト', '閉じる'] })), 'statements', 'live-period:default-view-panel-open');
  assert.equal(paypay.classifyRoutinePage(read({ controls: ['期間選択', 'CSV', 'ログアウト'] })), 'export_ready', 'live-period:csv-view-export-ready (unchanged)');
  assert.equal(paypay.classifyRoutinePage(read({ controls: ['期間選択', 'CSV', 'ログアウト', '閉じる'] })), 'statements', 'live-period:csv-view-panel-open (unchanged)');
  assert.equal(paypay.classifyRoutinePage(read({ controls: ['期間選択', '期間選択', 'ログアウト'] })), 'unknown', 'live-period:two-period-links-unknown');
  assert.equal(paypay.classifyRoutinePage(read({ controls: ['期間選択', 'PDF'] })), 'unknown', 'live-period:no-logout-unknown');
  assert.equal(paypay.classifyRoutinePage(read({ controls: ['ログアウト'] })), 'unknown', 'live-period:no-period-unknown');
  assert.equal(paypay.classifyRoutinePage(read({ title: '普通預金取引明細照会 - PayPay', controls: ['期間選択', 'ログアウト'] })), 'unknown', 'live-period:similar-title-unknown');
  assert.equal(paypay.classifyRoutinePage(read({ top: false, controls: ['期間選択', 'ログアウト'] })), 'unknown', 'live-period:frame-unknown');
  assert.equal(paypay.classifyRoutinePage(read({ origin: 'https://www.paypay-bank.co.jp', controls: ['期間選択', 'ログアウト'] })), 'unknown', 'live-period:other-origin-unknown');
  assert.equal(paypay.classifyRoutinePage(read({ password: true, controls: ['期間選択', 'ログアウト'] })), 'login', 'live-period:password-is-login');
});

test('actual-shaped empty default view (no CSV): one requested-period query for the frozen older period, then the one CSV of that query from the bank host; logout once', { timeout: 300000 }, async () => {
  const site = bankSite(), r = await collect(site);
  assert.equal(r.error, null, 'live-period:empty-default-query-then-csv ' + String(r.error?.code || '') + ' ' + String(r.error?.message || ''));
  assert.deepEqual(site.stats.queried, [[COVERAGE.from, COVERAGE.to]], 'live-period:empty-default-query-then-csv (queried the frozen period once)');
  assert.equal(r.result.failed, null); assert.equal(r.result.items.length, 1, 'live-period:empty-default-query-then-csv (one original)');
  const m = r.result.items[0].manifest; assert.deepEqual([m.jobId, m.snapshotHash, m.sourceHost, m.period], [r.job.jobId, r.job.snapshotHash, 'login.paypay-bank.co.jp', COVERAGE.from + '〜' + COVERAGE.to], 'live-period:manifest-bound');
  assert.equal(sha256(await readFile(path.join(r.jobDir, m.filename))), m.sha256);
  assert.deepEqual(site.stats.downloads.map(d => [d.from, d.to]), [[COVERAGE.from, COVERAGE.to]], 'live-period:export-is-requested-period');
  assert.deepEqual([site.stats.posts, site.count('statements'), site.count('result'), site.count('csv'), site.count('logout'), site.count('pdf')], [1, 1, 1, 1, 1, 0], 'live-period:once-each');
  assert.equal(site.stats.foreign.length, 0, 'live-period:no-foreign-request');
});

test('fail closed: the requested period without CSV after the query, two CSV after it, two 期間選択, no visible ログアウト, a similar title, a different account label — no export, no capture, logout pressed', { timeout: 600000 }, async () => {
  for (const [label, options, job, check] of [
    ['no CSV after the query (empty result is not an export)', { rowsAfterQuery: false }, null, r => assert.equal(r.error?.code, 'period-query', 'live-period:no-csv-after-query ' + r.error?.code)],
    ['two CSV after the query', { csvAfterQuery: 2 }, null, r => assert.equal(r.error?.code, 'export-unidentified', 'live-period:two-csv-after-query ' + r.error?.code)],
    ['two 期間選択', { periodLinks: 2 }, null, r => assert.equal(r.error?.code, 'statements-unidentified', 'live-period:two-period-links ' + r.error?.code)],
    ['no visible ログアウト', { logoutVisible: false }, null, r => assert.equal(r.error?.code, 'statements-unidentified', 'live-period:no-logout ' + r.error?.code)],
    ['similar title', { title: '普通預金取引明細 - PayPay銀行' }, null, r => assert.equal(r.error?.code, 'statements-unidentified', 'live-period:similar-title ' + r.error?.code)],
    ['different account label', {}, jobOf({ accountLabel: '別の会社' }), r => assert.match(String(r.error?.message), /一致しません/, 'live-period:label-mismatch')]]) {
    const site = bankSite(options), r = await collect(site, job ? { job } : {});
    check(r);
    assert.equal(site.count('csv'), 0, 'live-period:fail-closed no CSV ' + label); assert.equal(r.result, null, 'live-period:fail-closed no result ' + label);
    assert.deepEqual(await readdir(r.jobDir).then(n => n.filter(x => x !== 'login.json' && x !== 'attempt.json'), () => []), [], 'live-period:fail-closed no file ' + label);
    // an unrecognized page is never taken for a signed-in one: finish() does not press ログアウト there (unchanged rule)
    assert.equal(site.count('logout'), r.error?.code === 'statements-unidentified' ? 0 : 1, 'live-period:fail-closed logout ' + label);
  }
});

test('private diagnostics on a failure: recorded before ログアウト and cleanup with the actual logout outcome; hidden dates are told from absent ones; fixed value-free schema; never in the outbox', { timeout: 600000 }, async () => {
  // a 期間選択 that does nothing on the actual-shaped page: the six named selects exist but stay hidden (the 13:02 message shape)
  const site = bankSite({ periodNav: 'inert' }), r = await collect(site);
  assert.equal(r.error?.code, 'period-unidentified'); assert.match(String(r.error?.message), /missing\/missing\/missing\/missing\/missing\/missing/);
  assert.equal(site.count('logout'), 1, 'live-period:logout-after-failure');
  assert.ok(r.open && r.atReturn.length === 1, 'live-period:recorded-before-cleanup (on disk when the job returned, its browser still open)');
  const list = await records(r.root); assert.equal(list.length, 1, 'live-period:diagnostic-written'); const d = list[0];
  fixedSchema(d); noCanary(d.__text);
  assert.deepEqual([d.schema, d.provider, d.variant, d.outcome, d.step, d.code, d.jobId, d.bankAccountId], ['bank-diagnostic-1', 'paypay', 'standard', 'failed', 'period', 'period-unidentified', r.job.jobId, ACCOUNT]);
  assert.ok(d.page, 'live-period:diagnostic-written page');
  assert.deepEqual([d.page.readable, d.page.kind, d.page.title, d.page.password, d.page.origin, d.page.top, d.page.panelClose, d.page.lastPress, d.page.changedSincePress], [true, 'statements', 'statements', false, true, true, false, 'period', false], 'live-period:diagnostic-before-logout (the statement page, not the login page after ログアウト)');
  assert.deepEqual(d.page.controls, { period: 1, logout: 1, csv: 0, close: 0, query: 0 }, 'live-period:diagnostic-controls');
  assert.deepEqual(d.page.dates, NAMES.map(() => ({ total: 1, visible: 0, select: 1, disabled: 0 })), 'live-period:hidden-dates');
  assert.ok(['loading', 'interactive', 'complete'].includes(d.page.readyState) && ['visible', 'hidden'].includes(d.page.visibility) && typeof d.page.focus === 'boolean', 'live-period:readiness-visibility');
  assert.deepEqual(d.page.frames, { total: 0, sameOrigin: 0 });
  assert.deepEqual([d.finish.settled, d.finish.loggedOut], [true, true], 'live-period:finish-outcome-kept');
  // the record lives outside the outbox: nothing for pendingBank, no manifest, no attempt marker
  assert.ok(!path.relative(path.join(r.root, 'outbox'), path.join(r.root, 'diagnostics')).startsWith('.' + path.sep) && !d.__name.includes('manifest'), 'live-period:not-in-outbox');
  const { pendingBank } = await import('../index.mjs');
  assert.deepEqual(await pendingBank({ _id: ACCOUNT, ownerId: OWNER }, { baseUrl: OMF }, r.root), [], 'live-period:no-diagnostic-upload');
  assert.deepEqual((await readdir(r.jobDir)).sort(), ['login.json'], 'live-period:no-attempt-or-recovery-confusion');

  // absent dates (the six names nowhere in the document)
  const absent = bankSite({ periodNav: 'inert', dates: 'absent' }), ra = await collect(absent), da = (await records(ra.root))[0];
  assert.equal(ra.error?.code, 'period-unidentified'); assert.deepEqual(da.page.dates, NAMES.map(() => ({ total: 0, visible: 0, select: 0, disabled: 0 })), 'live-period:absent-dates');

  // 期間選択 leaves for an error page full of private canaries: the document change, an unknown kind, no logout (not signed in)
  const err = bankSite({ periodNav: 'error' }), re = await collect(err), de = (await records(re.root))[0];
  // the unchanged period poll (plan R2 not admitted) either reports six missing fields or fails mid-navigation with an uncoded browser error
  // whose text may carry the page address — the record keeps only the code
  assert.ok(re.error, 'live-period:error-page-failed'); assert.equal(re.result, null);
  assert.equal(de.code, re.error.code === 'period-unidentified' ? 'period-unidentified' : 'uncoded', 'live-period:code-only ' + String(re.error?.code)); assert.deepEqual([de.outcome, de.step], ['failed', 'period']);
  fixedSchema(de); noCanary(de.__text);
  assert.deepEqual([de.page.kind, de.page.title, de.page.password, de.page.changedSincePress, de.page.lastPress], ['login', 'other-bank', true, true, 'period'], 'live-period:document-changed');
  assert.deepEqual([de.finish.settled, de.finish.loggedOut, de.finish.reason], [true, false, 'not-signed-in'], 'live-period:finish-outcome-kept (not signed in)');
  assert.equal(err.count('logout'), 0);
});

test('private diagnostics on success: the logout outcome only (no page read), the result unchanged', { timeout: 300000 }, async () => {
  const site = bankSite(), r = await collect(site);
  assert.equal(r.error, null, String(r.error)); assert.equal(r.result.items.length, 1);
  const list = await records(r.root); assert.equal(list.length, 1, 'live-period:diagnostic-written success'); fixedSchema(list[0]); noCanary(list[0].__text);
  assert.deepEqual([list[0].outcome, list[0].step, list[0].code, list[0].page], ['completed', 'complete', null, null]);
  assert.deepEqual([list[0].finish.settled, list[0].finish.loggedOut, list[0].finish.downloadTabsClosed], [true, true, 1], 'live-period:finish-outcome-kept success');
});

test('a broken diagnostic never changes the result, the logout or cleanup: a throwing reader, a reader that never answers, an unwritable diagnostics folder; an adapter without the reader writes nothing', { timeout: 900000 }, async () => {
  // throwing reader on a failure → the same error, logout once, a record without a page
  const s1 = bankSite({ periodNav: 'inert' }), r1 = await collect(s1, { wrap: ui => ({ ...ui, async diagnostic() { throw new Error(CANARY.body); } }) });
  assert.equal(r1.error?.code, 'period-unidentified', 'live-period:broken-reader-same-result'); assert.equal(s1.count('logout'), 1, 'live-period:broken-reader-logout');
  const d1 = (await records(r1.root))[0]; assert.equal(d1?.page, null); noCanary(d1.__text);
  // a reader that does not answer for 60 s on a failure → bounded: the job ends with the same error well within the bound, logout once
  const s2 = bankSite({ periodNav: 'inert' }), r2 = await collect(s2, { wrap: ui => ({ ...ui, diagnostic: () => new Promise(resolve => setTimeout(() => resolve({ readable: false }), 60000)) }) });
  assert.equal(r2.error?.code, 'period-unidentified'); assert.equal(s2.count('logout'), 1);
  const bare = bankSite({ periodNav: 'inert' }), rb = await collect(bare, { wrap: ui => { const { diagnostic, ...rest } = ui; void diagnostic; return rest; } });
  assert.ok(r2.elapsed - rb.elapsed < 9000, `live-period:diagnostic-bounded (${r2.elapsed} ms vs ${rb.elapsed} ms without a reader)`);
  // without the reader (楽天銀行 and every other adapter): nothing is written; the failure and logout are as before
  assert.equal(rb.error?.code, 'period-unidentified'); assert.equal(bare.count('logout'), 1); assert.deepEqual(await records(rb.root), [], 'live-period:no-reader-no-record');
  // the diagnostics folder cannot be created (a file is in its way) → success and failure keep their results and logout
  for (const options of [{}, { periodNav: 'inert' }]) {
    const root = path.join(temp, 'blocked-' + randomUUID().slice(0, 8)); await mkdir(root, { recursive: true }); await writeFile(path.join(root, 'diagnostics'), 'not a folder');
    const s = bankSite(options), r = await collect(s, { root });
    if (options.periodNav) assert.equal(r.error?.code, 'period-unidentified', 'live-period:unwritable-same-result failure'); else { assert.equal(r.error, null, 'live-period:unwritable-same-result success ' + String(r.error)); assert.equal(r.result.items.length, 1); }
    assert.equal(s.count('logout'), 1, 'live-period:unwritable-logout'); assert.equal(r.open, true, 'live-period:unwritable-returned');
  }
});
