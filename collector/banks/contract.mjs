// collector/banks/contract.mjs — the contract-driven page engine of a web bank (plan omf-rakuten-bank-connector-amended-
// 20261019 R1). An adapter whose `contract` is null keeps today's behaviour: open/state/show/downloadSession work and every
// routine step rejects `contract-pending` (bank.mjs then runs the observe stage only). With a recorded contract the routine
// steps of collectBankFromPage are driven by it: state() classifies the page from the contract, openStatements() clicks the
// recorded path, selectPeriod(null) reads the portal's default period from the recorded inputs, exportCsv() clicks the
// recorded export control. A contract is written by a person from an observation (draftContract) and ships in a reviewed
// release; nothing here types a credential — the person signs in (bank.mjs ensureBankLogin). Imports only ../interaction.mjs
// and node built-ins, so the staged copy loads without node_modules (like bank.mjs).
import { click, pause, poll } from '../interaction.mjs';

const coded = (code, message) => Object.assign(new Error(message), { code });
const pendingError = label => coded('contract-pending', `contract-pending: ${label}の取得手順は未確認です`);
const CONTROLS = 'button, a, [role="button"], input[type="submit"]';
const isText = value => typeof value === 'string' && value.length > 0;
const isPath = value => isText(value) && value.startsWith('/');
const optionalText = value => value === null || value === undefined || isText(value);
const onHosts = (host, hosts) => !!host && (hosts || []).some(h => host === h || host.endsWith('.' + h));

/**
 * GUARD — a contract names every step before any bank page is touched: the login hosts and inputs, the authenticated
 * control, the statements pathname and click path, the period inputs, the export pathname and control (an error title is
 * optional). An incomplete contract throws contract-pending; a complete one is returned. (SCOPE-ONLY GUARD: review is its check.)
 */
export function validateContract(contract, label = '銀行') {
  const c = contract;
  const complete = !!c && typeof c === 'object' && !Array.isArray(c)
    && Array.isArray(c.login?.hosts) && c.login.hosts.length > 0 && c.login.hosts.every(isText)
    && Array.isArray(c.login?.inputs) && c.login.inputs.every(i => !!i && typeof i === 'object' && typeof i.id === 'string' && typeof i.type === 'string')
    && isText(c.authenticated?.control)
    && isPath(c.statements?.pathname) && Array.isArray(c.statements?.path) && c.statements.path.every(isText) && optionalText(c.statements.control)
    && Array.isArray(c.period?.inputs) && c.period.inputs.every(isText)
    && isPath(c.export?.pathname) && isText(c.export?.control)
    && (c.error === null || c.error === undefined || isText(c.error?.titleIncludes));
  if (!complete) throw pendingError(label);
  return c;
}

// What state() reads from the page: host, pathname, title, the texts of the visible controls, whether a password input is visible.
const PAGE = () => ({
  host: location.hostname, pathname: location.pathname, title: document.title,
  controls: [...document.querySelectorAll('button, a, [role="button"], input[type="submit"]')].filter(e => e.getClientRects().length).map(e => (e.innerText || (e.type === 'submit' ? e.value : '') || e.getAttribute('aria-label') || '').trim()).filter(Boolean),
  password: [...document.querySelectorAll('input[type="password"]')].some(e => e.getClientRects().length)
});
/**
 * The state of a page under a contract (pure): off the bank's hosts → unknown; the error title → error_page; a visible
 * password input on a login host → login (before anything else: a login screen may show the authenticated control too);
 * the export page with its control → export_ready; the statements page (with its control when the contract names one) →
 * statements; the authenticated control visible → authenticated; else unknown (bank.mjs then asks the person).
 */
export function classify(page, contract, hosts) {
  if (!onHosts(page.host, hosts)) return 'unknown';
  if (contract.error?.titleIncludes && String(page.title).includes(contract.error.titleIncludes)) return 'error_page';
  if (onHosts(page.host, contract.login.hosts) && page.password) return 'login';
  if (page.pathname === contract.export.pathname && page.controls.includes(contract.export.control)) return 'export_ready';
  if (page.pathname === contract.statements.pathname && (!contract.statements.control || page.controls.includes(contract.statements.control))) return 'statements';
  if (page.controls.includes(contract.authenticated.control)) return 'authenticated';
  return 'unknown';
}

/**
 * The ui of a contract adapter — the shape of aplusUi (collector/aplus.mjs:273-355) and the bank stubs. `snapshot` is the
 * job's frozen snapshot: its `variant` picks `adapter.starts[variant]`, else `adapter.start`. Nothing is read from the page at
 * construction (the staged-package check constructs it with empty objects). The state read tolerates a navigating page
 * (unknown; the wait loop reads again). `login` is never automated: the person signs in in Chrome.
 */
export function contractUi(page, browser, adapter, snapshot = null) {
  const label = adapter?.label || '銀行', contract = adapter?.contract ?? null, hosts = adapter?.hosts || [];
  const start = adapter?.starts?.[snapshot?.variant] ?? adapter?.start;
  const required = () => { if (!contract) throw pendingError(label); return validateContract(contract, label); };
  const surface = () => { let url; try { url = new URL(page.url()); } catch { throw new Error(`${label}のページを確認できません`); } if (!onHosts(url.hostname, hosts)) throw new Error(`${label}のページではありません。Chromeを確認して再試行してください`); return url.origin; };
  const press = text => click(page, CONTROLS, text, surface(), null, label);
  const settled = async () => { await poll(() => page.evaluate(() => document.readyState === 'complete'), 15000, 100); await pause(300); };
  const reach = async (kinds, timeout, message) => { const kind = await poll(async () => { const current = (await ui.state()).kind; return kinds.includes(current) ? current : null; }, timeout, 250); if (!kind) throw new Error(message); return kind; };
  let period = null;
  const ui = {
    async open() { await page.goto(start, { waitUntil: 'domcontentloaded', timeout: 60000 }); },
    async state() {
      if (!contract) return { kind: 'unknown' };
      let read; try { read = await page.evaluate(PAGE); } catch { return { kind: 'unknown' }; }
      return { kind: classify(read, contract, hosts) };
    },
    async show() { await page.bringToFront(); },
    async login() { if (!contract) throw pendingError(label); throw coded('manual-login', `${label}へのサインインはChromeで人が行います`); },
    async openStatements() {
      const c = required();
      for (const text of c.statements.path) { await press(text); await settled(); }
      await reach(['statements', 'export_ready'], 45000, `${label}の入出金明細が開きませんでした。Chromeを確認して再試行してください`);
    },
    async selectPeriod(coverage) {
      const c = required();
      if (coverage !== null && coverage !== undefined) throw coded('contract-pending', `${label}の期間指定は未確認です`);
      const values = await page.evaluate(ids => ids.map(id => { const field = document.getElementById(id) || document.querySelector('[name="' + CSS.escape(id) + '"]'); return field && 'value' in field ? String(field.value).trim().slice(0, 40) : ''; }), c.period.inputs);
      period = values.length ? values.join('〜') : null;
      await reach(['export_ready'], 45000, `${label}のCSV出力が表示されませんでした。Chromeを確認して再試行してください`);
    },
    async snapshot() {
      required();
      return { accountLabel: await page.evaluate(() => String(document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 4000)), period };
    },
    async exportCsv() { const c = required(); await press(c.export.control); },
    async downloadSession(jobDir) {
      const session = await page.browser().target().createCDPSession();
      await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: jobDir, eventsEnabled: true });
      return { on: (event, handler) => session.on(event, handler), async close() { await session.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: false }).catch(() => {}); await session.detach().catch(() => {}); } };
    }
  };
  return ui;
}

/**
 * A contract draft from an observation (the records of bank.mjs observeFromPage as OMF stores them): pure, never run
 * unreviewed — a person reads it and copies it into the adapter. login: the inputs of the page showing a password field (the
 * last such page) and the hosts the downloads began on (`loginHosts` when the caller knows them); statements.path: the click
 * texts of the pages between that login page and the export page, in order; export: the first page with a download event,
 * its last click as the control; statements.pathname: that page; period.inputs: the fields edited there;
 * authenticated.control: the first control shown on every page from the first page after login through the export page.
 * Fields the observation cannot show are null (validateContract then rejects the draft until a person completes it).
 */
export function draftContract(observation, { loginHosts = [] } = {}) {
  const pages = (Array.isArray(observation) ? observation : []).filter(p => !!p && typeof p === 'object');
  const list = value => Array.isArray(value) ? value : [];
  const texts = clicks => list(clicks).map(c => String(c?.text ?? '')).filter(Boolean);
  const loginIndex = pages.findLastIndex(p => list(p.inputs).some(i => i?.type === 'password'));
  const exportIndex = pages.findIndex(p => list(p.downloadEvents).length > 0);
  const loginPage = loginIndex >= 0 ? pages[loginIndex] : null, exportPage = exportIndex >= 0 ? pages[exportIndex] : null;
  const after = pages.slice(loginIndex + 1, exportIndex >= 0 ? exportIndex + 1 : pages.length), between = exportIndex >= 0 ? pages.slice(loginIndex + 1, exportIndex) : after;
  const common = list(after[0]?.visibleControls).map(String).find(text => after.every(p => list(p.visibleControls).includes(text))) ?? null;
  const hosts = [...new Set(pages.flatMap(p => list(p.downloadEvents).map(d => String(d?.host ?? '')).filter(Boolean)))];
  return {
    recordedAt: pages[0]?.at ?? null,
    login: { hosts: loginHosts.length ? [...loginHosts] : hosts, inputs: list(loginPage?.inputs).map(i => ({ id: String(i?.id ?? ''), type: String(i?.type ?? 'text') })) },
    authenticated: { control: common },
    statements: { pathname: exportPage?.pathname ?? null, path: between.flatMap(p => texts(p.clicks)), control: null },
    period: { inputs: [...new Set(list(exportPage?.typedInto).map(t => String(t?.id ?? '')).filter(Boolean))] },
    export: { pathname: exportPage?.pathname ?? null, control: texts(exportPage?.clicks).at(-1) ?? null },
    error: null
  };
}
