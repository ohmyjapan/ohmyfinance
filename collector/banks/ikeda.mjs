// collector/banks/ikeda.mjs — 池田泉州銀行 adapter (plan omf-bank-software-compatibility-20261019 S2), the shape of rakuten.mjs.
// support stays 'contract-pending' with `contract: null`: no selector, credential, portal entitlement or verified flow is claimed,
// the routine steps reject contract-pending (./contract.mjs) and queueBankSync issues observe jobs only. `start` is the bank's
// official 法人向けインターネットバンキング page (200 on 2026-10-19); `starts` are its two official login links recorded the same
// day (public GET, nothing submitted): `portal` 池田泉州ビジネスゲート（法人ポータル）, `direct` the インターネットEB login page that
// offers 電子証明書ログイン and ID・パスワード; `loginHosts` are the hosts they resolve to plus the cc0161 host the certificate login
// form posts to; `hosts` bound the download-host guard (the bank's own domain, the AnserBizSOL corporate hosts and the 法人ポータル —
// not the personal-IB parasol host and not bare anser.ne.jp). The login runs on the bank's 電子証明書発行アプリ under the issuing
// Windows user (shared/finance-payment-match.mjs BANK_SOFTWARE); whether the collector's owned Chrome shows the certificate picker
// is unverified until the owner's observe run — nothing here changes the launcher.
import { contractUi } from './contract.mjs';
export default {
  provider: 'ikeda', label: '池田泉州銀行', support: 'contract-pending', contract: null,
  start: 'https://www.sihd-bk.jp/corporation/internetbanking/', hosts: ['sihd-bk.jp', 'bizsol.anser.ne.jp', '0161.houjinportal.anser.ne.jp'],
  starts: { portal: 'https://www.0161.houjinportal.anser.ne.jp/', direct: 'https://www.bizsol.anser.ne.jp/0161c/rblgi01/I1RBLGI01-S01.do' },
  loginHosts: ['www.0161.houjinportal.anser.ne.jp', 'www.bizsol.anser.ne.jp', 'www.cc0161.bizsol.anser.ne.jp'],
  ui(page, browser, snapshot = null) { return contractUi(page, browser, this, snapshot); }
};
