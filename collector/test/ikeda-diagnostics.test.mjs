// collector/test/ikeda-diagnostics.test.mjs — plan omf-ikeda-trace-20261030: the private, value-free 池田泉州銀行 sign-in trace of actual
// statement and balance jobs (collector/banks/ikeda.mjs portalUi authDiagnostic(), recorded by collector/bank.mjs and collector/bank-balance.mjs).
// Real modules on an owned HEADLESS Chrome: the fictional BusinessGate of scripts/zoomer-fixtures/omf-ikeda-collector.mjs (businessGate) is
// served by request interception and host resolution is refused for everything else, so no bank or other site is reached. The certificate
// chooser does not exist in headless Chrome: the adapter's helper seam is a fictional one here (selected and the page moves on; no chooser;
// attention; a throwing or hostile helper; selected while the page moves to an unknown document; a helper that never answers while the page
// moves to a stalled renderer). Its DOM is invented and proves nothing about the real portal; the original failed job kept no helper/page
// timeline, so nothing here reproduces or explains it. page.bringToFront is replaced by a counter: no window is brought to the front.
// Fictional password, account and canaries only.
// Under OMF_TEST_IKEDA_MODULE / OMF_TEST_BANK_MODULE / OMF_TEST_BALANCE_MODULE the named baseline or mutant copies are tested.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'rebrowser-puppeteer-core';

const moduleOf = (env, rel) => process.env[env] ? pathToFileURL(process.env[env]).href : new URL(rel, import.meta.url).href;
const ikeda = await import(moduleOf('OMF_TEST_IKEDA_MODULE', '../banks/ikeda.mjs'));
const bank = await import(moduleOf('OMF_TEST_BANK_MODULE', '../bank.mjs'));
const B = await import(moduleOf('OMF_TEST_BALANCE_MODULE', '../bank-balance.mjs'));
const { findChrome, LAUNCH_ARGS } = await import('../browser.mjs');
const F = await import(new URL('../../scripts/zoomer-fixtures/omf-ikeda-collector.mjs', import.meta.url).href);

const OWNER = 'd7d7d7d7d7d7d7d7d7d7d7d7', ACCOUNT = 'c3c3c3c3c3c3c3c3c3c3c3c3', OTHER_ACCOUNT = 'c4c4c4c4c4c4c4c4c4c4c4c4', OMF = 'https://omf.example';
const SECRET = Object.freeze({ password: 'Fict-Pw-12' }), LABEL = '池田泉州銀行';
// Private canaries: none may ever appear in a diagnostic record (page title/text, URL session/query, helper fields, reader fields).
const CANARY = Object.freeze({ title: 'TITLECANARY4471', body: 'BODYCANARY8812', session: 'SESSIONCANARY3301', query: 'QUERYCANARY5528', helper: 'HELPERCANARY9914', reader: 'READERCANARY2207' });
const PRIVATE = [...Object.values(CANARY), SECRET.password, F.IDENTITY.number, F.IDENTITY.branch, 'カクウ', 'FICT', 'jsessionid', 'anser.ne.jp', 'houjinportal', 'sihd-bk', 'Senshu', 'BLGI', 'oauth', 'ログイン', '電子証明書', 'http'];
const UNKNOWN_PATH = '/BIZ_0CA0600/rblgi01/BLGI999-Notice', STALL_PATH = '/BIZ_0CA0600/rblgi01/BLGI998-Busy';
const today = F.jstNow(), availableFrom = F.monthBeforeLast(today);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-ikeda-diagnostics-test-'));
test.after(async () => { if (path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(temp, { recursive: true, force: true }).catch(() => {}); });

// ── the fictional BusinessGate plus two invented cc documents the helper seam may navigate to ──
function site(options = {}) {
  const s = F.businessGate({ cert: 'manual', today, ...options }), original = s.respond;
  const html = (request, body) => request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body });
  s.respond = request => {
    let url; try { url = new URL(request.url()); } catch { return request.abort(); }
    const p = url.pathname.split(';')[0];
    if (url.origin === F.CC && p === UNKNOWN_PATH) { s.stats.requests.push('GET ' + url.origin + p); return html(request, `<!doctype html><html lang="ja"><meta charset="utf-8"><title>${CANARY.title}</title><body><h2>${CANARY.body}</h2><input type="password" name="other"><button>次へ</button></body></html>`); }
    if (url.origin === F.CC && p === STALL_PATH) { s.stats.requests.push('GET ' + url.origin + p); return html(request, `<!doctype html><html><meta charset="utf-8"><title>${CANARY.title}</title><body>${CANARY.body}<script>setTimeout(()=>{for(;;){}},200)</script></body></html>`); }
    return original(request);
  };
  return s;
}
// The signed-in home of the fictional BusinessGate replaced by a 各口座残高 dashboard (the shape of bank-balance.test.mjs ikedaSite).
function dashboardSite(s) {
  const at = new Date(Date.now() + 9 * 3600000 - 120000).toISOString(), shown = at.slice(0, 10) + ' ' + at.slice(11, 16), inner = s.respond;
  const card = `<div class="card"><p>${F.IDENTITY.branch} ${F.IDENTITY.type} ${F.IDENTITY.number}</p><p>¥5,550,000</p><p>前日比 <span>▲</span>￥12,000</p><p>最終取得日：${shown}</p></div>`;
  s.respond = request => {
    let url; try { url = new URL(request.url()); } catch { return request.abort(); }
    if (url.origin === F.PORTAL && url.pathname === '/' && s.stats.loggedIn) { s.stats.requests.push('GET ' + url.origin + '/'); return request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="ja"><meta charset="utf-8"><title>池田泉州ビジネスゲート</title><body><div id="app"></div><script>setTimeout(()=>{document.getElementById('app').innerHTML=${JSON.stringify(`<nav><a href="${F.BANKSITE}/corporation/">ログアウト</a></nav><section id="DsbAccounts"><h2>各口座残高</h2>${card}</section>`)};},700)</script></body></html>` }); }
    return inner(request);
  };
  return s;
}
// The fictional helper seam. `mode`: 'select' (answers like the real helper: the page moves on to the cc form), 'no-dialog', 'attention'
// (with `reason`), 'throw', 'hostile' (unknown outcome and extra fields), 'unknown' (selected, while the page moves to an invented unknown cc
// document) and 'hang' (moves the page to a stalled renderer and never answers until aborted).
const helperOf = (mode = 'select', reason = 'expired') => s => {
  const calls = [];
  const go = async target => { for (let i = 0; i < 40; i++) { let moved = false; for (const p of s.pages) moved = (await p.evaluate(to => { if (window.__certificatePending) { location.href = to; return true; } return false; }, target).catch(() => false)) || moved; if (moved) return; await new Promise(r => setTimeout(r, 150)); } };
  const fn = async (browser, options) => {
    calls.push({ issuer: options.issuer });
    if (mode === 'select') { for (let i = 0; i < 40; i++) { let moved = false; for (const p of s.pages) moved = (await s.selectCertificate(p).catch(() => false)) || moved; if (moved) break; await new Promise(r => setTimeout(r, 150)); } return { outcome: 'selected', reason: null }; }
    if (mode === 'no-dialog') return { outcome: 'no-dialog', reason: null };
    if (mode === 'attention') return { outcome: 'attention', reason, detail: CANARY.helper };
    if (mode === 'hostile') return { outcome: CANARY.helper, reason: CANARY.helper, url: 'https://x.example/?' + CANARY.helper };
    if (mode === 'throw') throw new Error(CANARY.helper);
    if (mode === 'unknown') { await go(F.CC + UNKNOWN_PATH + ';jsessionid=' + CANARY.session + '?q=' + CANARY.query); return { outcome: 'selected', reason: null }; }
    if (mode === 'hang') { await go(F.CC + STALL_PATH + ';jsessionid=' + CANARY.session); return new Promise(resolve => options.signal?.addEventListener('abort', () => resolve({ outcome: 'aborted', reason: null }), { once: true })); }
    throw new Error('unknown helper mode');
  };
  fn.calls = calls; return fn;
};
async function owned(s, fn) {
  const profile = path.join(temp, 'profile-' + randomUUID().slice(0, 8));
  const browser = await puppeteer.launch({ executablePath: findChrome(), pipe: true, headless: true, userDataDir: profile, defaultViewport: null, protocolTimeout: 30000, args: [...LAUNCH_ARGS, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
  const child = browser.process();
  try {
    const page = await s.attach(await browser.newPage()); let shows = 0;
    page.bringToFront = async () => { shows++; }; // no window is ever brought to the front by this test
    return await fn({ page, browser, shows: () => shows });
  } finally {
    await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 10000))]);
    if (child && child.exitCode === null && child.signalCode === null) { try { child.kill(); } catch { /* gone */ } }
  }
}
function savedLogin(state = 'ready') {
  const calls = { state: 0, open: 0, rejected: [], accepted: 0 }; let current = state;
  return { calls, async state() { calls.state++; return current; }, async open() { calls.open++; return { ...SECRET }; }, async rejected(kind = 'uncertain') { calls.rejected.push(kind); current = kind === 'refused' ? 'refused' : 'blocked'; }, async accepted() { calls.accepted++; current = 'ready'; } };
}
const snapshotOf = (extra = {}) => ({ templateId: 't', templateRevision: 1, headers: [...F.CSV_HEADER], mapping: { date: '0', description: '9', outflow: '2', inflow: '3', balance: '4' }, amountSign: 'outflow-positive', transactionIdConfirmed: false, parserVersion: 'bank-template-1', currency: 'JPY', provider: 'ikeda', accountLabel: null, variant: 'portal', coverage: { from: availableFrom, to: today }, requestedCoverage: { from: availableFrom, to: null }, availability: { rule: 'month-before-last', from: availableFrom, asOf: today }, missingCoverage: null, accountIdentity: { ...F.IDENTITY }, ...extra });
const statementJob = () => { const snapshot = snapshotOf(); return { jobId: randomUUID(), kind: 'retrieve', snapshot, snapshotHash: sha256(JSON.stringify(snapshot)), provider: 'ikeda' }; };
const balanceJob = () => { const snapshot = { kind: 'balance', parserVersion: 'bank-balance-1', provider: 'ikeda', variant: 'portal', currency: 'JPY', accountIdentity: { ...F.IDENTITY } }; return { jobId: randomUUID(), kind: 'balance', snapshot, snapshotHash: sha256(JSON.stringify(snapshot)), provider: 'ikeda' }; };
const boundOf = (job, account = ACCOUNT) => ({ bankAccountId: account, ownerId: OWNER, origin: OMF, jobId: job.jobId, snapshotHash: job.snapshotHash, provider: 'ikeda' });
const STEP = { certificateMs: 4000, settleMs: 20000, stableMs: 1500, stepMs: 25000, searchMs: 30000, finishMs: 8000 };
// `wrap` may replace parts of the shipped ui (a broken or hostile reader, no reader).
const statementAdapter = (helper, wrap = ui => ui) => ({ ...ikeda.portal, ui(page, browser, snapshot) { return wrap(ikeda.portalUi(page, browser, this, snapshot, { certificate: helper, ...STEP })); } });
const balanceAdapter = (helper, wrap = ui => ui) => ({ ...ikeda.portalBalance, ui(page, browser, snapshot) { return wrap(ikeda.portalBalanceUi(page, browser, this, snapshot, { certificate: helper, ...STEP, readMs: 12000 })); } });
const withoutReader = ui => { const { authDiagnostic, ...rest } = ui; void authDiagnostic; return rest; };
async function records(root, account = ACCOUNT) {
  const dir = path.join(root, 'diagnostics', 'bank', account); let names = [];
  try { names = await readdir(dir); } catch { return []; }
  return Promise.all(names.sort().map(async n => { const text = await readFile(path.join(dir, n), 'utf8'); return { ...JSON.parse(text), __text: text, __name: n }; }));
}
async function newRoot(prefix = 'root') { const root = path.join(temp, prefix + '-' + randomUUID().slice(0, 8)); await mkdir(root, { recursive: true }); return root; }
async function statement({ mode = 'select', reason, wrap, loginTimeoutMs = 9000, root = null, job = statementJob(), account = ACCOUNT, abortAfterMs = null } = {}) {
  root ??= await newRoot(); const s = site(), helper = helperOf(mode, reason)(s), login = savedLogin(), statuses = [];
  return owned(s, async ({ page, browser, shows }) => {
    let result = null, error = null; const started = Date.now(), ac = new AbortController(); if (abortAfterMs) setTimeout(() => ac.abort(), abortAfterMs);
    try { result = await bank.collectBankFromPage(page, browser, statementAdapter(helper, wrap), boundOf(job, account), job, root, async (state, text) => { statuses.push([state, text]); }, { login, pollMs: 300, loginTimeoutMs, downloadTimeoutMs: 30000, extensionMs: 0, ...(abortAfterMs ? { signal: ac.signal } : {}) }); } catch (e) { error = e; }
    const elapsed = Date.now() - started, atReturn = await records(root, account), open = browser.connected && !page.isClosed();
    return { result, error, statuses, root, job, login, stats: s.stats, helper, elapsed, atReturn, open, shows: shows() };
  });
}
async function balance({ mode = 'select', reason, wrap, root = null, job = balanceJob(), account = ACCOUNT } = {}) {
  root ??= await newRoot(); const s = dashboardSite(site()), helper = helperOf(mode, reason)(s), login = savedLogin(), statuses = [], readings = [];
  return owned(s, async ({ page, browser, shows }) => {
    let result = null, error = null; const started = Date.now();
    try { result = await B.inquireFromPage(page, browser, balanceAdapter(helper, wrap), boundOf(job, account), job, root, async (state, text) => { statuses.push([state, text]); }, { login, loginTimeoutMs: 45000, settleMs: 3000, onReading: async r => { readings.push(r); } }); } catch (e) { error = e; }
    const elapsed = Date.now() - started, atReturn = await records(root, account), open = browser.connected && !page.isClosed();
    return { result, error, statuses, readings, root, job, login, stats: s.stats, helper, elapsed, atReturn, open, shows: shows() };
  });
}

// ── the fixed, value-free record ──
const TOP_KEYS = ['schema', 'at', 'provider', 'variant', 'bankAccountId', 'jobId', 'outcome', 'step', 'code', 'page', 'finish', 'auth'];
const AUTH_KEYS = ['attention', 'dropped', 'events', 'current'], EVENT_KEYS = ['event', 'ms', 'surface', 'kind', 'outcome', 'reason', 'ok', 'readable', 'dialog', 'documents', 'password', 'certificate', 'logout'];
const CURRENT_KEYS = ['readable', 'dialog', 'surface', 'kind', 'password', 'certificate', 'logout'];
function fixedAuthSchema(r, label) {
  assert.deepEqual(Object.keys(r).filter(k => !k.startsWith('__')).sort(), [...TOP_KEYS].sort(), 'ikeda-diag:fixed-schema top ' + label);
  assert.ok(r.auth && typeof r.auth === 'object', 'ikeda-diag:auth-present ' + label);
  assert.deepEqual(Object.keys(r.auth).sort(), [...AUTH_KEYS].sort(), 'ikeda-diag:fixed-schema auth ' + label);
  assert.ok(Array.isArray(r.auth.events) && r.auth.events.length <= 40, 'ikeda-diag:events-capped ' + label);
  for (const e of r.auth.events) assert.deepEqual(Object.keys(e).sort(), [...EVENT_KEYS].sort(), 'ikeda-diag:fixed-schema event ' + label);
  if (r.auth.current) assert.deepEqual(Object.keys(r.auth.current).sort(), [...CURRENT_KEYS].sort(), 'ikeda-diag:fixed-schema current ' + label);
}
function privateFree(text, label) { for (const v of PRIVATE) assert.ok(!text.includes(v), 'ikeda-diag:no-private ' + label + ' ' + v); }
const events = (r, name) => (r.auth?.events || []).filter(e => e.event === name);
const exactlyOne = async (root, label, account = ACCOUNT) => { const list = await records(root, account); assert.equal(list.length, 1, 'ikeda-diag:one-record ' + label + ' (' + list.length + ')'); return list[0]; };
const manualText = reason => ikeda.PORTAL_TEXT.manual(LABEL, reason);
const unfinished = `${LABEL}へのサインインが完了しませんでした。再度「取得」を押してください`;
// Chrome's own favicon fetches are not the adapter's requests (their number depends on timing); everything else is compared.
const requestsOf = stats => stats.requests.filter(x => !x.endsWith('/favicon.ico')).sort();

test('record (pure): an auth trace passes only through the fixed whitelist — unknown keys, raw strings, URLs and long lists never pass; records without one keep the earlier shape', () => {
  const hostile = { attention: 'certificate-' + CANARY.reader, dropped: 3, extra: CANARY.reader, current: { readable: true, surface: 'https://x/' + CANARY.reader, kind: CANARY.reader, password: 999, title: CANARY.reader },
    events: Array.from({ length: 60 }, (_, i) => ({ event: i ? 'moved' : CANARY.reader, ms: 1234, surface: 'password-form', kind: 'login', outcome: CANARY.reader, reason: CANARY.reader, ok: 'yes', url: CANARY.reader, documents: 2 })) };
  const rec = bank.diagnosticRecord({ bound: { provider: 'ikeda', bankAccountId: ACCOUNT, jobId: randomUUID() }, variant: 'portal', at: new Date(0).toISOString(), outcome: 'failed', step: 'login', code: 'login-refused', auth: hostile });
  fixedAuthSchema(rec, 'pure'); privateFree(JSON.stringify(rec), 'pure');
  assert.equal(rec.step, 'login', 'ikeda-diag:login-step-recorded');
  assert.equal(rec.auth.events.length, 40, 'ikeda-diag:events-capped 40'); assert.equal(rec.auth.dropped, 23, 'ikeda-diag:dropped-counted');
  assert.deepEqual([rec.auth.events[0].event, rec.auth.events[1].event, rec.auth.events[1].outcome, rec.auth.events[1].ok, rec.auth.events[1].surface, rec.auth.attention], ['other', 'moved', 'other', null, 'password-form', 'other'], 'ikeda-diag:whitelist-values');
  assert.deepEqual([rec.auth.current.surface, rec.auth.current.kind, rec.auth.current.password], ['other', 'other', 99], 'ikeda-diag:whitelist-current');
  assert.equal(bank.diagnosticRecord({ bound: {}, at: 'x', outcome: 'failed', step: 'login', auth: null }).auth, null, 'ikeda-diag:unreadable-trace-null');
  assert.equal('auth' in bank.diagnosticRecord({ bound: {}, at: 'x', outcome: 'failed', step: 'period' }), false, 'ikeda-diag:no-auth-key-without-trace (PayPay records unchanged)');
});

test('statement, selected and the page moves on: one submission, logout once, the export unchanged; the record keeps the helper result, the recognized password form and the direct sign-in — and adds no request, click or submission', { timeout: 300000 }, async () => {
  const r = await statement();
  assert.equal(r.error, null, 'ikeda-diag:success-no-error ' + String(r.error?.message || '')); assert.equal(r.result.failed, null, 'ikeda-diag:success-not-failed ' + r.result.failed);
  assert.deepEqual([r.stats.ccPosts.length, r.stats.certClicks, r.login.calls.open, r.stats.loggedOut, r.shows], [1, 1, 1, true, 0], 'ikeda-diag:success-invariants');
  assert.ok(r.atReturn.length === 1 && r.open, 'ikeda-diag:recorded-before-cleanup (records at return: ' + r.atReturn.length + ')');
  const d = await exactlyOne(r.root, 'success'); fixedAuthSchema(d, 'success'); privateFree(d.__text, 'success');
  assert.deepEqual([d.provider, d.variant, d.outcome, d.step, d.code, d.jobId, d.bankAccountId, d.page], ['ikeda', 'portal', 'completed', 'complete', null, r.job.jobId, ACCOUNT, null], 'ikeda-diag:success-record');
  assert.deepEqual([d.finish.settled, d.finish.loggedOut], [true, true], 'ikeda-diag:success-finish-kept');
  assert.deepEqual(events(d, 'helper-result').map(e => e.outcome), ['selected'], 'ikeda-diag:helper-selected');
  assert.ok(events(d, 'moved').some(e => e.ok === true && e.kind === 'login' && e.surface === 'password-form'), 'ikeda-diag:recognized-password-form ' + JSON.stringify(events(d, 'moved')));
  assert.ok(events(d, 'entry').some(e => e.surface === 'certificate-entry' && e.certificate === 1), 'ikeda-diag:certificate-entry ' + JSON.stringify(events(d, 'entry')));
  assert.deepEqual([events(d, 'press')[0]?.ok, events(d, 'submitted').length, events(d, 'settle')[0]?.outcome, d.auth.attention], [true, 1, 'authenticated', null], 'ikeda-diag:success-login-trace');
  assert.ok(events(d, 'open-end').length === 1 && events(d, 'open-end')[0].ms >= events(d, 'open')[0].ms, 'ikeda-diag:open-timed');
  // the same job without the reader: the same requests, posts and clicks (the trace observes, it never acts)
  const bare = await statement({ wrap: withoutReader });
  assert.equal(bare.result?.failed, null, 'ikeda-diag:bare-success'); assert.deepEqual(await records(bare.root), [], 'ikeda-diag:no-reader-no-record');
  const shape = x => [requestsOf(x.stats), x.stats.ccPosts, x.stats.certClicks, x.stats.searches.length, x.stats.csvServed, x.stats.typedLogin];
  assert.deepEqual(shape(r), shape(bare), 'ikeda-diag:no-extra-request-or-action');
});

test('statement, pre-password failures (no chooser, the helper\'s attention, a throwing or hostile helper): the job fails exactly as before, nothing is submitted or logged out — and each keeps its login-stage record', { timeout: 400000 }, async () => {
  for (const [label, options, attention, outcome] of [['no-dialog', { mode: 'no-dialog' }, 'certificate-no-chooser', 'no-dialog'], ['attention', { mode: 'attention', reason: 'expired' }, 'certificate-expired', 'attention'], ['helper-error', { mode: 'throw' }, 'certificate-helper-error', 'attention'], ['hostile-helper', { mode: 'hostile' }, 'other', 'other']]) {
    const r = await statement(options);
    assert.equal(r.result, null, 'ikeda-diag:pre-password-no-result ' + label); assert.equal(r.error?.message, unfinished, 'ikeda-diag:pre-password-same-error ' + label + ' ' + String(r.error?.message));
    if (attention !== 'other') assert.deepEqual(r.statuses.find(([st]) => st === 'verification_required'), ['verification_required', manualText(attention)], 'ikeda-diag:pre-password-same-text ' + label);
    assert.deepEqual([r.stats.ccPosts.length, r.login.calls.open, r.login.calls.rejected, r.stats.loggedOut, r.stats.requests.some(x => x.includes('/corporation/'))], [0, 0, [], false, false], 'ikeda-diag:pre-password-nothing-sent-no-logout ' + label);
    assert.ok(r.open && r.atReturn.length === 1, 'ikeda-diag:login-stage-persisted ' + label + ' (records at return: ' + r.atReturn.length + ')');
    const d = r.atReturn[0]; fixedAuthSchema(d, label); privateFree(d.__text, label);
    assert.deepEqual([d.outcome, d.step, d.code, d.page, d.finish.settled, d.auth.attention], ['failed', 'login', 'uncoded', null, false, attention], 'ikeda-diag:login-stage-record ' + label);
    assert.deepEqual(events(d, 'helper-result').map(e => e.outcome), [outcome], 'ikeda-diag:helper-result ' + label);
    assert.ok(events(d, 'state').some(e => e.kind === 'unknown'), 'ikeda-diag:state-kind ' + label);
    assert.equal(d.auth.current?.surface, 'certificate-entry', 'ikeda-diag:current-surface ' + label);
  }
});

test('statement, selected while the page moves to an unknown document, or a helper that never answers while the renderer stalls (both the generic certificate-unconfirmed): the job fails as before; the record tells the two apart without keeping the page', { timeout: 600000 }, async () => {
  const u = await statement({ mode: 'unknown', loginTimeoutMs: 32000 });
  assert.equal(u.error?.message, unfinished, 'ikeda-diag:unknown-same-error ' + String(u.error?.message)); assert.deepEqual(u.statuses.find(([st]) => st === 'verification_required'), ['verification_required', manualText('certificate-unconfirmed')], 'ikeda-diag:unknown-same-text');
  assert.deepEqual([u.stats.ccPosts.length, u.login.calls.open, u.stats.loggedOut], [0, 0, false], 'ikeda-diag:unknown-nothing-sent');
  const du = await exactlyOne(u.root, 'unknown'); fixedAuthSchema(du, 'unknown'); privateFree(du.__text, 'unknown');
  assert.deepEqual([du.step, du.auth.attention, events(du, 'helper-result').map(e => e.outcome), events(du, 'race')[0]?.outcome], ['login', 'certificate-unconfirmed', ['selected'], 'helper'], 'ikeda-diag:unknown-selected');
  const mu = events(du, 'moved').at(-1); assert.deepEqual([mu?.ok, mu?.readable, mu?.surface, mu?.kind, mu?.password, mu?.documents], [false, true, 'cc-other', 'unknown', 1, 1], 'ikeda-diag:unknown-transition ' + JSON.stringify(mu));
  const h = await statement({ mode: 'hang', loginTimeoutMs: 38000 });
  assert.equal(h.error?.message, unfinished, 'ikeda-diag:stall-same-error ' + String(h.error?.message)); assert.deepEqual([h.stats.ccPosts.length, h.login.calls.open, h.stats.loggedOut], [0, 0, false], 'ikeda-diag:stall-nothing-sent');
  const dh = await exactlyOne(h.root, 'stall'); fixedAuthSchema(dh, 'stall'); privateFree(dh.__text, 'stall');
  assert.deepEqual([dh.step, dh.auth.attention, events(dh, 'race')[0]?.outcome, events(dh, 'helper-result').map(e => e.outcome)], ['login', 'certificate-unconfirmed', 'page', ['aborted']], 'ikeda-diag:stall-helper-never-answered');
  const mh = events(dh, 'moved').at(-1); assert.deepEqual([mh?.ok, mh?.readable], [false, false], 'ikeda-diag:stalled-renderer ' + JSON.stringify(mh));
  assert.equal(dh.auth.current?.readable, false, 'ikeda-diag:stalled-current-unreadable');
});

test('statement, a cancelled sign-in: the same AbortError, nothing submitted, no logout; the login-stage record says aborted', { timeout: 300000 }, async () => {
  const r = await statement({ mode: 'no-dialog', loginTimeoutMs: 30000, abortAfterMs: 2500 });
  assert.equal(r.error?.name, 'AbortError', 'ikeda-diag:abort-same-error ' + String(r.error?.name)); assert.deepEqual([r.stats.ccPosts.length, r.login.calls.open, r.stats.loggedOut], [0, 0, false], 'ikeda-diag:abort-nothing-sent');
  const d = await exactlyOne(r.root, 'abort'); fixedAuthSchema(d, 'abort'); assert.deepEqual([d.step, d.code, d.finish.settled], ['login', 'aborted', false], 'ikeda-diag:abort-record');
});

test('balance, pre-password failures and an unknown transition: the same never-shown failed result, nothing submitted, no logout — and a login-stage record with the helper result', { timeout: 600000 }, async () => {
  for (const [label, options, attention] of [['no-dialog', { mode: 'no-dialog' }, 'certificate-no-chooser'], ['attention', { mode: 'attention', reason: 'ambiguous' }, 'certificate-ambiguous'], ['unknown', { mode: 'unknown' }, 'certificate-unconfirmed']]) {
    const r = await balance(options);
    assert.equal(r.error, null, 'ikeda-diag:balance-no-throw ' + label + ' ' + String(r.error?.message));
    assert.deepEqual(r.result, { failed: B.BALANCE_TEXT.attention(LABEL, manualText(attention)), reading: null, logout: null }, 'ikeda-diag:balance-same-result ' + label);
    assert.deepEqual([r.stats.ccPosts.length, r.login.calls.open, r.stats.loggedOut, r.shows, r.readings.length], [0, 0, false, 0, 0], 'ikeda-diag:balance-nothing-sent-never-shown ' + label);
    assert.ok(!r.statuses.some(([st]) => st === 'verification_required'), 'ikeda-diag:balance-never-asks ' + label);
    assert.ok(r.open && r.atReturn.length === 1, 'ikeda-diag:balance-login-stage-persisted ' + label + ' (records at return: ' + r.atReturn.length + ')');
    const d = r.atReturn[0]; fixedAuthSchema(d, 'balance ' + label); privateFree(d.__text, 'balance ' + label);
    assert.deepEqual([d.provider, d.outcome, d.step, d.code, d.finish.settled, d.auth.attention], ['ikeda', 'failed', 'login', 'balance-attention', false, attention], 'ikeda-diag:balance-login-stage-record ' + label);
    assert.equal(events(d, 'helper-result').length, 1, 'ikeda-diag:balance-helper-result ' + label);
    assert.ok(!path.relative(path.join(r.root, 'outbox'), path.join(r.root, 'diagnostics')).startsWith('.' + path.sep), 'ikeda-diag:balance-not-in-outbox');
  }
});

test('balance success: the exact reading, one submission, logout; the record is completed with the trace — the same requests as without the reader, and an adapter without the reader writes nothing', { timeout: 300000 }, async () => {
  const r = await balance();
  assert.equal(r.error, null, 'ikeda-diag:balance-success ' + String(r.error?.message)); assert.equal(r.result.failed, null, 'ikeda-diag:balance-success-not-failed ' + r.result.failed);
  assert.deepEqual([r.readings.length, r.readings[0]?.amount, r.stats.ccPosts.length, r.login.calls.open, r.login.calls.accepted, r.result.logout?.loggedOut, r.shows], [1, 5550000, 1, 1, 1, true, 0], 'ikeda-diag:balance-success-invariants');
  const d = await exactlyOne(r.root, 'balance-success'); fixedAuthSchema(d, 'balance-success'); privateFree(d.__text, 'balance-success');
  assert.deepEqual([d.outcome, d.step, d.code, d.finish.settled, d.finish.loggedOut, events(d, 'settle')[0]?.outcome], ['completed', 'complete', null, true, true, 'authenticated'], 'ikeda-diag:balance-success-record');
  assert.ok(!d.__text.includes('5550000') && !d.__text.includes('5,550,000'), 'ikeda-diag:no-amount');
  const bare = await balance({ wrap: withoutReader });
  assert.equal(bare.result?.failed, null); assert.deepEqual(await records(bare.root), [], 'ikeda-diag:balance-no-reader-no-record');
  assert.deepEqual([requestsOf(r.stats), r.stats.ccPosts], [requestsOf(bare.stats), bare.stats.ccPosts], 'ikeda-diag:balance-no-extra-request');
});

test('a broken diagnostic never changes the result, the submission count, cleanup or the logout: a throwing reader, a reader that never answers, a hostile reader, an unwritable diagnostics folder', { timeout: 900000 }, async () => {
  const throwing = ui => ({ ...ui, async authDiagnostic() { throw new Error(CANARY.reader); } });
  const hanging = ui => ({ ...ui, authDiagnostic: () => new Promise(resolve => setTimeout(() => resolve({ events: [] }), 60000)) });
  const hostile = ui => ({ ...ui, async authDiagnostic() { return { attention: CANARY.reader, events: [{ event: 'moved', url: 'https://x.example/' + CANARY.reader, reason: CANARY.reader, surface: CANARY.reader }], current: { title: CANARY.reader, surface: CANARY.reader } }; } });
  const t = await statement({ mode: 'no-dialog', wrap: throwing });
  assert.equal(t.error?.message, unfinished, 'ikeda-diag:throwing-reader-same-error'); const dt = await exactlyOne(t.root, 'throwing'); assert.equal(dt.auth, null, 'ikeda-diag:throwing-reader-null'); privateFree(dt.__text, 'throwing');
  const h = await statement({ mode: 'no-dialog', wrap: hanging }), bare = await statement({ mode: 'no-dialog', wrap: withoutReader });
  assert.equal(h.error?.message, unfinished, 'ikeda-diag:hanging-reader-same-error'); assert.equal(bare.error?.message, unfinished); assert.deepEqual(await records(bare.root), [], 'ikeda-diag:no-reader-no-login-record');
  assert.ok(h.elapsed - bare.elapsed < 9000, `ikeda-diag:diagnostic-bounded (${h.elapsed} ms vs ${bare.elapsed} ms without a reader)`);
  const x = await statement({ mode: 'no-dialog', wrap: hostile });
  assert.equal(x.error?.message, unfinished, 'ikeda-diag:hostile-same-error'); const dx = await exactlyOne(x.root, 'hostile'); fixedAuthSchema(dx, 'hostile'); privateFree(dx.__text, 'hostile reader');
  const hb = await balance({ mode: 'no-dialog', wrap: throwing });
  assert.deepEqual(hb.result, { failed: B.BALANCE_TEXT.attention(LABEL, manualText('certificate-no-chooser')), reading: null, logout: null }, 'ikeda-diag:balance-throwing-reader-same-result');
  // an unwritable diagnostics folder (a file in its way): success and failure keep their results, submissions and logout
  for (const [label, run, check] of [
    ['statement-success', root => statement({ root }), r => { assert.equal(r.result?.failed, null, 'ikeda-diag:unwritable-same-result statement'); assert.deepEqual([r.stats.ccPosts.length, r.stats.loggedOut], [1, true], 'ikeda-diag:unwritable-logout statement'); }],
    ['statement-failure', root => statement({ root, mode: 'no-dialog' }), r => { assert.equal(r.error?.message, unfinished, 'ikeda-diag:unwritable-same-result failure'); assert.equal(r.stats.ccPosts.length, 0); }],
    ['balance-success', root => balance({ root }), r => { assert.equal(r.result?.failed, null, 'ikeda-diag:unwritable-same-result balance'); assert.deepEqual([r.readings.length, r.result.logout?.loggedOut], [1, true], 'ikeda-diag:unwritable-logout balance'); }]]) {
    const root = await newRoot('blocked'); await writeFile(path.join(root, 'diagnostics'), 'not a folder');
    const r = await run(root); check(r); assert.equal(r.open, true, 'ikeda-diag:unwritable-returned ' + label);
  }
});

test('concurrent jobs of two accounts (a statement and a balance check, one root): each record is bound to its own account folder and job', { timeout: 300000 }, async () => {
  const root = await newRoot('shared'), sj = statementJob(), bj = balanceJob();
  const [s, b] = await Promise.all([statement({ root, job: sj, account: ACCOUNT, mode: 'no-dialog' }), balance({ root, job: bj, account: OTHER_ACCOUNT, mode: 'no-dialog' })]);
  assert.equal(s.error?.message, unfinished); assert.ok(b.result?.failed);
  const a = await records(root, ACCOUNT), o = await records(root, OTHER_ACCOUNT);
  assert.deepEqual([a.length, o.length], [1, 1], 'ikeda-diag:concurrent-one-each');
  assert.deepEqual([a[0].jobId, a[0].bankAccountId, o[0].jobId, o[0].bankAccountId], [sj.jobId, ACCOUNT, bj.jobId, OTHER_ACCOUNT], 'ikeda-diag:concurrent-bound');
  assert.ok(a[0].__name.startsWith(sj.jobId) && o[0].__name.startsWith(bj.jobId), 'ikeda-diag:concurrent-file-names');
});
