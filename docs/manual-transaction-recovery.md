# Manual transaction creation and recovery

The keyed API and persistent transaction-form drafts are implemented on the release-verification branch. This is not a production deployment. Browser acceptance and release evidence are recorded separately from this contract.

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

Requests without a key keep the existing response shape and independent-create behavior for compatibility. The manual transaction form now uses the keyed protocol. Imports and recurring/card occurrence protocols retain their own identities. Distinct legacy/import occurrences must not be deduplicated by amount or merchant.

## Browser continuation

Opening a new form writes a blank identity to IndexedDB and puts its key in the page URL. A duplicated tab carrying that URL resumes the same identity for the same user and company. Opening a deliberately new purchase creates a separate key even when its details match another entry.

Save freezes the submitted details in one readwrite IndexedDB transaction. The request starts only after the transaction completes; a successful individual storage request is insufficient. Browser tabs serialize updates to the same stored record. A pending or confirmed draft cannot replace its original body or rotate its key. Retrying a pending form sends its exact frozen body. A definite validation rejection allows correction using the same identity and retains earlier payloads; stale rejection callbacks cannot downgrade a newer attempt or a terminal result.

Reload or the recovery panel checks the authenticated creation lookup. A confirmed result updates the ledger display; a deleted result never triggers recreation. Absence retains the original intent and makes no claim that an earlier request cannot finish. Automatic recovery performs reads only. A user-initiated retry sends the pending original intent; a previously confirmed record uses a lookup instead of another POST.

Confirmed recovery also reloads the complete company list, because reconciliation can supersede its initial load. Failure of that refresh retains already-confirmed rows and displays the read error. A company/session change still discards both old reads.

Draft records belong to a browser user/company pair. Logout, company change and disposal invalidate pending UI continuations. A late response may settle its original local record but cannot populate the new workspace. Viewers can check saved results; only current writers can open or retry forms. The server still checks current group membership. Local partitioning is not encryption or protection from someone with access to the browser profile.

If storage fails before sending, no purchase is sent. If storage fails after the server confirms its result, the confirmed result stays confirmed and the recovery warning remains visible. Terminal records remain locally so older tabs can recover the same identity. Clearing browser storage, another device/profile, origin changes, quota eviction and operating-system/power-loss recovery are outside this implementation's guarantees. Typed text before the first Save is not autosaved. There is no cleanup/retention policy for stored drafts yet.

A definitely rejected draft may be discarded. Discard checks the stored rejected state and the revision the user saw inside the same readwrite transaction; a newer correction is preserved. The discarded marker, original payload and history remain locally. An older tab cannot freeze or send that discarded intent, and reopening it reports the discard and closes its form. A late rejection cannot revive it. Authoritative saved/deleted results still take precedence. Pending, saved and deleted records cannot be discarded through this action.

Absent and failed recovery checks leave the company-list read running. Confirmed recovery still refills the full list. Both expense/income buttons obey the existing form lock. Ordinary initial and corrected saves do not show a recovery confirmation notice; checks and retries of uncertain outcomes still do. Storage failures remain blocking before a send, with separate guidance for a new draft, a failed attempt to send, and a previously confirmed result. There is no memory-only fallback.

Known remaining display race: the older shared save helper cancels an in-flight initial list read and remembers only the newly saved row. A retry started before that list completes can therefore leave an incomplete list/totals. The recovery entry fix does not repair that separate save path; it remains a release blocker pending its own scoped repair.

New persistence-before-send, original-body, terminal-outcome and stale-context/revision guards require independent review. Before release, complete that review and the recorded broader reliability work, and resolve existing backup/company-boundary blockers. Concurrent edit versioning remains separate. No production migration or deployment is included here.
