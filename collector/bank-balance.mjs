// collector/bank-balance.mjs — the read-only bank balance inquiry of the hourly background balances (plan omf-bank-hourly-balances-20261027).
// A claimed balance job (kind balance; index.mjs runBankJob delegates here) is read in the protected, owned, ephemeral BACKGROUND Chrome
// (bank.mjs withBankBrowser — never revealed: no window, no foreground, no system cursor) through the claimed account's own saved login
// (index.mjs bankLoginFor), submitted by the unchanged bank.mjs ensureBankLogin — its job journal, pending marker and one-attempt rule
// included. A balance inquiry never asks a person: where ensureBankLogin would show the window and wait (no saved login, a blocked or
// refused key, an additional verification, a sign-in it cannot confirm directly) the inquiry stops with that reason. After the exact
// reader of the bank (banks/<provider>.mjs) read the balance, the normalized balance-only receipt (shared balanceReceiptInput — the rule
// OMF applies) is retained durably in outbox/balance/<bankAccountId>/<jobId>/ BEFORE the bank's logout, then sent to bank/balance; it is
// acknowledged only after OMF answered, and the job completes only after that. A receipt retained before a crash or a lost
// acknowledgement is sent again (identical bytes) without opening the bank; an inquiry that began and left no receipt never signs in
// again for that job; a receipt OMF refused for good (its stable code) stays on this PC and is never sent again. No CSV, download,
// statement, screenshot, page text, cookie, credential or full account number is written or sent.
// Lines marked `// guard:<name>` are single predicates the fixture removes in turn from a mutant copy.
import { createHash, randomUUID } from 'node:crypto';
import { access, link, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pause } from './interaction.mjs';
import { ensureBankLogin, withBankBrowser, providerLabel, diagnosticRead, diagnosticWrite, diagnosticCode } from './bank.mjs';
import { standardBalance as rakuten } from './banks/rakuten.mjs';
import { standardBalance as paypay } from './banks/paypay.mjs';
import { portalBalance as ikeda } from './banks/ikeda.mjs';
import { bankBalanceSupported, balanceReceiptInput } from '../shared/finance-bank-balance.mjs';

/** The balance reader of each supported login (provider → its one variant). */
export const BALANCE_ADAPTERS = Object.freeze({ rakuten, paypay, ikeda });
const BANK_BASE = '/api/finance-payments/collector/';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = target => access(target).then(() => true, () => false);
const coded = (code, message) => Object.assign(new Error(message), { code });
const outbox = (root, bankAccountId) => path.join(root, 'outbox', 'balance', String(bankAccountId));
/** The balance adapter of a job, from its FROZEN snapshot provider and variant only; null for anything else. */
export const balanceAdapterFor = job => { const s = job?.snapshot, a = s ? BALANCE_ADAPTERS[s.provider] : null; return job?.kind === 'balance' && a && a.variant === (s.variant ?? null) && bankBalanceSupported(s.provider, s.variant ?? null) ? a : null; }; // guard:balance-adapter-frozen
/** The person-facing texts of a balance check (also the job's status in OMF). None carries a credential, a URL, an amount or page text. */
export const BALANCE_TEXT = Object.freeze({
  unsupported: '残高の確認に対応していない銀行・ログイン方式のため、残高は確認していません（楽天銀行・PayPay銀行の標準ログインと池田泉州銀行のビジネスゲートのみ）',
  attention: (label, text) => `${label}の残高の確認を止めました（画面の裏で確認するため、Chromeの画面は表示していません）。${text}`,
  notDirect: label => `${label}への保存済みのログインでの自動サインインを、この残高の確認で直接確認できなかったため、残高は読み取っていません`,
  interrupted: label => `${label}の前回の残高の確認が途中で止まったため、同じ確認では銀行にもう一度サインインしません。次の1時間ごとの確認か「残高を更新」で新しく確認します`,
  unread: label => `${label}の残高を読み取れませんでした。残高は保存していません`,
  refused: reason => `OMFがこの残高を受け付けませんでした（${reason === 'balance-identity-changed' ? '確認の後に接続の口座が変わりました' : reason === 'balance-receipt-conflict' ? '同じ確認の別の残高が保存済みです' : '内容を確認できません'}）。このPCに残し、再送信しません`,
  resent: '保存済みの残高を送信しました（銀行へのログインは行っていません）',
  complete: '残高を更新しました',
  noLogout: '（ログアウトは確認できませんでした。ブラウザーは閉じました）'
});
// Publish a complete new file exclusively (bank.mjs writeManifest's shape): a killed write leaves no partial manifest.
async function publish(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try { await writeFile(temporary, value, { flag: 'wx', mode: 0o600 }); await link(temporary, file); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function replace(file, value) { const temporary = file + '.' + randomUUID() + '.tmp'; await writeFile(temporary, value, { flag: 'wx', mode: 0o600 }); try { await rename(temporary, file); } catch (error) { await unlink(temporary).catch(() => {}); throw error; } }
const readJson = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };
/** Retained, unacknowledged and not refused balance receipts of one account, bound to its owner and this OMF origin. */
export async function pendingBalance(account, config, root) {
  const base = outbox(root, account._id); let folders = []; try { folders = await readdir(base, { withFileTypes: true }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const result = [];
  for (const f of folders.filter(x => x.isDirectory())) { const dir = path.join(base, f.name), m = await readJson(path.join(dir, 'manifest.json')); if (m && m.kind === 'balance' && !m.acknowledgedAt && !m.refusal && m.bankAccountId === String(account._id) && m.ownerId === String(account.ownerId) && m.origin === config.baseUrl && typeof m.jobId === 'string' && typeof m.snapshotHash === 'string') result.push({ directory: dir, manifest: m }); } // guard:balance-pending-bound
  return result;
}
/** OMF's permanent refusal of a balance receipt (its stable code, or a 400 the same bytes would get again); null for anything transient. */
export const balanceRefusal = error => error?.status === 409 && /^balance-/.test(String(error?.serverCode || '')) ? String(error.serverCode) : error?.status === 400 || error?.status === 415 ? 'balance-invalid' : null;
/** The normalized receipt of one reading (the rule OMF applies; a reading it would refuse is refused here before anything is kept). */
export function balanceReceiptOf(bound, job, reading, observedMs) {
  const body = { v: 1, jobId: bound.jobId, snapshotHash: bound.snapshotHash, provider: job.snapshot.provider, variant: job.snapshot.variant ?? null, currency: 'JPY', amount: reading?.amount, available: reading?.available ?? null, asOf: reading?.asOf, observedAt: new Date(observedMs).toISOString(), source: reading?.source };
  return balanceReceiptInput(body, { jobId: bound.jobId, snapshotHash: bound.snapshotHash, provider: body.provider, variant: body.variant, now: new Date(observedMs) });
}
async function retain(dir, bound, receipt, now) {
  await mkdir(dir, { recursive: true });
  const filename = randomUUID(), bytes = Buffer.from(JSON.stringify(receipt) + '\n');
  await writeFile(path.join(dir, filename), bytes, { flag: 'wx', mode: 0o600 });
  const manifest = { ...bound, kind: 'balance', sourceFormat: 'json', sha256: sha256(bytes), filename, bytes: bytes.length, retainedAt: new Date(now()).toISOString() };
  await publish(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { directory: dir, manifest };
}
/**
 * One balance inquiry on an open page (the shape of bank.mjs collectBankFromPage): the adapter of the job's own frozen provider and
 * variant; its precheck; the unchanged ensureBankLogin with a status that turns "ask the person" into the end of the inquiry and a show()
 * that never shows; a direct sign-in required; readBalance(); `onReading` (the runner retains the receipt there); the bank's logout
 * (balanceFinish, bounded) after any signed-in outcome. Returns { failed, reading, logout }.
 */
export async function inquireFromPage(page, browser, adapter, bound, job, root, status, { login = null, now = Date.now, wait = pause, signal = null, loginTimeoutMs = 90000, settleMs = 20000, finishMs = 20000, onReading = null } = {}) {
  if (!adapter || adapter.provider !== job?.snapshot?.provider || adapter.variant !== (job?.snapshot?.variant ?? null)) return { failed: BALANCE_TEXT.unsupported, reading: null, logout: null }; // guard:balance-variant-bound
  const label = adapter.label, pre = typeof adapter.precheck === 'function' ? adapter.precheck(job.snapshot) : null;
  if (pre) return { failed: pre, reading: null, logout: null };
  const base = adapter.ui(page, browser, job.snapshot ?? null);
  // Never in the foreground; the first read waits (bounded) for the start page to load so a loading page is not taken for a person's step.
  const ui = { ...base, async show() {}, async open() { await base.open(); const until = now() + settleMs; while (now() < until) { const k = (await base.state())?.kind; if (k && k !== 'unknown') return; await wait(250); } } }; // guard:balance-never-shown
  const quiet = async (state, text) => { if (state === 'verification_required') throw coded('balance-attention', text); await status('running', text); }; // guard:balance-never-asks
  const jobDir = path.join(outbox(root, bound.bankAccountId), bound.jobId);
  const journal = { seen: () => exists(path.join(jobDir, 'login.json')), async mark() { await mkdir(jobDir, { recursive: true }); await writeFile(path.join(jobDir, 'login.json'), JSON.stringify({ ...bound, submittedAt: new Date(now()).toISOString() }, null, 2), { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; }); } };
  let signed = false, logout = null, code = null;
  const steps = async () => {
    let result;
    try { result = await ensureBankLogin(ui, quiet, { label, login, journal: login ? journal : null, now, wait, timeoutMs: loginTimeoutMs, signal, exits: adapter.loginExits ?? null }); }
    catch (error) { code = diagnosticCode(error); if (error?.code === 'balance-attention' || error?.code === 'login-refused') return { failed: BALANCE_TEXT.attention(label, error.message), reading: null }; throw error; }
    signed = true;
    if (!result?.direct) return { failed: BALANCE_TEXT.notDirect(label), reading: null }; // guard:balance-direct-only
    signal?.throwIfAborted();
    await status('running', `${label}の残高を確認中`);
    let reading = null;
    try { reading = await ui.readBalance({ signal }); }
    catch (error) { code = diagnosticCode(error); if (signal?.aborted || error?.name === 'AbortError') throw error; return { failed: /^balance-/.test(String(error?.code)) ? String(error.message) : BALANCE_TEXT.unread(label), reading: null }; }
    if (onReading) { try { await onReading(reading); } catch (error) { code = diagnosticCode(error); if (!/^balance-/.test(String(error?.code))) throw error; return { failed: BALANCE_TEXT.unread(label) + '（' + String(error.message) + '）', reading: null }; } }
    return { failed: null, reading };
  };
  // Plan omf-ikeda-trace-20261030: an adapter ui with the optional sign-in trace (authDiagnostic: 池田泉州銀行 ビジネスゲート) gets one private,
  // value-free record per inquiry (bank.mjs diagnosticRecord, <root>/diagnostics/bank/<bankAccountId>/, never the balance outbox), also when
  // the sign-in failed: the trace is read once after the steps and before the logout below, the record written after it; both bounded,
  // errors ignored. The result, the logout rule and what is thrown stay as they were; every other adapter writes nothing.
  const traced = typeof ui.authDiagnostic === 'function'; let auth;
  const run = async () => { try { return await steps(); } catch (error) { code ??= diagnosticCode(error); throw error; } finally { if (traced) auth = await diagnosticRead(() => ui.authDiagnostic()); } };
  let out;
  try {
    try { out = await run(); }
    finally { if (signed) logout = await Promise.race([Promise.resolve().then(() => ui.balanceFinish()).catch(() => null), pause(finishMs).then(() => null)]); } // guard:balance-logout
  } finally {
    const direct = signed && out?.failed !== BALANCE_TEXT.notDirect(label);
    if (traced) await diagnosticWrite(root, bound, { variant: adapter.variant ?? null, at: new Date(now()).toISOString(), outcome: out && !out.failed ? 'completed' : 'failed', step: !direct ? 'login' : out && !out.failed ? 'complete' : 'balance', code: signed && !direct ? 'not-direct' : out && !out.failed ? null : code ?? 'uncoded', finish: logout, auth }); // guard:balance-auth-diagnostic
  }
  return { ...out, logout };
}
/** One balance inquiry in an owned, ephemeral, background Chrome (bank.mjs withBankBrowser; its window is never revealed). */
export async function inquireBalance(bound, job, root, status, { batch = 'batch', onLaunch = null, ...rest } = {}) {
  const adapter = balanceAdapterFor(job);
  if (!adapter) return { failed: BALANCE_TEXT.unsupported, reading: null, logout: null };
  let outcome = null;
  await withBankBrowser(bound, root, batch, onLaunch, async (page, browser) => { outcome = await inquireFromPage(page, browser, adapter, bound, job, root, status, rest); }, { background: true });
  return outcome;
}
/**
 * One claimed balance job: send every retained receipt of the account (each under its own job; this job's own retained or already
 * acknowledged receipt completes it without opening the bank); refuse a second bank login for a job whose inquiry already began; else
 * record the attempt, inquire (`inquire`, the seam), retain the receipt from inside the inquiry, send it and complete. `send` is index.mjs
 * upload (it acknowledges the manifest only after OMF answered).
 */
export async function runBalanceJob(bank, config, live, { status, send, root, inquire = inquireBalance, now = Date.now, login = null, onLaunch = null, batch = 'batch', signal = null } = {}) {
  const { job, account } = bank, adapter = balanceAdapterFor(job), label = adapter?.label || providerLabel(job?.snapshot?.provider);
  if (!adapter || !/^[a-f\d]{24}$/.test(String(account?._id ?? '')) || typeof job?.jobId !== 'string' || typeof job?.snapshotHash !== 'string') { await status('failed', BALANCE_TEXT.unsupported); return { failed: BALANCE_TEXT.unsupported }; }
  const bound = { bankAccountId: String(account._id), ownerId: String(account.ownerId), origin: config.baseUrl, jobId: job.jobId, snapshotHash: job.snapshotHash, provider: job.snapshot.provider };
  const dir = path.join(outbox(root, bound.bankAccountId), job.jobId), manifestFile = path.join(dir, 'manifest.json');
  const sendItem = async item => {
    try { await send(config, account, item, live, { route: 'bank/balance', base: BANK_BASE, query: { jobId: item.manifest.jobId, snapshotHash: item.manifest.snapshotHash } }); return true; }
    catch (error) { const reason = balanceRefusal(error); if (!reason) throw error; await replace(path.join(item.directory, 'manifest.json'), JSON.stringify({ ...item.manifest, refusal: { status: error.status, reason, at: new Date(now()).toISOString() } }, null, 2)); return reason; } // guard:balance-refusal-terminal
  };
  let own = null;
  for (const item of await pendingBalance(account, config, root)) { await status('running', '保存済みの残高を送信中'); const r = await sendItem(item); if (item.manifest.jobId === job.jobId) own = r; }
  if (own === null) { const m = await readJson(manifestFile); if (m?.jobId === job.jobId && m.acknowledgedAt) own = true; else if (m?.jobId === job.jobId && m.refusal) own = m.refusal.reason; }
  if (own === true) { await status('complete', BALANCE_TEXT.resent); return { failed: null, resent: true }; } // guard:balance-resend-without-inquiry
  if (typeof own === 'string') { const text = BALANCE_TEXT.refused(own); await status('failed', text); return { failed: text }; }
  const attempt = path.join(dir, 'attempt.json');
  if (await exists(attempt)) { const text = BALANCE_TEXT.interrupted(label); await status('failed', text); return { failed: text, skipped: 'attempted' }; } // guard:balance-one-inquiry
  await mkdir(dir, { recursive: true }); await writeFile(attempt, JSON.stringify({ ...bound, startedAt: new Date(now()).toISOString() }, null, 2), { flag: 'wx', mode: 0o600 });
  let item = null;
  const onReading = async reading => { if (item) throw coded('balance-twice', '残高を2回読み取りました'); item = await retain(dir, bound, balanceReceiptOf(bound, job, reading, now()), now); }; // guard:balance-retain-before-logout
  const result = await inquire(bound, job, root, status, { login, onLaunch, batch, signal, now, onReading });
  if (result?.failed) { await status('failed', result.failed); return { failed: result.failed }; }
  if (!item) { const text = BALANCE_TEXT.unread(label); await status('failed', text); return { failed: text }; }
  const sent = await sendItem(item);
  if (sent !== true) { const text = BALANCE_TEXT.refused(sent); await status('failed', text); return { failed: text }; }
  const message = BALANCE_TEXT.complete + (result?.logout?.loggedOut === true ? '' : BALANCE_TEXT.noLogout);
  await status('complete', message);
  return { failed: null, logout: result?.logout ?? null };
}
