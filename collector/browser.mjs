import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { connect } from 'puppeteer-real-browser';
import { parseAmex } from '../shared/amex.mjs';
import { ensureLogin, LoginClaims } from './login.mjs';
import { LoginMailbox } from './mail.mjs';
import { click, onSurface, poll } from './interaction.mjs';
import { latestClosed, statementSnapshot, STATEMENT, verifyStatement } from './statement.mjs';
export { ensureLogin, LOGIN } from './login.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require(require.resolve('rebrowser-puppeteer-core', { paths: [path.dirname(require.resolve('puppeteer-real-browser'))] }));
const execute = promisify(execFile), sessions = new Map();
const GLOBAL = 'https://global.americanexpress.com', STATEMENT_PATH = '/activity/statement';

export async function browserFor(profile) {
  if (sessions.get(profile)?.connected) return sessions.get(profile);
  await mkdir(profile, { recursive: true });
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./windows/browser-process.ps1', import.meta.url)), '-Profile', profile], { windowsHide: true, timeout: 15000 });
  const running = JSON.parse(stdout.trim() || '[]');
  if (running.length > 1 || running.some(p => !p.port)) throw new Error('Close the duplicate or non-debuggable Amex profile before retrying');
  const options = { defaultViewport: null, protocolTimeout: 30000 };
  const browser = running.length ? await puppeteer.connect({ browserURL: `http://127.0.0.1:${running[0].port}`, ...options }) : (await connect({ headless: false, turnstile: false, args: ['--lang=ja-JP,ja', '--accept-lang=ja-JP,ja;q=0.9,en;q=0.8'], customConfig: { userDataDir: profile }, connectOption: options })).browser;
  sessions.set(profile, browser);
  browser.on('disconnected', () => sessions.delete(profile));
  return browser;
}

export async function amexPage(browser) {
  const pages = (await browser.pages()).filter(p => onSurface(p, 'https://www.americanexpress.com') || onSurface(p, GLOBAL));
  if (pages.length > 1) throw new Error('Keep one Amex tab open in this account profile before retrying');
  return pages[0] || await browser.newPage();
}

export async function selectLatestStatement(page, primaryCard) {
  await page.goto(STATEMENT, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const initial = await poll(async () => {
    if (!onSurface(page, GLOBAL, STATEMENT_PATH)) return null;
    const snapshot = await page.evaluate(statementSnapshot);
    return snapshot.links.length && snapshot.cards.includes('-' + primaryCard) ? snapshot : null;
  }, 45000);
  if (!initial) throw new Error('Amex statement links or signed-in card could not be verified');
  const selected = latestClosed(initial.links);
  await page.goto(selected.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const snapshot = await poll(async () => {
    if (!onSurface(page, GLOBAL, STATEMENT_PATH)) return null;
    const value = await page.evaluate(statementSnapshot);
    if (!value.periods.length || !value.counts.length || !value.cards.length) return null;
    return value;
  }, 45000);
  if (!snapshot) throw new Error('The selected Amex statement did not finish loading');
  const pageCount = verifyStatement(snapshot, selected, primaryCard);
  return { selected, pageCount };
}

export async function collectStatement(account, settings, directory, status, { gmail } = {}) {
  const profile = settings.profile || path.join(directory, 'profiles', account.primaryCard);
  const browser = await browserFor(profile), page = await amexPage(browser);
  await ensureLogin(page, settings, status, { account, mailbox: gmail ? new LoginMailbox(gmail) : null, claims: new LoginClaims(directory) });
  await status('running', 'Selecting the latest closed Amex statement');
  const { selected, pageCount } = await selectLatestStatement(page, account.primaryCard);
  await status('running', `Downloading the closed statement ${selected.start} to ${selected.end}`);
  const jobDir = path.join(directory, 'outbox', account._id, account.jobId);
  await mkdir(jobDir, { recursive: true });
  const session = await browser.target().createCDPSession();
  let timer;
  try {
    await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: jobDir, eventsEnabled: true });
    let guid;
    const complete = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Amex CSV download did not complete')), 45000);
      session.on('Browser.downloadWillBegin', event => {
        if (!event.suggestedFilename.toLowerCase().endsWith('.csv')) return;
        if (guid) return reject(new Error('Multiple downloads started; check the Amex tab'));
        guid = event.guid;
      });
      session.on('Browser.downloadProgress', event => {
        if (event.guid !== guid) return;
        if (event.state === 'completed') resolve(guid);
        if (event.state === 'canceled') reject(new Error('Amex canceled the CSV download'));
      });
    });
    complete.catch(() => {});
    await click(page, '#action-icon-dls-icon-download-', null, GLOBAL, STATEMENT_PATH);
    const csvSelector = '#axp-activity-download-body-selection-options-type_csv';
    const csvReady = await poll(async () => onSurface(page, GLOBAL, STATEMENT_PATH) && await page.evaluate(selector => !!document.querySelector(selector), csvSelector), 15000);
    if (!csvReady) throw new Error('Amex CSV format option changed');
    await click(page, 'label[for="axp-activity-download-body-selection-options-type_csv"]', null, GLOBAL, STATEMENT_PATH);
    const checked = await poll(() => page.evaluate(selector => document.querySelector(selector)?.checked === true, csvSelector), 5000);
    if (!checked) throw new Error('Amex CSV format was not selected');
    verifyStatement(await page.evaluate(statementSnapshot), selected, account.primaryCard);
    await click(page, '[role="dialog"] button', 'ダウンロード', GLOBAL, STATEMENT_PATH);
    const filename = await complete, bytes = await readFile(path.join(jobDir, filename));
    const parsed = parseAmex(bytes, account.cardIdentifiers);
    if (parsed.rows.length !== pageCount) throw new Error('Downloaded row count does not match the Amex page');
    verifyStatement(await page.evaluate(statementSnapshot), selected, account.primaryCard);
    const { url: _url, ...coverage } = selected;
    const manifest = { accountId: account._id, primaryCard: account.primaryCard, jobId: account.jobId, ...coverage, pageCount, sha256: parsed.sha256, filename, downloadedAt: new Date().toISOString() };
    await writeFile(path.join(jobDir, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    return { directory: jobDir, manifest };
  } finally {
    clearTimeout(timer);
    await session.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: false }).catch(() => {});
    await session.detach().catch(() => {});
  }
}
