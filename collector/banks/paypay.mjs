// collector/banks/paypay.mjs — PayPay銀行 adapter. The provider default stays 'contract-pending' (plan
// omf-bank-collection-amended-20261018 A6): no authenticated selector, export step, period limit or CSV template is claimed; its `start`
// is the official homepage and `hosts` bound the download-host guard. Plan omf-paypay-four-accounts-20261021: only the frozen variant
// `standard` (標準ログイン: 店番号・口座番号・ログインパスワード) resolves `variants.standard` (collector/bank.mjs adapterFor) — still
// 'contract-pending' and `guided`: its observe job opens the published standard login link and, with the claimed account's saved login
// (index.mjs bankLoginFor), fills the publicly observed login form once and activates its one submit control so the page's own,
// per-document generated onSubmit handler runs (output/plan/omf-rakuten-auto-login-20261021/PAYPAY-PUBLIC-ENTRY-1792555450347.json and
// PAYPAY-PUBLIC-NAVIGATION-1792555549500.json: form HOST POST NBCW2101.do; idTenNo/TenNo tel 3, idKozaNo/KozaNo tel 7, idPw/Pw password
// 32; one submit `login`). After the submission only the form again (a refusal, or the observed active-session heading: session in use)
// is classified; nothing else is: the authenticated pages, the statement controls and the export
// are the person's steps in the same owned window until the actual export is observed. The generated handler name is never pinned, no
// POST is rebuilt or replayed, no value is read back, no keyboard or pointer input is used. BA-PLUS (専用ログイン) is not a saved-login
// variant: its observe job opens the provider default. Imports only ../interaction.mjs, so the staged copy loads without node_modules.
// Plan omf-paypay-routine-20261022 Phase C: `standard` now also retrieves (routineUi below): the observed Welcome/statement pages,
// 期間選択, the six named date selects, 照会, CSV and ログアウト drive a retrieve job; the guided first-capture behaviour above is kept
// for observe jobs queued before (historical snapshots). The provider default (BA-PLUS, no or unknown variant) is unchanged.
// Plan omf-paypay-live-period-20261023: the actual statement page whose default period is empty shows no CSV, so the statement page is
// recognized from its period/logout navigation (export still needs the one actual CSV after this job's 照会), and routineUi.diagnostic()
// is the optional value-free failure reader bank.mjs keeps before ログアウト and cleanup.
import { pause } from '../interaction.mjs';

const coded = (code, message) => Object.assign(new Error(message), { code });
const pending = async () => { throw coded('contract-pending', 'contract-pending: PayPay銀行の取得手順は未確認です'); };
const HOSTS = ['paypay-bank.co.jp'], LOGIN_HOSTS = ['login.paypay-bank.co.jp'];
const onHosts = (host, hosts) => !!host && (hosts || []).some(h => host === h || host.endsWith('.' + h));
/** The published standard login link: the homepage's ログイン button (jnb_tologin02 in init.js) opens exactly this address. */
export const STANDARD_ENTRY = 'https://login.paypay-bank.co.jp/wctx/1D1DFxFDg.do?aatc=ot2411jb05a';
/**
 * The publicly observed standard login form (read 2026-10-21 without a credential or a submission): the login origin, the entry
 * surface and the form's own action path (where the bank may show the form again after a submission), the form HOST posting there, its
 * three fields [key, id, name, type, maxLength] and its one submit control.
 */
export const STANDARD_LOGIN = Object.freeze({
  origin: 'https://login.paypay-bank.co.jp', entry: '/wctx/1D1DFxFDg.do', pathnames: Object.freeze(['/wctx/1D1DFxFDg.do', '/wctx/NBCW2101.do']),
  form: 'HOST', method: 'post', action: '/wctx/NBCW2101.do',
  fields: Object.freeze([Object.freeze(['branch', 'idTenNo', 'TenNo', 'tel', 3]), Object.freeze(['account', 'idKozaNo', 'KozaNo', 'tel', 7]), Object.freeze(['password', 'idPw', 'Pw', 'password', 32])]),
  control: Object.freeze({ name: 'login', type: 'submit' })
});
/** GUARD — the saved login handed to login(): exactly a 3-digit 店番号, a 7-digit 口座番号 (strings: leading zeros kept) and a password of 1-32 characters (verbatim); else manual. */
export function standardLoginSecret(secret, label = 'PayPay銀行') {
  const ok = !!secret && typeof secret === 'object' && typeof secret.branch === 'string' && /^[0-9]{3}$/.test(secret.branch) && typeof secret.account === 'string' && /^[0-9]{7}$/.test(secret.account) && typeof secret.password === 'string' && secret.password.length > 0 && secret.password.length <= 32;
  if (!ok) throw coded('manual-login', `${label}へのサインインはChromeで人が行います`);
  return { branch: secret.branch, account: secret.account, password: secret.password };
}

// GUARD (serialized; uses only its argument; reads no field value) — the exact observed login form on this document, or why not: the
// login origin and an observed surface (`entry`: the fresh entry page only), the top document, the expected document; exactly one form
// HOST posting to NBCW2101.do on the same origin into the same window; its three fields (name and id, type, maxlength) each exactly once,
// visible, enabled and writable inside that form; exactly one visible password field on the page; exactly one visible enabled submit
// control in the form, the observed `login`. `fill` sets the three values in this same page task; `submit` activates the verified control
// in this same task, so the page's own generated onSubmit handler runs and posts the form natively; `clear` empties the three fields.
// Each `// guard:<name>` line is one predicate the fixture removes in turn from a mutant copy.
const LOGIN_FORM = ({ c, entry = false, expectedDocument = null, fill = null, submit = false, clear = false }) => {
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  if (location.origin !== c.origin || !c.pathnames.includes(location.pathname) || (entry && location.pathname !== c.entry) || window.top !== window || (expectedDocument !== null && String(performance.timeOrigin) !== expectedDocument)) return { ok: false, reason: 'surface' }; // guard:login-surface
  const forms = [...document.forms].filter(f => f.getAttribute('name') === c.form || f.id === c.form);
  if (forms.length !== 1 || forms[0].getAttribute('name') !== c.form) return { ok: false, reason: 'form' }; // guard:login-form
  const f = forms[0]; let action = null; try { action = new URL(f.getAttribute('action') || '', location.href); } catch { action = null; }
  if (String(f.getAttribute('method') || '').toLowerCase() !== c.method || !action || action.origin !== c.origin || action.pathname !== c.action || !['', '_self'].includes(String(f.getAttribute('target') || '').toLowerCase())) return { ok: false, reason: 'action' }; // guard:login-action
  const input = name => document.getElementsByName(name)[0];
  const field = ([, id, name, type, max]) => { const list = [...document.getElementsByName(name)], e = list[0]; return list.length === 1 && e instanceof HTMLInputElement && e.form === f && e.id === id && e.type === type && e.maxLength === max && visible(e) && !e.disabled && !e.readOnly; };
  if (!c.fields.every(field)) return { ok: false, reason: 'fields' }; // guard:login-fields
  if ([...document.querySelectorAll('input[type="password"]')].filter(visible).length !== 1) return { ok: false, reason: 'password' }; // guard:login-password-unique
  const submits = [...f.querySelectorAll('input[type="submit"], input[type="image"], button')].filter(e => visible(e) && !e.disabled && (e.tagName !== 'BUTTON' || String(e.getAttribute('type') || 'submit').toLowerCase() === 'submit'));
  if (submits.length !== 1 || submits[0].tagName !== 'INPUT' || submits[0].type !== c.control.type || submits[0].name !== c.control.name) return { ok: false, reason: 'control' }; // guard:login-control
  const found = { ok: true, document: String(performance.timeOrigin) };
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  if (fill || clear) {
    // Property writes only (no input events: the recorder's typing record is the person's, never the collector's); one change event each.
    for (const [key, , name] of c.fields) setter.call(input(name), clear ? '' : String(fill[key]));
    for (const [, , name] of c.fields) input(name).dispatchEvent(new Event('change', { bubbles: true }));
    return found;
  }
  if (submit) submits[0].click();
  return found;
};
/**
 * The observed active-session page (plan omf-paypay-split-dates-retry-20261022; the real bank answered a correct saved login, while
 * another session of the account was signed in, with the standard form again under this visible heading and a separate 上書きログイン
 * control). Read-only: true only for exactly one visible h1 whose text is exactly this heading. Nothing is clicked.
 */
export const SESSION_IN_USE_HEADING = '上書きログイン（ログイン中です）';
const SESSION_IN_USE = heading => {
  const visible = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const shown = [...document.querySelectorAll('h1')].filter(visible);
  return shown.length === 1 && shown[0].textContent.trim() === heading;
};

/**
 * The ui of the guided standard login (the shape of contractUi). Nothing is read from the page at construction (the staged-package
 * check constructs it with empty objects). state() is always `unknown`: no authenticated page is inferred from navigation. loginForm/
 * document/login(secret) are the saved-login steps bank.mjs guidedSignIn drives (at most one submission per job). `options` are the
 * test seams for the settle window.
 */
export function standardUi(page, browser, adapter = standard, snapshot = null, { settleMs = 30000, stableMs = 2500 } = {}) {
  const label = adapter?.label || 'PayPay銀行', hosts = adapter?.hosts || HOSTS, start = adapter?.start || STANDARD_ENTRY;
  const bounded = (promise, ms = 5000) => Promise.race([promise, pause(ms).then(() => null)]);
  const current = () => { let url; try { url = new URL(page.url()); } catch { throw new Error(`${label}のページを確認できません`); } if (!onHosts(url.hostname, hosts)) throw new Error(`${label}のページではありません。Chromeを確認して再試行してください`); return url; };
  // After the one submission: the exact login form on a NEW document → 'rejected', unless that document carries the observed
  // active-session heading → 'session-in-use' (another session is signed in; neither a refusal nor a sign-in, and 上書きログイン is never
  // pressed); another new document that stays put → 'submitted' (never 'authenticated': nothing the collector sees afterwards, no file
  // included, proves the sign-in — plan P1); no new document within the window → 'attention'.
  const settle = async before => {
    const until = Date.now() + settleMs; let changed = false, last = null, since = 0;
    while (Date.now() < until) {
      await pause(250);
      const doc = await ui.document(); if (doc && doc !== before) changed = true;
      if (!changed) continue;
      if ((await ui.loginForm()).ok) return (await ui.sessionInUse()) ? 'session-in-use' : 'rejected';
      const key = String(doc) + ':' + (() => { try { return new URL(page.url()).pathname; } catch { return ''; } })();
      if (key !== last) { last = key; since = Date.now(); } else if (Date.now() - since >= stableMs) return 'submitted';
    }
    return changed ? 'submitted' : 'attention';
  };
  const ui = {
    async open() { await page.goto(start, { waitUntil: 'domcontentloaded', timeout: 60000 }); },
    async state() { return { kind: 'unknown' }; },
    async show() { await bounded(page.bringToFront(), 3000); },
    /** The exact observed login form on the current page ({ok, document}) or {ok:false, reason}; nothing is typed or read. */
    async loginForm({ entry = false } = {}) {
      let url; try { url = new URL(page.url()); } catch { return { ok: false, reason: 'surface' }; }
      if (url.origin !== STANDARD_LOGIN.origin) return { ok: false, reason: 'surface' };
      try { return (await bounded(page.evaluate(LOGIN_FORM, { c: STANDARD_LOGIN, entry }))) || { ok: false, reason: 'unreadable' }; } catch { return { ok: false, reason: 'unreadable' }; }
    },
    /** Whether the current page shows the observed active-session heading (read-only; an unreadable page is false). */
    async sessionInUse() { try { return (await bounded(page.evaluate(SESSION_IN_USE, SESSION_IN_USE_HEADING))) === true; } catch { return false; } },
    /** The identity of the current document (its time origin): a submission is judged on a NEW document only. */
    async document() { try { return (await bounded(page.evaluate(() => String(performance.timeOrigin)))) ?? null; } catch { return null; } },
    /**
     * The one submission of a saved login: the secret's shape before any page; the exact form on the fresh entry page; the three values
     * set in one page task bound to that document; abort checked; the verified control activated in one page task bound to the same
     * document. A replaced document receives nothing; an abort after the fill clears the fields. Outcome: rejected, submitted or attention.
     */
    async login(secret, { signal = null } = {}) {
      const values = standardLoginSecret(secret, label);
      const form = await ui.loginForm({ entry: true });
      if (!form.ok) throw coded('login-form', `${label}のログイン画面が確認済みの形と異なります（${form.reason}）`);
      signal?.throwIfAborted();
      let filled = false, submitted = false;
      try {
        const fill = await page.evaluate(LOGIN_FORM, { c: STANDARD_LOGIN, entry: true, expectedDocument: form.document, fill: values });
        if (!fill?.ok || fill.document !== form.document) throw coded('login-changed', `${label}のログイン画面が入力前に変わりました`);
        filled = true;
        signal?.throwIfAborted();
        current();
        const clicked = await page.evaluate(LOGIN_FORM, { c: STANDARD_LOGIN, entry: true, expectedDocument: form.document, submit: true });
        if (!clicked?.ok || clicked.document !== form.document) throw coded('login-changed', `${label}のログイン画面が送信前に変わりました`);
        submitted = true;
      } finally {
        if (filled && !submitted) await bounded(page.evaluate(LOGIN_FORM, { c: STANDARD_LOGIN, entry: true, expectedDocument: form.document, clear: true })).catch(() => {});
      }
      return { outcome: await settle(form.document), document: form.document };
    },
    openStatements: pending, selectPeriod: pending, snapshot: pending, exportCsv: pending,
    async downloadSession(jobDir) {
      const session = await page.browser().target().createCDPSession();
      await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: jobDir, eventsEnabled: true });
      return { on: (event, handler) => session.on(event, handler), async close() { await session.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: false }).catch(() => {}); await session.detach().catch(() => {}); } };
    }
  };
  void snapshot;
  return ui;
}

// ── Routine retrieval (plan omf-paypay-routine-20261022 Phase C) ────────────────────────────────────────────────────────────────
// The observed authenticated pages and statement steps (value-free records of actual jobs 2ac7e506/792d829e/a7272a5b and the
// reviewed operator's executed sequence: output/plan/omf-paypay-routine-20261022/2-readiness-review.md §2). Every post-login page
// shares /wctx/NBCW2101.do, so no pathname is used; a page is identified by its exact title and visible controls on the top document
// of the official login origin. Not observed (O1-O9): account identity on the page, export limits, additional verification, expiry,
// maintenance, empty periods, dialogs and the tab's foreground behaviour — each of those leaves the page `unknown` (the person is asked).
export const STANDARD_PAGES = Object.freeze({
  origin: 'https://login.paypay-bank.co.jp',
  welcome: Object.freeze({ title: 'Welcome Page - PayPay銀行', controls: Object.freeze(['ログアウト', '普通預金取引明細照会']) }),
  statements: Object.freeze({ title: '普通預金取引明細照会 - PayPay銀行', controls: Object.freeze(['期間選択', 'CSV', 'ログアウト']) }),
  open: '普通預金取引明細照会', period: '期間選択', panelOpen: '閉じる', query: '照会', export: 'CSV', logout: 'ログアウト',
  downloading: 'ダウンロード中 - PayPay銀行',
  periodFields: Object.freeze(['ShokaiStartDateNenIn', 'ShokaiStartDateTsukiIn', 'ShokaiStartDateHiIn', 'ShokaiEndDateNenIn', 'ShokaiEndDateTsukiIn', 'ShokaiEndDateHiIn'])
});
// The person-facing texts of a routine PayPay sign-in (bank.mjs ensureBankLogin `exits.texts`; no credential, URL or page text).
export const ROUTINE_TEXT = Object.freeze({
  refused: label => `${label}が保存済みのログインを受け付けませんでした。ログインを変更した場合はダウンローダーの設定画面で店番号・口座番号・パスワードを保存し直してください。変更していない場合は同じ画面の「保存済みのログインでもう一度試す」で1回だけ再試行できます（どちらかを行うまで自動では送信しません）`,
  refusedSaved: label => `${label}の前回の自動サインインは銀行に受け付けられませんでした。ダウンローダーの設定画面で、ログインを変更した場合は保存し直し、変更していない場合は「保存済みのログインでもう一度試す」を押してから、もう一度「取得」を押してください`,
  blocked: label => `${label}の前回の自動サインインが確認できていないため、保存済みのログインを自動では送信しません。ログインが正しい場合はダウンローダーの設定画面で「保存済みのログインでもう一度試す」を押してから、もう一度「取得」を押してください`,
  inUse: label => `${label}は別のブラウザーやアプリでログイン中のため、保存済みのログインを1回送信したところで止めました（「上書きログイン」は自動では押しません）。ほかのログインを終えてから、もう一度「取得」を押してください`,
  inUseStopped: label => `${label}は別のブラウザーやアプリでログイン中だったため、明細は取得していません（「上書きログイン」は押していません）。ほかのログインを終え、ダウンローダーの設定画面で「保存済みのログインでもう一度試す」を押してから、もう一度「取得」を押してください`,
  unconfirmed: label => `${label}への自動サインインの完了を確認できませんでした（サインイン後の画面が確認済みの形と異なります）。明細は取得していません。Chromeの画面を確認し、ダウンローダーの設定画面で「保存済みのログインでもう一度試す」を押してから、もう一度「取得」を押してください`
});
const ROUTINE_CONTROLS = 'a,button,input[type="submit"],input[type="button"],input[type="image"],[role="button"]';
// In-page readers (serialized; they use only their argument; no field value of a credential is read). The control label rule is the
// reviewed operator's actually executed one: inner text, the value of a submit/button input, an image's alt, aria-label or title.
const ROUTINE_PAGE = ({ selector }) => {
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const label = e => (e.innerText || (e instanceof HTMLInputElement && ['submit', 'button', 'image'].includes(e.type) ? (e.value || e.alt) : '') || e.getAttribute('aria-label') || e.querySelector?.('img[alt]')?.alt || e.getAttribute('alt') || e.title || '').replace(/\s+/g, ' ').trim();
  return { origin: location.origin, top: window.top === window, title: document.title, document: String(performance.timeOrigin),
    controls: [...document.querySelectorAll(selector)].filter(e => visible(e) && !e.disabled).map(label).filter(Boolean),
    password: [...document.querySelectorAll('input[type="password"]')].some(visible) };
};
/**
 * GUARD — the state of a routine page (pure): another origin or a frame → unknown; a visible password field → login (the entry,
 * a refusal or the in-use page); the exact Welcome title with both observed controls → authenticated; the exact statement title
 * with its three observed controls → export_ready when the period panel is closed, statements while it is open; the exact statement
 * title without CSV but with exactly one 期間選択 and a ログアウト (the actual empty default view) → statements; anything else →
 * unknown. A page that only shows ログアウト, a similar title or the shared pathname is never authenticated.
 */
export function classifyRoutinePage(read, c = STANDARD_PAGES) {
  if (!read || read.origin !== c.origin || read.top !== true) return 'unknown';
  if (read.password) return 'login';
  const controls = Array.isArray(read.controls) ? read.controls : [];
  if (read.title === c.welcome.title && c.welcome.controls.every(t => controls.includes(t))) return 'authenticated'; // guard:routine-welcome
  if (read.title === c.statements.title && c.statements.controls.every(t => controls.includes(t))) return controls.includes(c.panelOpen) ? 'statements' : 'export_ready'; // guard:routine-statements
  // Plan omf-paypay-live-period-20261023 (actual PayPay 4 page, hub ACTUAL-BASELINE.md §1): the default view of an empty default period has
  // no CSV control, only its period/logout navigation. The exact title with exactly one visible 期間選択 and a visible ログアウト is the
  // statement page for period selection only — never export_ready: export still needs the one actual CSV after this job's 照会.
  if (read.title === c.statements.title && controls.filter(t => t === c.period).length === 1 && controls.includes(c.logout)) return 'statements'; // guard:routine-statements-navigation
  return 'unknown';
}
// GUARD (serialized) — activate exactly one control on the expected document: `link` = an <a> whose text is exactly `text`; `control`
// = the operator's label rule over buttons/inputs/links. The page must be the official top document with the expected title. The
// click is scheduled after this task returns, so a dialog it opens never blocks the collector (state() then reports verification).
const PRESS = ({ c, selector, kind, text, titles, expectedDocument }) => {
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const label = e => (e.innerText || (e instanceof HTMLInputElement && ['submit', 'button', 'image'].includes(e.type) ? (e.value || e.alt) : '') || e.getAttribute('aria-label') || e.querySelector?.('img[alt]')?.alt || e.getAttribute('alt') || e.title || '').replace(/\s+/g, ' ').trim();
  if (location.origin !== c.origin || window.top !== window || !titles.includes(document.title) || (expectedDocument && String(performance.timeOrigin) !== expectedDocument)) return { error: 'surface' };
  const list = kind === 'link' ? [...document.querySelectorAll('a')].filter(e => visible(e) && String(e.innerText || '').replace(/\s+/g, ' ').trim() === text) : [...document.querySelectorAll(selector)].filter(e => visible(e) && !e.disabled && label(e) === text); // guard:routine-exact-control
  if (list.length !== 1) return { error: list.length ? 'ambiguous' : 'missing', count: list.length }; // guard:routine-single-control
  const target = list[0]; setTimeout(() => target.click(), 0);
  return { ok: true };
};
// The six observed period fields (serialized; one resolver for validation, assignment and read-back, so all three act on the SAME
// element): for each recorded identifier, every input/select/textarea carrying it as name or id; exactly one of them must be visible,
// and that one must be an enabled <select>. Hidden copies are ignored by all three (a hidden duplicate is never set, read or taken for
// the field); a second visible one, a visible non-select or none is not the observed form. Build-resume-03 (parent finding
// PARENT-PERIOD-FINDING.md): validation used the visible field while assignment and read-back took the first select of that name, so a
// hidden duplicate could be set and read back while the bank's query used the unchanged visible field.
// op 'check' → 'ok' | 'other' | 'missing' per field; op 'set' → {ok} or {missing: id} (GUARD: the one option whose number — its value,
// else the digits of its text — equals the wanted number; none or two → nothing is chosen for that field); op 'read' → the numbers shown.
const PERIOD = ({ op, ids, wanted = [] }) => {
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const toNumber = o => { const v = String(o.value).trim(); if (/^\d+$/.test(v)) return Number(v); const d = String(o.textContent).replace(/[^0-9]/g, ''); return d ? Number(d) : null; };
  const field = id => { const all = [...document.querySelectorAll('input,select,textarea')].filter(e => (e.name === id || e.id === id) && visible(e)); return all.length === 1 && all[0] instanceof HTMLSelectElement && !all[0].disabled ? { el: all[0] } : { status: all.length ? 'other' : 'missing' }; }; // guard:routine-period-field
  if (op === 'check') return ids.map(id => field(id).el ? 'ok' : field(id).status);
  if (op === 'read') return ids.map(id => { const o = field(id).el?.selectedOptions?.[0]; return o ? toNumber(o) : null; });
  for (let i = 0; i < ids.length; i++) {
    const e = field(ids[i]).el; if (!e) return { missing: ids[i] };
    const options = [...e.options].filter(o => toNumber(o) === wanted[i]); if (options.length !== 1) return { missing: ids[i] }; // guard:routine-period-option
    e.value = options[0].value; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return { ok: true };
};
/** The six numbers of the job's frozen explicit period {from,to}; anything else throws period-required before any page is touched. */
export function routinePeriodValues(coverage) {
  const day = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if (!coverage || typeof coverage !== 'object' || !day(coverage.from) || !day(coverage.to) || coverage.from > coverage.to) throw coded('period-required', 'PayPay銀行の取得期間（開始日・終了日）が取得時の設定にありません。接続の取得期間を保存して、もう一度「取得」を押してください');
  return [...coverage.from.split('-'), ...coverage.to.split('-')].map(Number);
}
// Plan omf-paypay-live-period-20261023 (review-slot7 R1): the value-free shape of the page a failed routine step left, read before ログアウト
// and cleanup (serialized; uses only its argument). Only categories, booleans and counts leave the page — never a title, text, URL, field
// or option value. `titles` maps each exact known title to its category; the document id is used by routineUi only (never recorded).
const SHAPE = ({ c, ids, selector, titles }) => {
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const label = e => (e.innerText || (e instanceof HTMLInputElement && ['submit', 'button', 'image'].includes(e.type) ? (e.value || e.alt) : '') || e.getAttribute('aria-label') || e.querySelector?.('img[alt]')?.alt || e.getAttribute('alt') || e.title || '').replace(/\s+/g, ' ').trim();
  const shown = [...document.querySelectorAll(selector)].filter(e => visible(e) && !e.disabled).map(label), count = text => shown.filter(t => t === text).length;
  const frames = [...document.querySelectorAll('iframe,frame')]; let sameOrigin = 0; for (const f of frames) { try { if (f.contentDocument) sameOrigin++; } catch { /* another origin */ } }
  const t = document.title;
  return { document: String(performance.timeOrigin), origin: location.origin === c.origin, top: window.top === window,
    title: titles[t] || (/ - PayPay銀行$/.test(t) ? 'other-bank' : 'other'),
    readyState: document.readyState, visibility: document.visibilityState, focus: document.hasFocus(),
    password: [...document.querySelectorAll('input[type="password"]')].some(visible),
    controls: { period: count(c.period), logout: count(c.logout), csv: count(c.export), close: count(c.panelOpen), query: count(c.query) },
    dates: ids.map(id => { const all = [...document.querySelectorAll('input,select,textarea')].filter(e => e.name === id || e.id === id); return { total: all.length, visible: all.filter(visible).length, select: all.filter(e => e instanceof HTMLSelectElement).length, disabled: all.filter(e => e.disabled).length }; }),
    panelClose: count(c.panelOpen) > 0, frames: { total: frames.length, sameOrigin } };
};

/**
 * The ui of a routine PayPay retrieval: a superset of the unchanged guided standardUi (open/show/loginForm/login/document/
 * sessionInUse/downloadSession stay its own), adding the observed page state and statement steps. login() keeps the one native
 * submission; its outcome becomes `authenticated` (D1) only when that submission, within the settle window and with no dialog open,
 * reached a NEW top document of the official origin classified as the exact Welcome page — never from a pathname, a file, a similar
 * title, an older document or a page after the person was asked. An already-queued guided observe job uses the same ui and still
 * treats that outcome as merely submitted (bank.mjs guidedSignIn: P1). JS dialogs are never accepted — except the one observed logout
 * confirm of finish()'s own ログアウト press (logoutConfirm below) — while one is open state() is `verification` and the person decides. snapshot() refuses to export unless the sign-in was direct or the connection carries an
 * account label (verified on the page by bank.mjs). finish() closes the download tab this job's CSV press opened (no other page),
 * then presses ログアウト once;
 * it is bounded and never changes the job's result. `options` are the test seams for the settle and step windows.
 */
export function routineUi(page, browser, adapter = standard, snapshot = null, { settleMs = 30000, stableMs = 2500, stepMs = 45000, finishMs = 10000 } = {}) {
  const c = STANDARD_PAGES, label = adapter?.label || 'PayPay銀行', base = standardUi(page, browser, adapter, snapshot, { settleMs, stableMs });
  const bounded = (promise, ms = 5000) => Promise.race([promise, pause(ms).then(() => null)]);
  const fields = c.periodFields;
  // `known`: the page targets of this browser just before this job's CSV press (null until then); only a tab opened after it counts.
  let direct = false, dialogs = null, waiting = false, queried = false, period = null, known = null;
  // `pressed`: the step control last activated by this job and the document it was activated on (diagnostic() only; no decision uses it).
  let pressed = null;
  const PRESSED = { [c.open]: 'open', [c.period]: 'period', [c.query]: 'query', [c.export]: 'export', [c.logout]: 'logout' };
  const TITLES = { [c.welcome.title]: 'welcome', [c.statements.title]: 'statements', 'ログイン - PayPay銀行': 'login', [c.downloading]: 'downloading' };
  // Plan omf-paypay-logout-20261023 (actual trace, hub CAUSE.md / LIVE-LOGOUT-TRACE.jsonl): right after this job's own verified ログアウト
  // press the bank opened a `confirm` on the statement page whose text had logout and confirmation wording; left unanswered, the
  // post-logout page was never reached. The one exception to "JS dialogs are never accepted": `logout` is the scope of ONE finish()
  // invocation, armed just before its single ログアウト press and dropped when finish() ends or its window passes. Only the FIRST dialog in
  // that scope can be answered, and only when it is a confirm with both wording categories the trace recorded, on this job's own page
  // (this CDP session's target, so never another tab), raised by its current top document on the official origin (the dialog's frame url
  // is the main frame's url; nothing is evaluated under the open dialog). It is accepted once through the session already enabled here.
  // Every other dialog (login, 照会, CSV, one already open, a second one, alert/prompt/beforeunload, a frame, another origin, a late one)
  // is left to the person exactly as before.
  const LOGOUT_WORDS = /ログアウト|log.?out|log.?off/i, CONFIRM_WORDS = /よろしい|しますか|confirm/i;
  let logout = null;
  const accept = scope => { scope.answered = true; dialogs?.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); };
  const logoutConfirm = event => {
    const scope = logout;
    if (!scope || scope.seen || Date.now() > scope.until) return; // guard:routine-logout-scope
    scope.seen = true;
    if (event?.type !== 'confirm') return; // guard:routine-logout-confirm-type
    const text = String(event?.message ?? ''); if (!LOGOUT_WORDS.test(text) || !CONFIRM_WORDS.test(text)) return; // guard:routine-logout-confirm-words
    let same = false; try { same = new URL(String(event?.url)).origin === c.origin && event.url === page.url(); } catch { same = false; } if (!same) return; // guard:routine-logout-confirm-page
    if (scope.pressed) accept(scope); else scope.pending = true;
  };
  const watch = async () => { if (dialogs) return; try { dialogs = await page.createCDPSession(); await dialogs.send('Page.enable'); dialogs.on('Page.javascriptDialogOpening', () => { waiting = true; }); dialogs.on('Page.javascriptDialogOpening', logoutConfirm); dialogs.on('Page.javascriptDialogClosed', () => { waiting = false; }); } catch { dialogs = null; } };
  const read = async () => { try { return (await bounded(page.evaluate(ROUTINE_PAGE, { selector: ROUTINE_CONTROLS }))) || null; } catch { return null; } };
  const kind = async () => waiting ? 'verification' : classifyRoutinePage(await read(), c);
  const reach = async (kinds, code, message) => { const until = Date.now() + stepMs; while (Date.now() < until) { const k = await kind(); if (kinds.includes(k)) return k; await pause(250); } throw coded(code, message); };
  const press = async (pressKind, text, titles, error) => { const doc = (await read())?.document || null; let r = null; pressed = { what: PRESSED[text] || 'other', doc }; try { r = await bounded(page.evaluate(PRESS, { c, selector: ROUTINE_CONTROLS, kind: pressKind, text, titles, expectedDocument: doc })); } catch { r = null; } if (!r?.ok) throw coded(error, `${label}の「${text}」を特定できません（${r?.error || '画面が変わりました'}）。Chromeを確認してください`); };
  const ui = {
    ...base,
    async open() { await watch(); await base.open(); },
    async state() { return { kind: await kind() }; },
    async login(secret, options = {}) {
      const result = await base.login(secret, options);
      if (result?.outcome !== 'submitted' || waiting) return result;
      const now = await read();
      if (now && now.document !== result.document && classifyRoutinePage(now, c) === 'authenticated') { direct = true; return { ...result, outcome: 'authenticated' }; } // guard:routine-direct
      return result;
    },
    async openStatements() {
      const k = await kind(); if (k === 'statements' || k === 'export_ready') return;
      if (k !== 'authenticated') throw coded('statements-unidentified', `${label}のサインイン後の画面が確認済みの形と異なるため、入出金明細を開きません。Chromeを確認してください`);
      await press('link', c.open, [c.welcome.title], 'statements-unidentified');
      await reach(['statements', 'export_ready'], 'statements-unidentified', `${label}の入出金明細が開きませんでした。Chromeを確認してください`);
    },
    async selectPeriod(coverage) {
      const wanted = routinePeriodValues(coverage), k = await kind();
      if (k !== 'statements' && k !== 'export_ready') throw coded('period-unidentified', `${label}の入出金明細の画面ではありません。Chromeを確認してください`);
      let found = await bounded(page.evaluate(PERIOD, { op: 'check', ids: fields }));
      if (!found?.every(f => f === 'ok')) {
        if (found?.some(f => f === 'other')) throw coded('period-unidentified', `${label}の期間の項目が確認済みの形と異なります。Chromeを確認してください`);
        await press('link', c.period, [c.statements.title], 'period-unidentified');
        const until = Date.now() + 15000; while (Date.now() < until) { found = await bounded(page.evaluate(PERIOD, { op: 'check', ids: fields })); if (found?.every(f => f === 'ok')) break; await pause(250); }
        if (!found?.every(f => f === 'ok')) throw coded('period-unidentified', `${label}の期間の項目が表示されませんでした（${(found || []).join('/')}）。Chromeを確認してください`);
      }
      const set = await page.evaluate(PERIOD, { op: 'set', ids: fields, wanted });
      if (!set?.ok) throw coded('period-mismatch', `${label}の期間の項目（${set?.missing || '日付'}）に${coverage.from}〜${coverage.to}を選べません（銀行で選べる範囲外の可能性があります）。Chromeを確認してください`);
      for (const delay of [0, 600]) { if (delay) await pause(delay); const values = await page.evaluate(PERIOD, { op: 'read', ids: fields }); if (!(values.length === wanted.length && values.every((v, i) => v === wanted[i]))) throw coded('period-mismatch', `${label}の期間を${coverage.from}〜${coverage.to}に設定できませんでした。Chromeを確認してください`); } // guard:routine-period-readback
      await press('control', c.query, [c.statements.title], 'period-query');
      await reach(['export_ready'], 'period-query', `${label}の照会が完了しませんでした。Chromeを確認してください`);
      queried = true; period = coverage.from + '〜' + coverage.to;
    },
    async snapshot() {
      if (!direct && !String(snapshot?.accountLabel ?? '').trim()) throw coded('identity-unconfirmed', `${label}へのサインインを、この取得で保存済みのログインを1回送信した直後に確認できなかったため、明細は出力しません。ほかのログインを終えてから、もう一度「取得」を押してください（口座の表示名を接続に保存すると、その表示で口座を確認して出力できます）`); // guard:routine-identity
      return { accountLabel: (await bounded(page.evaluate(() => String(document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 4000)))) || '', period };
    },
    async exportCsv() {
      if (!queried) throw coded('period-query', `${label}の照会をこの取得で行っていないため、CSVは出力しません`); // guard:routine-query-before-export
      if ((await kind()) !== 'export_ready') throw coded('export-unidentified', `${label}のCSV出力の画面ではありません。Chromeを確認してください`);
      await watch(); known = new Set(page.browser().targets()); await press('link', c.export, [c.statements.title], 'export-unidentified');
    },
    async finish() {
      const until = Date.now() + finishMs, left = () => Math.max(0, until - Date.now()), result = { downloadTabsClosed: 0, loggedOut: false };
      try {
        // this job's download tab only: a page target that appeared after its CSV press, was opened by this job's page (the observed
        // tab is a script-opened about:blank document titled ダウンロード中, worker-logs/R2-opener-probe.txt), still shows the exact
        // title, and is about:blank or the official origin. The initial blank tab, a sibling or older tab, a foreign page and a page
        // opened any other way stay open; an unrecognized tab is only left open (the owned browser ends with the job).
        for (const target of known ? page.browser().targets() : []) { // guard:routine-own-download-tab
          if (known.has(target) || target.type() !== 'page' || target === page.target() || target.opener() !== page.target()) continue;
          let other = null, origin = '', title = ''; try { other = await bounded(target.page(), Math.max(1000, left())); if (!other) continue; origin = other.url() === 'about:blank' ? c.origin : new URL(other.url()).origin; title = (await bounded(other.title(), Math.max(1000, left()))) || ''; } catch { continue; }
          if (origin === c.origin && title === c.downloading) { await bounded(other.close(), 2000); result.downloadTabsClosed++; }
        }
        if (waiting) return { ...result, reason: 'dialog' };
        const k = await kind(); if (k !== 'authenticated' && k !== 'statements' && k !== 'export_ready') return { ...result, reason: 'not-signed-in' };
        // the logout-confirm scope of this invocation (see logoutConfirm): armed before the press because the bank's confirm can arrive
        // before the press call returns; a confirm seen meanwhile is answered only once that press is confirmed as this job's own
        const scope = logout = { until, pressed: false, seen: false, pending: false, answered: false };
        try {
          await press('link', c.logout, [c.welcome.title, c.statements.title], 'logout');
          scope.pressed = true; if (scope.pending && !scope.answered && logout === scope && Date.now() <= until) accept(scope); // guard:routine-logout-own-press
          // `loggedOut` is what this adapter saw afterwards (a password field or an unrecognized page), not proof from the bank's server
          while (left() > 0) { const r = await read(); if (r && (r.password || classifyRoutinePage(r, c) === 'unknown')) return { ...result, loggedOut: true }; await pause(250); }
          return { ...result, reason: 'timeout' };
        } finally { if (logout === scope) logout = null; } // guard:routine-logout-lifetime
      } catch (error) { return { ...result, reason: String(error?.code || 'error') }; }
    },
    /**
     * Plan omf-paypay-live-period-20261023: the optional failure reader bank.mjs calls BEFORE finish() (ログアウト) and cleanup. Value-free:
     * the page kind, categories, flags and counts of SHAPE, the last step control pressed and whether the document changed since; under an
     * open JS dialog nothing is evaluated. It never acts on the page and never decides anything; bank.mjs bounds it and whitelists it.
     */
    async diagnostic() {
      const lastPress = pressed?.what ?? null;
      if (waiting) return { readable: false, dialog: true, lastPress };
      const k = await kind(); let shape = null;
      try { shape = await bounded(page.evaluate(SHAPE, { c: { origin: c.origin, period: c.period, logout: c.logout, export: c.export, panelOpen: c.panelOpen, query: c.query }, ids: fields, selector: ROUTINE_CONTROLS, titles: TITLES }), 2500); } catch { shape = null; }
      if (!shape || typeof shape !== 'object') return { readable: false, dialog: false, kind: k, lastPress };
      const { document: doc, ...rest } = shape;
      return { ...rest, readable: true, dialog: false, kind: k, lastPress, changedSincePress: pressed?.doc ? doc !== pressed.doc : null };
    },
    direct: () => direct
  };
  return ui;
}

/**
 * The standard login (店番号・口座番号), resolved only for a job frozen with variant `standard`. Plan omf-paypay-routine-20261022:
 * a retrieve job runs the routine steps (support 'verified' = steps implemented; live acceptance is separate); an observe job queued
 * before (a historical guided snapshot) still runs the guided first capture through the same ui (guided stays true).
 */
export const standard = Object.freeze({
  provider: 'paypay', label: 'PayPay銀行', variant: 'standard', support: 'verified', contract: STANDARD_PAGES, guided: true,
  start: STANDARD_ENTRY, hosts: [...HOSTS], loginHosts: [...LOGIN_HOSTS],
  loginExits: Object.freeze({ inUse: true, markRefused: true, acceptDirectOnly: true, texts: ROUTINE_TEXT }),
  ui(page, browser, snapshot = null) { return routineUi(page, browser, this, snapshot); }
});
export default {
  provider: 'paypay', label: 'PayPay銀行', support: 'contract-pending', contract: null,
  start: 'https://www.paypay-bank.co.jp/', hosts: [...HOSTS],
  variants: { standard },
  ui(page) {
    return {
      async open() { await page.goto('https://www.paypay-bank.co.jp/', { waitUntil: 'domcontentloaded', timeout: 60000 }); },
      async state() { return { kind: 'unknown' }; },
      async show() { await page.bringToFront(); },
      login: pending, openStatements: pending, selectPeriod: pending, snapshot: pending, exportCsv: pending,
      async downloadSession(jobDir) { const session = await page.browser().target().createCDPSession(); await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: jobDir, eventsEnabled: true }); return { on: (event, handler) => session.on(event, handler), async close() { await session.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: false }).catch(() => {}); await session.detach().catch(() => {}); } }; }
    };
  }
};
