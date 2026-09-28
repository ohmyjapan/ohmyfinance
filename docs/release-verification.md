# Capture and workflow release verification

`scripts/zoomer-fixtures/finance-capture-workflow.mjs` adapts the existing
capture/workflow tests to OhMyCode's project fixture convention. It exports the
standard name, explicit source coverage and run result; no hub gate changes are
required.

The fixture runs nineteen Node test suites, including assistant page selection,
purchase investigation evidence, upload/API error handling and CSV module
compatibility and unsupported-provider behavior, builds the current Nuxt
source, then runs `scripts/finance-integration.cjs` with only
`OMF_TEST_WORKFLOW_ONLY=1` and `scripts/auth-integration.cjs` without its optional
browser flag. It then selects `OMF_TEST_RECEIPTS_ONLY=1` for a separate disposable
receipt-management replay covering creation in a selected organization, provenance,
metadata editing, concurrent requests, deletion, upload and original-file retention.
Finally `OMF_TEST_PROXY_ONLY=1` verifies explicit 501 responses, authentication,
concurrent requests/retries, ledger preservation and unaffected finance routes.
The legacy proxy names remain available for errors only: they have no real
provider adapters and must not fabricate payment success or forward credentials.
`OMF_TEST_SHIPMENT_STATUS_ONLY=1` then verifies status/history persistence across
organizations, immediate retries, concurrency, and unchanged linked purchases.
Shipment service tests use a disposable MongoDB and inject a lost response after
a durable write, reconnect and retry. The legacy shipping pages still use mock
data and are not covered by this endpoint repair.
`OMF_TEST_TRANSACTION_STATUS_ONLY=1` compares the dedicated status endpoint with
the active transaction edit service, checks persisted labels/history and verifies
that protected card fields and other transactions are unchanged. `refunded` is a
bookkeeping status only; it does not call a payment provider or alter the amount.
Status edits retain the existing transaction API's access policy. Ledger ownership
and receipt attachment persistence are separate pending work.
`OMF_TEST_RECEIPT_CANDIDATES_ONLY=1` exercises persisted candidate ranking,
receipt group membership, repeated reads and automatic no-write decisions for weak or
ambiguous evidence. Scores use actual merchant/statement text, JPY calendar dates,
amount and recorded currency. They are rule scores, not calibrated probabilities.
The service considers the entire date/amount window before returning ten results;
existing receipt claims on either side exclude a candidate. Exact positive amount,
known matching currency, exact normalized merchant/statement text, an expense and
a date within three days are required for automatic consideration. This does not
make the separate attachment writer safe or settle ledger ownership.
Scoring tests cover Japanese/full-width names, missing or conflicting evidence,
currency mismatches, competing candidates, cursor failure and reconnect. The dialog
tests compile its actual script and render its template, verify authentication,
and prevent price-only preselection or high-confidence badges. Icons are stubbed;
this is not a browser visual review. The manual confirmation path remains separate.
The same compiled dialog harness also consumes the actual built transaction and
suggestion HTTP responses. This checks the `{ transactions, total }` list envelope;
an array-shaped test stub previously hid a real empty-dialog failure.
`OMF_TEST_GROUP_SWITCH_ONLY=1` runs the real session store and compiled organization
settings page against the built HTTP API. It checks group selection, default
selection, persistence after reload/refresh, all four existing membership roles,
denied and inactive groups, and membership removal during the token/profile
handshake. Separate store/page tests exercise late responses, competing selections,
logout/new login, screen locks and cross-tab cache resets. Existing authentication
regressions share the same extracted store harness. Group-scoped receipt and core transaction APIs are covered below; other direct
ledger readers/writers remain pending. Browser visual review,
localStorage quota/crash recovery and production observation of the new behavior
remain outside this fixture; these checks do not establish a production reliability
rate or replace independent review of the new response/race guards.
`OMF_TEST_RECEIPT_GROUPS_ONLY=1` exercises current company membership on the
persisted receipt routes. Owner/admin/member writes and viewer reads use the
current membership, including after demotion/removal with an older token.
List/detail/stats/export/upload and metadata edits use organization predicates;
uploadedBy remains provenance. Suggestions, manual match/unmatch lookups and the
transaction-backed receipt HTML preview exclude foreign and unassigned transactions.
Group identifiers cannot be assigned through receipt metadata. Unit tests include
membership database failure, concurrent edits/deletion and reconnect.
This is a partial access conversion: attachments, card posting, backup/restore
and other direct readers/writers remain pending. Core transaction routes now use
company context as described below. Existing records need
a reviewed migration. The legacy simulated matcher/OCR and canonical recoverable
attachment writer also remain release blockers. A passing receipt boundary test
does not establish whole-ledger isolation or a working original-file download.
The authentication suite checks registration, access tokens, 2FA,
trusted devices, backup codes, PIN/password renewal, restart recovery, invitations
and logout. Each integration creates its own disposable MongoDB. The workflow
integration also uses private temporary evidence storage and an app listening on
an available loopback port.
It injects the document and purchase adapters. Ambient optional browser and test
switches are removed. No actual bank, spreadsheet or export session is used.

A failed command, missing test summary, fewer than the existing 136 unit/service/component tests,
18 workflow checks, 10 authentication checks, 11 receipt management checks or
6 proxy checks, 8 shipment status checks, 7 transaction status checks or
8 receipt candidate checks, 10 group switch checks, 11 receipt group checks, 12 transaction group checks, or skipped unit test is a
verification failure. Counts only confirm that the intended suites executed;
their assertions supply the evidence.
The verifier owns the 15-minute fixture timeout and process-tree cleanup. A fresh
build is mandatory before integration; existing `.output` files are not accepted
as evidence of the current source.

This fixture does not replace the root TypeScript check, authorize a deployment,
or reset production workflows. Record fail-first evidence and run the normal
exact-commit verifier before release. The existing TypeScript failures must be
resolved separately; a passing behavioral fixture alone does not make the release
deployable.


`OMF_TEST_TRANSACTION_GROUPS_ONLY=1` exercises selected-company CRUD, status,
list/filter/stats/export, mixed-ID bulk actions, duplicate management, manual JSON
import and bank-statement preview/save. Owner/member/viewer sessions and stale-role
tokens use current membership. Viewers retain preview and POST bulk export access.
Company assignment is server-owned and immutable on the transaction model; legacy
unassigned records are excluded. Duplicate merge excludes its kept ID and counts
actual deletions. Imports compare duplicates only within the company. OFX saving
uses referenceNumber, companyInfo and Japanese transaction types. The integration
uses real tokens and a freshly built API, with two nonempty companies and unassigned
history. Unit/service cases include reconnect, concurrent edits/deletion and mapped
import preserving protected card source values.

Exclusions: shared supplier/customer/category catalogs have no company model yet.
CSV/generated OFX/QIF references and concurrent imports are not proven idempotent.
The old duplicate classifier compares missing legacy fields; append-note and bulk
source updates still need canonical-field repairs. Duplicate merge is not crash
atomic and delete/merge do not yet reconcile receipt attachments. These remain
release work; this suite does not prove whole-ledger isolation or production
reliability. No production records were assigned a company or migrated.
