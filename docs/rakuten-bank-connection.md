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

1. Opens START_CORP. The person signs in and enters any OTP in that Chrome window (`verification_required`, once). Nothing is
   typed or read from a credential field; the login page is recognised by a visible password field on the login host.
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

## Not observed / not supported

口座管理プラス (`plus`), connections without a variant and unknown variants stay in the preparatory observe stage. Bank error pages,
OTP/verification pages, session time-outs, maintenance notices and the case where the bank re-uses an export generated earlier the
same day are not observed; they surface as `unknown`/`verification_required` for the person or as the existing failure messages.
No other bank is changed.

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
- Owner signs in to OMF normally, uses the existing secure PC pairing and grants this bank account to the PC (no fake card, no
  token impersonation, no credential entry by software).
- Connection: 楽天銀行 標準, native template, period 2025-11-01 → (current JST date). Start the job: it must be `自動取得`, not
  観察取得. The owner signs in in the collector's Chrome.
- Verify: date read-back, the 楽天銀行フォーマット CSV (not Zengin), the warning accepted once, one completed download from
  `fes.rakuten-bank.co.jp`, the retained original and manifest, the upload/import receipt; reconcile the requested period with the
  file's first/last dates; compare each saved date/sign/amount/balance/raw row with the original; repeat delivery creates nothing.
- Then 銀行仕訳 (docs/bank-classification.md) with the company actually selected. Record actual counts and every limitation; keep
  unresolved rows visible. A draft made while another company was selected is moved with「この会社で仕訳する」; a mistaken link or a
  registration whose Transaction was deleted is released with「紐付けを解除」/「登録を解除」; an undetected own-company holder is
  remembered with「この支払先を自社口座として記憶」(it still needs the other bank's proof and an owner-chosen account).
