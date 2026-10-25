// collector/test/ikeda-portal.test.mjs — 池田泉州銀行 ビジネスゲート retrieval (plan omf-ikeda-collector-20261025): the portal adapter end to end
// through bank.collectBankFromPage on an owned HEADLESS Chrome, and the certificate helper. The fake BusinessGate (scripts/zoomer-fixtures/
// omf-ikeda-collector.mjs businessGate) is served by request interception on every page of that Chrome; host resolution is refused for
// everything else, so no bank or other site can be reached. Its DOM follows the public controls of the task's SAFE-CONTRACT only and proves
// nothing about the real portal. The certificate chooser does not exist in headless Chrome: the adapter's helper seam is a fictional one here,
// while the real helper is run (a) against this test's own headless Chrome (identity proven, no chooser) and wrong processes, and (b) its pure
// policy with fictional rows/certificates — no certificate store is read by any of this. Fictional password, account and statement values only.
// Under OMF_TEST_IKEDA_MODULE / OMF_TEST_BANK_MODULE / OMF_TEST_CERT_MODULE / OMF_TEST_POLICY_SCRIPT the named mutant copies are tested.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'rebrowser-puppeteer-core';

const moduleOf = (env, rel) => process.env[env] ? pathToFileURL(process.env[env]).href : new URL(rel, import.meta.url).href;
const ikeda = await import(moduleOf('OMF_TEST_IKEDA_MODULE', '../banks/ikeda.mjs'));
const bank = await import(moduleOf('OMF_TEST_BANK_MODULE', '../bank.mjs'));
const cert = await import(moduleOf('OMF_TEST_CERT_MODULE', '../bank-certificate.mjs'));
const { findChrome, LAUNCH_ARGS } = await import('../browser.mjs');
const F = await import(new URL('../../scripts/zoomer-fixtures/omf-ikeda-collector.mjs', import.meta.url).href);
const POLICY = process.env.OMF_TEST_POLICY_SCRIPT || fileURLToPath(new URL('../windows/bank-certificate-policy.ps1', import.meta.url));

const OWNER = 'd5d5d5d5d5d5d5d5d5d5d5d5', ACCOUNT = 'c1c1c1c1c1c1c1c1c1c1c1c1', OMF = 'https://omf.example';
const SECRET = Object.freeze({ password: 'Fict-Pw-12' });
const today = F.jstNow(), availableFrom = F.monthBeforeLast(today);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = p => access(p).then(() => true, () => false);
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-ikeda-portal-test-'));
test.after(async () => { if (path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(temp, { recursive: true, force: true }); });

async function owned(site, fn) {
  const profile = path.join(temp, 'profile-' + randomUUID().slice(0, 8));
  const browser = await puppeteer.launch({ executablePath: findChrome(), pipe: true, headless: true, userDataDir: profile, defaultViewport: null, protocolTimeout: 30000, args: [...LAUNCH_ARGS, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
  try { const page = await site.attach(await browser.newPage()); return await fn({ page, browser }); }
  finally { await browser.close().catch(() => {}); }
}
function savedLogin(state = 'ready') {
  const calls = { state: 0, open: 0, rejected: [], accepted: 0 }; let current = state;
  return { calls, async state() { calls.state++; return current; }, async open() { calls.open++; return { ...SECRET }; }, async rejected(kind = 'uncertain') { calls.rejected.push(kind); current = kind === 'refused' ? 'refused' : 'blocked'; }, async accepted() { calls.accepted++; current = 'ready'; }, get current() { return current; } };
}
const snapshotOf = (extra = {}) => ({ templateId: 't', templateRevision: 1, headers: [...F.CSV_HEADER], mapping: { date: '0', description: '9', outflow: '2', inflow: '3', balance: '4' }, amountSign: 'outflow-positive', transactionIdConfirmed: false, parserVersion: 'bank-template-1', currency: 'JPY', provider: 'ikeda', accountLabel: null, variant: 'portal', coverage: { from: availableFrom, to: today }, requestedCoverage: { from: availableFrom, to: null }, availability: { rule: 'month-before-last', from: availableFrom, asOf: today }, missingCoverage: null, accountIdentity: { ...F.IDENTITY }, ...extra });
const jobOf = (extra = {}) => { const snapshot = snapshotOf(extra); return { jobId: randomUUID(), kind: 'retrieve', snapshot, snapshotHash: sha256(JSON.stringify(snapshot)), provider: 'ikeda' }; };
const boundOf = job => ({ bankAccountId: ACCOUNT, ownerId: OWNER, origin: OMF, jobId: job.jobId, snapshotHash: job.snapshotHash, provider: 'ikeda' });
// The fictional chooser helper: 'select' answers the chooser like the real helper (the navigation proceeds), others report attention.
const chooser = (site, mode = 'select', reason = 'ambiguous') => { const calls = []; const fn = async (browser, options) => { calls.push({ pid: browser?.process?.()?.pid ?? null, issuer: options.issuer }); if (mode === 'select') { for (let i = 0; i < 40; i++) { let moved = false; for (const p of site.pages) moved = (await site.selectCertificate(p).catch(() => false)) || moved; if (moved) break; await new Promise(r => setTimeout(r, 150)); } return { outcome: 'selected', reason: null }; } return { outcome: 'attention', reason }; }; fn.calls = calls; return fn; };
const adapterOf = (o = {}) => ({ ...ikeda.portal, ui(page, browser, snapshot) { return ikeda.portalUi(page, browser, this, snapshot, { certificateMs: 4000, settleMs: 20000, stableMs: 1500, stepMs: 25000, searchMs: 30000, finishMs: 8000, ...o }); } });
async function collect(siteOptions = {}, { job = jobOf(), login = savedLogin(), helper = null, person = null, root = null, ui = {}, ...rest } = {}) {
  const site = F.businessGate({ cert: 'manual', today, ...siteOptions }), certificate = helper ? helper(site) : chooser(site);
  root ??= path.join(temp, 'root-' + randomUUID().slice(0, 8)); await mkdir(root, { recursive: true }); const statuses = [];
  return owned(site, async ({ page, browser }) => {
    const status = async (state, text) => { statuses.push([state, text]); if (state === 'verification_required' && person) setTimeout(() => person(site, page).catch(() => {}), 400); };
    let result = null, error = null;
    try { result = await bank.collectBankFromPage(page, browser, adapterOf({ certificate, ...ui }), boundOf(job), job, root, status, { login, pollMs: 300, loginTimeoutMs: 40000, downloadTimeoutMs: 30000, extensionMs: 0, ...rest }); } catch (e) { error = e; }
    const jobDir = path.join(root, 'outbox', 'bank', ACCOUNT, job.jobId);
    return { site, stats: site.stats, result, error, statuses, login, job, root, jobDir, certificate, browserPid: browser.process()?.pid };
  });
}
const files = async dir => (await exists(dir)) ? await readdir(dir) : [];

test('portal: certificate login, the saved password once on the visible cc form, exact account, calendar period, counted Shift_JIS CSV, manifest and logout', async () => {
  const r = await collect();
  assert.equal(r.error, null, 'ikeda-portal:no-error ' + String(r.error?.message || '')); assert.equal(r.result.failed, null, 'ikeda-portal:not-failed ' + r.result.failed);
  const m = r.result.items[0].manifest, bytes = await readFile(path.join(r.jobDir, m.filename));
  assert.deepEqual([m.jobId, m.snapshotHash, m.sourceHost, m.period, m.sha256], [r.job.jobId, r.job.snapshotHash, 'www.0161.houjinportal.anser.ne.jp', availableFrom + '〜' + today, sha256(bytes)], 'ikeda-portal:manifest-bound');
  assert.deepEqual(F.csvBytes(r.site.rows.filter(x => x.acct === 'A4')), bytes, 'ikeda-portal:exact-bytes');
  assert.deepEqual(r.stats.ccPosts, [{ ok: true, keyboardOff: true }], 'ikeda-portal:one-submission');
  assert.deepEqual([r.stats.publicPosts, r.stats.hiddenPosts, r.stats.foreign.length, r.stats.certClicks], [0, 0, 0, 1], 'ikeda-portal:no-public-hidden-foreign');
  assert.deepEqual(r.stats.searches.map(s => [s.acct, s.mode, s.from, s.to]), [['A4', '2', availableFrom, today]], 'ikeda-portal:exact-account-range-calendar');
  assert.equal(r.stats.loggedOut, true, 'ikeda-portal:logout');
  assert.deepEqual([r.login.calls.open, r.login.calls.rejected, r.login.calls.accepted], [1, ['uncertain'], 1], 'ikeda-portal:marker-before-submit-cleared-after-direct-sign-in');
  assert.equal(r.certificate.calls.length, 1, 'ikeda-portal:one-chooser'); assert.equal(r.certificate.calls[0].pid, r.browserPid, 'ikeda-portal:owned-chrome'); assert.equal(r.certificate.calls[0].issuer, 'The Senshu Ikeda Bank, Ltd. CA - G4');
  const attempt = JSON.parse(await readFile(path.join(r.jobDir, 'attempt.json'), 'utf8'));
  assert.deepEqual(attempt.expect, { rows: 3, from: availableFrom, to: today }, 'ikeda-portal:expectation-journaled');
  const recorded = JSON.stringify([r.statuses, m, attempt, JSON.parse(await readFile(path.join(r.jobDir, 'download.json'), 'utf8'))]);
  assert.doesNotMatch(recorded, /jsessionid|FICT0001|FICTCODE|FICTSTATE|Fict-Pw|0000001|カクウ株式会社/, 'ikeda-portal:no-session-or-account-data');
  assert.deepEqual(JSON.parse(await readFile(path.join(r.jobDir, 'download.json'), 'utf8')).origin, F.PORTAL, 'ikeda-portal:blob-origin-recorded');
});
test('portal: a result shown before this job\'s 検索する (全9件) never counts; the job waits for its own result and exports exactly that', async () => {
  const r = await collect({ staleResult: true });
  assert.equal(r.result?.failed ?? null, null, 'ikeda-portal:stale-result ' + String(r.result?.failed || r.error?.message));
  assert.deepEqual(JSON.parse(await readFile(path.join(r.jobDir, 'attempt.json'), 'utf8')).expect.rows, 3, 'ikeda-portal:stale-result-own-count');
});
test('portal: a chooser the helper cannot answer (ambiguous) asks the person in the same window; the password is sent once only after the cc form appears', async () => {
  const r = await collect({}, { helper: site => chooser(site, 'attention', 'ambiguous'), person: async (site, page) => { await site.selectCertificate(page); } });
  assert.equal(r.error, null, 'ikeda-portal:attention-run ' + String(r.error?.message || '')); assert.equal(r.result.failed, null);
  const asked = r.statuses.find(([s]) => s === 'verification_required'); assert.match(asked?.[1] || '', /電子証明書を自動で選べませんでした（該当する証明書が複数あります）/, 'ikeda-portal:certificate-attention-text');
  assert.deepEqual([r.stats.ccPosts.length, r.login.calls.open], [1, 1], 'ikeda-portal:attention-then-one-submission');
});
test('portal: no person answers the chooser — nothing is submitted, the job ends without a statement', async () => {
  const r = await collect({}, { helper: site => chooser(site, 'attention', 'expired'), loginTimeoutMs: 6000 });
  assert.ok(r.error || r.result?.failed, 'ikeda-portal:unanswered-ends'); assert.deepEqual([r.stats.ccPosts.length, r.login.calls.open, r.stats.csvServed], [0, 0, 0], 'ikeda-portal:unanswered-nothing-sent');
  assert.match(r.statuses.find(([s]) => s === 'verification_required')?.[1] || '', /有効期間外/, 'ikeda-portal:expired-text');
});
test('portal: the account is chosen by its full identity — a suffix, another branch or type, or no match never selects; nothing is exported', async () => {
  const r = await collect({}, { job: jobOf({ accountIdentity: { branch: 'カクウ支店', type: '普通', number: '0000002' } }) });
  assert.match(String(r.result?.failed || ''), /口座を1つに特定できません（見つかりません）/, 'ikeda-portal:account-missing ' + String(r.result?.failed || r.error?.message));
  assert.deepEqual([r.stats.searches.length, r.stats.csvServed], [0, 0], 'ikeda-portal:account-nothing-exported'); assert.equal(r.stats.loggedOut, true, 'ikeda-portal:account-logout');
  const C = ikeda.portalAccountChoice, I = { branch: 'カクウ支店', type: '普通', number: '0000001' };
  assert.deepEqual(C(F.ACCOUNTS, I), { index: 3, reason: 'exact' }, 'ikeda-portal:choice-exact');
  assert.equal(C(F.ACCOUNTS.slice(0, 3), I).index, -1, 'ikeda-portal:choice-no-suffix-other-branch-type');
  assert.equal(C([...F.ACCOUNTS, { text: 'カクウ支店 普通 0000001 重複（架空）' }], I).reason, 'ambiguous', 'ikeda-portal:choice-ambiguous');
  assert.equal(C([{ text: 'カクウ支店 普通 0000001', disabled: true }], I).index, -1, 'ikeda-portal:choice-disabled');
  assert.equal(C(F.ACCOUNTS, null).reason, 'identity');
});
test('portal: a refusal is remembered and nothing is submitted again; a later job with the refused marker sends nothing', async () => {
  const r = await collect({ loginOutcome: 'refuse' }, { loginTimeoutMs: 12000 });
  assert.match(String(r.result?.failed || ''), /受け付けませんでした/, 'ikeda-portal:refused-text ' + String(r.result?.failed || r.error?.message));
  assert.deepEqual([r.stats.ccPosts.length, r.login.calls.rejected], [1, ['uncertain', 'refused']], 'ikeda-portal:refused-marker');
  const again = await collect({}, { login: savedLogin('refused'), loginTimeoutMs: 6000 });
  assert.deepEqual([again.stats.ccPosts.length, again.login.calls.open], [0, 0], 'ikeda-portal:refused-not-resent');
});
test('portal: an unconfirmed sign-in (a notice page) keeps the uncertain marker and exports nothing; a reclaimed job never submits again', async () => {
  const r = await collect({ loginOutcome: 'uncertain' }, { loginTimeoutMs: 12000 });
  assert.ok(r.result?.failed, 'ikeda-portal:uncertain-failed'); assert.deepEqual([r.stats.ccPosts.length, r.login.calls.rejected, r.login.calls.accepted, r.stats.csvServed], [1, ['uncertain'], 0, 0], 'ikeda-portal:uncertain-marker');
  const reclaimed = await collect({}, { job: r.job, root: r.root, loginTimeoutMs: 6000 });
  assert.deepEqual([reclaimed.stats.ccPosts.length, reclaimed.login.calls.open], [0, 0], 'ikeda-portal:journal-no-resubmit');
});
test('portal: a file whose rows differ from 全N件 is never kept or recovered; the reclaimed job never exports again', async () => {
  const r = await collect({ csv: 'partial' });
  assert.match(String(r.result?.failed || ''), /件数（2件）が画面に表示された件数（全3件）と一致しません/, 'ikeda-portal:count-mismatch ' + String(r.result?.failed || r.error?.message));
  assert.equal((await files(r.jobDir)).some(n => /^[a-f\d-]{36}$/.test(n) || n === 'manifest.json'), false, 'ikeda-portal:partial-removed');
  const reclaimed = await collect({}, { job: r.job, root: r.root });
  assert.deepEqual([reclaimed.result?.skipped, reclaimed.stats.requests.length, (await files(r.jobDir)).includes('manifest.json')], ['attempted', 0, false], 'ikeda-portal:partial-never-recovered');
  const shown = await collect({ displayCount: 5 });
  assert.match(String(shown.result?.failed || ''), /全5件/, 'ikeda-portal:display-count-mismatch');
});
test('portal: a file from another origin or not in Shift_JIS is refused; a header-only file of a genuine 0-result search is kept; 0 without CSV is not claimed', async () => {
  const foreign = await collect({ csv: 'foreign' });
  assert.ok(foreign.error || foreign.result?.failed, 'ikeda-portal:foreign-refused'); assert.equal((await files(foreign.jobDir)).includes('manifest.json'), false, 'ikeda-portal:foreign-no-manifest');
  const utf8 = await collect({ csv: 'utf8' });
  assert.match(String(utf8.result?.failed || ''), /見出し|文字コード/, 'ikeda-portal:utf8-refused ' + String(utf8.result?.failed || utf8.error?.message));
  const empty = await collect({ rows: [] });
  assert.equal(empty.result?.failed, null, 'ikeda-portal:empty-with-csv ' + String(empty.result?.failed || empty.error?.message)); const m = empty.result.items[0].manifest;
  assert.deepEqual(await readFile(path.join(empty.jobDir, m.filename)), F.csvBytes([]), 'ikeda-portal:header-only-kept');
  const none = await collect({ rows: [], emptyNoCsv: true });
  assert.match(String(none.result?.failed || ''), /0件と表示され、CSVを出力できないため、取得済みにはしていません/, 'ikeda-portal:empty-unconfirmed'); assert.equal(none.stats.csvServed, 0);
});
test('portal: the calendar refuses a day the bank disables; a job whose start the bank no longer offers (month rollover) is refused before any page', async () => {
  const disabled = await collect({ minDate: F.addDays(availableFrom, 1) });
  assert.match(String(disabled.result?.failed || ''), /銀行で選べない日/, 'ikeda-portal:calendar-disabled ' + String(disabled.result?.failed || disabled.error?.message)); assert.equal(disabled.stats.csvServed, 0);
  const nextMonth = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1, 3); // 12:00 JST on the first day of the next month
  const rolled = await collect({}, { now: () => nextMonth });
  assert.match(String(rolled.result?.failed || ''), /照会できる期間（.*以降）より前になりました/, 'ikeda-portal:rollover-precheck'); assert.deepEqual([rolled.stats.requests.length, rolled.login.calls.open], [0, 0], 'ikeda-portal:rollover-no-bank-page');
  const noIdentity = await collect({}, { job: jobOf({ accountIdentity: null }) });
  assert.match(String(noIdentity.result?.failed || ''), /口座（支店名・種別・口座番号）が取得時の設定にありません/, 'ikeda-portal:precheck-identity'); assert.equal(noIdentity.stats.requests.length, 0);
});
test('portal: an unexpected bank dialog stops the steps for the person (never accepted); the bank\'s own logout confirm of finish() is answered once', async () => {
  const dialog = await collect({ alertOnStatements: true }, { ui: { stepMs: 6000 } });
  assert.ok(dialog.result?.failed || dialog.error, 'ikeda-portal:dialog-stops'); assert.equal(dialog.stats.csvServed, 0, 'ikeda-portal:dialog-no-export');
  const confirm = await collect({ logoutConfirm: true });
  assert.equal(confirm.result?.failed, null, String(confirm.result?.failed || confirm.error?.message)); assert.equal(confirm.stats.loggedOut, true, 'ikeda-portal:logout-confirm');
});
test('pure: page states, capture check and the precheck', () => {
  const read = (o = {}) => ({ origin: F.CC, path: F.CC_PATH, top: true, password: 1, logout: 0, ...o }), K = ikeda.classifyPortalPage;
  assert.equal(K(read()), 'login'); assert.equal(K(read({ origin: F.AUTH, path: F.AUTH_PATH })), 'unknown', 'ikeda-portal:public-form-never-login'); assert.equal(K(read({ top: false })), 'unknown');
  assert.equal(K(read({ origin: F.PORTAL, path: '/', password: 0, logout: 1 })), 'authenticated'); assert.equal(K(read({ origin: F.PORTAL, path: '/account-statements', password: 0, logout: 1 })), 'statements'); assert.equal(K(read({ origin: F.PORTAL, path: '/', password: 1, logout: 1 })), 'unknown');
  const rows = F.fictionalRows(today).filter(x => x.acct === 'A4'), bytes = F.csvBytes(rows), ctx = { expect: { rows: 3, from: availableFrom, to: today }, origin: F.PORTAL, blob: true }, check = ikeda.portalCaptureCheck;
  assert.deepEqual(check(bytes, ctx), { ok: true, rows: 3 });
  for (const [label, b, c, code] of [['count', bytes, { ...ctx, expect: { ...ctx.expect, rows: 4 } }, 'capture-count'], ['origin', bytes, { ...ctx, origin: 'https://evil.example' }, 'capture-origin'], ['not-blob', bytes, { ...ctx, blob: false }, 'capture-origin'], ['utf8', F.csvBytes(rows, { encoding: 'utf8' }), ctx, 'capture-encoding'], ['header', F.csvBytes(rows, { header: [...F.CSV_HEADER.slice(0, 9), '内容'] }), ctx, 'capture-header'], ['period', bytes, { ...ctx, expect: { ...ctx.expect, from: F.addDays(availableFrom, 3) } }, 'capture-period'], ['no-expect', bytes, { ...ctx, expect: null }, 'capture-unexpected'], ['invalid-sjis', Buffer.from([0x82, 0x20, 0x0d, 0x0a]), ctx, 'capture-encoding']]) assert.equal(check(b, c).code, code, 'ikeda-portal:capture ' + label);
  assert.equal(ikeda.portalPrecheck(snapshotOf(), Date.now()), null, 'ikeda-portal:precheck-ok');
  assert.match(ikeda.portalPrecheck(snapshotOf({ coverage: null }), Date.now()), /取得期間/);
  assert.throws(() => ikeda.portalLoginSecret({ password: 'x'.repeat(13) }), /Chromeで人が行います/); assert.throws(() => ikeda.portalLoginSecret({ username: 'u', password: 'p' })); assert.deepEqual(ikeda.portalLoginSecret({ password: ' p ' }), { password: ' p ' });
  const direct = bank.adapterFor('ikeda', 'direct'), none = bank.adapterFor('ikeda', null);
  assert.deepEqual([direct.support, none.support, bank.adapterFor('ikeda', 'portal').support, bank.adapterFor('resona', 'direct').support], ['contract-pending', 'contract-pending', 'verified', 'contract-pending'], 'ikeda-portal:only-portal-verified');
});

// ── the certificate helper ──
const ps = (script, env = {}) => new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 60000, env: { ...process.env, ...env } }, (e, stdout, stderr) => resolve({ code: e ? e.code ?? 1 : 0, stdout: String(stdout), stderr: String(stderr) })));
test('certificate policy (fictional rows and certificates, pure): one valid bank certificate is selected; other banks are left alone; ambiguous, missing, expired, absent or keyless is the person\'s choice', async () => {
  const issuer = 'The Senshu Ikeda Bank, Ltd. CA - G4', now = '2026-10-25T00:00:00Z';
  const valid = { issuerName: issuer, serial: '0A1B2C3D4E5F', notBefore: '2025-01-01T00:00:00Z', notAfter: '2027-01-01T00:00:00Z', hasPrivateKey: true };
  const cases = [
    ['unique', [['カクウ株式会社（架空）', issuer, 'Microsoft Software Key Storage Provider', '0A:1B:2C:3D:4E:5F']], [valid], { action: 'select', index: 0 }],
    ['other-banks-kept', [['架空', 'Fictional Other Bank CA', 'x', '11223344'], ['カクウ株式会社（架空）', issuer, 'x', '0A1B2C3D4E5F']], [valid, { ...valid, issuerName: 'Fictional Other Bank CA', serial: '11223344' }], { action: 'select', index: 1 }],
    ['ambiguous-rows', [['a', issuer, 'x', '0A1B2C3D4E5F'], ['b', issuer, 'x', '0A1B2C3D4E60']], [valid, { ...valid, serial: '0A1B2C3D4E60' }], { action: 'attention', reason: 'ambiguous' }],
    ['missing', [['a', 'Fictional Other Bank CA', 'x', '11223344']], [valid], { action: 'attention', reason: 'missing' }],
    ['issuer-substring-not-enough', [['a', issuer + ' (copy)', 'x', '0A1B2C3D4E5F']], [valid], { action: 'attention', reason: 'missing' }],
    ['expired', [['a', issuer, 'x', '0A1B2C3D4E5F']], [{ ...valid, notAfter: '2026-01-01T00:00:00Z' }], { action: 'attention', reason: 'expired' }],
    ['not-yet-valid', [['a', issuer, 'x', '0A1B2C3D4E5F']], [{ ...valid, notBefore: '2026-12-01T00:00:00Z' }], { action: 'attention', reason: 'expired' }],
    ['not-in-store', [['a', issuer, 'x', '0A1B2C3D4E5F']], [{ ...valid, serial: 'FFFF0000' }], { action: 'attention', reason: 'not-in-store' }],
    ['no-private-key', [['a', issuer, 'x', '0A1B2C3D4E5F']], [{ ...valid, hasPrivateKey: false }], { action: 'attention', reason: 'no-private-key' }],
    ['serial-less-two-in-store', [['a', issuer]], [valid, { ...valid, serial: '0A1B2C3D4E60' }], { action: 'attention', reason: 'ambiguous' }],
    ['serial-less-one-in-store', [['a', issuer]], [valid], { action: 'select', index: 0 }],
    // the representation the owner's chooser showed (parent lead C2): one row without separate cells whose name contains the bank's name
    ['name-only-row', [{ name: 'カクウ株式会社（架空） The Senshu Ikeda Bank, Ltd. CA - G4 0A1B2C3D4E5F', cells: [] }], [valid], { action: 'select', index: 0 }],
    ['name-only-row-without-serial', [{ name: 'Fictional Corp, The Senshu Ikeda Bank, Ltd.', cells: [] }], [valid], { action: 'select', index: 0 }],
    ['name-only-other-bank', [{ name: 'Fictional Corp, Fictional Other Bank CA', cells: [] }], [valid], { action: 'attention', reason: 'missing' }],
    ['name-only-two-rows', [{ name: 'A The Senshu Ikeda Bank, Ltd.', cells: [] }, { name: 'B The Senshu Ikeda Bank, Ltd.', cells: [] }], [valid], { action: 'attention', reason: 'ambiguous' }],
    ['name-with-cells-needs-the-cell', [{ name: 'x The Senshu Ikeda Bank, Ltd. y', cells: ['x', 'Fictional Other Bank CA'] }], [valid], { action: 'attention', reason: 'missing' }]
  ];
  const script = `$ErrorActionPreference='Stop'; . '${POLICY.replace(/'/g, "''")}'; $cases = ConvertFrom-Json $env:OMF_POLICY_CASES; $out = @(); foreach ($c in $cases) { $certs = @($c.certs | ForEach-Object { @{ issuerName = $_.issuerName; serial = $_.serial; notBefore = [DateTime]::Parse($_.notBefore, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal); notAfter = [DateTime]::Parse($_.notAfter, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal); hasPrivateKey = [bool]$_.hasPrivateKey } }); $rows = @($c.rows | ForEach-Object { @{ name = [string]$_.name; cells = @($_.cells | Where-Object { $_ -ne $null }) } }); $out += , (Select-OmfBankCertificate $rows $certs '${issuer}' 'The Senshu Ikeda Bank, Ltd.' ([DateTime]::Parse('${now}', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal))) }; ConvertTo-Json -InputObject $out -Compress -Depth 4`;
  const r = await ps(script, { OMF_POLICY_CASES: JSON.stringify(cases.map(([, rows, certs]) => ({ rows: rows.map(row => Array.isArray(row) ? { name: '', cells: row } : row), certs }))) });
  assert.equal(r.code, 0, 'policy script ' + r.stderr.slice(0, 400)); const got = JSON.parse(r.stdout.trim());
  cases.forEach(([label, , , want], i) => assert.deepEqual(got[i], want, 'cert-policy:' + label));
});
test('certificate chooser (parent finding C1, pure): one chooser seen once or nested inside its window is THE chooser; two distinct choosers are the person\'s choice', async () => {
  const cases = [['single', [{ id: '1.2', ancestors: ['1'] }], { index: 0 }], ['nested-duplicate', [{ id: '1', ancestors: [] }, { id: '1.5', ancestors: ['1'] }], { index: 1 }], ['two-siblings', [{ id: '1.5', ancestors: ['1'] }, { id: '1.6', ancestors: ['1'] }], { ambiguous: true }], ['two-top-level', [{ id: '1', ancestors: [] }, { id: '2', ancestors: [] }], { ambiguous: true }], ['two-each-nested', [{ id: '1', ancestors: [] }, { id: '1.5', ancestors: ['1'] }, { id: '2', ancestors: [] }, { id: '2.5', ancestors: ['2'] }], { ambiguous: true }], ['none', [], { none: true }]];
  const script = `$ErrorActionPreference='Stop'; . '${POLICY.replace(/'/g, "''")}'; $out=@(); foreach ($c in (ConvertFrom-Json $env:OMF_CHOOSERS)) { $out += , (Select-OmfChooser @($c | Where-Object { $_ -ne $null } | ForEach-Object { @{ id = [string]$_.id; ancestors = @($_.ancestors | Where-Object { $_ -ne $null }) } })) }; ConvertTo-Json -InputObject $out -Compress -Depth 4`;
  const r = await ps(script, { OMF_CHOOSERS: JSON.stringify(cases.map(([, c]) => c)) });
  assert.equal(r.code, 0, r.stderr.slice(0, 400)); const got = JSON.parse(r.stdout.trim());
  cases.forEach(([label, , want], i) => assert.deepEqual(got[i], want, 'cert-chooser:' + label));
  const ascii = await readFile(fileURLToPath(new URL('../windows/bank-certificate.ps1', import.meta.url))), asciiPolicy = await readFile(POLICY);
  assert.equal([...ascii, ...asciiPolicy].some(b => b > 127), false, 'cert-helper:ascii-only (Windows PowerShell 5.1 reads BOM-less scripts in the ANSI code page)');
});
test('certificate process identity (fictional observations, pure): the exact owned Chrome browser process of this collector only', async () => {
  const exp = { pid: 4242, parentPid: 100, profile: 'c:\\omf\\profiles\\ephemeral\\a-bank-b-batch', executable: 'c:\\program files\\google\\chrome\\application\\chrome.exe', notBefore: '2026-10-25T00:00:00Z', user: 'PC\\owner', session: 1 };
  const obs = { pid: 4242, parentPid: 100, commandLine: '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir="C:\\omf\\profiles\\ephemeral\\a-bank-b-batch" --no-first-run', executable: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', created: '2026-10-25T00:00:05Z', user: 'pc\\Owner', session: 1 };
  const cases = [['ok', obs, true], ['parent', { ...obs, parentPid: 101 }, 'parent'], ['created-before', { ...obs, created: '2026-10-24T23:59:00Z' }, 'created'], ['executable', { ...obs, executable: 'C:\\Fake\\chrome.exe' }, 'executable'], ['renderer', { ...obs, commandLine: obs.commandLine + ' --type=renderer' }, 'not-browser'], ['profile', { ...obs, commandLine: obs.commandLine.replace('a-bank-b-batch', 'other') }, 'profile'], ['user', { ...obs, user: 'PC\\someone' }, 'user'], ['session', { ...obs, session: 2 }, 'session'], ['gone', null, 'gone']];
  const script = `$ErrorActionPreference='Stop'; . '${POLICY.replace(/'/g, "''")}'; $e = ConvertFrom-Json $env:OMF_EXP; $exp = @{ pid=$e.pid; parentPid=$e.parentPid; profile=$e.profile; executable=$e.executable; notBefore=[DateTime]::Parse($e.notBefore, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal); user=$e.user; session=$e.session }; $out=@(); foreach ($o in (ConvertFrom-Json $env:OMF_OBS)) { $x = if ($o.none) { $null } else { @{ pid=$o.pid; parentPid=$o.parentPid; commandLine=$o.commandLine; executable=$o.executable; created=[DateTime]::Parse($o.created, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal); user=$o.user; session=$o.session } }; $r = Test-OmfBankProcess $exp $x; $out += , $(if ($r.ok) { 'ok' } else { $r.reason }) }; ConvertTo-Json -InputObject $out -Compress`;
  const r = await ps(script, { OMF_EXP: JSON.stringify(exp), OMF_OBS: JSON.stringify(cases.map(([, o]) => o ?? { none: true })) });
  assert.equal(r.code, 0, r.stderr.slice(0, 400)); const got = JSON.parse(r.stdout.trim());
  cases.forEach(([label, , want], i) => assert.equal(got[i], want === true ? 'ok' : want, 'cert-identity:' + label));
});
test('certificate helper on real processes: this test\'s own headless Chrome is proven and has no chooser; a wrong profile, executable or a non-Chrome child is refused before any window is read', async () => {
  const site = F.businessGate({ today });
  await owned(site, async ({ browser }) => {
    const started = Date.now() - process.uptime() * 1000;
    assert.deepEqual(await cert.selectBankCertificate(browser, { timeoutMs: 2500, startedAt: started }), { outcome: 'no-dialog', reason: null }, 'cert-helper:own-chrome-no-chooser');
    const child = browser.process(), fake = over => ({ process: () => ({ pid: child.pid, spawnargs: child.spawnargs, spawnfile: child.spawnfile, ...over }) });
    assert.deepEqual(await cert.selectBankCertificate(fake({ spawnargs: child.spawnargs.map(a => a.startsWith('--user-data-dir=') ? '--user-data-dir=' + path.join(temp, 'other-profile') : a) }), { timeoutMs: 2500, startedAt: started }), { outcome: 'attention', reason: 'process' }, 'cert-helper:wrong-profile');
    assert.deepEqual(await cert.selectBankCertificate(fake({ spawnfile: process.execPath }), { timeoutMs: 2500, startedAt: started }), { outcome: 'attention', reason: 'process' }, 'cert-helper:wrong-executable');
    assert.deepEqual(await cert.selectBankCertificate(browser, { timeoutMs: 2500, startedAt: Date.now() + 60000 }), { outcome: 'attention', reason: 'process' }, 'cert-helper:created-before-collector');
  });
  const other = spawn(process.execPath, ['-e', 'setTimeout(()=>{},20000)', '--user-data-dir=' + path.join(temp, 'p')], { windowsHide: true });
  try { assert.deepEqual(await cert.selectBankCertificate({ process: () => other }, { timeoutMs: 2500 }), { outcome: 'attention', reason: 'process' }, 'cert-helper:non-chrome-child'); } finally { other.kill(); }
  assert.deepEqual(await cert.selectBankCertificate({ process: () => null }), { outcome: 'attention', reason: 'process' }, 'cert-helper:not-launched-here');
  const ac = new AbortController(); setTimeout(() => ac.abort(), 300);
  await owned(site, async ({ browser }) => assert.deepEqual(await cert.selectBankCertificate(browser, { timeoutMs: 10000, signal: ac.signal }), { outcome: 'aborted', reason: null }, 'cert-helper:abort'));
  assert.deepEqual(cert.certificateResult('{"outcome":"attention","reason":"<script>"}'), { outcome: 'attention', reason: 'unreadable' }); assert.deepEqual(cert.certificateResult('garbage'), { outcome: 'attention', reason: 'unreadable' });
});
