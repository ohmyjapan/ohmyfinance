# Import preview ownership

With a mapping such as `Paid -> amount`, preview previously replaced the parent
source rows with `{ amount: ... }`. Refresh and back-navigation then tried to read
`Paid` from that transformed row. The final import API also applied the original
mapping again. A synthetic `79,200` purchase therefore lost its values and the
first final import accepted zero records.

The parent now keeps original source rows for the entire wizard. Preview builds
its own transformed rows and emits only validation totals for confirmation.
Final import sends original rows plus mappings to the existing API, which maps
them once. Totals are sent before the optional supplier/customer lookup, so a
slow or failed lookup cannot replace source rows or delay those totals. The
lookup uses the current user-store bearer header and sends names as strings.

Preview file/row/mapping/issue/statistics/response types are explicit. JavaScript
numeric coercions remain explicit; the date helper preserves constructor behavior
for supported primitive values and internal issue arrays. Nontext status values
are converted to strings for display.

The review follow-up normalizes truthy supplier/customer names to strings before
import lookup and creation, matching preview and the stored names. Empty names
retain the existing no-create behavior. Numeric and textual representations of
the same name reuse a single reference within a batch.

Preview resolves every mapping before validating the final fields. Like import,
the last defined source cell wins when multiple columns target one field. An
absent source cell preserves an earlier value; a blank, null or zero is still an
explicit replacement. Discarded values contribute no validation issues or counts.
Supplier/customer hints use these same resolved values rather than the first
source column. Original rows and mappings still go unchanged to the server.

Amount validation runs for every row, including when no column targets amount.
An omitted, unselected or ignored amount mapping therefore marks the affected
rows invalid and contributes zero importable rows to confirmation, matching the
server's existing rejection. The existing warning summary and back-to-mapping
action provide recovery; correcting the mapping refreshes the counts.

When the entire mapping object is empty, import uses the original field names.
Preview mirrors that behavior with its own shallow copy before validation and
entity hints. Already named amount/date/name fields therefore remain usable.
A nonempty mapping object, even one containing only ignored targets, still uses
only its mapped fields; it cannot inherit an otherwise unmapped source amount.

Preview assigns severity after inspecting the resolved fields. Invalid amounts
and unreadable nonempty dates are invalid, matching the existing import handler.
Present but empty date fields still warn and import with today's date; old dates and coerced types
still warn and import. Warnings on other fields cannot downgrade an invalid
final amount or date to a warning.
The parent now uses the registered ImportResults component, displaying actual
import totals, rejection reasons and the import-more action.

Display, preview CSV export and amount range filtering strip comma separators
before reading the number, so 79,200 stays 79,200 instead of becoming 79. This
does not change the existing server's number parsing or acceptance policy.

For a missing canonical `date` value, the table and preview CSV now explain that
the import date will be used: `未指定（インポート日を使用）` in Japanese and
`미지정 (가져오기 실행일 사용)` in Korean. The display condition mirrors the
server's existing falsey-date fallback, including undefined, null, empty string,
numeric zero and false. It does not insert a date or a label into source rows or
the import payload. Validation, date filtering and server acceptance are unchanged.
Nonempty invalid dates keep their existing invalid display and rejection.

The upload page now owns the pending import request. Repeated confirmation
events while it is pending do not send another batch, even with duplicate
transactions allowed. The confirmation loading label uses this parent state;
a native disabled fieldset holds the wizard's navigation and options until the
request settles. Success and failure both release the state and keep the existing
results/import-more flow. No source rows or server acceptance policy change.

Results is now the end of one submitted attempt. Before a response exists, its
header cannot open an empty result screen. After success, partial/all-row rejection
or a request error, previous step headers cannot reopen the submitted batch, and
another import callback cannot send it again. The result, batch details and row
errors remain visible. Use the existing Import more action to reset, select a file
and start a new attempt, including when correcting rejected rows. Pre-submission
back/remap and the existing request-pending behavior remain unchanged.

## Verification

Run `node --test scripts/transaction-import.test.cjs`.

Twenty-seven tests execute the actual compiled parent/preview setup through Vue's real
mount lifecycle and execute both import handlers. The helper follows the parent
template's source/event bindings and serializes request bodies as JSON. Database
operations and transaction writes are intercepted in these script tests.

Coverage includes refresh, remapping/re-entry, final import amount/date/notes,
confirmation counts, authentication/textual names, slow and failed lookup,
identity mappings, multiple files, reset/new upload, date coercion and numeric
range/status inputs. The follow-up also covers initial mount without refresh,
existing/new numeric names, empty names, and validation severity in both mapping
orders. The value-resolution follow-up adds amount display/ranges, duplicate dates
in both orders, duplicate amount/type resolution, and entity hints from final
values. Those four cases failed against 556d546. Removing comma normalization,
absent-source preservation or final-value processing in memory
causes the relevant tests to fail. Earlier ownership/startup/name/severity
regressions remain covered.

The missing-amount follow-up adds five partial/ignored mapping shapes and seven
already named rows with an empty mapping object. It checks preview counts,
refresh, remapping recovery, actual handler acceptance, preserved source data
and existing entity reuse. Both new cases fail on 192832f; all 22 pass after the
repair. Removing unconditional amount validation or empty-map source preservation
in memory makes the corresponding regressions fail again.

After `npm run build`, run `node scripts/verify-transaction-import-browser.cjs`
with the local OhMyCode browser hub available. The fixture opens real installed
Chrome, starts the built app with temporary MongoDB, registers a synthetic user
and company, and submits real synthetic XLSX/CSV files through the UI. It verifies
initial preview, refresh, back/remap, confirmation, actual stored transaction and
catalog data, visible error reasons and a second import after reset. Ten browser
checks pass, including the displayed 79,200 amount, a 79,000–80,000 filter and an
actual downloaded preview CSV. A six-row spreadsheet maps two columns to Date;
it imports three rows, rejects three and reuses
the two existing entity records; a new CSV imports exactly one further row.
Before correction, that spreadsheet is previewed with Amount unmapped: all six
rows are invalid, refresh preserves those counts, and confirmation shows 0 / 6.
Going back and mapping Amount restores the normal preview and import path.
Desktop and mobile navigation are exercised and mobile screenshots retained.
The fixture closes its Chrome session and app and removes its temporary data.
No production account, record, company migration or deployment is involved.

The full Nuxt checker now reports 236 diagnostics in 44 other files (27 removed,
all other counts unchanged). No diagnostics were suppressed or excluded.
The fresh production build passes.

The later blank-date display correction reuses these same 22 script cases and
ten browser checks; no new test cases were added for the display-only change.
The Japanese missing-date cell and actual downloaded preview CSV were inspected
for the new label; desktop/mobile screenshots were retained. The fixture's source
hashes now include both locale files. Korean wording was inspected in its locale
file, not exercised in a separate browser run. Build passes and the full checker
still reports the same 236 diagnostics in 44 other files.

The pending-request follow-up adds two financial-write regression cases: concurrent
confirmation events send/store once, and a rejected request releases state for a
new import. Baseline is 22 pass/two fail; the revised suite passes all 24. Removing
the concurrent-event check in memory gives 23 pass/one fail; removing the finally
release gives 21 pass/three fail, including existing remapping recovery.

Thirteen real Chrome checks pass on a fresh build. The new scenarios hold an actual
request before the server, trigger confirmation twice in the same task, inspect
the disabled navigation/options/loading label, then release it and verify exactly
three valid stored rows. Duplicate skipping is off for that batch. A simulated
503 produces the existing error result without writes; reset and a fresh CSV
then import once on mobile. Screenshots of pending and failed states were inspected.
The shared script helper is unchanged. Full type checking remains at 236 diagnostics
in the same 44 files; no exclusions or suppressions were added.

The result-navigation follow-up adds three script cases for premature Results,
completed/partially rejected batches and failed attempts. Baseline: 24 pass/three
fail; final: 27 pass. Existing all-rejected amount-mapping recovery retains its
validation assertions and now uses reset/re-upload before correcting and submitting
again. Four in-memory removed-fix checks catch terminal navigation (25/2), premature
Results (26/1), settled resubmission (25/2) and pending duplicate sends (26/1).

Seventeen real Chrome checks pass on the final source hashes and a fresh build.
The four new checks attempt actual header clicks before submission and after
partial success, full success and a simulated error; they verify the visible
result is preserved, requests/write counts do not increase, and Import more still
starts successful fresh imports. Desktop/mobile coverage and the existing real
parser/temporary database fixture are retained. Type checking still reports the
same 236 diagnostics in 44 files. These are synthetic checks, not a production
reliability rate or an idempotency guarantee.

## Review and remaining scope

The owner-ordered reviews of 556d546, 192832f and 6141992 returned KEEP for their
bounded patches. The 661a6db blank-date review returned LOOSEN solely for missing
automated label assertions, while judging the implementation correct. The root
retained its screenshots/CSV/probe evidence for that reversible display change;
the recommendation remains recorded and unimplemented. It is not release approval.
The owner-ordered review of 66088b5 returned KEEP for the pending-request return
and disabled fieldset. The later result-aware navigation and widened submission
exit are new/expanded guards and need a separately owner-ordered review before shipping.
No reviewer was launched automatically.

Source reset on unusual empty-file callbacks and upload prerequisites before
submission remain outside this follow-up. Direct internal Back/Continue function
calls are not a complete state machine; the tested rendered flow has no such
buttons on Results. An extra Chrome transition-click probe did not reproduce a
post-result Back failure, so no callback-specific guards were added. Protection
applies only to one mounted wizard: page reload/navigation away, other tabs, lost
responses and server idempotency are not solved. Explicit reset permits a new
attempt and does not guarantee that re-uploading an already committed batch is safe.
The optional server duplicate lookup remains read-before-write. The intercepted
503 proves UI recovery, not safety of retrying an uncertain committed request.
Rejection details still
lack row numbers. Unmapped-Amount wording, date-filter behavior and invalid
nonempty date presentation remain separate. Import-more reset is covered in real Chrome.
This change does not certify all import validation,
option handling or deduplication behavior. These synthetic cases are not a
production reliability rate, database concurrency proof or deployed replay.
Existing global-catalog/organization boundaries and broader release blockers
remain open. No production deployment or migration is included.
