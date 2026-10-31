import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

// OMF_TEST_LOGIN_MODULE points at a copy of login.mjs beside the original (the card fixture's fail-first and defect seams).
const here = path.dirname(fileURLToPath(import.meta.url));
const { ensureLogin, LoginClaims, matchesRecipient, loginUi } = await import(pathToFileURL(process.env.OMF_TEST_LOGIN_MODULE ? path.resolve(process.env.OMF_TEST_LOGIN_MODULE) : path.join(here, '..', 'login.mjs')).href);

const account = { primaryCard: '12345', otpRecipient: 'original@example.invalid', otpMailbox: 'forwarded@example.invalid' };
test('masked recipient matching retains domain and visible local-part characters', () => {
  assert.equal(matchesRecipient('o******l@example.invalid', account.otpRecipient), true);
  assert.equal(matchesRecipient('o******x@example.invalid', account.otpRecipient), false);
  assert.equal(matchesRecipient('o******l@elsewhere.invalid', account.otpRecipient), false);
  assert.equal(matchesRecipient('*******@example.invalid', account.otpRecipient), false);
  assert.equal(matchesRecipient('a.+*z@example.invalid', 'a.+realz@example.invalid'), true);
  assert.equal(matchesRecipient('a.+*z@example.invalid', 'axxxz@example.invalid'), false);
});

function flow({ start = 'login', mailboxError = false, noMatch = false, wrongRecipient = false, loginRejected = false, mailDelay = 0 } = {}) {
  let time = 1000000, kind = start, selected = false;
  const events = [], used = [];
  const ui = {
    async open() {},
    async state() {
      if (kind === 'channels') return { kind, channels: [{ id: selected ? 'regenerated-id' : 'original-id', text: wrongRecipient ? 'x******z@example.invalid' : 'o******l@example.invalid', checked: selected }] };
      if (kind === 'code') return { kind, recipients: ['o******l@example.invalid'] };
      return { kind };
    },
    async login() { events.push('login'); if (!loginRejected) kind = 'channels'; },
    async choose() { events.push('choose-email'); selected = true; },
    async next() { events.push(kind === 'channels' ? 'request-code' : 'submit-code'); kind = kind === 'channels' ? 'code' : 'authenticated'; },
    async code() { assert.deepEqual(used, ['synthetic-message']); events.push('type-code'); },
    async show() { events.push('manual'); }
  };
  const mailbox = {
    async verify() { if (mailboxError) throw new Error('Mail unavailable'); },
    async find(_account, since, claims) { assert.equal(events.filter(e => e === 'request-code').length, 1); assert.ok(since <= time); assert.deepEqual(claims, used); time += mailDelay; return noMatch ? null : { id: 'synthetic-message', code: '123456' }; }
  };
  const options = { ui, account, mailbox, claims: { read: async () => used, claim: async id => { used.push(id); events.push('claim'); } }, now: () => time, wait: async ms => { time += ms; }, timeoutMs: 180000 };
  return { events, run: () => ensureLogin(null, { username: 'synthetic', password: 'synthetic' }, async () => {}, options) };
}
test('a fresh login chooses email once, rechecks the regenerated radio and consumes the code before typing', async () => {
  const fixture = flow(); await fixture.run();
  assert.deepEqual(fixture.events, ['login', 'choose-email', 'request-code', 'claim', 'type-code', 'submit-code']);
});
test('authenticated sessions need no credentials or email request', async () => {
  const fixture = flow({ start: 'authenticated' }); await fixture.run(); assert.deepEqual(fixture.events, []);
});
test('unanchored challenges and wrong recipients require manual completion without a code request', async () => {
  for (const options of [{ start: 'code' }, { start: 'channels' }, { wrongRecipient: true }, { mailboxError: true }]) {
    const fixture = flow(options); await assert.rejects(fixture.run(), /needs attention/);
    assert.equal(fixture.events.includes('manual'), true);
    assert.equal(fixture.events.includes('request-code'), false);
    assert.equal(fixture.events.includes('type-code'), false);
  }
});
test('missing or ambiguous email does not cause a resend, and rejected passwords are submitted only once', async () => {
  const mail = flow({ noMatch: true }); await assert.rejects(mail.run());
  assert.equal(mail.events.filter(e => e === 'request-code').length, 1);
  assert.equal(mail.events.includes('type-code'), false);
  const login = flow({ loginRejected: true }); await assert.rejects(login.run());
  assert.equal(login.events.filter(e => e === 'login').length, 1);
});
test('a mailbox response that arrives after the request window is never consumed or typed', async () => {
  const fixture = flow({ mailDelay: 160000 }); await assert.rejects(fixture.run());
  assert.equal(fixture.events.includes('claim'), false);
  assert.equal(fixture.events.includes('type-code'), false);
});
test('consumed message IDs survive restart and cannot be used twice; codes are never persisted', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omf-login-test-'));
  try {
    await new LoginClaims(directory).claim('synthetic-message');
    const restarted = new LoginClaims(directory);
    await assert.rejects(restarted.claim('synthetic-message'), /already used/);
    assert.deepEqual(await restarted.read(), ['synthetic-message']);
    assert.equal(await readFile(path.join(directory, 'used-login-messages.json'), 'utf8'), '["synthetic-message"]');
  } finally {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test cleanup');
    await rm(directory, { recursive: true, force: true });
  }
});

// ═══ The value-free login trace (case omf-amex-login-fix-20261031) ═════════════════════════════════════════════════════════════════
// The REAL loginUi and ensureLogin on a fake Amex page: page.evaluate is answered by the source of the function it is given (state(),
// fill(), click() and the trace's reads), the keyboard types into the focused fake field, the mouse click runs the scenario's submit and
// network, and createCDPSession opens a fake DevTools session whose isolated world counts the clicks and submit events and runs the REAL
// source of the trace's field comparison (inWorld below). Logins, the code and every URL token are fictional; the network objects hand out
// the fictional secrets from every body/header accessor, so a call to one is both recorded and caught by the leak scan.
const WWW = 'https://www.americanexpress.com', LOGIN_URL = WWW + '/ja-jp/account/login?inav=iNavLnkLog', VERIFY_URL = WWW + '/ja-jp/account/reauth/verify';
const HOME_URL = 'https://global.americanexpress.com/dashboard', MASKED = 'o******l@example.invalid';
// The login request of the issuer's public login module (one-identity loginAction: POST /myca/logon/<region>/action/login, region japa
// for ja-JP; PUBLIC-ENDPOINT-EVIDENCE.json of case omf-amex-login-fix-20261031), on the global origin the real page sends its CORS preflight to.
const LOGIN_API = 'https://global.americanexpress.com/myca/logon/japa/action/login';
const SECRET = Object.freeze({ username: 'omfFictionalUserQz7w', password: 'OmfFictional-Pass-Kv9x' }), CODE = '864213';
const SECRET_TEXTS = [SECRET.username, SECRET.password, CODE, ...[SECRET.username, SECRET.password].flatMap(s => [s.slice(0, 6), s.slice(-6), createHash('sha256').update(s).digest('hex').slice(0, 16), Buffer.from(s).toString('base64').slice(0, 12), encodeURIComponent(s)])];
const RAW_TEXTS = ['http', 'americanexpress', 'example.invalid', 'evil', 'beacon', 'logon', 'myca', 'japa', 'token', '?', 'net::', 'ERR_', 'synthetic', 'Target closed', 'Session closed', 'context with', 'destroyed', 'WebCrypto'];
// Every form in which the two logins could leave this process towards the browser: the values and their parts (SECRET_TEXTS without the
// code, which the comparison never has), and SHA-256 of their UTF-8 and UTF-16LE bytes, plain and under every 64-hex nonce the trace sent,
// in hex and base64 and their prefixes.
const NONCES = calls => calls.flatMap(c => (c.params?.arguments || []).map(a => a.value)).filter(v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v));
const SECRET_FORMS = (calls, logins = [SECRET.username, SECRET.password]) => [...SECRET_TEXTS.filter(s => s !== CODE), ...logins.flatMap(s => [null, ...NONCES(calls)].flatMap(nonce => ['utf8', 'utf16le'].map(encoding => createHash('sha256').update(nonce ? Buffer.from(nonce, 'hex') : Buffer.alloc(0)).update(Buffer.from(s, encoding)).digest())).flatMap(d => [d.toString('hex'), d.toString('hex').slice(0, 16), d.toString('base64'), d.toString('base64').slice(0, 12)]))];
const carrying = (calls, forms = SECRET_FORMS(calls)) => calls.filter(c => { const text = JSON.stringify(c.params ?? c); return forms.some(s => text.includes(s)); });
// Runs an isolated-world function's REAL source as Runtime.callFunctionOn would (awaited, returned by value) against a fake document: the
// fields' `values`, the `focused` selector, the document's `href` and its WebCrypto (`subtle`: Node's own unless given; null: none); like a
// real world it has TextEncoder.
async function inWorld(source, args, { values, focused, href, subtle }) {
  const element = selector => ({ get value() { return values[selector]; }, validity: { valid: true }, getAttribute: () => null });
  const nodes = { '#eliloUserID': element('#eliloUserID'), '#eliloPassword': element('#eliloPassword'), '#loginSubmit': {} }, body = {}, at = new URL(href);
  const sandbox = { TextEncoder, document: { body, querySelector: selector => nodes[selector] ?? null, get activeElement() { return nodes[focused] ?? body; } }, location: { href, origin: at.origin, pathname: at.pathname }, ...(subtle === null ? {} : { crypto: { subtle: subtle ?? globalThis.crypto.subtle } }) };
  try { return { result: { value: JSON.parse(JSON.stringify((await vm.runInNewContext('(' + source + ')', sandbox)(...args)) ?? null)) } }; }
  catch (error) { return { exceptionDetails: { text: 'Uncaught', exception: { description: String(error?.message) } } }; }
}
const PROFILE = { primaryCard: '12345', otpRecipient: 'original@example.invalid', otpMailbox: 'forwarded@example.invalid' };
// the refused sign-in: what the page's network did after the click (state-changing requests to every surface class, a GET, an
// unlisted status, a lookalike host and failures whose error texts carry the fictional password)
const REFUSED_NETWORK = [
  { url: WWW + '/omf-synthetic/logon?user=' + SECRET.username, method: 'POST', type: 'xhr', status: 403 },
  { url: 'https://collector.example.invalid/beacon?pw=' + encodeURIComponent(SECRET.password), method: 'POST', type: 'fetch', status: 200 },
  { url: 'https://functions.americanexpress.com/omf-synthetic/session', method: 'POST', type: 'fetch', failure: 'net::ERR_BLOCKED_BY_CLIENT' },
  { url: WWW + '/omf-synthetic/asset.js?token=' + SECRET.password, method: 'GET', type: 'script', status: 200 },
  { url: 'https://global.americanexpress.com/omf-synthetic/state', method: 'PUT', type: 'xhr', status: 599 },
  { url: 'https://www.americanexpress.com.evil.example/omf-synthetic', method: 'POST', type: 'xhr', status: 200 },
  { url: 'https://evil.example/?next=' + WWW, method: 'POST', type: 'xhr', failure: 'net::ERR_FAILED ' + SECRET.password }
];
const HOSTILE = { readyState: SECRET.password, visibility: LOGIN_URL, focused: 'yes', user: { present: SECRET.username, visible: 1, enabled: [true], editable: { v: true }, react: 'true', value: SECRET.username }, password: SECRET.password,
  submit: { present: true, type: 'submit ' + SECRET.password, form: 'form', sameForm: null, extra: LOGIN_URL }, fields: 1e308, userEmpty: 'false', passwordEmpty: SECRET.password, submitEnabled: 0, submitType: LOGIN_URL,
  alerts: -1, invalid: 3.5, dialogs: Number.NaN, frames: 2 ** 60, busy: '9', challenge: [SECRET.password], url: LOGIN_URL, text: SECRET.password };

// `replaced`: at the comparison, the isolated world's context number names another document whose fields hold the same values ('origin':
// another site; 'path': the verification page); `subtle`: that world's WebCrypto (null: none); `alter`: what a field keeps of a typed value.
function fakeLoginPage({ afterSubmit = 'stay', submitFires = true, prevented = true, covered = false, maxPassword = null, react = true, hostile = false, cdp = 'ok', events = 'ok', network = [], closeAfterSubmit = false, replaced = null, subtle = undefined, alter = null } = {}) {
  let url = 'about:blank', surface = 'blank', focused = null, ctrl = false, selectAll = false, pending = null, documentId = 0, selected = false, closed = false, world = null;
  const values = { '#eliloUserID': '', '#eliloPassword': '', '#question-input': '' }, view = { alerts: 0 };
  const calls = [], cdpCalls = [], forbidden = [], listeners = new Map(), sessions = [], frame = { url: () => url }, returned = [], foreign = [];
  const emit = (name, payload) => { for (const handler of [...(listeners.get(name) || [])]) handler(payload); };
  const request = (target, { method = 'GET', type = 'xhr', navigation = false, failure = null } = {}) => ({
    url: () => target, method: () => method, resourceType: () => type, isNavigationRequest: () => navigation, frame: () => frame,
    failure: () => failure === null ? null : { errorText: failure },
    postData() { forbidden.push('postData'); return 'user=' + SECRET.username; }, hasPostData() { forbidden.push('hasPostData'); return true; },
    async fetchPostData() { forbidden.push('fetchPostData'); return SECRET.password; }, headers() { forbidden.push('request.headers'); return { cookie: SECRET.password }; }
  });
  const answer = (req, status) => ({ request: () => req, status: () => status, url: () => req.url(), ok: () => status < 400,
    headers() { forbidden.push('response.headers'); return { 'set-cookie': SECRET.password }; }, async text() { forbidden.push('text'); return SECRET.password; },
    async json() { forbidden.push('json'); return { token: SECRET.password }; }, async buffer() { forbidden.push('buffer'); return Buffer.from(SECRET.password); } });
  const exchange = ({ url: target, method, type, status, failure, navigation }) => {
    const req = request(target, { method, type, navigation, failure: failure ?? null }); emit('request', req);
    if (failure) emit('requestfailed', req); else emit('response', answer(req, status));
  };
  const navigate = (target, kind) => {
    exchange({ url: target, method: 'GET', type: 'document', status: 200, navigation: true });
    url = target; surface = kind; documentId++; focused = null; emit('framenavigated', frame); emit('domcontentloaded'); emit('load');
  };
  const gone = () => { if (closed) throw new Error('Protocol error: Target closed.'); };
  const fieldOf = selector => ({ present: true, visible: true, enabled: true, editable: true, react, value: values[selector] });
  const ready = () => ({ readyState: 'complete', visibility: 'visible', focused: true, user: { ...fieldOf('#eliloUserID'), value: undefined }, password: { ...fieldOf('#eliloPassword'), value: undefined },
    submit: { present: true, visible: true, enabled: true, react, type: 'submit', form: true, sameForm: true } });
  const sampled = () => ({ readyState: 'complete', visibility: 'visible', focused: true, fields: surface === 'login', userEmpty: values['#eliloUserID'] === '', passwordEmpty: values['#eliloPassword'] === '',
    submitEnabled: true, submitType: 'submit', alerts: view.alerts, invalid: 0, dialogs: 0, frames: 0, busy: 0, challenge: false });
  const submit = () => {
    if (world?.installed && world.documentId === documentId) { const n = world.n; n.clicks++; n.trusted++; if (!covered) n.buttonClicks++; if (!covered && submitFires) { n.submits++; n.bubbled++; if (prevented) n.prevented++; } }
    if (covered || !submitFires) return;
    for (const item of network) exchange(item);
    if (closeAfterSubmit) { closed = true; emit('close'); return; }
    if (afterSubmit === 'stay') { view.alerts = 1; values['#eliloPassword'] = ''; }
    else if (afterSubmit === 'verify') navigate(VERIFY_URL, 'channels');
    else if (afterSubmit === 'home') navigate(HOME_URL, 'home');
  };
  const page = {
    url: () => url, mainFrame: () => frame,
    async goto(target) { gone(); calls.push(['goto']); navigate(target, new URL(target).pathname === '/ja-jp/account/login' ? 'login' : 'other'); },
    async evaluate(fn, arg) {
      gone();
      const src = String(fn);
      if (src.includes('alertdialog')) { calls.push(['evaluate', 'trace-sample']); if (hostile) throw new Error('synthetic hostile page ' + SECRET.password + ' ' + LOGIN_URL); return sampled(); }
      if (src.includes('__react')) { calls.push(['evaluate', 'trace-ready']); return hostile ? HOSTILE : ready(); }
      if (src.includes('a[href*="/activity/statement"]')) { calls.push(['evaluate', 'state-authenticated']); return surface === 'home'; }
      if (src.includes("'#loginSubmit'") && src.includes("'#eliloPassword'")) { calls.push(['evaluate', 'state-login']); return surface === 'login'; }
      if (src.includes("'#question-input'") && src.includes('channels')) {
        calls.push(['evaluate', 'state-verify']);
        if (surface === 'channels') return { kind: 'channels', channels: [{ id: selected ? 'regenerated-id' : 'original-id', text: MASKED, checked: selected }] };
        return surface === 'code' ? { kind: 'code', recipients: [MASKED] } : { kind: 'unknown' };
      }
      if (src.includes('input.focus()')) { calls.push(['evaluate', 'fill', arg.selector]); if (!(arg.selector in values) || (surface !== 'login' && arg.selector !== '#question-input')) throw new Error(arg.label + ' input unavailable'); focused = arg.selector; return undefined; }
      if (src.includes('elementFromPoint')) { calls.push(['evaluate', 'click', arg.selector, arg.text]); pending = { selector: arg.selector, text: arg.text }; return { x: 640, y: 450 }; }
      throw new Error('fake login page: unrecognised evaluate');
    },
    keyboard: {
      async down(key) { calls.push(['key-down', key]); if (key === 'Control') ctrl = true; },
      async up(key) { calls.push(['key-up', key]); if (key === 'Control') ctrl = false; },
      async press(key) { calls.push(['key-press', key]); if (ctrl && key === 'A') selectAll = true; },
      async type(value) {
        gone(); calls.push(['type', focused]);
        let next = selectAll ? value : values[focused] + value; selectAll = false;
        if (focused === '#eliloPassword' && maxPassword) next = next.slice(0, maxPassword);
        if (alter?.[focused]) next = alter[focused](next);
        values[focused] = next;
      }
    },
    mouse: {
      async click() {
        gone(); const target = pending; pending = null; calls.push(['mouse-click', target?.selector, target?.text ?? null]);
        if (target?.selector === '#loginSubmit') return submit();
        if (String(target?.selector).startsWith('label[for=') && surface === 'channels') { selected = true; return; }
        if (target?.selector === 'button' && surface === 'channels') { surface = 'code'; return; }
        if (target?.selector === 'button' && surface === 'code') return navigate(HOME_URL, 'home');
        throw new Error('fake login page: unhandled click');
      }
    },
    async bringToFront() { calls.push(['bringToFront']); },
    on(name, handler) { if (events === 'throw') throw new Error('synthetic: no page events ' + SECRET.password); calls.push(['on', name]); if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(handler); },
    off(name, handler) { calls.push(['off', name]); listeners.get(name)?.delete(handler); },
    async createCDPSession() {
      calls.push(['session']);
      if (cdp === 'throw') throw new Error('synthetic: no DevTools session ' + SECRET.password);
      if (cdp === 'hang') return new Promise(() => {});
      const session = { detached: 0,
        async send(method, params = {}) {
          cdpCalls.push({ method, params: JSON.parse(JSON.stringify(params)) });
          if (closed) throw new Error('Protocol error (Runtime.callFunctionOn): Session closed. Most likely the page has been closed.');
          if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'synthetic-main-frame', url } } };
          if (method === 'Page.createIsolatedWorld') { world = { contextId: 31, documentId, installed: false, n: null }; return { executionContextId: 31 }; }
          if (method !== 'Runtime.callFunctionOn') return {};
          if (!world || params.executionContextId !== world.contextId || world.documentId !== documentId) throw new Error('Cannot find context with specified id');
          const src = params.functionDeclaration, args = (params.arguments || []).map(a => a.value);
          if (src.includes('addEventListener')) { world.installed = true; world.n = { clicks: 0, trusted: 0, buttonClicks: 0, submits: 0, prevented: 0, bubbled: 0, invalid: 0 }; return { result: { value: true } }; }
          // a hostile isolated world: answers of the wrong types carrying the fictional values, and an exception carrying them
          if (cdp === 'hostile') return src.includes('activeElement') ? { result: { value: { user: { matches: 'yes', value: SECRET.username }, password: SECRET.password, focus: LOGIN_URL, digests: [SECRET.username, SECRET.password] } } }
            : src.includes('t.remove()') ? { exceptionDetails: { text: SECRET.password, exception: { description: LOGIN_URL } } }
            : { result: { value: { readable: true, clicks: SECRET.password, trusted: -4, buttonClicks: 2 ** 60, submits: 1.5, prevented: '1', bubbled: null, invalid: [], url: LOGIN_URL } } };
          if (src.includes('activeElement')) {
            // the trace's field comparison, its real source: on this login page, or (`replaced`) in the other document the context number names
            if (replaced) foreign.push(args);
            if (cdp === 'destroyed') throw new Error('Protocol error (Runtime.callFunctionOn): Execution context was destroyed. ' + SECRET.password);
            if (cdp === 'malformed') return { result: { value: { user: { empty: false, valid: true, ariaInvalid: false }, password: { empty: false, valid: true, ariaInvalid: false }, focus: 'password', digests: ['F'.repeat(64), SECRET.password] } } };
            const answer = await inWorld(src, args, { values: { ...values }, focused, href: replaced === 'origin' ? 'https://www.americanexpress.com.evil.example/ja-jp/account/login' : replaced === 'path' ? VERIFY_URL : url, subtle });
            for (const digest of [answer.result?.value?.digests].flat()) if (typeof digest === 'string') returned.push(digest);
            return answer;
          }
          if (src.includes('t.remove()')) { const was = !!world.installed; world.installed = false; return { result: { value: was } }; }
          if (src.includes('readable: true')) return { result: { value: world.installed ? { readable: true, ...world.n } : { readable: false } } };
          return { exceptionDetails: { text: 'unknown function' } };
        },
        async detach() { session.detached++; }
      };
      sessions.push(session); return session;
    }
  };
  return { page, calls, cdpCalls, forbidden, sessions, listeners: () => [...listeners.values()].reduce((n, set) => n + set.size, 0), world: () => world, values, emit, exchange, returned, foreign, close() { closed = true; } };
}
// One sign-in through the REAL ensureLogin on a virtual clock: the default 300 s window, the 150 s attention, 1.5 s between reads.
// `mailbox` may be a function of the virtual clock ({ advance }) so a mail can arrive late; `profile` replaces the account's recipients.
async function signIn(fake, { trace = undefined, credentials = SECRET, mailbox = null, claims = null, profile = PROFILE } = {}) {
  let time = 1_800_000_000_000; const statuses = [], sunk = [], clock = { advance: ms => { time += ms; } };
  const sink = trace === undefined ? event => { sunk.push(event); } : trace;
  const ui = sink === null ? loginUi(fake.page) : loginUi(fake.page, { trace: sink });
  const outcome = await ensureLogin(fake.page, credentials, async (state, text) => { statuses.push([state, text]); }, { account: profile, mailbox: typeof mailbox === 'function' ? mailbox(clock) : mailbox, claims, ui, now: () => time, wait: async ms => { time += ms; } }).then(() => 'authenticated', error => error);
  return { ui, outcome, statuses, events: sunk };
}
// The auth-relevant page actions in order (navigation, typing targets, key strokes, the resolved click points and every state read):
// everything but the trace's own reads, events and DevTools session.
const actions = calls => calls.filter(c => !['on', 'off', 'session'].includes(c[0]) && !(c[0] === 'evaluate' && String(c[1]).startsWith('trace-'))).map(c => c.join(':'));
const traceCalls = calls => calls.filter(c => ['on', 'off', 'session'].includes(c[0]) || (c[0] === 'evaluate' && String(c[1]).startsWith('trace-')));

// The closed schema: every event is exactly one of these shapes (no other key, no other value), deeply frozen.
const isMs = v => Number.isSafeInteger(v) && v >= 0 && v <= 86400000, isBool = v => v === null || typeof v === 'boolean', isFlag = v => typeof v === 'boolean';
const upTo = max => v => v === null || (Number.isSafeInteger(v) && v >= 0 && v <= max), oneOf = list => v => v === null || list.includes(v);
const nullable = shape => Object.assign(Object.create(null), { nullable: shape });
const SURFACE = oneOf(['blank', 'login', 'verify', 'www', 'global', 'amex', 'other']), PHASE = oneOf(['before', 'after']);
const FIELD = { present: isBool, visible: isBool, enabled: isBool, editable: isBool, react: isBool }, VALUE = { matches: isBool, empty: isBool, valid: isBool, ariaInvalid: isBool };
const NATIVE = { readable: isFlag, clicks: upTo(999), trusted: upTo(999), buttonClicks: upTo(999), submits: upTo(999), prevented: upTo(999), bubbled: upTo(999), invalid: upTo(999) };
const CELL = Object.fromEntries(['sent', '2xx', '3xx', '4xx', '5xx', 'other', 'failed'].map(k => [k, upTo(99999)]));
const COUNTS = { requests: upTo(99999), responses: upTo(99999), failures: upTo(99999), writes: { www: CELL, global: CELL, amex: CELL, other: CELL }, login: { options: CELL, post: CELL, other: CELL } };
const METHOD = oneOf(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'other']), TYPE = oneOf(['document', 'xhr', 'fetch', 'preflight', 'other']);
const ENDPOINT = v => v === 'login-api' || v === 'other';
const STATUS = oneOf([200, 201, 202, 204, 206, 301, 302, 303, 304, 307, 308, 400, 401, 403, 404, 405, 406, 408, 409, 410, 412, 413, 415, 422, 423, 428, 429, 431, 451, 500, 501, 502, 503, 504]);
const KIND = oneOf(['authenticated', 'login', 'channels', 'code', 'unknown', 'other']), READY_STATE = oneOf(['loading', 'interactive', 'complete', 'other']), VISIBILITY = oneOf(['visible', 'hidden', 'other']), BUTTON = oneOf(['submit', 'button', 'reset', 'other']);
const SCHEMA = {
  open: { ms: isMs, surface: SURFACE }, 'open-end': { ms: isMs, outcome: oneOf(['ok', 'timeout', 'error']), surface: SURFACE },
  state: { ms: isMs, phase: PHASE, kind: KIND, surface: SURFACE },
  fields: { ms: isMs, surface: SURFACE, readyState: READY_STATE, visibility: VISIBILITY, focused: isBool, user: FIELD, password: FIELD, submit: { present: isBool, visible: isBool, enabled: isBool, react: isBool, type: BUTTON, form: isBool, sameForm: isBool } },
  listen: { ms: isMs, native: oneOf(['installed', 'unavailable']) }, filled: { ms: isMs, user: VALUE, password: VALUE, focus: oneOf(['body', 'user', 'password', 'submit', 'other']) },
  submitted: { ms: isMs, native: NATIVE }, 'login-error': { ms: isMs, progress: oneOf(['fill', 'click', 'submitted']), reason: oneOf(['input-unavailable', 'surface', 'not-unique', 'covered', 'other']) },
  sample: { ms: isMs, phase: PHASE, call: upTo(128), kind: KIND, surface: SURFACE, readable: isFlag, readyState: READY_STATE, visibility: VISIBILITY, focused: isBool, fields: isBool, userEmpty: isBool, passwordEmpty: isBool, submitEnabled: isBool, submitType: BUTTON,
    alerts: upTo(99), invalid: upTo(2), dialogs: upTo(99), frames: upTo(99), busy: upTo(99), challenge: isBool, native: NATIVE },
  request: { ms: isMs, phase: PHASE, method: METHOD, type: TYPE, target: SURFACE, endpoint: v => v === 'login-api' },
  response: { ms: isMs, phase: PHASE, method: METHOD, type: TYPE, target: SURFACE, endpoint: ENDPOINT, status: STATUS, statusClass: oneOf(['2xx', '3xx', '4xx', '5xx', 'other']) },
  failed: { ms: isMs, phase: PHASE, method: METHOD, type: TYPE, target: SURFACE, endpoint: ENDPOINT, failure: oneOf(['aborted', 'blocked', 'timeout', 'connection', 'dns', 'offline', 'tls', 'redirects', 'failed', 'other']) },
  navigated: { ms: isMs, phase: PHASE, surface: SURFACE }, lifecycle: { ms: isMs, phase: PHASE, kind: oneOf(['domcontentloaded', 'load', 'close']) },
  step: { ms: isMs, step: oneOf(['choose', 'next', 'code']), outcome: oneOf(['ok', 'error']) }, show: { ms: isMs, phase: PHASE, surface: SURFACE },
  end: { ms: isMs, reason: oneOf(['authenticated', 'stopped']), submitted: isFlag, states: Object.fromEntries(['authenticated', 'login', 'channels', 'code', 'unknown', 'other'].map(k => [k, v => Number.isSafeInteger(v) && v >= 0])),
    stateErrors: upTo(9999), samples: upTo(16), native: nullable(NATIVE), network: { listening: isFlag, before: COUNTS, after: COUNTS, events: upTo(60), dropped: upTo(99999), loginApiEvents: upTo(40), loginApiDropped: upTo(99999) }, dropped: upTo(99999) }
};
const ZERO = Object.freeze({ sent: 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0, failed: 0 });
function conforms(value, shape, where) {
  if (typeof shape === 'function') { assert.ok(shape(value), 'login-trace:schema value ' + where + ' = ' + JSON.stringify(value)); return; }
  if (shape.nullable) { if (value !== null) conforms(value, shape.nullable, where); return; }
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'login-trace:schema object ' + where);
  assert.ok(Object.isFrozen(value), 'login-trace:frozen ' + where);
  assert.deepEqual(Object.keys(value).sort(), Object.keys(shape).sort(), 'login-trace:schema keys ' + where);
  for (const key of Object.keys(shape)) conforms(value[key], shape[key], where + '.' + key);
}
function assertClosed(events, label) {
  assert.ok(events.length > 0, 'login-trace:events ' + label);
  for (const [i, e] of events.entries()) {
    assert.ok(Object.isFrozen(e) && SCHEMA[e.event], 'login-trace:schema event ' + label + ' #' + i + ' ' + JSON.stringify(e));
    const { event: _name, ...rest } = e; conforms(Object.freeze(rest), SCHEMA[e.event], label + ' ' + e.event + '#' + i);
  }
  const text = JSON.stringify(events);
  for (const secret of [...SECRET_TEXTS, ...RAW_TEXTS]) assert.ok(!text.includes(secret), 'login-trace:no-leak ' + label + ' contains ' + JSON.stringify(secret));
}
const named = (events, name) => events.filter(e => e.event === name);

test('login trace (default unchanged): without a trace the ui is the same object shape, attaches nothing, opens no session and the sign-in sends the same page actions', async () => {
  for (const option of [undefined, { trace: 'not a function' }, { trace: null }, { reveal: null }]) {
    const fake = fakeLoginPage(), ui = option === undefined ? loginUi(fake.page) : loginUi(fake.page, option);
    assert.deepEqual(Object.keys(ui), ['state', 'open', 'login', 'choose', 'next', 'code', 'show'], 'login-trace:default-shape ' + JSON.stringify(option));
  }
  const plain = fakeLoginPage({ network: REFUSED_NETWORK }), traced = fakeLoginPage({ network: REFUSED_NETWORK });
  const a = await signIn(plain, { trace: null }), b = await signIn(traced);
  assert.deepEqual(traceCalls(plain.calls), [], 'login-trace:default-no-trace-calls');
  assert.deepEqual([plain.cdpCalls, plain.sessions.length, plain.listeners()], [[], 0, 0], 'login-trace:default-no-session');
  assert.deepEqual(actions(traced.calls), actions(plain.calls), 'login-trace:same-page-actions');
  assert.deepEqual([b.statuses, String(b.outcome?.message)], [a.statuses, String(a.outcome?.message)], 'login-trace:same-statuses-and-outcome');
  assert.equal(plain.calls.filter(c => c[0] === 'mouse-click' && c[1] === '#loginSubmit').length, 1, 'login-trace:one-password-submit');
  assert.ok(traceCalls(traced.calls).length > 0, 'login-trace:traced-run-observed');
  await b.ui.stopTrace?.();
});

test('login trace (refused sign-in): fields ready, both values matched before the click, one trusted click and one prevented submit, every state-changing response classified, samples show the emptied password and an alert; nothing leaks', async () => {
  const fake = fakeLoginPage({ network: REFUSED_NETWORK });
  const { ui, outcome, statuses, events } = await signIn(fake);
  assert.match(String(outcome?.message), /needs attention/, 'unchanged ending: the person is needed');
  assert.deepEqual(statuses.map(s => s[0]), ['running', 'verification_required'], 'one sign-in, then the person');
  await ui.stopTrace?.();
  assertClosed(events, 'refused');
  const [fields] = named(events, 'fields'), [filled] = named(events, 'filled'), [submitted] = named(events, 'submitted'), [end] = named(events, 'end');
  assert.deepEqual([fields?.user, fields?.password, fields?.submit, fields?.readyState, fields?.surface], [{ present: true, visible: true, enabled: true, editable: true, react: true }, { present: true, visible: true, enabled: true, editable: true, react: true }, { present: true, visible: true, enabled: true, react: true, type: 'submit', form: true, sameForm: true }, 'complete', 'login'], 'login-trace:fields-ready ' + JSON.stringify(fields));
  assert.deepEqual(named(events, 'listen').map(e => e.native), ['installed'], 'login-trace:native-listeners-installed');
  assert.deepEqual([filled?.user, filled?.password, filled?.focus], [{ matches: true, empty: false, valid: true, ariaInvalid: false }, { matches: true, empty: false, valid: true, ariaInvalid: false }, 'password'], 'login-trace:filled-observed ' + JSON.stringify(filled));
  assert.deepEqual(submitted?.native, { readable: true, clicks: 1, trusted: 1, buttonClicks: 1, submits: 1, prevented: 1, bubbled: 1, invalid: 0 }, 'login-trace:native-submit-observed ' + JSON.stringify(submitted));
  const after = events.filter(e => (e.event === 'response' || e.event === 'failed') && e.phase === 'after').map(({ ms: _ms, ...e }) => e);
  assert.deepEqual(after, [
    { event: 'response', phase: 'after', method: 'POST', type: 'xhr', target: 'www', endpoint: 'other', status: 403, statusClass: '4xx' },
    { event: 'response', phase: 'after', method: 'POST', type: 'fetch', target: 'other', endpoint: 'other', status: 200, statusClass: '2xx' },
    { event: 'failed', phase: 'after', method: 'POST', type: 'fetch', target: 'amex', endpoint: 'other', failure: 'blocked' },
    { event: 'response', phase: 'after', method: 'PUT', type: 'xhr', target: 'global', endpoint: 'other', status: null, statusClass: '5xx' },
    { event: 'response', phase: 'after', method: 'POST', type: 'xhr', target: 'other', endpoint: 'other', status: 200, statusClass: '2xx' },
    { event: 'failed', phase: 'after', method: 'POST', type: 'xhr', target: 'other', endpoint: 'other', failure: 'other' }
  ], 'login-trace:response-categories ' + JSON.stringify(after));
  assert.deepEqual(events.filter(e => e.event === 'response' && e.phase === 'before').map(e => [e.method, e.type, e.target, e.status]), [['GET', 'document', 'login', 200]], 'login-trace:document-response');
  const samples = named(events, 'sample');
  assert.deepEqual(samples.map(s => s.call), [1, 2, 4, 8, 16, 32, 64, 128], 'login-trace:bounded-samples-after-submit');
  assert.ok(samples.every(s => s.readable && s.kind === 'login' && s.fields === true && s.passwordEmpty === true && s.userEmpty === false && s.alerts === 1 && s.challenge === false && s.native.submits === 1), 'login-trace:error-flags ' + JSON.stringify(samples[0]));
  assert.deepEqual(named(events, 'show').map(e => [e.phase, e.surface]), [['after', 'login']], 'login-trace:attention-recorded');
  assert.deepEqual([end?.reason, end?.submitted, end?.samples, end?.network?.listening], ['stopped', true, 8, true], 'login-trace:end ' + JSON.stringify(end));
  assert.deepEqual(end?.network?.after?.writes, { www: { sent: 1, '2xx': 0, '3xx': 0, '4xx': 1, '5xx': 0, other: 0, failed: 0 }, global: { sent: 1, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 1, other: 0, failed: 0 }, amex: { sent: 1, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0, failed: 1 }, other: { sent: 3, '2xx': 2, '3xx': 0, '4xx': 0, '5xx': 0, other: 0, failed: 1 } }, 'login-trace:write-counts-with-zeros');
  assert.deepEqual([end?.network?.after?.requests, end?.network?.after?.responses, end?.network?.after?.failures], [7, 5, 2], 'login-trace:after-totals');
  // the synthetic /logon 403 is not the issuer's login API: nothing is counted or listed as one
  assert.deepEqual([end?.network?.before?.login, end?.network?.after?.login, end?.network?.loginApiEvents, end?.network?.loginApiDropped], [{ options: ZERO, post: ZERO, other: ZERO }, { options: ZERO, post: ZERO, other: ZERO }, 0, 0], 'login-trace:no-login-api ' + JSON.stringify(end?.network?.after?.login));
  assert.equal(events.at(-1)?.event, 'end', 'login-trace:end-last');
  assert.deepEqual(fake.forbidden, [], 'login-trace:no-body-or-header-read');
});

test('login trace (zero values): a click that reaches the button but no submit, and a click that lands on a covering element, are recorded as observed zeros, not as missing', async () => {
  const silent = fakeLoginPage({ submitFires: false, network: REFUSED_NETWORK }), s = await signIn(silent); await s.ui.stopTrace?.();
  assertClosed(s.events, 'no-submit');
  assert.deepEqual(named(s.events, 'submitted')[0]?.native, { readable: true, clicks: 1, trusted: 1, buttonClicks: 1, submits: 0, prevented: 0, bubbled: 0, invalid: 0 }, 'login-trace:no-submit-is-zero');
  const end = named(s.events, 'end')[0];
  assert.deepEqual([end?.network?.after?.requests, end?.network?.after?.writes?.www], [0, { sent: 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0, failed: 0 }], 'login-trace:no-request-is-zero');
  const covered = fakeLoginPage({ covered: true }), c = await signIn(covered); await c.ui.stopTrace?.();
  assert.deepEqual(named(c.events, 'submitted')[0]?.native, { readable: true, clicks: 1, trusted: 1, buttonClicks: 0, submits: 0, prevented: 0, bubbled: 0, invalid: 0 }, 'login-trace:click-elsewhere');
  const plain = fakeLoginPage({ submitFires: false, network: REFUSED_NETWORK }); await signIn(plain, { trace: null });
  assert.deepEqual(actions(silent.calls), actions(plain.calls), 'login-trace:same-page-actions-no-submit');
});

test('login trace (fill mismatch): a field that does not hold the intended value is reported false before the click, and the sign-in is still submitted exactly once, as without the trace', async () => {
  const fake = fakeLoginPage({ maxPassword: 7 }), r = await signIn(fake); await r.ui.stopTrace?.();
  assertClosed(r.events, 'mismatch');
  const [filled] = named(r.events, 'filled');
  assert.deepEqual([filled?.user?.matches, filled?.password?.matches, filled?.password?.empty], [true, false, false], 'login-trace:mismatch-observed ' + JSON.stringify(filled));
  const plain = fakeLoginPage({ maxPassword: 7 }); await signIn(plain, { trace: null });
  assert.deepEqual(actions(fake.calls), actions(plain.calls), 'login-trace:mismatch-not-gated');
  assert.equal(fake.calls.filter(c => c[0] === 'mouse-click' && c[1] === '#loginSubmit').length, 1, 'login-trace:one-password-submit');
  const notReact = fakeLoginPage({ react: false }), n = await signIn(notReact); await n.ui.stopTrace?.();
  assert.deepEqual([named(n.events, 'fields')[0]?.user?.react, named(n.events, 'fields')[0]?.submit?.react], [false, false], 'login-trace:react-detached-observed');
});

test('login trace (email code and success): choose, next, code and next are recorded without values, the trace ends itself at authentication with every listener removed, and the code and claim go exactly as without the trace', async () => {
  const run = async trace => {
    const used = [], fake = fakeLoginPage({ afterSubmit: 'verify' });
    const mailbox = { async verify() {}, async find() { return { id: 'synthetic-message', code: CODE }; } }, claims = { read: async () => used.slice(), claim: async id => { used.push(id); } };
    const r = await signIn(fake, { trace, mailbox, claims });
    return { ...r, fake, used, listenersAtReturn: fake.listeners() };
  };
  const traced = await run(undefined), plain = await run(null);
  assert.deepEqual([traced.outcome, plain.outcome], ['authenticated', 'authenticated']);
  assert.deepEqual([traced.used, actions(traced.fake.calls)], [plain.used, actions(plain.fake.calls)], 'login-trace:otp-unchanged');
  assertClosed(traced.events, 'success');
  assert.deepEqual(named(traced.events, 'step').map(e => e.step + ':' + e.outcome), ['choose:ok', 'next:ok', 'code:ok', 'next:ok'], 'login-trace:steps');
  assert.deepEqual(named(traced.events, 'state').map(e => e.kind + '@' + e.surface), ['login@login', 'channels@verify', 'code@verify', 'authenticated@global'], 'login-trace:state-transitions');
  const end = named(traced.events, 'end');
  assert.deepEqual([end.length, end[0]?.reason, traced.events.at(-1)?.event], [1, 'authenticated', 'end'], 'login-trace:ends-at-authentication');
  assert.equal(traced.listenersAtReturn, 0, 'login-trace:listeners-removed-at-authentication');
  assert.deepEqual([traced.fake.sessions.length, traced.fake.sessions[0]?.detached], [1, 1], 'login-trace:session-detached');
  const before = traced.events.length; traced.fake.exchange({ url: HOME_URL, method: 'POST', type: 'xhr', status: 200 }); await traced.ui.stopTrace?.();
  assert.equal(traced.events.length, before, 'login-trace:nothing-after-end');
});

test('login trace (code rules unchanged): with the trace, a wrong masked recipient, a failing mailbox and a mail that arrives after the request window end exactly as without it — the person is asked, nothing is claimed or typed, no second request', async () => {
  for (const [label, scenario] of [['wrong-recipient', { profile: { ...PROFILE, otpRecipient: 'someone@example.invalid' } }], ['mailbox-error', { failVerify: true }], ['late-mail', { late: true }]]) {
    const run = async trace => {
      const used = [], fake = fakeLoginPage({ afterSubmit: 'verify' });
      const mailbox = clock => ({ async verify() { if (scenario.failVerify) throw new Error('synthetic mailbox failure ' + SECRET.password); }, async find() { if (scenario.late) clock.advance(160000); return { id: 'synthetic-message', code: CODE }; } });
      const claims = { read: async () => used.slice(), claim: async id => { used.push(id); } };
      const r = await signIn(fake, { trace, mailbox, claims, profile: scenario.profile });
      await r.ui.stopTrace?.();
      return { ...r, fake, used };
    };
    const traced = await run(undefined), plain = await run(null);
    assert.deepEqual([actions(traced.fake.calls), traced.statuses, traced.used, String(traced.outcome?.message)], [actions(plain.fake.calls), plain.statuses, plain.used, String(plain.outcome?.message)], 'login-trace:code-rules-unchanged ' + label);
    assert.ok(/needs attention/.test(String(traced.outcome?.message)) && traced.used.length === 0 && !traced.fake.calls.some(c => c[0] === 'type' && c[1] === '#question-input'), 'login-trace:code-rules-person-asked ' + label);
    assert.ok(traced.fake.calls.filter(c => c[0] === 'mouse-click' && c[1] === 'button').length <= 1, 'login-trace:code-rules-one-request ' + label);
    assertClosed(traced.events, 'code-' + label);
  }
});

test('login trace (no retention): the two values are read once, for the comparison in this process, and never again; no DevTools call, page read or event carries them or a digest of them', async () => {
  let reads = 0; const credentials = { get username() { reads++; return SECRET.username; }, get password() { reads++; return SECRET.password; } };
  const fake = fakeLoginPage({ network: REFUSED_NETWORK }), sunk = [];
  const ui = loginUi(fake.page, { trace: event => { sunk.push(event); } });
  await ui.open(); assert.equal((await ui.state()).kind, 'login');
  await ui.login(credentials);
  const afterLogin = reads;
  for (let i = 0; i < 8; i++) await ui.state();
  await ui.stopTrace?.();
  assert.equal(reads, afterLogin, 'login-trace:no-credential-read-after-login');
  assert.equal(afterLogin, 4, 'login-trace:two-reads-each (typing and the comparison)');
  // the comparison stays in this process: no DevTools call carries a login, a part of one or a digest of one (plain or under the nonce the
  // call sent); the page's own transient digests come back once and enter no event
  assert.deepEqual(carrying(fake.cdpCalls).map(c => c.method + ' ' + String(c.params?.functionDeclaration).slice(0, 40)), [], 'login-trace:no-secret-to-browser');
  assert.ok(fake.returned.length === 2 && fake.returned.every(d => /^[0-9a-f]{64}$/.test(d)), 'login-trace:page-digests-returned ' + fake.returned.length);
  const sunkText = JSON.stringify(sunk);
  assert.deepEqual(fake.returned.filter(d => sunkText.includes(d.slice(0, 16)) || sunkText.includes(Buffer.from(d, 'hex').toString('base64').slice(0, 12))), [], 'login-trace:no-digest-leak');
  assert.ok(fake.cdpCalls.every(c => ['Page.getFrameTree', 'Page.createIsolatedWorld', 'Runtime.callFunctionOn'].includes(c.method)), 'login-trace:session-commands ' + JSON.stringify(fake.cdpCalls.map(c => c.method)));
  assertClosed(sunk, 'retention');
});

test('login trace (best effort): a failing or hanging DevTools session, refused page events, a hostile page, a hostile isolated world and a throwing or rejecting sink change nothing in the sign-in', { timeout: 60000 }, async () => {
  const reference = fakeLoginPage({ network: REFUSED_NETWORK }), base = await signIn(reference, { trace: null });
  const rejections = []; const onRejection = reason => { rejections.push(reason); }; process.on('unhandledRejection', onRejection);
  try {
    for (const [label, options, sink] of [
      ['session-throws', { cdp: 'throw' }], ['session-hangs', { cdp: 'hang' }], ['events-refused', { events: 'throw' }], ['hostile-page', { hostile: true }], ['hostile-world', { cdp: 'hostile' }],
      ['sink-throws', {}, () => { throw new Error('synthetic sink failure ' + SECRET.password); }], ['sink-rejects', {}, async () => { throw new Error('synthetic sink rejection ' + SECRET.password); }]
    ]) {
      const fake = fakeLoginPage({ network: REFUSED_NETWORK, ...options }), sunk = [];
      const r = await signIn(fake, { trace: sink ?? (event => { sunk.push(event); }) });
      await r.ui.stopTrace?.();
      assert.deepEqual([actions(fake.calls), r.statuses, String(r.outcome?.message)], [actions(reference.calls), base.statuses, String(base.outcome?.message)], 'login-trace:best-effort ' + label);
      if (sunk.length) assertClosed(sunk, label);
      if (label === 'session-throws' || label === 'session-hangs') assert.deepEqual(named(sunk, 'listen').map(e => e.native), ['unavailable'], 'login-trace:listen-unavailable ' + label);
      if (label === 'events-refused') assert.equal(named(sunk, 'end')[0]?.network?.listening, false, 'login-trace:events-unavailable');
      if (label === 'hostile-page') assert.deepEqual([named(sunk, 'fields')[0]?.readyState, named(sunk, 'fields')[0]?.user?.present, named(sunk, 'sample')[0]?.readable], ['other', null, false], 'login-trace:hostile-sanitized');
      if (label === 'hostile-world') assert.deepEqual([named(sunk, 'filled')[0]?.user?.matches, named(sunk, 'filled')[0]?.password, named(sunk, 'filled')[0]?.focus, named(sunk, 'submitted')[0]?.native], [null, { matches: null, empty: null, valid: null, ariaInvalid: null }, 'other', { readable: true, clicks: null, trusted: null, buttonClicks: null, submits: null, prevented: null, bubbled: null, invalid: null }], 'login-trace:hostile-world-sanitized');
    }
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(rejections.map(String), [], 'login-trace:no-unhandled-rejection');
  } finally { process.off('unhandledRejection', onRejection); }
});

test('login trace (bounded): thousands of responses, failures and navigations after the click keep the trace within its event caps, still ending with complete counts', async () => {
  const fake = fakeLoginPage(), sunk = [];
  const ui = loginUi(fake.page, { trace: event => { sunk.push(event); } });
  await ui.open(); await ui.state(); await ui.login(SECRET);
  for (let i = 0; i < 500; i++) fake.exchange({ url: LOGIN_API, method: 'OPTIONS', type: 'preflight', failure: 'net::ERR_FAILED' });
  for (let i = 0; i < 500; i++) fake.exchange({ url: LOGIN_API + '?n=' + i, method: 'POST', type: 'fetch', status: 503 });
  for (let i = 0; i < 3000; i++) fake.exchange({ url: WWW + '/omf-synthetic/burst?n=' + i, method: 'POST', type: 'xhr', status: 503 });
  for (let i = 0; i < 1000; i++) fake.exchange({ url: 'https://evil.example/' + i, method: 'POST', type: 'fetch', failure: 'net::ERR_ABORTED' });
  for (let i = 0; i < 400; i++) fake.emit('framenavigated', fake.page.mainFrame());
  for (let i = 0; i < 300; i++) await ui.state();
  await ui.stopTrace?.();
  assertClosed(sunk, 'bounded');
  const end = sunk.at(-1);
  assert.ok(sunk.length <= 200 && sunk.filter(e => (e.event === 'response' || e.event === 'failed') && e.endpoint === 'other').length <= 60 && sunk.filter(e => e.endpoint === 'login-api').length <= 40, 'login-trace:event-caps ' + sunk.length);
  assert.deepEqual([end.event, end.network.after.writes.www['5xx'], end.network.after.writes.other.failed, end.network.events, end.network.dropped > 0, end.dropped > 0], ['end', 3000, 1000, 60, true, true], 'login-trace:counts-complete ' + JSON.stringify(end.network.after));
  assert.deepEqual([end.network.after.login, end.network.after.writes.global['5xx'], end.network.loginApiEvents, end.network.loginApiDropped], [{ options: { ...ZERO, sent: 500, failed: 500 }, post: { ...ZERO, sent: 500, '5xx': 500 }, other: ZERO }, 500, 40, 1960], 'login-trace:login-api-counts-complete ' + JSON.stringify(end.network));
  assert.ok(JSON.stringify(sunk).length < 96 * 1024, 'login-trace:bounded-size ' + JSON.stringify(sunk).length);
  assert.ok(named(sunk, 'sample').length <= 16, 'login-trace:bounded-samples');
});

test('login trace (cancellation): the page closing after the submit ends the sign-in with the unchanged error; the trace still stops, removes its listeners and ends', async () => {
  const fake = fakeLoginPage({ network: REFUSED_NETWORK, closeAfterSubmit: true }), plain = fakeLoginPage({ network: REFUSED_NETWORK, closeAfterSubmit: true });
  const r = await signIn(fake), p = await signIn(plain, { trace: null });
  assert.match(String(r.outcome?.message), /Target closed/, 'unchanged failure');
  assert.equal(String(r.outcome?.message), String(p.outcome?.message), 'login-trace:cancel-same-error');
  const began = Date.now(); await r.ui.stopTrace?.();
  assert.ok(Date.now() - began < 6000, 'login-trace:stop-bounded ' + (Date.now() - began));
  assert.deepEqual([fake.listeners(), named(r.events, 'end').length, r.events.at(-1)?.event], [0, 1, 'end'], 'login-trace:cancel-disposed');
  assert.deepEqual(named(r.events, 'lifecycle').filter(e => e.kind === 'close').map(e => e.phase), ['after'], 'login-trace:close-recorded');
  assertClosed(r.events, 'cancel');
});

// ── the login API and the comparison that stays in this process (network-fold-01 of case omf-amex-login-fix-20261031) ─────────────────
// What the parent's offline public trace saw on the real page after one fictional click: the login module's CORS preflights to its login
// API failed (six: its fetch retries five times) and the actual POST was never sent, while unrelated Amex writes were answered — here an
// analytics 403 and a 400. `type` alternates the resource types Chrome reports for a preflight (other under request interception, preflight).
const PREFLIGHT_ONLY = [
  ...Array.from({ length: 6 }, (_, i) => ({ url: LOGIN_API, method: 'OPTIONS', type: i % 2 ? 'preflight' : 'other', failure: 'net::ERR_FAILED' })),
  { url: WWW + '/omf-synthetic/analytics?u=' + SECRET.username, method: 'POST', type: 'xhr', status: 403 },
  { url: 'https://functions.americanexpress.com/omf-synthetic/collect?token=' + SECRET.password, method: 'POST', type: 'fetch', status: 400 }
];
test('login trace (login API, preflight only): the login module\'s failed CORS preflights are recorded as attempts to the login API that got no answer, its POST as never sent, and the unrelated Amex 403 and 400 as other endpoints, never as an authentication answer', async () => {
  const fake = fakeLoginPage({ network: PREFLIGHT_ONLY, afterSubmit: 'none' }), { ui, outcome, statuses, events } = await signIn(fake);
  await ui.stopTrace?.();
  const api = events.filter(e => e.endpoint === 'login-api').map(({ ms: _ms, ...e }) => e);
  assert.deepEqual(api, PREFLIGHT_ONLY.slice(0, 6).flatMap(({ type }) => [{ event: 'request', phase: 'after', method: 'OPTIONS', type, target: 'global', endpoint: 'login-api' }, { event: 'failed', phase: 'after', method: 'OPTIONS', type, target: 'global', endpoint: 'login-api', failure: 'failed' }]), 'login-trace:login-api-preflight-only ' + JSON.stringify(api));
  const [end] = named(events, 'end');
  assert.deepEqual([end?.network?.after?.login, end?.network?.loginApiEvents], [{ options: { ...ZERO, sent: 6, failed: 6 }, post: ZERO, other: ZERO }, 12], 'login-trace:login-api-counts ' + JSON.stringify(end?.network?.after?.login));
  const answered = events.filter(e => e.event === 'response' && e.phase === 'after').map(({ ms: _ms, ...e }) => e);
  assert.deepEqual(answered, [{ event: 'response', phase: 'after', method: 'POST', type: 'xhr', target: 'www', endpoint: 'other', status: 403, statusClass: '4xx' }, { event: 'response', phase: 'after', method: 'POST', type: 'fetch', target: 'amex', endpoint: 'other', status: 400, statusClass: '4xx' }], 'login-trace:preflight-only-unrelated-4xx ' + JSON.stringify(answered));
  assert.deepEqual([end?.network?.after?.writes?.www, end?.network?.after?.writes?.amex, end?.network?.after?.writes?.global], [{ ...ZERO, sent: 1, '4xx': 1 }, { ...ZERO, sent: 1, '4xx': 1 }, ZERO], 'login-trace:host-counters-kept ' + JSON.stringify(end?.network?.after?.writes));
  assert.deepEqual([statuses.map(s => s[0]), /needs attention/.test(String(outcome?.message)), fake.calls.filter(c => c[0] === 'mouse-click' && c[1] === '#loginSubmit').length], [['running', 'verification_required'], true, 1], 'login-trace:preflight-only-sign-in-unchanged');
  assertClosed(events, 'preflight-only');
  assert.deepEqual(fake.forbidden, [], 'login-trace:no-body-or-header-read');
});

// The login API answered (its preflight 204, its POST 401; on the www origin another public region 503), after an unrelated analytics 403
// and the login API's path on other origins, schemes and ports and other paths of its origins: only the exact origin + anchored path counts.
const ANSWERED = [
  { url: WWW + '/omf-synthetic/analytics?u=' + SECRET.username, method: 'POST', type: 'xhr', status: 403 },
  { url: 'https://www.americanexpress.com.evil.example/myca/logon/japa/action/login', method: 'POST', type: 'fetch', status: 401 },
  { url: 'https://evil.example/myca/logon/japa/action/login?next=' + encodeURIComponent(LOGIN_API), method: 'POST', type: 'fetch', status: 401 },
  { url: 'http://global.americanexpress.com/myca/logon/japa/action/login', method: 'POST', type: 'fetch', status: 401 },
  { url: 'https://global.americanexpress.com:8443/myca/logon/japa/action/login', method: 'POST', type: 'fetch', status: 401 },
  { url: 'https://functions.americanexpress.com/myca/logon/japa/action/login', method: 'POST', type: 'fetch', status: 401 },
  { url: LOGIN_API + '/', method: 'POST', type: 'fetch', status: 401 },
  { url: 'https://global.americanexpress.com/myca/logon/japa/action/LogLogonHandler', method: 'POST', type: 'fetch', status: 401 },
  { url: 'https://global.americanexpress.com/myca/logon/xx/action/login', method: 'POST', type: 'fetch', status: 401 },
  { url: 'https://global.americanexpress.com/omf/myca/logon/japa/action/login', method: 'POST', type: 'fetch', status: 401 },
  { url: LOGIN_API, method: 'OPTIONS', type: 'preflight', status: 204 },
  { url: LOGIN_API + '?synthetic=' + SECRET.password, method: 'POST', type: 'fetch', status: 401 },
  { url: 'https://WWW.AMERICANEXPRESS.COM/myca/logon/us/action/login', method: 'POST', type: 'xhr', status: 503 }
];
test('login trace (login API answered): an unrelated analytics 403 and every lookalike of the login API stay other endpoints; the login API\'s own preflight and POST are recorded as request and received answer, with exact counts', async () => {
  const fake = fakeLoginPage({ network: ANSWERED, afterSubmit: 'none' }), { ui, outcome, statuses, events } = await signIn(fake);
  await ui.stopTrace?.();
  const [end] = named(events, 'end'), analytics = events.find(e => e.event === 'response' && e.status === 403);
  assert.deepEqual([analytics?.endpoint, analytics?.target, end?.network?.after?.login?.post], ['other', 'www', { ...ZERO, sent: 2, '4xx': 1, '5xx': 1 }], 'login-trace:analytics-unrelated ' + JSON.stringify({ analytics, login: end?.network?.after?.login }));
  const others = events.filter(e => (e.event === 'response' || e.event === 'failed') && e.phase === 'after' && e.status !== 403).slice(0, 9).map(e => [e.target, e.endpoint, e.status]);
  assert.deepEqual(others, [['other', 'other', 401], ['other', 'other', 401], ['other', 'other', 401], ['amex', 'other', 401], ['amex', 'other', 401], ['global', 'other', 401], ['global', 'other', 401], ['global', 'other', 401], ['global', 'other', 401]], 'login-trace:lookalike-unrelated ' + JSON.stringify(others));
  const api = events.filter(e => e.endpoint === 'login-api').map(({ ms: _ms, phase: _phase, ...e }) => e);
  assert.deepEqual(api, [
    { event: 'request', method: 'OPTIONS', type: 'preflight', target: 'global', endpoint: 'login-api' },
    { event: 'response', method: 'OPTIONS', type: 'preflight', target: 'global', endpoint: 'login-api', status: 204, statusClass: '2xx' },
    { event: 'request', method: 'POST', type: 'fetch', target: 'global', endpoint: 'login-api' },
    { event: 'response', method: 'POST', type: 'fetch', target: 'global', endpoint: 'login-api', status: 401, statusClass: '4xx' },
    { event: 'request', method: 'POST', type: 'xhr', target: 'www', endpoint: 'login-api' },
    { event: 'response', method: 'POST', type: 'xhr', target: 'www', endpoint: 'login-api', status: 503, statusClass: '5xx' }
  ], 'login-trace:login-api-answered ' + JSON.stringify(api));
  // listed elsewhere: the login page's document before the click, the analytics 403 and the nine lookalikes
  assert.deepEqual([end?.network?.after?.login, end?.network?.loginApiEvents, end?.network?.events], [{ options: { ...ZERO, sent: 1, '2xx': 1 }, post: { ...ZERO, sent: 2, '4xx': 1, '5xx': 1 }, other: ZERO }, 6, 11], 'login-trace:login-api-counts ' + JSON.stringify(end?.network));
  assert.deepEqual([statuses.map(s => s[0]), /needs attention/.test(String(outcome?.message))], [['running', 'verification_required'], true], 'login-trace:answered-sign-in-unchanged');
  assertClosed(events, 'answered');
  assert.deepEqual(fake.forbidden, [], 'login-trace:no-body-or-header-read');
});

test('login trace (context replaced): when the isolated world\'s context number names another document at the comparison (a navigation across processes may reuse it), that document receives no login, part or digest of one and the comparison is unknown; the sign-in is unchanged', async () => {
  const reference = fakeLoginPage({ network: REFUSED_NETWORK }), base = await signIn(reference, { trace: null });
  for (const variant of ['origin', 'path']) {
    const fake = fakeLoginPage({ network: REFUSED_NETWORK, replaced: variant }), r = await signIn(fake);
    await r.ui.stopTrace?.();
    const handed = JSON.stringify(fake.foreign), leaked = SECRET_FORMS(fake.cdpCalls).filter(s => handed.includes(s));
    assert.deepEqual([fake.foreign.length, leaked], [1, []], 'login-trace:context-replaced-no-secret ' + variant + ' ' + handed);
    const [filled] = named(r.events, 'filled'), unknown = { matches: null, empty: null, valid: null, ariaInvalid: null };
    assert.deepEqual([filled?.user, filled?.password, filled?.focus], [unknown, unknown, null], 'login-trace:context-replaced-unknown ' + variant + ' ' + JSON.stringify(filled));
    assert.deepEqual([actions(fake.calls), r.statuses, String(r.outcome?.message)], [actions(reference.calls), base.statuses, String(base.outcome?.message)], 'login-trace:context-replaced-sign-in-unchanged ' + variant);
    assertClosed(r.events, 'replaced-' + variant);
  }
});

test('login trace (comparison failures): WebCrypto missing, refusing or answering garbage, the context destroyed during the comparison and malformed digests leave the comparison unknown, never a mismatch, with nothing leaked and the sign-in unchanged; distinct UTF-16 strings are never equated', { timeout: 60000 }, async () => {
  const reference = fakeLoginPage({ network: REFUSED_NETWORK }), base = await signIn(reference, { trace: null });
  const rejections = []; const onRejection = reason => { rejections.push(reason); }; process.on('unhandledRejection', onRejection);
  try {
    for (const [label, options] of [
      ['crypto-unavailable', { subtle: null }], ['crypto-rejects', { subtle: { async digest() { throw new Error('synthetic WebCrypto failure ' + SECRET.password); } } }],
      ['crypto-garbage', { subtle: { async digest() { return 'synthetic ' + SECRET.password; } } }], ['context-destroyed', { cdp: 'destroyed' }], ['malformed-digests', { cdp: 'malformed' }]
    ]) {
      const fake = fakeLoginPage({ network: REFUSED_NETWORK, ...options }), r = await signIn(fake);
      await r.ui.stopTrace?.();
      const [filled] = named(r.events, 'filled');
      assert.deepEqual([filled?.user?.matches, filled?.password?.matches], [null, null], 'login-trace:crypto-unknown ' + label + ' ' + JSON.stringify(filled));
      assert.deepEqual([actions(fake.calls), r.statuses, String(r.outcome?.message)], [actions(reference.calls), base.statuses, String(base.outcome?.message)], 'login-trace:comparison-failure-sign-in-unchanged ' + label);
      assert.deepEqual(carrying(fake.cdpCalls).map(c => c.method), [], 'login-trace:no-secret-to-browser ' + label);
      assertClosed(r.events, label);
    }
    // exact UTF-16: two passwords that differ only in a lone surrogate (both U+FFFD in UTF-8) are not equal; the same one is
    const lone = { username: SECRET.username, password: 'OmfFictional-\ud800-Kv9x' };
    const same = await signIn(fakeLoginPage(), { credentials: lone }), other = await signIn(fakeLoginPage({ alter: { '#eliloPassword': value => value.replace('\ud800', '\udbff') } }), { credentials: lone });
    await same.ui.stopTrace?.(); await other.ui.stopTrace?.();
    const filledOf = r => named(r.events, 'filled')[0];
    assert.deepEqual([filledOf(same)?.user?.matches, filledOf(same)?.password?.matches, filledOf(other)?.user?.matches, filledOf(other)?.password?.matches], [true, true, true, false], 'login-trace:utf16-exact');
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(rejections.map(String), [], 'login-trace:no-unhandled-rejection');
  } finally { process.off('unhandledRejection', onRejection); }
});
