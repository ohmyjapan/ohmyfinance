# 楽天銀行 connection (standard corporate login)

Plan `omf-rakuten-native-shiwake-20261020` §1-§3, §10. This page describes what the software does, what was observed, what is
not observed, and the checklist for the owner's live test. Nothing here is a claim that a live login or an OMF collector run has
succeeded: the tests behind this change are synthetic (a fake portal served by request interception in owned Chrome).

## Observed facts (2026-10-20, owner-authenticated, outside OMF)

Recorded in `output/plan/omf-rakuten-native-shiwake-20261020/PORTAL-CONTRACT-FACTS.json` (hub). Owner-entered login through the
official entry `https://fes.rakuten-bank.co.jp/XMS/security/RbS?COMMAND=LOGIN&CurrentPageID=START_CORP`; authenticated overview
`/XMS/inquiry/gns` (control「登録情報の照会・変更」); navigation「入出金明細」; statement form `FORM_DOWNLOAD_AP_2` with the six date
fields `EXPECTED_DATE_{FROM,TO}_{YEAR,MONTH,DAY}`; two「CSVダウンロード」controls — the first section is 楽天銀行フォーマット, the second
Zengin; a large export shows a once-a-day warning (「…1日1度しかダウンロード…」) that must be confirmed; the download answered from
`CreditDebitInquiry.xhtml` on `fes.rakuten-bank.co.jp`; the file is Shift_JIS, compact `YYYYMMDD` dates, four columns
`取引日,入出金(円),残高(円),入出金先内容`. The generated JSF id of the CSV control (`j_id_…`) was seen once and is NOT used.

## What the collector does (variant `standard`)

`collector/banks/rakuten.mjs` `variants.standard`, resolved by `collector/bank.mjs adapterFor(snapshot.provider, snapshot.variant)` — the job's FROZEN provider and variant, never the current
connection — for a job frozen with 楽天銀行 variant `standard`; collected by the existing `collectBankFromPage` in the collector's own ephemeral Chrome.

1. Opens START_CORP in the collector's owned Chrome, which runs in the background (see "Background and attention"). With a saved
   login for this bank account (see "Saved login") it signs in automatically on the exact recorded login form, once per job;
   without one the person signs in and enters any OTP in that Chrome window (`verification_required`, once). The login page is
   recognised by a visible password field on the login host; a field value is never read.
2. Clicks the first visible「入出金明細」and waits for the export form (identified by `FORM_DOWNLOAD_AP_2`, its six date fields and a
   「CSVダウンロード」control — not by a pathname).
3. Writes the job's frozen period into the six fields (selects by option value/number, text inputs zero-padded), fires `input` and
   `change`, reads the six values back twice (immediately and after 0.6 s). Any mismatch stops before the attempt marker
   (`period-mismatch`); a job without a frozen period stops before any page (`period-required`).
4. Checks the shown account label (existing guard), writes `attempt.json`, then chooses the CSV control whose form section names
   楽天銀行フォーマット and not 全銀 (or the first of exactly two sections when only the second is labelled 全銀); anything else stops
   (`export-unidentified`). Zengin is never clicked.
5. A dialog watcher (own CDP session, installed at open) accepts only a `confirm` containing「1日1度しかダウンロード」opened by the
   armed export page (same host and pathname) and only once. Any other dialog — another text, an alert/prompt, another page or
   frame, a second one — is left open for the person and shown as `verification_required`; nothing else is clicked meanwhile.
6. The existing download boundary: one export click, the download must begin on `rakuten-bank.co.jp` hosts, the file and
   manifest (job id, snapshot hash, period, label check) are retained, uploaded under the job's own snapshot and acknowledged only
   after OMF answered; a crash after the download recovers the same file without a second export.

## Saved login (plan `omf-rakuten-auto-login-20261021`)

The public login form was read on 2026-10-20 without a credential or a submission (hub `output/plan/omf-rakuten-auto-login-20261021/
LIVE-LOGIN-CONTRACT.json`, `LIVE-LOGIN-CONTROLS.json`): official origin `https://fes.rakuten-bank.co.jp`, surface `/XMS/security/RbS`
(START_CORP), form `LOGIN` posting to `…/LoginAuthentication/Login/CorpLogin.xhtml`, text field `LOGIN:USER_ID`, password field
`LOGIN:LOGIN_PASSWORD`, one visible anchor「ログイン」in that form (its generated JSF id is not used). `collector/banks/rakuten.mjs
STANDARD_LOGIN` records exactly this.

- **One-time setup.** In the downloader's local setup screen (`collector/setup.html`/`setup.js`) on the connected PC, the section
  "Bank logins" lists only the bank accounts OMF grants to this PC (`GET /api/finance-payments/collector/bank/accounts`: id, name,
  owner, provider, variant — no template, period, label or statement). For a 楽天銀行 標準 account the owner enters the login ID and
  password once and saves (`POST /bank/credentials`, protected connection required). It is sealed in the existing SplitStore as
  `rakuten-<bankAccountId>`, bound (AAD) to this installation, the paired OMF origin, the account's owner and the account; OMF holds
  only the wrapped key. The fields are cleared; the screen shows "saved" or "refused", never the values. Saving does not open the
  bank, queue a job or make a payment. Saving again replaces the login (and lifts a remembered refusal).
- **Use.** A claimed retrieve job frozen for 楽天銀行 standard carries a handle to that account's entry (`collector/index.mjs
  bankLoginFor`). Idle ticks, status, setup status, the observe stage, retained-file uploads and recovery never open it. When the
  bank shows its login page, the collector checks the exact form on the live document (origin and surface, the form and its
  action/method, both fields — visible, enabled, inside that form, unique by name — no other visible password field, exactly one
  「ログイン」control) and the earlier-attempt marker, decrypts the saved login once, then writes `login.json` before the action.
  Entry runs through the DevTools pipe in one page task that checks the original document/form and sets both field properties;
  it uses no later page-keyboard operation. The collector checks cancellation after the final form check, then revalidates and
  activates the intended「ログイン」node together inside its original document. A replacement document, including a fresh one on
  the same bank origin, receives no credential input or login action. Abort, pause, Windows lock and revocation retain their
  existing checks. The frozen statement/export/import steps are unchanged.
- **Outcomes.** Authenticated → the routine continues (step 2). The exact form again on a new document → the bank refused the saved
  login: it is remembered for that saved key (`bank-login/<entry>.json`, the key id and a time only) and no later job submits it
  until it is saved again; the person may sign in in the same window; at the deadline the job fails with "保存し直してから…". Any
  other page (additional verification, a password change, an unknown page or dialog) → `verification_required` with the same
  window shown; nothing is submitted again. A reclaimed job whose folder already holds `login.json` never submits again. A form
  that is not the recorded one, an unopenable or unbound saved login, or no saved login → the person signs in, exactly as before.
- **Key release** (`server/services/financeCollectorSecurityService.ts bankBinding`): `rakuten-<id>` is released only to a live
  grant of this installation/generation/origin/owner, for an owned BankAccount that is in the device's CURRENT bank scope
  (`FinanceCollector.bankAccountIds`, which the owner can add after a card-only pairing — no bank field in the grant, no new
  connection, no fake card) and still has a 楽天銀行 standard connection; repeated after the key I/O. A card id is never a bank id;
  removing the bank from the PC, changing the provider/variant, revoking the PC or a foreign owner stops the release. Card and
  service entries keep their bindings unchanged.

## Background and attention

`collector/browser.mjs browserFor(…, { background: true })` (bank retrievals only): stock Chrome with the same sandbox, pipe
transport, no debugging port and the same owned-process/profile checks, started with `--no-startup-window`; its page opens in an
inactive window placed off-screen (DevTools `Target.createTarget` background), so a retrieval does not take the foreground and the
system cursor is never moved (all input goes through DevTools). When the person is needed, `showWindow` moves that SAME window to
usable bounds on the primary work area and brings it forward; no second browser is started and no other window is touched. Card,
service, Yayoi and the observe stage keep the default visible launch.

## Caller map (self-mapped seam)

Owner native UI → bank connection/scope/sync (`financeBankCollectionService`) → collector `claimWork` → `runBankJob` →
`collectBankStatement` → `collectBankFromPage` → `ensureBankLogin` (+ `bankLoginFor` handle) → standard ui `loginForm`/`login` → frozen-period
native export → retained manifest/outbox → `bank/upload` → native rows → existing classifications. Setup: `setup.js` →
`/bank/credentials` → `saveBankLogin` → `SplitStore.save` → key service `putKey`/`getKey` → `binding`/`bankBinding`. Statement
source/amount/date/sign interpretation, classification, purchase imports, invoices, calendars and Navi are not changed. RIRI
Article/Memo/Menu51 paths are a separate project with no import or call into this seam.

## Not observed / not supported

口座管理プラス (`plus`), connections without a variant and unknown variants stay in the preparatory observe stage. Bank error pages,
OTP/verification pages, the bank's answer to a wrong password, password-expiry pages, session time-outs, maintenance notices and the
case where the bank re-uses an export generated earlier the same day are not observed; they surface as `unknown`/
`verification_required` for the person or as the existing failure messages. A persistent bank session and unattended additional
verification are not provided. No other bank is changed.

## Verification status (honest)

Every automatic-login leg is synthetic: a fake portal served by request interception in the collector's owned Chrome, fictional
logins, owned disposable databases. No real 楽天銀行 login has been saved or submitted by this software and no actual collector
retrieval has succeeded yet (the two actual jobs of 2026-10-20 ended at the login page). The owner's initial save and two actual
retrievals follow the reviewed deployment.

## OMF setup

In 支払い照合 → 銀行口座の接続・自動取得: add the bank account (or reuse the existing one), choose 楽天銀行 and 標準ログイン, leave the
template on 自動 (the native template is created), optionally enter the account label shown on the bank page, enter the period
start (end blank = the day of the job), save, allow the existing PC for this account, then 取得. The panel shows: implemented steps
(`取得手順 実装済み`) separately from the connection test (`未実施` / `成功` only when a retrieve job completed and its capture was
imported / `失敗` with the message), the allowed PCs, the requested period of each job, and each capture's date range and counts.
A capture with zero rows is flagged; a date range starting after the requested start is not proof that earlier rows are missing.

## Live-test checklist (owner, actual service — after review and the separate deployment approval)

- Deploy only the reviewed exact revision; keep the existing Shipment HTTPS 443 proxy; add the reviewed trusted Tailscale HTTPS
  8443 → 127.0.0.1:8080 proxy and set `OMF_COLLECTOR_PUBLIC_ORIGIN` to that exact origin. Do not weaken HTTPS/certificate/origin
  checks; this is not the customer-install/signing release.
- Stage the collector from the same revision with that origin; keep the old collector directory/keys; replace only the recorded
  owned process.
- Reuse the existing secure PC pairing and grant this bank account to that PC. Only a PC that is not connected needs the normal
  OMF connection flow. The owner enters the initial bank login only in the protected local setup; later retrievals use that saved
  login. No fake card or copied session/token is used.
- Connection: 楽天銀行 標準, native template, period 2025-11-01 → (current JST date). Open the downloader's setup screen on the
  connected PC and save the 楽天銀行 login once under "Bank logins" (the account must be allowed for the PC in OMF). Start the job:
  it must be `自動取得`, not 観察取得. The collector signs in with the saved login; complete any additional verification in the
  Chrome window it shows. Repeat a second retrieval and confirm no password was typed by a person.
- Verify: date read-back, the 楽天銀行フォーマット CSV (not Zengin), the warning accepted once, one completed download from
  `fes.rakuten-bank.co.jp`, the retained original and manifest, the upload/import receipt; reconcile the requested period with the
  file's first/last dates; compare each saved date/sign/amount/balance/raw row with the original; repeat delivery creates nothing.
- Then 銀行仕訳 (docs/bank-classification.md) with the company actually selected. Record actual counts and every limitation; keep
  unresolved rows visible. A draft made while another company was selected is moved with「この会社で仕訳する」; a mistaken link or a
  registration whose Transaction was deleted is released with「紐付けを解除」/「登録を解除」; an undetected own-company holder is
  remembered with「この支払先を自社口座として記憶」(it still needs the other bank's proof and an owner-chosen account).
