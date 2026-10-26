// collector/banks/ikeda.mjs — 池田泉州銀行 adapter (plan omf-bank-software-compatibility-20261019 S2), the shape of rakuten.mjs.
// support stays 'contract-pending' with `contract: null`: no selector, credential, portal entitlement or verified flow is claimed,
// the routine steps reject contract-pending (./contract.mjs) and queueBankSync issues observe jobs only. `start` is the bank's
// official 法人向けインターネットバンキング page (200 on 2026-10-19); `starts` are its two official login links recorded the same
// day (public GET, nothing submitted): `portal` 池田泉州ビジネスゲート（法人ポータル）, `direct` the インターネットEB login page that
// offers 電子証明書ログイン and ID・パスワード; `loginHosts` are the hosts they resolve to plus the cc0161 host of the certificate login
// form (which posts to the bizsol host); `hosts` bound the download-host guard (the bank's own domain, the AnserBizSOL corporate hosts and the 法人ポータル —
// not the personal-IB parasol host and not bare anser.ne.jp). The login runs on the bank's 電子証明書発行アプリ under the issuing
// Windows user (shared/finance-payment-match.mjs BANK_SOFTWARE); whether the collector's owned Chrome shows the certificate picker
// is unverified until the owner's observe run — nothing here changes the launcher.
// Plan omf-ikeda-collector-20261025: only the frozen variant `portal` (ビジネスゲート) resolves `variants.portal` (collector/bank.mjs adapterFor):
// the owner-observed BusinessGate route of the task's SAFE-CONTRACT — the portal start, the public BLGI024 screen's one visible
// 電子証明書ログイン control (never its ID/password branch), the owned Chrome's certificate chooser answered by ../bank-certificate.mjs (or by the
// person in the same window), the cc password form with the bank's own software-keyboard opt-out, the claimed account's saved login
// password submitted once through the page's own generated form handler, 入出金明細, the exact account by its saved identity, 日付範囲で指定
// with the vue-datepicker calendars (typed dates are cleared by the bank, so nothing is typed or assigned), 検索する, the shown 全N件,
// CSVダウンロード as a blob of the BusinessGate origin and ログアウト. `direct` (インターネットEB, a separate 照会用暗証番号) and no variant keep the
// provider default below. No POST is rebuilt, no hidden control is used, no readonly flag is removed, no value is read back, no keyboard
// or pointer input is used, and nothing from the page (text, account, row, URL, session parameter) leaves it except value-free counts.
// Implemented steps are not a verified connection: the actual chooser, DOM and timing need the owner's replay.
// Imports only ./contract.mjs, ../interaction.mjs, ../bank-certificate.mjs and the shared table, so the staged copy loads without node_modules.
import { contractUi } from './contract.mjs';
import { pause } from '../interaction.mjs';
import { IKEDA_BANK_NAME, IKEDA_ISSUER, selectBankCertificate } from '../bank-certificate.mjs';
import { bankAvailableFrom, jstToday } from '../../shared/finance-payment-match.mjs';

const coded = (code, message, report = false) => Object.assign(new Error(message), { code, ...(report ? { report: true } : {}) });
const LABEL = '池田泉州銀行';
const isoDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
/** The observed BusinessGate route (SAFE-CONTRACT; obfuscated v… classes are not used). */
export const PORTAL = Object.freeze({
  start: 'https://www.0161.houjinportal.anser.ne.jp/', portal: 'https://www.0161.houjinportal.anser.ne.jp', auth: 'https://www.bizsol.anser.ne.jp', cc: 'https://www.cc0161.bizsol.anser.ne.jp', bank: 'https://www.sihd-bk.jp',
  authPath: '/0161c/oauth/auth', ccPath: '/BIZ_0CA0600/rblgi01/BLGI024-BLGI024Info', statementsPath: '/account-statements',
  certificate: Object.freeze({ id: 's05', name: 'forward_rblgi01_s05', text: '電子証明書ログイン' }),
  login: Object.freeze({ password: 'blGI024Info.loginPwd', passwordId: 'blGI024InfoLoginPwd3', maxLength: 12, keyboard: 'skloginpwdshiyoumu', keyboardName: 'skLoginPwdShiyoUmu', button: 'loginBtn_id', buttonName: 'forward_rblgi01_s07', buttonText: 'ログイン', dialogOk: 'dg-btnOK', dialogOkText: 'ＯＫ', keyboardWord: 'ソフトウェアキーボード',
    // The other submit controls the parent observed on the actual form (SAFE-ACTUAL-FORM.json, public metadata): an unnamed image
    // submit and an unnamed, textless button#s04. Each may appear at most once; any other submit control is not the known form.
    otherSubmits: Object.freeze([Object.freeze({ tag: 'INPUT', type: 'image', id: '', name: '', text: '' }), Object.freeze({ tag: 'BUTTON', type: 'submit', id: 's04', name: '', text: '' })]) }),
  statements: '入出金明細', range: '日付範囲で指定', rangeRadio: 'checkTermflg', presets: Object.freeze(['当日', '最近1週間', '当月', '前月', '前々月']),
  startInput: 'dp-input-start-date-id', endInput: 'dp-input-end-date-id', search: '検索する', csv: 'CSVダウンロード', logout: 'ログアウト',
  header: Object.freeze(['勘定日', '(起算日)', 'お支払金額', 'お預り金額', '残高', '取引区分', '明細区分', '金融機関', '支店', '摘要'])
});
const HOSTS = ['0161.houjinportal.anser.ne.jp', 'bizsol.anser.ne.jp', 'sihd-bk.jp'], LOGIN_HOSTS = ['www.0161.houjinportal.anser.ne.jp', 'www.bizsol.anser.ne.jp', 'www.cc0161.bizsol.anser.ne.jp'];

/** GUARD — the saved login handed to login(): exactly a password of 1-12 characters (verbatim; the cc field's maxlength); else manual. */
export function portalLoginSecret(secret, label = LABEL) {
  if (!secret || typeof secret !== 'object' || Object.keys(secret).some(k => k !== 'password') || typeof secret.password !== 'string' || !secret.password.length || secret.password.length > PORTAL.login.maxLength) throw coded('manual-login', `${label}へのサインインはChromeで人が行います`);
  return { password: secret.password };
}
const normText = v => String(v ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
/** GUARD — the account identity frozen on the job: branch, type, the full 7-digit number; else null. */
export function portalIdentity(snapshot) {
  const a = snapshot?.accountIdentity; if (!a || typeof a !== 'object') return null;
  const branch = normText(a.branch), type = normText(a.type), number = String(a.number ?? '');
  return branch && type && /^[0-9]{7}$/.test(number) ? { branch, type, number } : null;
}
/** The bank name that opens every account option (the observed option format, SAFE-ACCOUNT-OPTION-FORMAT-V2). */
export const PORTAL_BANK_NAME = '池田泉州銀行';
/**
 * The fields of one account option in the format the owner's BusinessGate showed (pure; parent finding C7): exactly four
 * whitespace-separated fields — the bank name, the branch, the type and the account number (digits) — after NFKC (fullwidth spaces and
 * digits are ordinary ones). Any other shape (a holder suffix, a missing or extra word, another bank) is not read: null.
 */
export function portalAccountFields(text) {
  const t = normText(text).split(' ');
  return t.length === 4 && t[0] === PORTAL_BANK_NAME && /^[0-9]+$/.test(t[3]) ? { bank: t[0], branch: t[1], type: t[2], number: t[3] } : null;
}
/**
 * GUARD — which option of the account select is the connected account (pure): the one enabled option whose own branch, type and number
 * fields (portalAccountFields) equal the saved branch, type and full 7-digit number — a branch that merely ends in the saved name, the type
 * or number appearing only as an extra word, a longer number or the last digits never match. None or several → -1 (the person checks;
 * nothing is selected); when no option has the known format at all the reason is 'format'. Never the first option by default.
 */
export function portalAccountChoice(options, identity) {
  if (!identity) return { index: -1, reason: 'identity' };
  const list = (Array.isArray(options) ? options : []).map((o, index) => ({ fields: portalAccountFields(o?.text), disabled: !!o?.disabled, index })).filter(o => !o.disabled);
  const hits = list.filter(o => !!o.fields && o.fields.branch === identity.branch && o.fields.type === identity.type && o.fields.number === identity.number); // guard:portal-account-exact
  return hits.length === 1 ? { index: hits[0].index, reason: 'exact' } : { index: -1, reason: hits.length ? 'ambiguous' : list.some(o => o.fields) ? 'missing' : 'format' }; // guard:portal-account-unique
}
/** The state of a BusinessGate page (pure, from the value-free page read). The public login screen (any password field there) is never `login`. */
export function classifyPortalPage(read, c = PORTAL) {
  if (!read || read.top !== true) return 'unknown';
  if (read.origin === c.cc && read.path === c.ccPath && read.password >= 1) return 'login'; // guard:portal-login-surface-only
  if (read.origin === c.portal && read.password === 0 && read.logout >= 1) return read.path === c.statementsPath ? 'statements' : 'authenticated';
  return 'unknown';
}
const dayOf = v => { const s = normText(v).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3').replace(/\//g, '-'), m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s); if (!m) return null; const d = m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0'); return isoDay(d) ? d : null; };
function csvRows(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch; continue; }
    if (ch === '"' && cell === '') quoted = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}
/**
 * GUARD — the downloaded file is the complete statement the bank showed (pure; collector/bank.mjs runs it before a manifest is written and
 * again when a crash is recovered): a blob of the BusinessGate origin, strict Shift_JIS, exactly the observed 10-column header, every row
 * 10 columns with a real 勘定日 inside the searched period, and exactly the 全N件 shown after this job's 検索する. The expectation is the
 * value-free {rows, from, to} recorded before the export click. Nothing of the file is returned.
 */
export function portalCaptureCheck(bytes, { expect = null, origin = null, blob = false } = {}, c = PORTAL) {
  const no = (code, message) => ({ ok: false, code, message: `${LABEL}の${message}。明細は取り込んでいません。もう一度「取得」を押してください` });
  if (!expect || !Number.isSafeInteger(expect.rows) || !isoDay(expect.from) || !isoDay(expect.to)) return no('capture-unexpected', '画面に表示された件数を記録できなかったため、ダウンロードした明細を確認できません');
  if (blob !== true || origin !== c.portal) return no('capture-origin', 'ビジネスゲートの画面から出力された明細と確認できません'); // guard:portal-capture-origin
  let text; try { text = new TextDecoder('shift_jis', { fatal: true }).decode(bytes); } catch { return no('capture-encoding', '明細の文字コード（Shift_JIS）を確認できません'); } // guard:portal-capture-encoding
  const rows = csvRows(text), header = (rows[0] || []).map(normText);
  if (header.length !== c.header.length || header.some((h, i) => h !== normText(c.header[i]))) return no('capture-header', '明細の見出し（10列）が確認済みの形と異なります'); // guard:portal-capture-header
  const data = rows.slice(1);
  if (data.some(r => r.length !== c.header.length)) return no('capture-columns', '明細の列数が確認済みの形と異なります');
  for (const r of data) { const d = dayOf(r[0]); if (!d) return no('capture-date', '明細の勘定日を確認できません'); if (d < expect.from || d > expect.to) return no('capture-period', `明細に検索した期間（${expect.from}〜${expect.to}）の外の日付があります`); } // guard:portal-capture-period
  if (data.length !== expect.rows) return no('capture-count', `明細の件数（${data.length}件）が画面に表示された件数（全${expect.rows}件）と一致しません`); // guard:portal-capture-count
  return { ok: true, rows: data.length };
}
/**
 * GUARD — the frozen job before any bank page is opened (collector/bank.mjs adapter.precheck): a concrete period, the account identity and
 * — on the PC's JST day — a start the bank still offers (the window may have moved past it while the job waited, e.g. across a month
 * rollover). Returns the reason (the job's result; nothing is sent) or null.
 */
export function portalPrecheck(snapshot, now = Date.now(), label = LABEL) {
  const c = snapshot?.coverage;
  if (!c || !isoDay(c.from) || !isoDay(c.to) || c.from > c.to) return `${label}の取得期間が取得時の設定にありません。接続の取得期間を保存して、もう一度「取得」を押してください`;
  if (!portalIdentity(snapshot)) return `${label}の口座（支店名・種別・口座番号）が取得時の設定にありません。接続に口座を保存して、もう一度「取得」を押してください`;
  const today = jstToday(new Date(now)), from = bankAvailableFrom('ikeda', 'portal', today);
  if (c.from < from) return `予約した取得期間の開始日（${c.from}）は、日付が進んだため${label}で照会できる期間（${from}以降）より前になりました。明細は取得していません。もう一度「取得」を押すと照会できる期間で予約し直します（照会できなくなった期間は明細のCSVの取込で補ってください）`; // guard:portal-precheck-window
  if (c.to > today) return `このPCの日付（${today}）が取得期間の終了日（${c.to}）より前のため、明細は取得していません。PCの日付と時刻を確認してください`;
  return null;
}
const CERT_REASON = { process: '起動したChromeを確認できません', missing: '選択画面に池田泉州銀行の証明書がありません', ambiguous: '該当する証明書が複数あります', 'ambiguous-chooser': '証明書の選択画面を1つに特定できません', 'not-in-store': 'このWindowsユーザーの証明書として確認できません', expired: '証明書の有効期間外です', 'no-private-key': '証明書の秘密鍵を確認できません', 'not-selected': '証明書を選択できませんでした', 'no-chooser': '証明書の選択画面が表示されませんでした', unconfirmed: '証明書の選択後にパスワードの画面が表示されませんでした', control: '電子証明書ログインのボタンを特定できません' };
/** The person-facing texts of a 池田泉州銀行 sign-in (bank.mjs ensureBankLogin `exits.texts`; no credential, URL or page text). */
export const PORTAL_TEXT = Object.freeze({
  manual: (label, reason = null) => /^certificate-/.test(String(reason || '')) ? `${label}の電子証明書を自動で選べませんでした（${CERT_REASON[String(reason).slice(12)] || '確認できませんでした'}）。接続したPCのChromeの画面で、${label}の電子証明書を選んでください。パスワードの画面が表示されると、保存済みのログインパスワードで1回だけ自動でサインインします（未保存なら本人が入力します）` : `${label}の電子証明書ログインをChromeの画面で行ってください（ビジネスゲート）`,
  refused: label => `${label}が保存済みのログインパスワードを受け付けませんでした。パスワードを変更した場合はダウンローダーの設定画面で保存し直してください。変更していない場合は同じ画面の「保存済みのログインでもう一度試す」で1回だけ再試行できます（どちらかを行うまで自動では送信しません）`,
  refusedSaved: label => `${label}の前回の自動サインインは銀行に受け付けられませんでした。ダウンローダーの設定画面で、パスワードを変更した場合は保存し直し、変更していない場合は「保存済みのログインでもう一度試す」を押してから、もう一度「取得」を押してください`,
  blocked: label => `${label}の前回の自動サインインが確認できていないため、保存済みのログインパスワードを自動では送信しません。パスワードが正しい場合はダウンローダーの設定画面で「保存済みのログインでもう一度試す」を押してから、もう一度「取得」を押してください`,
  unconfirmed: label => `${label}への自動サインインの完了を確認できませんでした（サインイン後の画面が確認済みの形と異なります）。明細は取得していません。Chromeの画面を確認し、ダウンローダーの設定画面で「保存済みのログインでもう一度試す」を押してから、もう一度「取得」を押してください`
});
// ── in-page readers and actions (serialized; each uses only its argument; no credential field value is ever read) ──
const READ = c => {
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden', norm = t => String(t ?? '').replace(/\s+/g, ' ').trim();
  const exact = text => [...document.querySelectorAll('body *')].filter(e => visible(e) && norm(e.textContent) === text && ![...e.children].some(ch => norm(ch.textContent) === text));
  return { origin: location.origin, path: location.pathname.split(';')[0], top: window.top === window, document: String(performance.timeOrigin),
    password: [...document.querySelectorAll('input[type="password"]')].filter(visible).length,
    certificate: [...document.querySelectorAll('button')].filter(e => visible(e) && !e.disabled && e.id === c.certificate.id && e.name === c.certificate.name && norm(e.textContent) === c.certificate.text).length,
    logout: exact(c.logout).length, statements: exact(c.statements).length };
};
// GUARD (serialized) — activate exactly one visible element whose own text is exactly `text` (the innermost such element; a hidden copy
// never counts) on the expected top document of `origin`; the click is scheduled after this task returns, so a dialog it opens never
// blocks the collector (state() then reports verification). `certificate`: the exact public BLGI024 control instead.
const PRESS = ({ c, origin, text = null, certificate = false, expectedDocument = null }) => {
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden', norm = t => String(t ?? '').replace(/\s+/g, ' ').trim();
  if (location.origin !== origin || window.top !== window || (expectedDocument && String(performance.timeOrigin) !== expectedDocument)) return { ok: false, reason: 'surface' }; // guard:portal-press-surface
  if (certificate && location.pathname.split(';')[0] !== c.authPath) return { ok: false, reason: 'surface' };
  const list = certificate ? [...document.querySelectorAll('button')].filter(e => visible(e) && !e.disabled && e.id === c.certificate.id && e.name === c.certificate.name && norm(e.textContent) === c.certificate.text)
    : [...document.querySelectorAll('body *')].filter(e => visible(e) && !e.disabled && norm(e.textContent) === text && ![...e.children].some(ch => norm(ch.textContent) === text));
  if (list.length !== 1) return { ok: false, reason: list.length ? 'ambiguous' : 'missing' }; // guard:portal-press-unique
  const target = list[0]; setTimeout(() => target.click(), 0);
  return { ok: true };
};
// GUARD (serialized) — the exact visible cc password form on this document, or why not: the cc origin and BLGI024Info path (session
// matrix parameters ignored), the top document, the expected document; exactly one visible password field — the observed name/id/
// maxlength — in a visible form posting to that same path, on the cc origin or the official bizsol authentication origin the actual
// form posts to (SAFE-ACTUAL-FORM.json), into the same window; among the form's visible submit controls exactly one ログイン target
// (the observed id/name/text, a submit button owned by this form, the only visible control of that id or name on the page), every other
// one a known extra (PORTAL.login.otherSubmits, each at most once); at most one visible software-keyboard checkbox. The target may be
// disabled while the field is empty (the actual form): `enabled` reports it, and `submit` activates it only while it is enabled. Hidden
// copies of the form never count. `keyboard` clicks that checkbox once (the bank's own opt-out opens its dialog); `dialog` confirms that
// dialog's exact OK once; `fill` sets the password property and dispatches input/change/keyup; `submit` activates the verified target in this
// same task (the form's own handlers post it); `clear` empties the field. The field's readonly flag and the target's disabled state are
// never touched.
const LOGIN_FORM = ({ c, expectedDocument = null, keyboard = false, dialog = false, fill = null, submit = false, clear = false }) => {
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden', norm = t => String(t ?? '').replace(/\s+/g, ' ').trim();
  if (location.origin !== c.cc || location.pathname.split(';')[0] !== c.ccPath || window.top !== window || (expectedDocument !== null && String(performance.timeOrigin) !== expectedDocument)) return { ok: false, reason: 'surface' }; // guard:portal-login-surface
  const fields = [...document.getElementsByName(c.login.password)].filter(visible);
  if (fields.length !== 1 || !(fields[0] instanceof HTMLInputElement) || fields[0].type !== 'password' || fields[0].id !== c.login.passwordId || fields[0].maxLength !== c.login.maxLength || fields[0].disabled) return { ok: false, reason: 'fields' }; // guard:portal-login-field
  if ([...document.querySelectorAll('input[type="password"]')].filter(visible).length !== 1) return { ok: false, reason: 'password' }; // guard:portal-login-password-unique
  const pw = fields[0], f = pw.form; if (!f || !visible(f)) return { ok: false, reason: 'form' };
  let action = null; try { action = new URL(f.getAttribute('action') || '', location.href); } catch { action = null; }
  if (String(f.getAttribute('method') || '').toLowerCase() !== 'post' || !action || ![c.cc, c.auth].includes(action.origin) || action.pathname.split(';')[0] !== c.ccPath || !['', '_self'].includes(String(f.getAttribute('target') || '').toLowerCase())) return { ok: false, reason: 'action' }; // guard:portal-login-action
  const submits = [...document.querySelectorAll('button, input')].filter(e => e.form === f && visible(e) && ((e.tagName === 'BUTTON' && e.type === 'submit') || (e.tagName === 'INPUT' && ['submit', 'image'].includes(e.type))));
  const targets = submits.filter(e => e.id === c.login.button), target = targets[0];
  if (targets.length !== 1 || target.tagName !== 'BUTTON' || target.name !== c.login.buttonName || norm(target.textContent) !== c.login.buttonText) return { ok: false, reason: 'control' }; // guard:portal-login-control
  const extras = submits.filter(e => e !== target).map(e => c.login.otherSubmits.findIndex(k => e.tagName === k.tag && e.type === k.type && e.id === k.id && e.name === k.name && norm(e.textContent) === k.text));
  if (extras.some(i => i < 0) || new Set(extras).size !== extras.length) return { ok: false, reason: 'control' }; // guard:portal-login-extras
  if ([...document.querySelectorAll('button, input')].filter(e => visible(e) && (e.id === c.login.button || e.name === c.login.buttonName)).length !== 1) return { ok: false, reason: 'control' }; // guard:portal-login-target-unique
  const boxes = [...f.querySelectorAll('input[type="checkbox"]')].filter(e => visible(e) && e.id === c.login.keyboard && e.name === c.login.keyboardName);
  if (boxes.length > 1) return { ok: false, reason: 'keyboard' };
  const found = { ok: true, document: String(performance.timeOrigin), keyboard: boxes.length === 1 && boxes[0].checked, editable: !pw.readOnly, enabled: !target.matches(':disabled') };
  if (keyboard) { if (!found.keyboard) return { ...found, pressed: false }; boxes[0].click(); return { ...found, pressed: true }; }
  if (dialog) {
    const shown = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
    if (shown.length !== 1 || !norm(shown[0].textContent).includes(c.login.keyboardWord)) return { ok: false, reason: 'dialog' }; // guard:portal-keyboard-dialog
    const oks = [...shown[0].querySelectorAll('button, input[type="button"], [role="button"]')].filter(e => visible(e) && !e.disabled && e.id === c.login.dialogOk && norm(e.textContent || e.value) === c.login.dialogOkText);
    if (oks.length !== 1) return { ok: false, reason: 'dialog' };
    oks[0].click(); return found;
  }
  if (fill !== null || clear) {
    if (pw.readOnly || found.keyboard) return { ok: false, reason: 'readonly' }; // guard:portal-login-editable
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(pw, clear ? '' : String(fill));
    pw.dispatchEvent(new Event('input', { bubbles: true })); pw.dispatchEvent(new Event('change', { bubbles: true }));
    // The observed bank field has keyup/blur handlers for controlBtn; let its own handler update the target, including after clear.
    pw.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    return found;
  }
  if (submit) { if (!found.enabled) return { ok: false, reason: 'disabled' }; target.click(); } // guard:portal-login-enabled
  return found;
};
// The statement filter (serialized): the account select (the one visible enabled select that is not the observed preset select), its
// options' texts (used in this process for the identity match only, never recorded), the visible range radio label, the two date inputs.
const FILTER = ({ c, op, index = null, text = null }) => {
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden', norm = t => String(t ?? '').replace(/\s+/g, ' ').trim();
  const selects = [...document.querySelectorAll('select')].filter(e => visible(e) && !e.disabled), preset = s => s.options.length === c.presets.length && [...s.options].every((o, i) => norm(o.textContent) === c.presets[i]);
  const accounts = selects.filter(s => !preset(s));
  const input = id => { const list = [...document.querySelectorAll('input')].filter(e => e.id === id && visible(e)); return list.length === 1 ? list[0] : null; };
  if (op === 'ready') { const labels = [...document.querySelectorAll('label')].filter(l => visible(l) && norm(l.textContent) === c.range && l.querySelector('input[type="radio"][name="' + c.rangeRadio + '"]')); return { accounts: accounts.length, range: labels.length, start: !!input(c.startInput), end: !!input(c.endInput) }; }
  if (accounts.length !== 1) return { ok: false, reason: accounts.length ? 'ambiguous-select' : 'missing-select' };
  const s = accounts[0];
  if (op === 'accounts') return { ok: true, options: [...s.options].map(o => ({ text: norm(o.textContent).slice(0, 300), disabled: o.disabled })), selected: s.selectedIndex };
  if (op === 'choose') {
    const o = s.options[index]; if (!o || norm(o.textContent).slice(0, 300) !== text) return { ok: false, reason: 'changed' };
    s.selectedIndex = index; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, selected: s.selectedIndex };
  }
  if (op === 'range') {
    const labels = [...document.querySelectorAll('label')].filter(l => visible(l) && norm(l.textContent) === c.range && l.querySelector('input[type="radio"][name="' + c.rangeRadio + '"]'));
    if (labels.length !== 1) return { ok: false, reason: labels.length ? 'ambiguous' : 'missing' };
    const radio = labels[0].querySelector('input[type="radio"][name="' + c.rangeRadio + '"]'); if (!radio.checked) labels[0].click();
    return { ok: radio.checked };
  }
  if (op === 'dates') { const a = input(c.startInput), b = input(c.endInput); return { ok: !!a && !!b, start: a ? String(a.value).trim().slice(0, 10) : null, end: b ? String(b.value).trim().slice(0, 10) : null }; }
  return { ok: false, reason: 'op' };
};
// One vue-datepicker calendar (serialized): open it with the input's own DOM click(), read the month/year headings, step one month, or
// click exactly one enabled day cell of the shown month (offset days of the neighbouring months and disabled days never count).
const CALENDAR = ({ op, input, menu, day = null, step = null }) => {
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden', norm = t => String(t ?? '').replace(/\s+/g, ' ').trim();
  if (op === 'open') { const list = [...document.querySelectorAll('input')].filter(e => e.id === input && visible(e)); if (list.length !== 1) return { ok: false, reason: 'input' }; list[0].click(); return { ok: true }; }
  const menus = [...document.querySelectorAll('[id="' + menu + '"]')].filter(visible); if (menus.length !== 1) return { ok: false, reason: 'menu' };
  const m = menus[0], button = label => { const b = [...m.querySelectorAll('button')].filter(e => visible(e) && e.getAttribute('aria-label') === label); return b.length === 1 ? b[0] : null; };
  if (op === 'heading') { const y = button('Open years overlay'), mo = button('Open months overlay'), ys = norm(y?.textContent), ms = norm(mo?.textContent); return /^\d{4}$/.test(ys) && /^(\d{1,2})月$/.test(ms) ? { ok: true, year: Number(ys), month: Number(ms.replace('月', '')) } : { ok: false, reason: 'heading' }; }
  if (op === 'step') { const b = button(step < 0 ? 'Previous month' : 'Next month'); if (!b || b.disabled) return { ok: false, reason: 'step' }; b.click(); return { ok: true }; }
  if (op === 'day') {
    const cells = [...m.querySelectorAll('.dp__calendar_item')].filter(visible).map(e => e.querySelector('.dp__cell_inner')).filter(e => e && visible(e) && norm(e.textContent) === String(day));
    const usable = cells.filter(e => !e.classList.contains('dp__cell_offset')), enabled = usable.filter(e => !e.classList.contains('dp__cell_disabled') && e.getAttribute('aria-disabled') !== 'true');
    if (usable.length !== 1) return { ok: false, reason: usable.length ? 'ambiguous' : 'missing' }; if (enabled.length !== 1) return { ok: false, reason: 'disabled' }; // guard:portal-calendar-day
    enabled[0].click(); return { ok: true };
  }
  return { ok: false, reason: 'op' };
};
// The search result (serialized): the one visible innermost 全N件 and the visible CSVダウンロード controls; `before` is the count element
// shown before this job's 検索する (a JSHandle, or null) — a result counts only once it is another element or shows another text.
const RESULT = (before, { c, beforeText }) => {
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden', norm = t => String(t ?? '').replace(/\s+/g, ' ').trim(), isCount = t => /^全\s*[0-9,]+\s*件$/.test(t);
  const counts = [...document.querySelectorAll('body *')].filter(e => visible(e) && isCount(norm(e.textContent)) && ![...e.children].some(ch => isCount(norm(ch.textContent))));
  const csv = [...document.querySelectorAll('body *')].filter(e => visible(e) && norm(e.textContent) === c.csv && ![...e.children].some(ch => norm(ch.textContent) === c.csv)).length;
  if (counts.length !== 1) return { counts: counts.length, count: null, csv, fresh: false };
  const text = norm(counts[0].textContent);
  return { counts: 1, count: Number(text.replace(/[^0-9]/g, '')), csv, fresh: counts[0] !== before || text !== beforeText };
};
const COUNT_ELEMENT = () => { const visible = e => !!e && e.getClientRects().length > 0, norm = t => String(t ?? '').replace(/\s+/g, ' ').trim(), isCount = t => /^全\s*[0-9,]+\s*件$/.test(t); return [...document.querySelectorAll('body *')].find(e => visible(e) && isCount(norm(e.textContent)) && ![...e.children].some(ch => isCount(norm(ch.textContent)))) || null; };
const LOGOUT_WORDS = /ログアウト|log.?out|log.?off/i, CONFIRM_WORDS = /よろしい|しますか|confirm/i;

/**
 * The ui of a BusinessGate retrieval (the shape of paypay.mjs routineUi). Nothing is read from the page at construction (the staged-package
 * check constructs it with empty objects). open() reaches the public BLGI024 screen and presses its one 電子証明書ログイン control; the
 * chooser is answered by `certificate` (../bank-certificate.mjs, the owned Chrome only) while the page moves on by itself; anything else
 * leaves the chooser to the person (attention() names the value-free reason for bank.mjs's text). loginForm/document/login(secret) are the
 * saved-login steps bank.mjs ensureBankLogin drives (at most one submission per job); login() reports `authenticated` only when that one
 * submission reached a NEW top document of the portal origin with ログアウト and no password field. JS dialogs are never accepted —
 * except one logout confirm of finish()'s own ログアウト press — and while one is open state() is `verification`. `options` are test seams.
 */
export function portalUi(page, browser, adapter = portal, snapshot = null, { certificate = selectBankCertificate, openMs = 45000, certificateMs = 20000, settleMs = 30000, stableMs = 5000, stepMs = 45000, searchMs = 60000, finishMs = 10000 } = {}) {
  const c = PORTAL, label = adapter?.label || LABEL, hosts = adapter?.hosts || HOSTS;
  const bounded = (promise, ms = 5000) => Promise.race([promise, pause(ms).then(() => null)]);
  const evaluate = async (fn, arg, ms = 5000) => { try { return (await bounded(page.evaluate(fn, arg), ms)) || null; } catch { return null; } };
  let dialogs = null, waiting = false, attentionReason = null, searched = null, before = null, logout = null;
  const accept = () => dialogs?.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  const logoutConfirm = event => {
    const scope = logout; if (!scope || scope.seen || Date.now() > scope.until) return; scope.seen = true;
    if (event?.type !== 'confirm' || !LOGOUT_WORDS.test(String(event?.message ?? '')) || !CONFIRM_WORDS.test(String(event?.message ?? ''))) return;
    let same = false; try { same = new URL(String(event?.url)).origin === c.portal && event.url === page.url(); } catch { same = false; }
    if (same) { if (scope.pressed) { scope.answered = true; accept(); } else scope.pending = true; }
  };
  const watch = async () => { if (dialogs) return; try { dialogs = await page.createCDPSession(); await dialogs.send('Page.enable'); dialogs.on('Page.javascriptDialogOpening', () => { waiting = true; }); dialogs.on('Page.javascriptDialogOpening', logoutConfirm); dialogs.on('Page.javascriptDialogClosed', () => { waiting = false; }); } catch { dialogs = null; } };
  const read = () => evaluate(READ, c);
  const kind = async () => waiting ? 'verification' : classifyPortalPage(await read(), c);
  const reach = async (kinds, code, message, ms = stepMs) => { const until = Date.now() + ms; while (Date.now() < until) { const k = await kind(); if (kinds.includes(k)) return k; await pause(250); } throw coded(code, message, true); };
  const fail = (code, message) => coded(code, `${label}の${message}。Chromeの画面を確認してください`, true);
  const press = async (text, code, what) => { const r = await evaluate(PRESS, { c, origin: c.portal, text }); if (!r?.ok) throw fail(code, `「${what || text}」を特定できません（${r?.reason || '画面が変わりました'}）`); };
  const identity = portalIdentity(snapshot);
  const pick = async (side, day) => {
    const input = side === 'start' ? c.startInput : c.endInput, menu = 'dp-menu-' + side + '-date-id', [ty, tm, td] = day.split('-').map(Number);
    if (!(await evaluate(CALENDAR, { op: 'open', input, menu }))?.ok) throw fail('period-unidentified', '期間の入力欄を特定できません');
    let h = null; for (let i = 0; i < 20 && !(h = await evaluate(CALENDAR, { op: 'heading', input, menu }))?.ok; i++) await pause(250);
    for (let i = 0; i < 40 && h?.ok; i++) { const diff = (ty * 12 + tm) - (h.year * 12 + h.month); if (diff === 0) break; if (!(await evaluate(CALENDAR, { op: 'step', input, menu, step: diff }))?.ok) throw fail('period-mismatch', `カレンダーで${day}の月に移動できません`); await pause(150); h = await evaluate(CALENDAR, { op: 'heading', input, menu }); }
    if (!h?.ok || h.year !== ty || h.month !== tm) throw fail('period-mismatch', `カレンダーの表示（年月）を${day}に合わせられません`); // guard:portal-calendar-heading
    const r = await evaluate(CALENDAR, { op: 'day', input, menu, day: td });
    if (!r?.ok) throw fail('period-mismatch', `カレンダーで${day}を選べません（${r?.reason === 'disabled' ? '銀行で選べない日です' : r?.reason || '画面が変わりました'}）`);
    for (let i = 0; i < 20; i++) { const d = await evaluate(FILTER, { c, op: 'dates' }); if (d?.[side] === day) return; await pause(150); }
    throw fail('period-mismatch', `期間の${side === 'start' ? '開始日' : '終了日'}が${day}になりません`);
  };
  const chooseAccount = async () => {
    const list = await evaluate(FILTER, { c, op: 'accounts' });
    if (!list?.ok) throw fail('account-unidentified', `口座の選択欄を特定できません（${list?.reason || '画面が変わりました'}）`);
    const choice = portalAccountChoice(list.options, identity);
    if (choice.index < 0) throw fail('account-unidentified', `口座の選択欄で、接続に保存した口座（支店名・種別・口座番号）と一致する口座を1つに特定できません（${choice.reason === 'ambiguous' ? '複数あります' : choice.reason === 'format' ? '口座の表示が確認済みの形（銀行名・支店名・種別・口座番号）と異なります' : '見つかりません'}）。明細は出力していません。接続の口座の内容を確認してください`);
    if (list.selected !== choice.index) { const set = await evaluate(FILTER, { c, op: 'choose', index: choice.index, text: list.options[choice.index].text }); if (!set?.ok) throw fail('account-unidentified', '口座を選べませんでした'); }
    return choice;
  };
  const verifyAccount = async () => { const now = await evaluate(FILTER, { c, op: 'accounts' }), choice = now?.ok ? portalAccountChoice(now.options, identity) : { index: -1 }; if (choice.index < 0 || now.selected !== choice.index) throw fail('account-unidentified', '選んだ口座が接続に保存した口座と一致しなくなりました。明細は出力していません'); }; // guard:portal-account-selected
  const ui = {
    async open() {
      await watch(); attentionReason = null;
      await page.goto(adapter?.start || c.start, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // The SPA renders after DOMContentLoaded: wait (bounded) for the public certificate control or an already signed-in page.
      let r = null; const until = Date.now() + openMs;
      while (Date.now() < until) { r = waiting ? null : await read(); if (r && (r.certificate >= 1 || classifyPortalPage(r, c) !== 'unknown')) break; await pause(250); }
      if (!r || r.certificate < 1 || classifyPortalPage(r, c) !== 'unknown') return;
      const pressed = await evaluate(PRESS, { c, origin: c.auth, certificate: true, expectedDocument: r.document });
      if (!pressed?.ok) { attentionReason = 'certificate-control'; return; }
      // The chooser of the owned Chrome: the helper answers it while the page itself moves on to the password form (or is already there).
      const abort = new AbortController(), helper = Promise.resolve().then(() => certificate(browser, { issuer: IKEDA_ISSUER, bankName: IKEDA_BANK_NAME, timeoutMs: certificateMs, signal: abort.signal })).catch(() => ({ outcome: 'attention', reason: 'helper-error' }));
      const moved = async ms => { const end = Date.now() + ms; while (Date.now() < end && !abort.signal.aborted) { const x = waiting ? null : await read(); if (x && x.document !== r.document && classifyPortalPage(x, c) !== 'unknown') return true; await pause(250); } return false; };
      const first = await Promise.race([helper.then(v => ({ helper: v })), moved(certificateMs + 25000).then(v => ({ moved: v }))]);
      if (first.moved !== undefined) { abort.abort(); if (!first.moved) attentionReason = 'certificate-unconfirmed'; return; }
      const outcome = first.helper?.outcome;
      if (outcome === 'selected' || outcome === 'no-dialog') { const ok = await moved(outcome === 'selected' ? 25000 : 5000); abort.abort(); if (!ok) attentionReason = outcome === 'selected' ? 'certificate-unconfirmed' : 'certificate-no-chooser'; return; }
      abort.abort(); attentionReason = 'certificate-' + (first.helper?.reason || 'process'); // the chooser stays for the person in this window
    },
    async state() { return { kind: await kind() }; },
    async show() { await bounded(page.bringToFront(), 3000); },
    /** The value-free reason the person is asked (null: the ordinary sign-in), for bank.mjs ensureBankLogin's text. */
    attention: () => attentionReason,
    /** The exact cc password form on the current page ({ok, document, keyboard, editable, enabled}) or {ok:false, reason}; nothing is typed or read. */
    async loginForm() {
      let url; try { url = new URL(page.url()); } catch { return { ok: false, reason: 'surface' }; }
      if (url.origin !== c.cc) return { ok: false, reason: 'surface' };
      return (await evaluate(LOGIN_FORM, { c })) || { ok: false, reason: 'unreadable' };
    },
    async document() { return (await evaluate(() => String(performance.timeOrigin))) ?? null; },
    /**
     * The one submission of the saved login password: the secret's shape before any page; the exact form; the bank's software-keyboard
     * opt-out through its own checkbox and dialog (when the field is still readonly); the field set in one page task bound to that document;
     * abort checked; once the page itself has enabled it (bounded), the verified ログイン activated in one page task bound to the same
     * document — a target that stays disabled is never activated. A replaced document receives nothing; an abort or a disabled target after
     * the fill clears the field. Outcome: authenticated, rejected (the exact form again on a new document) or attention.
     */
    async login(secret, { signal = null } = {}) {
      const { password } = portalLoginSecret(secret, label);
      const form = await ui.loginForm();
      if (!form.ok) throw coded('login-form', `${label}のログイン画面が確認済みの形と異なります（${form.reason}）`);
      signal?.throwIfAborted();
      if (form.keyboard || !form.editable) {
        const pressed = await evaluate(LOGIN_FORM, { c, expectedDocument: form.document, keyboard: true });
        if (!pressed?.ok || !pressed.pressed) throw coded('login-form', `${label}のソフトウェアキーボードの設定を変えられません`);
        let confirmed = null; for (let i = 0; i < 25 && !(confirmed = await evaluate(LOGIN_FORM, { c, expectedDocument: form.document, dialog: true }))?.ok; i++) await pause(200);
        if (!confirmed?.ok) throw coded('login-form', `${label}のソフトウェアキーボードを使わない入力の確認画面が確認済みの形と異なります`);
        let after = null; for (let i = 0; i < 25; i++) { after = await evaluate(LOGIN_FORM, { c, expectedDocument: form.document }); if (after?.ok && !after.keyboard && after.editable) break; await pause(200); }
        if (!after?.ok || after.keyboard || !after.editable) throw coded('login-form', `${label}のパスワード欄が入力できる状態になりません`);
      }
      signal?.throwIfAborted();
      let filled = false, submitted = false;
      try {
        const fill = await evaluate(LOGIN_FORM, { c, expectedDocument: form.document, fill: password });
        if (!fill?.ok || fill.document !== form.document) throw coded('login-changed', `${label}のログイン画面が入力前に変わりました`);
        filled = true; signal?.throwIfAborted();
        // The actual ログイン is disabled while the field is empty; the page's own handlers decide when it is enabled (bounded wait, read only).
        let ready = fill; for (let i = 0; i < 25 && ready?.ok && ready.document === form.document && !ready.enabled; i++) { await pause(200); signal?.throwIfAborted(); ready = await evaluate(LOGIN_FORM, { c, expectedDocument: form.document }); }
        if (!ready?.ok || ready.document !== form.document) throw coded('login-changed', `${label}のログイン画面が送信前に変わりました`);
        if (!ready.enabled) throw coded('login-form', `${label}のログインボタンが押せる状態になりません`);
        const clicked = await evaluate(LOGIN_FORM, { c, expectedDocument: form.document, submit: true });
        if (!clicked?.ok || clicked.document !== form.document) throw coded(clicked?.reason === 'disabled' ? 'login-form' : 'login-changed', `${label}のログイン画面が送信前に変わりました`);
        submitted = true;
      } finally { if (filled && !submitted) await evaluate(LOGIN_FORM, { c, expectedDocument: form.document, clear: true }); }
      return { outcome: await ui.settle(form.document), document: form.document };
    },
    // After the one submission: a NEW document classified authenticated → 'authenticated'; the exact form on a new document → 'rejected';
    // an open dialog, or another new page that stays put for `stableMs` (a notice, a password change, an error) → 'attention'. A portal page
    // without a password field is still rendering (the SPA) and is waited for until `settleMs`.
    async settle(beforeDocument) {
      const until = Date.now() + settleMs; let changed = false, last = null, since = 0;
      while (Date.now() < until) {
        await pause(250);
        if (waiting) return 'attention';
        const r = await read(), doc = r?.document; if (doc && doc !== beforeDocument) changed = true;
        if (!changed || !r) continue;
        const k = classifyPortalPage(r, c);
        if (k === 'authenticated' || k === 'statements') return 'authenticated'; // guard:portal-login-direct
        if (k === 'login' && (await ui.loginForm()).ok) return 'rejected';
        if (r.origin === c.portal && r.password === 0) continue;
        const key = r.origin + r.path + ':' + doc; if (key !== last) { last = key; since = Date.now(); } else if (Date.now() - since >= stableMs) return 'attention';
      }
      return 'attention';
    },
    async openStatements() {
      const k = await kind(); if (k !== 'statements') {
        if (k !== 'authenticated') throw fail('statements-unidentified', 'サインイン後の画面が確認済みの形と異なるため、入出金明細を開きません');
        await press(c.statements, 'statements-unidentified');
        await reach(['statements'], 'statements-unidentified', `${label}の入出金明細が開きませんでした。Chromeの画面を確認してください`);
      }
      const until = Date.now() + stepMs; let f = null;
      while (Date.now() < until) { f = await evaluate(FILTER, { c, op: 'ready' }); if (f && f.accounts === 1 && f.range === 1 && f.start && f.end) return; await pause(250); }
      throw fail('statements-unidentified', `入出金明細の検索条件（口座・期間）が確認済みの形と異なります（口座の選択欄 ${f?.accounts ?? 0}・期間の指定 ${f?.range ?? 0}）`);
    },
    async selectPeriod(coverage) {
      if (!coverage || !isoDay(coverage.from) || !isoDay(coverage.to) || coverage.from > coverage.to) throw coded('period-required', `${label}の取得期間（開始日・終了日）が取得時の設定にありません。接続の取得期間を保存して、もう一度「取得」を押してください`, true);
      if (!identity) throw coded('identity-required', `${label}の口座（支店名・種別・口座番号）が取得時の設定にありません。接続に口座を保存して、もう一度「取得」を押してください`, true);
      if (waiting) throw fail('period-unidentified', '確認の画面が表示されています');
      await chooseAccount();
      const range = await evaluate(FILTER, { c, op: 'range' }); if (!range?.ok) throw fail('period-unidentified', `「${c.range}」を選べません（${range?.reason || '画面が変わりました'}）`);
      await pick('start', coverage.from); await pick('end', coverage.to);
      const dates = await evaluate(FILTER, { c, op: 'dates' }); if (dates?.start !== coverage.from || dates?.end !== coverage.to) throw fail('period-mismatch', `期間を${coverage.from}〜${coverage.to}に設定できませんでした`); // guard:portal-period-readback
      await verifyAccount();
      // The count shown before this job's 検索する never counts as its result.
      try { before = await page.evaluateHandle(COUNT_ELEMENT); } catch { before = null; }
      const beforeText = await evaluate(() => { const e = [...document.querySelectorAll('body *')].find(x => /^全\s*[0-9,]+\s*件$/.test(String(x.textContent).replace(/\s+/g, ' ').trim()) && x.getClientRects().length); return e ? String(e.textContent).replace(/\s+/g, ' ').trim() : ''; });
      await press(c.search, 'period-query');
      const until = Date.now() + searchMs; let last = null, result = null;
      while (Date.now() < until) {
        await pause(600);
        if (waiting) throw fail('period-query', '確認の画面が表示されています');
        let r = null; try { r = await bounded(page.evaluate(RESULT, before, { c, beforeText: beforeText || '' })); } catch { r = null; }
        if (r && r.fresh && r.counts === 1 && (r.csv === 1 || r.count === 0)) { const key = r.count + ':' + r.csv; if (key === last) { result = r; break; } last = key; } else last = null; // guard:portal-search-fresh
      }
      if (!result) throw fail('period-query', '検索結果（全N件とCSVダウンロード）を確認できませんでした。明細は出力していません');
      if (result.count === 0 && result.csv !== 1) throw coded('empty-unconfirmed', `${label}の画面に検索した期間（${coverage.from}〜${coverage.to}）の明細が0件と表示され、CSVを出力できないため、取得済みにはしていません。期間に取引がないかを銀行の画面で確認してください（取り込み済みの明細はそのまま残ります）`, true);
      searched = { rows: result.count, from: coverage.from, to: coverage.to };
    },
    async snapshot() {
      return { accountLabel: (await evaluate(() => String(document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 4000))) || '', period: searched ? searched.from + '〜' + searched.to : null, expect: searched ? { ...searched } : null };
    },
    async exportCsv() {
      if (!searched) throw fail('export-unidentified', 'この取得で検索していないため、CSVは出力しません'); // guard:portal-search-before-export
      if (waiting) throw fail('export-unidentified', '確認の画面が表示されています');
      await verifyAccount();
      const dates = await evaluate(FILTER, { c, op: 'dates' }); if (dates?.start !== searched.from || dates?.end !== searched.to) throw fail('export-unidentified', '検索した期間が変わりました。明細は出力していません');
      let r = null; try { r = await bounded(page.evaluate(RESULT, null, { c, beforeText: '' })); } catch { r = null; }
      if (!r || r.counts !== 1 || r.count !== searched.rows || r.csv !== 1) throw fail('export-unidentified', '検索結果の件数またはCSVダウンロードが変わりました。明細は出力していません');
      await press(c.csv, 'export-unidentified');
    },
    async finish() {
      const until = Date.now() + finishMs, left = () => Math.max(0, until - Date.now()), result = { loggedOut: false };
      try {
        if (waiting) return { ...result, reason: 'dialog' };
        const k = await kind(); if (k !== 'authenticated' && k !== 'statements') return { ...result, reason: 'not-signed-in' };
        const scope = logout = { until, pressed: false, seen: false, pending: false, answered: false };
        try {
          await press(c.logout, 'logout');
          scope.pressed = true; if (scope.pending && !scope.answered && logout === scope && Date.now() <= until) { scope.answered = true; accept(); }
          while (left() > 0) {
            const r = waiting ? null : await read();
            if (r && (r.origin !== c.portal || r.logout === 0)) return { ...result, loggedOut: true };
            // a logout-specific HTML prompt of the bank (never any other dialog) is confirmed once
            await evaluate(({ c }) => { const visible = e => !!e && e.getClientRects().length > 0, norm = t => String(t ?? '').replace(/\s+/g, ' ').trim(); const d = [...document.querySelectorAll('[role="dialog"]')].filter(visible); if (d.length !== 1 || !/ログアウト/.test(norm(d[0].textContent))) return false; const ok = [...d[0].querySelectorAll('button')].filter(e => visible(e) && e.id === c.login.dialogOk && ['ＯＫ', 'OK'].includes(norm(e.textContent))); if (ok.length !== 1 || d[0].dataset.omfAnswered) return false; d[0].dataset.omfAnswered = '1'; ok[0].click(); return true; }, { c });
            await pause(250);
          }
          return { ...result, reason: 'timeout' };
        } finally { if (logout === scope) logout = null; }
      } catch (error) { return { ...result, reason: String(error?.code || 'error') }; }
      finally { try { await before?.dispose?.(); } catch { /* gone */ } }
    },
    async downloadSession(jobDir) {
      const session = await page.browser().target().createCDPSession();
      await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: jobDir, eventsEnabled: true });
      return { on: (event, handler) => session.on(event, handler), async close() { await session.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: false }).catch(() => {}); await session.detach().catch(() => {}); } };
    }
  };
  void hosts;
  return ui;
}

/** The ビジネスゲート login (電子証明書 + ログインパスワード), resolved only for a job frozen with variant `portal`. */
export const portal = Object.freeze({
  provider: 'ikeda', label: LABEL, variant: 'portal', support: 'verified', contract: PORTAL,
  start: PORTAL.start, hosts: [...HOSTS], loginHosts: [...LOGIN_HOSTS],
  loginExits: Object.freeze({ markRefused: true, acceptDirectOnly: true, texts: PORTAL_TEXT }),
  precheck(snapshot, now) { return portalPrecheck(snapshot, now, LABEL); },
  verifyCapture(bytes, context) { return portalCaptureCheck(bytes, context); },
  ui(page, browser, snapshot = null) { return portalUi(page, browser, this, snapshot); }
});
export default {
  provider: 'ikeda', label: LABEL, support: 'contract-pending', contract: null,
  start: 'https://www.sihd-bk.jp/corporation/internetbanking/', hosts: ['sihd-bk.jp', 'bizsol.anser.ne.jp', '0161.houjinportal.anser.ne.jp'],
  starts: { portal: 'https://www.0161.houjinportal.anser.ne.jp/', direct: 'https://www.bizsol.anser.ne.jp/0161c/rblgi01/I1RBLGI01-S01.do' },
  loginHosts: ['www.0161.houjinportal.anser.ne.jp', 'www.bizsol.anser.ne.jp', 'www.cc0161.bizsol.anser.ne.jp'],
  variants: { portal },
  ui(page, browser, snapshot = null) { return contractUi(page, browser, this, snapshot); }
};
