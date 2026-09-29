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

## Verification

Run `node --test scripts/transaction-import.test.cjs`.

Eleven tests execute the actual compiled parent/preview setup and actual import
handler. The helper follows the parent template's source/event bindings and
serializes request bodies as JSON. All database operations and transaction writes
are intercepted; no production account, browser login or financial record is used.

Coverage includes refresh, remapping/re-entry, final import amount/date/notes,
confirmation counts, authentication/textual names, slow and failed lookup,
identity mappings, multiple files, reset/new upload, date coercion and numeric
range/status inputs. Six regressions fail on the preceding product code. This is
local regression evidence, not a production reliability rate, auth integration
test, database concurrency proof or browser/deployed replay.

The full Nuxt checker now reports 236 diagnostics in 44 other files (27 removed,
all other counts unchanged). No diagnostics were suppressed or excluded.
The fresh production build passes.

## Review and remaining scope

The date type-dispatch conditional is a new guard under the owner's review rule.
It rejects no input and adds no hold, but an owner-ordered independent review is
still required. This patch is committed for review; it is not a release approval.

Separate existing behavior remains: comma-formatted amounts are passed directly
to parseFloat for display/filtering, and later validation warnings can overwrite
an invalid amount status. Source reset on unusual empty-file callbacks and wizard
navigation after completed imports also need a focused follow-up. This change
does not certify all import validation, option handling or deduplication behavior.
Existing global-catalog/organization boundaries and broader release blockers
remain open. No production deployment or migration is included.
