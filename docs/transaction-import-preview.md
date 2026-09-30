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

## Verification

Run `node --test scripts/transaction-import.test.cjs`.

Twenty-two tests execute the actual compiled parent/preview setup through Vue's real
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

## Review and remaining scope

The owner-ordered reviews of 556d546 and 192832f returned KEEP for their bounded
patches. The latter covers final-value validation, absent-source preservation
and comma amount display/filter/export. It does not cover the subsequent missing
amount repair. Moving required-amount validation changes the classification
guard's reach; empty-map source preservation introduces a fallback conditional.
Both need a separately owner-ordered review before shipping. They mirror existing
server behavior and add no API rejection, submission block or hold. No reviewer
was launched automatically for this revision.

Source reset on unusual empty-file callbacks, step-header navigation and
repeat-click handling remain outside this follow-up. Empty
dates still display "Invalid Date" while importing with today's date, and rejection
details still lack row numbers. Import-more reset is covered in real Chrome.
This change does not certify all import validation,
option handling or deduplication behavior. These synthetic cases are not a
production reliability rate, database concurrency proof or deployed replay.
Existing global-catalog/organization boundaries and broader release blockers
remain open. No production deployment or migration is included.
