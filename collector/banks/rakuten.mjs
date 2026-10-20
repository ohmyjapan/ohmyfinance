// collector/banks/rakuten.mjs — 楽天銀行 adapter (plans omf-rakuten-bank-connector-amended-20261019 R2 and
// omf-rakuten-native-shiwake-20261020 §1-§2). The provider default stays 'contract-pending' with `contract: null` (口座管理プラス,
// no variant and unknown variants keep the preparatory observe stage through ./contract.mjs). Only the frozen variant `standard`
// resolves `variants.standard` (collector/bank.mjs adapterFor): the 標準 corporate login observed with the owner on 2026-10-20 —
// the official START_CORP entry, the authenticated overview, 入出金明細, the statement form FORM_DOWNLOAD_AP_2 with its six date
// fields and its first, native-format (楽天銀行フォーマット) CSV control, separate from the Zengin one. Nothing here types or
// reads a credential (the person signs in in Chrome, bank.mjs ensureBankLogin), clicks a transfer, or accepts a dialog other
// than the observed daily-download warning on the armed export surface. A generated JSF id is never pinned. Implemented steps
// are not a verified connection: that needs an owner-run job (shared/finance-payment-match.mjs bankCapability liveVerified).
// Imports only ./contract.mjs, ../interaction.mjs and nothing else, so the staged copy loads without node_modules.
import { contractUi, validateContract } from './contract.mjs';
import { pause, poll } from '../interaction.mjs';

export const START_CORP = 'https://fes.rakuten-bank.co.jp/XMS/security/RbS?COMMAND=LOGIN&CurrentPageID=START_CORP';
const PLUS = 'https://fes.rakuten-bank.co.jp/MS/main/RbS?COMMAND=LOGIN&CurrentPageID=START_ACCOUNT_PLUS';
const HOSTS = ['rakuten-bank.co.jp'], LOGIN_HOSTS = ['fes.rakuten-bank.co.jp'];
const STATEMENT_PATH = '/XMS/inquiry/fcs/rb/fes/views/mainservice/Inquiry/BalanceInquiry/BalanceInquiry/BalanceInquiry.xhtml';
/** The observed daily-download warning (「…1日1度しかダウンロード…」) — the only dialog the collector may accept. */
export const DAILY_EXPORT_WARNING = '1日1度しかダウンロード';
/**
 * The standard corporate contract as observed (output/plan/omf-rakuten-native-shiwake-20261020/PORTAL-CONTRACT-FACTS.json). The
 * statement page is identified by the export form and its six date fields, not by its pathname (recorded here as observed);
 * the download POST answered from CreditDebitInquiry.xhtml on the same host.
 */
export const STANDARD_CONTRACT = Object.freeze({
  recordedAt: '2026-10-20 owner-authenticated observation; not an OMF collector run',
  login: { hosts: [...LOGIN_HOSTS], inputs: [] },
  authenticated: { control: '登録情報の照会・変更' },
  statements: { pathname: STATEMENT_PATH, path: ['入出金明細'], control: null },
  period: { inputs: ['FORM_DOWNLOAD_AP_2:EXPECTED_DATE_FROM_YEAR', 'FORM_DOWNLOAD_AP_2:EXPECTED_DATE_FROM_MONTH', 'FORM_DOWNLOAD_AP_2:EXPECTED_DATE_FROM_DAY', 'FORM_DOWNLOAD_AP_2:EXPECTED_DATE_TO_YEAR', 'FORM_DOWNLOAD_AP_2:EXPECTED_DATE_TO_MONTH', 'FORM_DOWNLOAD_AP_2:EXPECTED_DATE_TO_DAY'] },
  export: { pathname: STATEMENT_PATH, control: 'CSVダウンロード', form: 'FORM_DOWNLOAD_AP_2', format: '楽天銀行フォーマット', downloadPath: '/XMS/inquiry/fcs/rb/fes/views/mainservice/Inquiry/CreditDebitInquiry/CreditDebitInquiry/CreditDebitInquiry.xhtml' },
  error: { titleIncludes: 'エラー' }
});
const coded = (code, message) => Object.assign(new Error(message), { code });
const onHosts = (host, hosts) => !!host && (hosts || []).some(h => host === h || host.endsWith('.' + h));
const CONTROLS = 'button, a, [role="button"], input[type="submit"]';

/**
 * GUARD — which CSV control is the standard (native) export: `controls` are the CSVダウンロード controls of the export form in
 * document order, each with the text of the form between the previous control and it. The one control whose section names
 * 楽天銀行フォーマット and not 全銀; else, with exactly two unlabelled-native/Zengin sections, the first; else none (-1).
 */
export function standardCsvChoice(controls) {
  const list = (Array.isArray(controls) ? controls : []).map((c, index) => ({ segment: String(c?.segment ?? ''), index }));
  const zengin = s => /全銀/.test(s), native = s => /楽天銀行フォーマット/.test(s);
  const labelled = list.filter(c => !zengin(c.segment) && native(c.segment));
  if (labelled.length === 1) return { index: labelled[0].index, reason: 'labelled' };
  if (list.length === 2 && !native(list[0].segment) && !zengin(list[0].segment) && zengin(list[1].segment) && !native(list[1].segment)) return { index: 0, reason: 'before-zengin' };
  return { index: -1, reason: list.length ? 'ambiguous' : 'missing' };
}
/**
 * GUARD — the scoped dialog decision. 'accept' only for a confirm whose text contains the observed daily-download warning,
 * opened by the armed export surface (same host and pathname as the page the single CSV click was made on), and only once;
 * every other dialog (an alert, a prompt, another text, another page or frame, a second one) is left for the person: 'owner'.
 */
export function standardDialogDecision(dialog, surface) {
  if (!surface || surface.armed !== true || surface.accepted !== 0) return 'owner';
  if (dialog?.type !== 'confirm') return 'owner';
  const message = String(dialog?.message ?? '');
  if (!message.includes(DAILY_EXPORT_WARNING)) return 'owner';
  let url; try { url = new URL(String(dialog?.url ?? '')); } catch { return 'owner'; }
  if (url.hostname !== surface.host || url.pathname !== surface.pathname) return 'owner';
  return 'accept';
}
/** The six native date fields from the job's frozen explicit coverage {from,to}; anything else throws period-required. */
export function standardPeriodValues(coverage, ids = STANDARD_CONTRACT.period.inputs) {
  const day = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if (!coverage || typeof coverage !== 'object' || !day(coverage.from) || !day(coverage.to) || coverage.from > coverage.to) throw coded('period-required', '楽天銀行の取得期間（開始日・終了日）が取得時の設定にありません。接続の取得期間を保存して、もう一度「取得」を押してください');
  const [fy, fm, fd] = coverage.from.split('-').map(Number), [ty, tm, td] = coverage.to.split('-').map(Number);
  return [fy, fm, fd, ty, tm, td].map((n, i) => [ids[i], n]);
}
/** GUARD — the values read back from the six fields equal the wanted numbers (padded or not); a blank or default value does not. */
export function standardPeriodReadback(values, wanted) {
  return Array.isArray(values) && Array.isArray(wanted) && values.length === wanted.length && wanted.every(([, n], i) => /^\d+$/.test(String(values[i] ?? '').trim()) && Number(values[i]) === n);
}
/**
 * The state of a standard page (pure): off the bank's hosts → unknown; an error title → error_page; a visible password input on
 * the login host → login (first: the login screen shows authenticated-looking links too); the export form with its six date
 * fields and a CSV control → export_ready; the authenticated control or 入出金明細 visible → authenticated; else unknown.
 */
export function classifyStandardPage(read, adapter = null) {
  const c = adapter?.contract || STANDARD_CONTRACT, hosts = adapter?.hosts || HOSTS, controls = Array.isArray(read?.controls) ? read.controls : [];
  if (!onHosts(read?.host, hosts)) return 'unknown';
  if (c.error?.titleIncludes && String(read.title ?? '').includes(c.error.titleIncludes)) return 'error_page';
  if (onHosts(read.host, c.login.hosts) && read.password) return 'login';
  if (read.exportForm && read.dateFields === c.period.inputs.length && read.csvControls >= 1) return 'export_ready';
  if (controls.includes(c.authenticated.control) || c.statements.path.some(text => controls.includes(text))) return 'authenticated';
  return 'unknown';
}

// In-page readers (serialized; they use only their argument). Never a value of a credential field.
const STANDARD_PAGE = ({ form, ids, control }) => {
  const visible = e => e.getClientRects().length > 0, f = document.getElementById(form);
  return {
    host: location.hostname, pathname: location.pathname, title: document.title,
    controls: [...document.querySelectorAll('button, a, [role="button"], input[type="submit"]')].filter(visible).map(e => (e.innerText || (e.type === 'submit' ? e.value : '') || e.getAttribute('aria-label') || '').trim()).filter(Boolean),
    password: [...document.querySelectorAll('input[type="password"]')].some(visible),
    exportForm: !!f, dateFields: ids.filter(id => !!document.getElementById(id)).length,
    csvControls: f ? [...f.querySelectorAll('input[type="submit"], button')].filter(e => visible(e) && !e.disabled && String(e.value || e.textContent || '').trim() === control).length : 0
  };
};
const CSV_CONTROLS = ({ form, control, index, segment }) => {
  const f = document.getElementById(form); if (!f) return index === undefined ? [] : { error: 'missing' };
  const list = [...f.querySelectorAll('input[type="submit"], button')].filter(e => e.getClientRects().length && !e.disabled && String(e.value || e.textContent || '').trim() === control);
  let previous = null; const segments = list.map(e => { const range = document.createRange(); if (previous) range.setStartAfter(previous); else range.setStart(f, 0); range.setEndBefore(e); previous = e; return range.toString().replace(/\s+/g, ' ').trim().slice(-400); });
  if (index === undefined) return segments.map(s => ({ segment: s }));
  if (index >= list.length || segments[index] !== segment) return { error: 'changed' };
  const target = list[index]; target.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = target.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
  return target.contains(document.elementFromPoint(x, y)) ? { x, y } : { error: 'covered' };
};
const SET_PERIOD = pairs => {
  for (const [id, n] of pairs) {
    const e = document.getElementById(id); if (!e) return { missing: id };
    if (e.tagName === 'SELECT') { const o = [...e.options].find(o => Number(o.value) === n || Number(String(o.textContent).replace(/[^0-9]/g, '')) === n); if (!o) return { missing: id }; e.value = o.value; }
    else e.value = /YEAR$/.test(id) ? String(n) : String(n).padStart(2, '0');
    e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return { ok: true };
};
const READ_PERIOD = ids => ids.map(id => { const e = document.getElementById(id); return e && 'value' in e ? String(e.value).trim().slice(0, 10) : ''; });

/**
 * The ui of the standard corporate adapter (the shape of contractUi). Nothing is read from the page at construction (the
 * staged-package check constructs it with empty objects). A dialog watcher (its own CDP session) is installed when the start
 * page is opened: while an undecided dialog is open, state() is `verification` (bank.mjs then asks the person) and nothing else
 * is clicked; the single CSV click arms it for that surface. selectPeriod needs the frozen coverage before any page is touched.
 */
export function standardUi(page, browser, adapter = standard, snapshot = null) {
  const label = adapter?.label || '楽天銀行', contract = adapter?.contract ?? null, hosts = adapter?.hosts || HOSTS, start = adapter?.start || START_CORP;
  const required = () => validateContract(contract, label);
  let dialogs = null, waiting = false, surface = { armed: false, accepted: 0, host: null, pathname: null }, period = null;
  const watch = async () => {
    if (dialogs) return;
    dialogs = await page.createCDPSession(); await dialogs.send('Page.enable');
    dialogs.on('Page.javascriptDialogOpening', event => {
      if (standardDialogDecision({ type: event.type, message: event.message, url: event.url }, surface) === 'accept') { surface.accepted++; dialogs.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); return; }
      waiting = true;
    });
    dialogs.on('Page.javascriptDialogClosed', () => { waiting = false; });
  };
  const current = () => { let url; try { url = new URL(page.url()); } catch { throw new Error(`${label}のページを確認できません`); } if (!onHosts(url.hostname, hosts)) throw new Error(`${label}のページではありません。Chromeを確認して再試行してください`); return url; };
  const bounded = (promise, ms = 5000) => Promise.race([promise, pause(ms).then(() => null)]);
  const settled = async () => { await poll(() => page.evaluate(() => document.readyState === 'complete'), 15000, 100); await pause(300); };
  const reach = async (kinds, timeout, message) => { const kind = await poll(async () => { const k = (await ui.state()).kind; return kinds.includes(k) ? k : null; }, timeout, 250); if (!kind) throw new Error(message); return kind; };
  const pressFirst = async text => {
    current();
    const point = await page.evaluate(({ selector, text }) => {
      const target = [...document.querySelectorAll(selector)].find(e => !e.disabled && e.getClientRects().length && String(e.innerText || (e.type === 'submit' ? e.value : '') || '').trim() === text);
      if (!target) return null; target.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = target.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2; return target.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
    }, { selector: CONTROLS, text });
    if (!point) throw new Error(`${label}の「${text}」が見つかりません。Chromeを確認して再試行してください`);
    current(); await page.mouse.click(point.x, point.y);
  };
  const ui = {
    async open() { await watch(); await page.goto(start, { waitUntil: 'domcontentloaded', timeout: 60000 }); },
    async state() {
      if (!contract) return { kind: 'unknown' };
      if (waiting) return { kind: 'verification' };
      let read; try { read = await bounded(page.evaluate(STANDARD_PAGE, { form: contract.export.form, ids: contract.period.inputs, control: contract.export.control })); } catch { return { kind: 'unknown' }; }
      if (!read) return { kind: waiting ? 'verification' : 'unknown' };
      return { kind: classifyStandardPage(read, adapter) };
    },
    async show() { await bounded(page.bringToFront(), 3000); },
    async login() { throw coded('manual-login', `${label}へのサインインはChromeで人が行います`); },
    async openStatements() {
      const c = required();
      if ((await ui.state()).kind === 'export_ready') return;
      for (const text of c.statements.path) { await pressFirst(text); await settled(); }
      await reach(['export_ready'], 45000, `${label}の入出金明細（CSV出力の画面）が開きませんでした。Chromeを確認して再試行してください`);
    },
    async selectPeriod(coverage) {
      const wanted = standardPeriodValues(coverage, contract?.period?.inputs), c = required();
      current();
      const set = await page.evaluate(SET_PERIOD, wanted);
      if (!set?.ok) throw coded('period-mismatch', `${label}の期間の項目（${set?.missing || '日付'}）が見つかりません。Chromeを確認してください`);
      for (const delay of [0, 600]) {
        if (delay) await pause(delay);
        const values = await page.evaluate(READ_PERIOD, c.period.inputs);
        if (!standardPeriodReadback(values, wanted)) throw coded('period-mismatch', `${label}の期間を${coverage.from}〜${coverage.to}に設定できませんでした（画面の値: ${values.join('/')}）。Chromeを確認してください`);
      }
      period = coverage.from + '〜' + coverage.to;
      await reach(['export_ready'], 45000, `${label}のCSV出力が表示されませんでした。Chromeを確認して再試行してください`);
    },
    async snapshot() {
      required();
      return { accountLabel: await page.evaluate(() => String(document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 4000)), period };
    },
    async exportCsv() {
      const c = required(), form = c.export.form, control = c.export.control;
      current();
      const segments = await page.evaluate(CSV_CONTROLS, { form, control });
      const choice = standardCsvChoice(segments);
      if (choice.index < 0) throw coded('export-unidentified', `${label}の「${c.export.format}」のCSVボタンを特定できません（${choice.reason}）。全銀フォーマットは使いません。Chromeを確認してください`);
      const point = await page.evaluate(CSV_CONTROLS, { form, control, index: choice.index, segment: segments[choice.index].segment });
      if (!point || point.error) throw coded('export-unidentified', `${label}のCSVボタンを押せません（${point?.error || 'unknown'}）。Chromeを確認してください`);
      const url = current(); await watch();
      surface = { armed: true, accepted: 0, host: url.hostname, pathname: url.pathname };
      // The click may wait while a dialog is open; the bounded wait lets the download loop surface an undecided dialog.
      const clicking = page.mouse.click(point.x, point.y).catch(() => {});
      await Promise.race([clicking, pause(2000)]);
    },
    async downloadSession(jobDir) {
      const session = await page.browser().target().createCDPSession();
      await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: jobDir, eventsEnabled: true });
      return { on: (event, handler) => session.on(event, handler), async close() { await session.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: false }).catch(() => {}); await session.detach().catch(() => {}); } };
    }
  };
  return ui;
}

/** The standard corporate (START_CORP) adapter: resolved only for a job frozen with variant `standard`. */
export const standard = Object.freeze({
  provider: 'rakuten', label: '楽天銀行', variant: 'standard', support: 'verified', contract: STANDARD_CONTRACT,
  start: START_CORP, hosts: [...HOSTS], loginHosts: [...LOGIN_HOSTS],
  ui(page, browser, snapshot = null) { return standardUi(page, browser, this, snapshot); }
});
export default {
  provider: 'rakuten', label: '楽天銀行', support: 'contract-pending', contract: null,
  start: 'https://www.rakuten-bank.co.jp/business/', hosts: [...HOSTS],
  starts: { standard: START_CORP, plus: PLUS },
  loginHosts: [...LOGIN_HOSTS],
  variants: { standard },
  ui(page, browser, snapshot = null) { return contractUi(page, browser, this, snapshot); }
};
