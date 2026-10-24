# Purchase evidence on the bank 仕訳 (Phase C, B1)

Plan omf-workflow-daily-20261025 Phase C. Before this, a purchase the owner had uploaded, researched, confirmed and allocated to a bank
payment never reached the bank 仕訳 review or the registered Transaction (WORKFLOW-BLOCKERS B1). Matching was not classification.

## What the owner sees

On 支払の照合 → 銀行明細の仕訳, every row that the owner allocated to purchases (支払の照合) shows a 紐付けた購入 block:

- each linked purchase: purchase or refund, allocated amount and currency, 注文 / 明細 / 外部注文番号, 購入日, 購入金額 (不明 when the file had none —
  never 0), and a link to the purchase;
- its company and T number with what they rest on, taken from the purchase's existing evidence (`intakeEvidence` and `registryBasis`):
  国税庁の公表情報で確認済み（購入日 … 時点）only for a research-confirmed seller whose NTA row matches number and legal name as of the
  purchase's own date; otherwise 未検証 / 候補 / 購入日と異なる日 / 購入日なし, said plainly;
- card repayments / statement payments matched to the row (カードの返済として照合 — not a purchase expense);
- 紐付けた購入はありません for every other row.

The values come from the canonical payment projection (`financePaymentMatchService.bankPurchaseLinks`: correction edges, allocation change
flags, totals across every payment, the record's evidence). Nothing is recomputed in the classification service or the browser.

## Optional explicit adoption

「購入の会社名・T番号を使う」 (with its confirmation box) appears only when the server finds exactly one suitable purchase for the row:
one linked purchase, no card settlement link, an outgoing payment fully covered by that allocation, the purchase fully paid by it alone
(known total, no split/combined/refund), same currency, unchanged since allocation, an ordinary purchase, a research-confirmed seller whose
NTA row matches number and legal name, a `T`+13 digit number, and that registry check as of the purchase's valid 購入日 (not the bank date,
not the research day of an undated purchase). Otherwise the block says why (`PURCHASE_ADOPTION_LABELS`). This is a guard on that
convenience action only: the existing manual edit and registration are unchanged and never require it.

The browser names only what it saw (allocation, purchase, purchase revision). The server resolves the evidence again and, at the draft's
expected revision, stores the T number in the draft and an `adoption` record with a `purchase-adopted` history event: allocation, payment
anchor, purchase identity/revision/IDs, research identity/revision/confirmation time, legal name, number, purchase date, the registry row
(number, legal name, as-of date, active, check time, source id/hash), the purchase file hashes and the bank row revision. A Supplier is set
only when the owner chose none and exactly one already-stored Supplier has that number and the same legal name; no Supplier is ever created,
and no tax category is inferred. Nothing is posted.

## Staying truthful afterwards

The adoption's standing is derived on every read (`purchaseAdoptionState`). It stays 確認済み only while the same allocation still links the
same purchase revision and research revision, the purchase is still suitable with the same number/name/date, the bank row is the one
adopted from, the draft still holds that number and the selected Supplier (if any) does not carry another number. Otherwise the T number
shows 購入の根拠が変わったため未検証 with the reasons. A hand-changed T number or Supplier ends the adoption (kept in the history entry).
Moving an unregistered draft to another company archives it with the earlier company's values.

## Registration

At 「確認して取引へ登録」 the reservation freezes `registration.purchase`: every linked purchase (identity, revisions, IDs, file hashes,
research, registry basis/row, verification), the card settlement links, and the adoption with its standing (`current` / `stale` and the
reasons). The created Transaction carries the same in `metadata.purchaseLinks`, `metadata.settlementLinks` and
`metadata.purchaseEvidence`; `metadata.invoiceNumberStatus` is `purchase-registry-verified` only for a current adoption of that very number,
otherwise the existing `entered-unverified` / `none`. A retry, crash or concurrent request resumes those frozen bytes (the existing
exactly-once reservation); a later refresh never rewrites them. Releasing a registration keeps the frozen record in the draft history.
Bank teaching still stores only purpose, account, sub-account and Supplier: a verified number never reaches unrelated later purchases.

If the purchase projection cannot be read, the rows say so and registration proceeds as before (`purchaseEvidenceAvailable: false`).

## Not covered here (pending, not waived)

- The owner's selected real purchase file and month, and the protected NTA application-ID setup of the connected research worker
  (production reports `ntaConfigured=false`; real purchase pool 0). Every result above is from fictional data with clearly synthetic,
  official-shaped NTA responses; no NTA request was made.
- Cost components missing from a file stay blank; the all-in 購入金額 is never summed from them.
- Concurrency: adoption and registration are separate compare-and-set writes on the draft; the allocation, purchase and research are other
  documents. There is no cross-document atomic guarantee: an adoption read just before a change is shown stale on the next read, and a
  registration freezes the standing it read.

Tests: `scripts/finance-bank-classification.test.mjs` (pure rules) and the fixture `scripts/zoomer-fixtures/omf-purchase-workflow.mjs`
(routes, owned MongoDB, built-app Chrome, existing suites, mutants).
