import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { click, fill, onSurface, pause, poll } from './interaction.mjs';

export const LOGIN = 'https://www.americanexpress.com/ja-jp/account/login?inav=iNavLnkLog';
const WWW = 'https://www.americanexpress.com', GLOBAL = 'https://global.americanexpress.com';
const LOGIN_PATH = '/ja-jp/account/login', VERIFY_PATH = '/ja-jp/account/reauth/verify';

export function matchesRecipient(masked, recipient) {
  const [local, domain, extra] = String(masked).trim().toLowerCase().split('@');
  const [expected, expectedDomain] = String(recipient).trim().toLowerCase().split('@');
  if (!local || extra || !domain || domain !== expectedDomain || !expected || !/[a-z0-9]/.test(local)) return false;
  const expression = '^' + [...local].map(c => c === '*' ? '.*' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$';
  return new RegExp(expression).test(expected);
}

export class LoginClaims {
  constructor(directory) { this.file = path.join(directory, 'used-login-messages.json'); }
  async read() {
    try {
      const ids = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('Invalid consumed login-message record');
      return ids;
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async claim(id) {
    const used = await this.read();
    if (!id || used.includes(id)) throw new Error('This login message was already used');
    // Single collector process, serial account jobs. Persist before typing; never store codes.
    await writeFile(this.file + '.new', JSON.stringify([...used, id].slice(-200)), { mode: 0o600 });
    await rename(this.file + '.new', this.file);
  }
}

// `reveal` (plan omf-card-handover-20261030): the background card wrapper's way to show the person this SAME owned page when they are
// needed (collector/browser.mjs showWindow); without it show() keeps bringing the tab to the front, as every other caller expects.
// `trace` (case omf-amex-login-fix-20261031, optional): a sink for the value-free login trace below. Without it this returns exactly the
// ui it always returned and no trace code runs; with it the same ui is wrapped and login() reports at three fixed points.
export function loginUi(page, { reveal = null, trace = null } = {}) {
  const t = typeof trace === 'function' ? loginTrace(page, trace) : null; // guard:login-trace-optional
  const ui = {
    async state() {
      if (onSurface(page, GLOBAL)) {
        if (await page.evaluate(() => !!document.querySelector('a[href*="/activity/statement"]'))) return { kind: 'authenticated' };
      } else if (onSurface(page, WWW, LOGIN_PATH)) {
        if (await page.evaluate(() => !!document.querySelector('#eliloUserID') && !!document.querySelector('#eliloPassword') && !!document.querySelector('#loginSubmit'))) return { kind: 'login' };
      } else if (onSurface(page, WWW, VERIFY_PATH)) {
        return page.evaluate(() => {
          const visible = e => e.getBoundingClientRect().height > 0;
          const channels = [...document.querySelectorAll('label')].filter(e => visible(e) && document.getElementById(e.htmlFor)?.type === 'radio').map(e => ({ id: e.htmlFor, text: e.textContent.trim(), checked: document.getElementById(e.htmlFor).checked }));
          if (channels.length) return { kind: 'channels', channels };
          const input = document.querySelector('#question-input');
          if (input && visible(input) && !input.disabled && !input.readOnly && input.autocomplete === 'one-time-code' && document.querySelector('label[for="question-input"]')?.textContent.trim() === '認証コード') {
            return { kind: 'code', recipients: document.body.innerText.match(/[a-zA-Z0-9.*_+-]+@[a-zA-Z0-9.-]+/g) || [] };
          }
          return { kind: 'unknown' };
        });
      }
      return { kind: 'unknown' };
    },
    async open() {
      const url = new URL(page.url());
      if (![WWW, GLOBAL].includes(url.origin) || url.pathname === LOGIN_PATH) await page.goto(LOGIN, { waitUntil: 'domcontentloaded', timeout: 60000 });
    },
    async login(credentials) {
      if (t) await t.ready(); // the fields as they are before typing
      await fill(page, '#eliloUserID', credentials.username, WWW, LOGIN_PATH);
      await fill(page, '#eliloPassword', credentials.password, WWW, LOGIN_PATH);
      if (t) await t.filled(credentials.username, credentials.password); // booleans only; the values are not kept
      await click(page, '#loginSubmit', null, WWW, LOGIN_PATH);
      if (t) await t.submitted(); // the clicks and submit events the page received
    },
    async choose(channel) { await click(page, 'label[for=' + JSON.stringify(channel.id) + ']', null, WWW, VERIFY_PATH); },
    async next() { await click(page, 'button', '次へ', WWW, VERIFY_PATH); },
    async code(value) { await fill(page, '#question-input', value, WWW, VERIFY_PATH); },
    async show() { if (reveal) await reveal(page); else await page.bringToFront(); } // guard:login-reveal
  };
  return t ? t.wrap(ui) : ui;
}

// ── Value-free login trace (case omf-amex-login-fix-20261031) ────────────────────────────────────────────────────────────────────
// The first real sign-ins stayed on the login page and nothing showed why: whether the fields were ready, whether each held the intended
// value before the submit, whether the page received the click and a submit event, and what the network answered. With loginUi's `trace`
// the sink receives a closed set of frozen events — fixed categories, booleans, small counts, milliseconds and allowlisted HTTP
// statuses — and never a login value or any hash, length or part of one, a URL, query, header, cookie, body, title, DOM text or error text.
//  - Before typing (page.evaluate, read-only, as state() reads): each field present, visible, enabled, editable and React-attached.
//  - After typing, before the click: whether each field holds exactly the intended value. Neither value nor any digest of one is handed to
//    the browser: a numeric execution context id may name another document after a navigation across processes (devtools-protocol
//    Runtime.callFunctionOn uniqueContextId, unavailable without Runtime.enable). The trace's own isolated world (Page.createIsolatedWorld
//    on its own DevTools session, invisible to the page's scripts) reads both fields only on the login page's origin and path and answers
//    a transient SHA-256 of each field's UTF-16 code units under a fresh random nonce; this process compares it with its own digest of the
//    intended value and keeps only the boolean. A wrong document, missing WebCrypto or a malformed answer leaves it unknown (null).
//  - The clicks, submit and invalid events the page received, counted by listeners in that isolated world from just before the click.
//  - Main-frame navigations and load events; the network as fixed surfaces (login, verify, www, global, amex, other), methods, types,
//    allowlisted statuses and failure categories (never postData(), headers(), text(), json() or buffer()). Every state-changing request
//    after the click is listed, up to NETWORK_EVENTS, and all are counted. One endpoint is named: the login request of the issuer's public
//    login module (LOGIN_API on the www or global origin) — its request and its answer or failure, for its CORS preflight (OPTIONS) as for
//    its POST, before or after the click, up to LOGIN_EVENTS, all counted per method. That is the request the public code makes to sign in,
//    sent or answered; it proves no authentication or rejection, and an answer of any other endpoint (an analytics 4xx) is 'other'.
//  - On the state() reads ensureLogin already makes, at most SAMPLE_AT.length per phase: fixed page flags (fields present or emptied,
//    alerts, invalid fields, dialogs, frames, busy markers and the reCAPTCHA container cloud-probe/run.mjs observed).
// Each step is bounded by TRACE_MS and swallows its own failure; the trace never clicks, types, waits, polls, retries or decides
// anything, so the login's attempts, deadlines, statuses and attention are those of ensureLogin alone. The sink's errors are ignored.
// Its listeners end at authentication or at stopTrace(), which the wrapper awaits before the owned page closes.
const TRACE_MS = 1500, TRACE_EVENTS = 200, NETWORK_EVENTS = 60, LOGIN_EVENTS = 40, SAMPLE_AT = Object.freeze([1, 2, 4, 8, 16, 32, 64, 128]);
const TRACE_WORLD = 'omf-login-trace';
const CHALLENGE = '[data-testid="recaptcha-container"], .g-recaptcha'; // the container cloud-probe/run.mjs visibleChallenge detects
// The path of the public one-identity login module's login request (loginAction: POST /myca/logon/${region}/action/login, region one of its
// countryToRegionMap values or its default "us"; case omf-amex-login-fix-20261031 PUBLIC-ENDPOINT-EVIDENCE.json), anchored.
const LOGIN_API = /^\/myca\/logon\/(?:canlac|emea|japa|us)\/action\/login$/;
const KINDS = ['authenticated', 'login', 'channels', 'code', 'unknown'];
const HOSTS = ['www', 'global', 'amex', 'other'];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'], WRITES = ['POST', 'PUT', 'PATCH', 'DELETE'];
const TYPES = ['document', 'xhr', 'fetch', 'preflight'];
const STATUSES = [200, 201, 202, 204, 206, 301, 302, 303, 304, 307, 308, 400, 401, 403, 404, 405, 406, 408, 409, 410, 412, 413, 415, 422, 423, 428, 429, 431, 451, 500, 501, 502, 503, 504];
const READY_STATES = ['loading', 'interactive', 'complete'], VISIBILITIES = ['visible', 'hidden'], BUTTON_TYPES = ['submit', 'button', 'reset'];
const FOCUS = ['body', 'user', 'password', 'submit', 'other'];
const FAILURES = [[/^net::ERR_ABORTED$/, 'aborted'], [/^net::ERR_BLOCKED_BY_[A-Z_]+$/, 'blocked'], [/^net::ERR_(?:CONNECTION_)?TIMED_OUT$/, 'timeout'], [/^net::ERR_(?:CONNECTION_[A-Z_]+|EMPTY_RESPONSE)$/, 'connection'], [/^net::ERR_NAME_NOT_RESOLVED$/, 'dns'], [/^net::ERR_(?:INTERNET_DISCONNECTED|NETWORK_CHANGED|ADDRESS_UNREACHABLE)$/, 'offline'], [/^net::ERR_(?:CERT|SSL)_[A-Z_]+$/, 'tls'], [/^net::ERR_TOO_MANY_REDIRECTS$/, 'redirects'], [/^net::ERR_FAILED$/, 'failed']];
const LOGIN_ERRORS = [[/input unavailable/, 'input-unavailable'], [/page changed/, 'surface'], [/did not uniquely match/, 'not-unique'], [/covered by another element/, 'covered']];

const within = (fn, ms = TRACE_MS) => { let timer; return Promise.race([Promise.resolve().then(fn).catch(() => null), new Promise(resolve => { timer = setTimeout(resolve, ms, null); })]).finally(() => clearTimeout(timer)); };
const flag = value => typeof value === 'boolean' ? value : null;
const count = (value, max = 99) => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, max) : null;
const one = (value, list) => value == null ? null : list.includes(value) ? value : 'other';
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) freeze(item); } return value; };
/** The fixed surface of a URL: blank, login, verify, www, global, amex or other; the URL itself is never kept. */
function traceSurface(url) {
  let u; try { u = new URL(String(url)); } catch { return 'other'; }
  if (u.protocol === 'about:') return 'blank';
  if (u.origin === WWW) return u.pathname === LOGIN_PATH ? 'login' : u.pathname === VERIFY_PATH ? 'verify' : 'www';
  if (u.origin === GLOBAL) return 'global';
  return u.protocol === 'https:' && /(?:^|\.)americanexpress\.com$/.test(u.hostname) ? 'amex' : 'other';
}
/** 'login-api' for exactly the public login module's login request (the https www or global origin and LOGIN_API), else 'other'. */
function endpointOf(url) {
  let u; try { u = new URL(String(url)); } catch { return 'other'; }
  return (u.origin === WWW || u.origin === GLOBAL) && LOGIN_API.test(u.pathname) ? 'login-api' : 'other';
}
const hostOf = surface => ['login', 'verify', 'www'].includes(surface) ? 'www' : HOSTS.includes(surface) ? surface : 'other';
const classOf = status => Number.isSafeInteger(status) && status >= 200 && status < 600 ? Math.floor(status / 100) + 'xx' : 'other';
const apiMethod = method => method === 'OPTIONS' ? 'options' : method === 'POST' ? 'post' : 'other';
const field = f => ({ present: flag(f?.present), visible: flag(f?.visible), enabled: flag(f?.enabled), editable: flag(f?.editable), react: flag(f?.react) });
const filledField = (f, matches) => ({ matches: flag(matches), empty: flag(f?.empty), valid: flag(f?.valid), ariaInvalid: flag(f?.ariaInvalid) });
/** SHA-256 of the nonce and the UTF-16LE code units of `value` (FILLED's encoding, exact for every string, lone surrogates included). */
const digestOf = (nonce, value) => typeof value === 'string' ? createHash('sha256').update(nonce).update(Buffer.from(value, 'utf16le')).digest() : null;
/** Whether the page's digest (64 lowercase hex) equals the expected one; null when either is missing or malformed. Neither is kept. */
const sameDigest = (hex, expected) => typeof hex === 'string' && /^[0-9a-f]{64}$/.test(hex) && expected ? timingSafeEqual(Buffer.from(hex, 'hex'), expected) : null;
const NATIVE_KEYS = ['clicks', 'trusted', 'buttonClicks', 'submits', 'prevented', 'bubbled', 'invalid'];
const native = n => ({ readable: n?.readable === true, ...Object.fromEntries(NATIVE_KEYS.map(key => [key, n?.readable === true ? count(n[key], 999) : null])) });
const cell = () => ({ sent: 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0, failed: 0 });
const phaseCounts = () => ({ requests: 0, responses: 0, failures: 0, writes: Object.fromEntries(HOSTS.map(host => [host, cell()])), login: { options: cell(), post: cell(), other: cell() } });
const capped = counts => JSON.parse(JSON.stringify(counts), (key, value) => typeof value === 'number' ? Math.min(value, 99999) : value);

// Read in the page (main world) like state(): no value leaves the page, only these shapes.
const READY = () => {
  const react = e => Object.keys(e).some(k => /^__react(?:Props|EventHandlers|Fiber|InternalInstance)\$/.test(k));
  const shape = e => e ? { present: true, visible: e.getBoundingClientRect().height > 0, enabled: !e.disabled, editable: !e.readOnly, react: react(e) } : { present: false };
  const u = document.querySelector('#eliloUserID'), p = document.querySelector('#eliloPassword'), b = document.querySelector('#loginSubmit');
  return { readyState: document.readyState, visibility: document.visibilityState, focused: document.hasFocus(), user: shape(u), password: shape(p),
    submit: b ? { present: true, visible: b.getBoundingClientRect().height > 0, enabled: !b.disabled, react: react(b), type: b.type, form: !!b.form, sameForm: !!b.form && b.form === u?.form && b.form === p?.form } : { present: false } };
};
const SAMPLE = challenge => {
  const visible = e => !!e && e.getBoundingClientRect().height > 0, all = selector => [...document.querySelectorAll(selector)].filter(visible);
  const u = document.querySelector('#eliloUserID'), p = document.querySelector('#eliloPassword'), b = document.querySelector('#loginSubmit');
  return { readyState: document.readyState, visibility: document.visibilityState, focused: document.hasFocus(), fields: !!(u && p && b),
    userEmpty: u ? u.value === '' : null, passwordEmpty: p ? p.value === '' : null, submitEnabled: b ? !b.disabled : null, submitType: b ? b.type : null,
    alerts: all('[role="alert"], [role="alertdialog"], [aria-live="assertive"]').filter(e => e.textContent.trim() !== '').length,
    invalid: [u, p].filter(e => e && (e.getAttribute('aria-invalid') === 'true' || (e.validity && !e.validity.valid))).length,
    dialogs: all('[role="dialog"], dialog[open]').length, frames: all('iframe').length, busy: all('[aria-busy="true"]').length, challenge: all(challenge).length > 0 };
};
// Run in the trace's isolated world through Runtime.callFunctionOn: the page's scripts can neither see nor change these.
const LISTEN = function (selector) {
  if (globalThis.__omfLoginTrace) return true;
  const n = { clicks: 0, trusted: 0, buttonClicks: 0, submits: 0, prevented: 0, bubbled: 0, invalid: 0 };
  const onClick = e => { n.clicks++; if (!e.isTrusted) return; n.trusted++; const b = document.querySelector(selector); if (b && e.target instanceof Node && b.contains(e.target)) n.buttonClicks++; };
  const onSubmit = () => { n.submits++; }, afterSubmit = e => { n.bubbled++; if (e.defaultPrevented) n.prevented++; }, onInvalid = () => { n.invalid++; };
  window.addEventListener('click', onClick, true); window.addEventListener('submit', onSubmit, true); window.addEventListener('submit', afterSubmit); window.addEventListener('invalid', onInvalid, true);
  globalThis.__omfLoginTrace = { n, remove() { window.removeEventListener('click', onClick, true); window.removeEventListener('submit', onSubmit, true); window.removeEventListener('submit', afterSubmit); window.removeEventListener('invalid', onInvalid, true); } };
  return true;
};
const NATIVE_READ = function () { const t = globalThis.__omfLoginTrace; return t ? { readable: true, ...t.n } : { readable: false }; };
const UNLISTEN = function () { const t = globalThis.__omfLoginTrace; if (!t) return false; t.remove(); delete globalThis.__omfLoginTrace; return true; };
// Awaited by its bounded call. Only on the login page — origin and path read in the same synchronous step as the fields; any other document
// answers null — each field's flags and a transient SHA-256 of its UTF-16 code units (little-endian) under the call's nonce, never a value.
// Missing or failing WebCrypto leaves the digests null.
const FILLED = async function (nonce, origin, pathname) {
  if (location.origin !== origin || location.pathname !== pathname) return null;
  const u = document.querySelector('#eliloUserID'), p = document.querySelector('#eliloPassword'), b = document.querySelector('#loginSubmit'), a = document.activeElement;
  const values = [u, p].map(e => e ? String(e.value) : null);
  const shape = e => e ? { empty: e.value === '', valid: !!e.validity && e.validity.valid, ariaInvalid: e.getAttribute('aria-invalid') === 'true' } : null;
  const result = { user: shape(u), password: shape(p), focus: !a || a === document.body ? 'body' : a === u ? 'user' : a === p ? 'password' : a === b ? 'submit' : 'other', digests: [null, null] };
  try {
    const salt = Uint8Array.from(nonce.match(/[0-9a-f]{2}/g), h => parseInt(h, 16));
    const digest = async value => {
      const bytes = new Uint8Array(salt.length + value.length * 2); bytes.set(salt);
      for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i); bytes[salt.length + 2 * i] = c & 255; bytes[salt.length + 2 * i + 1] = c >>> 8; }
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
    };
    result.digests = [values[0] === null ? null : await digest(values[0]), values[1] === null ? null : await digest(values[1])];
  } catch { result.digests = [null, null]; }
  return result;
};

function loginTrace(page, sink) {
  const started = Date.now(), ms = () => Math.min(Math.max(0, Date.now() - started), 86400000);
  const url = () => { try { return page.url(); } catch { return null; } };
  const states = Object.fromEntries([...KINDS, 'other'].map(kind => [kind, 0])), calls = { before: 0, after: 0 }, net = { before: phaseCounts(), after: phaseCounts() };
  let phase = 'before', progress = null, submitted = false, emitted = 0, dropped = 0, closed = false, ending = null, lastKind = null, lastSurface = null;
  let stateErrors = 0, samples = 0, networkEvents = 0, networkDropped = 0, loginEvents = 0, loginDropped = 0, listening = false, session = null, context = null, lastNative = null;
  const emit = event => {
    if (closed) return;
    if (event.event === 'end') closed = true;
    else if (emitted >= TRACE_EVENTS - 1) { dropped++; return; }
    emitted++;
    try { const result = sink(freeze(event)); if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {}); } catch { /* the sink's failure never reaches the login */ }
  };
  // ── network and lifecycle: puppeteer's own page events, read locally (no DevTools command); every handler swallows its failure
  const describe = request => { const method = one(request.method(), METHODS), target = traceSurface(request.url()), endpoint = endpointOf(request.url()), type = one(request.resourceType(), TYPES) ?? 'other'; return { method, target, endpoint, type, write: WRITES.includes(method), document: request.isNavigationRequest() && request.frame() === page.mainFrame() }; };
  // The login API's events have their own cap, so other traffic cannot crowd them out (and the reverse).
  const listed = (d, event) => {
    if (d.endpoint === 'login-api') { if (loginEvents >= LOGIN_EVENTS) loginDropped++; else { loginEvents++; emit(event); } return; }
    if (!d.document && !(d.write && phase === 'after')) return; if (networkEvents >= NETWORK_EVENTS) { networkDropped++; return; } networkEvents++; emit(event);
  };
  const failureOf = request => { let text = null; try { text = request.failure()?.errorText; } catch { /* unreadable */ } const hit = typeof text === 'string' ? FAILURES.find(([re]) => re.test(text)) : null; return hit ? hit[1] : 'other'; };
  const handlers = [
    ['request', request => { try {
      const p = net[phase]; p.requests++; const d = describe(request);
      if (d.write) p.writes[hostOf(d.target)].sent++;
      // the browser starting a request to the login API (an attempt, not an answer)
      if (d.endpoint === 'login-api') { p.login[apiMethod(d.method)].sent++; listed(d, { event: 'request', ms: ms(), phase, method: d.method, type: d.type, target: d.target, endpoint: d.endpoint }); }
    } catch { /* unreadable */ } }],
    ['response', response => { try {
      const p = net[phase]; p.responses++;
      const d = describe(response.request()), raw = response.status(), statusClass = classOf(raw);
      if (d.write) p.writes[hostOf(d.target)][statusClass]++;
      if (d.endpoint === 'login-api') p.login[apiMethod(d.method)][statusClass]++;
      listed(d, { event: 'response', ms: ms(), phase, method: d.method, type: d.type, target: d.target, endpoint: d.endpoint, status: STATUSES.includes(raw) ? raw : null, statusClass });
    } catch { /* unreadable */ } }],
    ['requestfailed', request => { try {
      const p = net[phase]; p.failures++;
      const d = describe(request), failure = failureOf(request);
      if (d.write) p.writes[hostOf(d.target)].failed++;
      if (d.endpoint === 'login-api') p.login[apiMethod(d.method)].failed++;
      listed(d, { event: 'failed', ms: ms(), phase, method: d.method, type: d.type, target: d.target, endpoint: d.endpoint, failure });
    } catch { /* unreadable */ } }],
    ['framenavigated', frame => { try { if (frame === page.mainFrame()) emit({ event: 'navigated', ms: ms(), phase, surface: traceSurface(frame.url()) }); } catch { /* unreadable */ } }],
    ['domcontentloaded', () => { emit({ event: 'lifecycle', ms: ms(), phase, kind: 'domcontentloaded' }); }],
    ['load', () => { emit({ event: 'lifecycle', ms: ms(), phase, kind: 'load' }); }],
    ['close', () => { emit({ event: 'lifecycle', ms: ms(), phase, kind: 'close' }); }]
  ];
  const attached = [];
  try { if (typeof page.on === 'function' && typeof page.off === 'function') for (const [name, handler] of handlers) { page.on(name, handler); attached.push([name, handler]); } } catch { /* no page events */ }
  listening = attached.length === handlers.length;
  // ── the isolated world: its own DevTools session; every command bounded, a late session is detached when it arrives
  const isolated = (declaration, args = []) => context === null ? Promise.resolve(null) : within(async () => {
    const r = await session.send('Runtime.callFunctionOn', { functionDeclaration: declaration.toString(), executionContextId: context, arguments: args.map(value => ({ value })), returnByValue: true, awaitPromise: true, silent: true });
    return r?.exceptionDetails ? null : r?.result?.value ?? null;
  });
  const isolate = async () => {
    if (typeof page.createCDPSession !== 'function') return false;
    const pending = Promise.resolve().then(() => page.createCDPSession()), opened = await within(() => pending);
    if (!opened) { pending.then(late => { try { late?.detach?.()?.catch?.(() => {}); } catch { /* gone */ } }, () => {}); return false; }
    session = opened;
    const tree = await within(() => session.send('Page.getFrameTree')), frameId = tree?.frameTree?.frame?.id;
    if (typeof frameId !== 'string') return false;
    const world = await within(() => session.send('Page.createIsolatedWorld', { frameId, worldName: TRACE_WORLD }));
    if (!Number.isSafeInteger(world?.executionContextId)) return false;
    context = world.executionContextId;
    return await isolated(LISTEN, ['#loginSubmit']) === true;
  };
  const readNative = async () => { const n = native(await isolated(NATIVE_READ)); if (n.readable) lastNative = n; return n; };
  const sample = async (call, kind, surface) => {
    samples++;
    const r = await within(() => page.evaluate(SAMPLE, CHALLENGE)), read = !!r && typeof r === 'object';
    emit({ event: 'sample', ms: ms(), phase, call, kind, surface, readable: read, readyState: one(r?.readyState, READY_STATES), visibility: one(r?.visibility, VISIBILITIES), focused: flag(r?.focused),
      fields: flag(r?.fields), userEmpty: flag(r?.userEmpty), passwordEmpty: flag(r?.passwordEmpty), submitEnabled: flag(r?.submitEnabled), submitType: one(r?.submitType, BUTTON_TYPES),
      alerts: count(r?.alerts), invalid: count(r?.invalid, 2), dialogs: count(r?.dialogs), frames: count(r?.frames), busy: count(r?.busy), challenge: flag(r?.challenge), native: await readNative() });
  };
  const end = reason => {
    ending ??= (async () => {
      for (const [name, handler] of attached) { try { page.off(name, handler); } catch { /* gone */ } }
      if (session) { if (context !== null) { await readNative(); await isolated(UNLISTEN); } await within(() => session.detach()); }
      session = null; context = null;
      emit({ event: 'end', ms: ms(), reason, submitted, states: { ...states }, stateErrors: count(stateErrors, 9999), samples, native: lastNative, network: { listening, before: capped(net.before), after: capped(net.after), events: networkEvents, dropped: count(networkDropped, 99999), loginApiEvents: loginEvents, loginApiDropped: count(loginDropped, 99999) }, dropped: count(dropped, 99999) });
    })().catch(() => {});
    return ending;
  };
  const step = async (name, run) => {
    try { const result = await run(); emit({ event: 'step', ms: ms(), step: name, outcome: 'ok' }); return result; }
    catch (error) { emit({ event: 'step', ms: ms(), step: name, outcome: 'error' }); throw error; }
  };
  return {
    async ready() {
      try {
        progress = 'fill';
        const r = await within(() => page.evaluate(READY));
        emit({ event: 'fields', ms: ms(), surface: traceSurface(url()), readyState: one(r?.readyState, READY_STATES), visibility: one(r?.visibility, VISIBILITIES), focused: flag(r?.focused), user: field(r?.user), password: field(r?.password),
          submit: { present: flag(r?.submit?.present), visible: flag(r?.submit?.visible), enabled: flag(r?.submit?.enabled), react: flag(r?.submit?.react), type: one(r?.submit?.type, BUTTON_TYPES), form: flag(r?.submit?.form), sameForm: flag(r?.submit?.sameForm) } });
        emit({ event: 'listen', ms: ms(), native: await isolate().catch(() => false) ? 'installed' : 'unavailable' });
      } catch { /* bounded; the login goes on */ }
    },
    async filled(user, password) {
      try {
        // the browser gets a fresh nonce and the login page's origin and path, never a value or a digest of one; its answer is compared here
        const nonce = randomBytes(32), r = await isolated(FILLED, [nonce.toString('hex'), WWW, LOGIN_PATH]);
        const digests = Array.isArray(r?.digests) ? r.digests : [], match = (f, i, value) => f && typeof f === 'object' ? sameDigest(digests[i], digestOf(nonce, value)) : null;
        emit({ event: 'filled', ms: ms(), user: filledField(r?.user, match(r?.user, 0, user)), password: filledField(r?.password, match(r?.password, 1, password)), focus: one(r?.focus, FOCUS) });
      } catch { /* bounded; the login goes on */ }
      progress = 'click'; phase = 'after';
    },
    async submitted() {
      try { submitted = true; progress = 'submitted'; emit({ event: 'submitted', ms: ms(), native: await readNative() }); } catch { /* bounded */ }
    },
    wrap(ui) {
      return {
        ...ui,
        async open() {
          emit({ event: 'open', ms: ms(), surface: traceSurface(url()) });
          try { await ui.open(); } catch (error) { emit({ event: 'open-end', ms: ms(), outcome: error?.name === 'TimeoutError' ? 'timeout' : 'error', surface: traceSurface(url()) }); throw error; }
          emit({ event: 'open-end', ms: ms(), outcome: 'ok', surface: traceSurface(url()) });
        },
        async state() {
          let result;
          try { result = await ui.state(); } catch (error) { stateErrors++; throw error; }
          if (ending) return result;
          try {
            const kind = one(result?.kind, KINDS) ?? 'other', surface = traceSurface(url());
            states[kind]++;
            if (kind !== lastKind || surface !== lastSurface) { lastKind = kind; lastSurface = surface; emit({ event: 'state', ms: ms(), phase, kind, surface }); }
            if (kind === 'authenticated') await end('authenticated');
            else { const call = ++calls[phase]; if (SAMPLE_AT.includes(call) && (kind === 'unknown' || (kind === 'login' && phase === 'after'))) await sample(call, kind, surface); }
          } catch { /* bounded; the state is returned unchanged */ }
          return result;
        },
        async login(credentials) {
          try { return await ui.login(credentials); }
          catch (error) { const hit = LOGIN_ERRORS.find(([re]) => re.test(String(error?.message))); emit({ event: 'login-error', ms: ms(), progress: progress ?? 'fill', reason: hit ? hit[1] : 'other' }); throw error; }
        },
        choose: channel => step('choose', () => ui.choose(channel)),
        next: () => step('next', () => ui.next()),
        code: value => step('code', () => ui.code(value)),
        async show() { emit({ event: 'show', ms: ms(), phase, surface: traceSurface(url()) }); return ui.show(); },
        stopTrace: () => end('stopped')
      };
    }
  };
}

export async function ensureLogin(page, credentials, status, { account, mailbox, claims, timeoutMs = 300000, ui = loginUi(page), wait = pause, now = Date.now } = {}) {
  const deadline = now() + timeoutMs;
  let submittedLogin = false, requestedAt = null, submittedCode = false, selected = false, manual = false, notified = false;
  const attention = async () => {
    manual = true;
    if (!notified) { await status('verification_required', 'Complete the Amex login or email verification in Chrome'); await ui.show(); notified = true; }
  };
  await ui.open();
  while (now() < deadline) {
    const state = await poll(() => ui.state(), 5000);
    if (state?.kind === 'authenticated') return;
    if (!manual) {
      if (state?.kind === 'login' && !submittedLogin) {
        if (!credentials?.username || !credentials?.password) await attention();
        else { submittedLogin = true; await status('running', 'Signing in to Amex'); await ui.login(credentials); }
      } else if (state?.kind === 'channels' && !requestedAt) {
        // A pre-existing challenge has no trustworthy request timestamp. Leave it to the user.
        if (!submittedLogin || !mailbox || !claims || !account?.otpRecipient || !account?.otpMailbox) await attention();
        else {
          const matches = state.channels.filter(channel => matchesRecipient(channel.text, account.otpRecipient));
          if (matches.length !== 1) await attention();
          else if (!selected) { await ui.choose(matches[0]); selected = true; }
          else if (matches[0].checked && state.channels.filter(channel => channel.checked).length === 1) {
            try { await mailbox.verify(); } catch { await attention(); }
            if (!manual) { await status('running', 'Requesting the Amex account-login email'); requestedAt = now(); await ui.next(); }
          } else await attention();
        }
      } else if (state?.kind === 'code' && !submittedCode) {
        if (!requestedAt || !state.recipients.some(recipient => matchesRecipient(recipient, account.otpRecipient))) await attention();
        else {
          let match;
          try { match = await mailbox.find(account, requestedAt, await claims.read()); } catch { await attention(); }
          if (match && !manual && now() - requestedAt <= 150000) {
            // Re-read the challenge after the mailbox request before consuming or typing anything.
            const current = await ui.state();
            if (current.kind === 'authenticated') return;
            if (current.kind !== 'code' || !current.recipients.some(recipient => matchesRecipient(recipient, account.otpRecipient))) await attention();
            else { await claims.claim(match.id); submittedCode = true; await ui.code(match.code); await ui.next(); }
          } else if (now() - requestedAt > 150000) await attention();
        }
      }
      // No resends, repeated password submissions or guessing at unfamiliar challenges.
      if (now() > deadline - Math.min(240000, timeoutMs / 2) && !requestedAt && !manual) await attention();
      if (requestedAt && now() - requestedAt > 160000 && !manual) await attention();
    }
    await wait(1500);
  }
  await attention();
  throw new Error('Amex login needs attention in Chrome; retry when verification is complete');
}
