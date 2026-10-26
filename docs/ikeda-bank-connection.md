# 池田泉州銀行 ビジネスゲート connection (plan `omf-ikeda-collector-20261025`)

The normal OMF bank connection for 池田泉州銀行's 法人ポータル (ビジネスゲート) with 電子証明書 + ログインパスワード. Source only: nothing here is
deployed, installed or activated, and no part of it has run against the actual bank. The owner's actual certificate login, statement export
and 78-row native import were done by the parent outside this code (preparation, not proof of this collector).

## Setup

1. OMF → 銀行口座の接続・自動取得: provider 池田泉州銀行, ログイン方式 「池田泉州ビジネスゲート（法人ポータル）からログイン」, the account's
   支店名 / 種別 / 口座番号（7桁）, and the 取得期間 (an open end follows each day). No template or CSV upload is needed (native 10-column template).
2. Allow the PC for the account. On that PC (the Windows user the bank's 電子証明書発行アプリ issued the certificate to), open the downloader
   setup and save the **login password only** (`portalPassword`, ≤12 characters, sealed as `ikeda-<bankAccountId>` with the account's AAD; its
   key is released only for a live `ikeda`/`portal` connection granted to that PC — `financeCollectorSecurityService.ts` BANK_KEY_VARIANTS).
3. 取得 (or the daily schedule) queues a retrieval frozen with the bank window.
   It also freezes the account identity. A job no PC has received yet runs only while the connection still names the same bank, login
   type, branch, type and full number (a scheduled job: the schedule binding; a manual 取得: the claim, review F1); otherwise it is closed
   as 置き換え済み before any bank page with the reason, and 取得 again runs the current account. A job a PC already received keeps its
   frozen identity when it is resumed after an expired lease. Template, period and label changes do not close it.

## What one retrieval does (`collector/banks/ikeda.mjs` `portalUi`)

- Before any page: the frozen period must still be offered on the PC's JST day and the account identity must be present (`precheck`).
- Opens `https://www.0161.houjinportal.anser.ne.jp/`, waits for the public BLGI024 screen and presses its one visible 電子証明書ログイン
  (`button#s05[name=forward_rblgi01_s05]`). The public ID/password branch never receives anything.
- Chrome's certificate chooser of **this collector's own Chrome** is answered by `collector/bank-certificate.mjs` →
  `collector/windows/bank-certificate.ps1`: process identity (pid, parent = the collector's node, created after it, chrome.exe, the browser
  process on the collector's profile, current user and session), exactly one chooser window (nested representations collapse; two choosers
  = attention), exactly one bank row (issuer `The Senshu Ikeda Bank, Ltd. CA - G4` as a cell, or a cell-less row whose name contains
  `The Senshu Ikeda Bank, Ltd.`), exactly one valid current-user certificate of that issuer with a private key; UI Automation select +
  invoke only. Anything else leaves the chooser to the person in the same window (status text names the reason). No mouse, keyboard,
  policy, registry or certificate change; the store is read (metadata) only once a qualifying chooser is shown.
- On the cc password form: the visible checkbox ソフトウェアキーボードを使用する is unchecked through the bank's own confirmation (ＯＫ); the saved
  password is set once on the visible `blGI024Info.loginPwd` and the form's own ログイン is activated (journal + uncertain marker before the
  submission). Authentication counts only when that submission reaches a new portal page with ログアウト and no password field; the exact
  form again is a refusal (marker `refused`); anything else is `uncertain`. Neither is ever submitted again automatically — the owner
  re-saves or uses 「保存済みのログインでもう一度試す」.
- 入出金明細 → the account select's one option in the observed format `池田泉州銀行 <支店> <種別> <口座番号>` (four whitespace-separated
  fields, parent SAFE-ACCOUNT-OPTION-FORMAT-V2) whose own branch, type and number fields equal the saved ones (never a substring, an extra
  word, a suffix or the first option; another format is the person's check; verified again before export) → 日付範囲で指定 → both vue-datepicker calendars (headings checked, offset/disabled days
  refused; nothing typed) → 検索する → waits for its own 全N件 (an earlier result never counts) and CSVダウンロード → the download, observed before
  the click, must be a blob of the BusinessGate origin, strict Shift_JIS, the 10-column header, rows inside the period and exactly N rows.
  0 results with a CSV control: the header-only file is kept (the screen's 明細0件 note applies); 0 without one: not claimed, the job says why.
- ログアウト (a logout-specific confirm is answered once); the result never depends on it.

## Periods and history

The bank window is 前々月1日〜当日 (JST). Requested and effective periods are frozen separately; the unavailable part is named in the queue
message and the job line; nothing before the window is claimed. OMF rows and originals are never removed. The schedule view's archive gaps
are requested days the bank no longer offers that no imported capture of this connection (same provider/variant/full identity) covered —
recoverable only from a CSV the owner still has (an owner import does not clear the gap, it is not count-verified).

## Evidence and limits

Synthetic only (`scripts/zoomer-fixtures/omf-ikeda-collector.mjs`, `collector/test/ikeda-portal.test.mjs`, `test/ikeda-bank-window.test.mjs`,
`scripts/collector-security-integration.ts`): an invented BusinessGate DOM served by interception to headless Chrome, owned MongoDB, a fresh
DPAPI device key in a temp directory. Not proven here: the actual chooser's UI Automation tree (the row/cell representation and OK naming),
the actual BusinessGate DOM and render timing (result re-render, calendar classes), the actual refusal/notice pages and any logout prompt.
Those need the parent's separately approved installed replay. Resona/Jable and インターネットEB direct are unchanged and unsupported.
