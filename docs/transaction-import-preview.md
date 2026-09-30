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

Preview assigns severity after inspecting all mapped fields. Invalid amounts
and unreadable nonempty dates are invalid, matching the existing import handler.
Missing dates still warn and import with today's date; old dates and coerced types
still warn and import. Field order cannot downgrade an invalid row to a warning.
The parent now uses the registered ImportResults component, displaying actual
import totals, rejection reasons and the import-more action.

## Verification

Run `node --test scripts/transaction-import.test.cjs`.

Sixteen tests execute the actual compiled parent/preview setup through Vue's real
mount lifecycle and execute both import handlers. The helper follows the parent
template's source/event bindings and serializes request bodies as JSON. Database
operations and transaction writes are intercepted in these script tests.

Coverage includes refresh, remapping/re-entry, final import amount/date/notes,
confirmation counts, authentication/textual names, slow and failed lookup,
identity mappings, multiple files, reset/new upload, date coercion and numeric
range/status inputs. The follow-up also covers initial mount without refresh,
existing/new numeric names, empty names, and validation severity in both mapping
orders. Three cases fail against the preceding product revision. Deliberately
removing startup, normalization or severity priority in memory causes the relevant
tests to fail. Earlier ownership regressions remain covered.

After `npm run build`, run `node scripts/verify-transaction-import-browser.cjs`
with the local OhMyCode browser hub available. The fixture opens real installed
Chrome, starts the built app with temporary MongoDB, registers a synthetic user
and company, and submits real synthetic XLSX/CSV files through the UI. It verifies
initial preview, refresh, back/remap, confirmation, actual stored transaction and
catalog data, visible error reasons and a second import after reset. Six browser
checks pass. A six-row spreadsheet imports three rows, rejects three and reuses
the two existing entity records; a new CSV imports exactly one further row.
Desktop and mobile navigation are exercised and mobile screenshots retained.
The fixture closes its Chrome session and app and removes its temporary data.
No production account, record, company migration or deployment is involved.

The full Nuxt checker now reports 236 diagnostics in 44 other files (27 removed,
all other counts unchanged). No diagnostics were suppressed or excluded.
The fresh production build passes.

## Review and remaining scope

The owner-ordered review of the preceding preview revision returned LOOSEN. It
found the missing startup test, numeric-name mismatch and validation priority
issues addressed here; it found no problem with date type dispatch. The revised
severity conditional is a guard under the owner's rule and needs a separately
owner-ordered review before shipping. It changes preview classification and
filter membership; it does not add an API rejection, submission block or hold.
No further reviewer was launched automatically.

Separate existing behavior remains: comma-formatted amounts are passed directly
to parseFloat for display/filtering. Source reset on unusual empty-file callbacks,
step-header navigation, duplicate target mappings, missing amount mappings and
repeat-click handling remain outside this follow-up. Import-more reset is now
covered in real Chrome. This change does not certify all import validation,
option handling or deduplication behavior. These synthetic cases are not a
production reliability rate, database concurrency proof or deployed replay.
Existing global-catalog/organization boundaries and broader release blockers
remain open. No production deployment or migration is included.
