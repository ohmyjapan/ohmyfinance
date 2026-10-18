# Invoice read prerequisite for Navi

The existing invoice GET list/count, detail and printable preview use the selected company and current active membership through `calendarCompany`. Foreign and unassigned invoices are outside that company read scope; item/preview requests return the existing not-found response. Owner, admin, member and viewer remain eligible readers under the same membership policy as calendar. These added calls and query restrictions are customer-path guards and require independent review.

## Caller map (self-mapped FOLD)

`pages/invoices/index.vue` lists and filters via GET `/api/invoices`, then reloads after its existing native writes. Its preview opens `/api/invoices/:id/pdf`; that endpoint still returns printable HTML, not generated PDF bytes. GET `/api/invoices/:id` uses the same company restriction for item readers. Authentication still comes from the native auth middleware; membership is checked fresh for each request, not accepted from a stale role/company claim. Lists, counts, pagination and by-id reads use the same company boundary. The shared calendar guard and all existing calendar readers/writers are unchanged. No Article/Memo/Menu51 consumer imports these OMF routes.

Navi has no invoice/calendar action or company-bound conversation integration from this increment. Its existing owner/card/intake/history/timing/interpretation behavior is unchanged. A future tool must bind the actor and selected company on the server, preserve that binding through worker/retry and restrict prior conversation evidence as well as records. It must use a reviewed shared native read service rather than wrap an unscoped API.

## Record meanings and unfinished work

An issued invoice's INV document reference is not a supplier's T registration; a stored sent/paid status is not an email or bank receipt. Invoice creation does not create a calendar entry. No bank balance, payment settlement, source association or NTA verification is established by reading an invoice.

Invoice POST, PUT and DELETE still have their existing login-only behavior and known validation/field issues. They are outside this read repair. This increment does not establish complete invoice CRUD/company isolation or make the every-feature Navi goal complete. Conversation company context, write policy and durable action receipts, invoice-calendar integration, bank matching and reminders remain separate work. No record migration or assignment is performed.

## Verification limits

The invoice-access fixture uses actual built HTTP routes, a separately owned ephemeral MongoDB process and synthetic invoices/companies. It checks legitimate member roles, foreign/unassigned records, count/pagination/status, valid signed but missing/revoked/inactive membership, concurrent A/B company tokens, source-state immutability and a fresh server process. Known defects must fail named HTTP assertions in an isolated built copy. It is not a production exploit, a historical corpus, a browser/user-interface replay or a native-model evaluation. Broader shared-guard observation/audit, independent combined review and final deployed replay remain pending; synthetic assertion counts are not a reliability rate.
