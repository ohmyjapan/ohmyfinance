// collector/bank.mjs — web-bank statement collection for the OMF downloader (plan omf-bank-collection-amended-20261018 A6).
// One adapter per bank in ./banks/<provider>.mjs with the contract shape of aplusUi (collector/aplus.mjs:273-355):
// {provider, label, start, hosts, support, contract, ui(page, browser)} where ui has open/state/login/show/openStatements/
// selectPeriod/snapshot/exportCsv/downloadSession and state() reports login|verification|authenticated|statements|export_ready|
// error_page|unknown. Authentication is the only human step (ensureBankLogin: verification_required + show, bounded, once);
// the routine steps are automated. No adapter shipped here is verified: their routine methods throw contract-pending and
// queueBankSync issues observe jobs for them — observeBankPortal records the page contract (pathnames, titles, control texts,
// input ids and types, select sizes, download events; never a typed value, credential, cookie or row) while the person
// navigates, and keeps one CSV the person exports from the bank's hosts. Imports only packaged files and node built-ins apart
// from ./browser.mjs, loaded lazily by the two launchers (so the staged copy loads without an install, like aplus.mjs).
// Lines marked `// guard:<name>` are single predicates the fixture removes in turn from a mutant copy.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { access, link, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { awaitDownload } from './aplus.mjs';
import { pause } from './interaction.mjs';
import { BANK_PROVIDERS } from '../shared/finance-payment-match.mjs';
import rakuten from './banks/rakuten.mjs';
import paypay from './banks/paypay.mjs';
import resona from './banks/resona.mjs';

export const ADAPTERS = Object.freeze({ rakuten, paypay, resona });
export const adapterFor = provider => ADAPTERS[provider] || null;
export const providerLabel = provider => BANK_PROVIDERS.find(([key]) => key === provider)?.[1] || String(provider ?? '');
const GUID = /^[a-f\d-]{36}$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = target => access(target).then(() => true, () => false);
const coded = (code, message) => Object.assign(new Error(message), { code });
const bankOutbox = (root, bankAccountId) => path.join(root, 'outbox', 'bank', bankAccountId);

/** The host a download began from; a blob: URL carries its origin inside. Null when unreadable. */
export function hostOf(url) {
  try { const u = new URL(String(url)); if (u.protocol === 'blob:') return new URL(u.pathname).hostname || null; return u.hostname || null; } catch { return null; }
}
/** True when `host` is one of the adapter's hosts or a subdomain of one. */
export function hostAllowed(host, hosts) { return !!host && (hosts || []).some(h => host === h || host.endsWith('.' + h)); }
/** The statement page must show the connected account's label when the owner recorded one (as aplus.mjs:29-31 checks the card). */
export function verifyBankSnapshot(snapshot, jobSnapshot) {
  const wanted = String(jobSnapshot?.accountLabel ?? '').replace(/\s+/g, ' ').trim(), shown = String(snapshot?.accountLabel ?? '').replace(/\s+/g, ' ').trim();
  if (wanted && !shown.includes(wanted)) throw new Error('サインイン中の口座がこの接続と一致しません'); // guard:account-label
  return snapshot;
}
// Publish a complete new manifest exclusively (the shape of aplus.mjs writeManifest): a killed write leaves no partial manifest.
async function writeManifest(directory, manifest) {
  const file = path.join(directory, 'manifest.json'), temporary = file + '.' + randomUUID() + '.tmp';
  try { await writeFile(temporary, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 }); await link(temporary, file); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

/**
 * Authentication intervention only (the shape of ensureAplusLogin): the page is opened; while it shows login or verification
 * the person is told once (verification_required + show) and the wait is bounded; nothing is typed. Resolves when the page is
 * authenticated; an error page or the deadline throws.
 */
export async function ensureBankLogin(ui, status, { label, now = Date.now, wait = pause, timeoutMs = 300000, pollMs = 1500 } = {}) {
  const deadline = now() + timeoutMs; let manual = false;
  const attention = async () => { if (manual) return; manual = true; await status('verification_required', `${label}にChromeでサインインしてください`); await ui.show(); };
  await ui.open();
  while (now() < deadline) {
    const kind = (await ui.state())?.kind;
    if (['authenticated', 'statements', 'export_ready'].includes(kind)) return;
    if (kind === 'error_page') throw new Error(`${label}のページでエラーが表示されました。Chromeを確認して再試行してください`);
    if (['login', 'verification', 'unknown'].includes(kind)) await attention();
    await wait(pollMs);
  }
  await attention();
  throw new Error(`${label}へのサインインが完了しませんでした。再度「取得」を押してください`);
}

// A crash after Chrome completed the file but before the manifest: the attempt journal (bound to the job and snapshot) and the
// recorded download (guid, host) reconstruct the manifest. Never a second export; a missing or foreign record stays failed.
async function completedAttempt(jobDir, bound, adapter, manifestOf, { now, wait, pollMs }) {
  let marker, download;
  try { marker = JSON.parse(await readFile(path.join(jobDir, 'attempt.json'), 'utf8')); download = JSON.parse(await readFile(path.join(jobDir, 'download.json'), 'utf8')); } catch { return null; }
  if (Object.keys(bound).some(key => marker[key] !== bound[key])) return null;
  const names = await readdir(jobDir), files = names.filter(name => GUID.test(name));
  if (files.length !== 1 || names.includes(files[0] + '.crdownload') || download?.guid !== files[0]) return null;
  if (!hostAllowed(download.host, adapter.hosts)) return null;
  const filename = await awaitDownload({ jobDir, request: async () => {}, state: async () => ({ kind: 'recovering' }), timeoutMs: Math.max(2000, pollMs * 2), extensionMs: 0, now, wait, pollMs, label: adapter.label });
  const bytes = await readFile(path.join(jobDir, filename));
  const manifest = manifestOf(filename, bytes, { suggestedFilename: download.suggestedFilename || null, sourceHost: download.host, period: marker.period ?? null, labelChecked: marker.labelChecked === true, recovered: true });
  await writeManifest(jobDir, manifest);
  return { directory: jobDir, manifest };
}

/**
 * One retrieve job on an open page: sign-in intervention, then the routine steps automated — open the statements, select the
 * period of the job's frozen snapshot, check the shown account label, write attempt.json (bound: bankAccountId, ownerId,
 * origin, jobId, snapshotHash, period) before the single export click, wait for the download, refuse a file whose download did
 * not begin on the bank's hosts, and write the manifest (jobId + snapshotHash copied from the claim; the collector never holds
 * the mapping) under outbox/bank/<bankAccountId>/<jobId>. `ui` is injectable (fixture); the default is the adapter's page.
 * Returns { items, failed, recovered?, skipped? }.
 */
export async function collectBankFromPage(page, browser, adapter, bound, job, root, status, { ui = null, now = Date.now, wait = pause, pollMs = 1000, loginTimeoutMs = 300000, downloadTimeoutMs = 300000, extensionMs = 300000, signal = null } = {}) {
  if (!adapter) throw new Error('A bank adapter is required');
  if (adapter.support !== 'verified') throw coded('contract-pending', `${adapter.label}の取得手順は未確認です。観察取得で手順を記録してください`);
  if (!/^[a-f\d]{24}$/.test(String(bound?.bankAccountId ?? '')) || typeof bound?.jobId !== 'string' || !bound.jobId || typeof bound?.snapshotHash !== 'string' || !bound.snapshotHash) throw new Error('A claimed bank job is required');
  ui ||= adapter.ui(page, browser, job?.snapshot ?? null);
  const stamp = () => new Date(now()).toISOString(), jobDir = path.join(bankOutbox(root, bound.bankAccountId), bound.jobId), marker = path.join(jobDir, 'attempt.json');
  const manifestOf = (filename, bytes, extra) => ({ ...bound, kind: 'statement', channel: 'collector', sourceFormat: 'csv', sha256: sha256(bytes), filename, bytes: bytes.length, downloadedAt: stamp(), ...extra });
  if (await exists(marker)) {
    const recovered = await completedAttempt(jobDir, bound, adapter, manifestOf, { now, wait, pollMs });
    if (recovered) { await status('running', '保存済みの明細を復旧'); return { items: [recovered], failed: null, recovered: true }; }
    return { items: [], failed: 'ダウンロードが完了しませんでした。再度「取得」を押してください', skipped: 'attempted' }; // guard:attempt-marker
  }
  await ensureBankLogin(ui, status, { label: adapter.label, now, wait, timeoutMs: loginTimeoutMs });
  await status('running', '入出金明細を開く');
  await ui.openStatements();
  await status('running', '対象期間を選択');
  await ui.selectPeriod(job?.snapshot?.coverage ?? null);
  const snapshot = verifyBankSnapshot(await ui.snapshot(), job?.snapshot);
  const labelChecked = Boolean(String(job?.snapshot?.accountLabel ?? '').trim());
  await mkdir(jobDir, { recursive: true });
  await writeFile(marker, JSON.stringify({ ...bound, period: snapshot?.period ?? null, labelChecked, requestedAt: stamp() }, null, 2), { flag: 'wx', mode: 0o600 });
  const session = ui.downloadSession ? await ui.downloadSession(jobDir) : null;
  let began = null;
  session?.on('Browser.downloadWillBegin', event => {
    if (began) return;
    began = { guid: event.guid, host: hostOf(event.url), suggestedFilename: String(event.suggestedFilename || '').slice(0, 200) };
    writeFile(path.join(jobDir, 'download.json'), JSON.stringify(began), { mode: 0o600 }).catch(() => {});
  });
  let filename;
  try {
    await status('running', 'CSVをダウンロード');
    filename = await awaitDownload({ jobDir, session, request: () => ui.exportCsv(), state: () => ui.state(), now, wait, pollMs, timeoutMs: downloadTimeoutMs, extensionMs, signal, label: adapter.label,
      onVerification: async () => { await status('verification_required', `${adapter.label}の認証をChromeで完了してください`); await ui.show(); } });
  } catch (error) {
    if (error?.code !== 'timeout') throw error;
    return { items: [], failed: 'ダウンロードが完了しませんでした。再度「取得」を押してください' };
  } finally { await session?.close?.(); }
  const host = began?.host ?? null;
  if (!hostAllowed(host, adapter.hosts)) { await unlink(path.join(jobDir, filename)).catch(() => {}); throw new Error('ダウンロード元が銀行サイトではありません'); } // guard:download-host
  const bytes = await readFile(path.join(jobDir, filename));
  const manifest = manifestOf(filename, bytes, { suggestedFilename: began?.suggestedFilename || null, sourceHost: host, period: snapshot?.period ?? null, labelChecked });
  await writeManifest(jobDir, manifest);
  await status('running', '明細を保存');
  return { items: [{ directory: jobDir, manifest }], failed: null };
}

// What the observe recorder reads from a page: the path (no query or hash), the title, the texts of visible buttons and links,
// the ids and types of visible inputs, the option counts of selects. Never a value, a cookie or a row.
const RECORD = () => ({
  pathname: location.pathname, title: document.title.slice(0, 200),
  visibleControls: [...document.querySelectorAll('button, a, [role="button"]')].filter(e => e.getClientRects().length).map(e => (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 40)).filter(Boolean).slice(0, 60),
  inputs: [...document.querySelectorAll('input, textarea')].filter(e => e.getClientRects().length).slice(0, 100).map(e => ({ id: String(e.id || e.name || '').slice(0, 100), type: String(e.type || 'text').slice(0, 30) })),
  selects: [...document.querySelectorAll('select')].slice(0, 100).map(s => s.options.length)
});
/** The page-side name of the observation binding: random per session (as rebrowser's own context probe is), a plain identifier. */
export const OBSERVE_BINDING = /^o[0-9a-f]{15}$/;
const observeBindingName = () => 'o' + randomBytes(8).toString('hex').slice(0, 15);
// Installed on every new document before the start page is opened: capture-phase listeners that hand Node the clicked
// control's tag/text/id and the edited field's id/type through the session binding at event time — never a value, never
// the DOM. A document without the binding (the channel failed) drops the call silently; the pages are still recorded.
const LISTENERS = (name, read) => {
  const documentId = String(performance.timeOrigin) + ':' + Math.random().toString(36).slice(2);
  const pageState = () => ({ documentId, snapshot: read() });
  window[name + 'Snapshot'] = pageState;
  const send = payload => { try { window[name](JSON.stringify({ ...payload, pageState: pageState() })); } catch { /* no binding in this document */ } };
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest('button, a, [role="button"], input[type="submit"]') : null;
    if (!target) return;
    send({ kind: 'click', tag: target.tagName, text: (target.innerText || (target.type === 'submit' ? target.value : '') || target.getAttribute('aria-label') || '').trim().slice(0, 40), id: String(target.id || target.name || '').slice(0, 100) });
  }, true);
  document.addEventListener('input', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
    send({ kind: 'input', id: String(target.id || target.name || '').slice(0, 100), type: String(target.type || 'text').slice(0, 30) });
  }, true);
};
/**
 * The Node-side whitelist of one binding call: a page script can call the binding with anything, so only a click's
 * tag/text/id or an input's id/type pass, bounded (tag ≤20, text ≤40, id ≤100, type ≤30); any other key (a value, a list,
 * a nested object) and any other shape is dropped. Returns null for a call that carries no recordable event.
 */
export function eventInput(payload) {
  let body; try { body = JSON.parse(String(payload)); } catch { return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const str = (value, max) => String(value ?? '').slice(0, max);
  if (body.kind === 'click') return { kind: 'click', tag: str(body.tag, 20), text: str(body.text, 40), id: str(body.id, 100) };
  if (body.kind === 'input') return { kind: 'input', id: str(body.id, 100), type: str(body.type, 30) };
  return null;
}
// One event onto one record, bounded: clicks ≤60 per record; typedInto ≤100 per record with one entry per field (id+type,
// the first `at` kept); an overflowing event is counted in eventsDropped, never stored. The fields are what eventInput let through.
function attachEvent(target, event) {
  const { kind, ...fields } = event;
  if (kind === 'click') { if (target.clicks.length < 60) target.clicks.push(fields); else target.eventsDropped++; return; }
  if (target.typedInto.some(t => t.id === fields.id && t.type === fields.type)) return;
  if (target.typedInto.length < 100) target.typedInto.push(fields); else target.eventsDropped++;
}
// The event envelope carries the same value-free page read as the poll. Normalize it again in Node: the page can call
// the binding itself, and neither unknown keys nor input values belong in the saved record. Document ids stay local.
const pageSnapshot = value => {
  const str = (v, max) => String(v ?? '').slice(0, max), list = (v, max) => Array.isArray(v) ? v.slice(0, max) : [];
  return { pathname: str(value?.pathname, 300), title: str(value?.title, 200), visibleControls: list(value?.visibleControls, 60).map(v => str(v, 40)),
    inputs: list(value?.inputs, 100).map(v => ({ id: str(v?.id, 100), type: str(v?.type, 30) })), selects: list(value?.selects, 100).map(v => Number.isSafeInteger(v) ? v : 0) };
};
/**
 * The preparatory observe stage of an unverified bank: the start page (the frozen variant's, through the adapter) is opened,
 * the person is asked to navigate (and to export the CSV when the portal offers it), and the collector records one entry per
 * page change until the tab is closed, the session is cancelled or the deadline passes — plus, on each entry, the person's
 * clicks and edited fields as value-free metadata received at event time through a CDP binding (Runtime.enable, then
 * Runtime.addBinding on the page's own session; listeners installed on every new document). Each event carries its source
 * document identity and a value-free snapshot taken before the target handler runs. Flushing can therefore create the new
 * document's record even when a person acts and closes it before the next poll. The same read drives polling; event data
 * never enters the fingerprint. A failed channel leaves useful page-only records explicitly marked eventChannel:false.
 * One completed download from the bank's hosts is retained as a statement manifest (channel collector-observe)
 * under the job's frozen snapshot. Returns { observation, items, downloads, closed }.
 */
export async function observeFromPage(page, browser, adapter, bound, job, root, status, { ui = null, now = Date.now, wait = pause, pollMs = 1000, timeoutMs = 900000, signal = null } = {}) {
  if (!adapter) throw new Error('A bank adapter is required');
  if (!/^[a-f\d]{24}$/.test(String(bound?.bankAccountId ?? '')) || typeof bound?.jobId !== 'string' || !bound.jobId) throw new Error('A claimed bank job is required');
  ui ||= adapter.ui(page, browser, job?.snapshot ?? null);
  const stamp = () => new Date(now()).toISOString(), jobDir = path.join(bankOutbox(root, bound.bankAccountId), bound.jobId + '-observe');
  await mkdir(jobDir, { recursive: true });
  const records = [], downloads = [], pending = []; let last = null, closed = false;
  const name = observeBindingName(); let eventChannel = false;
  const fresh = snap => ({ at: stamp(), ...snap, downloadEvents: [], clicks: [], typedInto: [], eventsDropped: 0, eventChannel });
  const remember = state => {
    const snap = pageSnapshot(state?.snapshot);
    const key = JSON.stringify([String(state?.documentId ?? '').slice(0, 100), snap.pathname, snap.title, snap.visibleControls, snap.inputs, snap.selects]);
    if (key === last) return records.at(-1);
    last = key; if (records.length < 200) records.push(fresh(snap));
    return records.at(-1);
  };
  const flush = () => { for (const { event, pageState } of pending.splice(0)) { const target = pageState ? remember(pageState) : records.at(-1); target && attachEvent(target, event); } };
  const record = async () => {
    flush();
    let state; try { state = await page.evaluate(name => window[name + 'Snapshot']?.(), name) || { snapshot: await page.evaluate(RECORD) }; } catch { return; }
    flush(); remember(state);
    flush();
  };
  // The event channel. Its failure (a rejected addBinding) leaves the pages recorded without clicks — visible, never a rejection.
  let cdp = null;
  try {
    cdp = await page.createCDPSession();
    await cdp.send('Runtime.enable'); // Runtime.bindingCalled is a Runtime-domain event: without this the binding delivers nothing (local protocol check 2026-10-19)
    await cdp.send('Runtime.addBinding', { name });
    cdp.on('Runtime.bindingCalled', event => { if (event.name !== name) return; const input = eventInput(event.payload); if (input) { const body = JSON.parse(event.payload); pending.push({ event: { at: stamp(), ...input }, pageState: body?.pageState ?? null }); } });
    // Both serialized functions and the name are generated here; no portal text is evaluated as code.
    await page.evaluateOnNewDocument('(' + LISTENERS.toString() + ')(' + JSON.stringify(name) + ',' + RECORD.toString() + ')');
    eventChannel = true;
  } catch { /* page-only recording remains available and is marked eventChannel:false */ }
  const session = ui.downloadSession ? await ui.downloadSession(jobDir) : null;
  session?.on('Browser.downloadWillBegin', event => {
    flush();
    const entry = { guid: event.guid, host: hostOf(event.url), suggestedFilename: String(event.suggestedFilename || '').slice(0, 200), bytes: null, completed: false };
    downloads.push(entry); records.at(-1)?.downloadEvents.push({ host: entry.host, suggestedFilename: entry.suggestedFilename, bytes: null });
  });
  session?.on('Browser.downloadProgress', event => {
    const entry = downloads.find(d => d.guid === event.guid); if (!entry) return;
    if (event.state === 'completed') { entry.completed = true; entry.bytes = Number.isSafeInteger(event.totalBytes) ? event.totalBytes : null; for (const r of records) for (const d of r.downloadEvents) if (d.suggestedFilename === entry.suggestedFilename && d.bytes === null) d.bytes = entry.bytes; }
    if (event.state === 'canceled') entry.canceled = true;
  });
  page?.once?.('close', () => { closed = true; }); browser?.once?.('disconnected', () => { closed = true; });
  try {
    await ui.open(); await record();
    await status('verification_required', `${adapter.label}のページをChromeで操作してください（観察取得・準備）。入出金明細のCSVを出力できる場合は出力し、終わったらタブを閉じてください`);
    try { await ui.show(); } catch { /* the person may already have closed the tab: the recording so far stands */ }
    const deadline = now() + timeoutMs;
    while (!closed && now() < deadline) { signal?.throwIfAborted(); await record(); await wait(pollMs); }
  } finally { flush(); await cdp?.detach().catch(() => {}); await session?.close?.(); }
  let items = [];
  const completed = downloads.filter(d => d.completed && GUID.test(d.guid));
  if (completed.length === 1 && hostAllowed(completed[0].host, adapter.hosts) && await exists(path.join(jobDir, completed[0].guid))) {
    const bytes = await readFile(path.join(jobDir, completed[0].guid));
    const manifest = { ...bound, kind: 'statement', channel: 'collector-observe', sourceFormat: 'csv', sha256: sha256(bytes), filename: completed[0].guid, bytes: bytes.length, suggestedFilename: completed[0].suggestedFilename || null, sourceHost: completed[0].host, downloadedAt: stamp() };
    await writeManifest(jobDir, manifest); items = [{ directory: jobDir, manifest }];
  }
  return { observation: records, items, downloads: downloads.map(({ guid, ...d }) => d), closed };
}

// An owned, ephemeral, sandboxed Chrome for one bank job: profiles/ephemeral/<owner>-bank-<account>-<batch> (browser.mjs
// ephemeralProfile/browserFor), closed and deleted afterwards. browser.mjs is loaded here, not at import, so the page logic
// above stays loadable without node_modules (the staged-package check imports it that way).
async function withBankBrowser(bound, root, batch, onLaunch, fn) {
  const { browserFor, ephemeralProfile, removeEphemeral } = await import('./browser.mjs');
  const profile = ephemeralProfile(root, bound.ownerId, 'bank', bound.bankAccountId, batch);
  const browser = await browserFor(profile, { ephemeral: true, root, onLaunch });
  try { const page = await browser.newPage(); return await fn(page, browser); }
  finally {
    const child = browser.process();
    try { if (browser.connected) await Promise.race([browser.close(), pause(5000)]); } catch { /* closing */ }
    if (child && child.exitCode === null) { try { child.kill(); } catch { /* gone */ } await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(5000)]); }
    await removeEphemeral(profile, root).catch(() => {});
  }
}
/** One retrieve job through the provider's adapter (or an injected one) in an owned ephemeral Chrome. */
export async function collectBankStatement(bound, job, root, status, { adapter = adapterFor(job?.provider ?? bound?.provider), batch = 'batch', onLaunch = null, signal = null, now = Date.now, wait = pause, ...rest } = {}) {
  if (!adapter) throw new Error('No bank adapter for ' + String(job?.provider ?? bound?.provider));
  return withBankBrowser(bound, root, batch, onLaunch, (page, browser) => collectBankFromPage(page, browser, adapter, bound, job, root, status, { signal, now, wait, ...rest }));
}
/** One observe job (preparatory stage) through the provider's adapter (or an injected one) in an owned ephemeral Chrome. */
export async function observeBankPortal(bound, job, root, status, { adapter = adapterFor(job?.provider ?? bound?.provider), batch = 'batch', onLaunch = null, signal = null, now = Date.now, wait = pause, ...rest } = {}) {
  if (!adapter) throw new Error('No bank adapter for ' + String(job?.provider ?? bound?.provider));
  return withBankBrowser(bound, root, batch, onLaunch, (page, browser) => observeFromPage(page, browser, adapter, bound, job, root, status, { signal, now, wait, ...rest }));
}
