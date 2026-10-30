import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, realpath as realpathCallback } from 'node:fs';
import { access, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'rebrowser-puppeteer-core';
export { FRAME_INIT_FIX } from './puppeteer-frame-init.mjs'; // pinned-SDK fix, in place before any launch: a failed iframe initialization no longer ends the process (puppeteer#14701)
import { parseAmex } from '../shared/amex.mjs';
import { ensureLogin, LoginClaims, loginUi } from './login.mjs';
import { LoginMailbox } from './mail.mjs';
import { click, onSurface, poll } from './interaction.mjs';
import { latestClosed, statementSnapshot, STATEMENT, verifyStatement } from './statement.mjs';
import { collectAplusFromPage } from './aplus.mjs';
export { ensureLogin, LOGIN } from './login.mjs';

const execute = promisify(execFile), realpathNative = promisify(realpathCallback.native);
const PROBE = fileURLToPath(new URL('./windows/browser-process.ps1', import.meta.url));
const GLOBAL = 'https://global.americanexpress.com', STATEMENT_PATH = '/activity/statement';
// Owned Chrome only (plan omf-customer-credential-security-20261009 §2 site 5): launched by this process through
// rebrowser-puppeteer-core with the pipe transport — no --no-sandbox, no --disable-web-security, no TCP debugging
// port — on a profile no other Chrome is using. The collector never attaches to an existing browser.
export const LAUNCH_ARGS = Object.freeze(['--lang=ja-JP,ja', '--accept-lang=ja-JP,ja;q=0.9,en;q=0.8', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync']);
/** @type {Map<number, { key: string, profile: string, ephemeral: boolean, root: string|null, pid: number, browser: any, child: any }>} */
const owned = new Map();

/** Stock Chrome in its three Windows locations (cloud-probe/test/interaction-browser.mjs:48-50). */
export function chromeCandidates(env = process.env) {
  return [
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(candidate => !candidate.startsWith(path.sep + 'Google'));
}
export function findChrome(env = process.env) { return chromeCandidates(env).find(candidate => existsSync(candidate)) || null; }
const keyOf = value => path.resolve(value).replaceAll('\\', '/').toLowerCase();
const safeName = value => String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'x';
export const ephemeralRoot = root => path.join(root, 'profiles', 'ephemeral');
/** profiles/ephemeral/<owner>-<provider>-<account>-<batch>: one fresh profile per batch, deleted at closure. */
export function ephemeralProfile(root, ownerId, provider, accountId, batch) {
  return path.join(ephemeralRoot(root), `${safeName(ownerId || 'local')}-${safeName(provider)}-${safeName(accountId)}-${safeName(batch)}`);
}
function assertEphemeralPath(profile, root) {
  if (!root) throw new Error('An ephemeral profile needs the collector directory');
  if (keyOf(path.dirname(profile)) !== keyOf(ephemeralRoot(root))) throw new Error('Ephemeral profiles live directly under profiles/ephemeral');
}
async function assertPlainDirectory(target) {
  const stat = await lstat(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${path.basename(target)} is a link or not a directory; refusing to use it`);
  if (keyOf(await realpathNative(target)) !== keyOf(target)) throw new Error(`${path.basename(target)} resolves elsewhere; refusing to use it`);
}
async function probeProfile(profile) {
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', PROBE, '-ProfilePath', profile], { windowsHide: true, timeout: 20000 });
  return JSON.parse(stdout.trim());
}
export function ownedBrowsers() { return [...owned.values()].map(entry => ({ pid: entry.pid, profile: entry.profile, ephemeral: entry.ephemeral, connected: !!entry.browser.connected })); }

// Background bank pages (plan omf-rakuten-auto-login-20261021 §5), stock Chrome and DevTools only: a headed owned Chrome started
// without a window of its own (--no-startup-window); its pages open in an INACTIVE new window placed off-screen
// (Target.createTarget background:true), so a job never takes the foreground, and the page receives its input through the
// DevTools pipe, never the system cursor or keyboard. showWindow(page) moves that SAME window to usable bounds on the primary work
// area when the person is needed. No other process's window is ever touched.
// Focus repair (case omf-background-focus-repair-20261030): that window is also MINIMIZED (windowState) right after Chrome creates it.
// An inactive normal window, even off-screen, stays an ordinary top-level window that Windows itself can hand the foreground to (a
// native control sampled the foreground on the owned Chrome while it read the statement code; Chrome 155 requests no activation on
// this path); Windows does not choose a minimized window when it activates one on its own, and an activation Chrome itself requested
// would first restore it (off-screen; the native tests record any restore). Chrome 155 shows the window inactive once at its default
// bounds, moves it to the off-screen bounds (kept as its restore bounds) and minimizes it. While minimized the page is hidden: DevTools
// input, navigation, timers and downloads work; animation frames, IntersectionObserver and CSS transitions wait until it is shown.
// showWindow restores the same window before moving it on screen.
export const BACKGROUND_ARGS = Object.freeze(['--no-startup-window']);
const OFFSCREEN = Object.freeze({ left: -32000, top: -32000, width: 1280, height: 900 });
async function backgroundPage(browser) {
  const session = await browser.target().createCDPSession(); let targetId;
  try { ({ targetId } = await session.send('Target.createTarget', { url: 'about:blank', newWindow: true, background: true, windowState: 'minimized', ...OFFSCREEN })); }
  finally { await session.detach().catch(() => {}); }
  const target = await browser.waitForTarget(t => t._targetId === targetId, { timeout: 30000 });
  const page = await target.page();
  if (!page) throw new Error('The background bank window did not open');
  return page;
}
/** Shows the owned window of `page` at normal, usable bounds on the primary work area and brings its tab to the front. */
export async function showWindow(page, { margin = 40 } = {}) {
  let session = null;
  try {
    session = await page.createCDPSession();
    const { windowId } = await session.send('Browser.getWindowForTarget');
    const area = await page.evaluate(() => ({ left: screen.availLeft, top: screen.availTop, width: screen.availWidth, height: screen.availHeight }));
    const width = Math.max(800, Math.min(1280, area.width - 2 * margin)), height = Math.max(600, Math.min(900, area.height - 2 * margin));
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await session.send('Browser.setWindowBounds', { windowId, bounds: { left: area.left + margin, top: area.top + margin, width, height } });
  } catch { /* headless or closing: bringing the tab to the front below is all that remains */ }
  finally { await session?.detach().catch(() => {}); }
  await Promise.race([page.bringToFront(), new Promise(resolve => setTimeout(resolve, 3000))]);
}

/**
 * Launches owned Chrome on `profile` (or returns the browser this process already launched there).
 * options: ephemeral (the profile is deleted at closure; needs root), root (the collector directory), headless
 * (false = the visible window of the first release; tests use true), onLaunch({pid, browser}) — the collector
 * hands the process to the batch's broker (job object) here; a failure closes the browser and rethrows. background (headed
 * only; bank retrievals): no startup window, and this browser's newPage() opens an inactive, minimized off-screen window (see above).
 */
export async function browserFor(profile, { ephemeral = false, root = /** @type {string|null} */ (null), headless = false, onLaunch = null, background = false } = {}) {
  const key = keyOf(profile);
  for (const entry of owned.values()) if (entry.key === key && entry.browser.connected) return entry.browser;
  if (ephemeral) { assertEphemeralPath(profile, root); await mkdir(ephemeralRoot(root), { recursive: true }); await assertPlainDirectory(ephemeralRoot(root)); }
  await mkdir(profile, { recursive: true });
  const probe = await probeProfile(profile);
  const existingProfile = await access(path.join(profile, 'Default')).then(() => true, () => false);
  if (probe.matches.length || (existingProfile && probe.unreadable.length)) throw new Error('Close the Chrome window that is already using this profile before retrying; the collector never attaches to an existing browser');
  const executablePath = findChrome();
  if (!executablePath) throw new Error('Google Chrome was not found in its standard locations on this PC');
  const quiet = background && !headless;
  const browser = await puppeteer.launch({ executablePath, pipe: true, headless, userDataDir: profile, defaultViewport: null, protocolTimeout: 30000, args: [...LAUNCH_ARGS, ...(quiet ? BACKGROUND_ARGS : [])], ...(quiet ? { ignoreDefaultArgs: ['about:blank'], waitForInitialPage: false } : {}) });
  if (quiet) browser.newPage = () => backgroundPage(browser); // guard:background-window
  const child = browser.process(), pid = child && child.pid ? child.pid : -1;
  const entry = { key, profile, ephemeral, root, pid, browser, child };
  owned.set(pid, entry);
  if (onLaunch) {
    try { await onLaunch({ pid, browser }); }
    catch (error) { await closeEntry(entry); throw error; }
  }
  return browser;
}

async function closeEntry(entry) {
  const { browser, child } = entry;
  try { if (browser.connected) await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 5000))]); } catch { /* closing */ }
  // A signalled child retains exitCode=null after its exit event. It is already
  // stopped; registering another exit listener would wait the full timeout.
  if (child && child.exitCode === null && !child.signalCode) {
    try { child.kill(); } catch { /* gone */ }
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
  }
  owned.delete(entry.pid);
  if (entry.ephemeral) await removeEphemeral(entry.profile, entry.root);
}
/** Closes every browser this process launched (lock, expiry, locked event, batch end), then deletes the ephemeral profiles. */
export async function closeOwnedBrowsers() {
  const closed = [];
  for (const entry of [...owned.values()]) { await closeEntry(entry); closed.push(entry.pid); }
  return closed;
}
/** Deletes one ephemeral profile directory after containment checks (direct child of profiles/ephemeral, no link). */
export async function removeEphemeral(profile, root) {
  assertEphemeralPath(profile, root);
  let stat;
  try { stat = await lstat(profile); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Refusing to remove a profile path that is a link or not a directory');
  if (keyOf(await realpathNative(profile)) !== keyOf(profile)) throw new Error('Refusing to remove a profile path that resolves elsewhere');
  for (let attempt = 0; ; attempt += 1) {
    try { await rm(profile, { recursive: true, force: true }); return true; }
    catch (error) { if (attempt >= 24) throw error; await new Promise(resolve => setTimeout(resolve, 500)); }
  }
}
/** Startup crash recovery: ends leftover Chrome processes on ephemeral profiles (exact identity) and removes their folders. */
export async function recoverEphemeral(root) {
  const base = ephemeralRoot(root);
  await mkdir(base, { recursive: true });
  await assertPlainDirectory(base);
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', PROBE, '-Root', base, '-Kill'], { windowsHide: true, timeout: 60000 });
  const probe = JSON.parse(stdout.trim());
  const removed = [], skipped = [];
  for (const name of await readdir(base)) {
    try { if (await removeEphemeral(path.join(base, name), root)) removed.push(name); }
    catch { skipped.push(name); }
  }
  return { killed: Array.isArray(probe.killed) ? probe.killed : [], failed: Array.isArray(probe.failed) ? probe.failed : [], removed, skipped };
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

/**
 * One batch's statement download in an owned, ephemeral, sandboxed Chrome: profiles/ephemeral/<owner>-amex-<account>-<batch>,
 * deleted at closure; retained profiles are never opened. `settings` are the credentials opened inside the batch (none in
 * the manual lane); `gmail` the mailbox grant opened inside the batch; `onLaunch` the ownership hand-over; `origin` binds
 * the outbox manifest to the paired OMF. Plan omf-card-handover-20261030: the routine download runs in the background owned
 * Chrome of the bank jobs (no startup window, an inactive, minimized off-screen page, input only through DevTools); when the person is
 * needed the login UI calls `reveal` (default showWindow) on that SAME page — never another window, never a global input.
 */
export async function collectStatement(account, settings, directory, status, { gmail = null, batch = 'batch', onLaunch = null, origin = '', reveal = showWindow } = {}) {
  const profile = ephemeralProfile(directory, account.ownerId, 'amex', account._id, batch);
  const browser = await browserFor(profile, { ephemeral: true, root: directory, onLaunch, background: true }); // guard:card-background-amex
  try {
    const page=await amexPage(browser);
    return await collectFromPage(page, browser, account, settings, directory, status, { mailbox: gmail ? new LoginMailbox(gmail) : null, claims: new LoginClaims(directory), origin, ui: loginUi(page, { reveal }) }); // guard:card-reveal-amex
  } finally {
    const entry=owned.get(browser.process()?.pid);
    if(entry)await closeEntry(entry);
  }
}

// `ui` (optional): a login UI for ensureLogin in place of its own default loginUi(page) — the cloud probe's adapter
// (cloud-probe/run.mjs cloudLoginUi). Undefined = the Windows collector's login, unchanged; collectStatement passes that same
// default loginUi with its background reveal callback.
/** @param {any} page @param {any} browser @param {any} account @param {any} settings @param {string} directory @param {any} status @param {{ mailbox?: any, claims?: any, ui?: any, origin?: string }} [options] */
export async function collectFromPage(page, browser, account, settings, directory, status, { mailbox = null, claims = null, ui, origin = '' } = {}) {
  await ensureLogin(page, settings, status, { account, mailbox, claims, ui });
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
    const manifest = { accountId: account._id, primaryCard: account.primaryCard, jobId: account.jobId, ...coverage, pageCount, sha256: parsed.sha256, filename, downloadedAt: new Date().toISOString(), ...(account.ownerId ? { ownerId: String(account.ownerId) } : {}), ...(origin ? { origin } : {}) };
    await writeFile(path.join(jobDir, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    return { directory: jobDir, manifest };
  } finally {
    clearTimeout(timer);
    await session.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: false }).catch(() => {});
    await session.detach().catch(() => {});
  }
}

/**
 * One job's Aplus collection (plan omf-aplus-automation-20261013) in an owned, ephemeral, sandboxed Chrome:
 * profiles/ephemeral/<owner>-aplus-<account>-<batch>, deleted at closure. `settings` are the credentials opened inside the
 * batch (none → the person signs in); `covered` the finalized months OMF or the outbox already holds; `jobId` the claimed
 * job; `codeSource` the statement-code SMS source and `signal` the session's abort (plan omf-auto-sync-build-20261014 §2
 * A10); `ui` the same test seam collectFromPage has (undefined = the real page). The page logic lives in ./aplus.mjs (no
 * node_modules), so this is the lane's only puppeteer touchpoint. Plan omf-card-handover-20261030: background owned Chrome as
 * collectStatement; the real page's show() calls `reveal` (default showWindow) on that SAME page when the person is needed.
 */
export async function collectAplusStatement(account, settings, directory, status, { batch = 'batch', onLaunch = null, origin = '', covered = [], jobId = account.jobId, codeSource = null, signal = null, ui = undefined, reveal = showWindow } = {}) {
  const profile = ephemeralProfile(directory, account.ownerId, 'aplus', account._id, batch);
  const browser = await browserFor(profile, { ephemeral: true, root: directory, onLaunch, background: true }); // guard:card-background-aplus
  try {
    const page = await browser.newPage();
    return await collectAplusFromPage(page, browser, account, settings, directory, status, { covered, jobId, origin, codeSource, signal, ui, reveal }); // guard:card-reveal-aplus
  } finally {
    const entry = owned.get(browser.process()?.pid);
    if (entry) await closeEntry(entry);
  }
}
