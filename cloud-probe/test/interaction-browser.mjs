// Real-Chrome synthetic behavioural test of collector/interaction.mjs click() (plan omf-amex-scroll-click-20261009).
//
// Amex's login page scrolls smoothly (CSS scroll-behavior: smooth). click() scrolls the control into view, reads its
// rectangle and dispatches the trusted pointer event at that point. With a smooth scroll the rectangle is the
// PRE-scroll one, and by the time the pointer event lands the control has moved: on 2026-10-09 the cloud attempt
// clicked the page footer at clientY 545 instead of #loginSubmit (scroll-reproduction.json, saved-login-form-geometry.json:
// viewport 1279x755, button 347x50 at top 520, scrolled 168 px to 352). The instant scroll reads the settled rectangle.
//
// This module launches the stock Chrome installed on THIS host (Windows/Linux system locations, or the test-only
// OMF_TEST_CHROME executable), headless, in a fresh temporary profile, through the collector's own installed puppeteer
// (the one collector/browser.mjs uses), with every request intercepted: the synthetic documents below are answered in
// process, everything else is aborted, and the synthetic hosts are reserved .invalid names that cannot resolve
// (--host-resolver-rules=MAP * ~NOTFOUND as a second fence). No issuer host, credential, mailbox, vault, OMF data or
// network. Each leg records the ACTUAL trusted click target the page received — not a source-text option.
//
// Legs: the click after a smooth scroll down and up (natural pointer timing, and the pointer dispatched after the
// scroll animation settled — the cloud timing made deterministic), the ordinary auto-scroll page, the OTP channel
// label (label[for]) and the text-selected button (次へ / ダウンロード shape), and the four existing refusals that must
// keep refusing without a click: wrong origin, covered control, duplicate controls, disabled control.
//
// Not a node:test file and nothing runs at import. The fixture scripts/zoomer-fixtures/amex-scroll-click.mjs calls
// runInteractionLegs() against the real module and against a copy with the smooth-scroll original restored. Run it
// only through the hub verifier (node scripts/zoomer-verify.mjs --run-fixture amex-scroll-click.mjs --cwd <worktree>).
import { existsSync } from 'node:fs';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const COLLECTOR_DIR = path.resolve(here, '..', '..', 'collector');

/** The recorded cloud viewport (saved-login-form-geometry.json). */
export const VIEWPORT = Object.freeze({ width: 1279, height: 755 });
/** Reserved names: never resolve, never an issuer. */
export const ORIGIN = 'https://omf-synthetic.invalid';
export const OTHER_ORIGIN = 'https://omf-other.invalid';
export const SCROLL_SETTLE_MS = 3000;

/** @typedef {{ id: string, x: number, y: number, trusted: boolean }} Click */
/** @typedef {{ name: string, ok: boolean, message: string, error: string|null, clicks: Click[], scrollY: number|null, controlY: number|null, checked: boolean|null, ms: number }} Leg */

// Stock Chrome locations on the two platforms the collector runs on; OMF_TEST_CHROME (test-only) wins when set.
export function chromeCandidates(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    return [
      path.join(env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ].filter(candidate => !candidate.startsWith(path.sep + 'Google'));
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
}

/** @returns {string|null} the executable, or null (a reported failure for the caller, never a silent pass). */
export function findChrome(env = process.env, platform = process.platform) {
  if (env.OMF_TEST_CHROME) return existsSync(env.OMF_TEST_CHROME) ? env.OMF_TEST_CHROME : null;
  return chromeCandidates(env, platform).find(candidate => existsSync(candidate)) || null;
}

// The collector's installed puppeteer, resolved exactly as collector/browser.mjs resolves it (the package
// puppeteer-real-browser depends on), from the collector's own node_modules.
function collectorPuppeteer() {
  const collectorRequire = createRequire(path.join(COLLECTOR_DIR, 'package.json'));
  return collectorRequire(collectorRequire.resolve('rebrowser-puppeteer-core', { paths: [path.dirname(collectorRequire.resolve('puppeteer-real-browser'))] }));
}

// The synthetic page: the recorded geometry. The control is 347x50 at x 255; "down" starts unscrolled with the control at
// document 520 (visible, below the viewport centre) — `block: 'center'` scrolls 168 px, the control settles at 352..402
// (centre 377) and the stale centre 545 then lies on #decoy-below (620..1620). "up" starts scrolled 400 px with the
// control at document 500 (viewport 100): the page scrolls up ~252 px and the stale centre 125 then lies on #decoy-above
// (0..450). The capture-phase listener records what the browser actually hit.
const CONTROL = '<button id="target" class="control" type="button">Synthetic</button>';
const DISABLED_CONTROL = '<button id="target" class="control" type="button" disabled>Synthetic</button>';
const NEXT_BUTTON = '<button id="target" class="control" type="button">次へ</button>';
const CANCEL_BUTTON = '<button id="other-cancel" class="aside" type="button">キャンセル</button>';
const TWIN_BUTTON = '<button id="twin" class="aside" type="button">Synthetic</button>';
const CHANNEL_LABEL = '<label id="channel-label" class="control" for="channel-email">メール</label><input type="radio" id="channel-email" name="channel">';
const COVER = '<div id="cover"></div>';

/** @param {{ behavior: 'smooth'|'auto', layout: 'down'|'up', control?: string, extra?: string }} spec */
export function syntheticDocument({ behavior, layout, control = CONTROL, extra = '' }) {
  const controlTop = layout === 'up' ? 500 : 520, startScroll = layout === 'up' ? 400 : 0;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>omf synthetic interaction page</title><style>
html { scroll-behavior: ${behavior}; }
body { margin: 0; height: 1800px; font-family: sans-serif; }
#decoy-above { position: absolute; top: 0; left: 0; width: 100%; height: 450px; background: #ddd; }
#decoy-below { position: absolute; top: 620px; left: 0; width: 100%; height: 1000px; background: #eee; }
.control { position: absolute; left: 255px; top: ${controlTop}px; width: 347px; height: 50px; box-sizing: border-box; display: block; }
.aside { position: absolute; left: 700px; top: ${controlTop}px; width: 300px; height: 50px; }
#channel-email { position: absolute; left: 200px; top: ${controlTop + 17}px; width: 16px; height: 16px; margin: 0; }
#cover { position: fixed; inset: 0; z-index: 10; background: rgba(0, 0, 0, 0.2); }
</style></head><body>
<div id="decoy-above"></div>
${control}
${extra}
<div id="decoy-below"></div>
<script>
window.__clicks = [];
document.addEventListener('click', e => { const t = e.target; window.__clicks.push({ id: t.id || t.tagName.toLowerCase(), x: e.clientX, y: e.clientY, trusted: e.isTrusted }); }, true);
${startScroll ? `window.scrollTo({ top: ${startScroll}, left: 0, behavior: 'instant' });` : ''}
</script></body></html>`;
}

// Legs. `pointer: 'late'` hands click() the same page with one difference: the pointer event is dispatched only after the
// document stopped scrolling (the cloud case's effect — the control moved between the rectangle read and the pointer —
// made deterministic). `natural` is click() on the real page object with no change. `refuse` legs must throw the named
// existing refusal and dispatch no click at all.
export const LEGS = Object.freeze([
  { name: 'smooth-down', page: { behavior: 'smooth', layout: 'down' }, selector: '#target', text: null, pointer: 'natural', expect: 'target' },
  { name: 'smooth-down-late-pointer', page: { behavior: 'smooth', layout: 'down' }, selector: '#target', text: null, pointer: 'late', expect: 'target' },
  { name: 'smooth-up', page: { behavior: 'smooth', layout: 'up' }, selector: '#target', text: null, pointer: 'natural', expect: 'target' },
  { name: 'smooth-up-late-pointer', page: { behavior: 'smooth', layout: 'up' }, selector: '#target', text: null, pointer: 'late', expect: 'target' },
  { name: 'auto-down', page: { behavior: 'auto', layout: 'down' }, selector: '#target', text: null, pointer: 'natural', expect: 'target' },
  { name: 'label-late-pointer', page: { behavior: 'smooth', layout: 'down', control: CHANNEL_LABEL }, selector: 'label[for="channel-email"]', text: null, pointer: 'late', expect: 'channel-label', checked: true },
  { name: 'text-button-late-pointer', page: { behavior: 'smooth', layout: 'down', control: NEXT_BUTTON, extra: CANCEL_BUTTON }, selector: 'button', text: '次へ', pointer: 'late', expect: 'target' },
  { name: 'wrong-origin', page: { behavior: 'smooth', layout: 'down' }, selector: '#target', text: null, pointer: 'natural', origin: OTHER_ORIGIN, refuse: /The Amex page changed/ },
  { name: 'covered', page: { behavior: 'smooth', layout: 'down', extra: COVER }, selector: '#target', text: null, pointer: 'natural', refuse: /covered by another element/ },
  { name: 'duplicate', page: { behavior: 'smooth', layout: 'down', extra: TWIN_BUTTON }, selector: 'button', text: null, pointer: 'natural', refuse: /did not uniquely match/ },
  { name: 'disabled', page: { behavior: 'smooth', layout: 'down', control: DISABLED_CONTROL }, selector: '#target', text: null, pointer: 'natural', refuse: /did not uniquely match/ }
]);

// Resolves when window.scrollY has not changed for five animation frames (after 50 ms for an animation to start), or
// after SCROLL_SETTLE_MS.
async function scrollSettled(page) {
  await new Promise(resolve => setTimeout(resolve, 50));
  await page.evaluate(limit => new Promise(resolve => {
    let last = window.scrollY, stable = 0;
    const deadline = performance.now() + limit;
    const tick = () => {
      if (window.scrollY === last) stable += 1; else { stable = 0; last = window.scrollY; }
      if (stable >= 5 || performance.now() > deadline) resolve(undefined); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), SCROLL_SETTLE_MS - 50);
}

/** The same page for click(): url(), evaluate() and the keyboard untouched; the pointer waits for the scroll to settle. */
function latePointer(page) {
  return {
    url: () => page.url(),
    evaluate: (...args) => page.evaluate(...args),
    keyboard: page.keyboard,
    mouse: { click: async (x, y, options) => { await scrollSettled(page); return page.mouse.click(x, y, options); } }
  };
}

const describeClicks = clicks => clicks.length ? clicks.map(c => `${c.id}@y${Math.round(c.y)}${c.trusted ? '' : '(untrusted)'}`).join(',') : 'no click';

async function runLeg(page, click, leg, serve) {
  const pathname = `/legs/${leg.name}`;
  serve(pathname, syntheticDocument(leg.page));
  await page.goto(ORIGIN + pathname, { waitUntil: 'load', timeout: 20000 });
  const started = Date.now();
  let error = null;
  try { await click(leg.pointer === 'late' ? latePointer(page) : page, leg.selector, leg.text, leg.origin || ORIGIN, pathname); }
  catch (caught) { error = caught && caught.message ? String(caught.message) : String(caught); }
  await scrollSettled(page);
  const state = await page.evaluate(() => ({
    clicks: /** @type {Click[]} */ (/** @type {any} */ (window).__clicks),
    scrollY: window.scrollY,
    controlY: document.querySelector('.control')?.getBoundingClientRect().y ?? null,
    checked: /** @type {HTMLInputElement|null} */ (document.querySelector('#channel-email'))?.checked ?? null
  }));
  const ms = Date.now() - started;
  let ok, message;
  if (leg.refuse) {
    ok = error !== null && leg.refuse.test(error) && state.clicks.length === 0;
    message = ok ? `refused "${error}", no click` : `expected the refusal ${leg.refuse}, got ${error === null ? 'no error' : `"${error}"`} with ${describeClicks(state.clicks)}`;
  } else {
    // The label's activation click on its own radio is generated by the browser, not by the pointer.
    const pointerClicks = state.clicks.filter(c => c.id !== 'channel-email');
    const hit = pointerClicks.length === 1 && pointerClicks[0].id === leg.expect && pointerClicks[0].trusted === true;
    const checked = leg.checked === undefined || state.checked === leg.checked;
    ok = error === null && hit && checked;
    message = ok
      ? `${leg.expect} received the one trusted click at y ${Math.round(pointerClicks[0].y)} (scrollY ${state.scrollY}, control at ${state.controlY})${leg.checked === undefined ? '' : ', radio checked'}`
      : error !== null ? `click() threw "${error}" (${describeClicks(state.clicks)})`
      : `clicked ${describeClicks(pointerClicks)}, expected ${leg.expect}${leg.checked === undefined ? '' : ` with the radio ${leg.checked ? 'checked' : 'unchecked'} (checked: ${state.checked})`} (scrollY ${state.scrollY}, control at ${state.controlY})`;
  }
  return { name: leg.name, ok, message, error, clicks: state.clicks, scrollY: state.scrollY, controlY: state.controlY, checked: state.checked, ms };
}

async function removeOwned(directory) {
  // Owned cleanup only: a real directory this run created under the OS temp dir, never followed through a link.
  const root = path.resolve(os.tmpdir()) + path.sep;
  if (!path.resolve(directory).startsWith(root)) throw new Error(`refusing to remove ${directory}: not under ${root}`);
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`refusing to remove ${directory}: not a plain directory`);
  for (let attempt = 0; ; attempt++) {
    try { await rm(directory, { recursive: true, force: true }); return; }
    catch (error) { if (attempt >= 5) throw error; await new Promise(resolve => setTimeout(resolve, 300)); }
  }
}

/**
 * Runs the legs against the click() exported by `interactionUrl` in a fresh headless stock Chrome.
 * @param {{ interactionUrl: string, chromePath?: string|null, legs?: readonly string[] }} options
 * @returns {Promise<{ ok: boolean, chrome: string|null, version: string|null, legs: Leg[], blocked: string[], served: number, ms: number, error: string|null, profileLeft: string|null }>}
 */
export async function runInteractionLegs({ interactionUrl, chromePath = findChrome(), legs = LEGS.map(leg => leg.name) }) {
  const started = Date.now();
  /** @type {Leg[]} */ const results = [];
  /** @type {string[]} */ const blocked = [];
  let served = 0, version = null, error = null, profileLeft = null;
  const done = () => ({ ok: error === null && results.length === legs.length && results.every(leg => leg.ok), chrome: chromePath, version, legs: results, blocked, served, ms: Date.now() - started, error, profileLeft });
  if (!chromePath) { error = `Chrome not found (looked at ${chromeCandidates().join(', ')}); set OMF_TEST_CHROME to a test-only Chrome executable`; return done(); }
  let puppeteer, click;
  try { puppeteer = collectorPuppeteer(); }
  catch (caught) { error = `the collector's installed puppeteer could not be loaded from ${COLLECTOR_DIR}: ${caught && caught.message ? caught.message : caught}`; return done(); }
  try { ({ click } = await import(interactionUrl)); if (typeof click !== 'function') throw new Error('click is not an exported function'); }
  catch (caught) { error = `interaction module ${interactionUrl} could not be loaded: ${caught && caught.message ? caught.message : caught}`; return done(); }
  const profile = await mkdtemp(path.join(os.tmpdir(), 'omf-interaction-chrome-'));
  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      userDataDir: profile,
      defaultViewport: { width: VIEWPORT.width, height: VIEWPORT.height },
      protocolTimeout: 30000,
      args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking', '--disable-component-update', '--host-resolver-rules=MAP * ~NOTFOUND', '--lang=ja-JP']
    });
    version = String(await browser.version());
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    let current = { pathname: '', html: '' };
    const serve = (pathname, html) => { current = { pathname, html }; };
    page.on('request', request => {
      const url = String(request.url());
      if (current.pathname && url === ORIGIN + current.pathname && request.resourceType() === 'document') { served += 1; request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: current.html }).catch(() => {}); }
      else { blocked.push(url); request.abort('blockedbyclient').catch(() => {}); }
    });
    for (const name of legs) {
      const leg = LEGS.find(candidate => candidate.name === name);
      if (!leg) throw new Error(`unknown leg ${name}`);
      results.push(await runLeg(page, click, leg, serve));
    }
  } catch (caught) {
    error = `the browser run failed: ${caught && caught.message ? caught.message : caught}`;
  } finally {
    if (browser) {
      try { await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10000))]); } catch { /* closing */ }
      try { const child = browser.process(); if (child && child.exitCode === null) child.kill(); } catch { /* already gone */ }
    }
    try { await removeOwned(profile); } catch { profileLeft = profile; }
  }
  return done();
}
