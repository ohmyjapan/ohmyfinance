// collector/banks/resona.mjs — りそな銀行 adapter (plan omf-bank-software-compatibility-20261019 S3), the shape of rakuten.mjs.
// support stays 'contract-pending' with `contract: null`: no selector, credential, portal entitlement or verified flow is claimed,
// the routine steps reject contract-pending (./contract.mjs) and queueBankSync issues observe jobs only. `start` is the official
// ビジネスダイレクト page (200 on 2026-10-18); `starts` are the two links of the official login chooser recorded 2026-10-19 (public
// GET, nothing submitted): `direct` 直接ログイン (resolves to the b-direct login page) and `idlink` ID連携ログイン (りそなグループID, on
// wb.resona-gr.co.jp); `loginHosts` are the hosts they resolve to plus the cc host the certificate login form posts to; `hosts`
// bound the download-host guard — widened to the group domain so a CSV reached through the ID連携 path is retained (a tolerance, no
// new refusal). りそなWebサービス is a different product and not a variant here. The certificate login runs on the bank's
// 電子証明書発行アプリ under the issuing Windows user (shared/finance-payment-match.mjs BANK_SOFTWARE); nothing here changes the launcher.
import { contractUi } from './contract.mjs';
export default {
  provider: 'resona', label: 'りそな銀行', support: 'contract-pending', contract: null,
  start: 'https://www.resonabank.co.jp/hojin/b_direct/', hosts: ['resonabank.co.jp', 'resona-gr.co.jp'],
  starts: { direct: 'https://www.b-direct.resonabank.co.jp/0010c/rblgi01/I1RBLGI01-S01.do', idlink: 'https://wb.resona-gr.co.jp/webservice/WSOI0101E100M.do?BK=0010&lin=b_direct' },
  loginHosts: ['www.b-direct.resonabank.co.jp', 'www.cc.b-direct.resonabank.co.jp', 'wb.resona-gr.co.jp'],
  ui(page, browser, snapshot = null) { return contractUi(page, browser, this, snapshot); }
};
