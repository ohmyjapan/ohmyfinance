// collector/test/paypay-standard.test.mjs — the PayPay銀行 標準ログイン adapter (plan omf-paypay-four-accounts-20261021): the publicly
// observed login form only (output/plan/omf-rakuten-auto-login-20261021/PAYPAY-PUBLIC-ENTRY-1792555450347.json — form HOST, POST
// NBCW2101.do, idTenNo/TenNo tel 3, idKozaNo/KozaNo tel 7, idPw/Pw password 32, one submit `login`; the page generates its own
// onSubmit handler). A fake login page is served by request interception inside owned headless Chrome at
// https://login.paypay-bank.co.jp; every other request is aborted. The fake page names its generated submit function at random per
// document and adds a computed hidden field, so a submission that bypassed the page's own handler, reused another document or was
// rebuilt as a POST is visible. Fictional values only; no bank, OMF, vault or ordinary browser is reached.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const paypay = await import('../banks/paypay.mjs');
const bank = await import('../bank.mjs');
const { browserFor } = await import('../browser.mjs');

const ORIGIN = 'https://login.paypay-bank.co.jp', ENTRY = '/wctx/1D1DFxFDg.do', ACTION = '/wctx/NBCW2101.do', TOP = '/wctx/NBG000Top.do', BA = '/balogin_L.html';
// Leading zeros and a password with spaces and symbols: each must arrive exactly as saved.
const SECRET = Object.freeze({ branch: '012', account: '0012345', password: ' Fictional Pw/<&"> 01 ' });

// One login document: the observed shape, or one named deviation. Each document gets a fresh generated handler name and token.
function loginDoc(v = {}, error = '') {
  const fn = 'j' + randomBytes(8).toString('hex'), token = randomBytes(8).toString('hex');
  const field = (id, name, type, max, extra = '') => `<input type="${type}" name="${name}" id="${id}" maxlength="${max}"${extra}>`;
  const fields = [
    `店番号 ${field(v.branchId || 'idTenNo', v.branchName || 'TenNo', 'tel', 3, v.hiddenBranch ? ' style="visibility:hidden"' : '')}`,
    `口座番号 ${field('idKozaNo', 'KozaNo', 'tel', 7)}`,
    `ログインパスワード ${field('idPw', 'Pw', v.passwordType || 'password', v.passwordMax || 32)}`
  ].join(' ');
  const submits = v.submits === 0 ? '' : Array.from({ length: v.submits ?? 1 }, () => '<input type="submit" name="login" value="ログイン">').join(' ');
  const form = name => `<form method="${v.method || 'post'}" action="${v.action || 'NBCW2101.do'}" name="${name}" onSubmit="return ${fn}(document.${name})" target="_self"><input type="hidden" name="SessionToken" value="${token}">${fields} ${submits}</form>`;
  const heading = v.heading ? `<h1${v.headingHidden ? ' style="display:none"' : ''}>${v.heading}</h1>` : '', overwrite = v.overwrite ? '<a href="#" id="overwrite" onclick="window.__overwrite=(window.__overwrite||0)+1;return false;">上書きログイン</a>' : '';
  return { fn, token, html: `<!doctype html><html lang="ja"><meta charset="utf-8"><title>ログイン｜PayPay銀行</title><body>${heading}${error ? `<p class="err">${error}</p>` : ''}
${v.noForm ? '' : form('HOST')}${v.twoForms ? form('HOST') : ''}${overwrite}${v.secondPassword ? '<label>第2暗証 <input type="password" name="Pw2" maxlength="4"></label>' : ''}
<a href="https://www.paypay-bank.co.jp/cn_login.html">ログインできません</a> <a href="${BA}">BA-PLUS専用ログイン</a>
<script>window.__changes=0;document.addEventListener('change',()=>{window.__changes++;},true);window.__inputs=0;document.addEventListener('input',()=>{window.__inputs++;},true);
function ${fn}(f){window.__handler=(window.__handler||0)+1;${v.refuseSubmit ? 'return false;' : ''}var h=document.createElement('input');h.type='hidden';h.name='Chk';h.value='gen-${token}-'+f.TenNo.value.length+'-'+f.KozaNo.value.length;f.appendChild(h);return true;}</script></body></html>` };
}
const baPlusDoc = () => `<!doctype html><html lang="ja"><meta charset="utf-8"><title>BA-PLUS ログイン｜PayPay銀行</title><body><form method="post" action="/wctx/BALoginAction.do" name="BALOGIN">代表口座番号 <input type="tel" name="DaihyoKozaNo" id="idDaihyoKozaNo" maxlength="10"> 管理者・利用者ID <input type="text" name="UserId" id="idUserId" maxlength="20"> パスワード <input type="password" name="Pw" id="idPw" maxlength="32"> <input type="submit" name="login" value="ログイン"></form></body></html>`;
const VARIANTS = {
  exact: {}, 'other-path': { at: '/wctx/Other.do' }, 'foreign-action': { action: 'https://login.paypay-bank.example/wctx/NBCW2101.do' }, 'other-action': { action: 'NBCW9999.do' }, 'get-method': { method: 'get' },
  renamed: { branchName: 'TenNo2' }, 'id-mismatch': { branchId: 'idTen' }, 'password-maxlength': { passwordMax: 64 }, 'text-password': { passwordType: 'text' }, 'second-password': { secondPassword: true },
  'two-forms': { twoForms: true }, 'two-submits': { submits: 2 }, 'no-submit': { submits: 0 }, 'hidden-field': { hiddenBranch: true }, frame: { frame: true }, baplus: { baplus: true }
};

// The fake bank: one state for every page of the owned browser; every request is recorded, foreign ones aborted.
function bankSite() {
  // inUse: the page the bank answers in mode 'in-use' (plan omf-paypay-split-dates-retry-20261022: the observed active-session page —
  // the standard form again under a visible h1 and a separate 上書きログイン control; a deviation per field).
  const s = { mode: 'ok', variant: {}, docs: [], posts: [], foreign: [], requests: 0, inUse: {} };
  s.respond = request => {
    s.requests++; let url; try { url = new URL(request.url()); } catch { return request.abort(); }
    if (url.origin !== ORIGIN) { s.foreign.push(url.origin); return request.abort(); }
    const html = body => request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body });
    const v = s.variant;
    if (url.pathname === ENTRY) {
      if (v.baplus) return html('<!doctype html><html><body><script>location.replace(' + JSON.stringify(BA) + ')</script></body></html>');
      if (v.at) return html('<!doctype html><html><body><script>location.replace(' + JSON.stringify(v.at) + ')</script></body></html>');
      if (v.frame) return html('<!doctype html><html lang="ja"><meta charset="utf-8"><title>ログイン｜PayPay銀行</title><body><iframe src="/wctx/frame.do" style="width:900px;height:600px"></iframe></body></html>');
      const d = loginDoc(v); s.docs.push(d); return html(d.html);
    }
    if (url.pathname === BA) return html(baPlusDoc());
    if (['/wctx/Other.do', '/wctx/frame.do'].includes(url.pathname)) { const d = loginDoc(v); s.docs.push(d); return html(d.html); }
    if (url.pathname === ACTION && request.method() === 'POST') {
      const body = new URLSearchParams(request.postData() || ''), doc = s.docs.find(d => d.token === body.get('SessionToken'));
      s.posts.push({ keys: [...body.keys()].sort(), branch: body.get('TenNo'), account: body.get('KozaNo'), password: body.get('Pw'), chk: body.get('Chk'), fresh: !!doc && doc === s.docs.at(-1), handlerRan: !!doc && body.get('Chk') === `gen-${doc.token}-${String(body.get('TenNo') || '').length}-${String(body.get('KozaNo') || '').length}` });
      if (s.mode === 'reject') { const d = loginDoc({}, '店番号・口座番号またはパスワードが正しくありません'); s.docs.push(d); return html(d.html); }
      if (s.mode === 'in-use') { const d = loginDoc({ heading: '上書きログイン（ログイン中です）', overwrite: true, ...s.inUse }); s.docs.push(d); return html(d.html); }
      return html('<!doctype html><html lang="ja"><meta charset="utf-8"><title>ログイン中</title><body><script>location.replace(' + JSON.stringify(TOP) + ')</script></body></html>');
    }
    if (url.pathname === TOP) return html('<!doctype html><html lang="ja"><meta charset="utf-8"><title>PayPay銀行</title><body><a href="#">ログアウト</a> <a href="#">入出金明細</a></body></html>');
    return request.abort();
  };
  return s;
}

const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-paypay-standard-test-'));
test.after(async () => { if (path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(temp, { recursive: true, force: true }); });
async function owned(fn) {
  const browser = await browserFor(path.join(temp, 'profile-' + randomBytes(4).toString('hex')), { headless: true });
  try { const page = await browser.newPage(), site = bankSite(); await page.setRequestInterception(true); page.on('request', r => site.respond(r)); return await fn({ page, browser, site }); }
  finally { await browser.close().catch(() => {}); }
}
const uiOf = (page, browser, options) => paypay.standardUi(page, browser, paypay.standard, { provider: 'paypay', variant: 'standard' }, { settleMs: 6000, stableMs: 800, ...options });
const fieldValues = page => page.evaluate(() => [...document.querySelectorAll('input:not([type="hidden"]):not([type="submit"])')].map(e => e.value));

// Deliberate change (plan omf-paypay-routine-20261022 Phase C): the standard variant now implements routine retrieval (support
// 'verified' = steps implemented; liveVerified stays false in the shared capability) and keeps guided:true for historical observe jobs.
test('the standard adapter: a routine-retrieving variant that stays guided for historical observe jobs, opened on the published standard login link', () => {
  const s = paypay.standard;
  assert.equal(bank.adapterFor('paypay', 'standard'), s, 'paypay:variant-resolved');
  assert.equal(s.provider, 'paypay'); assert.equal(s.variant, 'standard'); assert.equal(s.support, 'verified', 'paypay:standard-routine-steps'); assert.equal(s.contract, paypay.STANDARD_PAGES); assert.equal(s.guided, true, 'paypay:standard-guided');
  assert.deepEqual(Object.keys(s.loginExits).sort(), ['acceptDirectOnly', 'inUse', 'markRefused', 'texts'], 'paypay:standard-login-exits');
  assert.equal(s.start, 'https://login.paypay-bank.co.jp/wctx/1D1DFxFDg.do?aatc=ot2411jb05a', 'paypay:published-standard-link');
  assert.deepEqual(s.hosts, ['paypay-bank.co.jp']); assert.deepEqual(s.loginHosts, ['login.paypay-bank.co.jp']);
  const c = paypay.STANDARD_LOGIN; assert.equal(c.origin, ORIGIN); assert.equal(c.form, 'HOST'); assert.equal(c.method, 'post'); assert.equal(c.action, ACTION); assert.equal(c.entry, ENTRY);
  assert.deepEqual(c.fields.map(f => [f[1], f[2], f[3], f[4]]), [['idTenNo', 'TenNo', 'tel', 3], ['idKozaNo', 'KozaNo', 'tel', 7], ['idPw', 'Pw', 'password', 32]], 'paypay:observed-fields');
  assert.ok(!/j[0-9a-f]{12,}/.test(JSON.stringify(c)), 'paypay:no-generated-handler-name-pinned');
  for (const v of [null, 'baplus', 'x']) assert.equal(bank.adapterFor('paypay', v), paypay.default, 'paypay:other-variant-default ' + v);
  assert.equal(paypay.default.support, 'contract-pending'); assert.equal(paypay.default.start, 'https://www.paypay-bank.co.jp/'); assert.equal(paypay.default.ui({}, {}).loginForm, undefined, 'paypay:default-has-no-saved-login');
  const ui = s.ui({}, {}, null);
  for (const step of ['open', 'state', 'show', 'loginForm', 'login', 'document', 'downloadSession']) assert.equal(typeof ui[step], 'function', 'paypay:ui ' + step);
});

test('the saved login handed to login(): exactly a 3-digit branch, a 7-digit account (leading zeros kept) and a password of 1-32 characters, kept verbatim', async () => {
  assert.deepEqual(paypay.standardLoginSecret({ ...SECRET }), { ...SECRET }, 'paypay:secret-verbatim');
  for (const bad of [undefined, null, {}, { ...SECRET, branch: '12' }, { ...SECRET, branch: '1234' }, { ...SECRET, branch: 12 }, { ...SECRET, branch: '１２３' }, { ...SECRET, account: '123456' }, { ...SECRET, account: '12345678' }, { ...SECRET, account: 1234567 }, { ...SECRET, password: '' }, { ...SECRET, password: 'p'.repeat(33) }, { ...SECRET, password: 7 }, { username: 'u', password: 'p' }]) {
    assert.throws(() => paypay.standardLoginSecret(bad), e => e?.code === 'manual-login', 'paypay:secret-shape ' + JSON.stringify(bad));
    await assert.rejects(uiOf({}, {}).login(bad), e => e?.code === 'manual-login', 'paypay:secret-before-page ' + JSON.stringify(bad));
  }
});

test('the exact public form on the fresh login page: filled once from the saved values, submitted once through the page\'s own generated handler, leading zeros and the password verbatim, no keyboard or pointer', { timeout: 120000 }, async () => {
  await owned(async ({ page, browser, site }) => {
    let keyboard = 0, mouse = 0; page.keyboard.type = async () => { keyboard++; throw Error('keyboard'); }; page.keyboard.press = async () => { keyboard++; throw Error('keyboard'); }; page.mouse.click = async () => { mouse++; throw Error('mouse'); };
    const ui = uiOf(page, browser); await ui.open();
    const form = await ui.loginForm(); assert.equal(form.ok, true, 'paypay:exact-form-found ' + JSON.stringify(form));
    assert.equal(await ui.loginForm({ entry: true }).then(f => f.ok), true);
    const result = await ui.login({ ...SECRET });
    assert.equal(result.outcome, 'submitted', 'paypay:outcome-submitted-not-authenticated ' + JSON.stringify(result));
    assert.equal(site.posts.length, 1, 'paypay:one-submission');
    const [post] = site.posts;
    assert.deepEqual([post.branch, post.account, post.password], [SECRET.branch, SECRET.account, SECRET.password], 'paypay:values-verbatim');
    assert.deepEqual(post.keys, ['Chk', 'KozaNo', 'Pw', 'SessionToken', 'TenNo', 'login'], 'paypay:native-form-fields (generated hidden field added by the page, submitter included)');
    assert.equal(post.handlerRan, true, 'paypay:native-generated-handler-ran'); assert.equal(post.fresh, true, 'paypay:fresh-document-token');
    assert.deepEqual([keyboard, mouse], [0, 0], 'paypay:no-keyboard-or-pointer');
    assert.deepEqual(site.foreign, [], 'paypay:no-foreign-request');
    assert.equal(new URL(page.url()).pathname, TOP);
    assert.equal((await ui.state()).kind, 'unknown', 'paypay:authenticated-pages-not-classified');
  });
});

test('the bank refusing the saved login: the exact form again on a new document is `rejected`; a page that refuses to submit is `attention`', { timeout: 120000 }, async () => {
  await owned(async ({ page, browser, site }) => {
    site.mode = 'reject'; const ui = uiOf(page, browser); await ui.open();
    const r = await ui.login({ ...SECRET }); assert.equal(r.outcome, 'rejected', 'paypay:refusal-detected ' + JSON.stringify(r)); assert.equal(site.posts.length, 1, 'paypay:refusal-one-submission');
    site.mode = 'ok'; site.variant = { refuseSubmit: true }; await ui.open();
    const stay = await ui.login({ ...SECRET }); assert.equal(stay.outcome, 'attention', 'paypay:no-navigation-attention'); assert.equal(site.posts.length, 1, 'paypay:handler-refusal-no-post');
  });
});

test('drift table: another surface, a foreign or other action, GET, renamed or re-identified fields, a changed password field, a second password, two forms, two or no submit controls, a hidden field, a framed form and the BA-PLUS login are never filled or submitted', { timeout: 300000 }, async () => {
  await owned(async ({ page, browser, site }) => {
    const ui = uiOf(page, browser), out = {};
    for (const [name, v] of Object.entries(VARIANTS)) {
      site.variant = v; site.mode = 'ok'; const posts = site.posts.length; await ui.open(); await new Promise(r => setTimeout(r, 150));
      const form = await ui.loginForm(); let error = null; try { await ui.login({ ...SECRET }); } catch (e) { error = e; }
      const values = await fieldValues(page).catch(() => null);
      out[name] = { ok: form.ok, reason: form.reason || null, posts: site.posts.length - posts, error: error?.code || null, filled: (values || []).some(Boolean) };
    }
    assert.deepEqual([out.exact.ok, out.exact.posts], [true, 1], 'paypay:table-control ' + JSON.stringify(out.exact));
    for (const name of Object.keys(VARIANTS).filter(n => n !== 'exact')) {
      const o = out[name];
      assert.deepEqual([o.ok, o.posts, o.filled, o.error], [false, 0, false, 'login-form'], 'paypay:drift-refused ' + name + ' ' + JSON.stringify(o));
    }
    assert.deepEqual(site.foreign, [], 'paypay:drift-no-foreign');
  });
});

test('a document replaced between the form check and the fill, or between the fill and the click, receives nothing; an abort after the fill clears the fields and submits nothing', { timeout: 180000 }, async () => {
  for (const at of ['fill', 'submit']) await owned(async ({ page, browser, site }) => {
    const ui = uiOf(page, browser); await ui.open();
    const evaluate = page.evaluate.bind(page); let moved = false;
    page.evaluate = async (fn, arg, ...rest) => { if (arg?.[at] && !moved) { moved = true; await page.goto(ORIGIN + ENTRY, { waitUntil: 'domcontentloaded' }); } return evaluate(fn, arg, ...rest); };
    let error = null; try { await ui.login({ ...SECRET }); } catch (e) { error = e; }
    page.evaluate = evaluate;
    assert.equal(moved, true, 'the replacement timing must be exercised (' + at + ')');
    assert.equal(error?.code, 'login-changed', 'paypay:replacement-refused ' + at + ' ' + error);
    assert.equal(site.posts.length, 0, 'paypay:replacement-no-submit ' + at);
    if (at === 'fill') assert.deepEqual(await fieldValues(page), ['', '', ''], 'paypay:replacement-not-filled');
  });
  await owned(async ({ page, browser, site }) => {
    const ui = uiOf(page, browser); await ui.open();
    const abort = new AbortController(), evaluate = page.evaluate.bind(page);
    page.evaluate = async (fn, arg, ...rest) => { const r = await evaluate(fn, arg, ...rest); if (arg?.fill) abort.abort(); return r; };
    await assert.rejects(ui.login({ ...SECRET }, { signal: abort.signal }), e => e?.name === 'AbortError' || /abort/i.test(String(e?.message)), 'paypay:abort-after-fill');
    page.evaluate = evaluate;
    assert.equal(site.posts.length, 0, 'paypay:abort-no-submit'); assert.deepEqual(await fieldValues(page), ['', '', ''], 'paypay:abort-clears-fields');
  });
});

test('the observed active-session page: the standard form again under the one visible h1 上書きログイン（ログイン中です） is `session-in-use` — one submission, 上書きログイン never pressed, no second submission; a hidden, different or doubled heading stays `rejected`, the heading without the form stays `submitted`', { timeout: 300000 }, async () => {
  assert.equal(paypay.SESSION_IN_USE_HEADING, '上書きログイン（ログイン中です）', 'paypay:in-use-heading-exact');
  await owned(async ({ page, browser, site }) => {
    // a wider settle window than uiOf's default (it ends as soon as the outcome is seen): six sequential bank answers under load
    const ui = uiOf(page, browser, { settleMs: 20000 }), out = {};
    for (const [name, inUse] of Object.entries({ exact: {}, hidden: { headingHidden: true }, different: { heading: 'ログイン' }, prefixed: { heading: '上書きログイン（ログイン中です）のお知らせ' }, doubled: { heading: '上書きログイン（ログイン中です）</h1><h1>上書きログイン（ログイン中です）' }, 'no-form': { noForm: true } })) {
      site.mode = 'in-use'; site.inUse = inUse; const posts = site.posts.length; await ui.open();
      const r = await ui.login({ ...SECRET });
      out[name] = { outcome: r.outcome, posts: site.posts.length - posts, overwrite: await page.evaluate(() => window.__overwrite || 0), inUseNow: await ui.sessionInUse() };
    }
    assert.deepEqual(out.exact, { outcome: 'session-in-use', posts: 1, overwrite: 0, inUseNow: true }, 'paypay:in-use-detected ' + JSON.stringify(out.exact));
    for (const name of ['hidden', 'different', 'prefixed', 'doubled']) assert.deepEqual([out[name].outcome, out[name].posts, out[name].overwrite], ['rejected', 1, 0], 'paypay:in-use-near-miss-stays-refusal ' + name + ' ' + JSON.stringify(out[name]));
    assert.deepEqual([out['no-form'].outcome, out['no-form'].posts, out['no-form'].overwrite], ['submitted', 1, 0], 'paypay:in-use-heading-alone-not-classified ' + JSON.stringify(out['no-form']));
    // the ordinary wrong-login refusal is unchanged and distinct
    site.mode = 'reject'; await ui.open(); const refused = await ui.login({ ...SECRET });
    assert.equal(refused.outcome, 'rejected', 'paypay:wrong-login-still-rejected'); assert.equal(await ui.sessionInUse(), false, 'paypay:refusal-page-not-in-use');
    assert.equal((await ui.state()).kind, 'unknown', 'paypay:in-use-not-authenticated');
    assert.deepEqual(site.foreign, [], 'paypay:in-use-no-foreign');
  });
});
