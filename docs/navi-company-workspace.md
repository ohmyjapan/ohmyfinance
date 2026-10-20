# Company Navi workspace

Presentation update 2026-10-20: Navi now opens from the introduction-film girl's floating icon in the bottom-right. The earlier accordion references below describe the previous presentation. See [the current UI mapping and checks](navi-floating-assistant.md); company authority, conversation separation and financial actions are unchanged.

Self-mapped (FOLD). Explicit GET/POST `/api/finance-chat/company-workspace` and POST `/company-workspace/retry` use the session selected company plus native source user and fresh active membership. Company conversations live in a separate owner/company-unique collection. Server actor/company fields are immutable; each turn/context captures the same identity. Legacy owner/purchase chats are not adopted, reindexed, shared or changed. Same request id can exist independently in different companies; a repeated request within one company must retain its text and selection.

Caller chain: native company route -> company assistant -> separate stored turn/context -> existing workspace worker claim -> company-only tool catalogue -> shared invoice/calendar read operation -> rechecked live job/member -> native result. Existing workspace worker protocol and model/provider selection are unchanged. Legacy jobs retain priority in the existing claim endpoint; company jobs are picked when no legacy job is available. Legacy journal recovery remains untouched. Heartbeat widens the old renewal exit to recognize company jobs and does not renew legacy operation journals for them.

Company jobs now expose seven finance-record/history reads, an action-status read and three explicit calendar/invoice/transaction update tools (11 total). Transaction operations are mapped in navi-transaction-actions.md. The original four invoice/calendar record reads remain: list/detail of company invoices and visible calendar entries. The same domain queries serve native GET routes. Invoice pagination/counts, actual currency/dates, saved status and printed issuer T are retained; model results omit bank details and contact addresses. Calendar reads retain suppression and adoption/source facts, preserve noon-date/filter behavior, and return at most100 entries with explicit truncation. Native page list behavior is unchanged. Saved paid/sent state is not bank settlement/email delivery; printed T is not fresh NTA verification. Invoice/calendar linkage is unestablished. No bank balance is supplied.

Company prompt history comes only from that company conversation, with stored submission/reply times. It contains no global legacy learning/reference/card or other-company context. Worker actions cannot name a different company or call legacy tools. Explicit calendar/invoice/transaction updates use the same scoped native write operations, frozen job and durable company receipts; other writes remain unavailable. Queued jobs, explicit retry, lease renew/reclaim and result admission use stored actor/company, not current UI selection or model/body company IDs. A removed/inactive membership cannot execute, renew, read history or deliver a result. Revoked/inactive queued jobs fail without exposing their context. Checks and domain writes are not one atomic membership/database transaction; that narrow race is not claimed eliminated.

New guards: authenticated selected membership; owner/company conversation/history key; request text/selection identity; frozen turn/context identity; live member/job/lease checks; strict read catalogue/arguments; foreign and suppressed record scope. They require independent review. `companyMembership` extracts the existing calendar predicate unchanged for frozen worker use; the broader shared-boundary audit is still required. Native invoice POST/PUT/DELETE now use selected-company/live membership; PUT shares the validated invoice operation described in navi-invoice-actions.md. Calendar PUT now delegates to the same company-scoped write service used by Navi, retaining native field selection, date parsing, validation and first settlement. Calendar DELETE and shared membership behavior are unchanged. Existing invoice/calendar defect fixtures point to the actual shared operations, retaining their original assertions.

Transaction, invoice and calendar pages now use the explicit company conversation in the existing accordion. Company identity comes from the active access token; the server independently authorizes membership. Other pages and purchase chats retain their separate legacy conversations. Navi card posting stays legacy until company posting/draft/reference ownership is deliberately connected. Full invoice field/create/delete/send integration, calendar create/delete, bank settlement/Slack, memory/migration, viewer write policy, full operator/database/key/runtime custody, fresh native-model reasoning/historical/production observation and deployed replay remain open. A claimed API read or synthetic worker reply is not a real Opus evaluation or a production reliability rate.

Affected shared boundary callers:
- `server/utils/calendarAccess.ts`
- `server/api/finance-chat/[...path].ts`
- `server/api/dashboard/stats.ts`
- `server/api/receipts/[id].ts`
- `server/api/receipts/index.ts`
- `server/api/transactions/export.ts`
- `server/api/transactions/[id].ts`
- `server/api/receipts/export.ts`
- `server/api/payments/[id].ts`
- `server/api/receipts/[id]/matches.ts`
- `server/api/transactions/stats.ts`
- `server/api/payments/index.ts`
- `server/api/transactions/index.ts`
- `server/api/invoices/index.ts`
- `server/api/finance/[...path].ts`
- `server/api/invoices/[id].ts`
- `server/api/invoices/[id]/pdf.ts`


Company UI continuation (self-mapped FOLD):
- Panel maps invoices/calendar to actor/company-keyed conversations and remounts on scope change. Native auth switch -> new profile -> matching actor/company validation -> session adoption -> full page reload refreshes records beneath the accordion too. OMJ customer codes are not companies.
- No company selection means no fallback to personal chat. Drafts and pending request id/text/selection stay in memory per scope. Delayed responses cannot update a different actor/company component. Server-accepted pending messages are acknowledged by actual id/text; retries preserve original intent and retain any newly edited buffer. Full page reload clears unsent buffers. No financial text is added to browser storage; existing open/target UI preferences remain.
- Native401/403 clears the displayed company conversation and disables sending until authorized loading succeeds. New UI guards require independent review. That earlier UI increment left backend authority unchanged; the later calendar-action increment adds the explicit scoped save described below.
- Installed Chrome exercises the production build with native authentication and owned synthetic DB. Delayed/lost responses wrap real authorized native requests, not mock records. No model/provider/business sends.
- TeachingWorker/MCP use the supplied catalogue without transport edits. Company interpreter keeps the Japanese accountant role and claude-opus-5-5/high, names the supplied scoped tools, preserves saved currencies and distinguishes saved status/printed T from external proof. Legacy JPY prompts are unchanged. Prompt assertions/mocked interpreter transport do not establish real native-model reasoning quality.

All-feature actions/teaching, scoped posting/mutations, legacy migration, historical/production shared-guard reliability, infrastructure/operator key/runtime custody, independent review and final deployed replay remain open.


Navi visual identity (owner direction2026-10-19): `NaviAvatar.vue` reuses the byte-identical63,785-byte original Chapter7 reference JPG from the OMF introduction film. The short-haired girl with glasses, cream blouse and red vest appears in the accordion/standalone purchase header and workspace/purchase/research reply labels. The image is decorative beside the visible OMF Navi name; dimensions reserve space before loading. CSS frames the original locally served image, with no new generated artwork, external asset host, animation, overlay or model/permission/financial behavior change. Existing accordion and responsive layout remain. This presentation increment does not add company mutations or close G1-G4.


Calendar action continuation: `update_company_calendar_entry` and `get_company_action_status` connect the same native calendar PUT operation to explicit conversational saves. Receipts are persisted per frozen owner/company/turn in the separate company conversation; retries, concurrent identical calls and exact same-turn intents return the existing operation. The payment mutation carries its recovery marker atomically. Unknown expired claims remain unresolved instead of being repeated. Current membership and lease are rechecked; expected updatedAt protects a read snapshot. The UI rereads the actual native payment after a done receipt and replaces the matching current calendar entry only while its actor/company scope is still current. New guards require independent review. Full invoice/transaction actions and G1-G4 remain open; supported scalar invoice edits are documented in navi-invoice-actions.md. Details and limitations: [calendar actions](navi-calendar-actions.md).

Invoice continuation: update_company_invoice edits supported scalar fields through the native validated operation, persists the same frozen-turn receipt and atomic invoice marker, and refreshes the scoped invoice list without resetting an open edit form. The company catalogue now has7 tools. Native POST/PUT/DELETE company/reference ownership and field/totals validation are new customer-path guards requiring independent review. Original calendar semantics and shared membership predicate are preserved.

Transaction continuation: company conversations include transaction pages/detail selection. Four transaction list/detail/history-choice/update tools expand the catalogue to11. Saved references use the shared native schema, with choice evidence limited to company-observed roots and no contact/path/internal metadata projection. Explicit edits share native operation/source protection, transaction marker recovery and current-company page refresh. No expense reposting or historical assignment; unused/global reference ownership and full reasoning/learning remain open. Details: [transaction actions](navi-transaction-actions.md). New native/job/UI guards require independent review.

Dialogue/teaching continuation (phase A of the 2026-10-19 finish goal): the company catalogue is now 17 tools. The original 11 are unchanged. The new ones are:
- `find_company_transaction_patterns`
- `search_company_knowledge`
- `remember_company_knowledge`
- `correct_company_knowledge`
- `set_company_knowledge_status`
- `list_navi_features`

Public research and inspected-record continuation (2026-10-20). A company job claimed by a worker that reported an actual public-research capability can research in the same turn. It gets the CLI's WebSearch and owned public tools: `read_public_page`, `read_public_page_in_chrome` (only when owned Chrome is available), `verify_invoice_registration`, `list_public_sources` and `read_public_source`. All of them sit in the same MCP server beside the unchanged 17-tool server catalogue.

The research rules:

- Captures go only to the lease-bound `POST /worker/workspace/:id/sources` route (`prepare | capture | list | read`).
- Captures are stored separately in `FinanceCompanyPublicSource`, bound to the owner/company/conversation/segment/turn of the frozen job.
- Registry dates come from the company transaction or invoice, a date stated in the current message, or today in JST.
- Replies may cite captured sources. The server keeps a citation only for a literal quote of a captured source of the same conversation.
- Source cards appear under turns in the live view and in archives. Bodies stay in the source collection, readable only by current members through `GET /company-workspace/sources/:id`.

The history and memory views no longer show a composer. A "相談する" control pins an archive or a teaching into the chat. The server checks that record against the owner/company and gives a fresh bounded copy to the job as `inspected`, as evidence and never as an instruction.

Details, guards and limits: [public research](navi-public-research.md). The new guards require independent review. No NTA application id is configured, so live registry checks remain untested. Real-model and live-page acceptance remain open.

Teaching writes reuse this journal and frozen job/membership checks. Their durable marker lives on the company-owned teaching row. Claimed jobs carry the frozen company's active related teachings, read fresh at claim. Native routes add `POST /company-workspace/new` (archive-backed new chat replacing the 200-turn dead end), `GET /history`, `GET /history/:id` and `GET /knowledge`, all behind fresh membership. Company replies use a catalogue-aware validator: up to 4000 characters, with an optional page link from the fixed feature catalogue, and a record link checked against the frozen company. Legacy owner/purchase conversations, validators and prompts are unchanged. Details, guards and limits: [dialogue and teaching](navi-dialogue-learning.md). The new guards require independent review. Browser research, other domain actions, privacy/audit, review and deployed proof remain open.

Legacy owner/purchase posting continuation (self-mapped FOLD): authority is split. The owner workspace and purchase chats still act on owner-card statements under the agent's account grant. Their only ledger write, `post_selected_approved_rows`, now needs a selected ledger company. That company is the token-selected one, checked against fresh active membership when the message is sent and frozen on that server-built turn and context (actor/company/name). The posting operation journal keeps it, and the native `commitCompanyImport` writer uses it. Membership is read fresh at the write and at recovery. The statement intent (`FinanceImportCompany`), each requested `FinanceEntry.postingOrganizationId` and the linked transaction's `organizationId` are all verified before any row is reported as posted or existing, including the all-already-posted shortcut. Missing historical authority stays unresolved/manual. Ownership is never inferred from the card's calendar binding or a source payment, and old rows or operations are not retrofitted. Without a selected company, discussion, saves, memories, research and approval keep their exits; the panel and purchase chat name the destination as ledger-only. Details: [purchase chat](purchase-chat.md#ledger-posting-destination). The new posting-only membership/binding checks and truthful recovery need independent review. Model reasoning about the destination, historical/production observation and deployed replay remain open.

Scheduled business native services (budgets and recurring payments; the integrated Navi adapters are mapped in the business section below): self-mapped FOLD from the current callers. Native callers: `pages/budgets/index.vue` -> `server/api/budgets/index.ts` and `[id].ts` -> `server/services/companyBudgetService.ts`; `pages/recurring/index.vue` -> `server/api/recurring/index.ts`, `[id].ts`, `process.ts` -> `server/services/recurringPaymentService.ts` -> `createCompanyTransaction`. No cron/worker caller exists; there is no all-company or global scheduler.
- Company boundary: every route resolves the token's selected company with a fresh active membership (`calendarCompany`), the same policy for owner/admin/member/viewer. Every exported service operation requires that trusted company; reads, statistics, upcoming, create/update/delete, generate and process are all scoped. Request bodies cannot supply company, creator, `naviOperation` or generated ids (ignored); scalar fields reject objects/operators (400). Rows without a company (legacy/unassigned) and other companies' rows stay invisible (404). RecurringPayment company/creator are set with `strict:false` and are not schema paths, so a request body cannot assign ownership (same protection as Transaction). `/api/backup/restore` now restores only rows recorded for the selected company, through the same trusted setters with the current actor as creator ([company import and restore](company-import-restore.md)). An optional trusted internal operation argument (deterministic create id, `naviOperation` marker, `expectedUpdatedAt`) is reserved for later Navi adapters and is never read from HTTP.
- Budgets store an ISO 4217 `currency` (default: the company's saved default currency, never the viewer's locale). Spending = the company's `completed` `支出` rows whose date falls in the current calendar month/quarter/year (not a fiscal year) in the company's saved timezone (JST when none/invalid), whole last day included, intersected with the budget start/end dates. Only rows whose saved `currency` or `metadata.currency` equals the budget currency are summed (refunds/negative amounts net in and are reported). Other currencies, unknown currencies, pending forecasts and (for a category budget) rows without any category are reported separately; unknown currency marks the total incomplete. Category matching is the exact saved text in `category` or `metadata.category`; no company category reference or tax-deductibility meaning is implied.
- Recurring payments require explicit `transactionType` (`支出`/`入金`) and `currency`; rows without them are never inferred and cannot generate. Date-only fields are stored as UTC midnight of the calendar day. Monthly/quarterly/yearly cycles clamp the anchor day (dayOfMonth or the start day) to the month end and return to it (Jan 31 -> Feb 28 -> Mar 31; Feb 29 -> Feb 28 -> ... -> Feb 29), weekly/biweekly honour dayOfWeek, the end date completes the schedule.
- Generation saves a PENDING forecast transaction through `createCompanyTransaction` (never completed/paid, no settlement or balance claim) with id derived from company + recurring payment + cycle date and `metadata.recurringPaymentId/recurringCycle/recurringForecast/currency`. Manual POST requires `expectedNextDueDate` (the value the caller read): the current cycle generates, an already-advanced cycle returns its existing forecast, anything else is 409. The cycle advances only by compare-and-set on the read cycle/snapshot; parallel requests, retries and a crash between insert and advance converge on one row; an existing row of the same id that does not match company/payment/cycle is refused, never overwritten; saved edits to a forecast are kept. Process handles only the selected company's due `autoGenerate=true` active rows from its snapshots, one cycle per row per call, never future cycles.
- Statistics and upcoming totals are grouped by saved currency and transaction type; the single compatibility number (`activeMonthlyAmount`/`totalAmount`) exists only when exactly one established currency and type is present. The pages show per-currency totals, the saved currency of each row, explicit type/currency inputs and the evidence limits above.
- Card import: a forecast has no card number and no `financeEntryId`, so an exact date/amount card statement row is shown as `legacy_review` and cannot be posted without an explicit confirm or link; nothing links by amount automatically.
- Open, not claimed: other global readers of RecurringPayment/Budget remain unscoped and unchanged (`reports/index.ts` — parent C3; `backup/schedule.ts`, `notifications/index.ts`, `search.ts`, `email/send-reminders.ts`). `backup/index.ts` and `backup/restore.ts` are now selected-company (final review F2). Pending forecasts appear as pending company transactions in transaction lists/statistics and company Navi transaction reads. Navi budget/recurring tools, public research, real-model QA, installed-Chrome UI checks, independent review and deployed replay remain open. New guards (company scope, field whitelist, cycle CAS/forecast identity, truthful spending) require independent review. Test: `scripts/finance-company-scheduled-business-integration.cjs` via fixture `omf-company-scheduled-business`.

Owner/purchase continuation (plan omf-navi-owner-continuation-20261020, self-mapped FOLD): the two realms stay distinct. The company conversation (transactions/invoices/calendar pages) keeps its own catalogue, archive and teachings above, unchanged. The legacy owner workspace and purchase chats stay owner/card conversations under the agent's account grant; they gain their own archive-backed new chat and history (separate `FinanceOwnerConversationArchive`, never mixed with company archives and never used to infer a company). The shared-teaching bridge into them requires all three of: the company frozen on the turn at send (the C1 posting company, never the card's calendar binding, a body or a model argument), a workspace-capable worker, and a membership of that company read fresh at claim, action, result and recovery. With it, the job receives that company's active teachings plus `search_company_knowledge`, `remember_company_knowledge`, `correct_company_knowledge` and `set_company_knowledge_status`. Writes reuse this service's exact current quote, expected revision and in-row marker, with provenance `conversationKind` workspace/purchase (rows written before carry none and keep their company-conversation meaning). A turn that received company data is tagged. It is withheld from later model input and from owner UI/history/archives whenever the checked company differs or none is selected. A narrow (card-only) worker, no selection, a switched or revoked company keeps the ordinary owner/card chat with no company data or teaching tools. Nothing here copies owner history into a company conversation or changes a ledger row, draft or legacy owner memory. The owner realm's `list_navi_features` names only the tools that job actually carries; company pages are page handoffs from there. The tool count of either catalogue is not a completion claim. The combined candidate includes public company research, native budgets/recurring and the normal business adapters below. Remaining readiness evidence includes final combined-model/native/browser/audit checks, independent review and deployed replay. Details: [purchase chat](purchase-chat.md#owner-and-purchase-continuation).

## Business adapters on normal company pages (2026-10-20, C3)

Company conversation pages come from the fixed list `companyNaviPages` in `shared/finance-navi-business.mjs`:
- dashboard, transactions, invoices, payment calendar;
- receipts, budgets, recurring payments;
- analytics, reports, tax report;
- profile, settings, vendors, audit log, import templates.

Owner pages keep the owner conversation and its account grants: mapping, drafts, learning, connections, intake, payment matching, purchase workflow and every other page (`other`). A page name is navigation context, never authority. The server accepts only the fixed page ids (`selection()`). Record ids are accepted only on their own page (invoice, calendar, transaction) and are checked against the frozen company.

Catalogue: the original 17 tools plus 24 finite business tools, 41 in total; tests assert the exact set. No tool takes a URL, endpoint, query, collection, company or marker argument. `validateBusinessArgs` refuses unknown keys at every level, wrong types, impossible dates and unbounded arrays.

| Tool | Native operation (same as the page) | Proof of a lost outcome |
|---|---|---|
| `create_company_transaction` | `createCompanyTransaction` (manual create route) with fixed id + marker in the one insert | marker on the row |
| `delete_company_transaction` | `deleteTransaction` with the read snapshot; card-import/posted rows refused | none (hard delete) → unresolved |
| `update_company_transaction` (+ items, tags) | `updateTransaction`; card source amount/type/payment/card protected | marker on the row |
| `create_company_invoice` / `delete_company_invoice` | `createCompanyInvoice` / `deleteCompanyInvoice` (the native route uses both) | marker / none |
| `update_company_invoice` (+ parties, items, bank text, own link) | `updateCompanyInvoice` | marker on the row |
| `create_company_calendar_entry` / `delete_company_calendar_entry` | `createCompanyCalendarEntry` / `deleteCompanyCalendarEntry` (native POST/DELETE use both); issuer bills are suppressed, never erased | marker / marker on the suppressed row; a deleted manual entry → unresolved |
| `create/update/delete_company_budget` | C2 `companyBudgetService` with trusted `{id, naviOperation, expectedUpdatedAt}` | marker / marker / none |
| `create/update/delete_company_recurring_payment` | C2 `recurringPaymentService` (company/creator stay off the schema) | marker / marker / none |
| `generate_company_recurring_forecast` | C2 `generateTransaction` for exactly `expectedNextDueDate` (pending forecast) | the cycle's forecast exists and the payment advanced with it |
| `get_company_profile`, `get_company_finance_summary`, `list/get_company_receipt(s)`, `list/get_company_budget(s)`, `list/get_company_recurring_payment(s)` | `companyNaviSummaryService` / C2 reads | read only |
| `list_company_conversation_history`, `get_company_conversation_archive`, `get_company_knowledge` | existing archive / knowledge services | read only, evidence |

Journal (`financeCompanyActionService.companyBusinessAction`). It applies the same slot/intent claim as the update tools:
- the same intent in a fresh slot coalesces; a changed intent in the same slot is refused with 409;
- actor, company, conversation, turn and lease are frozen on the job;
- live membership is checked before and after the effect;
- an existing final receipt never changes.

A create id is `sha256('omf-navi-create|'+operationId)`. Its marker is written in the same original insert; the profiler shows one insert and no later update. A hard delete whose outcome cannot be proven stays `unresolved` for the user and is never repeated.

Projections (`invoiceResultValues`, `receiptView`, `budgetView`, `recurringView`) never carry:
- creator, company or marker;
- contacts or bank text;
- file paths, raw OCR or private metadata.

Summary (`get_company_finance_summary`):
- Range: explicit `dateFrom`/`dateTo`, at most ten years, in whole local days of the company's saved time zone. Without a saved zone it uses JST and reports `timeZoneEvidence: not_saved_default_Asia/Tokyo`.
- Transactions are grouped by recorded currency (`currency`, else `metadata.currency`), type and status. Currencies are never added together; unknown currencies form a separate, explicit group.
- Invoices (by issue date), calendar plans (by due date, suppressed bills excluded) and receipts (by receipt date, else upload date) are grouped separately.
- The fiscal year comes only from the saved start month; it is `null` when none is recorded.
- Nothing is described as a cash or bank balance.

Clock: each claim adds `facts.clock` to the job context: the server's `capturedAt`, the saved time zone and the local business date. It also adds `facts.companySettings`: the saved default currency and fiscal start month.

Native roots scoped in this phase. Each now uses a fresh `calendarCompany` check with no global fallback, and response shapes are unchanged:
- `server/api/reports/index.ts`: all transaction aggregates, receipts, and the recurring count and estimate.
- `server/api/reports/tax.ts`: also returns `evidence: saved_bookkeeping_not_a_tax_deduction_verdict`.
- `server/api/analytics/index.ts`: every helper, the comparison period and the receipt statistics.

Invoice print preview (`/api/invoices/:id/pdf`). It is still HTML, not a binary PDF.
- Every saved value is HTML-escaped; newlines become `<br>` only after escaping.
- A `Content-Security-Policy` header and meta tag forbid scripts, frames, images and remote loads. The inline print script is removed.
- The invoices page fetches the preview with the bearer header (never a token in the URL), for the current actor and company.
- The page opens it from an owned blob URL and revokes that URL after 60 s.
- When the request is refused or the token changed, the page shows an error and opens nothing.

GUI refresh. A done business receipt calls `assistant.receiveCompanyResource({actorId, organizationId, kinds, id, effect})`, which carries ids only.
- The dashboard, transaction list and detail, invoices, calendar, budgets and recurring pages reload from their own native endpoints, and only while the actor and company are still current.
- If Navi deletes a transaction while its detail page is open, the page shows a "deleted" notice instead of reloading.
- The owner workspace shows the posting destination from the server-checked `postingCompany` in its own response. It accepts that value only for the token company it was read with and no longer reads the cached `user.organizations`.

Caller inventory. Navi calls the company-workspace routes in `[...path].ts`, which go through `financeCompanyAssistantService`, then the journal (`financeCompanyActionService`), then the adapters (`companyNaviBusinessService`), then the native services above. The native pages call the same services.

These routes are not called by Navi and are not claimed tenant-safe (recorded in `output/omf-navi-finish-20261019/auxiliary-api-findings.json`):
- `backup/schedule.ts` (writes every company to the server disk) and the shared `/api/templates`;
- `search.ts`, `notifications` and `email/send-reminders.ts`;
- receipt match, unmatch, auto-match, OCR and delete. These are global multi-writes, so receipts stay read-only for Navi.

Native import/backup/restore (final review F1/F2, plan omf-navi-import-restore-20261020). Navi still does not call them. `POST /api/transactions/import`, `GET /api/backup` and `POST /api/backup/restore` now use the fresh selected-company boundary: import saves through `createCompanyTransaction` with a company-scoped duplicate check; export holds only the company's recorded rows with a scope block; restore writes only rows recorded for that company, with the current actor as creator and no Navi/card markers, scopes duplicates and clear-existing to the company, and reports skipped other-company/unassigned/malformed/invalid rows. The import and settings pages name the company and drop replies that arrive after a switch. These rows are immediately visible to the company pages and company Navi reads. Details, guard exits and limits: [company import and restore](company-import-restore.md). This is not a full G4/SaaS closure.

Registered unused accounts (2026-10-20, plan omf-navi-account-registrations-20261020). Navi's `list_company_transaction_choices` still lists references observed in the company's last 500 transactions. It now also lists 勘定科目/補助科目 that the company registered for Navi, even ones never used, with `source: company_registration`, the actual parent of a sub-account, and a literal `accountQuery` / `accountPage` (50 per page, `registeredAccounts.hasMore`). Every other reference stays history-only, and nothing global is listed.
- A registration is made by the native create (`POST /api/account-categories`) when a company is selected, in the same insert. It can also be made explicitly with `POST /api/account-categories/:id/registration` from the transaction modal and form. Both use the token company with fresh membership; the body is ignored.
- A create with no selected company stays the legacy shared create with no registration. No legacy account is adopted.
- The registration list is hidden from every ordinary read, and an update cannot write or erase it.
- Registration is availability only. It saves no transaction, and the shared chart's edit/delete policy is unchanged (wider G4).
- Teachings may suggest a registered account.
- Callers, guards and limits: [company account registrations](navi-company-account-registrations.md).

Still open:
- real product-model dialogue, including an explicit cannot-answer-yet case;
- live public web;
- the final independent Opus review of the new guards;
- historical and production observation;
- wider SaaS isolation.
