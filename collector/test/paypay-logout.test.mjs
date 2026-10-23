// collector/test/paypay-logout.test.mjs — plan omf-paypay-logout-20261023: the logout confirmation of a routine PayPay銀行 標準 retrieval,
// end to end through bank.collectBankFromPage on an owned HEADLESS Chrome. Every page (popups and frames included) is served by request
// interception; host resolution is refused for everything else, so no bank or other site can be reached. All fictional HTML declares UTF-8.
// Actual basis (hub output/plan/omf-paypay-logout-20261023/CAUSE.md, value-free LIVE-LOGOUT-TRACE.jsonl): right after this job's own ログアウト
// press on the official statement page, a `confirm` opened on that page whose text had logout and confirmation wording; it was never
// answered and the post-logout page was never reached. The exact bank wording was deliberately not retained: the fictional message below
// only carries the same two categories (and a private canary) and proves nothing about the real text. Every dialog is recorded by the
// test's OWN enabled CDP session on each page (Page.enable before anything opens), and a dialog the collector left open is dismissed by
// that session only after the job returned and the outcome was recorded.
// Under OMF_TEST_PAYPAY_MODULE / OMF_TEST_BANK_MODULE the named mutant copies are tested instead (fixture omf-paypay-logout.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'rebrowser-puppeteer-core';

const moduleOf = (env, rel) => process.env[env] ? pathToFileURL(process.env[env]).href : new URL(rel, import.meta.url).href;
const paypay = await import(moduleOf('OMF_TEST_PAYPAY_MODULE', '../banks/paypay.mjs'));
const bank = await import(moduleOf('OMF_TEST_BANK_MODULE', '../bank.mjs'));
const { findChrome, LAUNCH_ARGS } = await import('../browser.mjs');

const ORIGIN = 'https://login.paypay-bank.co.jp', OTHER = 'https://www.paypay-bank.co.jp', ENTRY = '/wctx/1D1DFxFDg.do', ACTION = '/wctx/NBCW2101.do';
const SECRET = Object.freeze({ branch: '012', account: '0012345', password: 'CanaryPw-5521' });
const OWNER = 'd4d4d4d4d4d4d4d4d4d4d4d4', ACCOUNT = 'b1b1b1b1b1b1b1b1b1b1b1b1', OMF = 'https://omf.example';
const NAMES = ['ShokaiStartDateNenIn', 'ShokaiStartDateTsukiIn', 'ShokaiStartDateHiIn', 'ShokaiEndDateNenIn', 'ShokaiEndDateTsukiIn', 'ShokaiEndDateHiIn'];
const COVERAGE = Object.freeze({ from: '2025-11-01', to: '2026-10-23' });
const CANARY = Object.freeze({ dialog: 'DIALOGCANARY4471', account: 'ACCTCANARY2208', body: 'BODYCANARY6630', query: 'QUERYCANARY9184', password: 'PASSCANARY3307' });
// fictional texts: LOGOUT_CONFIRM carries both observed categories (logout + confirmation wording); the others lack one of them
const LOGOUT_CONFIRM = `ログアウトしますか？よろしいですか？ ${CANARY.dialog}`, GENERIC_CONFIRM = `よろしいですか？ ${CANARY.dialog}`, LOGOUT_ONLY = `ログアウト ${CANARY.dialog}`;
const FINISH_MS = 6000, LATE_MS = FINISH_MS + 3000;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-paypay-logout-test-'));
test.after(async () => { if (path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(temp, { recursive: true, force: true }); });

// ── the fake portal (every document declares UTF-8) ──
const doc = (title, body) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title><style>a,button,input,select{display:inline-block;margin:4px;padding:4px}</style></head><body>${body}</body></html>`;
const loginDoc = () => doc('ログイン - PayPay銀行', `<form method="post" action="NBCW2101.do" name="HOST" onSubmit="return g(document.HOST)" target="_self"><input type="hidden" name="T" value="${randomUUID()}">
店番号 <input type="tel" name="TenNo" id="idTenNo" maxlength="3"> 口座番号 <input type="tel" name="KozaNo" id="idKozaNo" maxlength="7"> パスワード <input type="password" name="Pw" id="idPw" maxlength="32"> <input type="submit" name="login" value="ログイン"></form><script>function g(){return true}</script>`);
const welcomeDoc = s => doc('Welcome Page - PayPay銀行', `<a href="${ACTION}?p=balance">各種残高</a> <a href="${ACTION}?p=statements">普通預金取引明細照会</a> <a href="javascript:void(0)" class="logout">ログアウト</a>
<script>${s.welcomeConfirm ? `setTimeout(()=>confirm(${JSON.stringify(LOGOUT_CONFIRM)}),100);` : ''}document.querySelectorAll('.logout').forEach(e=>e.addEventListener('click',ev=>{ev.preventDefault();location.href='${ACTION}?p=logout';}));</script>`);
// What ログアウト does on the statement page (s.logout): the observed confirm, no dialog, or an out-of-scope dialog.
const LOGOUT_JS = {
  confirm: `if(confirm(M))go();`,
  direct: `go();`,
  generic: `if(confirm(${JSON.stringify(GENERIC_CONFIRM)}))go();`,
  'logout-only': `if(confirm(${JSON.stringify(LOGOUT_ONLY)}))go();`,
  alert: `alert(M);go();`,
  prompt: `if(prompt(M)!==null)go();`,
  twice: `if(confirm(M)&&confirm(M))go();`,
  late: `setTimeout(()=>{if(confirm(M))go();},${LATE_MS});`,
  frame: `if(document.getElementById('f').contentWindow.confirm(M))go();`,
  'wrong-origin': `location.href='${OTHER}/bye';`,
  // the popup opens blank first (its interception attaches before it navigates), as the CSV tab does
  'wrong-tab': `const w=window.open('about:blank','_blank');setTimeout(()=>{w.location.href=location.origin+'${ACTION}?p=popup';},800);`,
  // the leave-page handler is installed only by the ログアウト click itself (never during 照会 or CSV)
  beforeunload: `addEventListener('beforeunload',e=>{e.preventDefault();e.returnValue='';});go();`
};
function statementDoc(s, view) {
  const values = [...view.from.split('-'), ...view.to.split('-')].map(Number);
  const select = (name, i) => { const [lo, hi, unit] = [[2016, 2026, '年'], [1, 12, '月'], [1, 31, '日']][i % 3]; return `<select name="${name}">${Array.from({ length: hi - lo + 1 }, (_, k) => lo + k).map(n => `<option value="${n}"${n === values[i] ? ' selected' : ''}>${n}${unit}</option>`).join('')}</select>`; };
  const csv = view.queried ? '<a href="javascript:void(0)" class="csv">CSV</a> '.repeat(s.csvLinks) : '';
  return doc('普通預金取引明細照会 - PayPay銀行', `<div id="account">普通 カクウ商事 ${CANARY.account}</div><p>${CANARY.body}</p><input type="password" name="pw9" value="${CANARY.password}" style="display:none">
<a href="#">表示順</a> <a href="javascript:void(0)" class="period">期間選択</a> ${csv}<a href="${ACTION}?p=welcome">Welcome Page</a> <a href="javascript:void(0)" class="logout">ログアウト</a>
${s.logout === 'frame' ? `<iframe id="f" src="${ACTION}?p=frame" style="width:10px;height:10px"></iframe>` : ''}
<div id="panel" style="display:none">${NAMES.map(select).join(' ')} <input type="button" value="照会" class="query"> <a href="javascript:void(0)" class="close">閉じる</a></div>
<p>${view.queried ? '照会結果' : '最近の取引'}</p>
<script>const N=${JSON.stringify(NAMES)},M=${JSON.stringify(LOGOUT_CONFIRM)};
const v=n=>String(document.getElementsByName(n)[0].value).padStart(2,'0');
const go=()=>{location.href='${ACTION}?p=logout';};
const on=(sel,fn)=>document.querySelectorAll(sel).forEach(e=>e.addEventListener('click',ev=>{ev.preventDefault();fn();}));
on('.period',()=>{document.getElementById('panel').style.display='block';});
on('.close',()=>{document.getElementById('panel').style.display='none';});
on('.query',()=>{${s.queryConfirm ? 'if(!confirm(M))return;' : ''}location.href='${ACTION}?p=result&from='+v(N[0])+'-'+v(N[1])+'-'+v(N[2])+'&to='+v(N[3])+'-'+v(N[4])+'-'+v(N[5])+'&z=${CANARY.query}';});
on('.logout',()=>{${LOGOUT_JS[s.logout]}});
on('.csv',()=>{${s.csvConfirm ? 'if(!confirm(M))return;' : ''}const w=window.open('about:blank','_blank');w.document.title='ダウンロード中 - PayPay銀行';setTimeout(()=>{w.location.href=location.origin+'${ACTION}?p=csv&from=${view.from}&to=${view.to}';},800);${s.preexisting ? 'setTimeout(()=>confirm(M),300);' : ''}});</script>`);
}
const CSV_HEAD = '操作日(年),操作日(月),操作日(日),操作時刻(時),操作時刻(分),操作時刻(秒),取引順番号,摘要,お支払金額,お預り金額,残高,メモ';
const csvBytes = (from, to) => Buffer.from([CSV_HEAD, `${from.slice(0, 4)},${Number(from.slice(5, 7))},${Number(from.slice(8))},9,00,00,1,振込 カクウ,,50000,150000,`].join('\r\n') + '\r\n');
// s: logout (LOGOUT_JS key), csvLinks, csvConfirm, queryConfirm, welcomeConfirm, preexisting
function bankSite(options = {}) {
  const s = { logout: 'confirm', csvLinks: 1, csvConfirm: false, queryConfirm: false, welcomeConfirm: false, preexisting: false, ...options };
  const stats = { posts: 0, requests: [], foreign: [], downloads: [] }, count = p => stats.requests.filter(r => r === p).length;
  let view = { from: '2026-09-23', to: '2026-10-23', queried: false };
  const respond = request => {
    let url; try { url = new URL(request.url()); } catch { return request.abort(); }
    const html = body => request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body });
    if (url.origin === OTHER && url.pathname === '/bye') { stats.requests.push('other-origin'); return html(doc('PayPay銀行', `<p>other origin</p><script>setTimeout(()=>{if(confirm(${JSON.stringify(LOGOUT_CONFIRM)}))location.href='${ORIGIN}${ACTION}?p=logout';},100);</script>`)); }
    if (url.origin !== ORIGIN) { stats.foreign.push(url.origin); return request.abort(); }
    const p = url.searchParams.get('p') || (url.pathname === ENTRY ? 'entry' : request.method() === 'POST' ? 'post' : 'other'); stats.requests.push(p);
    if (p === 'entry' || p === 'logout') return html(loginDoc());
    if (p === 'post') { stats.posts++; return html(welcomeDoc(s)); }
    if (p === 'welcome') return html(welcomeDoc(s));
    if (p === 'statements') { view = { ...view, queried: false }; return html(statementDoc(s, view)); }
    if (p === 'result') { view = { from: url.searchParams.get('from'), to: url.searchParams.get('to'), queried: true }; return html(statementDoc(s, view)); }
    if (p === 'csv') { stats.downloads.push({ from: url.searchParams.get('from'), to: url.searchParams.get('to') }); return request.respond({ status: 200, contentType: 'text/csv', headers: { 'Content-Disposition': 'attachment; filename="meisai.csv"' }, body: csvBytes(url.searchParams.get('from'), url.searchParams.get('to')) }); }
    if (p === 'frame') return html(doc('frame', '<p>frame</p>'));
    if (p === 'popup') return html(doc('PayPay銀行', `<p>popup</p><script>setTimeout(()=>{if(confirm(${JSON.stringify(LOGOUT_CONFIRM)}))opener.location.href='${ACTION}?p=logout';},500);</script>`));
    return html(doc('PayPay銀行', '<p>other</p>'));
  };
  return { s, stats, count, respond };
}
// An owned headless Chrome; every page gets request interception and the TEST's own enabled CDP session recording its dialogs.
async function owned(site, fn) {
  const profile = path.join(temp, 'profile-' + randomUUID().slice(0, 8));
  const browser = await puppeteer.launch({ executablePath: findChrome(), pipe: true, headless: true, userDataDir: profile, defaultViewport: null, protocolTimeout: 30000, args: [...LAUNCH_ARGS, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
  const dialogs = [];
  const attach = async page => {
    const cdp = await page.createCDPSession(); await cdp.send('Page.enable');
    cdp.on('Page.javascriptDialogOpening', e => dialogs.push({ type: e.type, logout: /ログアウト/.test(e.message), confirmation: /よろしい/.test(e.message), main: page === main, closed: false, accepted: null, cdp }));
    cdp.on('Page.javascriptDialogClosed', e => { const d = dialogs.findLast(x => x.cdp === cdp && !x.closed); if (d) { d.closed = true; d.accepted = e.result; } });
    await page.setRequestInterception(true); page.on('request', r => site.respond(r));
  };
  const ready = page => (page.__attached ??= attach(page));
  let main = null;
  browser.on('targetcreated', async target => { if (target.type() !== 'page') return; try { const page = await target.page(); if (page) await ready(page); } catch { /* closed */ } });
  try { main = await browser.newPage(); await ready(main); return await fn({ page: main, browser, dialogs }); }
  finally { for (const d of dialogs) if (!d.closed) await d.cdp.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {}); await browser.close().catch(() => {}); }
}
function savedLogin() {
  const calls = { open: 0, rejected: [], accepted: 0 }; let current = 'ready';
  return { calls, async state() { return current; }, async open() { calls.open++; return { ...SECRET }; }, async rejected(kind = 'uncertain') { calls.rejected.push(kind); current = kind === 'refused' ? 'refused' : 'blocked'; }, async accepted() { calls.accepted++; current = 'ready'; } };
}
const snapshotOf = () => ({ templateId: null, templateRevision: 0, headers: [], mapping: {}, amountSign: 'outflow-positive', transactionIdConfirmed: false, parserVersion: 'bank-template-1', currency: 'JPY', provider: 'paypay', accountLabel: null, variant: 'standard', coverage: { ...COVERAGE }, interpretation: 'unmapped' });
const jobOf = () => { const snapshot = snapshotOf(); return { jobId: randomUUID(), kind: 'retrieve', snapshot, snapshotHash: sha256(JSON.stringify(snapshot)), provider: 'paypay' }; };
const boundOf = job => ({ bankAccountId: ACCOUNT, ownerId: OWNER, origin: OMF, jobId: job.jobId, snapshotHash: job.snapshotHash, provider: 'paypay' });
const adapter = (o = {}) => ({ ...paypay.standard, ui(page, browser, snapshot) { return paypay.routineUi(page, browser, this, snapshot, { settleMs: 20000, stableMs: 800, stepMs: 30000, finishMs: FINISH_MS, ...o }); } });
async function records(root) {
  const dir = path.join(root, 'diagnostics', 'bank', ACCOUNT); let names = [];
  try { names = await readdir(dir); } catch { return []; }
  return Promise.all(names.sort().map(async n => { const text = await readFile(path.join(dir, n), 'utf8'); return { ...JSON.parse(text), __text: text }; }));
}
// One retrieval; `after(dialogs)` may wait for something on the still-open browser before the dialogs are snapshotted.
async function collect(site, { ui = {}, after = null, ...rest } = {}) {
  const job = jobOf(), root = path.join(temp, 'root-' + randomUUID().slice(0, 8)); await mkdir(root, { recursive: true });
  return owned(site, async ({ page, browser, dialogs }) => {
    let result = null, error = null;
    try { result = await bank.collectBankFromPage(page, browser, adapter(ui), boundOf(job), job, root, async () => {}, { login: savedLogin(), pollMs: 300, loginTimeoutMs: 15000, downloadTimeoutMs: 15000, extensionMs: 0, ...rest }); } catch (e) { error = e; }
    if (after) await after(dialogs);
    // request counts are taken here, before the test dismisses a dialog the collector left open (a dismissed alert lets the page go on)
    const list = await records(root), shot = dialogs.map(({ cdp, ...d }) => ({ ...d })), logouts = site.count('logout'), csvs = site.count('csv');
    return { result, error, job, root, dialogs: shot, logouts, csvs, record: list.at(-1) || null, records: list, jobDir: path.join(root, 'outbox', 'bank', ACCOUNT, job.jobId) };
  });
}
const waitFor = async (fn, ms) => { const until = Date.now() + ms; while (Date.now() < until) { if (fn()) return true; await new Promise(r => setTimeout(r, 200)); } return fn(); };
const captured = (r, label = '') => { assert.equal(r.error, null, 'logout:capture ' + label + ' ' + String(r.error?.stack || r.error)); assert.equal(r.result?.failed, null); assert.equal(r.result.items.length, 1, 'logout:original-captured'); };
// The collector never answered any recorded dialog (each is still open when the outcome was recorded) and never logged out.
const untouched = (r, site, label) => {
  assert.ok(r.dialogs.length >= 1, 'logout:out-of-scope-dialog-opened ' + label);
  assert.ok(r.dialogs.every(d => !d.closed), 'logout:out-of-scope-unanswered ' + label + ' ' + JSON.stringify(r.dialogs));
  assert.equal(r.logouts, 0, 'logout:out-of-scope-no-logout ' + label);
};

test('the observed logout confirm after the job\'s own ログアウト press is accepted exactly once: post-logout page reached, original kept, adapter reports loggedOut', { timeout: 300000 }, async () => {
  const site = bankSite(), r = await collect(site);
  captured(r);
  assert.equal(sha256(await readFile(path.join(r.jobDir, r.result.items[0].manifest.filename))), r.result.items[0].manifest.sha256);
  assert.deepEqual(r.dialogs.map(d => [d.type, d.logout, d.confirmation, d.main, d.closed, d.accepted]), [['confirm', true, true, true, true, true]], 'logout:confirm-continuation (the one confirm accepted by the collector)');
  assert.equal(r.logouts, 1, 'logout:confirm-continuation (post-logout page requested once)');
  assert.deepEqual([r.record?.outcome, r.record?.finish?.settled, r.record?.finish?.loggedOut, r.record?.finish?.reason], ['completed', true, true, null], 'logout:adapter-reported-logged-out');
  assert.deepEqual([site.stats.posts, r.csvs, site.stats.foreign.length], [1, 1, 0], 'logout:once-only-login-and-export');
  assert.ok(!r.record.__text.includes(CANARY.dialog), 'logout:no-canary dialog text');
});

test('a bank that logs out without any dialog stays supported', { timeout: 300000 }, async () => {
  const site = bankSite({ logout: 'direct' }), r = await collect(site);
  captured(r); assert.equal(r.dialogs.length, 0); assert.equal(r.logouts, 1, 'logout:no-confirm-logout');
  assert.deepEqual([r.record?.finish?.loggedOut, r.record?.finish?.reason], [true, null], 'logout:no-confirm-logout');
});

test('once only: a second confirm after the accepted one is left to the person (no second answer, no second press)', { timeout: 300000 }, async () => {
  const site = bankSite({ logout: 'twice' }), r = await collect(site);
  captured(r);
  assert.deepEqual(r.dialogs.map(d => [d.type, d.closed, d.accepted]), [['confirm', true, true], ['confirm', false, null]], 'logout:answer-once');
  assert.equal(r.logouts, 0); assert.deepEqual([r.record?.finish?.loggedOut, r.record?.finish?.reason], [false, 'timeout'], 'logout:answer-once (timeout, not logged out)');
});

test('lifetime: a confirm that opens after finish() ended is never answered by a late callback', { timeout: 300000 }, async () => {
  const site = bankSite({ logout: 'late' });
  const r = await collect(site, { after: async dialogs => { assert.ok(await waitFor(() => dialogs.length > 0, LATE_MS + 8000), 'logout:late-dialog-opened'); await new Promise(res => setTimeout(res, 2500)); } });
  captured(r);
  assert.deepEqual(r.dialogs.map(d => [d.type, d.closed]), [['confirm', false]], 'logout:late-unanswered');
  assert.equal(r.logouts, 0); assert.deepEqual([r.record?.finish?.loggedOut, r.record?.finish?.reason], [false, 'timeout']);
});

test('after the own ログアウト press, out-of-scope dialogs stay unanswered: a generic confirm, a logout word without confirmation, an alert, a prompt, a confirm in a frame, on another origin, in another tab, a beforeunload', { timeout: 900000 }, async () => {
  for (const kind of ['generic', 'logout-only', 'alert', 'prompt', 'frame', 'wrong-origin', 'wrong-tab', 'beforeunload']) {
    const site = bankSite({ logout: kind }), r = await collect(site, { after: async dialogs => { await waitFor(() => dialogs.length > 0, 8000); } });
    captured(r, kind); untouched(r, site, kind);
    if (kind === 'alert' || kind === 'prompt') assert.equal(r.dialogs[0].type, kind);
    if (kind === 'beforeunload') assert.equal(r.dialogs[0].type, 'beforeunload', 'logout:beforeunload-opened');
    if (kind === 'frame' || kind === 'wrong-tab') assert.equal(r.dialogs[0].main, kind === 'frame', 'logout:dialog-location ' + kind);
    assert.equal(r.record?.finish?.loggedOut, false, 'logout:out-of-scope-not-logged-out ' + kind);
  }
});

test('dialogs before the own ログアウト press are never answered even with logout wording: on the Welcome page, on 照会, on CSV, and one left open before finish()', { timeout: 900000 }, async () => {
  // CSV confirm: no download, no logout under the open dialog (the legacy rule)
  const csv = bankSite({ csvConfirm: true }), rc = await collect(csv);
  untouched(rc, csv, 'csv'); assert.match(String(rc.result?.failed), /ダウンロードが完了しませんでした/); assert.equal(rc.csvs, 0);
  assert.equal(rc.record?.finish?.reason, 'dialog', 'logout:csv-confirm-unanswered');
  // 照会 confirm: no query result, no export
  const query = bankSite({ queryConfirm: true }), rq = await collect(query);
  untouched(rq, query, 'query'); assert.equal(rq.error?.code, 'period-query', 'logout:query-confirm-unanswered ' + String(rq.error?.code));
  // a confirm on the Welcome page right after the sign-in
  const welcome = bankSite({ welcomeConfirm: true }), rw = await collect(welcome, { ui: { settleMs: 6000 }, loginTimeoutMs: 10000 });
  untouched(rw, welcome, 'welcome'); assert.ok(rw.result?.failed || rw.error, 'logout:welcome-confirm-stops'); assert.equal(rw.csvs, 0);
  // one opened on the statement page during the download and still open when finish() starts
  const pre = bankSite({ preexisting: true }), rp = await collect(pre);
  untouched(rp, pre, 'preexisting'); assert.equal(rp.record?.finish?.reason, 'dialog', 'logout:preexisting-unanswered');
});

test('a failed retrieval still logs out through the observed confirm; the private diagnostic keeps no canary (dialog, body, account, password, query)', { timeout: 300000 }, async () => {
  const site = bankSite({ csvLinks: 2 }), r = await collect(site);
  assert.equal(r.error?.code, 'export-unidentified'); assert.equal(r.csvs, 0);
  assert.deepEqual(r.dialogs.map(d => [d.type, d.closed, d.accepted]), [['confirm', true, true]], 'logout:failure-logout-confirmed');
  assert.deepEqual([r.record?.outcome, r.record?.finish?.loggedOut, r.record?.page?.kind], ['failed', true, 'export_ready']);
  for (const v of [...Object.values(CANARY), SECRET.password, SECRET.account, 'ログアウトしますか', 'よろしい', ORIGIN]) assert.ok(!r.record.__text.includes(v), 'logout:no-canary ' + v);
});
