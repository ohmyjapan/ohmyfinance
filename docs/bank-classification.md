# Native bank classification (銀行仕訳)

Plan `omf-rakuten-native-shiwake-20261020` §4-§7. The 銀行仕訳 tab of 支払い照合 (`/intake/payments`) lets the owner classify each of
their bank rows for the selected company and, explicitly, register it as one native company Transaction. It is part of the
existing application (Vue component `components/intake/BankClassificationReview.vue`, routes `/api/finance-payments/bank-classifications`,
service `server/services/financeBankClassificationService.ts`, pure proposer `shared/finance-bank-classification.mjs`, model
`server/models/FinanceBankClassification.ts`). It is not payment allocation (docs/payment-matching.md) and not a separate report.

## Scope and authorization

- Every route needs the signed-in user (owner of the bank account and rows) AND a selected company whose active membership is read
  fresh at the request (`calendarCompany`; a still-valid token of a removed member is 403). Another owner's bank account is 404.
- Calendar entries are read with the shared company reader (`listCompanyCalendarEntries`): only that company's entries; suppressed
  entries are excluded by the reader, cancelled entries by the proposer; company-less entries never appear.
- History is the company's registered/linked bank classifications; teaching is the company's explicit payee decisions.
- One draft per owner bank row (unique owner + row): the company that first generates a draft owns that row's classification;
  other companies see the row as「別の会社」without its details and cannot generate, edit or register it.

## Proposals (pure, `proposeBankClassifications`)

Evidence only, in this precedence: (1) the company's own name as payee → 資金移動（自社口座間）, an unconfirmed transfer awaiting the
other bank's proof, never an expense; (2) explicit bank text — 手数料/年会費 (outgoing) → 支払手数料, 利息 (incoming) → 受取利息; (3) an
explicit teaching for the exact normalized payee and direction; (4) consistent history for the exact payee and direction
(conflicting history stays 要確認); (5) a calendar entry with the same currency, exact amount and matching direction (expense ↔
outgoing, income ↔ incoming) within 7 calendar days of the due date and one-to-one in both directions proposes its title as the
purpose for review only (要確認・支払先未確認): a calendar category is a planning label, never an account, and an equal amount/date is
not a verified payee, so the owner chooses the account. Two rows for one entry (a reused or
recurring entry), two entries for one row, a sum of two entries (combined) or a due date 8-45 days away (late) are candidates
only (要確認). A calendar category that disagrees with the text/history purpose is flagged. Accounts come only from explicit bank
text (支払手数料 / 受取利息 matched by exact chart name), teaching and history; nothing is fabricated (no chart match → 勘定科目 未設定 and
要確認). The debit/credit preview names the owner's actual bank account on the bank side (普通預金（<口座名>） when the chart has 普通預金,
else <口座名>（勘定科目 未設定））. A personal name alone never yields salary or
an expense. Tax treatment and T numbers are never inferred from names, bank text or calendar labels (tax `unknown`, T
`unverified`; an owner-entered T number stays `entered-unverified`). Payee normalization strips transfer prefixes, payer-reference
suffix（依頼人… with 振込予定日/管理番号, to the end), the destination "<bank> <branch> <type> <number>" before the holder, legal-entity marks
and long-vowel marks, joins spaced dakuten and folds width and small kana (the observed native syntax). Card membership fee
wording (カード…会費) is a card fee; another membership fee is not. Missing history and
months without rows are shown.

## Drafts, corrections and teaching

「提案を作成・更新」creates drafts idempotently (concurrent generation creates one per row) with a durable reserved Transaction ID.
Refresh updates the proposal; it replaces the values only of untouched drafts and never of manual or registered ones. A
correction (`PUT …/:id`) needs the current revision (409 otherwise), validates every reference against the existing chart / tax
categories / suppliers, and records before/after in the draft history. If the bank row changed (a new revision or fingerprint)
the draft shows it and a correction must acknowledge it (`acceptSource`); a changed source is never registered. 「この支払先の仕訳
として記憶」stores an approved exact payee decision (edited or registered drafts only) for the company; a transfer is remembered
as the own-company marker.

## Registration (`POST …/:id/register`)

Only with `confirm: true`, the current revision, a purpose, an existing account, a current non-superseded source, a reviewed
transfer (if any) and JPY. A row that replaced (explicit correction edge in `BankAccount.corrections`, the authority) a row already
registered or linked in any company is refused (`predecessor-registered`): one native effect per source the owner merged. When the company already has a Transaction with the same amount, direction and a date within 7 days
(not itself a bank registration, not linked to another row), creating a new one needs an explicit `confirmNew`; otherwise the
owner links it (`action: link`), which records the link on the draft and leaves that Transaction unchanged; one Transaction links
to one row. Creation persists the reservation (values, payload, source) first, then upserts the Transaction keyed on the reserved
ID, the company and the draft, then marks it registered. A retry returns the same ID (`replayed`), concurrent requests produce one
Transaction, a crash before or after the insert resumes the same effect, and a foreign record at the reserved ID is never
overwritten (409). The Transaction carries `metadata.bankClassificationId`, the bank row/account/revision/fingerprint/source
hashes, the purpose, the evidence labels, `taxStatus` and `invoiceNumberStatus`, and a `bank-classification` timeline entry; it is
read back on the native transaction page. Reads and generation never post a Transaction or change a calendar entry.

## Limits

A registered classification is not an NTA registry check, an invoice receipt, a bank transfer or an external ledger posting.
Unresolved rows stay visible. A company cannot take over a row another company already drafted (no release action yet). The
tests are synthetic (owned app and MongoDB, fictional rows, companies and calendar); the owner's actual rows and calendar are the
separate live acceptance.

Verification: `node --test scripts/finance-bank-classification.test.mjs`; through the hub
`node scripts/zoomer-verify.mjs --run-fixture omf-rakuten-native-shiwake.mjs --cwd <tree>` (leg I runs
`scripts/finance-bank-classification-integration.cjs`, mutants M7-M16).
