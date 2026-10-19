// collector/banks/rakuten.mjs — 楽天銀行 adapter (plan omf-rakuten-bank-connector-amended-20261019 R2). support stays
// 'contract-pending' with `contract: null`: no selector, credential, portal entitlement or verified flow is claimed, the
// routine steps reject contract-pending (./contract.mjs) and queueBankSync issues observe jobs only. `start` is the official
// business-banking page that answered 200 on 2026-10-18; `starts` are the two official login links recorded in FACTS.md on
// 2026-10-19 (標準 / 口座管理プラス; no login submitted), chosen by the job's frozen `variant`; `loginHosts` is the host they
// resolve to; `hosts` bound the download-host guard. The page engine runs the routine steps once a recorded contract ships here.
import { contractUi } from './contract.mjs';
export default {
  provider: 'rakuten', label: '楽天銀行', support: 'contract-pending', contract: null,
  start: 'https://www.rakuten-bank.co.jp/business/', hosts: ['rakuten-bank.co.jp'],
  starts: { standard: 'https://fes.rakuten-bank.co.jp/MS/main/RbS?COMMAND=START&CurrentPageID=SWITCH_PAGE', plus: 'https://fes.rakuten-bank.co.jp/MS/main/RbS?COMMAND=LOGIN&CurrentPageID=START_ACCOUNT_PLUS' },
  loginHosts: ['fes.rakuten-bank.co.jp'],
  ui(page, browser, snapshot = null) { return contractUi(page, browser, this, snapshot); }
};
