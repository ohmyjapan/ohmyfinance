# Company receipt candidate suggestions

The native `/api/receipts/:id/matches` read uses the existing selected-company/current membership check. The receipt and candidate transactions must have an explicit company assignment matching that company. Query/body company IDs do not choose ownership. Missing company or lost/inactive membership is403; foreign/unassigned/absent receipt is404. Invalid IDs are400. Current owner/admin/member/viewer roles retain reads. Existing read-method compatibility and response fields remain, with `scope: selected_company` and no-store.

Transaction's current write schema has no company field. This repair queries explicit persisted assignments only, using the actual company ObjectId; it does not add a schema field that unguarded writers could populate, infer assignments from merchant/amount/customer, convert string IDs or expose unassigned transactions. Native HTTP and Mongo profiling verify that the filter reaches the database and assigned-company controls work. Legacy unassigned transactions remain stored and unavailable as company candidates until ownership is resolved.

## Source map and compatibility (self-mapped, FOLD)

`ReceiptMatchDialog` -> native matches read -> new mandatory-company `findCompanyMatchesForReceipt` -> shared private query/ranking helper. Receipt is checked before transaction candidates are queried. Scoring, amount/date tolerance, sort, candidate limits, factors and result construction are extracted without algorithm changes. No external AI/model inference is added.

Legacy `autoMatchReceipts` -> old `findMatchesForReceipt` -> the same helper with its old global scope. A synthetic ambiguous-batch control confirms it still skips rather than assigning; **this legacy global behavior remains a known privacy gap**, not a passing company-security case. Its write algorithm is unchanged. Matching POST/DELETE, placeholder match, OCR/upload/files, transaction schema/writers, shared auth/calendar access and previous receipt read/export implementation are unchanged.

The dialog also fetches `/api/transactions` separately. Fixing candidate suggestions does not isolate that transaction list or the complete UI flow. No new Navi tool, ownership migration, company-audit/backup/PDF or operator/key/runtime protection is supplied. Full G1-G4 remain open.

## Verification and limits

Actual built HTTP runs against owned synthetic Mongo with explicit A/B/unassigned/string-company controls, same amounts/dates, scorer/factor controls, amount/date/attached exclusions, real query profiling, all member roles, foreign receipts, missing/removed/inactive membership, parallel company tokens, no-write snapshots and clean app restart. A forced internal query failure and deliberate defects check the new boundary. No customer/production data, provider/model/bank call or external send is used. Synthetic counts are not a reliability rate. Historical/production observation, independent exact-source guard review and final deployed replay remain pending.
