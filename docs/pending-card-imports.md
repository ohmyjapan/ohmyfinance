# Unbilled card purchases

Card connections accepts `kind=pending` for Amex's recent-activity CSV and for
Aplus's rendered-page JSON capture. This status is explicit; historical imports
are not retroactively reclassified. Original bytes remain archived. JSON is served
as JSON, not described as a downloaded bank CSV.

Aplus captures must include every page, original displayed fields, normalized
rows, and a reconciled total. Both observed capture layouts are supported. Amex
recent activity uses processing-date coverage while preserving the purchase date.
Amex excludes entries marked 確定前 from the observed CSV download; authorization
holds and their adjustments are not imported by this CSV workflow.

Pending purchases can have drafts, purchase/inventory links and documents. They
count in the displayed mapping selection. Ledger posting and linking to an
existing ledger entry remain blocked until a finalized statement confirms them.
Approval of a mapping draft does not override this block.

Pending-to-statement reconciliation references the original complete group by
owner, account, provider, card, purchase date and exact merchant spelling.
Amounts, processing/foreign-currency fields, multiplicity and Aplus billing month
must agree. Two identical purchases remain two purchases; their individual bank
row identities are not invented. Differences and competing originals are held.
Unmatched incoming purchases are also checked against the remaining canonical
forecasts on the same card. A changed merchant, date, amount or billing month
creates a version-3 `pending_candidate` review reference, never an automatic
match. These incoming rows are archived and visible in source review but excluded
from purchase totals and posting; the original draft and evidence remain intact.
This can also hold genuinely new purchases when an older forecast is unresolved.
A disappearance from a later snapshot is not proof of cancellation. Resolving
these ambiguous holds is a separate source review; no automatic cancellation or
manual override endpoint is provided by this change.

Exact groups in the incoming file take precedence. Already confirmed forecasts
do not hold activity after their final statement period; revised or older
snapshots can still require review. When a forecast arrives after the actual,
the earlier statement must cover its processing date (or Aplus billing month).
Card suffixes and owners never cross-match. Non-purchase adjustments keep their
existing review treatment. Reconciliation reads the complete account history and
fails closed above 100 imports rather than silently ignoring older forecasts.

Drafts and downstream links retain their original import/line/hash. Finalized
files reference those rows. A byte-identical finalized Amex CSV records its
statement confirmation on the original import because the archive hash is unique
per account. Ledger entries keep the final source evidence in metadata.

This adds import and reconciliation support. It does not change the scheduled
collector's existing closed-statement selection.

Verification: `npm run test:finance`; build, then run
`OMF_TEST_PENDING_ONLY=1 node scripts/finance-integration.cjs` using the platform's
environment-variable syntax. The integration harness starts isolated MongoDB and
uses synthetic accounts. `OMF_TEST_CHROME_PORT` additionally checks the real Chrome
UI at mobile and desktop sizes without production login or business data.
