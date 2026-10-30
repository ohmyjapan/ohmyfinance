// collector/test/card-background.test.mjs — routine Amex and Aplus downloads in the background owned Chrome (plan omf-card-handover-20261030).
// Part A (always): the real collector/browser.mjs wrappers over a recording stand-in for rebrowser's launch (the module's own
// launch is replaced in this process; no Chrome starts), the real login.mjs/aplus.mjs UIs on fake pages, and the unchanged
// showWindow bytes. Part B (OMF_CARD_NATIVE=1, serialized with the other Chrome suites): the real wrappers start real stock Chrome
// headed in the background (no startup window, an inactive, minimized off-screen page) on intercepted synthetic issuer pages; every page
// request is answered from synthetic HTML or aborted, the foreground window is read (never changed), a passive recorder keeps the owned
// Chrome's window events for the whole run, and the reveal is a recording stand-in: the real showWindow is NEVER called on a headed
// window here, because it would move a window on the owner's desktop (its restore from minimized is proven in headless Chrome).
// OMF_TEST_BROWSER_MODULE / OMF_TEST_LOGIN_MODULE / OMF_TEST_APLUS_MODULE point at a mutant copy beside the original.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import puppeteer from 'rebrowser-puppeteer-core';
import { HEADERS as APLUS_HEADERS } from '../../shared/aplus.mjs';

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
const roots = [];
async function owned(label) { const dir = await mkdtemp(path.join(os.tmpdir(), 'omf-card-bg-' + label + '-')); roots.push(dir); return dir; }
test.after(async () => { try { await B.closeOwnedBrowsers(); } catch { /* best effort */ } for (const dir of roots) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

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
function recordingLaunch(makePage) {
  const record = { launches: [], cdp: [], defaultPages: 0, closed: 0, pages: [] };
  const launch = async options => {
    record.launches.push(options);
    const targets = new Map(), pages = [], child = { pid: 41000 + record.launches.length, exitCode: 0, signalCode: null, kill() {}, once() {} };
    const browser = {
      connected: true, process: () => child,
      async close() { record.closed++; browser.connected = false; },
      async pages() { return pages.slice(); },
      async newPage() { record.defaultPages++; const page = makePage(); pages.push(page); record.pages.push(page); return page; },
      target: () => ({ createCDPSession: async () => ({ async send(method, params) { record.cdp.push([method, params]); if (method !== 'Target.createTarget') return {}; const id = 'target-' + record.cdp.length, page = makePage(); targets.set(id, page); pages.push(page); record.pages.push(page); return { targetId: id }; }, async detach() {} }) }),
      async waitForTarget(predicate) { for (const [id, page] of targets) { const target = { _targetId: id, page: async () => page }; if (predicate(target)) return target; } throw new Error('no such target'); }
    };
    return browser;
  };
  return { record, launch };
}
async function withLaunch(stand, fn) { const original = puppeteer.launch; puppeteer.launch = stand; try { return await fn(); } finally { puppeteer.launch = original; } }
const offscreen = params => params?.newWindow === true && params?.background === true && params.left === -32000 && params.top === -32000 && params.url === 'about:blank';

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
  return { async stop() { await writeFile(stop, 'stop').catch(() => {}); if (child.exitCode === null) await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 10000))]); if (child.exitCode === null) child.kill(); return read(); } };
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
function nativeOnLaunch(seen, site = SYNTHETIC) {
  return async ({ pid, browser }) => {
    seen.pid = pid; seen.command = await commandLineOf(pid); seen.windows = await watchWindows(pid); // ready before the page's window exists
    const open = browser.newPage.bind(browser);
    browser.newPage = async () => {
      const page = await open();
      await page.setRequestInterception(true);
      page.on('request', request => {
        const url = new URL(request.url()), key = url.origin + url.pathname, synthetic = site[key];
        if (url.protocol === 'about:' || url.protocol === 'data:' || url.protocol === 'blob:') return request.continue();
        if (!synthetic) { seen.aborted.push(url.origin); return request.abort(); }
        seen.fulfilled.push(key); synthetic.seen?.(url);
        if (synthetic.redirect) return request.respond({ status: 302, headers: { location: synthetic.redirect }, body: '' });
        return request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: synthetic.body });
      });
      return page;
    };
  };
}
// A synthetic My APLUS on the issuer's origin for the REAL aplusUi (collector/aplus.mjs): signed in at /, the statement page of 2026/09
// (2,400円, card -1234) with 保存 → CSV, the statement-code page, a CSV download after the code, and the unbilled page (1 row, 1,200円).
// The code page returns to the statement page with the typed code, which is recorded from that intercepted navigation; the page then
// downloads the CSV from a blob it makes itself (as aplus-readiness.mjs does), so no download request can leave the browser.
function aplusSite(record) {
  const html = (title, body) => '<!doctype html><html lang="ja"><meta charset="utf-8"><title>' + title + '</title><body>' + body + '</body></html>';
  const csv = JSON.stringify(aplusCsv().toString('utf8'));
  const details = html('Synthetic statement', '<button>Synthetic カード ****-1234</button><div class="m-navDate"><button class="m-navDate__chooseButton">2026/09</button><select class="m-navDate__chooseSelect"><option value="2026/09" selected>2026/09</option></select><div class="m-navDate__next"><a href="/cards/billing/unbilled">2026/10以降</a></div></div><div class="m-particularsOverview"><p>お支払い金額</p><p class="m-particularsOverview__price">2,400円</p><p>確定</p></div><button id="save">保存</button> <a id="csv" href="#" style="display:none">CSV</a>'
    + '<script>document.getElementById("save").onclick=()=>{document.getElementById("csv").style.display="inline"};document.getElementById("csv").onclick=e=>{e.preventDefault();location.href="/authentication/otp/sms"};const code=new URLSearchParams(location.search).get("download");if(code){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([' + csv + '],{type:"text/csv"}));a.download="aplus_meisai.csv";document.body.append(a);a.click();}</script>');
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
  test(`native ${lane}: real background Chrome on synthetic pages — no startup page, minimized off-screen inactive window, foreground kept, attention routed to the same page, no issuer request, closed and removed`, { skip: NATIVE, timeout: 240000 }, async t => {
    const dir = await owned('native-' + lane.toLowerCase()), seen = { fulfilled: [], aborted: [] }, facts = [];
    await assert.rejects(run(dir, { onLaunch: nativeOnLaunch(seen), reveal: async page => { facts.push({ url: page.url(), facts: await windowFacts(seen.pid) }); throw new Error(PERSON_NEEDED); } }), new RegExp(PERSON_NEEDED));
    assert.ok(seen.command.includes('--no-startup-window') && seen.command.includes('--remote-debugging-pipe') && !seen.command.includes('--headless'), 'card-background:native-flags ' + seen.command.slice(0, 300));
    for (const flag of ['--no-sandbox', '--disable-web-security', '--remote-debugging-port']) assert.ok(!seen.command.includes(flag), 'card-background:native-forbidden ' + flag);
    assert.equal(facts.length, 1, 'card-reveal:native-attention-once');
    const [{ url, facts: at }] = facts;
    assert.ok(url.startsWith(fulfilledKey), 'card-reveal:native-same-page ' + url);
    assert.notEqual(at.foregroundPid, seen.pid, 'card-background:native-foreground-kept');
    assert.deepEqual(onScreen(at), [], 'card-background:native-offscreen ' + JSON.stringify(at.windows));
    assert.ok(minimized(at), 'card-background:native-minimized-at-attention ' + JSON.stringify(at.windows));
    assert.ok(seen.fulfilled.includes(fulfilledKey), 'synthetic page served ' + JSON.stringify(seen));
    assert.ok(await waitGone(seen.pid), 'card-background:native-closed'); assert.equal(existsSync(profileOf(dir)), false, 'card-background:native-profile-removed');
    assert.deepEqual(B.ownedBrowsers(), []);
    t.diagnostic('window events ' + lane + ': ' + JSON.stringify(await assertNoFocus(seen, lane)));
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
// The reveal of the minimized background window with the REAL backgroundPage and the REAL showWindow, in HEADLESS Chrome only (no window
// of the owner's desktop exists or moves): the launch is made headless beneath the wrapper's own options, so browserFor installs the
// background page exactly as for a headed batch; the page opens minimized off-screen and hidden, and showWindow brings that SAME page to a
// normal window at its usable bounds (the headless screen), visible, with no other page. The headed geometry stays excluded (B8).
const realLaunch = puppeteer.launch.bind(puppeteer);
test('native reveal geometry in HEADLESS Chrome: the real background page opens minimized and hidden; the real showWindow restores that same page to a normal window at usable bounds', { skip: NATIVE, timeout: 120000 }, async () => {
  const dir = await owned('reveal-headless'), profile = B.ephemeralProfile(dir, ACCOUNT.ownerId, 'reveal', ACCOUNT._id, 'headless'), launches = [];
  const browser = await withLaunch(async options => { launches.push(options); return realLaunch({ ...options, headless: true }); }, () => B.browserFor(profile, { ephemeral: true, root: dir, background: true }));
  try {
    assert.deepEqual([launches.length, launches[0].headless, launches[0].args.includes('--no-startup-window')], [1, false, true], 'the wrapper asked for the headed background launch');
    const page = await browser.newPage(), session = await page.createCDPSession();
    const created = (await session.send('Browser.getWindowForTarget')).bounds;
    assert.deepEqual([created.windowState, created.left, created.top, await page.evaluate(() => document.visibilityState)], ['minimized', -32000, -32000, 'hidden'], 'card-background:headless-created-minimized ' + JSON.stringify(created));
    await B.showWindow(page);
    const shown = (await session.send('Browser.getWindowForTarget')).bounds, area = await page.evaluate(() => ({ left: screen.availLeft, top: screen.availTop, width: screen.availWidth, height: screen.availHeight }));
    assert.deepEqual([shown.windowState, shown.left, shown.top, shown.width, shown.height], ['normal', area.left + 40, area.top + 40, Math.max(800, Math.min(1280, area.width - 80)), Math.max(600, Math.min(900, area.height - 80))], 'card-reveal:headless-restored-at-usable-bounds ' + JSON.stringify({ shown, area }));
    assert.equal(await page.evaluate(() => document.visibilityState), 'visible', 'card-reveal:headless-page-visible');
    const pages = await browser.pages(); assert.ok(pages.length === 1 && pages[0] === page, 'card-reveal:headless-same-page');
    await session.detach().catch(() => {});
  } finally { await B.closeOwnedBrowsers(); }
  assert.equal(existsSync(profile), false, 'card-background:headless-profile-removed'); assert.deepEqual(B.ownedBrowsers(), []);
});
