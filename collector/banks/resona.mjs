// collector/banks/resona.mjs — りそな銀行 adapter stub (plan omf-bank-collection-amended-20261018 A6). support 'contract-pending':
// no selector, credential, portal entitlement or verified flow is claimed. `start` is the official business-direct page that
// answered 200 on 2026-10-18; `hosts` bound the download-host guard once a contract is recorded. The routine methods throw
// contract-pending, so queueBankSync issues observe jobs only (the preparatory stage records the contract draft).
const pending = async () => { throw Object.assign(new Error('contract-pending: りそな銀行の取得手順は未確認です'), { code: 'contract-pending' }); };
export default {
  provider: 'resona', label: 'りそな銀行', support: 'contract-pending', contract: null,
  start: 'https://www.resonabank.co.jp/hojin/b_direct/', hosts: ['resonabank.co.jp'],
  ui(page) {
    return {
      async open() { await page.goto('https://www.resonabank.co.jp/hojin/b_direct/', { waitUntil: 'domcontentloaded', timeout: 60000 }); },
      async state() { return { kind: 'unknown' }; },
      async show() { await page.bringToFront(); },
      login: pending, openStatements: pending, selectPeriod: pending, snapshot: pending, exportCsv: pending,
      async downloadSession(jobDir) { const session = await page.browser().target().createCDPSession(); await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: jobDir, eventsEnabled: true }); return { on: (event, handler) => session.on(event, handler), async close() { await session.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: false }).catch(() => {}); await session.detach().catch(() => {}); } }; }
    };
  }
};
