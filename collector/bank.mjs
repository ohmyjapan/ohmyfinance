// collector/bank.mjs — web-bank statement collection for the OMF downloader (plan omf-bank-collection-amended-20261018 A6).
// One adapter per bank in ./banks/<provider>.mjs with the contract shape of aplusUi (collector/aplus.mjs:273-355):
// {provider, label, start, hosts, support, contract, ui(page, browser)} where ui has open/state/login/show/openStatements/
// selectPeriod/snapshot/exportCsv/downloadSession and state() reports login|verification|authenticated|statements|export_ready|
// error_page|unknown. Authentication is the only human step (ensureBankLogin: verification_required + show, bounded, once);
// the routine steps are automated. Plan omf-rakuten-auto-login-20261021 §2: a retrieval may carry the claimed account's saved
// login (index.mjs bankLoginFor — state() from file metadata only, open() decrypts once); an adapter whose ui offers loginForm/
// login (楽天銀行 standard) then submits it ONCE per job on the exact recorded form, journalled in the job folder before the submit
// so a reclaimed job never submits again; a refusal by the bank is remembered (rejected()) so no later job submits that saved
// login again; anything else after the submit (additional verification, a password change) is the person's step in the same
// window. collectBankStatement runs in a background owned Chrome (browser.mjs `background`) and shows that window only when the
// person is asked. Every provider default adapter shipped here is contract-pending: its routine methods throw
// contract-pending and queueBankSync issues observe jobs for it. The one retrievable variant is 楽天銀行 `standard` (banks/rakuten.mjs
// `variants.standard`, resolved from the job's frozen variant; plan omf-rakuten-native-shiwake-20261020) — observeBankPortal records the page contract (pathnames, titles, control texts,
// input ids and types, select sizes, download events; never a typed value, credential, cookie or row) while the person
// navigates, and keeps one CSV the person exports from the bank's hosts. Imports only packaged files and node built-ins apart
// from ./browser.mjs, loaded lazily by the two launchers (so the staged copy loads without an install, like aplus.mjs).
// Plan omf-paypay-four-accounts-20261021: a `guided` variant adapter (PayPay銀行 `standard`, banks/paypay.mjs) is chosen for an observe job
// frozen with that provider and variant (guidedAdapterFor); its observe job may carry the claimed account's saved login (index.mjs
// bankLoginFor), which guidedSignIn submits at most ONCE on the exact observed form — journalled in the job folder and marked pending for
// that saved key BEFORE the possible submission. Nothing the collector sees afterwards proves that sign-in worked (plan P1): the PayPay
// adapter has no observed authenticated-page or export contract, so neither navigation nor a downloaded file — CSV-shaped or not — clears
// the marker. It stays 'uncertain' by default and 'refused' only for an adapter-observed refusal; the owner either allows one more attempt
// with the already saved login in the protected setup (index.mjs retryBankLogin, uncertain only) or saves corrected values. The window runs in the background and is shown for the person (reveal), who completes any bank check and the export.
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
import ikeda from './banks/ikeda.mjs';

export const ADAPTERS = Object.freeze({ rakuten, paypay, resona, ikeda });
// Plan omf-rakuten-native-shiwake-20261020 §1: the adapter of a provider AND its frozen login variant. A provider adapter may list
// `variants` (楽天銀行: `standard`, the START_CORP corporate login); any other variant, none, or a provider without variants
// resolves the provider adapter itself — for every shipped provider that is contract-pending (observe stage only).
export const adapterFor = (provider, variant = null) => { const base = ADAPTERS[provider] || null; return (variant != null && base?.variants?.[variant]) || base; };
// Plan omf-paypay-four-accounts-20261021: the guided adapter of an observe job, from its FROZEN snapshot provider and variant only (never
// the claim's current connection); null for every other job, which keeps its provider adapter exactly as before.
export const guidedAdapterFor = job => { const s = job?.snapshot, a = s ? adapterFor(s.provider, s.variant ?? null) : null; return a?.guided === true && a.provider === s.provider && a.variant === s.variant ? a : null; };
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

const AUTHENTICATED = ['authenticated', 'statements', 'export_ready'];
/** The person-facing texts of the sign-in step (also the job's status in OMF). None carries a credential, a URL or page text. */
export const LOGIN_TEXT = Object.freeze({
  manual: label => `${label}にChromeでサインインしてください`,
  verify: label => `${label}の追加の確認（認証コード・パスワード変更など）をChromeの画面で完了してください。保存済みのログインは1回だけ送信しました`,
  refused: label => `${label}が保存済みのログインを受け付けませんでした。Chromeでサインインするか、ダウンローダーの設定画面でIDとパスワードを保存し直してください（保存し直すまで自動では送信しません）`,
  blocked: label => `${label}の前回の自動サインインが確認できていないため、保存済みのログインを自動では送信しません。Chromeでサインインするか、ダウンローダーの設定画面でログインを保存し直してください`,
  unconfirmed: label => `${label}への自動サインインの完了を確認できませんでした。保存済みのログインは自動では再送信しません。Chromeの画面を確認し、ダウンローダーの設定画面でIDとパスワードを保存し直してから「取得」を押してください`,
  unavailable: label => `${label}の保存済みのログインをこのPCで開けませんでした。Chromeでサインインするか、ダウンローダーの設定画面でログインを保存し直してください`,
  form: label => `${label}のログイン画面が確認済みの形と異なるため、自動サインインは行いません。Chromeでサインインしてください`,
  retried: label => `${label}への前回の自動サインインの結果を確認できなかったため、もう一度は送信しません。Chromeでサインインしてください`,
  failed: label => `${label}への自動サインインを完了できませんでした。Chromeでサインインしてください`
});
/**
 * Authentication (the shape of ensureAplusLogin): the page is opened; while it shows login or verification the person is told
 * once (verification_required + show) and the wait is bounded. With a saved `login` and an adapter ui that offers loginForm/login,
 * the exact recorded login form is filled from it ONCE (lazy: file metadata, the form and the job journal are checked before the
 * single decryption; abort is checked before the decryption, before the typing and before the click). The bank's refusal (the exact
 * form again on a new document) asks the person. Before a possible submission, login.rejected() durably blocks this saved key;
 * only confirmed authentication (login.accepted()) or an owner re-save clears it, including after an uncertain end or a crash.
 * an error page or the deadline throws (a remembered refusal with code login-refused).
 */
export async function ensureBankLogin(ui, status, { label, login = null, journal = null, now = Date.now, wait = pause, timeoutMs = 300000, pollMs = 1500, signal = null } = {}) {
  const deadline = now() + timeoutMs; let manual = false, submitted = false, declined = false, refused = false, reclaimed = null, sent = null;
  const attention = async text => { if (manual) return; manual = true; await status('verification_required', text); await ui.show(); };
  const automatic = !!login && typeof ui.login === 'function' && typeof ui.loginForm === 'function';
  const refuse = async () => {
    if (refused) return; refused = true;
  };
  // The login form again, on another document than the one the saved login was submitted from, is the bank's refusal.
  const loginAgain = async () => { if (!sent) return false; const doc = await ui.document?.(); return !!doc && doc !== sent && !!(await ui.loginForm())?.ok; };
  const signIn = async () => {
    const saved = await login.state();
    if (saved !== 'ready') { declined = true; return saved === 'blocked' ? LOGIN_TEXT.blocked(label) : saved === 'unbound' ? LOGIN_TEXT.unavailable(label) : LOGIN_TEXT.manual(label); }
    if (!(await ui.loginForm())?.ok) { declined = true; return LOGIN_TEXT.form(label); }
    reclaimed ??= journal ? await journal.seen() : false;
    if (reclaimed) { declined = true; return LOGIN_TEXT.retried(label); } // guard:login-journal
    signal?.throwIfAborted();
    let secret = null;
    try { secret = await login.open(); }
    catch (error) { if (signal?.aborted || error?.name === 'AbortError' || error?.status === 401 || error?.code === 'forbidden') throw error; declined = true; return LOGIN_TEXT.unavailable(label); }
    try {
      signal?.throwIfAborted();
      await journal?.mark();
      await login.rejected(); // guard:login-refused — persist before the possible submission, clear only after authentication
      submitted = true;
      await status('running', `${label}に保存済みのログインでサインイン`);
      const result = await ui.login(secret, { signal });
      sent = result?.document || false;
      if (result?.outcome === 'authenticated') return null;
      if (result?.outcome === 'rejected') { await refuse(); return LOGIN_TEXT.refused(label); }
      return LOGIN_TEXT.verify(label);
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      sent = false; return error?.code === 'login-form' ? LOGIN_TEXT.form(label) : LOGIN_TEXT.failed(label);
    } finally { secret = null; }
  };
  await ui.open();
  while (now() < deadline) {
    signal?.throwIfAborted();
    const kind = (await ui.state())?.kind;
    if (AUTHENTICATED.includes(kind)) { if (submitted && !refused) await Promise.resolve(login.accepted?.()).catch(() => {}); return { submitted, refused }; }
    if (kind === 'error_page') throw submitted ? coded('login-refused', LOGIN_TEXT.unconfirmed(label)) : new Error(`${label}のページでエラーが表示されました。Chromeを確認して再試行してください`);
    let auto = kind === 'login' && automatic && !declined;
    if (submitted) auto = false; // guard:login-once
    if (kind === 'login' && submitted && !refused && await loginAgain()) { await refuse(); await attention(LOGIN_TEXT.refused(label)); }
    else if (auto) { const text = await signIn(); if (text) await attention(text); }
    else if (['login', 'verification', 'unknown'].includes(kind)) await attention(submitted ? LOGIN_TEXT.verify(label) : LOGIN_TEXT.manual(label));
    await wait(pollMs);
  }
  await attention(submitted ? LOGIN_TEXT.verify(label) : LOGIN_TEXT.manual(label));
  if (refused) throw coded('login-refused', `${label}が保存済みのログインを受け付けませんでした。ダウンローダーの設定画面でIDとパスワードを保存し直してから、再度「取得」を押してください`);
  if (submitted) throw coded('login-refused', LOGIN_TEXT.unconfirmed(label));
  throw new Error(`${label}へのサインインが完了しませんでした。再度「取得」を押してください`);
}

/** The person-facing texts of a guided first capture (also the job's status in OMF). None carries a credential, a URL or page text. */
export const GUIDED_TEXT = Object.freeze({
  submitted: label => `${label}に保存済みのログインを1回だけ送信しました。銀行の追加の確認があればChromeの画面で完了し、入出金明細のCSVを出力してからタブを閉じてください（ガイド付き取得）`,
  manual: label => `${label}にChromeでサインインし、入出金明細のCSVを出力してからタブを閉じてください（ガイド付き取得）`,
  blocked: label => `${label}の前回の自動サインインが確認できていないため、保存済みのログインを自動では送信しません。ログインが正しい場合はダウンローダーの設定画面で「保存済みのログインでもう一度試す」を押してから取得してください（変更した場合は保存し直してください）`,
  unconfirmed: label => `${label}への自動サインインの完了は確認できません（サインイン後の銀行の画面は未確認のため、受け取ったファイルでは判断しません）。保存済みのログインは自動では再送信しません。ログインが正しい場合はダウンローダーの設定画面で「保存済みのログインでもう一度試す」を押してから、もう一度取得してください（変更した場合は保存し直してください）`,
  kept: label => `受け取った明細は保存しました。${label}への自動サインインの完了は確認できないため、次回の自動送信は止めています（ダウンローダーの設定画面で再試行を許可できます）`,
  resave: label => `${label}が保存済みのログインを受け付けませんでした。ダウンローダーの設定画面で正しいログインを保存し直すまで自動では送信しません`
});
/**
 * The one saved-login step of a guided observe job (ensureBankLogin's lazy order, without inferring authentication): file metadata,
 * the exact form on the fresh page and the job journal are checked before the single decryption; abort before the decryption, before
 * the fill and before the click (in ui.login); the journal and the pending marker for this saved key are written before the possible
 * submission. Returns { submitted, refused, text } — text is what the person is told instead of the default (null: the default).
 */
export async function guidedSignIn(ui, { label, login, journal = null, signal = null }) {
  const none = text => ({ submitted: false, refused: false, text });
  if (!login || typeof ui.login !== 'function' || typeof ui.loginForm !== 'function') return none(null);
  const saved = await login.state();
  if (saved !== 'ready') return none(saved === 'refused' ? LOGIN_TEXT.refused(label) : saved === 'blocked' ? GUIDED_TEXT.blocked(label) : saved === 'unbound' ? LOGIN_TEXT.unavailable(label) : null);
  if (!(await ui.loginForm({ entry: true }))?.ok) return none(LOGIN_TEXT.form(label));
  if (journal && await journal.seen()) return none(LOGIN_TEXT.retried(label)); // guard:guided-journal
  signal?.throwIfAborted();
  let secret = null;
  try { secret = await login.open(); }
  catch (error) { if (signal?.aborted || error?.name === 'AbortError' || error?.status === 401 || error?.code === 'forbidden') throw error; return none(LOGIN_TEXT.unavailable(label)); }
  try {
    signal?.throwIfAborted();
    await journal?.mark();
    await login.rejected('uncertain'); // guard:guided-pending — persisted before the possible submission; never cleared by the job itself
    const result = await ui.login(secret, { signal });
    // Only the adapter's own observation (the exact login form again on a new document) is a refusal; it needs corrected values.
    if (result?.outcome === 'rejected') { await login.rejected('refused'); return { submitted: true, refused: true, text: LOGIN_TEXT.refused(label) }; }
    return { submitted: true, refused: false, text: GUIDED_TEXT.submitted(label) };
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    // A refusal by the adapter before its click (form drift, a replaced document, the secret's shape) submitted nothing; anything else
    // may have. Either way the pending marker stays: the next job asks the person until the owner allows a retry or saves again.
    const before = ['login-form', 'login-changed', 'manual-login'].includes(error?.code);
    return { submitted: !before, refused: false, text: before ? LOGIN_TEXT.form(label) : LOGIN_TEXT.failed(label) };
  } finally { secret = null; }
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
 * `login` is the claimed account's saved login (ensureBankLogin; journal login.json in the job folder), `reveal` shows the owned
 * window when the person is asked (collectBankStatement's background Chrome). A remembered refusal returns `failed` with its text.
 * Returns { items, failed, recovered?, skipped? }.
 */
export async function collectBankFromPage(page, browser, adapter, bound, job, root, status, { ui = null, now = Date.now, wait = pause, pollMs = 1000, loginTimeoutMs = 300000, downloadTimeoutMs = 300000, extensionMs = 300000, signal = null, login = null, reveal = null } = {}) {
  if (!adapter) throw new Error('A bank adapter is required');
  if (adapter.support !== 'verified') throw coded('contract-pending', `${adapter.label}の取得手順は未確認です。観察取得で手順を記録してください`);
  // A variant adapter retrieves only the job frozen for that variant (an injected or stale adapter never runs another login).
  if (adapter.variant && adapter.variant !== (job?.snapshot?.variant ?? null)) throw coded('contract-pending', `${adapter.label}のこのログイン方式の取得手順は未確認です。観察取得で手順を記録してください`); // guard:variant-bound
  if (!/^[a-f\d]{24}$/.test(String(bound?.bankAccountId ?? '')) || typeof bound?.jobId !== 'string' || !bound.jobId || typeof bound?.snapshotHash !== 'string' || !bound.snapshotHash) throw new Error('A claimed bank job is required');
  ui ||= adapter.ui(page, browser, job?.snapshot ?? null);
  // The window is shown for the person (reveal), then the adapter's own show runs as before.
  if (reveal) { const base = ui; ui = { ...base, async show() { try { await reveal(); } catch { /* the adapter's own show below */ } await base.show(); } }; }
  const stamp = () => new Date(now()).toISOString(), jobDir = path.join(bankOutbox(root, bound.bankAccountId), bound.jobId), marker = path.join(jobDir, 'attempt.json');
  const manifestOf = (filename, bytes, extra) => ({ ...bound, kind: 'statement', channel: 'collector', sourceFormat: 'csv', sha256: sha256(bytes), filename, bytes: bytes.length, downloadedAt: stamp(), ...extra });
  if (await exists(marker)) {
    const recovered = await completedAttempt(jobDir, bound, adapter, manifestOf, { now, wait, pollMs });
    if (recovered) { await status('running', '保存済みの明細を復旧'); return { items: [recovered], failed: null, recovered: true }; }
    return { items: [], failed: 'ダウンロードが完了しませんでした。再度「取得」を押してください', skipped: 'attempted' }; // guard:attempt-marker
  }
  // The job's sign-in journal: written (exclusively, bound to the job, no credential) before the one automatic submission.
  const journal = { seen: () => exists(path.join(jobDir, 'login.json')), async mark() { await mkdir(jobDir, { recursive: true }); await writeFile(path.join(jobDir, 'login.json'), JSON.stringify({ ...bound, submittedAt: stamp() }, null, 2), { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; }); } };
  try { await ensureBankLogin(ui, status, { label: adapter.label, login, journal: login ? journal : null, now, wait, timeoutMs: loginTimeoutMs, signal }); }
  catch (error) { if (error?.code === 'login-refused') return { items: [], failed: error.message }; throw error; }
  signal?.throwIfAborted();
  await status('running', '入出金明細を開く');
  await ui.openStatements();
  await status('running', '対象期間を選択');
  await ui.selectPeriod(job?.snapshot?.coverage ?? null);
  const snapshot = verifyBankSnapshot(await ui.snapshot(), job?.snapshot);
  const labelChecked = Boolean(String(job?.snapshot?.accountLabel ?? '').trim());
  signal?.throwIfAborted();
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
 * Guided (plan omf-paypay-four-accounts-20261021): with a `guided` adapter of the job's own frozen provider and variant, `login` (the
 * claimed account's saved login) is submitted at most once right after the start page opened (guidedSignIn; journal login.json in the
 * job folder); `reveal` shows the owned background window for the person. After a submission the saved key stays blocked whatever is
 * captured (plan P1: no file or navigation proves the sign-in): a kept file adds a `notice`, no file makes the job `failed` with the
 * explanation; a refusal observed by the adapter is marked as such. Without a submission the result is exactly today's.
 */
export async function observeFromPage(page, browser, adapter, bound, job, root, status, { ui = null, now = Date.now, wait = pause, pollMs = 1000, timeoutMs = 900000, signal = null, login = null, reveal = null } = {}) {
  if (!adapter) throw new Error('A bank adapter is required');
  if (!/^[a-f\d]{24}$/.test(String(bound?.bankAccountId ?? '')) || typeof bound?.jobId !== 'string' || !bound.jobId) throw new Error('A claimed bank job is required');
  // The saved login only through a guided adapter of the job's own frozen provider and variant (an injected or stale adapter, another
  // provider or BA-PLUS never signs in).
  if (login && !(adapter.guided === true && adapter.provider === job?.snapshot?.provider && adapter.variant === (job?.snapshot?.variant ?? null))) login = null; // guard:guided-variant
  ui ||= adapter.ui(page, browser, job?.snapshot ?? null);
  if (reveal) { const base = ui; ui = { ...base, async show() { try { await reveal(); } catch { /* the adapter's own show below */ } await base.show(); } }; }
  const stamp = () => new Date(now()).toISOString(), jobDir = path.join(bankOutbox(root, bound.bankAccountId), bound.jobId + '-observe');
  await mkdir(jobDir, { recursive: true });
  // The job's sign-in journal: written (exclusively, bound to the job, no credential) before the one automatic submission.
  const journal = login ? { seen: () => exists(path.join(jobDir, 'login.json')), async mark() { await writeFile(path.join(jobDir, 'login.json'), JSON.stringify({ ...bound, submittedAt: stamp() }, null, 2), { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; }); } } : null;
  let guided = null;
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
    if (login) { guided = await guidedSignIn(ui, { label: adapter.label, login, journal, signal }); await record(); }
    const ask = !login ? `${adapter.label}のページをChromeで操作してください（観察取得・準備）。入出金明細のCSVを出力できる場合は出力し、終わったらタブを閉じてください`
      : guided.submitted && !guided.refused ? guided.text : guided.text ? `${guided.text}。サインイン後に入出金明細のCSVを出力し、終わったらタブを閉じてください（ガイド付き取得）` : GUIDED_TEXT.manual(adapter.label);
    await status('verification_required', ask);
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
  const result = { observation: records, items, downloads: downloads.map(({ guid, ...d }) => d), closed };
  if (!guided?.submitted) return result;
  // The captured file is the person's statement for native mapping, not proof of the automatic sign-in: the marker stays.
  if (guided.refused) return items.length ? { ...result, notice: GUIDED_TEXT.resave(adapter.label) } : { ...result, failed: LOGIN_TEXT.refused(adapter.label) };
  return items.length ? { ...result, notice: GUIDED_TEXT.kept(adapter.label) } : { ...result, failed: GUIDED_TEXT.unconfirmed(adapter.label) };
}

// An owned, ephemeral, sandboxed Chrome for one bank job: profiles/ephemeral/<owner>-bank-<account>-<batch> (browser.mjs
// ephemeralProfile/browserFor), closed and deleted afterwards. browser.mjs is loaded here, not at import, so the page logic
// above stays loadable without node_modules (the staged-package check imports it that way). `background` (retrievals): the
// owned Chrome starts without a window and its page opens in an inactive off-screen window; `reveal` shows that same window.
async function withBankBrowser(bound, root, batch, onLaunch, fn, { background = false } = {}) {
  const { browserFor, ephemeralProfile, removeEphemeral, showWindow } = await import('./browser.mjs');
  const profile = ephemeralProfile(root, bound.ownerId, 'bank', bound.bankAccountId, batch);
  const browser = await browserFor(profile, { ephemeral: true, root, onLaunch, background });
  try { const page = await browser.newPage(); return await fn(page, browser, background ? () => showWindow(page) : null); }
  finally {
    const child = browser.process();
    try { if (browser.connected) await Promise.race([browser.close(), pause(5000)]); } catch { /* closing */ }
    if (child && child.exitCode === null) { try { child.kill(); } catch { /* gone */ } await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(5000)]); }
    await removeEphemeral(profile, root).catch(() => {});
  }
}
/**
 * One retrieve job through the adapter of the job's FROZEN provider and login variant (snapshot; the claim's current-connection
 * provider only when a snapshot has none) — or an injected one — in an owned ephemeral Chrome. A connection changed after the job
 * was queued never turns it into another bank's or variant's retrieval. The owned Chrome runs in the background (no foreground,
 * no system cursor) and its window is shown only when the person is asked; `login` is the claimed account's saved login.
 */
export async function collectBankStatement(bound, job, root, status, { adapter = adapterFor(job?.snapshot?.provider ?? job?.provider ?? bound?.provider, job?.snapshot?.variant ?? null), batch = 'batch', onLaunch = null, signal = null, now = Date.now, wait = pause, login = null, ...rest } = {}) {
  if (!adapter) throw new Error('No bank adapter for ' + String(job?.provider ?? bound?.provider));
  return withBankBrowser(bound, root, batch, onLaunch, (page, browser, reveal) => collectBankFromPage(page, browser, adapter, bound, job, root, status, { signal, now, wait, login, reveal, ...rest }), { background: true });
}
/**
 * One observe job (preparatory stage) through the provider's adapter (or an injected one) in an owned ephemeral Chrome. A job frozen for
 * a guided variant (guidedAdapterFor: PayPay銀行 standard) uses that adapter, runs in the background and is shown for the person
 * (reveal), and receives `login`; every other observe job keeps the provider adapter, the visible window and no saved login.
 */
export async function observeBankPortal(bound, job, root, status, { adapter = guidedAdapterFor(job) || adapterFor(job?.provider ?? bound?.provider), batch = 'batch', onLaunch = null, signal = null, now = Date.now, wait = pause, login = null, ...rest } = {}) {
  if (!adapter) throw new Error('No bank adapter for ' + String(job?.provider ?? bound?.provider));
  const guided = adapter.guided === true;
  return withBankBrowser(bound, root, batch, onLaunch, (page, browser, reveal) => observeFromPage(page, browser, adapter, bound, job, root, status, { signal, now, wait, ...(guided ? { login, reveal } : {}), ...rest }), { background: guided });
}
