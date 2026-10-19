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

Job kinds: `retrieve` only for a provider whose `support` is `verified`. Every provider shipped so far is `contract-pending`,
so `sync` queues an `observe` job and says so (`取得手順が未確認のため観察取得（準備）になります`). Job states: `queued` →
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
