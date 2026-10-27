// collector/test/bank-balance.test.mjs — the read-only balance inquiry of the hourly background balances (plan
// omf-bank-hourly-balances-20261027): collector/bank-balance.mjs on an owned HEADLESS Chrome whose every request is answered by a
// fictional bank served through request interception (host resolution refused for everything else, so no bank or other site can be
// reached), and its durable balance-only receipt. The fake pages follow the parent's SAFE-BANK-CONTRACT.json / RAKUTEN-LOGOUT-CONTRACT.json
// facts (field labels, timestamp formats, yen syntax, the image ログアウト of 楽天銀行) and the existing login contracts only; they prove the
// reader against those facts, never against the real bank pages (the parent validates those separately). Fictional values only.
// Under OMF_TEST_BALANCE_MODULE / OMF_TEST_RAKUTEN_MODULE / OMF_TEST_PAYPAY_MODULE / OMF_TEST_IKEDA_MODULE the named mutant copies are tested.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import puppeteer from 'rebrowser-puppeteer-core';

const moduleOf = (env, rel) => process.env[env] ? pathToFileURL(process.env[env]).href : new URL(rel, import.meta.url).href;
const B = await import(moduleOf('OMF_TEST_BALANCE_MODULE', '../bank-balance.mjs'));
const rakuten = await import(moduleOf('OMF_TEST_RAKUTEN_MODULE', '../banks/rakuten.mjs'));
const paypay = await import(moduleOf('OMF_TEST_PAYPAY_MODULE', '../banks/paypay.mjs'));
const ikeda = await import(moduleOf('OMF_TEST_IKEDA_MODULE', '../banks/ikeda.mjs'));
const { findChrome, LAUNCH_ARGS } = await import('../browser.mjs');
const F = await import(new URL('../../scripts/zoomer-fixtures/omf-ikeda-collector.mjs', import.meta.url).href);

const OWNER = 'd6d6d6d6d6d6d6d6d6d6d6d6', ACCOUNT = 'c2c2c2c2c2c2c2c2c2c2c2c2', OMF = 'https://omf.example';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = p => access(p).then(() => true, () => false);
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-bank-balance-test-'));
// Fixture-owned Chrome lifecycle (the full run of 97a9b93 failed here: Target.setDiscoverTargets timed out while Chrome started, puppeteer's
// failure path killed it without waiting, and the cleanup then met EBUSY on the still-held profile lockfile). A profile is removed only once
// no chrome.exe of THIS test's profiles is left (read from the process list, bounded); a profile still held is a failure, never ignored.
const execute = (file, args) => new Promise(resolve => execFile(file, args, { windowsHide: true, timeout: 20000 }, (error, stdout) => resolve(error ? null : String(stdout))));
async function chromesOf(profile) {
  const out = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ForEach-Object { $_.ProcessId.ToString() + ' ' + $_.CommandLine }"]);
  if (out === null) return null; // unreadable process list: unknown, never "released"
  return out.split(/\r?\n/).filter(l => l.includes(profile)).map(l => Number(l.split(' ')[0]));
}
async function released(profile, ms = 30000) { const until = Date.now() + ms; while (Date.now() < until) { const left = await chromesOf(profile); if (left && !left.length) return true; await new Promise(r => setTimeout(r, 500)); } return false; }
const profiles = [];
test.after(async () => {
  for (const profile of profiles) if (!(await released(profile))) throw new Error('owned Chrome still holds ' + path.basename(profile) + ' at cleanup');
  if (!path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) return;
  for (let i = 0; ; i++) { try { await rm(temp, { recursive: true, force: true }); return; } catch (error) { if (error?.code !== 'EBUSY' || i >= 5) throw error; await new Promise(r => setTimeout(r, 1000)); } }
});
async function launchOwned(profile) {
  for (let attempt = 1; ; attempt++) {
    const t = Date.now();
    try { const browser = await puppeteer.launch({ executablePath: findChrome(), pipe: true, headless: true, userDataDir: profile, defaultViewport: null, protocolTimeout: 30000, args: [...LAUNCH_ARGS, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] }); if (attempt > 1) console.log('# owned Chrome ready on attempt ' + attempt + ' after ' + (Date.now() - t) + ' ms'); return browser; }
    catch (error) {
      const free = await released(profile);
      console.log('# owned Chrome launch attempt ' + attempt + ' failed after ' + (Date.now() - t) + ' ms (' + (error?.name || 'Error') + ': ' + String(error?.message || '').slice(0, 120) + '); its profile ' + (free ? 'released' : 'STILL HELD'));
      if (attempt >= 2 || !free) throw error;
    }
  }
}
async function closeOwned(browser) {
  const child = browser.process();
  await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 10000))]);
  if (child && child.exitCode === null && child.signalCode === null) { try { child.kill(); } catch { /* gone */ } await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 10000))]); }
}
// The bank's own JST display of an instant: 'YYYY/MM/DD HH:mm(:ss)' or 'YYYY-MM-DD HH:mm'.
const shown = (ms, sep = '/', seconds = false) => { const d = new Date(ms + 9 * 3600000).toISOString(); return d.slice(0, 10).replace(/-/g, sep) + ' ' + d.slice(11, seconds ? 19 : 16); };
const minute = ms => new Date(Math.floor(ms / 60000) * 60000).toISOString();
const STYLE = '<style>a,button,input,select{display:inline-block;margin:4px;padding:4px}</style>';
const doc = (title, body) => `<!doctype html><html lang="ja"><meta charset="utf-8"><title>${title}</title>${STYLE}<body>${body}</body></html>`;
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// ── 楽天銀行 (標準): the recorded START_CORP login form, the MyAccount home with both balances, the image-only ログアウト ──
function rakutenSite(o = {}) {
  const s = { bankMs: Date.now() - 120000, amount: '<span>1,234,567</span> 円', available: '(1,200,000円)', duplicate: false, hidePrimary: false, noTime: false, logout: 'login', logoutId: 'j_idt' + Math.floor(Math.random() * 900 + 100) + ':j_idt7', afterLogin: 'home', ...o };
  const stats = { posts: 0, requests: [], foreign: [], logout: 0, downloads: 0 };
  const login = () => doc('楽天銀行 ログイン', `<form id="LOGIN" name="LOGIN" method="post" action="/XMS/security/fcs/rb/fes/views/mainservice/Security/LoginAuthentication/Login/CorpLogin.xhtml"><input type="text" id="LOGIN:USER_ID" name="LOGIN:USER_ID"><input type="password" id="LOGIN:LOGIN_PASSWORD" name="LOGIN:LOGIN_PASSWORD"><input type="submit" value="ログイン"></form>`);
  const row = (label, amount, hidden = false) => `<tr${hidden ? ' style="display:none"' : ''}><td><table><tr><td>${label}</td></tr></table></td><td><table><tr><td>${amount}</td></tr></table></td><td><a href="#">明細</a></td></tr>`;
  const home = () => doc('楽天銀行 MyAccount', `<table><tr><td><a href="#">入出金明細</a> <a href="#">登録情報の照会・変更</a></td><td><a id="${s.logoutId}" href="#" onclick="location.href='/XMS/security/RbS?COMMAND=LOGOUT';return false;"> \n <img alt="ログアウト" src="${GIF}" width="60" height="20"> </a></td></tr></table>
<table class="balances">${row('普通預金残高', s.amount, s.hidePrimary)}${s.duplicate ? row('普通預金残高', '9,999 円') : ''}${row('支払可能残高', s.available)}</table>${s.noTime ? '' : `<p><span>残高確認時間:</span> <span>${shown(s.bankMs)}</span></p>`}<p>普通 1234567（架空）</p>`);
  const respond = request => {
    let url; try { url = new URL(request.url()); } catch { return request.abort(); }
    if (url.protocol === 'data:') return request.continue();
    const html = body => request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body });
    if (url.origin !== 'https://fes.rakuten-bank.co.jp') { stats.foreign.push(url.origin); return request.abort(); }
    stats.requests.push(request.method() + ' ' + url.pathname + (url.search.includes('LOGOUT') ? '?LOGOUT' : ''));
    if (url.pathname === '/XMS/security/RbS' && url.searchParams.get('COMMAND') === 'LOGOUT') { stats.logout++; return html(s.logout === 'login' ? login() : s.logout === 'thanks' ? doc('楽天銀行', '<p>ログアウトしました。ご利用ありがとうございました。</p>') : doc('楽天銀行 MyAccount', '<p>処理中</p><a href="#"><img alt="ログアウト" src="' + GIF + '" width="60" height="20"></a>')); }
    if (url.pathname === '/XMS/security/RbS') return html(login());
    if (request.method() === 'POST' && /CorpLogin\.xhtml$/.test(url.pathname)) { stats.posts++; if (s.afterLogin === 'reject') return html(login()); if (s.afterLogin === 'verify') return html(doc('追加認証', '<p>ワンタイム認証コードを入力してください</p><input type="text"><button>次へ</button>')); return html(doc('', "<script>location.replace('/XMS/inquiry/gns')</script>")); }
    if (url.pathname === '/XMS/inquiry/gns') return html(home());
    return html(doc('楽天銀行', '<p>other</p>'));
  };
  return { s, stats, respond };
}
// ── PayPay銀行 (標準): the observed entry form, Welcome with 残高照会, the 残高照会 page (#mainArea), ログアウト with its confirm ──
const PP = 'https://login.paypay-bank.co.jp', PP_ACTION = '/wctx/NBCW2101.do';
function paypaySite(o = {}) {
  const s = { bankMs: Date.now() - 90000, accountShown: '0012345', amount: '98,765 円', seconds: true, duplicate: false, mode: 'ok', confirm: true, ...o };
  const stats = { posts: 0, requests: [], foreign: [], logout: 0, balancePages: 0, submitted: [] };
  const login = () => doc('ログイン - PayPay銀行', `<form method="post" action="NBCW2101.do" name="HOST" onSubmit="return true" target="_self">店番号 <input type="tel" name="TenNo" id="idTenNo" maxlength="3"> 口座番号 <input type="tel" name="KozaNo" id="idKozaNo" maxlength="7"> パスワード <input type="password" name="Pw" id="idPw" maxlength="32"> <input type="submit" name="login" value="ログイン"></form>`);
  const logoutLink = `<a href="#" onclick="${s.confirm ? "if(!confirm('ログアウトしてもよろしいですか？'))return false;" : ''}location.href='${PP_ACTION}?p=logout';return false;">ログアウト</a>`;
  const welcome = () => doc('Welcome Page - PayPay銀行', `<a href="${PP_ACTION}?p=balance">残高照会</a> <a href="${PP_ACTION}?p=statements">普通預金取引明細照会</a> ${logoutLink}`);
  const balance = () => doc('残高照会 - PayPay銀行', `<div id="mainArea"><p>店番号 012 口座番号 ${s.accountShown} 普通 カクウ商事（架空）</p><table><tr><th>普通預金残高</th><td>${s.amount}</td></tr><tr><th>お引出し可能額</th><td>－</td></tr></table>${s.duplicate ? '<table><tr><th>普通預金残高</th><td>1 円</td></tr></table>' : ''}<p>${shown(s.bankMs, '/', s.seconds)}現在</p></div> ${logoutLink}`);
  const respond = request => {
    let url; try { url = new URL(request.url()); } catch { return request.abort(); }
    if (url.protocol === 'data:') return request.continue();
    const html = body => request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body });
    if (url.origin !== PP) { stats.foreign.push(url.origin); return request.abort(); }
    const p = url.searchParams.get('p') || (url.pathname === '/wctx/1D1DFxFDg.do' ? 'entry' : request.method() === 'POST' ? 'post' : 'other'); stats.requests.push(p);
    if (p === 'entry') return html(login());
    if (p === 'post') { stats.posts++; const b = new URLSearchParams(request.postData() || ''); stats.submitted.push(b.get('KozaNo')); if (s.mode === 'reject') return html(login()); if (s.mode === 'notice') return html(doc('お知らせ - PayPay銀行', `<p>重要なお知らせ</p><a href="${PP_ACTION}?p=welcome">次へ</a> ${logoutLink}`)); return html(welcome()); }
    if (p === 'welcome') return html(welcome());
    if (p === 'balance') { stats.balancePages++; return html(balance()); }
    if (p === 'logout') { stats.logout++; return html(login()); }
    return html(doc('PayPay銀行', '<p>other</p>'));
  };
  return { s, stats, respond };
}
// ── 池田泉州銀行 ビジネスゲート: the existing fictional BusinessGate login (omf-ikeda-collector.mjs), its signed-in home replaced by a
// dashboard whose 各口座残高 (#DsbAccounts) renders late: the shell first, the account cards seconds later.
function ikedaSite(o = {}) {
  const s = { bankMs: Date.now() - 600000, cardsAfterMs: 2500, card: null, cards: null, ...o };
  const site = F.businessGate({ cert: 'manual', today: F.jstNow() }), original = site.respond, stats = { dashboards: 0 };
  const card = (number, amount, change = '<p>前日比 <span>▲</span>￥12,000</p>', time = `<p>最終取得日：${shown(s.bankMs, '-')}</p>`) => `<div class="card"><p>カクウ支店 普通 ${number}</p><p class="amount">${amount}</p>${change}${time}</div>`;
  const cards = s.cards ?? [card(F.IDENTITY.number, '¥5,550,000'), card('0000002', '￥9,999,999')];
  const dashboard = () => doc('池田泉州ビジネスゲート', `<div id="app"></div><script>setTimeout(()=>{document.getElementById('app').innerHTML='<nav><a href="https://www.sihd-bk.jp/corporation/">ログアウト</a> <a href="/account-statements">入出金明細</a></nav><section id="DsbAccounts"><h2>各口座残高</h2><div id="cards"></div><p>合計 ¥15,549,999</p></section>';setTimeout(()=>{document.getElementById('cards').innerHTML=${JSON.stringify((s.card ?? cards).join(''))};},${s.cardsAfterMs});},700)</script>`);
  site.respond = request => { let url; try { url = new URL(request.url()); } catch { return request.abort(); } if (url.origin === F.PORTAL && url.pathname === '/' && site.stats.loggedIn) { stats.dashboards++; return request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: dashboard() }); } return original(request); };
  return { s, site, stats, respond: r => site.respond(r), card };
}
async function owned(site, fn) {
  const profile = path.join(temp, 'profile-' + randomUUID().slice(0, 8)); profiles.push(profile);
  const browser = await launchOwned(profile);
  const dialogs = [], downloads = [];
  const attach = async page => { await page.setRequestInterception(true); page.on('request', r => site.respond(r)); const cdp = await page.createCDPSession(); await cdp.send('Page.enable'); cdp.on('Page.javascriptDialogOpening', e => dialogs.push({ type: e.type, message: e.message })); };
  const ready = page => (page.__attached ??= attach(page));
  browser.on('targetcreated', async target => { if (target.type() !== 'page') return; try { const page = await target.page(); if (page) await ready(page); } catch { /* closed */ } });
  const watcher = await browser.target().createCDPSession(); await watcher.send('Browser.setDownloadBehavior', { behavior: 'deny', eventsEnabled: true }).catch(() => {}); watcher.on('Browser.downloadWillBegin', e => downloads.push(e.url));
  try { const page = await browser.newPage(); await ready(page); if (site.site) site.site.pages.push(page); return await fn({ page, browser, dialogs, downloads }); }
  finally { await closeOwned(browser); }
}
function savedLogin(secret, state = 'ready') {
  const calls = { state: 0, open: 0, rejected: [], accepted: 0 }; let current = state;
  return { calls, async state() { calls.state++; return current; }, async open() { calls.open++; return { ...secret }; }, async rejected(kind = 'uncertain') { calls.rejected.push(kind); current = kind === 'refused' ? 'refused' : 'blocked'; }, async accepted() { calls.accepted++; current = 'ready'; } };
}
const jobOf = (provider, variant, extra = {}) => { const snapshot = { kind: 'balance', parserVersion: 'bank-balance-1', provider, variant, currency: 'JPY', ...extra }; return { jobId: randomUUID(), kind: 'balance', snapshot, snapshotHash: sha256(JSON.stringify(snapshot)), provider }; };
const boundOf = job => ({ bankAccountId: ACCOUNT, ownerId: OWNER, origin: OMF, jobId: job.jobId, snapshotHash: job.snapshotHash, provider: job.snapshot.provider });
const rakutenAdapter = (o = {}) => ({ ...rakuten.standardBalance, ui(page, browser, snapshot) { return rakuten.balanceUi(page, browser, this, snapshot, { readMs: 8000, finishMs: 8000, ...o }); } });
const paypayAdapter = (o = {}) => ({ ...paypay.standardBalance, ui(page, browser, snapshot) { return paypay.balanceUi(page, browser, this, snapshot, { settleMs: 20000, stableMs: 800, stepMs: 20000, finishMs: 10000, readMs: 8000, ...o }); } });
const chooser = site => async () => { for (let i = 0; i < 40; i++) { let moved = false; for (const p of site.pages) moved = (await site.selectCertificate(p).catch(() => false)) || moved; if (moved) break; await new Promise(r => setTimeout(r, 150)); } return { outcome: 'selected', reason: null }; };
const ikedaAdapter = (site, o = {}) => ({ ...ikeda.portalBalance, ui(page, browser, snapshot) { return ikeda.portalBalanceUi(page, browser, this, snapshot, { certificate: chooser(site), certificateMs: 4000, settleMs: 20000, stableMs: 1500, stepMs: 20000, finishMs: 8000, readMs: 12000, ...o }); } });
async function inquire(site, adapter, job, login, extra = {}) {
  const root = path.join(temp, 'root-' + randomUUID().slice(0, 8)); await mkdir(root, { recursive: true }); const statuses = [], readings = [];
  return owned(site, async ({ page, browser, dialogs, downloads }) => {
    let shows = 0; const original = page.bringToFront.bind(page); page.bringToFront = async () => { shows++; return original(); };
    let result = null, error = null;
    try { result = await B.inquireFromPage(page, browser, adapter, boundOf(job), job, root, async (state, text) => { statuses.push([state, text]); }, { login, loginTimeoutMs: 40000, onReading: async r => { readings.push(r); }, ...extra }); } catch (e) { error = e; }
    return { result, error, statuses, readings, dialogs, downloads, shows, stats: site.stats, root };
  });
}
const RSECRET = Object.freeze({ username: 'fict-user', password: 'Fict-Pw-1' }), PSECRET = Object.freeze({ branch: '012', account: '0012345', password: ' Fictional Pw/1 ' }), ISECRET = Object.freeze({ password: 'Fict-Pw-12' });

test('楽天銀行: one saved-login submission in the background, both bank fields and the 残高確認時間 read exactly, the image ログアウト pressed and confirmed, no CSV, no window shown', async () => {
  const site = rakutenSite(), job = jobOf('rakuten', 'standard'), login = savedLogin(RSECRET), r = await inquire(site, rakutenAdapter(), job, login);
  assert.equal(r.error, null, 'rakuten-balance:no-error ' + String(r.error?.message || '')); assert.equal(r.result.failed, null, 'rakuten-balance:not-failed ' + r.result.failed);
  assert.deepEqual(r.readings, [{ amount: 1234567, available: 1200000, asOf: minute(site.s.bankMs), source: { origin: 'https://fes.rakuten-bank.co.jp', path: '/XMS/inquiry/gns', labels: ['普通預金残高', '支払可能残高'] } }], 'rakuten-balance:exact-reading');
  assert.equal(site.stats.posts, 1, 'rakuten-balance:one-submission'); assert.deepEqual([login.calls.open, login.calls.rejected, login.calls.accepted], [1, ['uncertain'], 1], 'rakuten-balance:marker-before-submit-cleared-after-auth');
  assert.equal(site.stats.logout, 1, 'rakuten-balance:image-logout-pressed'); assert.equal(r.result.logout?.loggedOut, true, 'rakuten-balance:logout-confirmed');
  assert.deepEqual([r.downloads.length, r.shows, site.stats.foreign.length], [0, 0, 0], 'rakuten-balance:no-csv-no-window-no-foreign');
  assert.ok(!r.statuses.some(([st]) => st === 'verification_required'), 'rakuten-balance:never-asks-person');
  assert.doesNotMatch(JSON.stringify([r.statuses, r.readings]), /fict-user|Fict-Pw|1234567（架空）|j_idt/, 'rakuten-balance:no-credential-or-account-in-output');
});

test('楽天銀行: a duplicated or hidden label, an amount outside the bank syntax or a missing 残高確認時間 never publishes a balance (never zero); logout still runs', async () => {
  for (const [label, o, pattern] of [['duplicate', { duplicate: true }, /普通預金残高/], ['hidden', { hidePrimary: true }, /普通預金残高/], ['syntax', { amount: '1,234,56 円' }, /普通預金残高/], ['no-time', { noTime: true }, /残高確認時間/], ['no-yen', { amount: '1,234,567' }, /普通預金残高/], ['two-amounts', { amount: '1,234 円 5,678 円' }, /普通預金残高/]]) {
    const site = rakutenSite(o), r = await inquire(site, rakutenAdapter({ readMs: 2500 }), jobOf('rakuten', 'standard'), savedLogin(RSECRET));
    assert.equal(r.error, null, 'rakuten-balance:no-throw ' + label + ' ' + String(r.error?.message || ''));
    assert.ok(r.result.failed && pattern.test(r.result.failed), 'rakuten-balance:refused ' + label + ' ' + r.result.failed); assert.deepEqual(r.readings, [], 'rakuten-balance:nothing-read ' + label);
    assert.equal(site.stats.logout, 1, 'rakuten-balance:logout-after-failure ' + label);
  }
});

test('楽天銀行 logout: the explicit logout text with no ログアウト control counts; a page still showing the control does not (and changes nothing else)', async () => {
  const thanks = rakutenSite({ logout: 'thanks' }), a = await inquire(thanks, rakutenAdapter(), jobOf('rakuten', 'standard'), savedLogin(RSECRET));
  assert.equal(a.result.logout?.loggedOut, true, 'rakuten-balance:logout-thanks'); assert.equal(a.readings.length, 1);
  const stuck = rakutenSite({ logout: 'stuck' }), b = await inquire(stuck, rakutenAdapter({ finishMs: 3000 }), jobOf('rakuten', 'standard'), savedLogin(RSECRET));
  assert.equal(b.result.logout?.loggedOut, false, 'rakuten-balance:logout-not-inferred'); assert.equal(b.readings.length, 1, 'rakuten-balance:reading-kept'); assert.equal(stuck.stats.logout, 1, 'rakuten-balance:logout-once');
});

test('protected failure: a blocked or refused saved login, a bank refusal or an extra verification ends the background inquiry without asking a person, showing a window or submitting again', async () => {
  const blocked = rakutenSite(), b = await inquire(blocked, rakutenAdapter(), jobOf('rakuten', 'standard'), savedLogin(RSECRET, 'blocked'));
  assert.ok(b.result?.failed && /自動では送信しません/.test(b.result.failed), 'balance-protected:blocked ' + (b.result?.failed || b.error?.message)); assert.deepEqual([blocked.stats.posts, b.shows, b.readings.length], [0, 0, 0], 'balance-protected:blocked-no-submit');
  const reject = rakutenSite({ afterLogin: 'reject' }), login = savedLogin(RSECRET), rj = await inquire(reject, rakutenAdapter(), jobOf('rakuten', 'standard'), login);
  assert.ok(rj.result?.failed, 'balance-protected:refusal-fails'); assert.deepEqual([reject.stats.posts, rj.shows, login.calls.accepted], [1, 0, 0], 'balance-protected:refusal-once-no-accept');
  const verify = rakutenSite({ afterLogin: 'verify' }), lv = savedLogin(RSECRET), v = await inquire(verify, rakutenAdapter(), jobOf('rakuten', 'standard'), lv);
  assert.ok(v.result?.failed && /追加の確認/.test(v.result.failed), 'balance-protected:verify-stops ' + v.result?.failed); assert.deepEqual([verify.stats.posts, v.shows, lv.calls.accepted, v.readings.length], [1, 0, 0, 0], 'balance-protected:verify-no-accept');
  const none = rakutenSite(), n = await inquire(none, rakutenAdapter(), jobOf('rakuten', 'standard'), null);
  assert.ok(n.result?.failed, 'balance-protected:no-saved-login'); assert.deepEqual([none.stats.posts, n.shows], [0, 0]);
});

test('PayPay銀行: the direct sign-in, the unique 残高照会, the 普通預金残高 and its 現在 time with seconds, the displayed account equal to the saved login, ログアウト with its one confirm', async () => {
  const site = paypaySite(), login = savedLogin(PSECRET), r = await inquire(site, paypayAdapter(), jobOf('paypay', 'standard'), login);
  assert.equal(r.error, null, 'paypay-balance:no-error ' + String(r.error?.message || '')); assert.equal(r.result.failed, null, 'paypay-balance:not-failed ' + r.result.failed);
  assert.deepEqual(r.readings, [{ amount: 98765, available: null, asOf: new Date(Math.floor(site.s.bankMs / 1000) * 1000).toISOString(), source: { origin: PP, path: PP_ACTION, labels: ['普通預金残高'] } }], 'paypay-balance:exact-reading');
  assert.deepEqual([site.stats.posts, site.stats.balancePages, site.stats.logout], [1, 1, 1], 'paypay-balance:once-each'); assert.equal(r.result.logout?.loggedOut, true);
  assert.deepEqual(r.dialogs.map(d => d.type), ['confirm'], 'paypay-balance:logout-confirm-only'); assert.deepEqual([r.downloads.length, r.shows], [0, 0]);
  assert.deepEqual([login.calls.rejected, login.calls.accepted], [['uncertain'], 1], 'paypay-balance:direct-clears-marker');
});

test('PayPay銀行: four saved logins are four inquiries, each bound to its own account; another account on the page, a duplicated label, a time without seconds or a sign-in that is not direct publishes nothing', async () => {
  for (const n of ['0012345', '0012346', '0012347', '0012348']) {
    const site = paypaySite({ accountShown: n }), r = await inquire(site, paypayAdapter(), jobOf('paypay', 'standard'), savedLogin({ ...PSECRET, account: n }));
    assert.equal(r.result?.failed, null, 'paypay-balance:four ' + n + ' ' + r.result?.failed); assert.deepEqual(site.stats.submitted, [n], 'paypay-balance:own-login ' + n);
  }
  for (const [label, o, secret] of [['other-account', { accountShown: '0099999' }, PSECRET], ['duplicate', { duplicate: true }, PSECRET], ['no-seconds', { seconds: false }, PSECRET], ['not-direct', { mode: 'notice' }, PSECRET]]) {
    const site = paypaySite(o), r = await inquire(site, paypayAdapter({ readMs: 2500 }), jobOf('paypay', 'standard'), savedLogin(secret));
    assert.ok(r.result?.failed, 'paypay-balance:refused ' + label + ' ' + String(r.error?.message || '')); assert.deepEqual(r.readings, [], 'paypay-balance:nothing ' + label);
  }
});

test('池田泉州銀行 ビジネスゲート: certificate login, the dashboard read only after the exact account card rendered (never the shell as zero), the ¥ balance of that card only — never the 前日比, another card or the total — and the portal logout', async () => {
  const s = ikedaSite(), job = jobOf('ikeda', 'portal', { accountIdentity: { ...F.IDENTITY } }), login = savedLogin(ISECRET), r = await inquire(s, ikedaAdapter(s.site), job, login);
  assert.equal(r.error, null, 'ikeda-balance:no-error ' + String(r.error?.message || '')); assert.equal(r.result.failed, null, 'ikeda-balance:not-failed ' + r.result.failed);
  assert.deepEqual(r.readings, [{ amount: 5550000, available: null, asOf: minute(s.s.bankMs), source: { origin: F.PORTAL, path: '/', labels: ['各口座残高'] } }], 'ikeda-balance:exact-card');
  assert.equal(s.site.stats.loggedOut, true, 'ikeda-balance:logout'); assert.deepEqual(s.site.stats.ccPosts.length, 1, 'ikeda-balance:one-submission'); assert.deepEqual([r.downloads.length, r.shows, s.site.stats.csvServed], [0, 0, 0]);
  for (const [label, cards] of [['change-only', [s.card(F.IDENTITY.number, '', '<p>前日比 <span>▲</span>￥12,000</p>')]], ['no-prefix', [s.card(F.IDENTITY.number, '5,550,000円')]], ['duplicate-card', [s.card(F.IDENTITY.number, '¥5,550,000'), s.card(F.IDENTITY.number, '¥1')]], ['no-card', [s.card('0000002', '¥9,999,999')]], ['no-time', [s.card(F.IDENTITY.number, '¥5,550,000', '', '')]]]) {
    const x = ikedaSite({ card: cards }), rx = await inquire(x, ikedaAdapter(x.site, { readMs: 6000 }), jobOf('ikeda', 'portal', { accountIdentity: { ...F.IDENTITY } }), savedLogin(ISECRET));
    assert.ok(rx.result?.failed, 'ikeda-balance:refused ' + label + ' ' + String(rx.error?.message || '')); assert.deepEqual(rx.readings, [], 'ikeda-balance:nothing ' + label); assert.equal(x.site.stats.loggedOut, true, 'ikeda-balance:logout-after ' + label);
  }
  const ni = ikedaSite(), noIdentity = await inquire(ni, ikedaAdapter(ni.site), jobOf('ikeda', 'portal'), savedLogin(ISECRET));
  assert.ok(noIdentity.result?.failed, 'ikeda-balance:identity-required'); assert.equal(ni.site.stats.ccPosts.length, 0, 'ikeda-balance:identity-before-login');
});

test('池田泉州銀行 signed card (synthetic format; no negative live sample was observed): the frozen account card whose balance is an unambiguous signed ¥ amount is selected and read with its sign, the 前日比 still excluded', async () => {
  // the first two also show a 前日比; the last shows the signed balance alone (no other ¥ amount in its card)
  for (const [label, amount, value, change] of [['minus-after-yen', '¥-1,234', -1234, undefined], ['minus-before-yen', '-￥5,000', -5000, undefined], ['signed-only', '¥-1,234', -1234, '']]) {
    const s = ikedaSite({ card: null }), card = s.card(F.IDENTITY.number, amount, change); s.s.card = [card, s.card('0000002', '￥9,999,999')];
    const r = await inquire(s, ikedaAdapter(s.site), jobOf('ikeda', 'portal', { accountIdentity: { ...F.IDENTITY } }), savedLogin(ISECRET));
    assert.equal(r.result?.failed ?? null, null, 'ikeda-balance:signed-read ' + label + ' ' + String(r.result?.failed || r.error?.message || ''));
    assert.deepEqual(r.readings.map(x => x.amount), [value], 'ikeda-balance:signed-amount ' + label); assert.equal(s.site.stats.loggedOut, true, 'ikeda-balance:signed-logout ' + label);
  }
});

// ── the durable balance-only receipt (runBalanceJob with a fictional inquiry and send) ──
function fakeBank(job) { return { job: { ...job, bankAccountId: ACCOUNT }, account: { _id: ACCOUNT, ownerId: OWNER, name: 'Synthetic account' } }; }
const config = { baseUrl: OMF, token: 'omfc_' + 'a'.repeat(64) };
const readingOf = provider => ({ amount: 777000, available: provider === 'rakuten' ? 700000 : null, asOf: new Date(Date.now() - 60000).toISOString(), source: { ...B.BALANCE_ADAPTERS[provider].source } });
async function runner(job, { root, send, inquire: inq, statuses = [] } = {}) {
  return B.runBalanceJob(fakeBank(job), config, null, { status: async (s, t) => { statuses.push([s, t]); }, send, root, inquire: inq, now: Date.now });
}
test('receipt: written durably before it is sent, acknowledged only after OMF answered; a crash after it resends identical bytes without another inquiry; an interrupted inquiry never logs in again; a refusal is final', async () => {
  const root = path.join(temp, 'runner-' + randomUUID().slice(0, 6)); await mkdir(root, { recursive: true });
  const job = jobOf('rakuten', 'standard'); let inquiries = 0, sends = []; const statuses = [];
  const inq = async (bound, j, r, st, { onReading }) => { inquiries++; await onReading(readingOf('rakuten')); return { loggedOut: true }; };
  const failing = async () => { throw Object.assign(new Error('fictional network'), { name: 'TypeError' }); };
  await assert.rejects(runner(job, { root, send: failing, inquire: inq, statuses }), /fictional network/, 'balance-receipt:send-failure-propagates');
  const dir = path.join(root, 'outbox', 'balance', ACCOUNT, job.jobId), m = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')), bytes = await readFile(path.join(dir, m.filename));
  assert.equal(m.acknowledgedAt, undefined, 'balance-receipt:not-acknowledged'); assert.equal(sha256(bytes), m.sha256); const body = JSON.parse(bytes);
  assert.deepEqual(Object.keys(body).sort(), ['amount', 'asOf', 'available', 'currency', 'jobId', 'observedAt', 'provider', 'snapshotHash', 'source', 'v', 'variant'], 'balance-receipt:whitelisted');
  assert.ok(!statuses.some(([s]) => s === 'complete'), 'balance-receipt:no-complete-before-ack');
  const ok = async (cfg, acct, item, l, opts) => { sends.push({ bytes: await readFile(path.join(item.directory, item.manifest.filename)), opts }); await writeFile(path.join(item.directory, 'manifest.json'), JSON.stringify({ ...item.manifest, acknowledgedAt: new Date().toISOString(), importId: 'x' })); return { id: 'x' }; };
  const again = await runner(job, { root, send: ok, inquire: inq, statuses }); assert.equal(again.failed ?? null, null);
  assert.deepEqual([inquiries, sends.length], [1, 1], 'balance-receipt:resend-without-inquiry'); assert.deepEqual(sends[0].bytes, bytes, 'balance-receipt:identical-bytes');
  assert.deepEqual([sends[0].opts.route, sends[0].opts.query], ['bank/balance', { jobId: job.jobId, snapshotHash: job.snapshotHash }], 'balance-receipt:route');
  assert.equal(statuses.at(-1)[0], 'complete', 'balance-receipt:complete-after-ack');
  // an inquiry interrupted after it started (attempt recorded, no receipt): the resumed job fails without a second bank login
  const job2 = jobOf('paypay', 'standard'), crash = async () => { inquiries++; throw new Error('fictional crash'); };
  await assert.rejects(runner(job2, { root, send: ok, inquire: crash }), /fictional crash/);
  const n = inquiries, r2 = await runner(job2, { root, send: ok, inquire: inq }); assert.equal(inquiries, n, 'balance-receipt:no-second-login'); assert.ok(r2.failed, 'balance-receipt:interrupted-fails');
  // a permanent refusal (OMF code) is recorded and never sent again
  const job3 = jobOf('rakuten', 'standard'), refuse = async () => { throw Object.assign(new Error('changed'), { status: 409, serverCode: 'balance-identity-changed' }); };
  const r3 = await runner(job3, { root, send: refuse, inquire: inq }); assert.ok(r3.failed, 'balance-receipt:refusal-fails');
  const m3 = JSON.parse(await readFile(path.join(root, 'outbox', 'balance', ACCOUNT, job3.jobId, 'manifest.json'), 'utf8')); assert.equal(m3.refusal?.reason, 'balance-identity-changed', 'balance-receipt:refusal-recorded');
  const before = sends.length; await runner(jobOf('rakuten', 'standard'), { root, send: ok, inquire: inq }); assert.equal(sends.filter(x => JSON.parse(x.bytes).jobId === job3.jobId).length, 0, 'balance-receipt:refused-never-resent'); assert.equal(sends.length, before + 1);
  // a job of another provider/variant or kind is refused before any inquiry
  const n4 = inquiries, r4 = await runner({ ...jobOf('resona', 'direct') }, { root, send: ok, inquire: inq }); assert.ok(r4.failed, 'balance-receipt:unsupported'); assert.equal(inquiries, n4);
  assert.equal((await readdir(path.join(root, 'outbox'))).includes('bank'), false, 'balance-receipt:no-statement-outbox');
  assert.equal(await exists(path.join(root, 'outbox', 'balance', ACCOUNT, job.jobId, 'attempt.json')), true, 'balance-receipt:attempt-journal');
});
