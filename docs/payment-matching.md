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
save the mapping. UTF-8 and Shift_JIS text are decoded by the existing intake reader. Ten fields include transaction date,
description, signed amount or separate outflow/inflow, balance, memo/reference, genuine bank transaction ID, currency and
direction. Outflow is positive; inflow is negative. Separate outflow/inflow columns take precedence over signed amount.
The raw original is retained by SHA256 under `OMF_DATA_DIR/bank-statements/<ownerId>/<hash>`; source sheet and physical row
positions survive blank rows. File size/row limits are the existing 10MB/5000-row limits. No bank format or portal connector
is claimed beyond successful column mapping of the supplied file.

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
