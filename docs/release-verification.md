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
This is a partial access conversion: attachments, backup/restore
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

A failed command, missing test summary, fewer than the existing 145 unit/service/component tests,
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


`OMF_TEST_CARD_GROUPS_ONLY=1` adds 8 real-token API checks (including the two
shared setup checks) for immutable account/import/entry company, source history,
legacy candidates, posting, collector upload, demotion/removal and same-owner
cross-company exclusion. Ledger records remain available to company members;
connection credentials retain owner restrictions. Finance account/import routes
require the selected company. Other finance workspace API families remain pending
conversion; this is not complete member sharing of the mapping workspace.

Nine card service tests exercise independent companies, forged draft ownership,
source conflicts, duplicate/concurrent retries, an injected failure after ledger
insertion followed by database reconnect, source-reference mismatch and incomplete
legacy history. Timestamps may advance on a resumed upsert; accounting fields,
source identity and company remain intact. The shared membership implementation
also serves background card identities and retains its existing receipt tests.

The fixture additionally executes 8 pending, 7 source-overlap and 5 Aplus API
checks against the same freshly built source, each in its own disposable database.
These verify that the company conversion preserves forecast/final reconciliation
and draft evidence. They include two shared setup checks per suite. No live bank
request, production migration or accounting reclassification occurs. Missing or
mismatched source companies require reviewed assignment; nothing is swept into a
company based only on the current login.

`OMF_TEST_RECURRING_GROUPS_ONLY=1` adds 8 checks including two shared setup
checks. Real tokens verify company scope on recurring CRUD, totals, upcoming and
batch processing; current database roles override stale token roles. The compiled
recurring page calls the freshly built API with its displayed due date. That date
identifies the occurrence even after a lost response. Sixteen service/page tests
also cover durable reservations, concurrent generation, failures before/after the
ledger write and before schedule advancement, reconnect, protected accounting
edits, foreign target IDs, missing posted entries and calendar boundaries.

Each recurring occurrence reserves its ledger ID and payload atomically in the
payment document before insertion. Schedule advancement follows insertion and is
conditional on that occurrence. Editing/deleting a reserved payment returns 409
until generation resumes. Posted history is retained; missing or conflicting ledger
targets require review. Only JPY templates can generate into the current JPY ledger.
This generates accounting entries; it neither charges cards nor verifies payment.

Exclusions: shipment writes remain pending; no nightly recurring scheduler exists.
Recurring entries versus eventual card statements still need explicit reconciliation.
These tests prove per-occurrence retries, not deduplication across different import
sources. Legacy recurring company assignments require review. Public APIs omit the
internal snapshots; the embedded history is not yet archived. Currency display and
mixed-currency totals on the existing recurring page remain separate work. No real
browser visual check, historical production corpus, full process-kill matrix or
live exposure is claimed. No production migration or deployment occurs here.

`OMF_TEST_SHIPMENT_GROUPS_ONLY=1` adds 8 API checks, including 2 common setup
checks, for shipment CRUD, company-scoped purchase links, current roles and tracking
replay. The actual Pinia store runs against the freshly built API. Fourteen new
service/store tests cover split shipments, full-set link validation, corrupted old
references, concurrent changes, a failure after a durable link write followed by
reconnect, optimistic edits, tracking request identity and store request/response
contracts. The seven existing shipment-status tests remain active.

Shipment.transactionIds is the relationship authority. Shipment operations do not
write the unsupported Transaction.shipment field or change ledger timestamps,
history, source evidence or accounting. The same purchase can link to multiple
shipments. Public shipment responses include only same-company transaction IDs and
records; unlink can remove dangling/foreign references from the owned shipment.
Tracking POST requests require a stable requestId; retries preserve newer status,
and reusing an ID with different event details returns 409. The store retains the
request ID on the event object for retries and uses getRandomValues on HTTP origins.

Limits: the shipment pages still generate mock data and are the next UI repair.
This generic shipment API is not the Finance export-document workflow. Creation
POST itself has no idempotency key; tracking/link retry evidence does not establish
idempotent shipment creation. Concurrent ledger deletion can leave an internal
dangling reference; public reads omit it and unlink can remove it. No production
assignment/migration, actual browser visual validation or OS-kill matrix is claimed.

The shipment list/detail pages now consume the company-scoped store. Ten compiled
page/store checks cover real records, missing fields, errors/retry, route changes,
company/session context, viewer controls, late writes and retained tracking request
identity. The shipment API suite adds a compiled-page check against the built app:
a lost response after a saved scan must reuse the same event on retry. With
`OMF_TEST_CHROME_PORT`, it also runs two real Chrome checks using normal synthetic
login, member/viewer pages, linked purchases, reload persistence and missing records.

The form confirms a manual tracking/status update only after the server responds.
It does not contact carriers or send customer notifications. Unimplemented label,
proof-of-delivery, email and carrier cancellation actions are shown as unavailable.
Retry identity remains in the mounted form; a browser reload after an uncertain
write does not yet restore that pending form. Late responses cannot refill records
after page, company or session changes. These are new UI/request ownership guards;
independent review and the previously recorded broader release work remain pending.


Receipt attachment now uses Receipt.transactionId as its stored authority. Both
receipt-side and transaction-side routes use current company write access, a
displayed linkVersion and the same atomic service. A partial unique index prevents
two assigned receipts from owning one transaction. Same-version retries return the
saved result; obsolete requests cannot undo a newer link. Transaction list, detail,
receipt filters and statistics derive the link, and generic edits discard projected
receipt fields. No transaction accounting or timeline write is needed to match.

Twelve receipt-link tests cover conflict races, retries, failures before/after the
durable write, reconnect, company boundaries, deletion, projected edits and the
compiled upload-page caller. Seven built API/store checks (plus two shared setup
checks) cover real route dispatch, viewer access and a lost-response retry through
Pinia. Eight deliberate defects fail named tests through the actual verifier.
The final fixture passes 197 unit/service/page tests, a fresh build and all retained
API suites; TypeScript now reports zero errors (previously 19 in the broken route).

New access, version, ownership, existing-evidence and projected-field guards await
independent review. This is relationship verification, not original file download
verification or a production reliability rate. File storage/recovery/downloads,
remaining mock receipt pages and the broader company-access release work remain
outstanding. No production migration or deployment is included.


Receipt originals now live outside the checkout under the configured data directory,
partitioned by company and SHA-256. Uploads publish a flushed temporary file by
rename before unique company/hash registration. Retrying identical bytes preserves
reviewed metadata and can restore a missing or damaged original. An uncertain
database result never deletes the original. Purchase date remains unknown.

The ID-based download route requires current company read membership, derives its
path from the trusted stored hash, verifies bytes and returns attachment/no-store
headers. JSON metadata cannot assign a file path or URL. Multipart input is bounded
while streaming, including absent Content-Length; file signatures and size are
checked before registration. The active page honors a transaction upload target,
deduplicates retries, drops old-context results and downloads with authentication.
Existing finance evidence uses its separate document flow. Mobile summary labels
and original filenames retain the current page design.

Fifteen new storage/page/client tests plus retained suites pass; the actual fixture
runs 212 unit/service tests, a fresh build and all retained HTTP suites including
nine receipt-file checks (seven specific and two shared setup). A separate real
Chrome run adds one browser flow: normal login, upload, attach, download byte
comparison and reload. Ten deliberate faults fail named behavioral assertions.
Root TypeScript remains at zero errors. This is scoped verification, not a
production reliability rate or a power-loss/OS-kill guarantee. New file/access/
context guards still await independent review. Remaining receipt mock/legacy routes
and broader release work are outstanding; no deployment is included.


The receipt workspace now uses the company receipt API for records, statistics,
matching and confirmed deletion; it no longer generates demonstration receipts.
Search/filter/pagination preserve zero values, original filenames and stored
currency. Downloads use the authenticated original-file service. Two unused mock
components were removed; legacy matching now invokes the canonical link service.
Old-context responses are discarded and company reload waits until the complete
session update finishes. Viewer controls reflect current membership.

Verified with 223 unit/service tests, a fresh build, all retained HTTP suites,
seven workspace API checks, and ordinary-login real Chrome matching/download/
delete/reload/company-switch checks. Compiler remains at zero errors. Seven
injected defects were caught by the actual verifier and restored byte-exact.
Independent guard review and remaining attachment/ledger/release work are pending.
This branch has not been deployed.


Legacy generic attachment endpoints now return authenticated HTTP 410 without
reading/deleting old originals or changing transaction references. Generic
transaction metadata writes cannot register or replace receipt evidence; finance
document associations remain intact. The active form directs receipt work to the
canonical upload/link flow; its nonfunctional picker and unused older form were
removed. Existing-data initialization no longer calls an uninitialized formatter.

Verified: 229 unit/service tests, fresh build, retained API suites with 16
transaction-group checks, an ordinary-login real Chrome save/upload/reload flow,
zero TypeScript errors and six detected/restored mutations. Independent guard
review, transaction save lifecycle and broader release work remain pending.
This branch has not been deployed.


Transaction list/detail saves now use authenticated company/session-owned state.
Late replies are discarded after company, route or page changes; normal token
renewal is tolerated. Forms await confirmed saves, retain failed inputs and send
only changed metadata, preserving status, timestamps, card fields and zero values.
Detail editing is functional. Lost creates show uncertainty and are not replayed
automatically; durable create identity and concurrent edit versions remain open.

Verified: 240 unit/service tests, fresh build, retained API suites, six workspace
API checks, ordinary-login real Chrome edit/retry/reload/company-switch checks,
zero TypeScript errors and six detected/restored mutations. Independent guard
review and broader release work remain pending. This branch is not deployed.


Transaction lifecycle foundation retains future manual-create identities after deletion,
excludes deleted rows from ordinary ledger reads, and preserves original transaction
IDs/current states during company-bound archive merge. Clear uses a captured ID set;
new purchases during restore survive. Durable manual POST/browser reconciliation is
still pending; other backup collections and legacy ownership entrances remain open.

Verified: 254 unit/service cases, fresh build, retained HTTP suites including eight
lifecycle checks, zero TypeScript diagnostics and five detected/restored mutations.
Shared guards require independent review and broader validation. Not deployed.


Keyed manual transaction POST and company-scoped reconciliation now preserve one
original intent through ambiguous responses, concurrent retries and deletion.
Canonical purchase hashing and verified unique identity use one journal-acknowledged
insert; replay returns current metadata. Existing unkeyed clients remain compatible.
The form still needs persisted-draft recovery and makes no retry guarantee yet.

Verified: 268 unit/service cases, fresh build, retained HTTP suites including ten
manual API checks, zero TypeScript diagnostics and five detected/restored mutations.
New guards require independent review. No deployment or production migration.


Manual transaction forms now persist the original keyed draft before sending.
Reload and same-draft tabs reconcile saved/deleted results; definite validation
rejection permits same-key corrections. Light recovery UI preserves user/company
context. New guards require independent owner-ordered review.

Verified: 281 unit/service cases, fresh builds and retained API suites, six scoped
real Chrome cases (twelve including API/setup), zero TypeScript diagnostics, and
six detected/restored mutations including an actual IndexedDB abort boundary.
Browser storage eviction, OS/power loss and unsubmitted text are excluded.
Existing broader release blockers remain. No deployment or production migration.

The reviewed draft follow-up fixes absent/failed recovery canceling the ledger read,
locks expense/income toggles with the rest of the form, and limits confirmation
notices to recovery/retry results. Rejected drafts have a revision-aware local
discard marker that prevents stale-tab sends. Durable storage remains mandatory;
new-draft, before-send and confirmed-result storage errors have distinct guidance.

Required acceptance now includes both cross-tab discard/correction orderings,
discard transaction abort, storage recovery with the same identity, no notice
after ordinary success, and disabled type controls in actual Chrome. Browser
receipts include source hashes at test start; the finance fixture requires all
289 unit/service cases and the draft browser fixture requires all 16 checks,
including nine in real Chrome. Current results are retained with the task report.

The discard follow-up was independently reviewed at 7903d4e: no required code
changes within that patch, with release evidence and the separate save/list race
still outstanding. The save/list repair now preserves reads when a save fails
and replaces a list superseded by a confirmed save. It preserves stale-response
protection without delaying the confirmed save or adding another write.

Acceptance for this repair requires 298 unit/service cases, nine isolated draft
API/setup checks, seven workspace API/setup checks, and 21 dedicated draft checks
including twelve in real Chrome. New cases hold real list responses across new
saves, same-key retries, edits and rejections; assertions check the complete IDs,
totals, confirmed metadata and write counts. Synthetic browser 400/503 responses
exercise UI failures; separate built-API cases prove actual validation rejection.
Ordinary loaded-list edits and detail saves retain their no-extra-list-read path.

New active-read ownership and conditional replacement branches are guards under
the house rule and need independent owner-ordered review before shipping. This
branch remains undeployed. The broader release blockers above still apply;
synthetic checks do not establish a production reliability rate.

Calendar completion now reserves its original posting identity before recording
the ledger result. Repeat/concurrent requests reuse the existing manual transaction
service, preserve later ledger edits and do not recreate deleted transactions.
Calendar CRUD, dashboard payment counts and visible state use the current company;
viewer reads remain available. Failed completion is visible and resumable. Legacy
date migration is retired without writing records.

Evidence and limitations are detailed in [calendar payment recovery](calendar-payment-recovery.md):
315 finance unit/service cases and retained HTTP suites, a final 17-case scoped
run, eight API/setup plus two real Chrome checks on a fresh final build, zero
TypeScript diagnostics, and four detected/restored defects. Final scoped changes
and the two-byte line-ending normalization are explicitly distinguished from the
earlier finance receipt. New guards require independent owner-ordered review.
Legacy ownership/link migration and calendar backup completeness remain open.
No deployment or production migration is included.

The calendar review follow-up restores authenticated company setup without financial
reads, gives deleted ledger links Review/Remove calendar entry, and preserves an
open draft's original revision across conflict refreshes. Use saved version is an
explicit replacement; refresh never repeats a write. All three visible calendar
entry points, pending resume, missing rows and company changes use this behavior.

Follow-up evidence supersedes the earlier calendar acceptance counts: 321 finance
unit/service cases with all required API suites, 23 scoped cases, and nineteen
calendar checks including nine in real Chrome. Four deliberately restored bugs
are caught and source bytes restored; final compiler diagnostics are zero. The
final finance/browser receipts use identical changed source hashes. Screenshots,
earlier harness failures and test exclusions are retained with the task report.
See [calendar payment recovery](calendar-payment-recovery.md) for boundaries.
New recovery/setup/presentation conditions are guards requiring a new independent
owner-ordered review. This branch remains undeployed; legacy assignment, global
dashboard aggregates, backup coverage and the broader release blockers still apply.

The subsequent UI review repairs clear recovered list errors without losing write
failures and omit inactive defaults from the saved comparison. Final acceptance
is 326 finance unit/service cases (28 scoped calendar cases), all required HTTP
suites, and 21 calendar checks including 11 in real Chrome. The terminal removal
case now keeps the old draft open while fetching and sending a newer saved
revision. Four deliberately reintroduced defects are detected and restored.
Finance and browser receipts match the final changed source hashes.

TypeScript reports zero diagnostics; installed vue-tsc crashes in its TypeScript
loader before checking project files. Fresh Nuxt build and Chrome coverage do not
replace Vue type-checking. New error-ownership/comparison guards await a separately
owner-ordered review. No deployment, migration, production reliability claim or
resolution of the broader release blockers is included.

The [Vue type-check maintenance](vue-typecheck.md) supersedes the loader-crash
limitation above. Pinned vue-tsc 3.0.8 and `npm run typecheck` now reach app source.
A local initialized calendar draft type clears five diagnostics with identical
emitted JavaScript. A clean dependency install, 28 calendar tests and a production
build pass. **Full type checking still fails with 280 diagnostics in 48 other Vue
files.** No suppression or exclusion was added. The reviewed runtime behavior and
existing release blockers remain; this tooling change is not a deployment.

The next bounded import-contract repair clears another 17 diagnostics using
shared file/row/mapping types and the card summary already returned by the API.
**The current full check fails with 263 diagnostics in 45 Vue files.** Other file
counts are unchanged. Four compiled SFCs are identical; the mapper's only emitted
change makes existing numeric coercions explicit, with equivalent checked
behavior. No new runtime guard or deployment is included. See the linked Vue
type-checking report for the remaining scope.

The [preview ownership repair](transaction-import-preview.md) preserves original
columns across refresh/remapping and sends them unchanged to the existing import
API. Confirmation receives preview statistics and the entity lookup sends the
current bearer header. Eleven intercepted component/handler regressions pass;
six fail against the preceding product code. **Current full Vue type checking
fails with 236 diagnostics in 44 files**, with all 27 preview diagnostics removed
and other counts unchanged. The new date type-dispatch conditional requires an
owner-ordered independent review. Browser/deployed replay and the recorded import
format/validation findings remain open; this is not deployment readiness.

The subsequent review follow-up corrects numeric supplier/customer lookup,
preview validation priority and results-component registration. Sixteen focused
cases pass, including actual Vue mount; three deliberately restored defects are
caught. Six real Chrome checks submit synthetic XLSX/CSV files to a built isolated
app and temporary database, verify posted amounts/catalog references and visible
results, and complete a second import after reset. This supersedes the missing
browser proof and validation-priority findings for this wizard. Build passes;
full Vue checking remains at 236 diagnostics in the same 44 files. The revised
classification guard awaits owner-ordered review. Comma-formatted amount display,
broader wizard edge cases, production replay and existing release blockers remain
open. No production deployment or migration is included.

The owner-ordered review of that patch, 556d546, returned KEEP within its scope.
The next preview-values repair addresses the separately recorded comma amount
display and duplicate-target mapping behavior. Preview now resolves the last
defined source before validating and uses those final values for entity hints.
Blank/null overrides still replace; absent cells preserve an earlier value.
Display, amount filtering and downloaded preview CSV retain the full number.
Twenty script cases pass (four fail on the preceding code), three deliberately
restored defects are caught, and eight real Chrome checks pass with actual parser
and temporary MongoDB. Build passes; the same 236 diagnostics in 44 other files
remain. The new absent-source fallback guard awaits owner-ordered review; no
production migration/deployment or broader release approval is included.

The owner-ordered review of 192832f returned KEEP for those preview-value fixes.
The next missing-amount repair runs existing required-amount validation even
when Amount is not mapped. Confirmation then counts zero importable rows, and
back/remap restores the expected counts. Empty mapping objects preserve original
field names, matching the existing API; nonempty ignored mappings cannot inherit
unmapped source amounts. Twenty-two script cases pass (the two new cases fail on
192832f), two removed-fix mutants are caught and ten real Chrome checks pass.
The build passes; type checking retains the same 236 diagnostics in 44 files.
The changed classification guard and empty-map fallback require an explicitly
ordered review before shipping. Existing wider release blockers persist; no
production deployment, migration or production reliability claim is included.

The owner-ordered review of 6141992 returned KEEP within its scope. The next
display-only correction labels an empty canonical date as using the import date,
in Japanese and Korean, instead of showing an invalid date or epoch date. Raw
rows, validation, filtering and server policy are unchanged. Existing 22 script
cases and ten Chrome checks pass; the displayed Japanese cell and downloaded CSV
were inspected for the label. No new cases or separate Korean browser run were
added. Locale files are included in the browser source hashes. Fresh build passes;
the same 236 diagnostics remain in 44 files. The new display conditional requires
an explicit owner-ordered review. No production deployment or migration included.
