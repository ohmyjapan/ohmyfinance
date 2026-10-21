// collector/banks/paypay.mjs — PayPay銀行 adapter. The provider default stays 'contract-pending' (plan
// omf-bank-collection-amended-20261018 A6): no authenticated selector, export step, period limit or CSV template is claimed; its `start`
// is the official homepage and `hosts` bound the download-host guard. Plan omf-paypay-four-accounts-20261021: only the frozen variant
// `standard` (標準ログイン: 店番号・口座番号・ログインパスワード) resolves `variants.standard` (collector/bank.mjs adapterFor) — still
// 'contract-pending' and `guided`: its observe job opens the published standard login link and, with the claimed account's saved login
// (index.mjs bankLoginFor), fills the publicly observed login form once and activates its one submit control so the page's own,
// per-document generated onSubmit handler runs (output/plan/omf-rakuten-auto-login-20261021/PAYPAY-PUBLIC-ENTRY-1792555450347.json and
// PAYPAY-PUBLIC-NAVIGATION-1792555549500.json: form HOST POST NBCW2101.do; idTenNo/TenNo tel 3, idKozaNo/KozaNo tel 7, idPw/Pw password
// 32; one submit `login`). Nothing after the submission is classified: the authenticated pages, the statement controls and the export
// are the person's steps in the same owned window until the actual export is observed. The generated handler name is never pinned, no
// POST is rebuilt or replayed, no value is read back, no keyboard or pointer input is used. BA-PLUS (専用ログイン) is not a saved-login
// variant: its observe job opens the provider default. Imports only ../interaction.mjs, so the staged copy loads without node_modules.
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
 * The ui of the guided standard login (the shape of contractUi). Nothing is read from the page at construction (the staged-package
 * check constructs it with empty objects). state() is always `unknown`: no authenticated page is inferred from navigation. loginForm/
 * document/login(secret) are the saved-login steps bank.mjs guidedSignIn drives (at most one submission per job). `options` are the
 * test seams for the settle window.
 */
export function standardUi(page, browser, adapter = standard, snapshot = null, { settleMs = 30000, stableMs = 2500 } = {}) {
  const label = adapter?.label || 'PayPay銀行', hosts = adapter?.hosts || HOSTS, start = adapter?.start || STANDARD_ENTRY;
  const bounded = (promise, ms = 5000) => Promise.race([promise, pause(ms).then(() => null)]);
  const current = () => { let url; try { url = new URL(page.url()); } catch { throw new Error(`${label}のページを確認できません`); } if (!onHosts(url.hostname, hosts)) throw new Error(`${label}のページではありません。Chromeを確認して再試行してください`); return url; };
  // After the one submission: the exact login form on a NEW document → 'rejected'; another new document that stays put → 'submitted'
  // (never 'authenticated': only the person's completed CSV proves the sign-in); no new document within the window → 'attention'.
  const settle = async before => {
    const until = Date.now() + settleMs; let changed = false, last = null, since = 0;
    while (Date.now() < until) {
      await pause(250);
      const doc = await ui.document(); if (doc && doc !== before) changed = true;
      if (!changed) continue;
      if ((await ui.loginForm()).ok) return 'rejected';
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

/** The standard login (店番号・口座番号): resolved only for a job frozen with variant `standard`; guided, still contract-pending. */
export const standard = Object.freeze({
  provider: 'paypay', label: 'PayPay銀行', variant: 'standard', support: 'contract-pending', contract: null, guided: true,
  start: STANDARD_ENTRY, hosts: [...HOSTS], loginHosts: [...LOGIN_HOSTS],
  ui(page, browser, snapshot = null) { return standardUi(page, browser, this, snapshot); }
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
