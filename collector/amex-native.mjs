// collector/amex-native.mjs — the Amex statement download of the Windows downloader in stock Chrome without automation (case
// omf-amex-native-runtime-01). Amex refused the login request of the owned Chrome the bank lane drives through DevTools (automation mode:
// --enable-automation, and the DevTools pipe maps to the same AutomationControlled state); stock Chrome started without them was answered.
// collector/browser.mjs collectStatement prepares the ephemeral profile and calls this module; collector/windows/amex-native.ps1 starts
// Chrome and reads and drives the page through Windows UI Automation only.
//  - Ownership first: the helper process is started, the batch's broker takes it into its kill-on-close job through `onLaunch` (index.mjs
//    ownBrowser), and only then is Chrome launched (suspended, in the helper's own job nested under the broker's). No secret reaches the
//    helper before that. A failed ownership closes the helper; there is no launch without one.
//  - Mode, chosen once before launch: `private` (the routine download: a desktop that is never shown, never switched to) unless the job
//    is `attended` — the person asked for it (a manual batch, or the attended download armed on the setup screen) — which shows Chrome
//    on the person's own desktop. Missing setup or an Amex check never changes the mode: in private mode a needed person ends the job
//    with a fixed message naming the attended download; nothing is revealed, retried or submitted again.
//  - The login is collector/login.mjs ensureLogin with a native UI: its one password submission, recipient match, mailbox claim before
//    typing, request anchoring and deadlines are unchanged. Login values and the code go only to the helper's stdin.
//  - The statement steps are those of browser.mjs selectLatestStatement/collectFromPage: latestClosed, verifyStatement before and after
//    the download, parseAmex with the account's cards, rows === the page count, the manifest's fields and exclusive write.
//  - Reads tolerate a transient refusal (a second top-level document was seen briefly after downloads; a document between navigations)
//    until that step's own deadline; actions are sent once and never repeated, whatever their reply.
//  - One value-free record per job: <directory>/diagnostics/amex/<accountId>/<jobId>-<ms>.json (schema amex-native-trace-1; mode, fixed
//    step names, outcomes, helper codes, counts and milliseconds only), the 20 newest kept, outside the outbox, written after closure.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, readdir, readFile, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseAmex } from '../shared/amex.mjs';
import { ensureLogin, LoginClaims } from './login.mjs';
import { LoginMailbox } from './mail.mjs';
import { latestClosed, verifyStatement } from './statement.mjs';

export const NATIVE_SCRIPT = fileURLToPath(new URL('./windows/amex-native.ps1', import.meta.url));
// The process, mailbox and clock this module uses. Tests replace these properties in their own process (a fake helper, a fake mailbox,
// a virtual clock); nothing outside the process can change them, and the helper's target policy is compiled into the signed script.
export const nativeHost = {
  spawn: args => spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', NATIVE_SCRIPT, ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }),
  mailbox: gmail => new LoginMailbox(gmail),
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms))
};

export const OWNERSHIP_REQUIRED = 'The Amex download needs the batch ownership of its browser; nothing was started';
export const CHROME_MISSING = 'Google Chrome was not found in its standard locations on this PC';
export const NO_LOGIN = 'No Amex login is saved on this PC for this card. Save it on the downloader setup screen, or prepare an attended download there and sign in yourself';
export const PRIVATE_ATTENTION = 'Amex asked for a check that the background download cannot complete. On the downloader setup screen, prepare an attended download for this card, then request 確定明細を取得 in OMF';
export const HELPER_START = 'The Amex browser helper did not start';
export const HELPER_ENDED = 'The Amex browser ended before the statement was saved; request the download again';
export const PAGE_CHANGED = 'The Amex page changed before the statement was saved; request the download again';
export const OTHER_WINDOW = 'Amex opened another window; request the download again';
export const PAGE_UNREADABLE = 'The Amex statement page could not be read again; request the download again';
export const NOT_CSV = 'Amex download was not a CSV file';
const READY_MS = 60000, LAUNCH_MS = 30000, OPEN_MS = 60000, READ_MS = 20000, ACT_MS = 20000;
const STATEMENT_MS = 45000, CSV_MS = 15000, SELECTED_MS = 5000, RECHECK_MS = 15000, DOWNLOAD_MS = 45000;
// Helper refusals a read waits out (until its step's deadline): no single main document, a document between navigations or on another
// surface, an element gone while it was read. Every other refusal ends the job; an action's refusal always does.
export const TRANSIENT = Object.freeze(['ambiguous_document', 'no_document', 'document_url_unavailable', 'document_origin', 'document_path', 'element_not_available', 'uia_invalid_operation', 'uia_com']);
const ENDED = ['helper_exited', 'ipc_timeout', 'uia_watchdog', 'not_launched'];
// Every code the helper or this channel can give (the trace keeps only these; anything else is 'other').
export const CODES = Object.freeze([...TRANSIENT, ...ENDED, 'argument', 'mode', 'chrome_path', 'profile_path', 'downloads_path', 'job_creation', 'job_limit', 'helper_not_owned', 'already_launched', 'desktop_descriptor', 'desktop_creation', 'input_desktop_unavailable', 'preferences', 'chrome_creation', 'job_assignment', 'chrome_resume', 'no_window', 'ambiguous_window', 'window_not_locked', 'window_changed', 'window_not_owned', 'document_changed', 'unrelated_document_window', 'control_missing', 'control_ambiguous', 'control_type', 'control_disabled', 'control_readonly', 'invoke_unsupported', 'value_unsupported', 'selection_unsupported', 'not_radio', 'link_missing', 'link_ambiguous', 'statement_link_missing', 'statement_link_ambiguous', 'radio_missing', 'radio_ambiguous', 'dialog_button_missing', 'dialog_button_ambiguous', 'private_mode', 'unknown_op', 'invalid_request', 'error']);
const KINDS = ['authenticated', 'login', 'channels', 'code', 'unknown'];
const message = code => ENDED.includes(code) ? HELPER_ENDED : code === 'unrelated_document_window' ? OTHER_WINDOW : PAGE_CHANGED;
const bounded = (promise, ms, fallback) => { let timer; return Promise.race([promise, new Promise(resolve => { timer = setTimeout(resolve, ms, fallback); })]).finally(() => clearTimeout(timer)); };

// The value-free record of one job: fixed step names, outcomes, allowlisted helper codes, counts and milliseconds.
function traceOf(mode) {
  const started = nativeHost.now(), steps = [], states = {}, tolerated = {};
  let overflow = 0;
  const code = value => value == null ? null : CODES.includes(value) ? value : 'other';
  return {
    mode, steps, states, tolerated, get overflow() { return overflow; },
    step(name, outcome = 'ok', helperCode = null, reads = null) {
      if (steps.length >= 120) { overflow++; return; }
      steps.push({ step: name, ms: Math.min(Math.max(0, nativeHost.now() - started), 86400000), outcome, code: code(helperCode), ...(reads === null ? {} : { reads: Math.min(reads, 9999) }) });
    },
    state(kind) { states[kind] = Math.min((states[kind] || 0) + 1, 9999); },
    tolerate(value) { const key = code(value); tolerated[key] = Math.min((tolerated[key] || 0) + 1, 9999); }
  };
}

// The helper's JSON-lines channel: replies by id; {event:'ready'|'end'|'failure'}. A request resolves with the reply, or {ok:false,
// code:'helper_exited'|'ipc_timeout'}; it never rejects. Request lines are written and dropped, never kept or logged; stderr is drained.
function channel(child) {
  const pending = new Map(); let sequence = 0, closed = false, ended = null, readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const exited = new Promise(resolve => {
    const done = code => { if (closed) return; closed = true; for (const answer of pending.values()) answer({ ok: false, code: 'helper_exited' }); pending.clear(); readyResolve(null); resolve(code ?? null); };
    child.once('close', done); child.once('error', () => done(null));
  });
  child.stdin?.on?.('error', () => { /* the helper ended; its requests answer helper_exited */ });
  child.stderr?.resume?.();
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', line => {
    let reply; try { reply = JSON.parse(line); } catch { return; }
    if (!reply || typeof reply !== 'object') return;
    if (reply.event === 'ready') { readyResolve(reply); return; }
    if (reply.event === 'end' || reply.event === 'failure') { ended = reply; if (reply.event === 'failure') readyResolve(null); return; }
    const answer = pending.get(reply.id); if (!answer) return;
    pending.delete(reply.id); answer(reply);
  });
  return {
    pid: child.pid, exited,
    get ended() { return ended; },
    ready: ms => bounded(ready, ms, null),
    request(op, fields = {}, timeoutMs = READ_MS) {
      if (closed) return Promise.resolve({ ok: false, code: 'helper_exited' });
      const id = ++sequence;
      return new Promise(resolve => {
        const timer = setTimeout(() => { if (pending.delete(id)) resolve({ ok: false, code: 'ipc_timeout' }); }, timeoutMs + 15000);
        pending.set(id, reply => { clearTimeout(timer); resolve(reply); });
        try { child.stdin.write(JSON.stringify({ ...fields, id, op, timeoutMs }) + '\n'); } // the protocol keys are never a field's
        catch { pending.delete(id); clearTimeout(timer); resolve({ ok: false, code: 'helper_exited' }); }
      });
    },
    async end() {
      try { child.stdin.end(); } catch { /* closed */ }
      if (await bounded(exited.then(() => true), 10000, false)) return;
      try { child.kill(); } catch { /* gone */ }
      await bounded(exited, 5000, null);
    }
  };
}

// One action, sent once: its refusal ends the job (nothing is sent again, whether or not the helper had started acting).
async function act(helper, trace, op, fields = {}, timeoutMs = ACT_MS, step = op) {
  const reply = await helper.request(op, fields, timeoutMs);
  if (!reply.ok) { trace.step(step, reply.acted ? 'uncertain' : 'error', reply.code); throw new Error(message(reply.code)); }
  trace.step(step);
  return reply;
}
// One read until `accept` holds or `ms` passes (null): a transient refusal is another poll, any other refusal ends the job.
async function readUntil(helper, trace, op, accept, ms, step) {
  const deadline = nativeHost.now() + ms; let reads = 0;
  for (;;) {
    const reply = await helper.request(op, {}, READ_MS); reads++;
    if (reply.ok) { const value = accept(reply); if (value) { trace.step(step, 'ok', null, reads); return value; } }
    else if (TRANSIENT.includes(reply.code)) trace.tolerate(reply.code);
    else { trace.step(step, 'error', reply.code, reads); throw new Error(message(reply.code)); }
    if (nativeHost.now() >= deadline) { trace.step(step, 'timeout', null, reads); return null; }
    await nativeHost.sleep(400);
  }
}
const list = value => Array.isArray(value) ? value : [];
const snapshotOf = reply => ({ url: String(reply.url ?? ''), links: list(reply.links).map(l => ({ text: String(l?.text ?? ''), href: String(l?.href ?? '') })), periods: list(reply.periods).map(String), cards: list(reply.cards).map(String), counts: list(reply.counts).map(pair => list(pair).map(Number)) });
const endOf = snapshot => { try { return new URL(snapshot.url).searchParams.get('end'); } catch { return null; } };

// ensureLogin's UI over the helper (login.mjs loginUi's surfaces, read from the accessibility tree). open() is the launch itself.
export function nativeLoginUi(helper, mode, trace) {
  return {
    async open() { },
    async state() {
      const reply = await helper.request('state', {}, READ_MS);
      if (!reply.ok) {
        if (TRANSIENT.includes(reply.code)) { trace.tolerate(reply.code); return { kind: 'unknown' }; }
        trace.step('state', 'error', reply.code); throw new Error(message(reply.code));
      }
      const kind = KINDS.includes(reply.kind) ? reply.kind : 'unknown'; trace.state(kind);
      if (kind === 'channels') return { kind, channels: list(reply.channels).map(c => ({ id: String(c?.id ?? ''), text: String(c?.text ?? ''), checked: c?.checked === true })) };
      if (kind === 'code') return { kind, recipients: list(reply.recipients).map(String) };
      return { kind };
    },
    async login(credentials) { await act(helper, trace, 'login', { user: String(credentials.username), password: String(credentials.password) }); },
    async choose(channelOf) { await act(helper, trace, 'choose', { channel: String(channelOf.id) }); },
    async next() { await act(helper, trace, 'next'); },
    async code(value) { await act(helper, trace, 'code', { value: String(value) }); },
    // guard:amex-private-attention — the routine download is never shown: a needed person ends it with the fixed message
    async show() { if (mode !== 'input') { trace.step('attention', 'refused', 'private_mode'); throw new Error(PRIVATE_ATTENTION); } await act(helper, trace, 'show'); }
  };
}

// The one final file in the job's own download folder: no partial name, a stable non-zero size; more than one is refused.
async function awaitDownload(folder, ms) {
  const deadline = nativeHost.now() + ms; let stable = null;
  for (;;) {
    const names = await readdir(folder);
    const partial = names.filter(n => /\.crdownload$/i.test(n) || /^Unconfirmed /i.test(n) || /\.tmp$/i.test(n)), finals = names.filter(n => !partial.includes(n));
    if (finals.length > 1) throw new Error('Multiple downloads started; check the Amex tab');
    if (finals.length === 1 && !partial.length) {
      const entry = await lstat(path.join(folder, finals[0]));
      if (!entry.isFile()) throw new Error('Amex CSV download did not complete');
      if (stable && stable.name === finals[0] && stable.size === entry.size && entry.size > 0) return finals[0];
      stable = { name: finals[0], size: entry.size };
    } else stable = null;
    if (nativeHost.now() >= deadline) throw new Error('Amex CSV download did not complete');
    await nativeHost.sleep(250);
  }
}

async function writeTrace(directory, account, trace, outcome, helper) {
  const accountId = String(account?._id ?? ''), jobId = /^[A-Za-z0-9-]{1,64}$/.test(String(account?.jobId ?? '')) ? String(account.jobId) : null, at = Date.now();
  if (!/^[a-f\d]{24}$/.test(accountId)) return;
  const dir = path.join(directory, 'diagnostics', 'amex', accountId), stamp = name => Number(/^[A-Za-z0-9-]{1,64}-(\d{13})\.json$/.exec(name)?.[1] ?? NaN);
  const end = helper?.ended, exit = helper ? await bounded(helper.exited, 1000, null) : null;
  const record = { schema: 'amex-native-trace-1', accountId, jobId, at: new Date(at).toISOString(), mode: trace.mode, outcome, steps: trace.steps, states: trace.states, tolerated: trace.tolerated,
    helper: { started: !!helper, exit: Number.isSafeInteger(exit) ? exit : null, end: ['closed', 'stdin_closed', 'uia_watchdog'].includes(end?.reason) ? end.reason : null, chromeEnded: typeof end?.chromeEnded === 'boolean' ? end.chromeEnded : null, desktopClosed: typeof end?.desktopClosed === 'boolean' ? end.desktopClosed : null }, overflow: trace.overflow };
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${jobId || 'job'}-${at}.json`), JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  const kept = (await readdir(dir)).filter(name => Number.isSafeInteger(stamp(name))).sort((a, b) => stamp(b) - stamp(a));
  for (const name of kept.slice(20)) await rm(path.join(dir, name), { force: true });
}

/**
 * The Amex statement download of one claimed job (called by browser.mjs collectStatement, which owns `profile`: an empty ephemeral
 * profile no Chrome is using, removed after this returns). Returns { directory, manifest } as collectFromPage did.
 * attended: the person asked for this job (index.mjs) — Chrome on the person's desktop; otherwise the private desktop.
 */
export async function collectStatementNative(account, settings, directory, status, { profile, chrome, gmail = null, onLaunch = null, origin = '', attended = false } = {}) {
  const mode = attended ? 'input' : 'private', trace = traceOf(mode);
  let helper = null, folder = null, outcome = 'failed';
  try {
    if (process.platform !== 'win32') throw new Error('The Amex browser requires Windows');
    if (typeof onLaunch !== 'function') throw new Error(OWNERSHIP_REQUIRED); // guard:amex-native-ownership
    if (!chrome) throw new Error(CHROME_MISSING);
    if (mode === 'private' && !(settings?.username && settings?.password)) throw new Error(NO_LOGIN); // guard:amex-private-no-login
    const jobDir = path.join(directory, 'outbox', account._id, account.jobId);
    await mkdir(jobDir, { recursive: true });
    // Chrome's download folder for this attempt only: fresh and empty, inside the job's outbox folder (pending() reads only its manifest).
    folder = path.join(jobDir, 'download-' + randomUUID()); await mkdir(folder);
    helper = channel(nativeHost.spawn(['-Chrome', chrome, '-ProfileDir', profile, '-Downloads', folder, '-Mode', mode]));
    const ready = await helper.ready(READY_MS);
    if (!ready || ready.pid !== helper.pid || ready.mode !== mode) { trace.step('ready', 'error', helper.ended?.code ?? null); throw new Error(HELPER_START); }
    trace.step('ready');
    // guard:amex-native-own-before-launch — the batch's broker owns the helper before Chrome exists or a secret is sent
    try { await onLaunch({ pid: helper.pid, browser: null }); } catch (error) { trace.step('own', 'error'); throw error; }
    trace.step('own');
    await act(helper, trace, 'launch', {}, LAUNCH_MS);
    await act(helper, trace, 'wait-ready', {}, OPEN_MS);
    const ui = nativeLoginUi(helper, mode, trace);
    const quiet = async (state, text) => { if (state === 'verification_required' && mode !== 'input') return; await status(state, text); }; // guard:amex-private-status
    await ensureLogin(null, settings, quiet, { account, mailbox: gmail ? nativeHost.mailbox(gmail) : null, claims: new LoginClaims(directory), ui, wait: nativeHost.sleep, now: nativeHost.now });
    // selectLatestStatement: the signed-in card and the dated links, the latest closed period, its own verified link
    await status('running', 'Selecting the latest closed Amex statement');
    await act(helper, trace, 'open-statement');
    const initial = await readUntil(helper, trace, 'snapshot', reply => { const s = snapshotOf(reply); return s.links.length && s.cards.includes('-' + account.primaryCard) ? s : null; }, STATEMENT_MS, 'initial');
    if (!initial) throw new Error('Amex statement links or signed-in card could not be verified');
    const selected = latestClosed(initial.links, nativeHost.now());
    const key = link => { try { return latestClosed([link], nativeHost.now()).key; } catch { return null; } };
    const dated = initial.links.filter(l => { try { return new URL(l.href).href === selected.url && key(l) === selected.key; } catch { return false; } });
    if (dated.length !== 1) { trace.step('select', 'error'); throw new Error('Amex statement links or signed-in card could not be verified'); }
    trace.step('select');
    await act(helper, trace, 'invoke-period', { href: dated[0].href, name: dated[0].text });
    const period = await readUntil(helper, trace, 'snapshot', reply => { const s = snapshotOf(reply); return endOf(s) === selected.end && s.periods.length && s.counts.length && s.cards.length ? s : null; }, STATEMENT_MS, 'period');
    if (!period) throw new Error('The selected Amex statement did not finish loading');
    const pageCount = verifyStatement(period, selected, account.primaryCard);
    trace.step('verify-period');
    // collectFromPage: the download icon, the CSV choice, the check before, one ダウンロード, the file and the check after
    await status('running', `Downloading the closed statement ${selected.start} to ${selected.end}`);
    await act(helper, trace, 'download-open');
    if (!await readUntil(helper, trace, 'csv-state', reply => reply.present === true, CSV_MS, 'csv-present')) throw new Error('Amex CSV format option changed');
    await act(helper, trace, 'csv-select');
    if (!await readUntil(helper, trace, 'csv-state', reply => reply.present === true && reply.selected === true, SELECTED_MS, 'csv-selected')) throw new Error('Amex CSV format was not selected');
    const before = await readUntil(helper, trace, 'snapshot', snapshotOf, RECHECK_MS, 'verify-before');
    if (!before) throw new Error(PAGE_UNREADABLE);
    verifyStatement(before, selected, account.primaryCard);
    if ((await readdir(folder)).length) { trace.step('download', 'error'); throw new Error('Multiple downloads started; check the Amex tab'); }
    await act(helper, trace, 'download');
    let file;
    try { file = await awaitDownload(folder, DOWNLOAD_MS); } catch (error) { trace.step('file', 'error'); throw error; }
    trace.step('file');
    if (!/\.csv$/i.test(file)) { trace.step('validate', 'error'); throw new Error(NOT_CSV); }
    const bytes = await readFile(path.join(folder, file));
    let parsed;
    try { parsed = parseAmex(bytes, account.cardIdentifiers); } catch (error) { trace.step('validate', 'error'); throw error; }
    if (parsed.rows.length !== pageCount) { trace.step('validate', 'error'); throw new Error('Downloaded row count does not match the Amex page'); }
    trace.step('validate');
    // guard:amex-native-recheck — the selected card, period and complete count again after the file, read through any transient refusal
    const after = await readUntil(helper, trace, 'snapshot', snapshotOf, RECHECK_MS, 'verify-after');
    if (!after) throw new Error(PAGE_UNREADABLE);
    verifyStatement(after, selected, account.primaryCard);
    // The outbox file name is a fresh random UUID (upload() accepts only that form); the bytes are the verified ones, moved, never rewritten.
    const filename = randomUUID();
    await link(path.join(folder, file), path.join(jobDir, filename)); await unlink(path.join(folder, file));
    const { url: _url, ...coverage } = selected;
    const manifest = { accountId: account._id, primaryCard: account.primaryCard, jobId: account.jobId, ...coverage, pageCount, sha256: parsed.sha256, filename, downloadedAt: new Date().toISOString(), ...(account.ownerId ? { ownerId: String(account.ownerId) } : {}), ...(origin ? { origin } : {}) };
    await writeFile(path.join(jobDir, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    trace.step('manifest'); outcome = 'completed';
    return { directory: jobDir, manifest };
  } finally {
    if (helper) { const closed = await helper.request('close', {}, 15000); trace.step('close', closed.ok ? 'ok' : 'error', closed.ok ? null : closed.code); await helper.end(); }
    if (folder) await rmdir(folder).catch(() => { /* an unconfirmed file stays in its attempt folder, never in the outbox listing */ });
    // guard:amex-native-trace — bounded, best effort: the job's result and closure are those it had without the record
    await bounded(writeTrace(directory, account, trace, outcome, helper).catch(() => {}), 5000, null);
  }
}
