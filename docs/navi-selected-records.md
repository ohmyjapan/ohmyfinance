# Consult Navi about an exact saved company record

Plan `output/plan/omf-navi-agent-selection-20261022` (F6). The four ordinary company finance pages let a person ask Navi about one exact saved record without opening an editor, and the server checks that record against the current company before anything is queued.

## What a person does

- A small `Naviに相談` button sits beside every saved invoice (`pages/invoices/index.vue`, under the invoice number), budget (`pages/budgets/index.vue`, under the name), recurring payment (`pages/recurring/index.vue`, under the name) and calendar entry in the upcoming list and the read-only day list (`components/calendar/UpcomingPayments.vue`, `components/calendar/DayDetailModal.vue`). It is one shared component, `components/finance/NaviConsultButton.vue`, imported explicitly. It is always visible (never hover-only), a real button for mouse, keyboard and touch, at least 28 px high, with an accessible name that includes the record label.
- The click opens the existing Navi rail (`assistant.show()` without a target, so a remembered owner purchase target is kept), shows the record label in the context strip with a `外す` clear action, focuses the rail, and returns focus to that same button on close without scrolling the document. An unsent message, a pinned archive or teaching and the conversation all stay.
- From History or Memory, a consultation (also of the same record again) returns to the live chat. A plain close/reopen, a page change, a token refresh or a list reload keeps the current view and focus.
- The click never opens or closes an editor and never publishes form values. Only the read-only day list closes when one of its rows is consulted; a payment editor is never closed by it.

## The pointer

`composables/useNaviRecordSelection.ts` is the one narrow page-owned publisher. On the explicit click it writes `assistant.pageSelection = {path, actorId, organizationId, invoiceId | paymentId | budgetId | recurringPaymentId, label, origin}`:

- `actorId`/`organizationId` are the token's current identity at that click; `path` is the current route.
- `origin = {publisher, publication}` names the page instance and this consultation. Each consultation is a new publication, so consulting the same record again counts; cleanup compares the publisher, so a page can never clear a newer pointer of another page (the mapping page publishes its own while the invoices page unmounts).
- No watcher ever publishes. Ids and the label are context for the server's check and display only, never authority.

Cleared by its own publisher only: explicit clear, opening an editor or a new-record form, an actor or company change, the exact successful deletion of that record, and unmount. A same-identity token refresh keeps it; the old pointer is never reinterpreted when an identity comes back.

The listed rows are consultable only for the identity they were loaded for. Each page's native list load records the actor/company it started under and acknowledges a successful reply that is still in that identity (`loading()`/`loaded()`; invoices, budgets and recurring discard a reply for another identity, the calendar keeps its store rows but does not acknowledge them). After another tab switches the company or a sign-out, the rows on screen belong to the previous identity: their buttons stay focusable, announce why and do nothing, until a list load of the current identity succeeds. A legitimate reload on the same page instance (for example the existing company-resource reload after a Navi change in the new company) makes the new rows consultable without a full reload; the acknowledgement never publishes a selection, changes a consultation or moves the view or focus. A delayed reply requested for the previous company is never acknowledged.

Deletion: a done Navi deletion or an issuer card bill's suppression (the existing `companyResource` signal: same actor, same company, the record's kind, exactly its id, effect `delete`) or the page's own successful native delete clears it. A different record's deletion, a refused Navi deletion, a cancelled or failed native delete, an `unresolved` lost delete reply and a list that merely no longer shows the row keep it. A suppression clears the selection of the displayed entry; the issuer facts stay saved.

## Panel and conversation

`components/finance/AssistantPanel.vue` forwards a pointer only while its page, actor and company are the current ones (`companyPointer`), and only the id of the matching page: `invoiceId` on `invoices`, `paymentId` on `calendar`, `budgetId` on `budgets`, `recurringPaymentId` on `recurring`. Owner page selections (mapping, learning, intake, payment matching) and the route-derived transaction/receipt pointers are unchanged. The panel derives a consultation stamp (publisher and publication) and passes it to the conversation as a separate prop; it is never sent to the server. The panel remembers the initiating action in component memory only, never in the store.

`components/finance/AssistantConversation.vue` switches History/Memory to the live chat only when that stamp changes to a new publication.

## Server

`server/services/financeCompanyAssistantService.ts`:

- `selection()` accepts `budgetId` only on `budgets` and `recurringPaymentId` only on `recurring` (strict id syntax), like the existing invoice/calendar/transaction/receipt pointers. They are part of the frozen target and request identity, handed to the claiming worker as `job.target` and `facts.selection`.
- Before anything is stored, each selected or pinned record is read through its own scoped native reader for the current company: `getCompanyBudget` and `getRecurringPaymentById` (null means 404), and the existing invoice, calendar, transaction, receipt and archive/teaching readers. Another company's record or a removed one is refused; nothing is queued.
- That one refusal carries `data.selectedRecordMissing: true` (the reader's own status and message stay, with a Japanese explanation in `data.message`). It means only that THIS attempt found the record missing and stored nothing. It is not proof about another attempt of the same request id: the earlier `previous` lookup and the queue write are not one fence, so an earlier attempt still in flight could be accepted.

## A record removed before the first send

Source trace before this change: the conversation freezes a pending request (id, text, context) before its POST and reuses it on every later press. If another member removed the selected record first, the unchanged app refused the send, kept the frozen request ("送信結果を確認"), showed a generic error and repeated the same refused request forever; New chat is disabled with no turns, and there is no pending-cancel control. The fixture reproduced this on the unchanged build with the existing transaction-detail selection.

The smallest exit: a request created by a press and refused with the mark on that, its first and only attempt, is released (`AssistantConversation.send`); the typed text stays. The person clears or changes the target (or leaves the record page) and the next send is a new request with the current context, accepted once. A lost reply, a conflict (another tab's pending question), access and network errors keep the request, so the next press is recognised as the same request. A request that was already sent once (its reply may have been lost) stays the same pending request even when a later attempt meets the mark, until its outcome is seen; this unknown-then-missing case still has no in-app exit other than a reload (which drops unsent text), and a broader cancellation fence would be a separate protocol. No automatic retry, no confirmation step, no existence check removed.

## Verification

`scripts/zoomer-fixtures/omf-navi-selection.mjs` (run only through the hub verifier) runs `scripts/finance-navi-selection-integration.cjs` and `scripts/finance-navi-selection-browser.cjs`: owned MongoMemoryServer, the built app on loopback, installed headless Chrome, synthetic people/companies/records, simulated worker claims and replies.

- `target` (native): budget/recurring pointers on their own pages, frozen and claimed exactly; wrong pages and malformed ids refused; foreign and removed records refused before storage and marked; the existing pointers keep their native messages; request identity frozen; accepted ids recognised.
- `gui-consult`: invoice, budget, recurring, upcoming and day-list consultations at 390 (touch), 768 (keyboard Tab/Enter) and 1365 (mouse): visible without hover, named, label and clear action, rail focus, no record write, read-only day list closes, the claimed job's exact target; the closed status and read state of a consulted reply.
- `gui-lifecycle`: explicit clear, editor and new form (dirty editor values kept while a Navi deletion reloads the list underneath), unmount with the mapping page's newer pointer kept, another page, another tab's company switch (old rows not consultable, no reinterpretation on the way back), a legitimate company-B reload on the same page instance (new rows consultable, nothing published, History and typed text kept), a delayed company-A calendar reply never acknowledged for B, same-identity token refresh.
- `gui-view`: History and Memory to live chat, unsent text and pinned evidence kept, rail focus, focus returned without scrolling, close/reopen and page change keep the view.
- `gui-delete`: Navi deletion, the page's own delete and an issuer bill suppression clear; other-record, refused, cancelled and failed deletions keep; the following send has no stale id.
- `gui-missing`: the missing target (transaction detail and a consulted recurring payment), a lost reply, another tab's pending question and another tab's new chat, and an induced unknown first attempt followed by the mark (same pending id kept).

The packaged copy of the build must pass every group, and 23 compiled defects (server page/scope/mark checks; composable identity, refresh, unmount, stale-row, row-acknowledgement and deletion rules; the invoices editor and page delete; the conversation's live view, release and first-attempt rules; the panel's focus return and no-scroll close; the read-only day list) must each fail at its own named assertion.

## Guards for the independent review

New guard surface: the budget/recurring page-and-scope checks before queue, the marked missing-record refusal and the client's release of exactly a first attempt's refusal, the panel's actor/company/path match for these pointers, and the composable's identity, row-acknowledgement and deletion rules (with the recurring list now discarding a reply for another identity). The panel match and the invoices/budgets/recurring page-level discards are defence in depth behind the composable's own clear and identity check: no single-defect test can observe them alone.

## Limits

Transport, scope, lifecycle and GUI behaviour only: not the model's judgement about a selected record (the later actual-model corpus must change one selected record and verify only that record), not a production reliability rate. Touch is Chrome's touch emulation, not a physical phone or Safari. Pages under a language prefix (`/ko/...`) never had the company conversation; the button stays unavailable there. The upcoming and day lists show only what the calendar store already loaded.
