// collector/test/paypay-ready.test.mjs — plan omf-paypay-ready-20261024: the routine PayPay銀行 標準 statement page is recognized from its
// exact title and controls while its HTML is still parsing; the parent's one native trace (hub output/plan/omf-paypay-ready-20261024
// CAUSE.md / OBSERVATION.json) saw the single 期間選択 press at readyState=loading, 113 ms before DOMContentLoaded, and all six date
// fields stayed hidden. No live listener-registration timing was measured: the fake pages below only replay that mechanism (controls
// parsed and visible first, their handlers attached later by a slow external script, a deferred script or a ready callback), the shape of
// the parent's fictional proof READINESS-POC.json. Their DOM is invented and proves nothing about the real portal.
// Every page (popups included) of an owned HEADLESS Chrome is served by request interception at https://login.paypay-bank.co.jp; host
// resolution is refused for everything else, so no bank or other site can be reached. All documents and scripts declare UTF-8. Fictional
// login, account and statement values only. The real routineUi and bank.collectBankFromPage are tested, never a copy.
// Under OMF_TEST_PAYPAY_MODULE / OMF_TEST_BANK_MODULE the named mutant copies are tested instead (fixture omf-paypay-ready.mjs).
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

const ORIGIN = 'https://login.paypay-bank.co.jp', ENTRY = '/wctx/1D1DFxFDg.do', ACTION = '/wctx/NBCW2101.do';
const SECRET = Object.freeze({ branch: '012', account: '0012345', password: 'ReadyPw-4471' });
const OWNER = 'd4d4d4d4d4d4d4d4d4d4d4d4', ACCOUNT = 'b1b1b1b1b1b1b1b1b1b1b1b1', OMF = 'https://omf.example';
const NAMES = ['ShokaiStartDateNenIn', 'ShokaiStartDateTsukiIn', 'ShokaiStartDateHiIn', 'ShokaiEndDateNenIn', 'ShokaiEndDateTsukiIn', 'ShokaiEndDateHiIn'];
const COVERAGE = Object.freeze({ from: '2025-11-01', to: '2026-10-24' }), DEFAULT = Object.freeze({ from: '2026-07-24', to: '2026-10-24' });
const STEP_MS = 6000, SLOW_MS = 3000;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-paypay-ready-test-'));
test.after(async () => { if (path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(temp, { recursive: true, force: true }); });

// ── the fake portal ──
const STYLE = '<style>a,button,input,select{display:inline-block;margin:4px;padding:4px}</style>';
// Each statement document reports (to the intercepted /r/report) every click on a 期間選択 with its readiness and whether this
// document's handlers were attached yet, and each handled press / query — so a click is counted even if the document then leaves.
const REPORT = `<script>window.omf={attached:false};function omfSend(k){try{fetch('/r/report?'+new URLSearchParams({k:k,doc:String(performance.timeOrigin),ready:document.readyState,attached:String(window.omf.attached)}),{keepalive:true}).catch(function(){})}catch(e){}}
document.addEventListener('click',function(e){var t=e.target&&e.target.closest&&e.target.closest('.period');if(t)omfSend('click')},true);</script>`;
const doc = (title, body, head = '') => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title>${STYLE}${head}</head><body>${body}</body></html>`;
const loginDoc = () => doc('ログイン - PayPay銀行', `<form method="post" action="NBCW2101.do" name="HOST" onSubmit="return g(document.HOST)" target="_self"><input type="hidden" name="T" value="${randomUUID()}">
店番号 <input type="tel" name="TenNo" id="idTenNo" maxlength="3"> 口座番号 <input type="tel" name="KozaNo" id="idKozaNo" maxlength="7"> パスワード <input type="password" name="Pw" id="idPw" maxlength="32"> <input type="submit" name="login" value="ログイン"></form><script>function g(){return true}</script>`);
const welcomeDoc = () => doc('Welcome Page - PayPay銀行', `<a href="${ACTION}?p=balance">各種残高</a> <a href="${ACTION}?p=statements">普通預金取引明細照会</a> <a href="${ACTION}?p=logout">ログアウト</a>`);
const IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', GIF = Buffer.from(IMG.split(',')[1], 'base64');
const select = values => (name, i) => { const [lo, hi, unit] = [[2016, 2026, '年'], [1, 12, '月'], [1, 31, '日']][i % 3]; return `<select name="${name}">${Array.from({ length: hi - lo + 1 }, (_, k) => lo + k).map(n => `<option value="${n}"${n === values[i] ? ' selected' : ''}>${n}${unit}</option>`).join('')}</select>`; };
// The statement page: one visible 期間選択 (a javascript: link without inline handler), a visible ログアウト (a real link), CSV only when
// `csv`, and the panel holding the six named selects, an image 照会 and 閉じる (hidden unless `panel`).
const statementBody = ({ view, csv, panel }) => { const values = [...view.from.split('-'), ...view.to.split('-')].map(Number); return `<div id="account">普通 カクウ商事</div><a href="#">表示順</a> <a href="javascript:void(0)" class="period">期間選択</a> <a href="${ACTION}?p=pdf">PDF</a> ${csv ? '<a href="javascript:void(0)" class="csv">CSV</a> ' : ''}<a href="${ACTION}?p=welcome">Welcome Page</a> <a href="${ACTION}?p=logout" class="logout">ログアウト</a>
<div id="panel" style="display:${panel ? 'block' : 'none'}">${NAMES.map(select(values)).join(' ')} <input type="image" alt="照会" src="${IMG}" style="width:40px;height:20px" class="query"> <a href="javascript:void(0)" class="close">閉じる</a></div>
<p>${view.rows ? '照会結果 ' + view.from + '〜' + view.to : '照会条件に該当する取引明細はございません。'}</p>`; };
// The page's own handlers (attached by whichever script `attach` names). `inert`: 期間選択 does nothing; `init`: what the page's own
// initialization does right after attaching ('panel' shows the period fields, 'second-period' adds another visible 期間選択,
// 'other-field' adds a visible text field carrying the first date name).
const installSource = (s = {}) => `(function(){window.omf.attached=true;var panel=document.getElementById('panel'),N=${JSON.stringify(NAMES)};
function v(n){var e=[].slice.call(document.getElementsByName(n)).find(function(x){return x.getClientRects().length});return String(e.value).padStart(2,'0')}
function on(sel,fn){document.querySelectorAll(sel).forEach(function(e){e.addEventListener('click',function(ev){ev.preventDefault();fn()})})}
on('.period',function(){omfSend('handled');${s.inert ? '' : "panel.style.display='block';"}});
on('.close',function(){panel.style.display='none'});
on('.query',function(){omfSend('query');location.href='${ACTION}?p=result&from='+v(N[0])+'-'+v(N[1])+'-'+v(N[2])+'&to='+v(N[3])+'-'+v(N[4])+'-'+v(N[5])});
on('.csv',function(){var q=new URLSearchParams(location.search),w=window.open('about:blank','_blank');w.document.title='ダウンロード中 - PayPay銀行';setTimeout(function(){w.location.href=location.origin+'${ACTION}?p=csv&from='+q.get('from')+'&to='+q.get('to')},800)});
${s.init === 'panel' ? "panel.style.display='block';" : ''}${s.init === 'second-period' ? "var a=document.createElement('a');a.href='javascript:void(0)';a.className='period';a.textContent='期間選択';document.body.prepend(a);" : ''}${s.init === 'other-field' ? 'var t=document.createElement(\'input\');t.type=\'text\';t.name=N[0];document.body.prepend(t);' : ''}})();`;
// attach: 'blocking' — a slow parser-blocking external script after the controls registers the handlers on DOMContentLoaded (the
// parent's proof shape); 'tick' — the same, but its DOMContentLoaded callback attaches them one task later (a ready-callback library);
// 'defer' — a slow deferred script attaches them (readyState is already 'interactive' while it is pending, DOMContentLoaded follows it);
// 'inline' — an inline script attaches them on DOMContentLoaded (no delay). `never`: the slow script is never answered (loading forever).
// `imageMs`: an image held that long (DOMContentLoaded done, load pending).
const slowScript = s => s.attach === 'tick' ? `document.addEventListener('DOMContentLoaded',function(){setTimeout(function(){${installSource(s)}},0)})` : s.attach === 'defer' ? installSource(s) : `document.addEventListener('DOMContentLoaded',function(){${installSource(s)}})`;
function readyDoc(s) {
  const tail = s.attach === 'inline' ? `<script>document.addEventListener('DOMContentLoaded',function(){${installSource(s)}})</script>` : s.attach === 'defer' ? '<script defer src="/r/slow.js"></script>' : '<script src="/r/slow.js"></script>';
  return doc(s.title, statementBody({ view: { ...DEFAULT, rows: false }, csv: s.csvBefore, panel: s.panel }) + (s.imageMs ? '<img src="/r/slow.gif" width="1" height="1" alt="">' : '') + tail, REPORT);
}
// The page a query leads to (CSV shown, panel closed, handlers inline) and the other statement document of the "moved" cases.
const resultDoc = (from, to) => doc('普通預金取引明細照会 - PayPay銀行', statementBody({ view: { from, to, rows: true }, csv: true, panel: false }) + `<script>${installSource()}</script>`, REPORT);
const movedDoc = loading => doc('普通預金取引明細照会 - PayPay銀行', statementBody({ view: { ...DEFAULT, rows: false }, csv: false, panel: false }) + (loading ? '<script src="/r/never.js"></script>' : `<script>document.addEventListener('DOMContentLoaded',function(){${installSource()}})</script>`), REPORT);
const CSV_HEAD = '操作日(年),操作日(月),操作日(日),操作時刻(時),操作時刻(分),操作時刻(秒),取引順番号,摘要,お支払金額,お預り金額,残高,メモ';
const csvBytes = (from, to) => Buffer.from([CSV_HEAD, `${from.slice(0, 4)},${Number(from.slice(5, 7))},${Number(from.slice(8))},9,00,00,1,振込 カクウ,,50000,150000,`].join('\r\n') + '\r\n');
function site(options = {}) {
  const s = { title: '普通預金取引明細照会 - PayPay銀行', attach: 'blocking', delayMs: SLOW_MS, never: false, imageMs: 0, inert: false, panel: false, csvBefore: false, init: null, ...options };
  const stats = { posts: 0, requests: [], foreign: [], reports: [], queried: [], downloads: [], intercepted: 0 }, count = p => stats.requests.filter(r => r === p).length;
  const js = body => ({ status: 200, contentType: 'application/javascript; charset=utf-8', body });
  const respond = request => {
    stats.intercepted++;
    let url; try { url = new URL(request.url()); } catch { return request.abort(); }
    if (url.protocol === 'data:') return request.continue();
    if (url.origin !== ORIGIN) { stats.foreign.push(url.origin); return request.abort(); }
    if (url.pathname === '/r/report') { stats.reports.push(Object.fromEntries(url.searchParams)); return request.respond({ status: 204, body: '' }); }
    if (url.pathname === '/r/never.js' || (url.pathname === '/r/slow.js' && s.never)) return; // never answered: the document stays loading
    if (url.pathname === '/r/slow.js') { setTimeout(() => request.respond(js(slowScript(s))).catch(() => {}), s.delayMs); return; }
    if (url.pathname === '/r/slow.gif') { setTimeout(() => request.respond({ status: 200, contentType: 'image/gif', body: GIF }).catch(() => {}), s.imageMs); return; }
    const html = body => request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body });
    const p = url.searchParams.get('p') || (url.pathname === ENTRY ? 'entry' : request.method() === 'POST' ? 'post' : 'other'); stats.requests.push(p);
    if (p === 'entry' || p === 'logout') return html(loginDoc());
    if (p === 'post') { stats.posts++; return html(welcomeDoc()); }
    if (p === 'welcome') return html(welcomeDoc());
    if (p === 'statements') return html(readyDoc(s));
    if (p === 'moved') return html(movedDoc(false));
    if (p === 'moved-loading') return html(movedDoc(true));
    if (p === 'result') { const from = url.searchParams.get('from'), to = url.searchParams.get('to'); stats.queried.push([from, to]); return html(resultDoc(from, to)); }
    if (p === 'csv') { stats.downloads.push([url.searchParams.get('from'), url.searchParams.get('to')]); return request.respond({ status: 200, contentType: 'text/csv; charset=utf-8', headers: { 'Content-Disposition': 'attachment; filename="meisai.csv"' }, body: csvBytes(url.searchParams.get('from'), url.searchParams.get('to')) }); }
    return html(doc('PayPay銀行', '<p>other</p>'));
  };
  const of = k => stats.reports.filter(r => r.k === k);
  return { s, stats, count, respond, clicks: () => of('click').map(r => ({ ready: r.ready, attached: r.attached === 'true', doc: r.doc })), handled: () => of('handled').length, queries: () => of('query').length };
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
// The real routineUi on one page: its own entry document first (ui.open arms the dialog watch exactly as a job does), then the statement
// page, which selectPeriod gets as soon as the ui itself recognizes it (as openStatements' poll does) — or, with `readyFirst`, once it has
// fully loaded. `during` acts on the page while selectPeriod runs; `wrap` may wrap the page the ui is given.
async function direct(options, { stepMs = STEP_MS, readyFirst = false, during = null, wrap = null, expectEarly = !readyFirst } = {}) {
  const s = site(options);
  return owned(s, async ({ page, browser }) => {
    const dialogs = [], cdp = await page.createCDPSession(); await cdp.send('Page.enable');
    cdp.on('Page.javascriptDialogOpening', e => dialogs.push({ type: e.type, closed: false })); cdp.on('Page.javascriptDialogClosed', () => { const d = dialogs.at(-1); if (d) d.closed = true; });
    const ui = paypay.routineUi(wrap ? wrap(page) : page, browser, paypay.standard, null, { stepMs, finishMs: 10000 });
    await ui.open();
    const navigation = page.goto(ORIGIN + ACTION + '?p=statements', { waitUntil: 'load', timeout: 120000 }).catch(e => e);
    if (readyFirst) await navigation;
    let recognized = null; const t0 = Date.now();
    while (!recognized && Date.now() - t0 < 15000) { const k = (await ui.state()).kind; if (k === 'statements' || k === 'export_ready') recognized = await page.evaluate(() => ({ ready: document.readyState, attached: window.omf?.attached === true })).catch(() => null); else await pause(50); }
    assert.ok(recognized, 'setup:statement-page-recognized');
    if (expectEarly) assert.equal(recognized.attached, false, 'setup:recognized-before-handlers ' + JSON.stringify(recognized));
    const started = Date.now(), op = Promise.resolve().then(() => ui.selectPeriod(COVERAGE)).then(() => null, e => e);
    if (during) await during({ page, s });
    const error = await Promise.race([op, pause(stepMs + 40000).then(() => ({ code: 'hung' }))]), elapsed = Date.now() - started;
    await pause(700); // the page's own click/handled/query reports are sent asynchronously
    const kind = await Promise.race([ui.state().then(x => x.kind), pause(6000).then(() => 'unreadable')]);
    const seen = dialogs.map(d => ({ ...d })); // as the ui left them, before this test dismisses any for cleanup
    for (const d of dialogs) if (!d.closed) await cdp.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
    return { error, code: error?.code ?? null, message: String(error?.message || ''), elapsed, recognized, kind, dialogs: seen, clicks: s.clicks(), handled: s.handled(), queries: s.queries(), queried: s.stats.queried, foreign: s.stats.foreign, intercepted: s.stats.intercepted };
  });
}
const shape = r => JSON.stringify({ code: r.code, clicks: r.clicks, handled: r.handled, queries: r.queries, queried: r.queried, kind: r.kind, elapsed: r.elapsed, recognized: r.recognized });
function selectedOnce(r, label) {
  assert.equal(r.code, null, 'ready:one-handled-click ' + label + ' ' + shape(r) + ' ' + r.message);
  assert.equal(r.clicks.length, 1, 'ready:one-handled-click ' + label + ' (one press) ' + shape(r));
  assert.ok(r.clicks[0].attached && r.clicks[0].ready !== 'loading', 'ready:one-handled-click ' + label + ' (after the handlers) ' + shape(r));
  assert.deepEqual([r.handled, r.queries, r.queried], [1, 1, [[COVERAGE.from, COVERAGE.to]]], 'ready:one-handled-click ' + label + ' (one query of the frozen period) ' + shape(r));
  assert.equal(r.kind, 'export_ready', 'ready:one-handled-click ' + label + ' (export_ready) ' + shape(r));
  assert.equal(r.foreign.length, 0, 'ready:no-foreign-request');
}
function nothingPressed(r, label) {
  assert.equal(r.clicks.length, 0, 'ready:no-press ' + label + ' ' + shape(r));
  assert.deepEqual([r.handled, r.queries, r.queried.length], [0, 0, 0], 'ready:no-query ' + label + ' ' + shape(r));
  assert.equal(r.code, 'period-unidentified', 'ready:period-unidentified ' + label + ' ' + shape(r) + ' ' + r.message);
}

test('setup: the fictional replica itself — a click before its handlers attach is lost, one after DOMContentLoaded is handled; every request intercepted', { timeout: 120000 }, async () => {
  const s = site();
  await owned(s, async ({ page }) => {
    const navigation = page.goto(ORIGIN + ACTION + '?p=statements', { waitUntil: 'domcontentloaded', timeout: 60000 });
    let early = null; for (let n = 0; n < 300 && !early; n++) { early = await page.evaluate(() => { const a = document.querySelector('.period'); if (!a) return null; const r = { ready: document.readyState, attached: window.omf.attached }; a.click(); return r; }).catch(() => null); if (!early) await pause(10); }
    await navigation; await pause(300);
    const late = await page.evaluate(() => { document.querySelector('.period').click(); return { ready: document.readyState, attached: window.omf.attached, panel: getComputedStyle(document.getElementById('panel')).display }; });
    await pause(700);
    assert.deepEqual(early, { ready: 'loading', attached: false }, 'setup:replica-early-state');
    assert.deepEqual([s.clicks().length, s.handled()], [2, 1], 'setup:replica-early-lost-late-handled ' + JSON.stringify(s.clicks()));
    assert.equal(late.panel, 'block', 'setup:replica-late-opens-panel');
    assert.equal(s.stats.foreign.length, 0, 'setup:replica-no-foreign');
  });
});

test('delayed handlers: a statement page recognized while still loading gets exactly one 期間選択 press, after DOMContentLoaded, and one query of the frozen period', { timeout: 300000 }, async () => {
  // blocking: the parent's proof shape; tick: attached one task after DOMContentLoaded; defer: 'interactive' long before DOMContentLoaded
  for (const attach of ['blocking', 'tick', 'defer']) {
    const r = await direct({ attach });
    if (attach === 'defer') assert.equal(r.recognized.ready, 'interactive', 'setup:defer-interactive-before-dcl ' + JSON.stringify(r.recognized));
    else assert.equal(r.recognized.ready, 'loading', 'setup:recognized-while-loading ' + JSON.stringify(r.recognized));
    selectedOnce(r, attach);
    assert.ok(r.elapsed < SLOW_MS + STEP_MS, 'ready:within-step-window ' + attach + ' ' + r.elapsed);
  }
});

test('already ready and normal views keep their contract: a loaded page gets one press; DOMContentLoaded without load does not wait for load; visible fields need no press; an inert ready 期間選択 is pressed once and fails as before', { timeout: 300000 }, async () => {
  const ready = await direct({ attach: 'inline' }, { readyFirst: true });
  selectedOnce(ready, 'already-ready');
  // DOMContentLoaded finished, an image still held for 8 s: the press is not held for the load event
  const image = await direct({ attach: 'inline', imageMs: 8000 }, { expectEarly: false });
  selectedOnce(image, 'dcl-without-load');
  assert.ok(image.clicks[0].ready === 'interactive' && image.elapsed < 6000, 'ready:dcl-without-load ' + shape(image));
  // the six fields already shown on a loaded page: no 期間選択 press, one query
  const shown = await direct({ attach: 'inline', panel: true }, { readyFirst: true });
  assert.deepEqual([shown.code, shown.clicks.length, shown.queries, shown.queried], [null, 0, 1, [[COVERAGE.from, COVERAGE.to]]], 'ready:visible-fields-no-press ' + shape(shown));
  // a 期間選択 that does nothing on a loaded page: pressed once (never twice), the existing 15 s field window, period-unidentified
  const inert = await direct({ attach: 'inline', inert: true }, { readyFirst: true });
  assert.deepEqual([inert.code, inert.clicks.length, inert.handled, inert.queries], ['period-unidentified', 1, 1, 0], 'ready:inert-pressed-once ' + shape(inert));
  assert.match(inert.message, /missing\/missing\/missing\/missing\/missing\/missing/, 'ready:inert-existing-message');
});

test('page initialization that shows the period fields itself: nothing is pressed, one query', { timeout: 120000 }, async () => {
  const r = await direct({ attach: 'blocking', init: 'panel' });
  assert.deepEqual([r.code, r.clicks.length, r.queries, r.queried], [null, 0, 1, [[COVERAGE.from, COVERAGE.to]]], 'ready:init-shown-no-press ' + shape(r) + ' ' + r.message);
});

test('never ready: a statement page that keeps loading gets no press and no query, and ends period-unidentified within the step window', { timeout: 180000 }, async () => {
  const r = await direct({ attach: 'blocking', never: true });
  assert.equal(r.clicks.length, 0, 'ready:never-ready-no-press ' + shape(r));
  assert.deepEqual([r.handled, r.queries, r.queried.length], [0, 0, 0], 'ready:never-ready-no-query ' + shape(r));
  assert.ok(r.code !== 'hung' && r.elapsed >= STEP_MS - 500 && r.elapsed < STEP_MS + 7000, 'ready:never-ready-bounded ' + shape(r));
  assert.equal(r.code, 'period-unidentified', 'ready:never-ready-code ' + shape(r) + ' ' + r.message);
  assert.match(r.message, /期間選択は押していません/, 'ready:never-ready-explained');
});

test('another document, title, login page or origin during the wait: no press, no query, period-unidentified', { timeout: 600000 }, async () => {
  const go = to => async ({ page }) => { await pause(800); await page.evaluate(u => { location.replace(u); }, to).catch(() => {}); };
  for (const [label, during] of [
    ['moved', go(ORIGIN + ACTION + '?p=moved')],
    ['login', go(ORIGIN + ACTION + '?p=logout')],
    ['foreign', go('https://www.paypay-bank.example/')],
    ['title', async ({ page }) => { await pause(800); await page.evaluate(() => { document.title = 'お知らせ - PayPay銀行'; }); }]]) {
    const r = await direct({ attach: 'blocking' }, { during });
    nothingPressed(r, label);
    if (label === 'foreign') assert.ok(r.foreign.length >= 1, 'setup:foreign-attempted');
  }
  // moved to another statement document that itself keeps loading: the wait stops at the document change, not at the window's end
  const slow = await direct({ attach: 'blocking', never: true }, { stepMs: 20000, during: go(ORIGIN + ACTION + '?p=moved-loading') });
  nothingPressed(slow, 'moved-loading');
  assert.ok(slow.elapsed < 8000, 'ready:stops-promptly moved-loading ' + shape(slow));
  // the document is replaced right after its readiness was answered (between the ready answer and the press): the press stays bound to
  // the recognized document and the replacement is never pressed
  let swapped = false;
  const wrap = page => new Proxy(page, { get(target, key) {
    if (key === 'evaluate') return async (fn, ...args) => {
      const result = await target.evaluate(fn, ...args);
      if (!swapped && result && typeof result === 'object' && result.ready === true && 'document' in result) {
        swapped = true; await target.evaluate(u => { location.replace(u); }, ORIGIN + ACTION + '?p=moved').catch(() => {});
        for (let n = 0; n < 100; n++) { const now = await target.evaluate(() => ({ d: String(performance.timeOrigin), r: document.readyState, a: window.omf?.attached === true })).catch(() => null); if (now && now.d !== result.document && now.r === 'complete' && now.a) break; await pause(50); }
      }
      return result;
    };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const between = await direct({ attach: 'blocking' }, { wrap });
  assert.ok(swapped, 'setup:swapped-after-ready-answer');
  nothingPressed(between, 'between-ready-and-press');
});

test('a dialog during the wait is never answered and nothing is pressed', { timeout: 180000 }, async () => {
  const r = await direct({ attach: 'blocking', never: true }, { during: async ({ page }) => { await pause(800); await page.evaluate(() => { setTimeout(() => alert('お知らせ'), 0); }); } });
  nothingPressed(r, 'dialog');
  assert.deepEqual(r.dialogs.map(d => [d.type, d.closed]), [['alert', false]], 'ready:dialog-unanswered ' + JSON.stringify(r.dialogs));
  assert.equal(r.kind, 'verification', 'ready:dialog-verification');
  assert.ok(r.elapsed < STEP_MS, 'ready:dialog-stops ' + r.elapsed);
});

test('ambiguity or a non-select date field appearing at initialization: no press', { timeout: 300000 }, async () => {
  const two = await direct({ attach: 'blocking', init: 'second-period' });
  nothingPressed(two, 'second-period'); assert.match(two.message, /ambiguous/, 'ready:ambiguous-explained');
  const other = await direct({ attach: 'blocking', init: 'other-field' });
  nothingPressed(other, 'other-field'); assert.match(other.message, /確認済みの形と異なります/, 'ready:other-field-explained');
});

// ── end to end through bank.collectBankFromPage ──
function savedLogin() {
  const calls = { open: 0, rejected: [], accepted: 0 }; let current = 'ready';
  return { calls, async state() { return current; }, async open() { calls.open++; return { ...SECRET }; }, async rejected(kind = 'uncertain') { calls.rejected.push(kind); current = kind === 'refused' ? 'refused' : 'blocked'; }, async accepted() { calls.accepted++; current = 'ready'; } };
}
const snapshotOf = () => Object.freeze({ templateId: null, templateRevision: 0, headers: [], mapping: {}, amountSign: 'outflow-positive', transactionIdConfirmed: false, parserVersion: 'bank-template-1', currency: 'JPY', provider: 'paypay', accountLabel: null, variant: 'standard', coverage: Object.freeze({ ...COVERAGE }), interpretation: 'unmapped' });
const jobOf = () => { const snapshot = snapshotOf(); return { jobId: randomUUID(), kind: 'retrieve', snapshot, snapshotHash: sha256(JSON.stringify(snapshot)), provider: 'paypay' }; };
const boundOf = job => ({ bankAccountId: ACCOUNT, ownerId: OWNER, origin: OMF, jobId: job.jobId, snapshotHash: job.snapshotHash, provider: 'paypay' });
const adapter = stepMs => ({ ...paypay.standard, ui(page, browser, snapshot) { return paypay.routineUi(page, browser, this, snapshot, { settleMs: 20000, stableMs: 800, stepMs, finishMs: 10000 }); } });
async function collect(s, { job = jobOf(), root = null, stepMs = 15000 } = {}) {
  root ??= path.join(temp, 'root-' + randomUUID().slice(0, 8)); await mkdir(root, { recursive: true });
  const login = savedLogin();
  return owned(s, async ({ page, browser }) => {
    let result = null, error = null; const started = Date.now();
    try { result = await bank.collectBankFromPage(page, browser, adapter(stepMs), boundOf(job), job, root, async () => {}, { login, pollMs: 300, loginTimeoutMs: 45000, downloadTimeoutMs: 45000, extensionMs: 0 }); } catch (e) { error = e; }
    const elapsed = Date.now() - started; await pause(700);
    return { result, error, job, root, login, elapsed, jobDir: path.join(root, 'outbox', 'bank', ACCOUNT, job.jobId), clicks: s.clicks(), handled: s.handled(), queries: s.queries() };
  });
}
async function diagnostics(root) {
  const dir = path.join(root, 'diagnostics', 'bank', ACCOUNT); let names = [];
  try { names = await readdir(dir); } catch { return []; }
  return Promise.all(names.sort().map(async n => { const text = await readFile(path.join(dir, n), 'utf8'); return { ...JSON.parse(text), __text: text }; }));
}

test('end to end (collectBankFromPage): a slowly initializing statement page — the empty default view and a view already showing CSV — one sign-in, one press, one query of the frozen period, one CSV, logout once; a rerun of the job acts on nothing and overwrites nothing', { timeout: 600000 }, async () => {
  for (const [label, options] of [['empty-default', {}], ['existing-csv', { csvBefore: true }]]) {
    const s = site({ attach: 'blocking', ...options }), job = jobOf(), frozen = JSON.stringify(job.snapshot), hash = job.snapshotHash;
    const r = await collect(s, { job });
    assert.equal(r.error, null, 'ready:e2e-completed ' + label + ' ' + String(r.error?.code || '') + ' ' + String(r.error?.message || '') + ' ' + JSON.stringify({ clicks: r.clicks, handled: r.handled, queries: r.queries }));
    assert.deepEqual([r.clicks.length, r.clicks[0]?.attached, r.handled, r.queries], [1, true, 1, 1], 'ready:e2e-one-handled-press ' + label + ' ' + JSON.stringify(r.clicks));
    assert.deepEqual([s.stats.posts, r.login.calls.open, s.count('statements'), s.count('result'), s.count('csv'), s.count('logout')], [1, 1, 1, 1, 1, 1], 'ready:e2e-once-each ' + label);
    assert.deepEqual(s.stats.queried, [[COVERAGE.from, COVERAGE.to]], 'ready:e2e-frozen-period-queried ' + label);
    assert.deepEqual(s.stats.downloads, [[COVERAGE.from, COVERAGE.to]], 'ready:e2e-export-is-frozen-period ' + label);
    assert.equal(r.result.items.length, 1); const m = r.result.items[0].manifest;
    assert.deepEqual([m.jobId, m.snapshotHash, m.sourceHost, m.period], [job.jobId, hash, 'login.paypay-bank.co.jp', COVERAGE.from + '〜' + COVERAGE.to], 'ready:e2e-manifest-bound ' + label);
    const file = path.join(r.jobDir, m.filename), before = sha256(await readFile(file)), manifestBefore = await readFile(path.join(r.jobDir, 'manifest.json'));
    assert.equal(before, m.sha256, 'ready:e2e-file-hash');
    assert.deepEqual([JSON.stringify(job.snapshot), sha256(JSON.stringify(job.snapshot))], [frozen, hash], 'ready:e2e-coverage-immutable ' + label);
    assert.equal(s.stats.foreign.length, 0, 'ready:no-foreign-request');
    // the same job again (a reclaimed or repeated run): no sign-in, press, query or export; the original and its manifest are unchanged
    const again = site({ attach: 'blocking', ...options }), r2 = await collect(again, { job, root: r.root });
    assert.deepEqual([again.stats.posts, r2.login.calls.open, r2.clicks.length, again.stats.queried.length, again.count('csv')], [0, 0, 0, 0, 0], 'ready:e2e-rerun-acts-on-nothing ' + label);
    assert.equal(sha256(await readFile(file)), before, 'ready:e2e-no-overwrite ' + label); assert.deepEqual(await readFile(path.join(r.jobDir, 'manifest.json')), manifestBefore, 'ready:e2e-no-overwrite manifest ' + label);
  }
});

test('end to end: a statement page that never finishes loading — no press, no query, no export or attempt; the private diagnostic records the loading page; logout once', { timeout: 300000 }, async () => {
  const s = site({ attach: 'blocking', never: true }), r = await collect(s, { stepMs: 8000 });
  assert.equal(r.error?.code, 'period-unidentified', 'ready:e2e-never-ready-code ' + String(r.error?.code) + ' ' + String(r.error?.message || ''));
  assert.deepEqual([r.clicks.length, r.handled, r.queries, s.stats.queried.length, s.count('csv')], [0, 0, 0, 0, 0], 'ready:e2e-never-ready-no-press ' + JSON.stringify(r.clicks));
  assert.equal(r.result, null);
  assert.deepEqual(await readdir(r.jobDir).then(n => n.filter(x => x !== 'login.json'), () => []), [], 'ready:e2e-never-ready-no-attempt');
  assert.equal(s.count('logout'), 1, 'ready:e2e-never-ready-logout');
  assert.ok(r.elapsed < 8000 + 45000, 'ready:e2e-never-ready-bounded ' + r.elapsed);
  const list = await diagnostics(r.root); assert.equal(list.length, 1, 'ready:e2e-diagnostic-written'); const d = list[0];
  assert.deepEqual([d.step, d.code, d.page?.kind, d.page?.readyState, d.page?.lastPress], ['period', 'period-unidentified', 'statements', 'loading', 'open'], 'ready:e2e-diagnostic-loading ' + JSON.stringify(d.page));
  for (const v of [SECRET.account, SECRET.password, ORIGIN, 'カクウ', '照会条件']) assert.ok(!d.__text.includes(v), 'ready:e2e-diagnostic-value-free ' + v);
  assert.equal(s.stats.foreign.length, 0, 'ready:no-foreign-request');
});
