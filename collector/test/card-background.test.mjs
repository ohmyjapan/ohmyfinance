// collector/test/card-background.test.mjs — routine Amex and Aplus downloads in the background owned Chrome (plan omf-card-handover-20261030).
// Part A (always): the real collector/browser.mjs wrappers over a recording stand-in for rebrowser's launch (the module's own
// launch is replaced in this process; no Chrome starts), the real login.mjs/aplus.mjs UIs on fake pages, and the unchanged
// showWindow bytes; and the real bank callers of the same launch (bank.mjs collectBankStatement and observeBankPortal, bank-balance.mjs
// inquireBalance) over that recording launch: only the card wrappers ask for the minimized window (case omf-card-only-focus-fold-20261030)
// and only their page keeps rendering through the focus emulation of its own page session (case omf-card-rendering-20261031).
// Part B (OMF_CARD_NATIVE=1, serialized with the other Chrome suites): the real wrappers start real stock Chrome
// headed in the background (no startup window, an inactive, minimized off-screen page that keeps rendering) on intercepted synthetic
// issuer pages; every page request is answered from synthetic HTML or aborted, the foreground window is read (never changed), a passive
// recorder keeps the owned Chrome's window events for the whole run, and the reveal is a recording stand-in: the real showWindow is NEVER
// called on a headed window here, because it would move a window on the owner's desktop (its restore from minimized, and the bank
// callers' window that is not minimized, are proven in headless Chrome).
// OMF_TEST_BROWSER_MODULE / OMF_TEST_LOGIN_MODULE / OMF_TEST_APLUS_MODULE point at a mutant copy beside the original;
// OMF_TEST_BANK_MODULE / OMF_TEST_BALANCE_MODULE at copies of bank.mjs / bank-balance.mjs routed to that browser.mjs copy (without them
// a browser.mjs copy skips the bank caller tests, with that reason).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import vm from 'node:vm';
import puppeteer from 'rebrowser-puppeteer-core';
import { HEADERS as APLUS_HEADERS } from '../../shared/aplus.mjs';
import { click, poll } from '../interaction.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (env, file) => import(pathToFileURL(process.env[env] ? path.resolve(process.env[env]) : path.join(here, '..', file)).href);
const B = await load('OMF_TEST_BROWSER_MODULE', 'browser.mjs');
const L = await load('OMF_TEST_LOGIN_MODULE', 'login.mjs');
const P = await load('OMF_TEST_APLUS_MODULE', 'aplus.mjs');
const execute = promisify(execFile);
const WINDOWS = process.platform === 'win32' ? false : 'Windows only';
const AMEX_LOGIN = 'https://www.americanexpress.com/ja-jp/account/login', APLUS = 'https://myaplus.aplus.co.jp';
const ACCOUNT = { _id: 'c3'.repeat(12), ownerId: 'a1'.repeat(12), provider: 'amex', name: 'Synthetic Amex', primaryCard: '12345', cardIdentifiers: ['12345'], otpRecipient: 'codes@example.invalid', otpMailbox: 'codes@example.invalid', jobId: randomUUID() };
const APLUS_ACCOUNT = { _id: 'e5'.repeat(12), ownerId: 'a1'.repeat(12), provider: 'aplus', name: 'Synthetic Aplus', primaryCard: '1234', cardIdentifiers: ['1234'], jobId: randomUUID() };
// The exact showWindow text of the base revision 74f49b3 (line endings normalized): this plan routes attention to it, never edits it.
const SHOW_WINDOW_SHA256 = 'c5e5d5a8175056745909dbb5a61df1d536648f4b3c4bc1e996bd09cd126cb78c';
const PERSON_NEEDED = 'synthetic stop: the person would be shown the window here';
// The one synthetic statement CSV of 2026/09 (2,400円, card -1234) both the fake UI and the native synthetic site deliver.
const aplusCsv = () => Buffer.from('﻿' + [APLUS_HEADERS, ['≪****-****-****-1234≫', '20260901', 'Synthetic shop', '2400', 'Ｓ', '1', '01', '2400', '']].map(row => row.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n'));
// The statement-code texts of collector/aplus.mjs: the person is asked (verification_required) / the source is still typing it (running).
const ASK_TEXT = 'My APLUSの認証コードをChromeで入力してください', AUTO_TEXT = 'My APLUSの認証コードをSMSから自動で入力します';
const roots = [], recorders = [];
async function owned(label) { const dir = await mkdtemp(path.join(os.tmpdir(), 'omf-card-bg-' + label + '-')); roots.push(dir); return dir; }
// A native leg that failed before its own recorder read leaves the recorder to this closure (it stops at once, never at its 15-minute cap).
test.after(async () => { try { await B.closeOwnedBrowsers(); } catch { /* best effort */ } for (const recorder of recorders) await recorder.stop().catch(() => {}); for (const dir of roots) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

// ── fake pages: the issuer surfaces the real login UIs read (no credentials saved → the person is needed) ───────────────────────────
// `refuse`: in a wrapper the page is a background window, so bringToFront would activate it (a foreground action); it fails at once.
const FOREGROUND = 'FOREGROUND: page.bringToFront() on the background page (a window activation)';
const front = (events, refuse) => async () => { events.push('bringToFront'); if (refuse) throw new Error(FOREGROUND); };
function fakeAmexPage(events, { refuse = false } = {}) {
  let url = 'about:blank';
  return { label: 'amex-page', url: () => url, async goto(target) { events.push('goto'); url = target; }, async evaluate() { return url.startsWith(AMEX_LOGIN); }, bringToFront: front(events, refuse) };
}
function fakeAplusPage(events, { refuse = false } = {}) {
  let url = 'about:blank';
  return { label: 'aplus-page', url: () => url, async goto(target) { events.push('goto'); url = target; }, async evaluate() { return url.startsWith(APLUS) ? { kind: 'login' } : { kind: 'unknown' }; }, bringToFront: front(events, refuse) };
}
// ── a recording stand-in for rebrowser's launch: the options, the CDP calls and a browser whose pages are the fake pages ────────────
// A page Target.createTarget opened also records its own page sessions (case omf-card-rendering-20261031: the card page's rendering
// session) and its navigations; `sequence` keeps those steps, the window creation and the closure in order. `rendering` makes that page
// session fail: 'session' — it cannot be opened, 'command' — Chrome refuses Emulation.setFocusEmulationEnabled. Case
// omf-amex-login-fix-20261031: a fake page's own `devtools(method, params)` answers its page sessions' commands (the login trace's isolated
// world), and `onClose` runs when the browser is closed, before it is gone (what the job left at that moment).
function recordingLaunch(makePage, { rendering = null, onClose = null } = {}) {
  const record = { launches: [], cdp: [], defaultPages: 0, closed: 0, pages: [], pageSessions: [], sequence: [] };
  const pageSession = page => async () => {
    if (rendering === 'session') { record.sequence.push('page-session refused'); throw new Error('synthetic: the page session could not be opened'); }
    const session = { page, sent: [], detached: 0 }; record.pageSessions.push(session); record.sequence.push('page-session');
    return {
      async send(method, params) { session.sent.push([method, params]); record.sequence.push(method + ' ' + JSON.stringify(params)); if (rendering === 'command' && method === 'Emulation.setFocusEmulationEnabled') throw new Error('synthetic: ' + method + ' refused'); return page.devtools ? page.devtools(method, params) : {}; },
      async detach() { session.detached++; record.sequence.push('page-session detached'); }
    };
  };
  const launch = async options => {
    record.launches.push(options);
    const targets = new Map(), pages = [], child = { pid: 41000 + record.launches.length, exitCode: 0, signalCode: null, kill() {}, once() {} };
    const opened = () => { const page = makePage(), goto = page.goto; page.createCDPSession = pageSession(page); if (goto) page.goto = async (...args) => { record.sequence.push('goto'); return goto.apply(page, args); }; return page; };
    const browser = {
      connected: true, process: () => child,
      async close() { record.closed++; record.sequence.push('close'); if (onClose) await onClose(); browser.connected = false; },
      async pages() { return pages.slice(); },
      async newPage() { record.defaultPages++; const page = makePage(); pages.push(page); record.pages.push(page); return page; },
      target: () => ({ createCDPSession: async () => ({ async send(method, params) { record.cdp.push([method, params]); if (method !== 'Target.createTarget') return {}; record.sequence.push(method); const id = 'target-' + record.cdp.length, page = opened(); targets.set(id, page); pages.push(page); record.pages.push(page); return { targetId: id }; }, async detach() {} }) }),
      async waitForTarget(predicate) { for (const [id, page] of targets) { const target = { _targetId: id, page: async () => page }; if (predicate(target)) return target; } throw new Error('no such target'); }
    };
    return browser;
  };
  return { record, launch };
}
async function withLaunch(stand, fn) { const original = puppeteer.launch; puppeteer.launch = stand; try { return await fn(); } finally { puppeteer.launch = original; } }
const offscreen = params => params?.newWindow === true && params?.background === true && params.left === -32000 && params.top === -32000 && params.url === 'about:blank';
// The Target.createTarget parameters of the background window as JSON (the serialization the DevTools message carries, key order
// included): the bank callers' live-accepted creation (5b7ef2c6, unchanged through d067126) and the card wrappers' minimized one (b047c86).
const BANK_TARGET = '{"url":"about:blank","newWindow":true,"background":true,"left":-32000,"top":-32000,"width":1280,"height":900}';
const CARD_TARGET = '{"url":"about:blank","newWindow":true,"background":true,"windowState":"minimized","left":-32000,"top":-32000,"width":1280,"height":900}';

// ═══ Part A ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
test('login UI: the reveal callback receives the SAME page; without one show() still brings the tab to the front', async () => {
  const events = [], page = fakeAmexPage(events), revealed = [];
  await L.loginUi(page, { reveal: async p => { revealed.push(p); } }).show();
  assert.deepEqual([revealed.length, revealed[0] === page, events.includes('bringToFront')], [1, true, false], 'card-reveal:login-ui-routes');
  await L.loginUi(page).show();
  assert.deepEqual(events, ['bringToFront'], 'card-reveal:login-ui-default-unchanged');
});
test('ensureLogin with the background UI: the required-human path reveals the owned page once and types nothing', async () => {
  const events = [], page = fakeAmexPage(events), revealed = [], statuses = [];
  let t = 1_800_000_000_000;
  await assert.rejects(L.ensureLogin(page, {}, async (state, text) => { statuses.push([state, text]); }, { account: ACCOUNT, mailbox: null, claims: null, ui: L.loginUi(page, { reveal: async p => { revealed.push(p); } }), timeoutMs: 6000, wait: async ms => { t += ms; }, now: () => t }), /needs attention/);
  assert.deepEqual([revealed.length, revealed[0] === page, events.filter(e => e === 'bringToFront').length], [1, true, 0], 'card-reveal:ensure-login ' + JSON.stringify(events));
  assert.deepEqual(statuses.map(s => s[0]), ['verification_required'], 'card-reveal:one-attention-status');
});
test('Aplus default UI: the reveal callback receives the SAME page; direct callers without one keep bringToFront', async () => {
  for (const [label, reveal, expectReveal] of [['background', true, 1], ['direct caller', false, 0]]) {
    const events = [], page = fakeAplusPage(events), revealed = [], dir = await owned('aplus-ui');
    let t = 1_800_000_000_000;
    await assert.rejects(P.collectAplusFromPage(page, {}, APLUS_ACCOUNT, {}, dir, async () => {}, { ...(reveal ? { reveal: async p => { revealed.push(p); } } : {}), loginTimeoutMs: 5000, now: () => t, wait: async ms => { t += ms; } }), /needs attention/);
    assert.equal(revealed.length, expectReveal, 'card-reveal:aplus-ui-' + label);
    if (expectReveal) assert.equal(revealed[0], page, 'card-reveal:aplus-same-page');
    assert.equal(events.filter(e => e === 'bringToFront').length, reveal ? 0 : 1, 'card-reveal:aplus-bring-to-front-' + label);
  }
});
// The native synthetic My APLUS (leg N) replaces the document on the 保存→CSV click and on the typed code: a page read that navigation
// interrupts is an unknown page for that poll and the job goes on; any other read failure (a closed target) still ends the job.
const NAVIGATION = 'Execution context was destroyed, most likely because of a navigation.';
test('Aplus page read interrupted by a navigation: that poll reads an unknown page and the job goes on; a closed target still ends the job', async () => {
  for (const [label, failure, expected, reveals] of [['navigation-read-is-unknown', NAVIGATION, /needs attention/, 1], ['closed-target-ends-job', 'Protocol error: Target closed', /Target closed/, 0]]) {
    const events = [], page = fakeAplusPage(events), revealed = [], dir = await owned('aplus-read'), read = page.evaluate;
    let reads = 0, t = 1_800_000_000_000;
    page.evaluate = async (...args) => { if (++reads === 1) throw new Error(failure); return read(...args); };
    const outcome = await P.collectAplusFromPage(page, {}, APLUS_ACCOUNT, {}, dir, async () => {}, { reveal: async p => { revealed.push(p); }, loginTimeoutMs: 5000, now: () => t, wait: async ms => { t += ms; } }).then(() => null, error => error);
    assert.match(String(outcome?.message), expected, 'card-aplus:' + label + ' ' + outcome?.message);
    assert.equal(revealed.length, reveals, 'card-aplus:' + label + ' revealed ' + revealed.length);
    if (reveals) assert.ok(reads >= 2, 'card-aplus:' + label + ' the page was read again: ' + reads);
  }
});
test('custom UI seams unchanged: an injected login UI or Aplus UI is used as given, the reveal is never consulted', async () => {
  const shown = [], revealed = [];
  const ui = { async open() {}, async state() { return { kind: 'login' }; }, async show() { shown.push('custom'); } };
  let t = 1_800_000_000_000;
  await assert.rejects(L.ensureLogin(null, {}, async () => {}, { account: ACCOUNT, ui, timeoutMs: 6000, wait: async ms => { t += ms; }, now: () => t }), /needs attention/);
  const aplusUi = { async open() {}, async state() { return { kind: 'login' }; }, async show() { shown.push('custom-aplus'); } };
  await assert.rejects(P.collectAplusFromPage(null, null, APLUS_ACCOUNT, {}, await owned('aplus-custom'), async () => {}, { ui: aplusUi, reveal: async () => { revealed.push(1); }, loginTimeoutMs: 5000, now: () => t, wait: async ms => { t += ms; } }), /needs attention/);
  assert.deepEqual([shown, revealed.length], [['custom', 'custom-aplus'], 0], 'card-reveal:custom-seams');
});
test('Amex wrapper: background launch (no startup window, inactive, minimized off-screen page), ownership first, attention revealed on that page, cleanup', { skip: WINDOWS, timeout: 120000 }, async () => {
  const events = [], stand = recordingLaunch(() => fakeAmexPage(events, { refuse: true })), dir = await owned('amex-wrapper'), revealed = [], order = [];
  await withLaunch(stand.launch, () => assert.rejects(B.collectStatement(ACCOUNT, {}, dir, async () => {}, { batch: 'bg', onLaunch: async () => { order.push('own'); }, reveal: async page => { order.push('reveal'); revealed.push(page); throw new Error(PERSON_NEEDED); } }), new RegExp(PERSON_NEEDED)));
  const [options] = stand.record.launches;
  assert.equal(stand.record.launches.length, 1);
  assert.deepEqual([options.headless, options.pipe, options.args.includes('--no-startup-window'), JSON.stringify(options.ignoreDefaultArgs), options.waitForInitialPage], [false, true, true, '["about:blank"]', false], 'card-background:amex-launch ' + JSON.stringify(options));
  assert.ok(!options.args.some(a => /--headless|--no-sandbox|--disable-web-security|--remote-debugging-port/.test(a)), 'card-background:forbidden-flag');
  const created = stand.record.cdp.filter(([m]) => m === 'Target.createTarget');
  assert.equal(created.length, 1); assert.ok(offscreen(created[0][1]), 'card-background:amex-offscreen-target ' + JSON.stringify(created[0][1]));
  assert.equal(created[0][1].windowState, 'minimized', 'card-background:amex-minimized-window ' + JSON.stringify(created[0][1]));
  assert.equal(JSON.stringify(created[0][1]), CARD_TARGET, 'card-background:amex-target-exact');
  assert.equal(stand.record.defaultPages, 0, 'card-background:amex-no-foreground-page');
  assert.deepEqual(order, ['own', 'reveal'], 'card-background:amex-ownership-before-attention');
  assert.deepEqual([revealed.length, revealed[0] === stand.record.pages[0], events.includes('bringToFront')], [1, true, false], 'card-reveal:amex-wrapper-routes');
  assert.equal(stand.record.closed, 1, 'card-background:amex-closed');
  assert.equal(existsSync(B.ephemeralProfile(dir, ACCOUNT.ownerId, 'amex', ACCOUNT._id, 'bg')), false, 'card-background:amex-profile-removed');
  assert.deepEqual(B.ownedBrowsers(), [], 'card-background:amex-registry-empty');
});
test('Aplus wrapper: the same background launch and attention routing, cleanup', { skip: WINDOWS, timeout: 120000 }, async () => {
  const events = [], stand = recordingLaunch(() => fakeAplusPage(events, { refuse: true })), dir = await owned('aplus-wrapper'), revealed = [];
  await withLaunch(stand.launch, () => assert.rejects(B.collectAplusStatement(APLUS_ACCOUNT, {}, dir, async () => {}, { batch: 'bg', reveal: async page => { revealed.push(page); throw new Error(PERSON_NEEDED); } }), new RegExp(PERSON_NEEDED)));
  const [options] = stand.record.launches;
  assert.deepEqual([options.headless, options.args.includes('--no-startup-window'), options.waitForInitialPage], [false, true, false], 'card-background:aplus-launch ' + JSON.stringify(options));
  const created = stand.record.cdp.filter(([m]) => m === 'Target.createTarget');
  assert.ok(created.length === 1 && offscreen(created[0][1]), 'card-background:aplus-offscreen-target');
  assert.equal(created[0][1].windowState, 'minimized', 'card-background:aplus-minimized-window ' + JSON.stringify(created[0][1]));
  assert.equal(JSON.stringify(created[0][1]), CARD_TARGET, 'card-background:aplus-target-exact');
  assert.equal(stand.record.defaultPages, 0, 'card-background:aplus-no-foreground-page');
  assert.deepEqual([revealed.length, revealed[0] === stand.record.pages[0], events.includes('bringToFront')], [1, true, false], 'card-reveal:aplus-wrapper-routes');
  assert.equal(stand.record.closed, 1); assert.deepEqual(B.ownedBrowsers(), [], 'card-background:aplus-registry-empty');
  assert.equal(existsSync(B.ephemeralProfile(dir, APLUS_ACCOUNT.ownerId, 'aplus', APLUS_ACCOUNT._id, 'bg')), false, 'card-background:aplus-profile-removed');
});
test('protected session loss: closing the owned browsers mid-job ends the wrapper and leaves no browser or profile', { skip: WINDOWS, timeout: 120000 }, async () => {
  const events = [], stand = recordingLaunch(() => { const page = fakeAplusPage(events, { refuse: true }); const evaluate = page.evaluate; page.evaluate = async (...args) => { if (stand.record.closed) throw new Error('Protocol error: Target closed'); return evaluate(...args); }; return page; }), dir = await owned('session-loss');
  await withLaunch(stand.launch, () => assert.rejects(B.collectAplusStatement(APLUS_ACCOUNT, {}, dir, async () => {}, { batch: 'loss', reveal: async () => { await B.closeOwnedBrowsers(); } }), /Target closed/));
  assert.equal(stand.record.closed, 1, 'card-background:session-loss-closed-once');
  assert.deepEqual(B.ownedBrowsers(), []); assert.equal(existsSync(B.ephemeralProfile(dir, APLUS_ACCOUNT.ownerId, 'aplus', APLUS_ACCOUNT._id, 'loss')), false, 'card-background:session-loss-profile');
});
// ── the minimized card page keeps rendering (case omf-card-rendering-20261031): the page's own DevTools session sends Chrome's focus
// emulation once, before the first page step, and the collector never detaches it (Chrome ends it with the page or the browser). A page
// that cannot keep rendering ends the job at page setup with one fixed message: before any navigation, so before any login is typed. ────
const RENDERING = 'Emulation.setFocusEmulationEnabled {"enabled":true}';
const RENDERING_FAILED = 'The minimized card window could not keep its page rendering';
const FICTIONAL_LOGIN = { username: 'omf-fictional-user', password: 'omf-fictional-pass' };
for (const [lane, makePage, run, profileOf] of [
  ['Amex', fakeAmexPage, (dir, settings, options) => B.collectStatement(ACCOUNT, settings, dir, async () => {}, options), (dir, batch) => B.ephemeralProfile(dir, ACCOUNT.ownerId, 'amex', ACCOUNT._id, batch)],
  ['Aplus', fakeAplusPage, (dir, settings, options) => B.collectAplusStatement(APLUS_ACCOUNT, settings, dir, async () => {}, options), (dir, batch) => B.ephemeralProfile(dir, APLUS_ACCOUNT.ownerId, 'aplus', APLUS_ACCOUNT._id, batch)]
]) {
  const tag = lane.toLowerCase();
  test(`card rendering (${lane} wrapper): the minimized page's own session sends the focus emulation once, before the first page step, and the collector never detaches it`, { skip: WINDOWS, timeout: 120000 }, async () => {
    const events = [], stand = recordingLaunch(() => makePage(events, { refuse: true })), dir = await owned('rendering-' + tag);
    await withLaunch(stand.launch, () => assert.rejects(run(dir, {}, { batch: 'rendering', reveal: async () => { stand.record.sequence.push('reveal'); throw new Error(PERSON_NEEDED); } }), new RegExp(PERSON_NEEDED)));
    assert.deepEqual(stand.record.sequence, ['Target.createTarget', 'page-session', RENDERING, 'goto', 'reveal', 'close'], `card-rendering:${tag}-renders-before-first-step ` + JSON.stringify(stand.record.sequence));
    assert.deepEqual(stand.record.pageSessions.map(s => [s.page === stand.record.pages[0], s.sent.length, s.detached]), [[true, 1, 0]], `card-rendering:${tag}-session-kept`);
    assert.deepEqual([existsSync(profileOf(dir, 'rendering')), B.ownedBrowsers()], [false, []], `card-rendering:${tag}-closed`);
  });
  test(`card rendering setup failure (${lane} wrapper): a page session that cannot be opened or a refused focus emulation ends the job at page setup with the fixed message, before any navigation or typed login; browser closed, profile removed`, { skip: WINDOWS, timeout: 120000 }, async () => {
    for (const [point, opened] of [['session', ['page-session refused']], ['command', ['page-session', RENDERING]]]) {
      const events = [], revealed = [], stand = recordingLaunch(() => makePage(events, { refuse: true }), { rendering: point }), dir = await owned('rendering-' + tag + '-' + point);
      const outcome = await withLaunch(stand.launch, () => run(dir, FICTIONAL_LOGIN, { batch: 'refused', reveal: async page => { revealed.push(page); throw new Error(PERSON_NEEDED); } }).then(() => null, error => error));
      assert.equal(outcome?.message, RENDERING_FAILED, `card-rendering:setup-failure-${tag}-${point} ` + outcome?.message);
      assert.deepEqual(stand.record.sequence, ['Target.createTarget', ...opened, 'close'], `card-rendering:setup-failure-${tag}-${point}-before-any-page-step ` + JSON.stringify(stand.record.sequence));
      assert.deepEqual([events, revealed.length, stand.record.closed, existsSync(profileOf(dir, 'refused')), B.ownedBrowsers()], [[], 0, 1, false, []], `card-rendering:setup-failure-${tag}-${point}-cleanup`);
    }
  });
}
// ── the bank callers of the same background launch (case omf-card-only-focus-fold-20261030, final review F1): only the two card wrappers
// ask for the minimized window; statement retrieval, the guided PayPay observe and the hourly balance keep the live-accepted creation
// without windowState and without the card page's focus emulation (Chrome 155 does not show the 池田泉州銀行 client-certificate chooser
// while the page is hidden; the bank behaviour accepted live stays exactly as it is). The real
// bank.mjs / bank-balance.mjs entry points run over the recording launch on owned roots, each stopped at its first page step (a
// synthetic adapter or UI, or the balance precheck of a synthetic snapshot without an account); the browser registry proves they launched
// through the browser.mjs under test.
const BANK_STOP = 'synthetic stop: the bank page is not part of this test';
const BANK = { ownerId: 'a1'.repeat(12), bankAccountId: 'b2'.repeat(12), snapshotHash: 'd4'.repeat(32) };
const STOP_UI = { async open() { throw new Error(BANK_STOP); }, async state() { throw new Error(BANK_STOP); }, async show() { throw new Error(BANK_STOP); } };
const UNROUTED = process.env.OMF_TEST_BROWSER_MODULE && !process.env.OMF_TEST_BANK_MODULE ? 'the browser.mjs copy has no routed bank modules (OMF_TEST_BANK_MODULE / OMF_TEST_BALANCE_MODULE)' : false;
async function bankCaller(batch, call) {
  const stand = recordingLaunch(() => ({ label: 'bank-page', url: () => 'about:blank' })), dir = await owned('bank-' + batch);
  const bank = await load('OMF_TEST_BANK_MODULE', 'bank.mjs'), balance = await load('OMF_TEST_BALANCE_MODULE', 'bank-balance.mjs');
  const outcome = await withLaunch(stand.launch, () => call({ bank, balance, dir, bound: { ...BANK, jobId: randomUUID() } })).then(value => ({ value }), error => ({ error }));
  const profile = B.ephemeralProfile(dir, BANK.ownerId, 'bank', BANK.bankAccountId, batch), routed = B.ownedBrowsers().some(e => e.profile === profile);
  await B.closeOwnedBrowsers();
  return { outcome, routed, launches: stand.record.launches, created: stand.record.cdp.filter(([m]) => m === 'Target.createTarget').map(([, p]) => JSON.stringify(p)), emulation: stand.record.pageSessions.flatMap(s => s.sent).filter(([method]) => method.startsWith('Emulation.')), sequence: stand.record.sequence, defaultPages: stand.record.defaultPages, closed: stand.record.closed, profileLeft: existsSync(profile) };
}
const ended = run => run.outcome.error ? 'threw ' + run.outcome.error.message : 'returned ' + JSON.stringify(run.outcome.value);
function assertBankBackground(run, label) {
  const [options] = run.launches;
  assert.equal(run.launches.length, 1, 'bank-background:' + label + ' launched once; ' + ended(run));
  assert.ok(run.routed, 'bank-background:routed ' + label + ': the bank module did not launch through the browser.mjs under test');
  assert.deepEqual([options.headless, options.args.includes('--no-startup-window'), options.waitForInitialPage], [false, true, false], 'bank-background:' + label + '-launch ' + JSON.stringify(options));
  assert.deepEqual(run.created, [BANK_TARGET], 'bank-background:' + label + '-target ' + JSON.stringify(run.created));
  // case omf-card-rendering-20261031: no page session of the bank page sends any Emulation command (the card page's focus emulation
  // included); the bank modules' own page sessions (the guided observe's Runtime binding, the dialog watchers) are theirs, unchanged
  assert.deepEqual(run.emulation, [], 'bank-background:' + label + '-no-emulation ' + JSON.stringify(run.sequence));
  assert.deepEqual([run.defaultPages, run.closed, run.profileLeft], [0, 1, false], 'bank-background:' + label + '-closed');
}
test('bank caller statement retrieval (bank.mjs collectBankStatement): its background window keeps the live-accepted creation, no windowState', { skip: WINDOWS || UNROUTED, timeout: 120000 }, async () => {
  const run = await bankCaller('statement', ({ bank, dir, bound }) => bank.collectBankStatement(bound, { provider: 'synthetic', snapshot: { provider: 'synthetic', variant: null } }, dir, async () => {}, { adapter: { label: 'Synthetic bank', support: 'verified', ui() { throw new Error(BANK_STOP); } }, batch: 'statement' }));
  assertBankBackground(run, 'statement');
  assert.equal(run.outcome.error?.message, BANK_STOP, 'stopped at its first page step; ' + ended(run));
});
test('bank caller guided PayPay observe (bank.mjs observeBankPortal, PayPay銀行 standard): its background window keeps the live-accepted creation, no windowState', { skip: WINDOWS || UNROUTED, timeout: 120000 }, async () => {
  const run = await bankCaller('observe', ({ bank, dir, bound }) => bank.observeBankPortal(bound, { provider: 'paypay', snapshot: { provider: 'paypay', variant: 'standard' } }, dir, async () => {}, { batch: 'observe', ui: STOP_UI }));
  assertBankBackground(run, 'guided-observe');
  assert.equal(run.outcome.error?.message, BANK_STOP, 'stopped at its first page step; ' + ended(run));
});
test('bank caller hourly balance (bank-balance.mjs inquireBalance, 池田泉州銀行 ビジネスゲート): its background window keeps the live-accepted creation, no windowState', { skip: WINDOWS || UNROUTED, timeout: 120000 }, async () => {
  const run = await bankCaller('balance', ({ balance, dir, bound }) => balance.inquireBalance(bound, { kind: 'balance', provider: 'ikeda', snapshot: { provider: 'ikeda', variant: 'portal' } }, dir, async () => {}, { batch: 'balance' }));
  assertBankBackground(run, 'balance');
  assert.match(String(run.outcome.value?.failed), /残高の確認の設定にありません/, 'stopped at the balance precheck (a synthetic snapshot without an account); ' + ended(run));
});
test('bank caller observe without a guided adapter (PayPay銀行, no variant): the visible default lane is unchanged, no background launch and no Target.createTarget', { skip: WINDOWS || UNROUTED, timeout: 120000 }, async () => {
  const run = await bankCaller('visible', ({ bank, dir, bound }) => bank.observeBankPortal(bound, { provider: 'paypay', snapshot: { provider: 'paypay', variant: null } }, dir, async () => {}, { batch: 'visible', ui: STOP_UI }));
  const [options] = run.launches;
  assert.equal(run.launches.length, 1, 'bank-background:visible launched once; ' + ended(run));
  assert.ok(run.routed, 'bank-background:routed visible: the bank module did not launch through the browser.mjs under test');
  assert.deepEqual([options.headless, options.args.includes('--no-startup-window'), 'waitForInitialPage' in options, run.created, run.defaultPages, run.closed, run.profileLeft], [false, false, false, [], 1, 1, false], 'bank-background:visible-lane-unchanged ' + JSON.stringify({ options, created: run.created }));
  assert.equal(run.outcome.error?.message, BANK_STOP, 'stopped at its first page step; ' + ended(run));
});
// ── P4 (parent fold): the statement-code wait of the background wrapper — awaitDownload's onManual on a virtual clock ──────────────
const SMS = (id, receivedAt, code = '4821') => ({ id, sender: '0570-008-789', receivedAt, body: '【My APLUS】ご利用明細書ダウンロードの認証コードは ' + code + ' です。有効期限は5分です。' });
// `quiet`: the background wrapper's wiring (notice without show, onManual shows); otherwise the historical wiring (show at the notice).
// The person types `personAfter` ms after the window is shown; the reader answers `source(read, requestedAt, now)`; `reject`: the issuer
// refuses the typed code (the page stays on the code page).
async function codeWait({ source = null, quiet = true, personAfter = 30000, abortAt = 0, reject = false } = {}) {
  const dir = await owned('code-wait'), start = 1_800_000_000_000, controller = new AbortController(), trace = { notices: [], manual: [], claims: [], reads: 0, typed: null, shownAt: null };
  let t = start, kind = 'details';
  const deliver = async () => { kind = 'details'; await writeFile(path.join(dir, randomUUID()), 'synthetic csv'); };
  const shown = () => { if (trace.shownAt === null) trace.shownAt = t; };
  const codeSource = source && { async messages({ requestedAt }) { trace.reads++; if (abortAt && trace.reads === abortAt) controller.abort(); return source(trace.reads, requestedAt, t); }, async claim(id) { trace.claims.push(id); } };
  const outcome = await P.awaitDownload({ jobDir: dir, request: async () => { kind = 'verification'; }, state: async () => ({ kind }),
    onVerification: async () => { trace.notices.push(t - start); if (!quiet) shown(); }, ...(quiet ? { onManual: async () => { trace.manual.push(t - start); shown(); } } : {}),
    code: async value => { trace.typed = value; if (!reject) await deliver(); }, codeSource, requestedAt: start, signal: controller.signal,
    now: () => t, wait: async ms => { t += ms; if (kind === 'verification' && trace.shownAt !== null && t - trace.shownAt >= personAfter) await deliver(); },
    timeoutMs: 300000, extensionMs: 300000, pollMs: 1000, codePollMs: 5000 }).then(name => ({ name }), error => ({ error }));
  return { ...trace, outcome, elapsed: t - start };
}
test('statement code (background): an automatic code is typed while the window stays hidden; reads, claim and code identical to a caller without onManual', async () => {
  const source = (read, requestedAt) => read >= 2 ? [SMS('src:auto', requestedAt + 7000, '2468')] : [];
  const quiet = await codeWait({ source }), loud = await codeWait({ source, quiet: false });
  assert.ok(quiet.outcome.name, 'completed ' + (quiet.outcome.error?.message || ''));
  assert.deepEqual(quiet.manual, [], 'card-reveal:auto-code-stays-hidden ' + JSON.stringify(quiet.manual));
  assert.deepEqual([quiet.reads, quiet.claims, quiet.typed, quiet.notices, quiet.elapsed], [loud.reads, loud.claims, loud.typed, loud.notices, loud.elapsed], 'card-reveal:auto-code-semantics-unchanged');
  assert.deepEqual([quiet.claims, quiet.typed, quiet.notices.length], [['src:auto'], '2468', 1]);
});
test('statement code (background): no source → shown once at the notice; a failing reader → shown once while reading goes on; validity elapsed → shown once after 300 s', async () => {
  const none = await codeWait();
  assert.equal(none.manual.length, 1, 'card-reveal:no-source-shown ' + JSON.stringify(none.manual)); assert.ok(none.manual[0] <= 1000, 'card-reveal:no-source-shown at the notice, not later: ' + none.manual[0]); assert.ok(none.outcome.name, 'the person completed it');
  const failing = await codeWait({ source: () => { throw new Error('adb: device unauthorized'); } });
  assert.equal(failing.manual.length, 1, 'card-reveal:reader-failure-shown-once ' + JSON.stringify(failing.manual));
  assert.ok(failing.manual[0] <= 1000, 'card-reveal:reader-failure-shown-at-the-failure, not at the validity end: ' + failing.manual[0]);
  assert.ok(failing.outcome.name, 'the person completed it'); assert.ok(failing.reads >= 2, 'the reader kept being read: ' + failing.reads); assert.deepEqual(failing.claims, []);
  const silent = await codeWait({ source: () => [] });
  assert.equal(silent.manual.length, 1, 'card-reveal:expiry-shown-once ' + JSON.stringify(silent.manual)); assert.ok(silent.manual[0] > 300000 && silent.manual[0] <= 302000, 'card-reveal:expiry-shown-once when the validity elapsed: ' + silent.manual[0]); assert.ok(silent.outcome.name, 'the person completed it');
  assert.ok(silent.reads >= 60 && silent.reads <= 61, 'reads stop at the validity end: ' + silent.reads); assert.deepEqual(silent.claims, []);
});
test('statement code (background): a cancellation ends the wait as cancelled without revealing anything', async () => {
  const cancelled = await codeWait({ source: () => [], abortAt: 3 });
  assert.equal(cancelled.outcome.error?.name, 'AbortError'); assert.deepEqual(cancelled.manual, [], 'card-reveal:cancel-not-shown'); assert.equal(cancelled.reads, 3); assert.equal(cancelled.typed, null);
});
test('statement code (background): a typed code the issuer refuses is shown once when the code\'s validity elapses (the documented limit); one claim, one code', async () => {
  const refused = await codeWait({ source: (read, requestedAt) => [SMS('src:refused', requestedAt + 7000, '2468')], reject: true });
  assert.deepEqual([refused.claims, refused.typed, refused.reads], [['src:refused'], '2468', 1], 'one read, one claim, one typed code');
  assert.equal(refused.manual.length, 1, 'card-reveal:refused-code-shown-once ' + JSON.stringify(refused.manual));
  assert.ok(refused.manual[0] > 300000 && refused.manual[0] <= 302000, 'card-reveal:refused-code-shown-at-the-validity-end: ' + refused.manual[0]);
  assert.ok(refused.outcome.name, 'the person completed it');
});
// The custom (injected) Aplus UI seam through one statement whose CSV needs the statement code; it stops at the unbilled page.
const UNBILLED_STOP = 'synthetic stop: the unbilled page is not part of this test';
function codeUi(timeline) {
  let kind = 'authenticated', jobDir = null, guid = null, handlers = {};
  return {
    async open() {}, async state() { return { kind }; }, async openDetails() { kind = 'details'; },
    async snapshot() { return { month: '2026/09', selectedMonth: '2026/09', total: '2,400円', totalPresent: true, account: '…-1234', options: ['2026/09'] }; },
    async selectMonth() {}, downloadSession(dir) { jobDir = dir; return { on(event, handler) { handlers[event] = handler; }, async close() {} }; },
    async save() {}, async csv() { guid = randomUUID(); kind = 'verification'; },
    async code(value) { timeline.push(['code', value]); kind = 'details'; await writeFile(path.join(jobDir, guid), aplusCsv()); handlers['Browser.downloadWillBegin']?.({ guid }); handlers['Browser.downloadProgress']?.({ guid, state: 'completed' }); },
    async show() { timeline.push(['show']); }, async openUnbilled() { throw new Error(UNBILLED_STOP); }
  };
}
test('custom Aplus UI with an SMS source: the statement-code notice asks at once, as before (verification_required, then show, before any read); the reveal is not used', async () => {
  const timeline = [], revealed = [], dir = await owned('aplus-custom-code');
  let t = 1_800_000_000_000, reads = 0;
  const codeSource = { async messages({ requestedAt }) { reads++; timeline.push(['read']); return reads >= 2 ? [SMS('src:custom', requestedAt + 7000, '2468')] : []; }, async claim(id) { timeline.push(['claim', id]); } };
  await assert.rejects(P.collectAplusFromPage(null, null, APLUS_ACCOUNT, {}, dir, async (state, text) => { timeline.push(['status', state, text]); }, { ui: codeUi(timeline), reveal: async () => { revealed.push(1); }, codeSource, covered: [], now: () => t, wait: async ms => { t += ms; }, pollMs: 1000 }), new RegExp(UNBILLED_STOP));
  const asked = timeline.filter(e => e[0] !== 'status' || e[1] === 'verification_required');
  assert.deepEqual(asked.slice(0, 3), [['status', 'verification_required', ASK_TEXT], ['show'], ['read']], 'card-reveal:custom-ui-asks-at-notice ' + JSON.stringify(asked));
  assert.deepEqual([asked.filter(e => e[0] === 'show' || e[1] === 'verification_required').length, revealed.length], [2, 0], 'card-reveal:custom-ui-asked-once-reveal-unused');
  assert.deepEqual(asked.filter(e => e[0] === 'claim' || e[0] === 'code'), [['claim', 'src:custom'], ['code', '2468']], 'one claim, one typed code');
  assert.ok(!timeline.some(e => e[2] === AUTO_TEXT), 'card-reveal:custom-ui-no-automatic-text');
});
test('showWindow and the background flags are unchanged: attention reuses the bank lane exactly', () => {
  assert.equal(createHash('sha256').update(B.showWindow.toString().replace(/\r\n/g, '\n')).digest('hex'), SHOW_WINDOW_SHA256, 'card-background:showWindow-bytes');
  assert.deepEqual([...B.BACKGROUND_ARGS], ['--no-startup-window']);
  assert.deepEqual([...B.LAUNCH_ARGS], ['--lang=ja-JP,ja', '--accept-lang=ja-JP,ja;q=0.9,en;q=0.8', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync']);
});
test('actual reveal geometry on the owner desktop', { skip: 'EXCLUDED by the owner no-foreground order: the real showWindow moves a window onto the owner\'s screen; its geometry is the unchanged bank lane (browser-boundary B8), pinned here by its bytes' }, () => {});

// ── the Amex language preference (case omf-amex-locale-01) ───────────────────────────────────────────────────────────────────────────
// Chrome takes --accept-lang as its language preference list as given, so the release's q-weighted switch reached the Amex pages literally
// (navigator.languages ja-JP, ja;q=0.9, en;q=0.8). Only the Amex wrapper launches with the plain tags ja-JP, ja, en; every other launch of the
// same launcher (the Aplus wrapper, the bank callers, the visible bank lane, Yayoi's and the public research reader's options, a headless
// default) keeps the release's arguments byte for byte. Both lists are pinned literally here, so a change of either is a change of this file.
const RELEASE_LAUNCH_ARGS = ['--lang=ja-JP,ja', '--accept-lang=ja-JP,ja;q=0.9,en;q=0.8', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync'];
const AMEX_LAUNCH_ARGS = ['--lang=ja-JP,ja', '--accept-lang=ja-JP,ja,en', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync'];
const AMEX_LANGUAGES = ['ja-JP', 'ja', 'en'];
// The language list of a launch's --accept-lang, and what Intl.getCanonicalLocales makes of a list (its error's name when it rejects one).
const acceptTags = args => String(args?.find(arg => arg.startsWith('--accept-lang=')) ?? '').slice('--accept-lang='.length).split(',');
const canonical = tags => { try { return Intl.getCanonicalLocales(tags); } catch (error) { return String(error?.name); } };
// The two card wrappers over the recording launch, each stopped where the person would be asked; their one launch's options.
async function cardLaunch(lane) {
  const [makePage, run] = lane === 'amex' ? [fakeAmexPage, dir => B.collectStatement(ACCOUNT, {}, dir, async () => {}, { batch: 'language', reveal: async () => { throw new Error(PERSON_NEEDED); } })] : [fakeAplusPage, dir => B.collectAplusStatement(APLUS_ACCOUNT, {}, dir, async () => {}, { batch: 'language', reveal: async () => { throw new Error(PERSON_NEEDED); } })];
  const stand = recordingLaunch(() => makePage([], { refuse: true })), dir = await owned('language-' + lane);
  await withLaunch(stand.launch, () => assert.rejects(run(dir), new RegExp(PERSON_NEEDED)));
  assert.equal(stand.record.launches.length, 1, 'amex-locale:recorded-only ' + lane);
  return stand.record.launches[0];
}
test('Amex language preference (wrapper): the real collectStatement launches with the plain tags ja-JP, ja, en in place of the weighted list; every other launch option is the Aplus wrapper\'s', { skip: WINDOWS, timeout: 120000 }, async () => {
  const amex = await cardLaunch('amex'), aplus = await cardLaunch('aplus');
  assert.deepEqual(amex.args, [...AMEX_LAUNCH_ARGS, '--no-startup-window'], 'amex-locale:proper-language-preferences ' + JSON.stringify(amex.args));
  assert.deepEqual(canonical(acceptTags(amex.args)), AMEX_LANGUAGES, 'amex-locale:valid-tags');
  const rest = ({ args: _args, userDataDir: _profile, ...options }) => options;
  assert.deepEqual(rest(amex), rest(aplus), 'amex-locale:other-launch-options-unchanged ' + JSON.stringify([rest(amex), rest(aplus)]));
  assert.deepEqual(B.ownedBrowsers(), [], 'amex-locale:registry-empty');
});
test('Amex language preference (defaults): every other launch keeps the release\'s arguments byte for byte — the Aplus wrapper, the bank statement, guided observe and hourly balance callers, the visible bank lane, and direct launches with Yayoi\'s, the public reader\'s, a headless and a background default\'s options', { skip: WINDOWS || UNROUTED, timeout: 180000 }, async () => {
  assert.deepEqual([...B.LAUNCH_ARGS], RELEASE_LAUNCH_ARGS, 'amex-locale:default-constant-preserved');
  const seen = { aplus: [(await cardLaunch('aplus')).args] };
  for (const [lane, call] of [
    ['statement', ({ bank, dir, bound }) => bank.collectBankStatement(bound, { provider: 'synthetic', snapshot: { provider: 'synthetic', variant: null } }, dir, async () => {}, { adapter: { label: 'Synthetic bank', support: 'verified', ui() { throw new Error(BANK_STOP); } }, batch: 'language-statement' })],
    ['guided-observe', ({ bank, dir, bound }) => bank.observeBankPortal(bound, { provider: 'paypay', snapshot: { provider: 'paypay', variant: 'standard' } }, dir, async () => {}, { batch: 'language-guided-observe', ui: STOP_UI })],
    ['balance', ({ balance, dir, bound }) => balance.inquireBalance(bound, { kind: 'balance', provider: 'ikeda', snapshot: { provider: 'ikeda', variant: 'portal' } }, dir, async () => {}, { batch: 'language-balance' })],
    ['visible', ({ bank, dir, bound }) => bank.observeBankPortal(bound, { provider: 'paypay', snapshot: { provider: 'paypay', variant: null } }, dir, async () => {}, { batch: 'language-visible', ui: STOP_UI })]
  ]) {
    const run = await bankCaller('language-' + lane, call);
    assert.ok(run.routed, 'amex-locale:bank-routed ' + lane + ': the bank module did not launch through the browser.mjs under test; ' + ended(run));
    seen[lane] = run.launches.map(launch => launch.args);
  }
  for (const [lane, options] of [['yayoi', dir => ({ ephemeral: true, root: dir, onLaunch: async () => {} })], ['research', () => undefined], ['headless', () => ({ headless: true })], ['factory-background', () => ({ background: true })]]) {
    const stand = recordingLaunch(() => fakeAmexPage([])), dir = await owned('language-' + lane), given = options(dir);
    const profile = given?.ephemeral ? B.ephemeralProfile(dir, BANK.ownerId, 'language', lane, 'direct') : path.join(dir, 'profile');
    await withLaunch(stand.launch, async () => { try { await B.browserFor(profile, given); } finally { await B.closeOwnedBrowsers(); } });
    seen[lane] = stand.record.launches.map(launch => launch.args);
  }
  const background = [...RELEASE_LAUNCH_ARGS, '--no-startup-window'], all = JSON.stringify(seen);
  assert.deepEqual(seen.aplus, [background], 'amex-locale:aplus-default-preserved ' + all);
  for (const lane of ['statement', 'guided-observe', 'balance']) assert.deepEqual(seen[lane], [background], 'amex-locale:bank-default-preserved ' + lane + ' ' + all);
  assert.deepEqual(seen.visible, [RELEASE_LAUNCH_ARGS], 'amex-locale:bank-default-preserved visible ' + all);
  for (const lane of ['yayoi', 'research', 'headless']) assert.deepEqual(seen[lane], [RELEASE_LAUNCH_ARGS], 'amex-locale:' + lane + '-default-preserved ' + all);
  assert.deepEqual(seen['factory-background'], [background], 'amex-locale:factory-default-preserved ' + all);
  assert.deepEqual(B.ownedBrowsers(), [], 'amex-locale:registry-empty');
});

// ── the value-free login trace of the Amex wrapper (case omf-amex-login-fix-20261031) ─────────────────────────────────────────────────
// The REAL collectStatement over the recording launch, with a fake issuer page the real loginUi signs in on: the fictional login typed,
// ログイン pressed once, the login module's CORS preflight to its login API failing (its POST never sent), an unrelated synthetic POST
// answered 403, then the verification page, where the person is needed (no mailbox). The trace's isolated world is answered by the page
// itself through the recording page session (`devtools`), which runs the REAL source of the trace's field comparison on the typed values
// (network-fold-01); every URL the page shows carries the fictional login in its query. As on a real page, the submit's requests and the
// next document come after the click returned (here: at the page's next read). The record is read from the owned directory; `onClose` sees
// what the job left when the browser closed.
const traceDir = dir => path.join(dir, 'diagnostics', 'amex', ACCOUNT._id);
const traceFiles = async dir => { try { return (await readdir(traceDir(dir))).sort(); } catch { return []; } };
const TRACE_NAME = new RegExp('^' + ACCOUNT.jobId + '-\\d{13}\\.json$');
const TRACE_LEAKS = [FICTIONAL_LOGIN.username, FICTIONAL_LOGIN.password, 'http', '?', 'americanexpress', 'example.invalid', 'omf-synthetic', 'Target closed', 'synthetic', 'logon', 'myca', 'japa'];
// The login request of the issuer's public login module (POST /myca/logon/<region>/action/login; ja-JP: japa), on the global origin.
const LOGIN_API = 'https://global.americanexpress.com/myca/logon/japa/action/login';
const ZERO_CELL = Object.freeze({ sent: 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0, failed: 0 });
// Every form in which the fictional login could reach the browser through `calls` (DevTools [method, params]): its values, and the 16-hex /
// 12-base64 prefixes of SHA-256 of their UTF-8 and UTF-16LE bytes, plain and under every 64-hex nonce those calls carried.
const loginForms = calls => [FICTIONAL_LOGIN.username, FICTIONAL_LOGIN.password].flatMap(s => [s, ...[null, ...calls.flatMap(c => (c.params?.arguments || []).map(a => a.value)).filter(v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v))]
  .flatMap(nonce => ['utf8', 'utf16le'].map(encoding => createHash('sha256').update(nonce ? Buffer.from(nonce, 'hex') : Buffer.alloc(0)).update(Buffer.from(s, encoding)).digest())).flatMap(d => [d.toString('hex').slice(0, 16), d.toString('base64').slice(0, 12)])]);
const handedLogin = calls => { const forms = loginForms(calls); return calls.filter(c => forms.some(form => JSON.stringify(c.params ?? {}).includes(form))).map(c => c.method); };
// Runs the trace's field comparison from its REAL source as Runtime.callFunctionOn would (awaited, by value) on the fake page's fields.
async function inFakeWorld(source, args, { values, href }) {
  const element = selector => ({ value: values[selector] ?? '', validity: { valid: true }, getAttribute: () => null }), at = new URL(href);
  const nodes = { '#eliloUserID': element('#eliloUserID'), '#eliloPassword': element('#eliloPassword'), '#loginSubmit': {} };
  const sandbox = { document: { body: {}, querySelector: selector => nodes[selector] ?? null, activeElement: nodes['#eliloPassword'] }, location: { href, origin: at.origin, pathname: at.pathname }, crypto: { subtle: globalThis.crypto.subtle } };
  try { return { result: { value: JSON.parse(JSON.stringify((await vm.runInNewContext('(' + source + ')', sandbox)(...args)) ?? null)) } }; }
  catch (error) { return { exceptionDetails: { text: 'Uncaught', exception: { description: String(error?.message) } } }; }
}
function fakeSignInPage(events, { refuse = false, devtools = 'ok', lost = () => false } = {}) {
  let url = 'about:blank', surface = 'blank', focused = null, pending = null, documentId = 0, world = null, later = null;
  const listeners = new Map(), frame = { url: () => url }, typed = {}, digests = [];
  const emit = (name, payload) => { for (const handler of [...(listeners.get(name) || [])]) handler(payload); };
  const exchange = (target, method, type, status, navigation = false, failure = null) => { const request = { url: () => target, method: () => method, resourceType: () => type, isNavigationRequest: () => navigation, frame: () => frame, failure: () => failure && { errorText: failure } }; emit('request', request); if (failure) emit('requestfailed', request); else emit('response', { request: () => request, status: () => status }); };
  const open = (target, kind) => { exchange(target, 'GET', 'document', 200, true); url = target; surface = kind; documentId++; emit('framenavigated', frame); emit('domcontentloaded'); emit('load'); };
  const gone = () => { if (lost()) throw new Error('Protocol error: Target closed.'); };
  return {
    label: 'amex-signin-page', url: () => url, mainFrame: () => frame,
    async goto(target) { gone(); events.push('goto'); open(target, 'login'); },
    async evaluate(fn, arg) {
      gone(); if (later) { const next = later; later = null; next(); }
      const src = String(fn);
      if (src.includes('alertdialog')) return { readyState: 'complete', visibility: 'visible', focused: true, fields: surface === 'login', userEmpty: false, passwordEmpty: false, submitEnabled: true, submitType: 'submit', alerts: 0, invalid: 0, dialogs: 0, frames: 0, busy: 0, challenge: false };
      if (src.includes('__react')) { const shape = { present: true, visible: true, enabled: true, editable: true, react: true }; return { readyState: 'interactive', visibility: 'visible', focused: true, user: shape, password: shape, submit: { present: true, visible: true, enabled: true, react: true, type: 'submit', form: true, sameForm: true } }; }
      if (src.includes('a[href*="/activity/statement"]')) return false;
      if (src.includes("'#loginSubmit'") && src.includes("'#eliloPassword'")) return surface === 'login';
      if (src.includes("'#question-input'") && src.includes('channels')) return surface === 'verify' ? { kind: 'channels', channels: [{ id: 'channel-mail', text: 'c***s@example.invalid', checked: false }] } : { kind: 'unknown' };
      if (src.includes('input.focus()')) { focused = arg.selector; return undefined; }
      if (src.includes('elementFromPoint')) { pending = arg.selector; return { x: 640, y: 450 }; }
      throw new Error('fake sign-in page: unrecognised evaluate');
    },
    keyboard: { async down() {}, async up() {}, async press() {}, async type(value) { gone(); typed[focused] = value; events.push('type'); } },
    mouse: {
      async click() {
        gone(); if (pending !== '#loginSubmit') throw new Error('fake sign-in page: unexpected click'); pending = null; events.push('submit');
        if (world?.installed && world.documentId === documentId) Object.assign(world.n, { clicks: 1, trusted: 1, buttonClicks: 1, submits: 1, prevented: 1, bubbled: 1 });
        later = () => { exchange(LOGIN_API, 'OPTIONS', 'other', null, false, 'net::ERR_FAILED'); exchange('https://www.americanexpress.com/omf-synthetic/logon?user=' + FICTIONAL_LOGIN.username, 'POST', 'fetch', 403); open(AMEX_VERIFY + '?token=' + FICTIONAL_LOGIN.password, 'verify'); };
      }
    },
    bringToFront: front(events, refuse),
    on(name, handler) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(handler); },
    off(name, handler) { listeners.get(name)?.delete(handler); },
    listeners: () => [...listeners.values()].reduce((n, set) => n + set.size, 0), digests,
    async devtools(method, params) {
      if (lost()) throw new Error('Protocol error: Session closed.');
      if (devtools === 'hang' && method === 'Runtime.callFunctionOn') return new Promise(() => {});
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'synthetic-main-frame' } } };
      if (method === 'Page.createIsolatedWorld') { world = { documentId, installed: false, n: null }; return { executionContextId: 41 }; }
      if (method !== 'Runtime.callFunctionOn') return {};
      if (!world || world.documentId !== documentId) throw new Error('Cannot find context with specified id');
      const src = params.functionDeclaration;
      if (src.includes('addEventListener')) { world.installed = true; world.n = { clicks: 0, trusted: 0, buttonClicks: 0, submits: 0, prevented: 0, bubbled: 0, invalid: 0 }; return { result: { value: true } }; }
      if (src.includes('activeElement')) { const answer = await inFakeWorld(src, (params.arguments || []).map(a => a.value), { values: typed, href: url }); for (const d of [answer.result?.value?.digests].flat()) if (typeof d === 'string') digests.push(d); return answer; }
      if (src.includes('t.remove()')) { world.installed = false; return { result: { value: true } }; }
      return { result: { value: world.installed ? { readable: true, ...world.n } : { readable: false } } };
    }
  };
}
test('Amex login trace (wrapper): the real sign-in is traced and, before the owned browser closes, the trace is stopped and written once to the private diagnostics — bound to the account and job, outside the outbox, never a login value', { skip: WINDOWS, timeout: 120000 }, async () => {
  const events = [], dir = await owned('trace-wrapper'), atClose = [], statuses = []; let page = null;
  const stand = recordingLaunch(() => (page = fakeSignInPage(events, { refuse: true })), { onClose: async () => { atClose.push({ files: await traceFiles(dir), listeners: page.listeners(), sessions: stand.record.pageSessions.map(s => s.detached) }); } });
  await withLaunch(stand.launch, () => assert.rejects(B.collectStatement(ACCOUNT, FICTIONAL_LOGIN, dir, async (state, text) => { statuses.push([state, text]); }, { batch: 'trace', reveal: async () => { stand.record.sequence.push('reveal'); throw new Error(PERSON_NEEDED); } }), new RegExp(PERSON_NEEDED)));
  assert.deepEqual([statuses.map(s => s[0]), events], [['running', 'verification_required'], ['goto', 'type', 'type', 'submit']], 'amex-trace:one-sign-in-unchanged ' + JSON.stringify({ statuses, events }));
  assert.equal(atClose.length, 1, 'amex-trace:closed-once');
  assert.ok(atClose[0].files.length === 1 && TRACE_NAME.test(atClose[0].files[0]), 'amex-trace:record-written-before-close ' + JSON.stringify(atClose));
  assert.deepEqual([atClose[0].listeners, atClose[0].sessions], [0, [0, 1]], 'amex-trace:stopped-before-close (listeners removed, trace session detached, rendering session kept) ' + JSON.stringify(atClose));
  const text = await readFile(path.join(traceDir(dir), atClose[0].files[0]), 'utf8'), record = JSON.parse(text), by = name => record.events.find(e => e.event === name);
  assert.deepEqual([Object.keys(record), record.schema, record.accountId, record.jobId, record.outcome, record.overflow, typeof record.at], [['schema', 'accountId', 'jobId', 'at', 'outcome', 'events', 'overflow'], 'amex-login-trace-1', ACCOUNT._id, ACCOUNT.jobId, 'failed', 0, 'string'], 'amex-trace:record-bound');
  const kinds = record.events.map(e => e.event);
  for (const name of ['open', 'open-end', 'state', 'fields', 'listen', 'filled', 'submitted', 'response', 'navigated', 'show', 'end']) assert.ok(kinds.includes(name), 'amex-trace:record-has ' + name + ' ' + JSON.stringify(kinds));
  assert.deepEqual([by('listen').native, by('filled').user.matches, by('filled').password.matches, by('submitted').native.submits, by('submitted').native.buttonClicks, by('end').reason, kinds.at(-1)], ['installed', true, true, 1, 1, 'stopped', 'end'], 'amex-trace:record-observations ' + JSON.stringify(record.events.filter(e => ['listen', 'filled', 'submitted', 'end'].includes(e.event))));
  assert.deepEqual(record.events.filter(e => e.event === 'response' && e.phase === 'after').map(e => [e.method, e.type, e.target, e.status]), [['POST', 'fetch', 'www', 403], ['GET', 'document', 'verify', 200]], 'amex-trace:record-responses');
  // network-fold-01: the failed preflight is an attempt to the login API that got no answer, the 403 another endpoint's; the comparison stayed
  // in this process (no DevTools call of the page's sessions carried the login or a digest of it), and the page's digests are in no record
  const api = record.events.filter(e => e.endpoint === 'login-api').map(e => [e.event, e.method, e.target, e.failure ?? null]), last = record.events.at(-1);
  assert.deepEqual([api, record.events.find(e => e.event === 'response' && e.status === 403)?.endpoint, last?.network?.after?.login], [[['request', 'OPTIONS', 'global', null], ['failed', 'OPTIONS', 'global', 'failed']], 'other', { options: { ...ZERO_CELL, sent: 1, failed: 1 }, post: ZERO_CELL, other: ZERO_CELL }], 'amex-trace:record-login-api ' + JSON.stringify({ api, login: last?.network?.after?.login }));
  assert.deepEqual(handedLogin(stand.record.pageSessions.flatMap(s => s.sent.map(([method, params]) => ({ method, params })))), [], 'amex-trace:record-no-secret-to-browser');
  assert.ok(page.digests.length === 2 && page.digests.every(d => /^[0-9a-f]{64}$/.test(d) && !text.includes(d.slice(0, 16))), 'amex-trace:record-digest-transient ' + page.digests.length);
  for (const leak of TRACE_LEAKS) assert.ok(!text.includes(leak), 'amex-trace:no-leak ' + leak);
  assert.deepEqual([existsSync(path.join(dir, 'outbox')), await readdir(path.join(dir, 'diagnostics'))], [false, ['amex']], 'amex-trace:outside-outbox');
  assert.deepEqual([stand.record.closed, existsSync(B.ephemeralProfile(dir, ACCOUNT.ownerId, 'amex', ACCOUNT._id, 'trace')), B.ownedBrowsers()], [1, false, []], 'amex-trace:closed');
});
test('Amex login trace (wrapper): a store that cannot be written, or an isolated world that never answers, changes neither the sign-in, the ending, the statuses nor the closure', { skip: WINDOWS, timeout: 120000 }, async () => {
  for (const [label, options, prepare] of [['store-refused', {}, dir => writeFile(path.join(dir, 'diagnostics'), 'not a directory')], ['world-hangs', { devtools: 'hang' }, async () => {}]]) {
    const events = [], dir = await owned('trace-' + label), statuses = []; await prepare(dir);
    const stand = recordingLaunch(() => fakeSignInPage(events, { refuse: true, ...options })), began = Date.now();
    const outcome = await withLaunch(stand.launch, () => B.collectStatement(ACCOUNT, FICTIONAL_LOGIN, dir, async state => { statuses.push(state); }, { batch: label, reveal: async () => { throw new Error(PERSON_NEEDED); } }).then(() => null, error => error));
    assert.deepEqual([outcome?.message, statuses, events], [PERSON_NEEDED, ['running', 'verification_required'], ['goto', 'type', 'type', 'submit']], 'amex-trace:best-effort-unchanged ' + label);
    assert.deepEqual([stand.record.closed, existsSync(B.ephemeralProfile(dir, ACCOUNT.ownerId, 'amex', ACCOUNT._id, label)), B.ownedBrowsers()], [1, false, []], 'amex-trace:best-effort-closed ' + label);
    assert.ok(Date.now() - began < 30000, 'amex-trace:best-effort-bounded ' + label + ' ' + (Date.now() - began) + ' ms');
    if (label === 'store-refused') assert.equal(await readFile(path.join(dir, 'diagnostics'), 'utf8'), 'not a directory', 'amex-trace:store-refused-nothing-written');
    else { const [file] = await traceFiles(dir); assert.ok(file, 'amex-trace:hang-recorded (no record)'); const record = JSON.parse(await readFile(path.join(traceDir(dir), file), 'utf8')); assert.deepEqual([record.events.find(e => e.event === 'listen')?.native, record.events.at(-1)?.event], ['unavailable', 'end'], 'amex-trace:hang-recorded'); }
  }
});
test('Amex login trace (wrapper): only the 20 newest records of the account are kept; other names and other accounts are untouched', { skip: WINDOWS, timeout: 120000 }, async () => {
  const dir = await owned('trace-retention'), mine = traceDir(dir), other = path.join(dir, 'diagnostics', 'amex', 'd4'.repeat(12));
  await mkdir(mine, { recursive: true }); await mkdir(other, { recursive: true });
  const old = Array.from({ length: 25 }, (_, i) => 'f'.repeat(8) + '-' + (1700000000000 + i) + '.json');
  for (const name of old) await writeFile(path.join(mine, name), '{}');
  await writeFile(path.join(mine, 'notes.txt'), 'kept'); for (let i = 0; i < 3; i++) await writeFile(path.join(other, 'job-' + (1700000000000 + i) + '.json'), '{}');
  const stand = recordingLaunch(() => fakeSignInPage([], { refuse: true }));
  await withLaunch(stand.launch, () => assert.rejects(B.collectStatement(ACCOUNT, {}, dir, async () => {}, { batch: 'retention', reveal: async () => { throw new Error(PERSON_NEEDED); } }), new RegExp(PERSON_NEEDED)));
  const left = (await readdir(mine)).sort(), fresh = left.filter(name => TRACE_NAME.test(name));
  assert.equal(fresh.length, 1, 'amex-trace:retention-new-record');
  assert.deepEqual(left, [...old.slice(6), fresh[0], 'notes.txt'].sort(), 'amex-trace:retention-20-newest ' + JSON.stringify(left));
  assert.deepEqual((await readdir(other)).sort(), ['job-1700000000000.json', 'job-1700000000001.json', 'job-1700000000002.json'], 'amex-trace:retention-other-account-untouched');
});
test('Amex login trace (wrapper): a cancellation — the owned browsers closed while the person is needed — ends the job with the unchanged error, and the trace is still stopped and written', { skip: WINDOWS, timeout: 120000 }, async () => {
  const events = [], dir = await owned('trace-cancel'); let page = null;
  const stand = recordingLaunch(() => (page = fakeSignInPage(events, { refuse: true, lost: () => stand.record.closed > 0 })));
  await withLaunch(stand.launch, () => assert.rejects(B.collectStatement(ACCOUNT, FICTIONAL_LOGIN, dir, async () => {}, { batch: 'cancel', reveal: async () => { await B.closeOwnedBrowsers(); } }), /Target closed/));
  const [file] = await traceFiles(dir); assert.ok(file, 'amex-trace:cancel-stopped-and-written (no record)');
  const record = JSON.parse(await readFile(path.join(traceDir(dir), file), 'utf8'));
  assert.deepEqual([record.outcome, record.events.at(-1)?.event, record.events.at(-1)?.reason, page.listeners()], ['failed', 'end', 'stopped', 0], 'amex-trace:cancel-stopped-and-written');
  assert.deepEqual([stand.record.closed, existsSync(B.ephemeralProfile(dir, ACCOUNT.ownerId, 'amex', ACCOUNT._id, 'cancel')), B.ownedBrowsers()], [1, false, []], 'amex-trace:cancel-closed');
});
test('Amex login trace (wrapper): only the Amex wrapper writes it — the Aplus wrapper leaves no diagnostics', { skip: WINDOWS, timeout: 120000 }, async () => {
  const stand = recordingLaunch(() => fakeAplusPage([], { refuse: true })), dir = await owned('trace-aplus');
  await withLaunch(stand.launch, () => assert.rejects(B.collectAplusStatement(APLUS_ACCOUNT, {}, dir, async () => {}, { batch: 'bg', reveal: async () => { throw new Error(PERSON_NEEDED); } }), new RegExp(PERSON_NEEDED)));
  assert.equal(existsSync(path.join(dir, 'diagnostics')), false, 'amex-trace:aplus-untouched');
});

// ═══ Part B: real stock Chrome (OMF_CARD_NATIVE=1) ════════════════════════════════════════════════════════════════════════════════
async function powershell(script) { const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 }); return stdout.trim(); }
const commandLineOf = pid => powershell(`(Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}").CommandLine`);
// Read-only window facts of one process: the foreground window's process, the virtual screen and that process's visible top-level
// windows. Nothing here moves or activates a window.
async function windowFacts(pid) {
  return JSON.parse(await powershell(`Add-Type -TypeDefinition @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class OmfCardBg {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public static string Facts(uint want) {
    var list = new List<string>(); EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == want && IsWindowVisible(h)) { RECT r; GetWindowRect(h, out r); var c = new StringBuilder(256); GetClassName(h, c, 256); list.Add(string.Format("{{\\"cls\\":\\"{0}\\",\\"iconic\\":{1},\\"rect\\":[{2},{3},{4},{5}]}}", c, IsIconic(h) ? "true" : "false", r.L, r.T, r.R, r.B)); } return true; }, IntPtr.Zero);
    uint fp; GetWindowThreadProcessId(GetForegroundWindow(), out fp);
    int x = GetSystemMetrics(76), y = GetSystemMetrics(77);
    return string.Format("{{\\"foregroundPid\\":{0},\\"screen\\":[{1},{2},{3},{4}],\\"windows\\":[{5}]}}", fp, x, y, x + GetSystemMetrics(78), y + GetSystemMetrics(79), string.Join(",", list));
  }
}
'@
[OmfCardBg]::Facts(${Number(pid)})`));
}
const intersects = (r, s) => r[0] < s[2] && r[2] > s[0] && r[1] < s[3] && r[3] > s[1];
const onScreen = facts => facts.windows.filter(w => w.cls === 'Chrome_WidgetWin_1' && !w.iconic && intersects(w.rect, facts.screen) && w.rect[2] - w.rect[0] > 200 && w.rect[3] - w.rect[1] > 200);
const minimized = facts => facts.windows.some(w => w.cls === 'Chrome_WidgetWin_1' && w.iconic);
// A passive, read-only recorder of ONE owned process's window events for a whole native run (sampling alone could miss a short
// foreground): out-of-context WinEvent hooks for foreground changes (another process's foreground is kept only as the bare fact, without
// identity), minimize start/end, show/hide and moves of the owned process's top-level windows, plus a 250 ms sample of whether the
// foreground window is owned and whether the system foreground lock is open (the user idle longer than its timeout: an activation
// would then succeed). Nothing is moved, shown or activated and no input is sent.
const RECORDER = `using System; using System.IO; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class OmfCardFocus {
  delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc proc, uint pid, uint tid, uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action, uint param, ref uint value, uint ini);
  [DllImport("user32.dll")] static extern bool PeekMessage(out MSG m, IntPtr h, uint a, uint b, uint remove);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG m);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG m);
  [DllImport("user32.dll")] static extern uint MsgWaitForMultipleObjectsEx(uint n, IntPtr handles, uint ms, uint mask, uint flags);
  static readonly string Q = ((char)34).ToString();
  static StreamWriter w; static uint owned; static WinEventProc keep;
  static string Now() { return ((long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds).ToString(); }
  static string P(string k, string v) { return Q + k + Q + ":" + v; }
  static string S(string v) { return Q + v.Replace(Q, "").Replace("\\\\", "") + Q; }
  static string B(bool v) { return v ? "true" : "false"; }
  static void Line(List<string> parts) { w.WriteLine("{" + string.Join(",", parts) + "}"); }
  static void Window(List<string> parts, IntPtr h) {
    RECT r; GetWindowRect(h, out r); var c = new StringBuilder(64); GetClassName(h, c, 64);
    int x = GetSystemMetrics(76), y = GetSystemMetrics(77), right = x + GetSystemMetrics(78), bottom = y + GetSystemMetrics(79);
    parts.Add(P("cls", S(c.ToString()))); parts.Add(P("iconic", B(IsIconic(h)))); parts.Add(P("onScreen", B(r.L < right && r.R > x && r.T < bottom && r.B > y))); parts.Add(P("rect", "[" + r.L + "," + r.T + "," + r.R + "," + r.B + "]"));
  }
  static void OnEvent(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time) {
    if (hwnd == IntPtr.Zero) return;
    uint pid; GetWindowThreadProcessId(hwnd, out pid);
    var parts = new List<string> { P("t", Now()) };
    if (ev == 0x3) { if (pid != owned) { parts.Add(P("ev", S("foreground-other"))); Line(parts); return; } parts.Add(P("ev", S("foreground"))); Window(parts, hwnd); Line(parts); return; }
    if (pid != owned || idObject != 0 || idChild != 0 || GetAncestor(hwnd, 2) != hwnd) return;
    parts.Add(P("ev", S(ev == 0x16 ? "minimizestart" : ev == 0x17 ? "minimizeend" : ev == 0x8002 ? "show" : ev == 0x8003 ? "hide" : "location"))); parts.Add(P("hwnd", S(hwnd.ToInt64().ToString("x")))); Window(parts, hwnd); Line(parts);
  }
  public static void Run(int ownedPid, string outFile, string stopFile, int maxMs) {
    owned = (uint)ownedPid; w = new StreamWriter(outFile, false, new UTF8Encoding(false)); w.AutoFlush = true; keep = OnEvent;
    uint lockMs = 0; SystemParametersInfo(0x2000, 0, ref lockMs, 0);
    IntPtr[] hooks = { SetWinEventHook(0x3, 0x3, IntPtr.Zero, keep, 0, 0, 2), SetWinEventHook(0x16, 0x17, IntPtr.Zero, keep, owned, 0, 2), SetWinEventHook(0x8002, 0x8003, IntPtr.Zero, keep, owned, 0, 2), SetWinEventHook(0x800B, 0x800B, IntPtr.Zero, keep, owned, 0, 2) };
    int n = 0; foreach (var h in hooks) if (h != IntPtr.Zero) n++;
    Line(new List<string> { P("t", Now()), P("ev", S("ready")), P("hooks", n.ToString()), P("lockTimeoutMs", lockMs.ToString()) });
    var started = DateTime.UtcNow; var last = DateTime.MinValue;
    try {
      while (true) {
        MsgWaitForMultipleObjectsEx(0, IntPtr.Zero, 50, 0x04FF, 0x4);
        MSG m; while (PeekMessage(out m, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref m); DispatchMessage(ref m); }
        if ((DateTime.UtcNow - last).TotalMilliseconds >= 250) {
          last = DateTime.UtcNow; uint fp; GetWindowThreadProcessId(GetForegroundWindow(), out fp);
          var li = new LASTINPUTINFO(); li.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO)); GetLastInputInfo(ref li);
          Line(new List<string> { P("t", Now()), P("ev", S("sample")), P("fgOwned", B(fp == owned)), P("lockOpen", B(unchecked((uint)Environment.TickCount - li.dwTime) >= lockMs)) });
        }
        if (File.Exists(stopFile) || (DateTime.UtcNow - started).TotalMilliseconds > maxMs) break;
      }
    } finally { foreach (var h in hooks) if (h != IntPtr.Zero) UnhookWinEvent(h); Line(new List<string> { P("t", Now()), P("ev", S("stopped")) }); w.Close(); }
  }
}`;
async function watchWindows(pid) {
  const dir = await owned('windows'), out = path.join(dir, 'events.jsonl'), stop = path.join(dir, 'stop'), literal = s => "'" + s.replaceAll("'", "''") + "'";
  const script = `Add-Type -TypeDefinition @'\n${RECORDER}\n'@\n[OmfCardFocus]::Run(${Number(pid)}, ${literal(out)}, ${literal(stop)}, 900000)`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' });
  const read = async () => { try { return (await readFile(out, 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); } catch { return []; } };
  for (let i = 0; i < 300 && child.exitCode === null && !(await read()).some(e => e.ev === 'ready'); i++) await new Promise(r => setTimeout(r, 100));
  const recorder = { async stop() { await writeFile(stop, 'stop').catch(() => {}); if (child.exitCode === null) await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 10000))]); if (child.exitCode === null) child.kill(); return read(); } };
  recorders.push(recorder); return recorder;
}
// The continuous no-focus evidence of one native run, read after its Chrome is gone: the owned Chrome never had the foreground (no
// foreground event, no owned sample), its window was minimized once created and never restored, and no window of it was shown on screen
// after that. The one show at Chrome's default bounds before Target.createTarget applies the off-screen bounds and the minimize is
// Chrome's own creation order (unchanged by the repair): measured and reported, not asserted.
async function assertNoFocus(seen, label) {
  const events = await seen.windows.stop(), ready = events.find(e => e.ev === 'ready'), samples = events.filter(e => e.ev === 'sample');
  assert.equal(ready?.hooks, 4, 'card-background:native-recorder-ready ' + label);
  assert.deepEqual(events.filter(e => e.ev === 'foreground' || (e.ev === 'sample' && e.fgOwned)), [], 'card-background:native-never-foreground ' + label);
  const at = events.findIndex(e => e.ev === 'minimizestart');
  assert.ok(at >= 0, 'card-background:native-minimized ' + label + ' ' + JSON.stringify(events.filter(e => e.ev !== 'sample')));
  assert.deepEqual(events.filter(e => e.ev === 'minimizeend'), [], 'card-background:native-never-restored ' + label);
  assert.deepEqual(events.slice(at).filter(e => ['show', 'location', 'foreground'].includes(e.ev) && e.onScreen && !e.iconic), [], 'card-background:native-never-on-screen-after-minimize ' + label);
  const shown = events.find(e => e.ev === 'show' && e.onScreen);
  return { creationShownMs: shown ? events[at].t - shown.t : null, samples: samples.length, lockOpen: samples.filter(s => s.lockOpen).length, otherForeground: events.filter(e => e.ev === 'foreground-other').length };
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const waitGone = async pid => { for (let i = 0; i < 40 && alive(pid); i++) await new Promise(r => setTimeout(r, 200)); return !alive(pid); };
// The synthetic issuer pages; every other page request is aborted (counted).
const SYNTHETIC = {
  [AMEX_LOGIN]: { body: '<!doctype html><title>Synthetic Amex login</title><input id="eliloUserID"><input id="eliloPassword" type="password"><button id="loginSubmit">ログイン</button>' },
  [APLUS + '/']: { redirect: APLUS + '/login/id/input' },
  [APLUS + '/login/id/input']: { body: '<!doctype html><title>Synthetic My APLUS login</title><input id="elem1-1"><input id="elem1-2" type="password"><button>ログイン</button>' }
};
// Answers every page request of `page` from `site` (synthetic HTML or a redirect) or aborts it (counted).
async function serve(page, site, seen) {
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url()), key = url.origin + url.pathname, synthetic = site[key];
    if (url.protocol === 'about:' || url.protocol === 'data:' || url.protocol === 'blob:') return request.continue();
    if (!synthetic) { seen.aborted.push(url.origin); return request.abort(); }
    seen.fulfilled.push(key); synthetic.seen?.(url);
    if (synthetic.redirect) return request.respond({ status: 302, headers: { location: synthetic.redirect }, body: '' });
    return request.respond({ status: synthetic.status ?? 200, contentType: 'text/html; charset=utf-8', body: synthetic.body });
  });
}
function nativeOnLaunch(seen, site = SYNTHETIC) {
  return async ({ pid, browser }) => {
    seen.pid = pid; seen.command = await commandLineOf(pid); seen.windows = await watchWindows(pid); // ready before the page's window exists
    const open = browser.newPage.bind(browser);
    browser.newPage = async () => { const page = await open(); await serve(page, site, seen); return page; };
  };
}
// ── rendering of the minimized card page (case omf-card-rendering-20261031) ──────────────────────────────────────────────────────────
// The animation frames the page itself runs within `ms`, and its visibility then. A hidden page runs none. Frames progressing is the claim,
// not a display rate: on the minimized card page Chrome 155 ran ~85 frames a second while nothing on the page changed but about one a
// second while the page animated, in headless and headed Chrome alike (measured 2026-10-31 on this real background page; a normal
// window rendered the same animation at full rate), so two frames within four seconds is the bound.
const framesWithin = (page, ms = 4000) => page.evaluate(ms => new Promise(resolve => { let frames = 0, done = false; requestAnimationFrame(function tick() { if (done) return; frames++; requestAnimationFrame(tick); }); setTimeout(() => { done = true; resolve({ visibility: document.visibilityState, frames }); }, ms); }), ms);
const rendering = sample => sample.visibility === 'visible' && sample.frames >= 2;
// A next state that needs rendering (synthetic, the card rendering case): `chain` starts a CSS transition in an animation frame; its end
// arms an IntersectionObserver whose observation calls `then`. A hidden page runs no frame, so it never gets there. window.__omfRender
// keeps what happened (frames, transitionEnded, intersected) for the assertion messages.
const RENDER_STYLE = '#panel{opacity:0;transition:opacity 80ms linear}#panel.shown{opacity:1}#marker{height:40px}';
const renderScript = body => 'window.__omfRender={frames:0,transitionEnded:false,intersected:false};requestAnimationFrame(function tick(){window.__omfRender.frames++;requestAnimationFrame(tick);});'
  + 'const chain=then=>requestAnimationFrame(()=>{const panel=document.getElementById("panel");panel.addEventListener("transitionend",()=>{window.__omfRender.transitionEnded=true;new IntersectionObserver((entries,observer)=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();window.__omfRender.intersected=true;then();}}).observe(document.getElementById("marker"));},{once:true});panel.classList.add("shown");});' + body;
const renderPage = (title, controls, body) => '<!doctype html><html lang="ja"><meta charset="utf-8"><title>' + title + '</title><style>' + RENDER_STYLE + '</style><body>' + controls + '<div id="panel">Synthetic panel</div><div id="marker"></div><script>' + renderScript(body) + '</script></body></html>';
// Two sites: on A the button leads on (to NEXT, same site) only through that chain; NEXT and B run the chain when they load.
const RENDER_A = 'https://www.americanexpress.com/omf-synthetic/render', RENDER_NEXT = 'https://www.americanexpress.com/omf-synthetic/next', RENDER_B = 'https://myaplus.aplus.co.jp/omf-synthetic/render';
const RENDER_SITE = {
  [RENDER_A]: { body: renderPage('Synthetic render A', '<button id="go">次へ</button>', 'document.getElementById("go").onclick=()=>chain(()=>{location.href=' + JSON.stringify(RENDER_NEXT) + ';});') },
  [RENDER_NEXT]: { body: renderPage('Synthetic render next', '', 'chain(()=>{});') },
  [RENDER_B]: { body: renderPage('Synthetic render B (another site)', '', 'chain(()=>{});') }
};
// The Amex sign-in on a login page whose submit needs rendering: both fields filled, ログイン starts the chain and only its end opens the
// verification page (one masked e-mail channel: without a saved mailbox the person is asked there). Synthetic: it shows the minimized page
// now reaches a next state that needs rendering; it is NOT a copy of the real issuer page and says nothing about why the real first
// sign-ins stayed on the login page.
const AMEX_VERIFY = 'https://www.americanexpress.com/ja-jp/account/reauth/verify';
const AMEX_RENDER_SITE = {
  [AMEX_LOGIN]: { body: renderPage('Synthetic Amex login', '<input id="eliloUserID"><input id="eliloPassword" type="password"><button id="loginSubmit">ログイン</button>', 'document.getElementById("loginSubmit").onclick=()=>{if(!document.getElementById("eliloUserID").value||!document.getElementById("eliloPassword").value)return;chain(()=>{location.href=' + JSON.stringify(AMEX_VERIFY) + ';});};') },
  [AMEX_VERIFY]: { body: '<!doctype html><html lang="ja"><meta charset="utf-8"><title>Synthetic Amex verification</title><body><label for="channel-mail">s*****@example.invalid</label><input type="radio" id="channel-mail" name="channel"><button>次へ</button></body></html>' }
};
// A synthetic My APLUS on the issuer's origin for the REAL aplusUi (collector/aplus.mjs): signed in at /, the statement page of 2026/09
// (2,400円, card -1234) with 保存 → CSV, the statement-code page, a CSV download after the code, and the unbilled page (1 row, 1,200円).
// The code page returns to the statement page with the typed code, which is recorded from that intercepted navigation; the page then
// downloads the CSV from a blob it makes itself (as aplus-readiness.mjs does), so no download request can leave the browser. The 保存 menu
// shows its CSV link in the next animation frame (case omf-card-rendering-20261031: a next state that needs rendering; synthetic, not
// the issuer's own code), so a hidden page never reaches the statement code.
function aplusSite(record) {
  const html = (title, body) => '<!doctype html><html lang="ja"><meta charset="utf-8"><title>' + title + '</title><body>' + body + '</body></html>';
  const csv = JSON.stringify(aplusCsv().toString('utf8'));
  const details = html('Synthetic statement', '<button>Synthetic カード ****-1234</button><div class="m-navDate"><button class="m-navDate__chooseButton">2026/09</button><select class="m-navDate__chooseSelect"><option value="2026/09" selected>2026/09</option></select><div class="m-navDate__next"><a href="/cards/billing/unbilled">2026/10以降</a></div></div><div class="m-particularsOverview"><p>お支払い金額</p><p class="m-particularsOverview__price">2,400円</p><p>確定</p></div><button id="save">保存</button> <a id="csv" href="#" style="display:none">CSV</a>'
    + '<script>document.getElementById("save").onclick=()=>{requestAnimationFrame(()=>{document.getElementById("csv").style.display="inline"})};document.getElementById("csv").onclick=e=>{e.preventDefault();location.href="/authentication/otp/sms"};const code=new URLSearchParams(location.search).get("download");if(code){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([' + csv + '],{type:"text/csv"}));a.download="aplus_meisai.csv";document.body.append(a);a.click();}</script>');
  return {
    [APLUS + '/']: { body: html('Synthetic My APLUS', '<a href="/logout">ログアウト</a><nav><span>利用明細・利用可能額</span> <a href="/cards/billing/details">明細</a></nav>') },
    [APLUS + '/cards/billing/details']: { body: details, seen: url => { const code = url.searchParams.get('download'); if (code !== null) record.codes.push(code); } },
    [APLUS + '/authentication/otp/sms']: { body: html('Synthetic statement code', '<input id="elem1-1"><button id="go">認証する</button><script>document.getElementById("go").onclick=()=>{location.href="/cards/billing/details?download="+encodeURIComponent(document.getElementById("elem1-1").value)};</script>') },
    [APLUS + '/cards/billing/unbilled']: { body: html('Synthetic unbilled', '<div class="m-particularsOverview"><p>未請求のご利用金額</p><p>未確定</p><p>1,200円</p></div><ul><li class="m-listDetails__item"><p class="m-listDetails__name">Synthetic shop</p><p class="m-listDetails__date">26.09.15 1回払い</p><p class="m-listDetails__value">1,200円</p><ul class="m-listDetails__info"><li><span class="m-listDetails__infoTtl">カード番号下4桁</span><span class="m-listDetails__infoVal">1234</span></li><li><span class="m-listDetails__infoTtl">売上種別</span><span class="m-listDetails__infoVal">ショッピング</span></li><li><span class="m-listDetails__infoTtl">初回年月</span><span class="m-listDetails__infoVal">26/10</span></li></ul></li></ul>') }
  };
}
const NATIVE = WINDOWS || (process.env.OMF_CARD_NATIVE === '1' ? false : 'native Chrome legs: set OMF_CARD_NATIVE=1 (the fixture runs them serialized with the other Chrome suites)');
for (const [lane, run, fulfilledKey, profileOf] of [
  ['Amex', (dir, options) => B.collectStatement(ACCOUNT, {}, dir, async () => {}, { batch: 'native', ...options }), AMEX_LOGIN, dir => B.ephemeralProfile(dir, ACCOUNT.ownerId, 'amex', ACCOUNT._id, 'native')],
  ['Aplus', (dir, options) => B.collectAplusStatement(APLUS_ACCOUNT, {}, dir, async () => {}, { batch: 'native', ...options }), APLUS + '/login/id/input', dir => B.ephemeralProfile(dir, APLUS_ACCOUNT.ownerId, 'aplus', APLUS_ACCOUNT._id, 'native')]
]) {
  test(`native ${lane}: real background Chrome on synthetic pages — no startup page, minimized off-screen inactive window whose page keeps rendering, foreground kept, attention routed to the same page, no issuer request, closed and removed`, { skip: NATIVE, timeout: 240000 }, async t => {
    const dir = await owned('native-' + lane.toLowerCase()), seen = { fulfilled: [], aborted: [] }, facts = [];
    await assert.rejects(run(dir, { onLaunch: nativeOnLaunch(seen), reveal: async page => { facts.push({ url: page.url(), facts: await windowFacts(seen.pid), rendering: await framesWithin(page) }); throw new Error(PERSON_NEEDED); } }), new RegExp(PERSON_NEEDED));
    assert.ok(seen.command.includes('--no-startup-window') && seen.command.includes('--remote-debugging-pipe') && !seen.command.includes('--headless'), 'card-background:native-flags ' + seen.command.slice(0, 300));
    for (const flag of ['--no-sandbox', '--disable-web-security', '--remote-debugging-port']) assert.ok(!seen.command.includes(flag), 'card-background:native-forbidden ' + flag);
    assert.equal(facts.length, 1, 'card-reveal:native-attention-once');
    const [{ url, facts: at, rendering: sample }] = facts;
    assert.ok(url.startsWith(fulfilledKey), 'card-reveal:native-same-page ' + url);
    assert.notEqual(at.foregroundPid, seen.pid, 'card-background:native-foreground-kept');
    assert.deepEqual(onScreen(at), [], 'card-background:native-offscreen ' + JSON.stringify(at.windows));
    assert.ok(minimized(at), 'card-background:native-minimized-at-attention ' + JSON.stringify(at.windows));
    assert.ok(rendering(sample), `card-rendering:native-${lane.toLowerCase()}-rendering-at-attention ` + JSON.stringify(sample));
    assert.ok(seen.fulfilled.includes(fulfilledKey), 'synthetic page served ' + JSON.stringify(seen));
    assert.ok(await waitGone(seen.pid), 'card-background:native-closed'); assert.equal(existsSync(profileOf(dir)), false, 'card-background:native-profile-removed');
    assert.deepEqual(B.ownedBrowsers(), []);
    t.diagnostic('window events ' + lane + ': ' + JSON.stringify(await assertNoFocus(seen, lane)) + '; frames in 4 s at attention ' + sample.frames);
  });
}
// P4/P4b natively: the real aplusUi through statement, code and unbilled capture in the background wrapper. `person`: the recording reveal
// then plays the person on the page itself (DOM value + click through DevTools; no OS input, the window is never actually shown). The
// timeline holds every job status and reveal in order; `attention` keeps the statement-code ones (auto = the running progress text,
// ask:<text> = verification_required, reveal).
async function nativeAplus(label, { codeSource = null, person = false, signal = null } = {}) {
  const dir = await owned('native-aplus-' + label), seen = { fulfilled: [], aborted: [], codes: [] }, revealed = [], timeline = [], account = { ...APLUS_ACCOUNT, jobId: randomUUID() };
  const source = typeof codeSource === 'function' ? codeSource(seen) : codeSource;
  const result = await B.collectAplusStatement(account, {}, dir, async (state, text) => { timeline.push(['status', state, text]); }, { batch: label, origin: 'https://omf.example.invalid', covered: [], jobId: account.jobId, codeSource: source, signal, onLaunch: nativeOnLaunch(seen, aplusSite(seen)),
    reveal: async page => { timeline.push(['reveal']); revealed.push({ url: page.url(), facts: await windowFacts(seen.pid) }); if (person) await page.evaluate(code => { document.getElementById('elem1-1').value = code; setTimeout(() => document.getElementById('go').click(), 0); }, '4821'); } }).then(r => r, error => ({ error }));
  assert.ok(await waitGone(seen.pid), 'card-background:native-aplus-closed'); assert.deepEqual(B.ownedBrowsers(), []);
  assert.equal(existsSync(B.ephemeralProfile(dir, account.ownerId, 'aplus', account._id, label)), false, 'card-background:native-aplus-profile-removed');
  return { result, revealed, seen, timeline, focus: await assertNoFocus(seen, 'aplus-' + label) };
}
const attention = timeline => timeline.filter(e => e[0] === 'reveal' || e[1] === 'verification_required' || e[2] === AUTO_TEXT).map(e => e[0] === 'reveal' ? 'reveal' : e[2] === AUTO_TEXT ? 'auto' : 'ask:' + e[2]);
test('native Aplus statement code read automatically: the real page completes statement and unbilled capture with the window never revealed and the person never asked (P4, P4b)', { skip: NATIVE, timeout: 300000 }, async t => {
  const claims = [], during = [];
  const { result, revealed, seen, timeline, focus } = await nativeAplus('auto', { codeSource: owned => ({ async messages({ requestedAt }) { during.push({ pid: owned.pid, facts: await windowFacts(owned.pid) }); return [SMS('src:native', requestedAt, '2468')]; }, async claim(id) { claims.push(id); } }) });
  assert.equal(result.items?.length, 1, 'statement collected ' + JSON.stringify(result.failed ?? result.error?.message)); assert.ok(result.pending, 'unbilled captured');
  assert.deepEqual(revealed, [], 'card-reveal:native-auto-code-hidden ' + JSON.stringify(revealed.map(r => r.url)));
  assert.deepEqual(attention(timeline), ['auto'], 'card-reveal:native-auto-no-person-state ' + JSON.stringify(timeline));
  assert.deepEqual([seen.codes, claims], [['2468'], ['src:native']], 'the automatic code was typed once');
  assert.ok(during.length >= 1, 'window facts sampled while the code was read');
  for (const { pid, facts } of during) { assert.notEqual(facts.foregroundPid, pid, 'card-background:native-aplus-foreground-kept'); assert.deepEqual(onScreen(facts), [], 'card-background:native-aplus-offscreen'); assert.ok(minimized(facts), 'card-background:native-aplus-minimized ' + JSON.stringify(facts.windows)); }
  t.diagnostic('window events aplus-auto: ' + JSON.stringify(focus));
});
test('native Aplus without a code source, or with a failing reader: the person is asked, then the window is revealed exactly once, on the code page, and the person completes it (P4, P4b controls)', { skip: NATIVE, timeout: 300000 }, async t => {
  const none = await nativeAplus('manual', { person: true });
  assert.equal(none.revealed.length, 1, 'card-reveal:native-no-source-shown-once'); assert.ok(none.revealed[0].url.endsWith('/authentication/otp/sms'), 'revealed on the code page ' + none.revealed[0].url);
  assert.deepEqual(attention(none.timeline), ['ask:' + ASK_TEXT, 'reveal'], 'card-reveal:native-manual-asks-person-once ' + JSON.stringify(none.timeline));
  assert.deepEqual([none.result.items?.length, !!none.result.pending, none.seen.codes], [1, true, ['4821']], 'completed ' + (none.result.error?.message || ''));
  let reads = 0;
  const failing = await nativeAplus('failing', { person: true, codeSource: { async messages() { reads++; throw new Error('adb: device unauthorized'); }, async claim() { throw new Error('never'); } } });
  assert.equal(failing.revealed.length, 1, 'card-reveal:native-reader-failure-shown-once'); assert.ok(reads >= 1); assert.deepEqual([failing.result.items?.length, failing.seen.codes], [1, ['4821']], 'completed ' + (failing.result.error?.message || ''));
  assert.deepEqual(attention(failing.timeline), ['auto', 'ask:' + ASK_TEXT, 'reveal'], 'card-reveal:native-failing-asks-after-progress ' + JSON.stringify(failing.timeline));
  for (const r of [...none.revealed, ...failing.revealed]) { assert.deepEqual(onScreen(r.facts), [], 'the recording reveal never moved the window'); assert.ok(minimized(r.facts), 'card-background:native-minimized-at-attention ' + JSON.stringify(r.facts.windows)); }
  t.diagnostic('window events aplus-manual/failing: ' + JSON.stringify([none.focus, failing.focus]));
});
test('native Aplus cancellation while the code is read: the job ends cancelled, the person is never asked and nothing is revealed; Chrome and profile removed (P4b)', { skip: NATIVE, timeout: 240000 }, async t => {
  const controller = new AbortController();
  const { result, revealed, timeline, focus } = await nativeAplus('abort', { signal: controller.signal, codeSource: { async messages() { controller.abort(); return []; }, async claim() { throw new Error('never'); } } });
  assert.equal(result.error?.name, 'AbortError', 'cancelled ' + (result.error?.message || JSON.stringify(result)));
  assert.deepEqual([attention(timeline), revealed.length], [['auto'], 0], 'card-reveal:native-abort-neither ' + JSON.stringify(timeline));
  t.diagnostic('window events aplus-abort: ' + JSON.stringify(focus));
});
test('native session loss: closing the owned browsers while the person is needed ends the job; no Chrome or profile is left', { skip: NATIVE, timeout: 240000 }, async t => {
  const dir = await owned('native-loss'), seen = { fulfilled: [], aborted: [] };
  await assert.rejects(B.collectAplusStatement(APLUS_ACCOUNT, {}, dir, async () => {}, { batch: 'loss', onLaunch: nativeOnLaunch(seen), reveal: async () => { await B.closeOwnedBrowsers(); } }));
  assert.ok(await waitGone(seen.pid), 'card-background:native-loss-closed');
  assert.equal(existsSync(B.ephemeralProfile(dir, APLUS_ACCOUNT.ownerId, 'aplus', APLUS_ACCOUNT._id, 'loss')), false, 'card-background:native-loss-profile');
  assert.deepEqual(B.ownedBrowsers(), []);
  t.diagnostic('window events session-loss: ' + JSON.stringify(await assertNoFocus(seen, 'session-loss')));
});
// The minimized card page natively (case omf-card-rendering-20261031), with the REAL browserFor/backgroundPage of the card wrappers
// (background, minimized) in headed Chrome: the collector's own DevTools input (interaction.mjs click) presses the button of a synthetic
// page that leads on only through an animation frame, a CSS transition and an IntersectionObserver; the next document, a cross-site
// document after it and the window state are read while the passive recorder runs. The window is never shown, restored or moved.
test('native card rendering: the real minimized background page keeps rendering in headed Chrome — a next state that needs animation frames, a CSS transition and an IntersectionObserver is reached, also after a cross-site navigation, while the window stays minimized off-screen, never restored or foreground; closed and removed', { skip: NATIVE, timeout: 240000 }, async t => {
  const dir = await owned('native-rendering'), profile = B.ephemeralProfile(dir, ACCOUNT.ownerId, 'rendering', ACCOUNT._id, 'native'), seen = { fulfilled: [], aborted: [] }, cadence = {};
  const browser = await B.browserFor(profile, { ephemeral: true, root: dir, background: true, minimized: true, onLaunch: nativeOnLaunch(seen, RENDER_SITE) });
  try {
    const page = await browser.newPage(), windows = await page.createCDPSession();
    const read = async () => ({ url: page.url(), state: await page.evaluate(() => ({ visibility: document.visibilityState, ...window.__omfRender })).catch(error => ({ error: error.message })), windowState: (await windows.send('Browser.getWindowForTarget')).bounds.windowState, facts: await windowFacts(seen.pid) });
    const physical = at => at.windowState === 'minimized' && minimized(at.facts) && onScreen(at.facts).length === 0 && at.facts.foregroundPid !== seen.pid;
    const settled = () => poll(() => page.evaluate(() => !!(window.__omfRender?.transitionEnded && window.__omfRender.intersected)), 20000);
    await page.goto(RENDER_A, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await click(page, '#go', null, new URL(RENDER_A).origin, new URL(RENDER_A).pathname, 'Synthetic');
    const reached = await poll(async () => page.url() === RENDER_NEXT && await settled(), 20000), next = await read();
    assert.ok(reached, 'card-rendering:native-next-state ' + JSON.stringify(next));
    const nextFrames = await framesWithin(page); cadence.next = nextFrames.frames;
    assert.ok(rendering(nextFrames), 'card-rendering:native-visible-while-minimized ' + JSON.stringify(nextFrames));
    assert.ok(physical(next), 'card-rendering:native-minimized-offscreen-background ' + JSON.stringify(next));
    await page.goto(RENDER_B, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const crossed = await settled(), other = await read(), otherFrames = await framesWithin(page); cadence.crossSite = otherFrames.frames;
    assert.ok(crossed && rendering(otherFrames), 'card-rendering:native-cross-site-navigation-keeps-rendering ' + JSON.stringify({ other, otherFrames }));
    assert.ok(physical(other), 'card-rendering:native-minimized-offscreen-background ' + JSON.stringify(other));
    await windows.detach().catch(() => {});
  } finally { await B.closeOwnedBrowsers(); }
  assert.ok(await waitGone(seen.pid), 'card-rendering:native-closed'); assert.equal(existsSync(profile), false, 'card-rendering:native-profile-removed'); assert.deepEqual(B.ownedBrowsers(), []);
  assert.deepEqual([...new Set(seen.fulfilled)].sort(), [RENDER_A, RENDER_B, RENDER_NEXT].sort(), 'only the synthetic pages were served ' + JSON.stringify(seen));
  t.diagnostic('window events rendering: ' + JSON.stringify(await assertNoFocus(seen, 'rendering')) + '; frames in 4 s ' + JSON.stringify(cadence));
});
// The real Amex wrapper signs in with a FICTIONAL login on the synthetic login page whose submit needs rendering (AMEX_RENDER_SITE):
// typed and pressed once through DevTools, the minimized page reaches the verification page, where the person would be asked.
test('native Amex sign-in on a login page whose next state needs rendering: the real wrapper types the fictional login through DevTools and presses ログイン once; the minimized page reaches the verification page, where the person would be asked; never restored or foreground; closed and removed', { skip: NATIVE, timeout: 300000 }, async t => {
  const dir = await owned('native-amex-signin'), seen = { fulfilled: [], aborted: [] }, statuses = [], facts = [];
  await assert.rejects(B.collectStatement(ACCOUNT, FICTIONAL_LOGIN, dir, async (state, text) => { statuses.push([state, text]); }, { batch: 'signin', onLaunch: nativeOnLaunch(seen, AMEX_RENDER_SITE), reveal: async page => { facts.push({ url: page.url(), facts: await windowFacts(seen.pid), rendering: await framesWithin(page) }); throw new Error(PERSON_NEEDED); } }), new RegExp(PERSON_NEEDED));
  assert.equal(facts.length, 1, 'card-reveal:native-attention-once');
  const [{ url, facts: at, rendering: sample }] = facts;
  assert.ok(url.startsWith(AMEX_VERIFY), 'card-rendering:native-amex-next-state-after-submit ' + JSON.stringify({ url, sample, statuses }));
  assert.deepEqual(statuses.map(s => s[0]), ['running', 'verification_required'], 'one sign-in, then the person: ' + JSON.stringify(statuses));
  assert.ok(rendering(sample), 'card-rendering:native-amex-signin-rendering-at-attention ' + JSON.stringify(sample));
  assert.notEqual(at.foregroundPid, seen.pid, 'card-background:native-foreground-kept');
  assert.deepEqual(onScreen(at), [], 'card-background:native-offscreen ' + JSON.stringify(at.windows)); assert.ok(minimized(at), 'card-background:native-minimized-at-attention ' + JSON.stringify(at.windows));
  assert.deepEqual(seen.fulfilled, [AMEX_LOGIN, AMEX_VERIFY], 'the login page once, then the verification page ' + JSON.stringify(seen));
  assert.ok(await waitGone(seen.pid), 'card-background:native-closed'); assert.equal(existsSync(B.ephemeralProfile(dir, ACCOUNT.ownerId, 'amex', ACCOUNT._id, 'signin')), false, 'card-background:native-profile-removed');
  assert.deepEqual(B.ownedBrowsers(), []);
  t.diagnostic('window events amex-signin: ' + JSON.stringify(await assertNoFocus(seen, 'amex-signin')) + '; frames in 4 s at attention ' + sample.frames);
});
// The reveal of the minimized background window with the REAL backgroundPage and the REAL showWindow, in HEADLESS Chrome only (no window
// of the owner's desktop exists or moves): the launch is made headless beneath the wrapper's own options, so browserFor installs the
// background page exactly as for a headed batch; with the card wrappers' `minimized` the page opens minimized off-screen and keeps
// rendering (case omf-card-rendering-20261031; before it the page was hidden), across a same-site and a cross-site document, and
// showWindow brings that SAME page to a normal window at its usable bounds (the headless screen), visible and rendering, with no other
// page. Without the option (the bank callers) the page opens as before the focus repair: a normal off-screen window, its page visible.
// The headed geometry stays excluded (B8).
const realLaunch = puppeteer.launch.bind(puppeteer);
test('native reveal geometry in HEADLESS Chrome: the real background page of the card wrappers opens minimized and keeps rendering, also across a same-site and a cross-site navigation; the real showWindow restores that same page to a normal window at usable bounds, still rendering', { skip: NATIVE, timeout: 120000 }, async () => {
  const dir = await owned('reveal-headless'), profile = B.ephemeralProfile(dir, ACCOUNT.ownerId, 'reveal', ACCOUNT._id, 'headless'), launches = [], seen = { fulfilled: [], aborted: [] };
  const browser = await withLaunch(async options => { launches.push(options); return realLaunch({ ...options, headless: true }); }, () => B.browserFor(profile, { ephemeral: true, root: dir, background: true, minimized: true }));
  try {
    assert.deepEqual([launches.length, launches[0].headless, launches[0].args.includes('--no-startup-window')], [1, false, true], 'the wrapper asked for the headed background launch');
    const page = await browser.newPage(), session = await page.createCDPSession();
    const created = (await session.send('Browser.getWindowForTarget')).bounds;
    assert.deepEqual([created.windowState, created.left, created.top], ['minimized', -32000, -32000], 'card-background:headless-created-minimized ' + JSON.stringify(created));
    const blank = await framesWithin(page);
    assert.ok(rendering(blank), 'card-rendering:headless-visible-while-minimized ' + JSON.stringify(blank));
    await serve(page, RENDER_SITE, seen);
    for (const url of [RENDER_NEXT, RENDER_B]) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const settled = await poll(() => page.evaluate(() => !!(window.__omfRender?.transitionEnded && window.__omfRender.intersected)), 15000), sample = await framesWithin(page), bounds = (await session.send('Browser.getWindowForTarget')).bounds;
      assert.ok(settled && rendering(sample) && bounds.windowState === 'minimized', 'card-rendering:headless-navigation-keeps-rendering ' + url + ' ' + JSON.stringify({ settled, sample, bounds }));
    }
    await B.showWindow(page);
    const shown = (await session.send('Browser.getWindowForTarget')).bounds, area = await page.evaluate(() => ({ left: screen.availLeft, top: screen.availTop, width: screen.availWidth, height: screen.availHeight }));
    assert.deepEqual([shown.windowState, shown.left, shown.top, shown.width, shown.height], ['normal', area.left + 40, area.top + 40, Math.max(800, Math.min(1280, area.width - 80)), Math.max(600, Math.min(900, area.height - 80))], 'card-reveal:headless-restored-at-usable-bounds ' + JSON.stringify({ shown, area }));
    assert.equal(await page.evaluate(() => document.visibilityState), 'visible', 'card-reveal:headless-page-visible');
    const restored = await framesWithin(page);
    assert.ok(rendering(restored), 'card-reveal:headless-restored-still-rendering ' + JSON.stringify(restored));
    const pages = await browser.pages(); assert.ok(pages.length === 1 && pages[0] === page, 'card-reveal:headless-same-page');
    await session.detach().catch(() => {});
  } finally { await B.closeOwnedBrowsers(); }
  assert.equal(existsSync(profile), false, 'card-background:headless-profile-removed'); assert.deepEqual(B.ownedBrowsers(), []);
});
test('native bank default in HEADLESS Chrome: the real background page without the card option opens as before, a normal off-screen window whose page is visible', { skip: NATIVE, timeout: 120000 }, async () => {
  const dir = await owned('bank-headless'), profile = B.ephemeralProfile(dir, BANK.ownerId, 'bank', BANK.bankAccountId, 'headless'), launches = [];
  const browser = await withLaunch(async options => { launches.push(options); return realLaunch({ ...options, headless: true }); }, () => B.browserFor(profile, { ephemeral: true, root: dir, background: true }));
  try {
    assert.deepEqual([launches.length, launches[0].headless, launches[0].args.includes('--no-startup-window')], [1, false, true], 'the bank callers\' options asked for the headed background launch');
    const page = await browser.newPage(), session = await page.createCDPSession();
    const created = (await session.send('Browser.getWindowForTarget')).bounds;
    assert.deepEqual([created.windowState, created.left, created.top, created.width, created.height, await page.evaluate(() => document.visibilityState)], ['normal', -32000, -32000, 1280, 900, 'visible'], 'bank-background:headless-normal-visible ' + JSON.stringify(created));
    const pages = await browser.pages(); assert.ok(pages.length === 1 && pages[0] === page, 'bank-background:headless-one-page');
    await session.detach().catch(() => {});
  } finally { await B.closeOwnedBrowsers(); }
  assert.equal(existsSync(profile), false, 'bank-background:headless-profile-removed'); assert.deepEqual(B.ownedBrowsers(), []);
});
// The Amex login trace natively (case omf-amex-login-fix-20261031), in HEADLESS Chrome only (no window of the owner's desktop exists):
// the real wrapper — its launch made headless beneath its own options, so browserFor and the minimized, rendering background page run as for
// a batch — signs in with the fictional login on a synthetic login form whose own submit handler cancels the native submission, sends the
// login module's cross-origin login request to its login API on the global origin (its CORS preflight is aborted like every request without
// a synthetic page, so the POST is never sent: the parent's offline public trace), posts to a synthetic endpoint (answered 403) and then
// opens the verification page, where the person would be asked (no mailbox). The record shows what the real isolated world and page events
// saw; the form's script reports whether the trace left anything in the page's own world, and the trace's own DevTools session is recorded
// (network-fold-01: what it handed to the browser). Every host name resolves nowhere in this owned Chrome, so a request the interception
// missed could not leave it either.
const TRACE_SITE = seen => ({
  [AMEX_LOGIN]: { body: '<!doctype html><html lang="ja"><meta charset="utf-8"><title>Synthetic Amex login</title><body><form id="login"><input id="eliloUserID"><input id="eliloPassword" type="password"><button id="loginSubmit" type="submit">ログイン</button></form><script>document.getElementById("login").addEventListener("submit",e=>{e.preventDefault();fetch(' + JSON.stringify(LOGIN_API) + ',{method:"POST",credentials:"include",headers:{"Content-Type":"application/x-www-form-urlencoded",challengeable:"ON"},body:"synthetic"}).catch(()=>null).then(()=>fetch("/omf-synthetic/logon?main="+("__omfLoginTrace" in window),{method:"POST",body:"synthetic"})).then(()=>{location.href=' + JSON.stringify(AMEX_VERIFY) + ';});});</script></body></html>' },
  'https://www.americanexpress.com/omf-synthetic/logon': { status: 403, body: '{}', seen: url => { seen.mainWorld = url.searchParams.get('main'); } },
  [AMEX_VERIFY]: AMEX_RENDER_SITE[AMEX_VERIFY]
});
// Records what the DevTools sessions opened on `page` from now on send (the trace's; the page's rendering session is already open) and the
// digests its field comparison answers; the sessions themselves are unchanged.
function recordSessions(page, sent, digests) {
  const create = page.createCDPSession.bind(page);
  page.createCDPSession = async () => {
    const session = await create(), send = session.send.bind(session);
    session.send = async (method, params) => { sent.push({ method, params: JSON.parse(JSON.stringify(params ?? {})) }); const answer = await send(method, params); for (const d of [answer?.result?.value?.digests].flat()) if (typeof d === 'string') digests.push(d); return answer; };
    return session;
  };
}
test('Amex login trace in HEADLESS Chrome: the real wrapper\'s isolated world sees both fictional values in place and one trusted click with one prevented submit, the page\'s own world sees nothing of it, the synthetic 403 and the verification page are recorded, and the record is written before Chrome closes', { skip: NATIVE, timeout: 180000 }, async t => {
  const dir = await owned('trace-headless'), seen = { fulfilled: [], aborted: [] }, statuses = [], launches = [], traceSent = [], digests = []; let pid = null;
  // `seen.api`: puppeteer's own page events for the login API's origin, in order (the method, resource type and failure text)
  const onLaunch = async ({ pid: launched, browser }) => { pid = launched; const open = browser.newPage.bind(browser); browser.newPage = async () => {
    const page = await open(); await serve(page, TRACE_SITE(seen), seen); recordSessions(page, traceSent, digests); seen.api = [];
    for (const name of ['request', 'requestfailed', 'response']) page.on(name, item => { const r = name === 'response' ? item.request() : item; if (r.url().startsWith(new URL(LOGIN_API).origin)) seen.api.push([name, r.method(), r.resourceType(), name === 'requestfailed' ? r.failure()?.errorText : name === 'response' ? item.status() : null]); });
    return page;
  }; };
  const outcome = await withLaunch(async options => { launches.push(options); return realLaunch({ ...options, headless: true, args: [...options.args, '--host-resolver-rules=MAP * ~NOTFOUND'] }); }, () => B.collectStatement(ACCOUNT, FICTIONAL_LOGIN, dir, async (state, text) => { statuses.push([state, text]); }, { batch: 'trace-headless', onLaunch, reveal: async page => { seen.revealedAt = page.url(); throw new Error(PERSON_NEEDED); } })).then(() => null, error => error);
  assert.equal(outcome?.message, PERSON_NEEDED, 'the person would be asked on the verification page: ' + outcome?.message);
  assert.deepEqual([launches.length, launches[0]?.headless, launches[0]?.args.includes('--no-startup-window'), statuses.map(s => s[0])], [1, false, true, ['running', 'verification_required']], 'one background launch (made headless here) and one sign-in');
  assert.ok(String(seen.revealedAt).startsWith(AMEX_VERIFY), 'amex-trace:native-reached-verification ' + seen.revealedAt);
  assert.equal(seen.mainWorld, 'false', 'amex-trace:native-invisible-to-the-page');
  assert.ok(await waitGone(pid), 'amex-trace:native-closed'); assert.equal(existsSync(B.ephemeralProfile(dir, ACCOUNT.ownerId, 'amex', ACCOUNT._id, 'trace-headless')), false, 'amex-trace:native-profile-removed'); assert.deepEqual(B.ownedBrowsers(), []);
  const [file, ...more] = await traceFiles(dir);
  assert.ok(file && !more.length && TRACE_NAME.test(file), 'amex-trace:native-one-record');
  const text = await readFile(path.join(traceDir(dir), file), 'utf8'), record = JSON.parse(text), all = name => record.events.filter(e => e.event === name);
  // network-fold-01: the trace's DevTools calls handed the browser no fictional login, part or digest of one; the page's own digests came
  // back from the real isolated world and are in no record
  assert.deepEqual(handedLogin(traceSent), [], 'amex-trace:native-no-secret-to-browser');
  assert.ok(traceSent.some(c => c.method === 'Runtime.callFunctionOn') && digests.length === 2 && digests.every(d => /^[0-9a-f]{64}$/.test(d) && !text.includes(d.slice(0, 16))), 'amex-trace:native-digest-transient ' + digests.length);
  const [fields] = all('fields'), [filled] = all('filled'), [submitted] = all('submitted');
  const ready = { present: true, visible: true, enabled: true, editable: true, react: false };
  assert.deepEqual([fields?.user, fields?.password, fields?.submit, fields?.visibility, fields?.surface], [ready, ready, { present: true, visible: true, enabled: true, react: false, type: 'submit', form: true, sameForm: true }, 'visible', 'login'], 'amex-trace:native-fields ' + JSON.stringify(fields));
  assert.deepEqual(all('listen').map(e => e.native), ['installed'], 'amex-trace:native-isolated-world');
  assert.deepEqual([filled?.user, filled?.password, filled?.focus], [{ matches: true, empty: false, valid: true, ariaInvalid: false }, { matches: true, empty: false, valid: true, ariaInvalid: false }, 'password'], 'amex-trace:native-filled ' + JSON.stringify(filled));
  assert.deepEqual(submitted?.native, { readable: true, clicks: 1, trusted: 1, buttonClicks: 1, submits: 1, prevented: 1, bubbled: 1, invalid: 0 }, 'amex-trace:native-submit ' + JSON.stringify(submitted));
  // The preflight is aborted inside this Chrome; no login POST is received. Puppeteer may report requestfailed before request while
  // resolving an intercepted preflight. Preserve its observed arrival order, and require both exact events independently of that order.
  // The 403 belongs to another endpoint.
  const api = record.events.filter(e => e.endpoint === 'login-api').map(e => [e.event, e.method, e.type, e.target, e.failure ?? e.status ?? null]);
  assert.deepEqual(api, seen.api.map(([event, method, type, answer]) => [event === 'requestfailed' ? 'failed' : event, method, type, 'global', event === 'requestfailed' ? 'failed' : answer]), 'amex-trace:native-api-arrival-order');
  assert.deepEqual([api.slice().sort((a, b) => a[0].localeCompare(b[0])), seen.aborted.includes('https://global.americanexpress.com')], [[['failed', 'OPTIONS', 'other', 'global', 'failed'], ['request', 'OPTIONS', 'other', 'global', null]], true], 'amex-trace:native-login-api ' + JSON.stringify({ api: record.events.filter(e => e.endpoint === 'login-api'), puppeteer: seen.api, aborted: seen.aborted, login: record.events.at(-1)?.network?.after?.login }));
  const after = record.events.filter(e => (e.event === 'response' || e.event === 'failed') && e.phase === 'after').map(e => [e.event, e.method, e.type, e.target, e.endpoint, e.status ?? e.failure]);
  assert.deepEqual(after, [['failed', 'OPTIONS', 'other', 'global', 'login-api', 'failed'], ['response', 'POST', 'fetch', 'www', 'other', 403], ['response', 'GET', 'document', 'verify', 'other', 200]], 'amex-trace:native-responses ' + JSON.stringify(after));
  assert.ok(all('navigated').some(e => e.phase === 'after' && e.surface === 'verify'), 'amex-trace:native-navigated');
  assert.deepEqual([record.outcome, record.events.at(-1).event, record.events.at(-1).reason, record.events.at(-1).network.after.writes.www, record.events.at(-1).network.after.login], ['failed', 'end', 'stopped', { sent: 1, '2xx': 0, '3xx': 0, '4xx': 1, '5xx': 0, other: 0, failed: 0 }, { options: { ...ZERO_CELL, sent: 1, failed: 1 }, post: ZERO_CELL, other: ZERO_CELL }], 'amex-trace:native-end ' + JSON.stringify(record.events.at(-1)));
  for (const leak of TRACE_LEAKS) assert.ok(!text.includes(leak), 'amex-trace:native-no-leak ' + leak);
  assert.ok(seen.fulfilled.includes(AMEX_LOGIN) && seen.fulfilled.includes(AMEX_VERIFY), 'only synthetic pages served ' + JSON.stringify(seen.fulfilled));
  t.diagnostic('trace record (leak-checked above): ' + text);
  t.diagnostic('login API page events (puppeteer, in order): ' + JSON.stringify(seen.api));
});
// The login API's network detail natively (case omf-amex-network-detail-01), in HEADLESS Chrome only. The real wrapper signs in on a
// synthetic login page that an owned loopback TLS server answers for both Amex host names, mapped to it inside this Chrome alone (every
// other name resolves nowhere; the server's throwaway certificate is accepted by this Chrome alone and nothing is intercepted), so Chrome's
// own network stack answers and checks CORS: the page's request to the login API is preflighted (answered 200 with the CORS grant) and its
// POST answered 403 without Access-Control-Allow-Origin, which Chrome withholds from the page (net::ERR_FAILED: the real job's page-level
// pattern). The record must tell that hidden 403 and its CORS error apart from no answer, and the page's own DevTools session (where
// puppeteer enabled Network) must get no command from the trace and no detach, keep puppeteer's listeners and lose the trace's before Chrome
// closes. Synthetic: it proves the seam on Chrome 155, not what the issuer answers to a real login.
const OPENSSL = 'C:/Program Files/Git/usr/bin/openssl.exe';
const DETAIL_EVENTS = ['Network.requestWillBeSent', 'Network.responseReceivedExtraInfo', 'Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed'];
async function corsSite(dir, record) {
  const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  await execute(OPENSSL, ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=omf-synthetic.invalid'], { windowsHide: true, timeout: 30000 });
  const login = '<!doctype html><html lang="ja"><meta charset="utf-8"><title>Synthetic Amex login</title><body><form id="login"><input id="eliloUserID"><input id="eliloPassword" type="password"><button id="loginSubmit" type="submit">ログイン</button></form><script>document.getElementById("login").addEventListener("submit",e=>{e.preventDefault();fetch(' + JSON.stringify(LOGIN_API) + ',{method:"POST",credentials:"include",headers:{"Content-Type":"application/json",challengeable:"ON"},body:"{}"}).catch(()=>null).then(()=>{location.href=' + JSON.stringify(AMEX_VERIFY) + ';});});</script></body></html>';
  const server = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, (req, res) => {
    const host = String(req.headers.host).split(':')[0], { pathname } = new URL(req.url, 'https://' + host); req.resume(); record.push([host, req.method, pathname]);
    if (host === 'www.americanexpress.com' && req.method === 'GET' && pathname === new URL(AMEX_LOGIN).pathname) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(login); }
    if (host === 'www.americanexpress.com' && req.method === 'GET' && pathname === new URL(AMEX_VERIFY).pathname) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(AMEX_RENDER_SITE[AMEX_VERIFY].body); }
    if (host === 'global.americanexpress.com' && pathname === new URL(LOGIN_API).pathname && req.method === 'OPTIONS') { res.writeHead(200, { 'access-control-allow-origin': 'https://www.americanexpress.com', 'access-control-allow-credentials': 'true', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type, challengeable' }); return res.end(); }
    if (host === 'global.americanexpress.com' && pathname === new URL(LOGIN_API).pathname && req.method === 'POST') { res.writeHead(403, { 'content-type': 'text/html' }); return res.end('<html><body>Access Denied</body></html>'); }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { port: server.address().port, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
}
test('Amex login trace network detail in HEADLESS Chrome: the real wrapper\'s record tells the login API\'s POST answered 403 but withheld by CORS (MissingAllowOriginHeader) from its preflight answered 200, read in place from the page\'s own DevTools session, which gets no command or detach from the trace, keeps puppeteer\'s listeners and loses the trace\'s before Chrome closes', { skip: NATIVE, timeout: 180000 }, async t => {
  const dir = await owned('trace-detail'), served = [], site = await corsSite(dir, served), statuses = [], launches = [], traceSent = [], digests = [];
  const seen = { api: [], ids: new Set(), sdkSent: [], detached: 0, client: null, before: null, during: null, atClose: null }; let pid = null;
  const counts = client => Object.fromEntries(DETAIL_EVENTS.map(name => [name, client.listenerCount(name)]));
  const onLaunch = async ({ pid: launched, browser }) => {
    pid = launched; const open = browser.newPage.bind(browser), close = browser.close.bind(browser);
    browser.newPage = async () => {
      const page = await open(), client = page._client(); recordSessions(page, traceSent, digests);
      // this test's own recorders on the page's session, registered before its listener counts are taken: the login API's request ids
      // (for the leak check), every command sent on it from now on and any detach
      client.on('Network.requestWillBeSent', e => { if (String(e.request?.url).startsWith(LOGIN_API)) seen.ids.add(e.requestId); });
      const send = client.send.bind(client), detach = client.detach.bind(client);
      client.send = (method, ...rest) => { seen.sdkSent.push(method); return send(method, ...rest); };
      client.detach = (...rest) => { seen.detached++; return detach(...rest); };
      for (const name of ['request', 'requestfailed', 'response']) page.on(name, item => { const r = name === 'response' ? item.request() : item; if (r.url().startsWith(LOGIN_API)) seen.api.push([name, r.method(), r.resourceType(), name === 'requestfailed' ? r.failure()?.errorText : name === 'response' ? item.status() : null]); });
      seen.client = client; seen.before = counts(client); return page;
    };
    browser.close = async () => { if (seen.client) seen.atClose = counts(seen.client); return close(); };
  };
  let outcome;
  try {
    outcome = await withLaunch(async options => { launches.push(options); return realLaunch({ ...options, headless: true, args: [...options.args, '--host-resolver-rules=MAP www.americanexpress.com 127.0.0.1:' + site.port + ', MAP global.americanexpress.com 127.0.0.1:' + site.port + ', MAP * ~NOTFOUND', '--ignore-certificate-errors'] }); },
      () => B.collectStatement(ACCOUNT, FICTIONAL_LOGIN, dir, async (state, text) => { statuses.push([state, text]); }, { batch: 'trace-detail', onLaunch, reveal: async page => { seen.revealedAt = page.url(); seen.during = counts(seen.client); throw new Error(PERSON_NEEDED); } })).then(() => null, error => error);
  } finally { await site.close(); }
  assert.equal(outcome?.message, PERSON_NEEDED, 'the person would be asked on the verification page: ' + outcome?.message);
  assert.deepEqual([launches.length, launches[0]?.headless, statuses.map(s => s[0])], [1, false, ['running', 'verification_required']], 'one background launch (made headless here) and one sign-in');
  assert.ok(String(seen.revealedAt).startsWith(AMEX_VERIFY), 'amex-trace:native-detail-reached-verification ' + seen.revealedAt);
  const api = served.filter(([host, , pathname]) => host === 'global.americanexpress.com' && pathname === new URL(LOGIN_API).pathname).map(([, method]) => method);
  assert.deepEqual(api, ['OPTIONS', 'POST'], 'amex-trace:native-detail-real-exchange (the loopback server answered one preflight and one POST) ' + JSON.stringify(served));
  assert.deepEqual(seen.api.map(e => e.join(':')).sort(), ['request:OPTIONS:other:', 'request:POST:fetch:', 'requestfailed:POST:fetch:net::ERR_FAILED', 'response:OPTIONS:other:200'], 'amex-trace:native-detail-page-level-pattern (the real job\'s: a preflight answered 200, a POST failed with no answer the page saw) ' + JSON.stringify(seen.api));
  assert.ok(await waitGone(pid), 'amex-trace:native-detail-closed'); assert.deepEqual(B.ownedBrowsers(), []);
  const [file, ...more] = await traceFiles(dir);
  assert.ok(file && !more.length && TRACE_NAME.test(file), 'amex-trace:native-detail-one-record');
  const text = await readFile(path.join(traceDir(dir), file), 'utf8'), record = JSON.parse(text), end = record.events.at(-1), detail = end?.network?.detail;
  const answered = { phase: 'after', method: 'OPTIONS', responseStatus: 200, responseClass: '2xx', extraStatus: 200, extraClass: '2xx', outcome: 'finished', cors: null, blocked: null };
  const hidden = { phase: 'after', method: 'POST', responseStatus: null, responseClass: null, extraStatus: 403, extraClass: '4xx', outcome: 'failed', cors: 'MissingAllowOriginHeader', blocked: null };
  const requests = Array.isArray(detail?.requests) ? detail.requests.map(({ ms: _ms, ordinal: _ordinal, ...r }) => r).sort((a, b) => a.method.localeCompare(b.method)) : null;
  assert.deepEqual([detail?.listening, detail?.seen, detail?.dropped, requests, (detail?.requests || []).map(r => r.ordinal).sort()], [true, 2, 0, [answered, hidden], [1, 2]], 'amex-trace:native-detail (a hidden 403 with its CORS error, apart from the answered preflight) ' + JSON.stringify(end?.network));
  assert.deepEqual([end?.event, end?.reason, end?.network?.after?.login], ['end', 'stopped', { options: { ...ZERO_CELL, sent: 1, '2xx': 1 }, post: { ...ZERO_CELL, sent: 1, failed: 1 }, other: ZERO_CELL }], 'amex-trace:native-detail-page-counts ' + JSON.stringify(end?.network?.after?.login));
  // the page's own session: the trace's five listeners while the person was needed, none of them when Chrome closed, puppeteer's own kept
  const plus = Object.fromEntries(Object.entries(seen.before || {}).map(([name, n]) => [name, n + 1]));
  assert.ok(seen.before && Object.values(seen.before).every(n => n >= 1), 'amex-trace:native-detail-sdk-own-listeners ' + JSON.stringify(seen.before));
  assert.deepEqual([seen.during, seen.atClose], [plus, seen.before], 'amex-trace:native-detail-sdk-listeners (added for the sign-in, removed before close) ' + JSON.stringify({ before: seen.before, during: seen.during, atClose: seen.atClose }));
  const commands = seen.sdkSent.filter(method => /\.enable$/.test(method) || /^(Network|Fetch|Log|Audits)\./.test(method));
  assert.deepEqual([seen.detached, commands], [0, []], 'amex-trace:native-detail-sdk-untouched (no detach, no domain enabled, no Network/Fetch command on the page\'s session) ' + JSON.stringify([...new Set(seen.sdkSent)]));
  assert.ok(traceSent.every(c => ['Page.getFrameTree', 'Page.createIsolatedWorld', 'Runtime.callFunctionOn'].includes(c.method)), 'amex-trace:native-detail-own-session-unchanged ' + JSON.stringify([...new Set(traceSent.map(c => c.method))]));
  assert.ok(seen.ids.size === 2 && [...seen.ids].every(id => !text.includes(id)), 'amex-trace:native-detail-no-request-id ' + seen.ids.size);
  for (const leak of TRACE_LEAKS) assert.ok(!text.includes(leak), 'amex-trace:native-detail-no-leak ' + leak);
  t.diagnostic('network detail (leak-checked above): ' + JSON.stringify(detail));
  t.diagnostic('page session commands during the job (puppeteer\'s): ' + JSON.stringify([...new Set(seen.sdkSent)]));
});
// The Amex language preference natively (case omf-amex-locale-01), in HEADLESS Chrome only (no window of the owner's desktop exists). Each
// launch is made headless beneath its own options, and an owned loopback TLS server answers the Amex login host inside that Chrome alone (a
// throwaway certificate accepted by that Chrome alone, every other name resolves nowhere, nothing intercepted): the login page's own world
// reads the language preference Chrome gives it, and the server keeps the Accept-Language header Chrome sent for that document. Synthetic:
// it shows what Chrome makes of each launch's switch, not what the issuer does with it.
const LANGUAGE_FACTS = () => { let canonical; try { canonical = Intl.getCanonicalLocales(navigator.languages); } catch (error) { canonical = String(error?.name); } return { language: navigator.language, languages: [...navigator.languages], canonical, intlLocale: Intl.DateTimeFormat().resolvedOptions().locale }; };
// An Accept-Language value whose every item is one language tag with at most one weight (RFC 9110 12.5.4), and those tags in order.
const LANGUAGE_ITEM = /^([A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*)(?:;q=(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?))?$/;
const acceptLanguage = header => { const items = String(header ?? '').split(',').map(item => LANGUAGE_ITEM.exec(item.trim())); return { wellFormed: typeof header === 'string' && items.every(Boolean), tags: items.map(m => m?.[1] ?? null) }; };
async function languageSite(dir, record) {
  const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  await execute(OPENSSL, ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=omf-synthetic.invalid'], { windowsHide: true, timeout: 30000 });
  const server = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, (req, res) => {
    const host = String(req.headers.host).split(':')[0], { pathname } = new URL(req.url, 'https://' + host); req.resume();
    record.push({ host, method: req.method, pathname, acceptLanguage: req.headers['accept-language'] ?? null });
    if (host === 'www.americanexpress.com' && req.method === 'GET' && pathname === new URL(AMEX_LOGIN).pathname) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(SYNTHETIC[AMEX_LOGIN].body); }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { port: server.address().port, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
}
const languageLaunch = (site, launches) => async options => { launches.push(options); return realLaunch({ ...options, headless: true, args: [...options.args, '--host-resolver-rules=MAP www.americanexpress.com 127.0.0.1:' + site.port + ', MAP * ~NOTFOUND', '--ignore-certificate-errors'] }); };
const loginDocument = (served, from = 0) => served.slice(from).find(r => r.host === 'www.americanexpress.com' && r.method === 'GET' && r.pathname === new URL(AMEX_LOGIN).pathname);
test('Amex language preference in HEADLESS Chrome (wrapper): the real wrapper\'s login page gets the plain tags ja-JP, ja, en, all canonical, and Chrome sends a well-formed Accept-Language for that document', { skip: NATIVE, timeout: 180000 }, async t => {
  const dir = await owned('language-amex-headless'), served = [], site = await languageSite(dir, served), launches = [], seen = {};
  let outcome;
  try {
    outcome = await withLaunch(languageLaunch(site, launches), () => B.collectStatement(ACCOUNT, {}, dir, async () => {}, { batch: 'language-headless', onLaunch: async ({ pid, browser }) => { seen.pid = pid; seen.chrome = await browser.version(); }, reveal: async page => { seen.url = page.url(); seen.facts = await page.evaluate(LANGUAGE_FACTS); throw new Error(PERSON_NEEDED); } })).then(() => null, error => error);
  } finally { await site.close(); }
  const document = loginDocument(served), header = acceptLanguage(document?.acceptLanguage);
  t.diagnostic('Amex lane (' + seen.chrome + '): ' + JSON.stringify({ facts: seen.facts, acceptLanguage: document?.acceptLanguage ?? null }));
  assert.equal(outcome?.message, PERSON_NEEDED, 'the person would be asked on the login page: ' + outcome?.message);
  assert.ok(String(seen.url).startsWith(AMEX_LOGIN), 'amex-locale:native-login-page ' + seen.url);
  assert.deepEqual(seen.facts?.languages, AMEX_LANGUAGES, 'amex-locale:native-languages ' + JSON.stringify(seen.facts));
  assert.deepEqual([seen.facts?.language, seen.facts?.canonical], ['ja-JP', AMEX_LANGUAGES], 'amex-locale:native-canonical ' + JSON.stringify(seen.facts));
  assert.ok(header.wellFormed && header.tags[0] === 'ja-JP' && new Set(header.tags).size === header.tags.length && JSON.stringify(canonical(header.tags)) === JSON.stringify(header.tags), 'amex-locale:native-accept-language ' + JSON.stringify(document));
  assert.deepEqual([launches.length, launches[0]?.headless, launches[0]?.args], [1, false, [...AMEX_LAUNCH_ARGS, '--no-startup-window']], 'amex-locale:native-one-launch (made headless here) ' + JSON.stringify(launches.map(l => l.args)));
  assert.ok(await waitGone(seen.pid), 'amex-locale:native-closed'); assert.equal(existsSync(B.ephemeralProfile(dir, ACCOUNT.ownerId, 'amex', ACCOUNT._id, 'language-headless')), false, 'amex-locale:native-profile-removed'); assert.deepEqual(B.ownedBrowsers(), []);
});
test('Amex language preference in HEADLESS Chrome (defaults): launches without the option, with the bank callers\' and the Aplus wrapper\'s options, give their page exactly the list of the release\'s --accept-lang, as before', { skip: NATIVE, timeout: 180000 }, async t => {
  const dir = await owned('language-defaults-headless'), served = [], site = await languageSite(dir, served), seen = [];
  try {
    for (const [lane, options] of [['bank', { background: true }], ['aplus', { background: true, minimized: true }]]) {
      const launches = [], profile = B.ephemeralProfile(dir, BANK.ownerId, 'language', lane, 'headless'), from = served.length;
      const browser = await withLaunch(languageLaunch(site, launches), () => B.browserFor(profile, { ephemeral: true, root: dir, ...options }));
      try {
        const page = await browser.newPage();
        await page.goto(AMEX_LOGIN, { waitUntil: 'domcontentloaded', timeout: 30000 });
        seen.push({ lane, chrome: await browser.version(), args: launches.map(l => l.args), facts: await page.evaluate(LANGUAGE_FACTS), acceptLanguage: loginDocument(served, from)?.acceptLanguage ?? null });
      } finally { await B.closeOwnedBrowsers(); }
      assert.equal(existsSync(profile), false, 'amex-locale:native-default-profile-removed ' + lane);
    }
  } finally { await site.close(); }
  t.diagnostic('default lanes: ' + JSON.stringify(seen));
  assert.equal(seen.length, 2, 'amex-locale:native-default-lanes');
  for (const s of seen) {
    assert.deepEqual(s.args, [[...RELEASE_LAUNCH_ARGS, '--no-startup-window']], 'amex-locale:native-default-launch ' + s.lane + ' ' + JSON.stringify(s.args));
    assert.deepEqual(s.facts.languages, acceptTags(RELEASE_LAUNCH_ARGS), 'amex-locale:native-default-unchanged ' + s.lane + ' ' + JSON.stringify(s.facts));
  }
  assert.deepEqual(B.ownedBrowsers(), []);
});
