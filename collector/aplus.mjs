// collector/aplus.mjs — Aplus (My APLUS) statement download and unbilled-page capture for the OMF downloader
// (plan omf-aplus-automation-20261013 §2 P1–P4, C1–C3; live contract output/omf-aplus-coverage-20261013/live2/selector-contract.json).
// Imports only packaged files and node built-ins so the staged customer package runs it without an install;
// collector/browser.mjs is the only place this lane touches puppeteer. Lines marked `// guard:<name>` are single
// predicates the fixture removes in turn from a mutant copy to prove each is load-bearing.
import { randomUUID } from 'node:crypto';
import { access, link, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseAplus } from '../shared/aplus.mjs';
import { parsePendingImport } from '../shared/finance-pending.mjs';
import { click, fill, onSurface, pause, poll } from './interaction.mjs';
import { matchStatementCode } from './aplus-verification.mjs';

const APLUS = 'https://myaplus.aplus.co.jp';
const LOGIN_PATH = '/login/id/input', DETAILS_PATH = '/cards/billing/details', UNBILLED_PATH = '/cards/billing/unbilled', OTP_PATH = '/authentication/otp/sms';
const UNBILLED_SOURCE = APLUS + UNBILLED_PATH;
const LABEL = 'My APLUS';
const GUID = /^[a-f\d-]{36}$/;
const exists = target => access(target).then(() => true, () => false);
const monthOf = text => { const m = /^(20\d{2})[/-](0[1-9]|1[0-2])$/.exec(String(text ?? '').trim()); return m ? m[1] + '-' + m[2] : null; };

/** Finalized months the page offers (select option values, YYYY/MM) that neither OMF nor the outbox holds, newest first. */
export function selectMissingMonths(options, covered = []) {
  const held = new Set([...covered].map(monthOf).filter(Boolean));
  return [...new Set((options || []).map(monthOf).filter(Boolean))].filter(month => !held.has(month)).sort((a, b) => b.localeCompare(a));
}

/** The loaded statement page must show this connection's primary card, the chosen month and a readable お支払金額. */
export function verifyAplusStatement(snapshot, month, account) {
  const label = String(snapshot?.account ?? '');
  if (!/^\d{4}$/.test(String(account?.primaryCard ?? '')) || !label.endsWith('-' + account.primaryCard)) throw new Error('The signed-in My APLUS account does not match this connection'); // guard:account-label
  if (monthOf(snapshot?.month) !== month) throw new Error('My APLUS did not show the selected statement month'); // guard:month
  const total = /^([\d,]+)円$/.exec(String(snapshot?.total ?? '').trim());
  if (!total || !/^(?:\d{1,3}(?:,\d{3})*|\d+)$/.test(total[1])) throw new Error('My APLUS payment total could not be read'); // guard:total
  return Number(String(total?.[1] ?? '').replaceAll(',', ''));
}

/** Reads every unbilled page in order and builds the read-only rendered-page capture shared/finance-pending.mjs validates. */
export async function captureUnbilled(ui, { now = Date.now } = {}) {
  const pageNumbers = await ui.pageNumbers();
  if (!Array.isArray(pageNumbers) || !pageNumbers.length || pageNumbers.length > 100 || pageNumbers.some((n, i) => n !== String(i + 1))) throw new Error('My APLUS unbilled page numbers could not be read');
  const rawPageFields = [];
  let first = null;
  for (let n = 1; n <= pageNumbers.length; n++) {
    if (n > 1) await ui.goToPage(String(n));
    const page = await ui.readPage();
    first ||= page;
    if (page.activePage !== String(n) || JSON.stringify(page.pageNumbers) !== JSON.stringify(first.pageNumbers)) throw new Error('My APLUS unbilled pages changed while reading'); // guard:page-identity
    rawPageFields.push({ activePage: page.activePage, pageNumbers: [...page.pageNumbers], summary: page.summary, rows: (page.rows || []).map(r => ({ position: r.position, merchant: r.merchant, dateAndPayment: r.dateAndPayment, amount: r.amount, details: (r.details || []).map(d => ({ label: d.label, value: d.value })) })) });
  }
  const displayed = /未請求のご利用金額\s+未確定\s+([\d,]+)円/.exec(rawPageFields[0].summary || '');
  const displayedTotal = displayed ? Number(displayed[1].replaceAll(',', '')) : NaN;
  const rows = rawPageFields.flatMap((page, index) => page.rows.map(r => {
    const date = /^(\d{2})\.(\d{2})\.(\d{2})\s+(.+)$/.exec(r.dateAndPayment || ''), field = name => r.details.find(d => d.label === name)?.value;
    return { sourcePage: index + 1, sourceRow: r.position, status: 'unbilled-provisional', transactionDate: date ? `20${date[1]}-${date[2]}-${date[3]}` : '', merchant: r.merchant, amountJpy: Number(String(r.amount || '').replace(/[円,]/g, '')), cardSuffix: field('カード番号下4桁'), paymentMethod: date ? date[4].trim() : '', salesType: field('売上種別'), firstPaymentMonth: field('初回年月') };
  }));
  const totalJpy = rows.reduce((n, r) => n + (Number.isFinite(r.amountJpy) ? r.amountJpy : 0), 0), dates = rows.map(r => r.transactionDate).sort();
  const source = { source: UNBILLED_SOURCE, sourceType: 'read-only-rendered-page-capture', status: 'unbilled-provisional', finalized: false, capturedAt: new Date(now()).toISOString(), pageCount: rawPageFields.length, rawPageFields, displayedTotal, totalJpy, totalReconciled: totalJpy === displayedTotal, rowCount: rows.length, rows, dateRange: { from: dates[0], to: dates.at(-1) } };
  return { source, bytes: Buffer.from(JSON.stringify(source, null, 2) + '\n') };
}

/**
 * Waits for the one CSV a 保存→CSV request produces in `jobDir` (Browser.setDownloadBehavior allowAndName on the browser
 * target: the retained file is named by the download GUID). Completion = the completed event for the GUID that began, or
 * one GUID-named file in the directory whose size is stable across two polls with no .crdownload sibling — the second arm
 * covers the event lost across the SMS navigation. The verification page during the wait is reported once through
 * `onVerification` and extends the deadline once. Expiry throws {code:'timeout'}; there is never a second request here.
 */
export async function awaitDownload({ jobDir, session = null, request, state, onVerification = null, timeoutMs = 300000, extensionMs = 300000, pollMs = 1000, now = Date.now, wait = pause }) {
  let guid = null, completed = null, canceled = false, multiple = false;
  session?.on('Browser.downloadWillBegin', event => { if (guid) multiple = true; else guid = event.guid; });
  session?.on('Browser.downloadProgress', event => { if (!guid || event.guid !== guid) return; if (event.state === 'completed') completed = guid; if (event.state === 'canceled') canceled = true; });
  await request();
  let deadline = now() + timeoutMs, extended = false, noticed = false;
  const sizes = new Map();
  for (;;) {
    if (multiple) throw new Error('Multiple downloads started; check the My APLUS tab');
    if (canceled) throw new Error('My APLUS canceled the CSV download');
    if (completed) return completed;
    const names = await readdir(jobDir), files = names.filter(name => GUID.test(name));
    if (files.length > 1) throw new Error('Multiple downloads started; check the My APLUS tab');
    if (files.length === 1 && !names.includes(files[0] + '.crdownload')) {
      const size = (await stat(path.join(jobDir, files[0]))).size;
      if (size > 0 && sizes.get(files[0]) === size) return files[0];
      sizes.set(files[0], size);
    }
    const current = await state();
    if (current?.kind === 'verification') {
      if (!noticed) { noticed = true; if (onVerification) await onVerification(); }
      if (!extended) { extended = true; deadline += extensionMs; }
    }
    if (now() >= deadline) throw Object.assign(new Error('My APLUS CSV download did not complete'), { code: 'timeout' });
    await wait(pollMs);
  }
}

const statementManifest = (bound, month, statementTotal, filename, parsed, downloadedAt) => ({ ...bound, kind: 'statement', sourceFormat: 'csv', statementMonth: month, statementTotal, start: parsed.period.start, end: parsed.period.end, sha256: parsed.sha256, filename, rowCount: parsed.rows.length, downloadedAt });

// Publish a complete new manifest exclusively. A killed or failed write leaves no partially readable manifest, and
// link() retains the existing wx contract: another completed manifest is never overwritten.
async function writeManifest(directory, manifest) {
  const file = path.join(directory, 'manifest.json'), temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    await link(temporary, file);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

// A process can stop after Chrome completed the file but before the manifest was written. The attempt journal records
// the verified account, origin, period and displayed total before any click. Reuse only that bound, complete file; this
// path never opens a download session, clicks CSV or requests another code. Older incomplete journals retain the existing
// explicit-retry exit because they do not contain the evidence needed to reconstruct a trustworthy manifest.
async function completedAttempt(jobDir, bound, month, account, { now, wait, pollMs }) {
  const marker = JSON.parse(await readFile(path.join(jobDir, 'attempt.json'), 'utf8'));
  if (Object.keys(bound).some(key => marker[key] !== bound[key]) || marker.month !== month || !Number.isSafeInteger(marker.statementTotal)) return null;
  const names = await readdir(jobDir), files = names.filter(name => GUID.test(name));
  if (files.length !== 1 || names.includes(files[0] + '.crdownload')) return null;
  const filename = await awaitDownload({ jobDir, request: async () => {}, state: async () => ({ kind: 'recovering' }), timeoutMs: Math.max(2000, pollMs * 2), extensionMs: 0, now, wait, pollMs });
  const bytes = await readFile(path.join(jobDir, filename));
  const parsed = parseAplus(bytes, account.cardIdentifiers, { kind: 'statement', statementMonth: month, statementTotal: marker.statementTotal });
  const manifest = statementManifest(bound, month, marker.statementTotal, filename, parsed, new Date(now()).toISOString());
  await writeManifest(jobDir, manifest);
  return { directory: jobDir, manifest };
}

// Sign-in on the fake-able page: the saved login is submitted once; the issuer's unexpected-operation page is left through
// its ログインに戻る button once; anything needing a person (no saved login, a challenge, a second error) is reported.
async function ensureAplusLogin(ui, credentials, status, { now, wait, timeoutMs = 300000, pollMs = 1500 }) {
  const deadline = now() + timeoutMs;
  let submitted = false, returned = false, manual = false;
  const attention = async () => { if (manual) return; manual = true; await status('verification_required', 'My APLUSにChromeでサインインしてください'); await ui.show(); };
  await ui.open();
  while (now() < deadline) {
    const kind = (await ui.state())?.kind;
    if (['authenticated', 'details', 'unbilled'].includes(kind)) return;
    if (kind === 'error_page') {
      if (returned) throw new Error('My APLUS login needs attention in Chrome; retry when the page is available');
      returned = true; await ui.returnToLogin();
    } else if (kind === 'login' && !submitted && !manual) {
      if (!credentials?.username || !credentials?.password) await attention();
      else { submitted = true; await status('running', 'My APLUSにサインイン'); await ui.login(credentials); }
    } else if (kind === 'verification' && !manual) await attention();
    await wait(pollMs);
  }
  await attention();
  throw new Error('My APLUS login needs attention in Chrome; retry when verification is complete');
}

/**
 * One job on an open page: sign in, download every finalized month the page offers that `covered` does not hold (newest
 * first; one attempt marker per month per job, written before the click; never a second request after a timeout), then
 * capture the unbilled page unless this job already holds one. Artifacts and manifests go to
 * outbox/<accountId>/<jobId>-<month> and outbox/<accountId>/<jobId>-pending. `ui` is injectable (fixture); the default is
 * the real page. Returns { items, pending, nothing, unavailable, failed, skipped }.
 */
export async function collectAplusFromPage(page, browser, account, settings, directory, status, { ui = null, covered = [], codeSource = null, jobId = account?.jobId, now = Date.now, wait = pause, origin = '', loginTimeoutMs = 300000, downloadTimeoutMs = 300000, extensionMs = 300000, pollMs = 1000 } = {}) {
  ui ||= aplusUi(page, browser);
  if (!/^[a-f\d]{24}$/.test(String(account?._id ?? '')) || typeof jobId !== 'string' || !jobId) throw new Error('A claimed account with a job is required');
  await ensureAplusLogin(ui, settings, status, { now, wait, timeoutMs: loginTimeoutMs });
  const outbox = path.join(directory, 'outbox', account._id), stamp = () => new Date(now()).toISOString();
  const bound = { accountId: account._id, primaryCard: account.primaryCard, jobId, ...(account.ownerId ? { ownerId: String(account.ownerId) } : {}), ...(origin ? { origin } : {}), provider: 'aplus' };
  const items = [], unavailable = [];
  let skipped = null, failed = null;
  await status('running', '確定明細の一覧を確認');
  await ui.openDetails();
  const overview = await ui.snapshot();
  const months = selectMissingMonths(overview?.options, covered);
  for (const month of months) {
    const jobDir = path.join(outbox, jobId + '-' + month), marker = path.join(jobDir, 'attempt.json');
    if (await exists(marker)) {
      const recovered = await completedAttempt(jobDir, bound, month, account, { now, wait, pollMs });
      if (recovered) { items.push(recovered); await status('running', month + ' の保存済み明細を復旧'); continue; }
    }
    if (await exists(marker)) { skipped = { month, reason: 'attempted' }; break; } // guard:attempt-marker
    await status('running', month + ' の確定明細を選択');
    await ui.selectMonth(month);
    const snapshot = await ui.snapshot();
    if (!String(snapshot?.total ?? '').trim()) { unavailable.push(month); continue; }
    const statementTotal = verifyAplusStatement(snapshot, month, account);
    await mkdir(jobDir, { recursive: true });
    await writeFile(marker, JSON.stringify({ ...bound, requestedAt: stamp(), month, statementTotal }, null, 2), { flag: 'wx', mode: 0o600 });
    const requestedAt = now();
    const session = ui.downloadSession ? await ui.downloadSession(jobDir) : null;
    let filename;
    try {
      await status('running', month + ' の確定明細をダウンロード');
      filename = await awaitDownload({ jobDir, session, request: async () => { await ui.save(); await ui.csv(); }, state: () => ui.state(), now, wait, pollMs, timeoutMs: downloadTimeoutMs, extensionMs,
        onVerification: async () => {
          await status('verification_required', 'My APLUSの認証コードをChromeで入力してください');
          await ui.show();
          if (!codeSource) return;
          let match = null;
          try { match = matchStatementCode(await codeSource.messages({ requestedAt }), { requestedAt, now: now() }); } catch { match = null; }
          if (match) { await codeSource.claim(match.id); await ui.code(match.code); }
        } });
    } catch (error) {
      if (error?.code !== 'timeout') throw error;
      failed = 'ダウンロードが完了しませんでした。再度「確定明細を取得」を押してください';
      break;
    } finally { await session?.close?.(); }
    const bytes = await readFile(path.join(jobDir, filename));
    const parsed = parseAplus(bytes, account.cardIdentifiers, { kind: 'statement', statementMonth: month, statementTotal });
    const manifest = statementManifest(bound, month, statementTotal, filename, parsed, stamp());
    await writeManifest(jobDir, manifest);
    items.push({ directory: jobDir, manifest });
    await status('running', month + ' の確定明細を保存');
  }
  if (skipped) failed = 'ダウンロードが完了しませんでした。再度「確定明細を取得」を押してください';
  let pending = null;
  const pendingDir = path.join(outbox, jobId + '-pending');
  if (!failed && !(await exists(path.join(pendingDir, 'manifest.json')))) {
    await status('running', '未請求明細を読み取り');
    const newest = selectMissingMonths(overview?.options, [])[0];
    if (newest && monthOf((await ui.snapshot())?.month) !== newest) await ui.selectMonth(newest);
    await ui.openUnbilled();
    const { source, bytes } = await captureUnbilled(ui, { now });
    let parsed = null;
    try { parsed = parsePendingImport(bytes, account, { kind: 'pending' }); } catch { parsed = null; }
    if (!parsed) failed = '未請求明細の読み取りを確認できませんでした';
    else {
      await mkdir(pendingDir, { recursive: true });
      const filename = randomUUID();
      await writeFile(path.join(pendingDir, filename), bytes, { flag: 'wx', mode: 0o600 });
      const manifest = { ...bound, kind: 'pending', sourceFormat: 'json', capturedAt: source.capturedAt, pageCount: source.pageCount, rowCount: source.rowCount, start: parsed.period.start, end: parsed.period.end, sha256: parsed.sha256, filename, downloadedAt: stamp() };
      await writeManifest(pendingDir, manifest);
      pending = { directory: pendingDir, manifest };
      await status('running', '未請求明細を保存');
    }
  }
  return { items, pending, nothing: !items.length && !pending && !failed, unavailable, failed, skipped };
}

// The real My APLUS page, by the recorded contract: login at the root entry (/login is the issuer's error page),
// #elem1-1/#elem1-2 and the ログイン button; /top/details with ログアウト when signed in; the SPA link to
// /cards/billing/details after hovering 利用明細・利用可能額 (a full navigation shows the error page); the month select,
// the お支払金額 price and the -<card> label on details; 保存 then CSV; the four-digit code at /authentication/otp/sms;
// the class-scoped next-period control to /cards/billing/unbilled (nav1 is duplicated; never use #nav1).
// Hold references to the rendered content, not the selected navigation control. New nodes count as a render even when
// their text is identical; reused nodes count when their content changes. Unrelated long-lived requests are irrelevant.
const renderedContent = (page, selector) => page.evaluateHandle(s => [...document.querySelectorAll(s)].map(node => ({ node, text: node.textContent, children: [...node.childNodes] })), selector);
const contentChanged = (page, previous, selector) => page.evaluate((old, s) => {
  const nodes = [...document.querySelectorAll(s)];
  return nodes.length !== old.length || nodes.some((node, i) => node !== old[i].node || node.textContent !== old[i].text || node.childNodes.length !== old[i].children.length || [...node.childNodes].some((child, n) => child !== old[i].children[n]));
}, previous, selector);
function aplusUi(page, browser) {
  const paths = { loginPath: LOGIN_PATH, otpPath: OTP_PATH, detailsPath: DETAILS_PATH, unbilledPath: UNBILLED_PATH };
  const ui = {
    async open() { await page.goto(APLUS + '/', { waitUntil: 'domcontentloaded', timeout: 60000 }); },
    async state() {
      if (!onSurface(page, APLUS)) return { kind: 'unknown' };
      return page.evaluate(({ loginPath, otpPath, detailsPath, unbilledPath }) => {
        const visible = e => e.getClientRects().length > 0, texts = [...document.querySelectorAll('button, a')].filter(visible).map(e => e.innerText.trim()), p = location.pathname;
        if (p === otpPath && document.querySelector('#elem1-1') && texts.includes('認証する')) return { kind: 'verification' };
        if (p === loginPath && document.querySelector('#elem1-1') && document.querySelector('#elem1-2') && texts.includes('ログイン')) return { kind: 'login' };
        if (texts.includes('ログインに戻る')) return { kind: 'error_page' };
        if (p === detailsPath && document.querySelector('.m-navDate__chooseSelect') && document.querySelector('.m-particularsOverview__price')) return { kind: 'details' };
        if (p === unbilledPath && document.querySelector('.m-listDetails__item')) return { kind: 'unbilled' };
        if (texts.includes('ログアウト')) return { kind: 'authenticated' };
        return { kind: 'unknown' };
      }, paths);
    },
    async login(credentials) {
      await fill(page, '#elem1-1', credentials.username, APLUS, LOGIN_PATH, LABEL);
      await fill(page, '#elem1-2', credentials.password, APLUS, LOGIN_PATH, LABEL);
      await click(page, 'button', 'ログイン', APLUS, LOGIN_PATH, LABEL);
    },
    async returnToLogin() { await click(page, 'button', 'ログインに戻る', APLUS, null, LABEL); },
    async show() { await page.bringToFront(); },
    async openDetails() {
      const menu = await page.evaluate(() => { const e = [...document.querySelectorAll('a, button, li, span, div, p')].find(e => e.getClientRects().length && e.childElementCount === 0 && e.textContent.trim() === '利用明細・利用可能額'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      if (!menu) throw new Error('The My APLUS menu 利用明細・利用可能額 was not found');
      await page.mouse.move(menu.x, menu.y);
      await pause(500);
      await click(page, 'a[href="/cards/billing/details"]', null, APLUS, null, LABEL);
      const loaded = await poll(async () => (await ui.state()).kind === 'details' && monthOf((await ui.snapshot()).month), 45000);
      if (!loaded) throw new Error('The My APLUS statement did not finish loading');
    },
    async snapshot() {
      return page.evaluate(() => ({ url: location.href, month: document.querySelector('.m-navDate__chooseButton')?.innerText.trim() || '', selectedMonth: document.querySelector('.m-navDate__chooseSelect')?.value || '', total: document.querySelector('.m-particularsOverview__price')?.innerText.trim() || '', totalPresent: !!document.querySelector('.m-particularsOverview__price'),
        account: [...document.querySelectorAll('button')].map(e => e.innerText.trim()).find(t => /-\d{4}$/.test(t)) || '', options: [...document.querySelectorAll('.m-navDate__chooseSelect option')].map(o => o.value).filter(v => /^20\d{2}\/\d{2}$/.test(v)) }));
    },
    async selectMonth(month) {
      const value = month.replace('-', '/'), before = await ui.snapshot();
      if (before.month === value && before.selectedMonth === value && before.totalPresent) return;
      const selector = '.m-particularsOverview__price, .m-listDetails__item', previous = await renderedContent(page, selector);
      try {
        await page.select('.m-navDate__chooseSelect', value);
        const loaded = await poll(async () => { if (!onSurface(page, APLUS, DETAILS_PATH)) return null; const s = await ui.snapshot(); return s.month === value && s.totalPresent && await contentChanged(page, previous, selector) ? s : null; }, 45000);
        if (!loaded) throw new Error('My APLUS did not load the selected month');
      } finally { await previous.dispose().catch(() => {}); }
    },
    async save() { await click(page, 'button', '保存', APLUS, DETAILS_PATH, LABEL); },
    async csv() {
      const ready = await poll(() => page.evaluate(() => [...document.querySelectorAll('a')].filter(e => e.getClientRects().length && e.innerText.trim() === 'CSV').length === 1), 15000);
      if (!ready) throw new Error('The My APLUS CSV option did not appear');
      await click(page, 'a', 'CSV', APLUS, DETAILS_PATH, LABEL);
    },
    async code(value) { await fill(page, '#elem1-1', value, APLUS, OTP_PATH, LABEL); await click(page, 'button', '認証する', APLUS, OTP_PATH, LABEL); },
    async downloadSession(jobDir) {
      const session = await browser.target().createCDPSession();
      await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: jobDir, eventsEnabled: true });
      return { on: (event, handler) => session.on(event, handler), async close() { await session.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: false }).catch(() => {}); await session.detach().catch(() => {}); } };
    },
    async openUnbilled() {
      const next = await page.evaluate(() => document.querySelector('.m-navDate__next a')?.innerText.trim() || '');
      if (!/以降/.test(next)) throw new Error('The My APLUS next-period control does not show the unbilled period');
      await click(page, '.m-navDate__next a', null, APLUS, DETAILS_PATH, LABEL);
      const loaded = await poll(async () => (await ui.state()).kind === 'unbilled', 45000);
      if (!loaded) throw new Error('The My APLUS unbilled page did not finish loading');
    },
    async pageNumbers() { return page.evaluate(() => { const links = [...document.querySelectorAll('.pagination a')].map(e => e.textContent.trim()).filter(t => /^\d+$/.test(t)); return links.length ? links : ['1']; }); },
    async goToPage(number) {
      const selector = '.m-listDetails__item', previous = await renderedContent(page, selector);
      try {
        await click(page, '.pagination a', number, APLUS, UNBILLED_PATH, LABEL);
        const settled = await poll(async () => await contentChanged(page, previous, selector) && await page.evaluate(n => { const active = document.querySelector('.pagination .active a')?.textContent.trim(), first = document.querySelector('.m-listDetails__item'); return active === n && !!first && first.getClientRects().length > 0; }, number), 15000);
        if (!settled) throw new Error('My APLUS unbilled page ' + number + ' did not finish loading');
      } finally { await previous.dispose().catch(() => {}); }
    },
    async readPage() {
      return page.evaluate(() => ({ activePage: document.querySelector('.pagination .active a')?.textContent.trim() || (document.querySelector('.pagination') ? '' : '1'), pageNumbers: (() => { const links = [...document.querySelectorAll('.pagination a')].map(e => e.textContent.trim()).filter(t => /^\d+$/.test(t)); return links.length ? links : ['1']; })(), summary: document.querySelector('.m-particularsOverview')?.innerText || '',
        rows: [...document.querySelectorAll('.m-listDetails__item')].map((e, i) => ({ position: i + 1, merchant: e.querySelector('.m-listDetails__name')?.innerText.trim() || '', dateAndPayment: e.querySelector('.m-listDetails__date')?.innerText.trim() || '', amount: e.querySelector('.m-listDetails__value')?.innerText.trim() || '', details: [...e.querySelectorAll('.m-listDetails__info li')].map(li => ({ label: li.querySelector('.m-listDetails__infoTtl')?.textContent.trim() || '', value: li.querySelector('.m-listDetails__infoVal')?.textContent.trim() || '' })) })) }));
    }
  };
  return ui;
}
