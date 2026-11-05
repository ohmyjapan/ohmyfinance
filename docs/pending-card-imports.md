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
A disappearance from a later snapshot is not proof of cancellation. The owner
resolves these holds on the forecast's draft page (`PUT
/api/finance/imports/:id/forecast`): *billed* pairs the forecast line (or a
group of identical forecast lines) with the chosen rows of one finalized
statement — the ledger then posts the statement's amount and uses its date in
place of an unchanged provisional date. A deliberately chosen accounting date
is preserved; the posting confirmation can explicitly keep the saved date or
select the confirmed date. This choice is captured with the reserved draft so
retries reuse it. The saved draft and originals are not rewritten. Payment
matching shows the confirmed values beside the forecast's, and the statement
rows become reference copies of the forecast; *closed* records that no bill is
expected — the forecast never posts and holds no other row, while a later exact
statement match still binds it and marks the record superseded; *reopen* undoes
either. Each decision is stored on the forecast import (`forecastResolutions`)
and the affected bindings are rebuilt in creation order; a decision is refused
when a ledger entry already sits on a row it would re-pair or release. A
statement settles a forecast line for every other statement, and a statement
whose coverage closed before the forecast's purchase date never holds it.
`scripts/finance-source-references-rebuild.ts` re-derives every binding of an
account from its full history (dry run by default). Closing is the owner's
decision; exact statement evidence outranks it.
Identical purchases can be paired one at a time from the draft page; the
remaining rows are verified as their own residual group, so a third purchase
does not disappear when two forecasts have been resolved.

Source correspondence versus an ordinary finalized expense: an Aplus statement
sometimes lists the same purchase (same card, purchase date, merchant, purchase
amount, currency and the billing month the forecast expected) as a row the
issuer keeps under individual review — a blank or adjusted お支払金額, parsed as
`statement_review`. The owner may pair the forecast with that row as *billed*
too; one shared eligibility rule decides it for the candidate the page offers,
the API and the bindings every reader verifies. Such a pairing records only the
source correspondence: the forecast keeps its original purchase amount, the
statement row keeps its original (blank or adjusted) payment field and its own
review reason, and the forecast's status stays *review* with the confirmed
source shown beside it. It is not finalized, not paid, not unpaid, not closed;
a blank payment field is never read as zero, and no credit is allocated from
monthly totals. The existing review hold keeps ledger posting, linking and an
approved or reserved retry blocked, exactly as before; the next step is the
individual confirmation of the payment field, not a posting. Reopen undoes the
pairing; cancellation (*closed*), grouped identical lines and retained evidence
work as above. Payment matching shows the confirmed source kind, the original
purchase and payment amounts and the review note beside the provisional values
and creates no allocation. Ordinary expense pairings, altered merchant/date/
amount choices, repeated purchases and Amex are unchanged.

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
