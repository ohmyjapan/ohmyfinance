# Manual transaction creation and recovery

The keyed API is implemented on the release-verification branch. The transaction form still uses the legacy unkeyed API; persistent browser drafts and integrated recovery are pending. This is not a deployment or a guarantee for existing form retries.

## Contract

Send `POST /api/transactions` with a randomly generated 32-character lowercase hexadecimal `Idempotency-Key`. Persist that key and the original payload before sending. Use the same pair after an uncertain result. A deliberately separate purchase gets another key even when its values match.

The authenticated user's currently selected company owns the key. Current owner/admin/member roles may create or retry. Any current company reader, including a viewer, can call `GET /api/transactions/creation/:key`. The original creator remains provenance; group members can recover the shared ledger entry.

| Result | Meaning | Client action |
|---|---|---|
| `state: saved`, `transactionId`, `transaction` | The entry exists; its current metadata is returned | Show that entry; corrections use its edit flow |
| `state: deleted`, `transactionId` | The original entry was deleted | Show that outcome; never recreate it using another key automatically |
| `state: absent` (GET only) | No matching row was observed at that instant | Keep the same intent/key; a first request may still be running |
| HTTP 409 | This key is bound to different original details | Reconcile the original intent; do not silently replace its key |
| Transport/database error or denied access | The outcome is not established by that failure | Retain the draft/key until authorized reconciliation is possible |

Both routes use fresh ledger membership checks. Recovery responses have `Cache-Control: no-store`. The key is an identifier, never an authorization credential. Internal identity hashes and creator fields are not included in the keyed API's public result.

## Payload version 1

Required: `date`, `amount`. Date-only values use UTC, as in the existing API; timestamps require an explicit timezone. Numeric strings normalize to finite numbers. Zero is retained. Missing/empty type and status default to `支出` and `pending`.

Optional text: referenceNumber, companyInfo, invoiceNumber, receiptNumber, trackingNumber, paymentMethod, cardNumber, productName, janCode, notes. Optional selection IDs: customerId, accountCategoryId, subAccountCategoryId, taxCategoryId, supplierId, transactionCategoryId, sourceId. Optional numbers: taxRate, productPrice. Null/empty optional scalar values mean omitted. Selection IDs normalize to lowercase. Existing catalog ownership validation remains a separate release blocker.

Items preserve order. Each item accepts productName, janCode, productUrl, quantity (default 1), unitPrice (required), taxCategoryId and taxRate. Tags preserve order. Missing/null items or tags become empty arrays. Object key order does not affect identity. Unknown fields, source metadata, evidence fields, lifecycle fields, caller IDs/timestamps and timeline events are rejected by the keyed contract.

The normalized purchase is both hashed and saved. Generated reference numbers, IDs, timestamps and creation events are excluded from the hash. Later edits do not change the original hash. Version 1 normalization must remain compatible with stored version 1 hashes in future releases.

## Storage and limits

A verified unique partial company/key index arbitrates concurrent inserts. Identity, purchase and one creation event are written in the same document, with `w: majority, j: true`. Journal acknowledgement follows [MongoDB's write-concern contract](https://www.mongodb.com/docs/manual/reference/write-concern/); hardware power-loss durability is not established by these tests. Only a collision on that company/key index is handled as a possible replay. Index failures never fall back to unprotected insertion.

Deletion retains keyed identities; older transaction archives do not overwrite current records. The reconciliation read is a current observation, not a lock against later edits/deletion. An entire database rollback to a time before creation, external writes that remove identities, or an operator dropping the index during insertion fall outside the guarantee.

Requests without a key keep the existing response shape and independent-create behavior for compatibility. The form, imports and recurring/card occurrence protocols are not migrated by this patch. Distinct legacy/import occurrences must not be deduplicated by amount or merchant.

Before release: integrate persistence-before-send and same-draft tab coordination in the actual light-theme form, test ordinary Chrome recovery across reload/session/company changes, complete independent guard review and the recorded broader reliability work, and resolve existing backup/company-boundary blockers. Concurrent edit versioning remains separate. No production migration or deployment is included here.
