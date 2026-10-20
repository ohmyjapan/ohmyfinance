# 支払い照合

`/intake/payments` connects owner-scoped card/bank statement lines to the existing 購入受付 pool. The sidebar, intake record
and card-row editor open the same review component. Purchase, company and T-number evidence remain attached to each record;
one combined payment can show several sellers. A suggestion is never selected or confirmed automatically.

Order/external-order/item references, amount/currency, date and merchant explain each candidate. A reference plus equal
amount is strong. Amount alone is ambiguous. You can search all non-archived purchases and choose manually. Only the
explicit confirmation saves an allocation. Blank purchase totals remain unknown: item price, tax and fees are not summed
into a total. Split/combined payments and negative refunds are supported. Different payments can concurrently fund the
same purchase; derived totals expose overpayment for review. Per-payment revisions prevent conflicting confirmations.
Release and reconfirm keep the allocation ID, original snapshot and history. Changed/archived purchases remain visible.

## Bank files

Add a named account and currency, upload Excel/CSV, choose sheet/header row, assign columns, preview and confirm. Templates
save the mapping and amount-sign convention. UTF-8 and Shift_JIS text are decoded by the existing intake reader. Ten fields include transaction date,
description, signed amount or separate outflow/inflow, balance, memo/reference, genuine bank transaction ID, currency and
direction. Stored outflow is positive; inflow is negative. For a single amount column, choose whether withdrawals are
positive (`amountSign: 'outflow-positive'`, the default for existing callers/templates) or negative (`'outflow-negative'`).
A mapped 入金/in/credit or 出金/out/debit direction overrides the chosen sign convention. Separate positive outflow/inflow
columns take precedence over the single amount column. Preview labels each row 入金/出金 with its absolute amount; changing
the convention invalidates the preview. Templates restore the choice; another file/sheet starts from the default.
Unsupported amountSign values are rejected by a new validation guard on the owner import/template endpoints. No bank
convention is inferred. Reimporting the same source with another convention preserves identity and allocations, updates
amount and direction with revision/history, and marks existing allocations as source-changed for review.
The raw original is retained by SHA256 under `OMF_DATA_DIR/bank-statements/<ownerId>/<hash>`; source sheet and physical row
positions survive blank rows. File size/row limits are the existing 10MB/5000-row limits. No bank format or portal connector
is claimed beyond successful column mapping of the supplied file.

## Web-bank collection (two channels, one account)

A bank account can also be connected to a web bank: `PUT bank/accounts/:id/connection` takes a provider from
`BANK_PROVIDERS`, an owned template, the transaction-id confirmation when the template maps one, and an optional account
label. `POST bank/accounts/:id/sync` queues one job (`financebankjobs`) for a connected PC that was allowed the account
(`PUT bank/collectors/:id {bankAccountIds}`); without one it answers 409 `PC未接続`. The job freezes the interpretation at
queue time — template id and revision, headers, mapping, amount sign, transaction-id confirmation, parser version, currency,
provider, account label — as `snapshot` with its sha256 `snapshotHash`. Later template edits change only jobs queued after them.

Job kinds: `retrieve` for a provider whose `support` is `verified` or for a provider and frozen login variant listed in
`BANK_VARIANT_COLLECTION` (`bankCollectionMode`; today only 楽天銀行 `standard`, see “楽天銀行 標準 and native bank classification”
below). Every provider in `BANK_PROVIDERS` stays `contract-pending`, so every other provider/variant queues an `observe` job and says
so (`取得手順が未確認のため観察取得（準備）になります`). Job states: `queued` →
`running` (180 s lease renewed by heartbeats) → `verification_required` only while the person signs in → `complete` | `failed`.
An expired lease is re-claimed by any allowed PC and continues the SAME job and snapshot; it no longer blocks a new request.

The PC asks `bank/claim` only after no card job was claimed; an OMF without the bank routes answers 404 = no bank job. A
`retrieve` job opens the bank in its own ephemeral Chrome profile, waits for the person to sign in (the only human step),
opens the statements, selects the period, checks the shown account label against the connection, writes `attempt.json`,
clicks the export once and keeps the CSV only if the download began on the bank's hosts; a crash after the download recovers
the file from the bound attempt and recorded download without a second export. An `observe` job records the page contract
while the person navigates (pathnames, titles, control texts, input ids and types, select sizes, download events — never a
typed value, credential, cookie or row) and keeps one CSV the person exports from the bank's hosts. Manifests live under
`outbox/bank/<bankAccountId>/<jobId>` and carry the job's `jobId` and `snapshotHash`; they go to `bank/upload`, are
acknowledged only after OMF answered, and an unacknowledged one is drained on the next claim under ITS OWN job and snapshot.

Capture states on the statement (`financebankstatements.capture`): `imported` — new keys created, unchanged keys gain a
provenance entry — or `needs_review` with a reason: a header row that no longer matches the snapshot, a row that does not
normalize (`<row>行目: …`), or `interpretation-differs` when a keyed row already exists with other values; that row is never
updated by the collector. Identical bytes return the first capture unchanged. A wrong `snapshotHash` is 400. The owner's
explicit reimport from the importer's retained-file picker (`GET bank/files`) stays the only reinterpretation: revision+1,
`source-updated` history, allocations preserved and shown as source-changed for reconfirmation. Row provenance entries carry
`channel` (`upload` | `collector` | `collector-observe`), `jobId` and `snapshotHash`; the payment view shows them.

Limits: no bank is verified; no bank credential is stored or typed; no schedule; the observe stage is preparatory evidence
for writing a bank adapter, not retrieval. The staged downloader package carries `collector/bank.mjs`, `collector/banks/*.mjs`
and `shared/finance-payment-match.mjs`. The shared-guard coverage of the changed collector boundaries (`api()`/`upload()`/tick
dispatch, device bank scope, holds) is tabulated in `output/plan/omf-bank-collection-amended-20261018/6-build-post-reset.md`
(P2 coverage table).

### Login variant, recorded operations and the observation read (楽天銀行 preparation)

`PUT bank/accounts/:id/connection` also takes `variant`: a key of `BANK_LOGIN_VARIANTS[provider]` (楽天銀行: `standard`
標準ログイン（法人ビジネス口座）, `plus` 口座管理プラス). Any other value, or a provider without variants, is stored as `null` —
never a 400. The job snapshot freezes it (`snapshot.variant`, inside the hash: only jobs queued after this change carry the
new hash) and the adapter opens `starts[variant]`, the official login link of that variant, or its `start` page when there
is none.

The observe stage also records what the person does, as value-free metadata on each page record: `clicks[]` (`at`, `tag`,
`text` ≤40, `id` ≤100 of a clicked button / link / role=button / submit input; ≤60 per record) and `typedInto[]` (`at`,
`id` ≤100, `type` ≤30 of an edited field; one entry per field, ≤100 per record), with `eventsDropped` counting what exceeded
a bound. The events reach the collector at event time through a CDP binding on the page's own session (`Runtime.enable`,
then `Runtime.addBinding` under a random name; capture-phase listeners installed on every new document) — never through the
page snapshot — and are attached in arrival order to the record that was current when they arrived, so a click on an
unchanged page is kept, a click that navigates stays on its source page, and a click in the last interval before the export
or the tab close survives. The listeners never read a field's value; the collector keeps only the keys above
(`eventInput`); `bank/upload?kind=observation` drops anything else again (`observationInput`). If the binding cannot be
installed the pages are still recorded, without clicks. Enabling the Runtime domain on the observation session changes the
browser instrumentation from the library default; its compatibility with a real bank page is unverified until the first
owner-authorized observe run.

`GET bank/accounts/:id/jobs/:jobId/observation` returns the stored observation of an owned job (read-only; 404 for another
owner or an unknown job); the connection panel shows it under 観察記録を見る. It is the sanctioned input for writing a bank's
contract: `collector/banks/contract.mjs` `draftContract(observation)` turns it into the contract shape (login hosts and
inputs, authenticated control, statements path, period inputs, export control) that `validateContract` checks before any
page is touched and `contractUi` runs — open the variant's start page, wait for the person to sign in, click the recorded
path, read the portal's default period, check the account label, click the export once. Promotion of a bank is a reviewed
code release, never automatic: a person reads the draft, writes `contract` into the adapter, flips its `BANK_PROVIDERS`
entry to `verified`, the fixture replays the recorded path on a fake page, review, release. Until then every adapter keeps
`contract: null` and `sync` queues observe jobs. No bank is verified by this change; no real bank page, login variant or
CSV schema has been observed yet.

### りそな銀行 / 池田泉州銀行 — banks whose login runs on installed software (preparation)

Both banks run NTT DATA AnserBizSOL corporate banking. `BANK_PROVIDERS` gains `ikeda` 池田泉州銀行 (`contract-pending`, like every
provider: `sync` queues observe jobs only; `collector/banks/ikeda.mjs` keeps `contract: null`). `BANK_LOGIN_VARIANTS` gains both
banks' official entries, recorded 2026-10-19 by public GET with nothing submitted:

- りそな銀行 (`collector/banks/resona.mjs`, now the rakuten shape): `direct` ビジネスダイレクトへ直接ログイン →
  `https://www.b-direct.resonabank.co.jp/0010c/rblgi01/I1RBLGI01-S01.do`; `idlink` ID連携ログイン（りそなグループID） →
  `https://wb.resona-gr.co.jp/webservice/WSOI0101E100M.do?BK=0010&lin=b_direct` (the two links of the chooser
  `https://www.resonabank.co.jp/hojin/hojin_web/login.html`); `loginHosts` `www.b-direct.resonabank.co.jp`,
  `www.cc.b-direct.resonabank.co.jp` (the host the 電子証明書ログイン form posts to), `wb.resona-gr.co.jp`; `hosts` `resonabank.co.jp`,
  `resona-gr.co.jp` (widened so a CSV reached through the ID連携 path is retained — a tolerance, no new refusal). りそなWebサービス is
  a different product and not a variant.
- 池田泉州銀行 (`collector/banks/ikeda.mjs`): `start` `https://www.sihd-bk.jp/corporation/internetbanking/`; `portal`
  池田泉州ビジネスゲート（法人ポータル）からログイン → `https://www.0161.houjinportal.anser.ne.jp/`; `direct` インターネットEBに直接ログイン →
  `https://www.bizsol.anser.ne.jp/0161c/rblgi01/I1RBLGI01-S01.do` (the page offering 電子証明書ログイン and ID・パスワード);
  `loginHosts` `www.0161.houjinportal.anser.ne.jp`, `www.bizsol.anser.ne.jp`, `www.cc0161.bizsol.anser.ne.jp`; `hosts` `sihd-bk.jp`,
  `bizsol.anser.ne.jp`, `0161.houjinportal.anser.ne.jp` — not the personal-IB `parasol.anser.ne.jp` and not bare `anser.ne.jp`. An
  unknown or missing variant opens `start`, the public page, and the person navigates.

The "software installed on the browser" is each bank's 電子証明書発行アプリ, a Windows application that issues the client certificate
into the Windows user's certificate store; the `cc` login hosts request that certificate at the TLS handshake (the planner's
2026-10-19 TLS check saw "Acceptable client certificate CA names" on `www.cc0161.bizsol.anser.ne.jp` and
`www.cc.b-direct.resonabank.co.jp`, none on the ordinary hosts). 池田泉州銀行's FAQ requires the certificate login to run under the
same Windows user that issued the certificate (「電子証明書発行時のユーザアカウントでログインし直してください」), so the PC running the
collector must be signed in as that user. `BANK_SOFTWARE` (shown under the connection selects as `[data-bank-software]`) says this for
both banks and asks the owner to check, in the actual connection environment, whether the certificate picker appears and which
security software or extensions the contract needs; it promises neither.

Facts and sources (read 2026-10-19): りそな — ビジネスダイレクト offers ID/password and certificate login and recommends the certificate;
issuance and renewal on Chrome/Edge use the bank-provided application; the certificate is bound to the PC holding it
(`https://www.resonabank.co.jp/hojin/b_direct/security/syoumei_app.html`,
`https://www.resonabank.co.jp/hojin/b_direct/security/certificate.html`,
`https://www.resona-gr.co.jp/resonagr/b_direct/system_requirements.html` 動作環境). 池田泉州 — certificate issuance on Windows
Chrome/Edge uses the issuance application and the login needs the issuing Windows user
(`https://www.sihd-bk.jp/corporation/internetbanking/qa/10/`); the security page lists PhishWall Premium as an offered download and a
one-time password token (トランザクション認証トークン or ソフトトークン) as 「必須」 for インターネットEB
(`https://www.sihd-bk.jp/corporation/internetbanking/security/`; 動作環境 `https://www.sihd-bk.jp/corporation/internetbanking/requirements/`);
where PhishWall is used, its vendor requires both the installed client and its browser extension
(`https://www.securebrain.co.jp/products/phishwall/install_fc.html`). A read-only uninstall-entry search on the owner's PC found
池田泉州銀行電子証明書発行アプリ 19.0.0.1 (NTT DATA); it proves neither certificate issuance nor the absence of PhishWall or any other
protection — the owner's actual login mode, installed components and contract requirements are unknown.

Limits of this preparation: the shared launcher is unchanged — the collector's owned, ephemeral Chrome keeps `--disable-extensions`
(`collector/browser.mjs` `LAUNCH_ARGS`, pinned by `cloud-probe/test/probe.test.mjs` and `collector/test/browser-boundary.test.mjs`;
the Amex, Aplus, Yayoi and bank launches are identical). Whether that Chrome presents the Windows-store certificate at the `cc`
hosts, which protections the owner's contract requires or has installed, and where each portal's CSV download originates are
unverified until the owner's own observe run on each bank; an OTP prompt is never automated. If that run shows a required
extension or protection that the launch blocks, the change to the shared launcher is its own scoped design with the shared-browser
audit — bank protections are preserved, never disabled. No blanket extension exemption is granted and no claim is made about the
production bank population (unknown; zero historical bank cases tested; historical replay F3 open). Both providers stay
`contract-pending`. A wrong start link or host list shows in the observation: the person lands on the public page, or a download
from an unlisted host is recorded as `ダウンロード: host/filename` but not retained — inspect the observation and keep the original
bank file while diagnosing. Data written: `connection.provider = 'ikeda'`, `connection.variant` ∈ {`direct`, `idlink`, `portal`}
and the job snapshot's copy; no new field or collection.

A genuine bank transaction ID must be deliberately mapped and confirmed. Its identity is scoped to owner/account.
Without it the identity is file hash + sheet + original row, including two identical-looking rows in one file. Identical
bytes reimport without duplication. Different files remain distinct even if fingerprints match. A filtered/reordered
export or missing row never proves deletion/correction. Balance is evidence, not identity. Duplicate/correction candidates
stay for the owner to confirm or ignore.

Explicit confirmation records a correction edge with an atomic account revision comparison. This is a revisioned journal,
not a lease/lock. Account `corrections` is authoritative; row-state/history fields are projections that may lag if a process
stops between writes. Views resolve the journal, so neither side's anchor or allocation is deleted or moved. They resolve
to the chosen current row, with original allocation/request IDs, amounts, currencies and history preserved. Both already
allocated rows are supported; a merged over-allocation remains visible for release/review. Later saves use the canonical
anchor; historical source keys resolve as aliases. Concurrent correction edges compare the same account revision to avoid
cycles. No unattended duplicate/correction operation exists.

## Card repayment

Direct bank purchase, individual card purchase/refund and bank-to-card repayment are separate movements. Repayment is
never another expense. Amex uses the negative 前回分口座振替金額 row when amount and nearby date agree; choosing the covered
statement period is optional and explicitly manual. A suggested prior period is not preselected. Without repayment
evidence the owner chooses a statement and records a note. This feature provides no automatic Amex bill/calendar connector.
Aplus statement-total/calendar-bill evidence is read from its real source account and period. Aplus credit-review rows
are not automatically repayments. The bank view follows selected statement rows to their purchase allocations and T evidence.

Allocation amounts use payment currency. A different record currency requires manual selection; an optional owner-entered
`recordAmount` is stored with `recordCurrency`. Otherwise that allocation is excluded from record totals and listed separately.
A later change of record currency never reinterprets an earlier recordAmount. No FX rate is read, invented or applied.
Company/T-number candidates and stored values are labelled separately. Registry verification requires matching active
registry number and legal name; fictional test numbers and absent NTA settings are not presented as verified.

## Service/API contract for the Navi session

All calls require `financeUser`; collectors cannot act as users. Owner scope is resolved on source and target.

- `listPayments(ownerId, filters)` lists unique current card/bank payments and accounts.
- `paymentView(ownerId, 'card'|'bank', sourceId, line?)` returns payment, allocations, purchase/settlement candidates,
  reverse repayment links, source history, correction pairs and purchase/company/T evidence.
- `recordPaymentsView(ownerId, recordId)` returns totals, allocations across payments and candidate payments.
- `saveAllocation(ownerId, kind, sourceId, line, body)` requires `confirm:true`, a stable `requestId`, `paymentRevision`,
  target, amount and (for a purchase) `recordRevision`. Repeating a request ID returns the saved view. A409 requires reread.
- `releaseAllocation(ownerId, kind, sourceId, line, allocationId, body)` uses action release/reconfirm and current revisions.
- `supersedeBankRow(ownerId, newRowId, {supersedes:oldRowId, revision:newRowRevision, confirm:true})` confirms a relationship.

The route prefix is `/api/finance-payments/`. Payment endpoints are `payments/card/:importId/:line` and
`payments/bank/:rowId`, with `/allocations` POST and `/allocations/:id` PUT. `records/:recordId` is GET. Bank account/file/
sheet/preview/import/template routes are under `bank/`. Preview writes no financial records. Missing card source lines keep
saved allocations visible for release. The bank correction journal and both anchors survive source changes.

Only `financebankaccounts`, `financebankstatements`, `financebankrows`, `financebanktemplates`, `financepayments` and the bank
original-file directory are written. Intake, research, card imports, purchase/export graph, suppliers, financial accounts,
ledger and calendar payment status are not changed. No notification, payment, posting, FX, portal automation or Navi adapter
is part of this feature. New validation/rejection checks apply to owner review endpoints; no customer/seller path is changed.

## Verification and limits

Run fixtures only through OhMyCode: `node scripts/zoomer-verify.mjs --run-fixture omf-payment-match.mjs --cwd <worktree>`.
The verifier accepts the fixture basename. The fixture runs portable unit/Vue checks, a built app on its own ephemeral
MongoDB, mandatory hidden Chrome, ten deliberate defects and the released intake regression. Captured outputs establish
which checks actually ran; this document is not a passing-test receipt. The old real research-worker test still requires
an active configured subscription. A zero-row real-case export is REPLAY NOT RUN. Real customer exports, live NTA and
production performance require separate evidence. Independent review and deployment require separate owner orders.

### Account-label check record

Captured files retain `labelChecked`: true only when a retrieve manifest records the comparison and the frozen job has a nonblank account label. Blank labels, observation files and older manifests without this record show **口座照合 未確認** in the received-files list and importer picker. A matched label shows **口座照合 確認済み**. Recovery preserves the result written before the export; re-delivery keeps the first capture record. This is the collector's account-label comparison, not bank registration or T-number verification. No new rejection or import hold is added; the owner can review and map an unchecked file.

### Observation document identity and unavailable action capture

Actions retain a local document identity and a value-free snapshot taken at event time, including actions before the next polling record and before export/closure. The identity is not uploaded; the existing page-record fields are normalized in Node. No typed values are added. New records include `eventChannel:true/false`. If channel setup fails, useful page records are retained with `false`; the job and observation view show 「操作の記録なし（画面の記録は保存済み）」. Legacy/unrecognized channel values are stored as `null`, without a new rejection.

This correction does not verify a real bank portal or waive historical replay. Provider contracts remain pending.

## Monthly reconciliation reads (plan omf-monthly-reconciliation-20261020 F3, F2, F4)

**Card repayment rows (F3).** An Amex repayment row (`sourceKind: repayment`, 前回分口座振替金額) carries no allocation of its
own; its state in the list, the state filter and its detail now come from the linked bank `card-repayment` allocations that
target the same card account and key (`repaymentSettlement`, derived in the matching context after every other state, from the
bank payments that read holds). `settled` is their same-currency total in the row's sign and `remaining` = amount − settled:
未照合 with none, 一部配分 for part, 照合済み for all. 要確認 keeps precedence: a row whose source is missing, a settlement in
another currency, a changed or missing bank source, or settlements above the row amount. Released links count for nothing, so
releasing them returns the row to 未照合. The row's own `allocated` stays 0 and the allocation write path, its authority and
over-allocation checks are unchanged; purchase totals never include repayment settlements, so nothing is counted twice. A read
scope that removes bank payments before this derivation (the peer's card-scoped Navi read, F8) derives from what it can see.

**Purchases of a period (F2).** `GET /api/finance-payments/records?from=&to=&paymentState=&purchaseState=` (service
`listPurchaseRecords`, owner-scoped, read-only) lists the owner's purchases with the record totals the context already derives:
paid, refunded, net, remaining and the payment state 金額不明 (`unknown`, no total) / 未払い / 一部支払い / 支払済み / 過払い.
A valid 購入日 outside from/to is left out; a blank or unparseable one is always listed as 日付未確定 with its original text. Each
record appears once; archived and cancelled records stay, labelled; review facts (overpaid, another currency, identity review,
an allocation whose purchase or bank source changed) are flagged. Amounts are per record and currency, an unknown total stays
null (金額未確定), and nothing is summed — `counts` are numbers of records per payment state, `undated` the number of 日付未確定
rows. The payment-state and purchase-state filters are separate; a malformed date or state is 400. `records/:recordId` is
unchanged. `/intake/payments` shows this list under the 購入（期間内） tab with the same 開始/終了; the account filter applies to
payment rows only, because a purchase without a payment has no account yet. Each row links to the purchase and its originals.
No closing, posting, export, new collection or sidebar item.

**Navi on this page (F8 integration).** Navi receives the selected payment (a card's import and line, or a bank row without any
card) only while 明細 shows its detail. On 購入（期間内） a new message carries no payment selection, so it has no default card;
the page keeps the selected payment, and returning to 明細 shows its detail and selection again. Each sent message freezes the
selection it was sent with as its turn target: a later tab or row change does not retarget it, and a message waiting for retry
keeps the context captured when it was first sent. Closing the detail or leaving the page clears the selection. The
conversation, pending messages and history are not reset.

**Evidence labels (F4).** Purchase evidence in payment views carries `origin`, `origins`, `sourcesCurrent` and `differs`
(docs/intake.md). The label distinguishes 調査結果を確認して保存 from 取込・手入力の値（調査で未確認） and 調査候補（未保存）, per
field when they differ; when the research's citations no longer match the current URL or values they are kept and marked
調査時の根拠（現在の値と異なる）. `confirmed` still means a number is stored; `verified` is still only the registry equality.
Fold (review omf-monthly-patch-opus55-20261020 F4): that label and the month list's 調査後に変更あり appear only when `differs` is
not empty — a queued, failed or no-supplier research supports no values and shows neither. Evidence also carries
`registryBasis { asOf, purchaseDate, current }` (docs/intake.md); every registry label names its 基準日, and when the purchase
date no longer equals it `verified` is false, `differs` holds `purchaseDate` and the label reads 国税庁照合は基準日 X のもの
（現在の購入日 Y では未確認）, so a number registered after the new purchase date is never shown as verified for it. The value
origin stays as it was; the record page's 「もう一度調べる」 is the lane to a current check.

Verification: `node --test scripts/finance-payment-match.test.mjs`; through the hub
`node scripts/zoomer-verify.mjs --run-fixture omf-monthly-reconciliation.mjs --cwd <tree>`. Limits: synthetic data only; no real
month, purchase-service file, bank statement, certificate login or NTA configuration has been exercised (F5, F6), historical
replay is NOT RUN (F7) and the peer integration is not done (F8). No bank is verified by this change.

## 楽天銀行 標準 and native bank classification (plan omf-rakuten-native-shiwake-20261020)

**Retrieval.** `bankCollectionMode(provider, variant)` / `bankCapability` (shared/finance-payment-match.mjs) make 楽天銀行 `standard`
(標準ログイン・法人ビジネス口座) the one retrieving variant; `plus`, no variant and unknown variants keep the observe stage and the
provider table stays `contract-pending`. `capability.steps: implemented` is not a successful connection test (`liveVerified`
stays false); the connection panel shows the connection-test state from the latest retrieve job separately. A standard connection
needs no uploaded CSV: without a `templateId` the owner's native template `楽天銀行 標準フォーマット（自動）` (取引日・入出金(円)・
残高(円)・入出金先内容, outflow-negative, no transaction ID; `BANK_NATIVE_TEMPLATES`) is created once and reused (a same-named
template with other contents is a 409). The connection saves the requested period `coverage {from, to|null}` (validated: from
≥ 2000-01-01, nothing after today in JST, never reversed); each queued job freezes `snapshot.coverage {from, to}` (`to` null →
the JST date at queue time) inside its hash; a retrieve job without a period is a 400; jobs queued earlier keep their snapshot.
The collector resolves `adapterFor(snapshot.provider, snapshot.variant)` (collector/bank.mjs; the frozen job, never the current connection); a variant adapter refuses a job frozen for
another variant before any page. The flow, its observed facts and its live-test checklist: docs/rakuten-bank-connection.md.

**Classification (仕訳) is not payment allocation.** Allocation (above) links a bank or card payment to purchases and card bills and
never posts. The 銀行仕訳 tab (`/intake/payments`, `BankClassificationReview.vue`, `bank-classifications` routes) proposes and
records a company's accounting classification of each owner bank row and, only on the explicit「確認して取引へ登録」, creates one
native company Transaction (or links an existing one). It reads the selected company's calendar (fresh membership), never changes
an allocation, a calendar entry or a bank row. Details, guards and limits: docs/bank-classification.md.

Verification: `node --test collector/test/rakuten-standard.test.mjs scripts/finance-bank-classification.test.mjs
scripts/finance-payment-match.test.mjs`; through the hub `node scripts/zoomer-verify.mjs --run-fixture omf-rakuten-native-shiwake.mjs
--cwd <tree>` (fake START_CORP portal by request interception in owned Chrome, owned app and MongoDB). Limits: synthetic only — no
real bank page, login, OTP, export or owner OMF account has been exercised by these tests; the actual collector run and the live
仕訳 are the separate owner acceptance.
