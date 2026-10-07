// cloud-probe/run.mjs — runs INSIDE the Railway container as the ssh session's foreground command:
//   node /app/cloud-probe/run.mjs
// (plan omf-railway-amex-probe-20261007 S2). One JSON line on stdin names the stage and the account; stage collect
// also carries the saved login, stage reach carries NO credentials key. The line is never written to disk or
// echoed. Linux Chrome starts with the Windows collector's flags; reach asks "is the login form shown?", collect
// runs the collector's own collectFromPage with the relay mailbox/claims stubs (the Gmail token and the claims file
// stay on Ryzen 7). Exactly one result line, built from scrubbed strings only; every exit named; no retry; no
// automatic bot verdict (the owner reads the capture, S8); /run/omf/{profile,download,work} removed at the end.
import { mkdir, rm, statfs } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { amexPage, collectFromPage } from '../collector/browser.mjs';
import { loginUi } from '../collector/login.mjs';
import { poll } from '../collector/interaction.mjs';
import { ContainerRelay, scrub } from './relay.mjs';
export { scrub } from './relay.mjs';

export const ROOT = '/run/omf';
export const CHROME_PATH = '/usr/bin/google-chrome-stable';
export const STAGES = ['reach', 'collect'];
export const OUTCOMES = ['login_form_shown', 'collected', 'attention', 'issuer_unavailable', 'unknown_page', 'browser_unavailable', 'service_failure'];
const FRAME_BUDGET_MS = 2500, REACH_WAIT_MS = 30000;

// collector/browser.mjs:39 flags plus the Linux Chrome path; puppeteer-real-browser adds Xvfb and --no-sandbox itself.
export function chromeOptions(root = ROOT) {
  return {
    headless: false, turnstile: false,
    args: ['--lang=ja-JP,ja', '--accept-lang=ja-JP,ja;q=0.9,en;q=0.8'],
    customConfig: { userDataDir: path.join(root, 'profile'), chromePath: CHROME_PATH },
    connectOption: { defaultViewport: null, protocolTimeout: 30000 }
  };
}

function withBudget(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('budget exceeded')), ms); if (typeof timer.unref === 'function') timer.unref(); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// The DOM step (capture rule 1), run inside each frame: inputs emptied and their value attributes dropped, every
// text node holding a secret rewritten, then the document serialised. Extra cover for frameworks that sync `value`.
function redactedDocument(secrets) {
  const inputs = /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('input, textarea'));
  for (const input of inputs) { try { input.value = ''; input.removeAttribute('value'); } catch {} }
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) if (secrets.some(secret => node.nodeValue.includes(secret))) node.nodeValue = '[REDACTED]';
  return { html: document.documentElement.outerHTML, text: document.body ? document.body.innerText : '' };
}

// Per frame, main first, each within one budget: DOM step, else content() with empty text; then the string step.
// The screenshot exists only in stage reach, before any credential was typed.
export async function capture(page, secrets, { screenshot = false } = {}) {
  const frames = [];
  let list = [];
  try { const main = page.mainFrame(); list = [main, ...page.frames().filter(frame => frame !== main)]; } catch { list = []; }
  for (const frame of list) {
    let url = '', html = '', text = '';
    try { url = String(frame.url() || ''); } catch { url = ''; }
    try { const dom = await withBudget(frame.evaluate(redactedDocument, secrets), FRAME_BUDGET_MS); html = String(dom?.html ?? ''); text = String(dom?.text ?? ''); }
    catch { try { html = String(await withBudget(frame.content(), FRAME_BUDGET_MS)); } catch { html = ''; } text = ''; }
    frames.push({ url: scrub(url, secrets), html: scrub(html, secrets), text: scrub(text, secrets) });
  }
  const result = { frames };
  if (screenshot) { try { result.screenshot = await withBudget(page.screenshot({ type: 'png', encoding: 'base64' }), 15000); } catch { result.screenshot = null; } }
  return result;
}

const message = error => String((error && error.message) || error || 'unknown error');
const safeUrl = page => { try { return String((page && page.url()) || ''); } catch { return ''; } };

// Every exit named (house rule 7). No automatic bot_rejected: Amex's block page is not on record (S8).
export function classify(error, page, navigation) {
  const text = message(error);
  if (error && error.reasonCode) return { outcome: 'service_failure', reasonCode: error.reasonCode };
  if (/needs attention/.test(text)) return { outcome: 'attention', reasonCode: null };
  if (/already used/.test(text)) return { outcome: 'service_failure', reasonCode: 'claim_failed' };
  if (/Downloaded row count does not match/.test(text)) return { outcome: 'service_failure', reasonCode: 'row_count_mismatch' };
  if (/net::ERR_|Navigation timeout|chrome-error:\/\//.test(text) || /^chrome-error:\/\//.test(safeUrl(page)) || ((navigation && navigation.status) || 0) >= 500) return { outcome: 'issuer_unavailable', reasonCode: null };
  return { outcome: 'unknown_page', reasonCode: null };
}

async function egressAddress() {
  try {
    const response = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(10000) });
    const { ip } = await response.json();
    return typeof ip === 'string' ? ip : null;
  } catch { return null; }
}
async function shmBytes(statfsFn) { try { const stats = await statfsFn('/dev/shm'); return Number(stats.bsize) * Number(stats.blocks); } catch { return null; } }
async function pageKind(page) { try { const state = await withBudget(loginUi(page).state(), 5000); return (state && state.kind) || null; } catch { return null; } }
async function browserFacts(browser, page) {
  const facts = { chrome: null, userAgent: null, webdriver: null, languages: null, timeZone: null };
  try { facts.chrome = await withBudget(browser.version(), 5000); } catch {}
  try { facts.userAgent = await withBudget(browser.userAgent(), 5000); } catch {}
  try { Object.assign(facts, await withBudget(page.evaluate(() => ({ webdriver: navigator.webdriver, languages: [...navigator.languages], timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })), 5000)); } catch {}
  return facts;
}

async function probe({ relay, output, connect, root, fetchIp, secrets, session }) {
  const fields = { stage: null, outcome: null, reason: null, reasonCode: null, pageKind: null, url: null, egressIp: null, browser: null };
  let request;
  try { request = await relay.first(); }
  catch (error) { return { ...fields, outcome: 'service_failure', reasonCode: error.reasonCode || 'malformed_stdin', reason: message(error) }; }
  const { stage, account } = request;
  const credentials = request.credentials && typeof request.credentials === 'object' ? request.credentials : null;
  if (!STAGES.includes(stage) || !account || typeof account !== 'object' || typeof account.primaryCard !== 'string') return { ...fields, outcome: 'service_failure', reasonCode: 'malformed_stdin', reason: 'The stdin line does not name a stage and an account' };
  fields.stage = stage;
  if (stage === 'collect') for (const value of [credentials && credentials.username, credentials && credentials.password]) if (typeof value === 'string' && value) secrets.push(value);

  // Chrome with the collector's flags. A failure here is browser_unavailable; uid and shm are already in the result.
  let browser, page;
  try {
    await mkdir(path.join(root, 'work'), { recursive: true });
    ({ browser } = await connect(chromeOptions(root)));
    session.browser = browser;
    page = await amexPage(browser);
    session.page = page;
  } catch (error) { return { ...fields, outcome: 'browser_unavailable', reason: message(error) }; }
  fields.browser = await browserFacts(browser, page);
  fields.egressIp = await fetchIp();
  try { page.on('response', response => { try { if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) session.navigation.status = response.status(); } catch {} }); } catch {}

  const status = async (state, text) => {
    session.lastStatus = { state: String(state), text: scrub(String(text), secrets) };
    output.write(JSON.stringify({ event: 'status', ...session.lastStatus }) + '\n');
  };
  const attempt = async () => {
    try {
      if (stage === 'reach') {
        const ui = loginUi(page);
        await ui.open();
        const state = await poll(async () => { const current = await ui.state(); return current && current.kind && current.kind !== 'unknown' ? current : null; }, REACH_WAIT_MS);
        return { outcome: state?.kind === 'login' ? 'login_form_shown' : 'unknown_page', reasonCode: null, reason: null };
      }
      const collected = await collectFromPage(page, browser, account, credentials, path.join(root, 'work'), status, { mailbox: relay.mailbox({ onCode: code => secrets.push(code) }), claims: relay.claims() });
      return { outcome: 'collected', reasonCode: null, reason: null, manifest: collected.manifest };
    } catch (error) { return { ...classify(error, page, session.navigation), reason: message(error) }; }
  };
  // One attempt. No retry, resend, second password or second session after any outcome (S8).
  const ending = await attempt();
  Object.assign(fields, ending);
  fields.pageKind = await pageKind(page);
  fields.url = safeUrl(page);
  if (ending.outcome !== 'collected') fields.capture = await capture(page, secrets, { screenshot: stage === 'reach' });
  return fields;
}

export async function run(deps = {}) {
  const { input = process.stdin, output = process.stdout, connect, root = ROOT, fetchIp = egressAddress, statfs: statfsFn = statfs } = deps;
  const relay = new ContainerRelay(input, output);
  const secrets = [];
  const session = { browser: null, page: null, lastStatus: null, navigation: { status: null } };
  const result = { event: 'result', stage: null, outcome: null, reason: null, reasonCode: null, lastStatus: null, pageKind: null, url: null, browser: null, egressIp: null };
  const facts = { uid: typeof process.getuid === 'function' ? process.getuid() : null, shm: await shmBytes(statfsFn) };
  let fields;
  try { fields = await probe({ relay, output, connect, root, fetchIp, secrets, session }); }
  catch (error) { fields = { outcome: 'service_failure', reasonCode: (error && error.reasonCode) || 'runner_crash', reason: message(error) }; }
  Object.assign(result, fields);
  result.browser = { ...facts, ...(fields.browser || {}) };
  result.lastStatus = session.lastStatus;
  for (const key of ['reason', 'url', 'pageKind']) result[key] = result[key] == null ? null : scrub(result[key], secrets);
  try { output.write(JSON.stringify(result) + '\n'); } catch {}
  try { relay.close(); } catch {}
  try { if (session.browser) await withBudget(session.browser.close(), 15000); } catch {}
  for (const name of ['profile', 'download', 'work']) await rm(path.join(root, name), { recursive: true, force: true }).catch(() => {});
  return result;
}

async function main() {
  // The collector's locked dependency, resolved from collector/ (the only node_modules in the image).
  const resolver = createRequire(new URL('../collector/package.json', import.meta.url));
  const { connect } = resolver('puppeteer-real-browser');
  await run({ connect });
  await new Promise(resolve => process.stdout.write('', () => resolve(undefined)));
  process.exit(0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    try { process.stdout.write(JSON.stringify({ event: 'result', stage: null, outcome: 'service_failure', reasonCode: 'runner_crash', reason: message(error).slice(0, 300) }) + '\n'); } catch {}
    process.exit(0);
  });
}
