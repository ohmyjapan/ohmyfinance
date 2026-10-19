# Navi company dialogue, teaching, pattern recall, new chat and feature guide

Self-mapped. Phase A of the owner's goal (2026-10-19) to finish OMF Navi as a Japanese-accountant agent. This builds on the company workspace described in [navi-company-workspace.md](navi-company-workspace.md). It does not complete the goal: browser research, other domain actions, privacy/audit, independent review and deployed checks remain open.

## Caller chain and authority

- Native user routes, all under `/api/finance-chat/company-workspace` and all behind `calendarCompany` (session-selected company plus fresh live membership):
  - `POST /new` — explicit new chat (`{chatRevision, requestId}`).
  - `GET /history?page=` — archived segments of this owner/company conversation.
  - `GET /history/:id` — one archived segment with its turns and receipts (read-only).
  - `GET /knowledge?status=active|paused|all&page=&query=` — inspect company teachings (read-only).
  - No generic HTTP/DB proxy is added. Teaching writes happen only through the worker tools below.
- Worker path, unchanged transport: `workspace-claim` -> company job (frozen actor/company, lease) -> TeachingWorker/MCP `omf_actions` -> `POST /worker/workspace/:id/actions` -> `actionCompanyAssistant`. Every action rechecks lease, frozen scope and live membership before and after the operation (`working`), as the existing 11 tools do.
- The company catalogue is now 17 tools. The original 11 keep their exact semantics. The six new tools are:
  - `find_company_transaction_patterns` (read)
  - `search_company_knowledge` (read)
  - `list_navi_features` (read)
  - `remember_company_knowledge` (write)
  - `correct_company_knowledge` (write)
  - `set_company_knowledge_status` (write)

## Company teaching (FinanceCompanyKnowledge)

- Company-owned rows. Each row records:
  - `createdBy`
  - `instruction`
  - `status` (`active` or `paused`)
  - `revision`
  - optional conditions: `merchant`, `cardLast4`, `effectiveFrom`
  - optional suggested references: account, subaccount, tax, category, customer, supplier
  - immutable `source`: actor, conversation, segment, turn id, exact quote, time, and optional checked company transaction
  - `history`: one snapshot per correction or status change, with `replacedBy` turn/quote/actor
  - `operations`: durable journal markers
- Legacy owner learning, decision memories and other companies are never read or adopted.
- **Remember:** the instruction must be a verbatim substring of the server-stored CURRENT user message, so model wording or hypotheses cannot become a confirmed teaching. Suggested references must appear in this company's observed transaction history (`companyTransactionChoices`). A transaction pointer must be a company record. These checks run before the journal claims a slot, so a refused call leaves no receipt.
- **Correct and pause/resume:** the expected revision is enforced by the single atomic update filter. The previous content is pushed to `history`, and the original `source` stays immutable.
- **Effects:** a teaching never changes a transaction, invoice, payment, draft, ledger or legacy learning. Tests compare all financial collections before and after.
- **Journal:** teaching writes share the existing company journal (slot/intent claim, `claimed -> done|failed|unresolved`). The operation marker on the knowledge row is written atomically with the change. `reconcileCompanyActions` settles a lost reply from that marker, and an unknown expired claim becomes `unresolved` and is never repeated.
- **Recall:** at claim, active teachings of the frozen company only, related by merchant condition or shared wording with the current message or selected transaction. At most 8 are sent, with provenance and the active total. Paused rows and replaced wording are never supplied. Recall is read fresh at claim, so a pause or correction made after the message was sent already applies. The model can also search, by default active only.
- **Inspection:** members of the company can list its teachings, including paused rows and history. The source quote is shown; the full original message is not copied into the row.

## Pattern evidence

`find_company_transaction_patterns` reads this company's saved transactions:

- The merchant text is matched literally (regex-escaped) over the existing search fields.
- At most 500 rows are scanned, with explicit truncation.
- Optional card last-4 and date filters.

It returns:

- classification groups with counts and first/last dates
- dated examples of every group, consistent and conflicting
- `conflicting` / `consistent` flags
- the exact `cardAccounting` account and subaccount names with counts (never a generic 未払金)
- receipt-flag counts

`not_recorded_in_OMF` means OMF has no saved flag, not that no receipt exists. Historical classification is labelled evidence, not legal or tax truth.

## New chat and history

- The live conversation keeps its unique owner/company index. New fields: `segment` (current number) and `lastReset` (last accepted request id, archive id and fingerprint).
- `POST /new` steps:
  1. Reconcile receipts.
  2. Refuse a stale revision (409 reload), an answer in progress (409 with the retry/status lane) or a still-claimed action (409). After the 20-second grace, an expired unknown claim becomes `unresolved` and is archived as such.
  3. Insert an immutable archive copy of the segment with every receipt.
  4. In one revision-, segment- and state-checked update, empty the live turns and advance the segment.
- **Lost reply:** the same request id returns the current view. A crash between the two writes leaves an un-adopted copy that is never listed (only segments below the live segment are listed). It is replaced on the next reset of that segment, because its turns are still live.
- **History reads:** every read requires current membership plus an owner/company-scoped archive identity.
- **200-turn stop:** it now answers with the new-chat lane. The UI shows the limit and the "新しい会話" button.
- No receipts are deleted. Archives are not editable.

## Feature catalogue and navigation

- `shared/finance-navi-features.mjs` maps every page file under `pages/` to one disposition (test-enforced):
  - `navi_tool` — transactions, invoices and calendar, with their tool names
  - `page_handoff` — the page itself provides the feature; Navi only points to it
  - `unsupported` with a reason — authentication, company create/join/switch, collector approval link and dev test pages
- Sensitive security, integration and admin pages are marked.
- A company reply may carry `navigation: {feature, transactionId?}`. The server validates it against the catalogue, and checks the transaction id against the frozen company at finish. The UI renders a link only from the fixed catalogue route.
- Navigation happens only on the user's click; no navigation intent is persisted, so nothing replays on reload. There are no arbitrary URLs, tokens, query strings or tenant switches.

## Dialogue

- Company replies may now be up to 4000 characters (legacy general and purchase replies keep 800). The company JSON schema and validator allow only kind `unclear`/`defer` with an empty patch and quotes, plus optional navigation.
- The worker validates company jobs with the company validator; general and purchase validation are unchanged.
- The company prompt keeps the accountant role and model `claude-opus-5-5` / effort `high`, and now instructs:
  - answer first, with reasoning and alternatives
  - hypothetical questions write nothing
  - remember only on an explicit request, with verbatim words
  - saving a field and remembering are separate
  - cite teachings with their dates
  - exact card credit names and receipt-flag meaning
  - answer from the feature guide

## UI

- In the company accordion, the conversation adds 会話 / 履歴 / 記憶 views and a 新しい会話 button. The button is disabled while an answer is pending or with no turns.
- The 記憶 view shows status, revision, source date, conditions, suggested names and earlier wording.
- Teaching receipts trigger a scoped reload of an open 記憶 view via the store.
- Archive and teaching text stay in component memory, never in browser storage.
- The panel shows the current page's catalogue disposition.
- The girl avatar, accordion, pending-message buffer and legacy/purchase conversations are unchanged.

## Tested behavior

`scripts/zoomer-fixtures/omf-company-knowledge.mjs` runs `scripts/finance-company-knowledge-integration.cjs` on the built application with its own MongoDB: 8 groups, an unchanged packaged control, and 8 compiled defects:

- paused recall
- model-invented teaching
- foreign teaching write
- stale revision
- foreign archive read
- regex pattern
- foreign record navigation
- cross-company list

The existing `omf-company-assistant` fixture still passes its 8 groups and 31 defects, with the deliberate catalogue count change 11 -> 17. Unit tests cover the catalogue/page mapping, routes, validators, schema and prompt contracts.

## Limits

- Membership/lease checks and writes are not one database transaction, as before.
- Recall relevance is merchant or wording overlap, not semantic search.
- Pattern scanning is bounded to 500 matching rows.
- Teachings are shared by all members of the company, including viewers. The viewer write policy is unchanged from the existing company tools.
- No real-model answer quality, installed-Chrome UI acceptance or production reliability is claimed here. The parent runs real-model and browser acceptance.
- No replay: no production population exists for this new data.

## Business context and refresh (2026-10-20, C3)

- **Pages.** The company conversation now runs on every normal company page (see `navi-company-workspace.md`). Teaching, recall, new chat and history, and the pinned inspector work as before.
- **History.** Navi can also find archived conversations and teachings itself, with `list_company_conversation_history`, `get_company_conversation_archive` and `get_company_knowledge`. They are quoted as evidence and never authorise a save.
- **Unknown answers.** The company system and the shared accountant role now carry this rule: when the owner says they do not know or cannot answer yet, that is the current answer. Navi keeps the point open, never asks it again, and completes the requested review with the open point stated. No post-response keyword filter enforces this.
- **Dates.** Replies name local days in the company's saved time zone, using `facts.clock`; a JST message sent after midnight is not "yesterday". Saved timestamps stay literal UTC instants.
- **Pattern examples.** They use the same whitelisted currency source as the transaction view: `currency`, else the card statement's `metadata.currency`, with `currencyEvidence`. A missing currency stays unknown.
- **Refresh.** A done business receipt refreshes the open native page of the same actor and company. The conversation, its buffer and the pinned record stay in place.
