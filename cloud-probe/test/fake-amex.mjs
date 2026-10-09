// Fake Amex page, browser and CDP session for the Railway probe legs (plan omf-railway-amex-probe-20261007, S6).
// It walks the Windows collector's own surfaces (collector/login.mjs loginUi kinds, collector/statement.mjs
// statementSnapshot shapes) with canned shapes per surface, and after login() / code() it renders the
// canaries VISIBLY: value attributes, a text node, a child frame text node, a percent-encoded href. The
// string step in cloud-probe/run.mjs must scrub them; nothing here hides them. Synthetic data only.
// Plan omf-amex-human-verification-20261009: a scenario may mount the reCAPTCHA Amex's public login bundle shows —
// visible, hidden (no layout box) or script-only (no container) — with the first login render or when #loginSubmit
// is clicked. The runner's public DOM detector (cloud-probe/run.mjs visibleChallenge) runs its OWN source against a
// minimal document of that container; nothing private (React state, LGON018) exists here, as in production.
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { HEADERS } from '../../shared/amex.mjs';
import { statementSnapshot } from '../../collector/statement.mjs';

export const WWW = 'https://www.americanexpress.com', GLOBAL = 'https://global.americanexpress.com';
export const LOGIN_URL = WWW + '/ja-jp/account/login?inav=iNavLnkLog';
export const VERIFY_URL = WWW + '/ja-jp/account/reauth/verify';
export const NOTICE_URL = WWW + '/ja-jp/notice/unavailable';
export const HOME_URL = GLOBAL + '/dashboard';
export const STATEMENT_URL = GLOBAL + '/activity/statement';
export const FRAME_URL = WWW + '/ja-jp/account/session-frame';

// Fixture inputs (plan §4): canary credentials, account 12345, masked recipient, the one mail match.
export const CREDENTIALS = Object.freeze({ username: 'canary-user-kitamura-7731', password: 'Canary-Passw0rd-Zeta-4471' });
export const MAIL_MATCH = Object.freeze({ id: 'synthetic-message', code: '123456' });
export const ACCOUNT = Object.freeze({ _id: 'synthetic-account-12345', name: 'Synthetic Amex', primaryCard: '12345', cardIdentifiers: Object.freeze(['12345']), otpRecipient: 'original@example.invalid', otpMailbox: 'forwarded@example.invalid' });
export const MASKED_RECIPIENT = 'o******l@example.invalid', WRONG_RECIPIENT = 'x******z@example.invalid';
export const STATEMENT = Object.freeze({ start: '2026-04-22', end: '2026-05-21' });
export const CSV_CANARY = 'CANARY-CSV-ROW-7731';
export const CANARIES = Object.freeze([CREDENTIALS.username, CREDENTIALS.password, MAIL_MATCH.code, CSV_CANARY]);
export const CHROME_VERSION = 'Chrome/155.0.8059.39';
export const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

// Synthetic Amex CSV in shared/amex.mjs HEADERS, card 12345, inside the 2026-04-22..2026-05-21 statement.
export function syntheticCsv(rows = 4) {
  const lines = [HEADERS.join(',')];
  for (let i = 1; i <= rows; i++) lines.push(`2026/04/${String(21 + i).padStart(2, '0')},2026/04/${String(22 + i).padStart(2, '0')},${CSV_CANARY}-${i},CANARY HOLDER,-12345,${1000 * i},,`);
  return Buffer.from(lines.join('\r\n') + '\r\n', 'utf8');
}

const DEFAULTS = {
  start: 'login',             // surface reached by the first navigation to the login URL
  afterLogin: 'channels',     // surface after #loginSubmit: channels | authenticated | unknown | login
  afterCode: 'authenticated', // surface after the code is submitted: authenticated | unknown
  loginRejected: false,       // #loginSubmit leaves the page where it is
  wrongRecipient: false,      // the channel label shows a different masked address
  statementCardMismatch: false, // the statement page shows another card suffix
  csvRows: 4,                 // rows in the downloaded CSV (the page says 4)
  gotoThrows: false,          // every navigation throws like a DNS failure
  connectThrows: false,       // connect() throws like a missing Chrome
  domStepThrowsForFrame: null, // index of the frame whose DOM step throws
  events: null,               // shared event list
  onTypeCode: null,           // hook run when the code is typed
  challenge: null,            // null | 'visible' | 'hidden' | 'script-only': the reCAPTCHA the page mounts (public DOM only)
  challengeAt: 'start',       // 'start' (with the first login render; a login navigation re-mounts it) | 'afterLogin' (when #loginSubmit is clicked; a navigation clears it)
  unknownUrl: NOTICE_URL      // the url of the unknown surface
};

export function fakeAmex(scenario = {}) {
  const s = { ...DEFAULTS, ...scenario };
  const events = s.events || [];
  const typed = { username: '', password: '', code: '' };
  const counts = { password: 0, connects: 0, screenshots: 0, closes: 0, connectOptions: null, loginNavigations: 0 };
  let url = 'about:blank', surface = 'blank', selected = false, dialogOpen = false, csvChecked = false, focused = null, pending = null, downloadPath = null, challengeMounted = false;
  const cdpHandlers = new Map();

  const go = name => {
    surface = name;
    url = { login: LOGIN_URL, channels: VERIFY_URL, code: VERIFY_URL, authenticated: HOME_URL, unknown: s.unknownUrl }[name] || s.unknownUrl;
  };
  // The public DOM the detector may read: the one container when the scenario mounts one — a layout box only when it
  // is visible — and nothing else. The detector's own source runs against it (page.evaluate has no closure either).
  const publicDom = () => {
    const present = challengeMounted && (s.challenge === 'visible' || s.challenge === 'hidden');
    const visible = present && s.challenge === 'visible';
    const container = present ? { getBoundingClientRect: () => ({ width: visible ? 304 : 0, height: visible ? 78 : 0 }), checkVisibility: () => visible } : null;
    return { querySelector: selector => /recaptcha-container|g-recaptcha/.test(String(selector)) ? container : null };
  };
  const inPublicDom = fn => vm.runInContext(`(${fn.toString()})()`, vm.createContext({ document: publicDom() }));
  const challengeMarkup = () => {
    if (!challengeMounted || !s.challenge) return '';
    if (s.challenge === 'visible') return '<div data-testid="recaptcha-container" data-synthetic="visible-challenge"><button data-testid="recaptcha-close-button">閉じる</button></div>';
    if (s.challenge === 'hidden') return '<div data-testid="recaptcha-container" data-synthetic="hidden-challenge" style="display:none"></div>';
    return '<!-- synthetic script-only challenge: a loader, no container -->';
  };
  const attr = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const render = frameIndex => {
    if (frameIndex === 1) return { html: `<html><body><span id="frame-user">${typed.username}</span></body></html>`, text: typed.username };
    const parts = [];
    if (typed.username || typed.password) {
      parts.push(`<form id="login"><input id="eliloUserID" value="${attr(typed.username)}"><input id="eliloPassword" type="password" value="${attr(typed.password)}"><button id="loginSubmit">ログイン</button></form>`);
      parts.push(`<p id="greeting">ようこそ ${typed.username} さん</p>`);
      parts.push(`<a id="profile" href="/ja-jp/account/profile?user=${encodeURIComponent(typed.username)}">プロフィール</a>`);
    }
    if (typed.code) parts.push(`<input id="question-input" autocomplete="one-time-code" value="${attr(typed.code)}"><p id="echo">入力された認証コード ${typed.code}</p>`);
    parts.push(challengeMarkup());
    parts.push(`<p id="surface">${surface}</p>`);
    const text = [typed.username && `ようこそ ${typed.username} さん`, typed.code && `入力された認証コード ${typed.code}`, surface].filter(Boolean).join('\n');
    return { html: `<html><head><title>${surface}</title></head><body>${parts.join('')}</body></html>`, text };
  };
  const content = frameIndex => render(frameIndex).html.replace('<html>', '<!-- content() --><html>');

  const snapshot = () => {
    const links = [
      { text: '2026/03/22 - 2026/04/21', href: '/activity/statement?end=2026-04-21' },
      { text: '2026/04/22 - 2026/05/21', href: '/activity/statement?end=2026-05-21' },
      { text: 'この期間を見る', href: '/activity/statement?end=2026-05-21' }
    ];
    const cards = [s.statementCardMismatch ? '-54321' : '-12345'];
    if (surface === 'statement-list') return { url, links, periods: [], cards, counts: [] };
    return { url, links, periods: ['（2026/04/22－2026/05/21）'], cards, counts: [[4, 4]] };
  };

  const controls = () => {
    if (surface === 'login') return [['#loginSubmit', null]];
    if (surface === 'channels') return [[`label[for="${selected ? 'regenerated-id' : 'original-id'}"]`, null], ['button', '次へ']];
    if (surface === 'code') return [['button', '次へ']];
    if (surface === 'statement') return [['#action-icon-dls-icon-download-', null], ...(dialogOpen ? [['label[for="axp-activity-download-body-selection-options-type_csv"]', null], ['[role="dialog"] button', 'ダウンロード']] : [])];
    return [];
  };
  const inputs = () => surface === 'login' ? ['#eliloUserID', '#eliloPassword'] : surface === 'code' ? ['#question-input'] : [];

  const emitCdp = (event, payload) => { for (const handler of cdpHandlers.get(event) || []) handler(payload); };
  const download = async () => {
    if (!downloadPath) throw new Error('fake-amex: download started without a download path');
    const guid = randomUUID();
    emitCdp('Browser.downloadWillBegin', { guid, suggestedFilename: 'activity.csv' });
    await mkdir(downloadPath, { recursive: true });
    await writeFile(path.join(downloadPath, guid), syntheticCsv(s.csvRows));
    events.push('download');
    emitCdp('Browser.downloadProgress', { guid, state: 'completed' });
  };

  const evaluate = async (frameIndex, fn, arg) => {
    const src = typeof fn === 'function' ? fn.toString() : String(fn);
    if (fn === statementSnapshot) return snapshot();
    if (src.includes('recaptcha-container')) { if (frameIndex !== 0) throw new Error('fake-amex: unexpected child-frame evaluate'); return inPublicDom(fn); }
    if (src.includes('outerHTML')) {
      if (s.domStepThrowsForFrame === frameIndex) throw new Error('Execution context was destroyed, most likely because of a navigation.');
      return render(frameIndex);
    }
    if (src.includes('navigator.webdriver')) return { webdriver: false, languages: ['ja-JP', 'ja'], timeZone: 'Asia/Tokyo' };
    if (frameIndex !== 0) throw new Error('fake-amex: unexpected child-frame evaluate');
    if (src.includes('a[href*="/activity/statement"]')) return ['authenticated', 'statement-list', 'statement'].includes(surface);
    if (src.includes('#eliloUserID')) return surface === 'login';
    if (src.includes('question-input')) {
      if (surface === 'channels') return { kind: 'channels', channels: [{ id: selected ? 'regenerated-id' : 'original-id', text: s.wrongRecipient ? WRONG_RECIPIENT : MASKED_RECIPIENT, checked: selected }] };
      if (surface === 'code') return { kind: 'code', recipients: [s.wrongRecipient ? WRONG_RECIPIENT : MASKED_RECIPIENT] };
      return { kind: 'unknown' };
    }
    if (src.includes('input.focus()')) {
      if (!inputs().includes(arg)) throw new Error('Amex input unavailable');
      focused = arg;
      return undefined;
    }
    if (src.includes('elementFromPoint')) {
      const { selector, text } = arg;
      const targets = controls().filter(([sel, label]) => sel === selector && (text === null || label === text));
      if (targets.length !== 1) throw new Error('Amex control did not uniquely match');
      pending = { selector, text };
      return { x: 10, y: 10 };
    }
    if (typeof arg === 'string' && src.includes('checked === true')) return csvChecked;
    if (typeof arg === 'string' && src.includes('querySelector(selector)')) return dialogOpen;
    throw new Error('fake-amex: unrecognised evaluate: ' + src.slice(0, 80));
  };

  const frameAt = index => ({
    url: () => index === 0 ? url : FRAME_URL,
    evaluate: (fn, arg) => evaluate(index, fn, arg),
    content: async () => content(index)
  });
  const mainFrame = frameAt(0), childFrame = frameAt(1);

  const page = {
    url: () => url,
    async goto(target) {
      if (s.gotoThrows) throw new Error('net::ERR_NAME_NOT_RESOLVED at ' + target);
      const u = new URL(target);
      if (u.origin === WWW && u.pathname === '/ja-jp/account/login') { counts.loginNavigations += 1; challengeMounted = !!s.challenge && s.challengeAt === 'start'; go(s.start); }
      else if (u.origin === GLOBAL && u.pathname === '/activity/statement') {
        url = target;
        if (u.searchParams.has('end')) surface = 'statement';
        else { surface = 'statement-list'; events.push('statement'); }
      } else { url = target; surface = 'unknown'; }
      return { status: () => 200 };
    },
    evaluate: (fn, arg) => evaluate(0, fn, arg),
    keyboard: {
      async down() {}, async press() {}, async up() {},
      async type(value) {
        if (focused === '#eliloUserID') typed.username = value;
        else if (focused === '#eliloPassword') { typed.password = value; counts.password += 1; }
        else if (focused === '#question-input') { typed.code = value; events.push('type-code'); if (s.onTypeCode) await s.onTypeCode(); }
        else throw new Error('fake-amex: typing without a focused input');
      }
    },
    mouse: {
      async click() {
        const target = pending; pending = null;
        if (!target) throw new Error('fake-amex: click without a resolved control');
        if (target.selector === '#loginSubmit') { events.push('login'); if (s.challenge && s.challengeAt === 'afterLogin') challengeMounted = true; if (!s.loginRejected) go(s.afterLogin); return; }
        if (target.selector.startsWith('label[for=') && surface === 'channels') { selected = true; events.push('choose-email'); return; }
        if (target.selector === 'button' && target.text === '次へ') {
          if (surface === 'channels') { events.push('request-code'); go('code'); }
          else if (surface === 'code') { events.push('submit-code'); go(s.afterCode); }
          return;
        }
        if (target.selector === '#action-icon-dls-icon-download-') { dialogOpen = true; return; }
        if (target.selector === 'label[for="axp-activity-download-body-selection-options-type_csv"]') { csvChecked = true; return; }
        if (target.selector === '[role="dialog"] button' && target.text === 'ダウンロード') { await download(); return; }
        throw new Error('fake-amex: unhandled click ' + target.selector);
      }
    },
    async bringToFront() { events.push('manual'); },
    async content() { return content(0); },
    frames: () => [mainFrame, childFrame],
    mainFrame: () => mainFrame,
    /** @param {{ type?: string, encoding?: string }} [options] */
    async screenshot({ encoding } = {}) {
      counts.screenshots += 1;
      const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('FAKE-PNG')]);
      return encoding === 'base64' ? bytes.toString('base64') : bytes;
    },
    on() {}, off() {},
    isClosed: () => false
  };

  const session = {
    async send(method, params = {}) {
      if (method === 'Browser.setDownloadBehavior') downloadPath = params.behavior === 'allowAndName' ? params.downloadPath : null;
      return {};
    },
    on(event, handler) { if (!cdpHandlers.has(event)) cdpHandlers.set(event, []); cdpHandlers.get(event).push(handler); },
    async detach() {}
  };

  const browser = {
    async pages() { return [page]; },
    async newPage() { return page; },
    target: () => ({ createCDPSession: async () => session }),
    async version() { return CHROME_VERSION; },
    async userAgent() { return USER_AGENT; },
    async close() { counts.closes += 1; },
    on() {},
    connected: true
  };

  const connect = async options => {
    counts.connects += 1;
    counts.connectOptions = options;
    if (s.connectThrows) throw new Error('Failed to launch the browser process! /usr/bin/google-chrome-stable: error while loading shared libraries: libnss3.so');
    return { browser, page };
  };

  return { connect, browser, page, events, typed, counts, state: () => ({ url, surface, selected, dialogOpen, csvChecked, challengeMounted }) };
}
