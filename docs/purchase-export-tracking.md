# Purchase-to-export tracking

A card purchase remains one payment. Its saved order contains item lines and
individual inventory IDs. Export shipments are separate records: one order can
leave in several shipments, and one shipment can contain units from several
orders. Allocations bind a saved purchase, its item identity and one inventory ID
with quantity one. This matches the current inventory sheet's one-ID-per-unit
layout; unidentified quantities stay pending.

The purchase panel shows exported / purchased quantities, shipment references,
invoice and export-permit downloads, and documented returns/cancellations.
Purchase cost and customer-submitted declared value are independent. Saving
export evidence does not change draft values, tax treatment, transactions or
posting status. Evidence can be added after a payment has been posted.

## Completion

An allocated unit counts as exported only while its active shipment has separately
retained invoice and export-permit PDFs, a permit number/date and explicit owner
confirmation of document identity and the selected inventory. Merely attaching a
file does not confirm the shipment. The server checks saved file sizes and hashes
when reading progress and downloading originals. Purchase-level completion also
requires the retained purchase originals and matching order/payment totals.
Shipment allocation cannot exceed its declared item quantity. Unallocated units
in a shared shipment do not credit any purchase.

All units exported gives `complete`. Documented returned/cancelled units can give
`resolved`, which is visibly different and is not an export or an accounting
refund. Missing IDs, missing documents, unavailable originals and allocation
conflicts never finish a purchase. Completion is calculated from saved evidence,
not a manually set flag or the ledger's transaction status.

## Storage and changes

`FinanceExport` owns shipment metadata, customer-declared JPY value, allocations,
document descriptors, verification and revision history. `FinanceUnitOutcome`
stores documented exceptions. Item keys bind the purchase archive, item line,
product, color and size. An owner-scoped lease coordinates purchase edits with
export/outcome changes. Unique indexes and the lease prevent two active exports
from consuming the same inventory ID. Source purchases cannot be detached or
change allocated item identity until their downstream allocations are released.

Existing shipping attachments can be selected; PDF uploads directly in the
export panel also work on posted purchases. Both are copied to durable
`OMF_DATA_DIR/export-documents/<owner>/<sha256>` storage. The normal default is
`~/.ohmyfinance/export-documents`. `FinanceExportUpload` indexes uploaded sources.
Documents are stored once by owner and hash and remain available through the
owner-authorized routes after corrections or release. Replaced documents remain
in record history. Include these collections and this directory in backups.

`/api/finance-exports/purchases/:purchaseId` reads progress. The same route's
`/documents` endpoint uploads PDFs and `/outcomes` records reviewed exceptions.
`/lookup` finds an existing Intras account/order; `/save` creates or updates a
shipment using its revision. Shipment updates include its full allocation list;
the page preserves allocations from other purchases when adding current items.
Release explicitly affects every allocation in that shipment. Released shipments
can be looked up and reactivated with fresh selections and document confirmation.
No Intras login/download or supplier tax verification is initiated by these APIs.

Validation: `node --test scripts/finance-export.test.mjs`; build the application,
then run `OMF_TEST_EXPORT_ONLY=1 node scripts/finance-integration.cjs`. Add
`OMF_TEST_EXPORT_BROWSER=1` for real Chrome desktop/mobile form checks. Tests use
an isolated database and storage, including concurrency, ownership, shared/split
shipments, stale revisions, posted payments, returns, corruption and retained
originals. The purchase-connection integration suite covers the existing flow.
