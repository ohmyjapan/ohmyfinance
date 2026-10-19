# Company Navi public research and inspected-record context

Self-mapped (2026-10-20, plan `omf-navi-public-research-20261020`, source cb49d41). The company accountant investigates public facts herself, in the same interpreter turn as the answer: there is no separate research queue and no promise-only reply. The same turn can then save an explicitly requested, supported value through the existing named company tools.

## Who gets it

- Only a company conversation job, and only when the worker that claims it reports an actual capability.
- The teaching worker sends `{capabilities:{publicResearch}}` with each `workspace-claim` (`teaching-worker/worker.mjs`, re-checked every ten minutes):
  - `webSearch` and `publicPage` are always true: the CLI's built-in WebSearch and the public HTTPS reader.
  - `chrome` is true only when `research-worker/browser.mjs`, its collector dependencies and stock Chrome all load.
  - `registry` is `configured` only when the worker's own Vault holds `ntaApplicationId`. The id itself is never reported.
  - `publicResearch:false` in the teaching Vault turns it off.
- The server validates the report literally and stores it as `FinanceChatAgent.publicResearch` with `reportedAt`. A claim without a report clears it. It grants no account, mailbox, membership or private research access.
- `claimCompanyAssistant` freezes a fresh report (≤65 s) onto that claim's lease as `context.publicResearch`. A reclaim, a retry or a worker without the capability never inherits it.
- The job carries `publicResearch:{version,webSearch,publicPage,chrome,registry,today}`. `today` is the JST date. The server catalogue itself stays 17 tools.
- Legacy owner workspace jobs, purchase chats and the separate purchase research worker are unchanged.

## Worker side

- `teaching-worker/interpreter.mjs`: a research job gets `--tools WebSearch`, `--allowedTools mcp__omf_actions__* WebSearch`, 40 turns and a 480 s bound. Every other job keeps `--tools ''`, 16 turns and its 240/90 s bound. Model `claude-opus-5-5`/`high`, strict MCP config, empty setting sources, disabled hooks and no session persistence are unchanged.
- The research prompt section requires the accountant to:
  - research instead of asking permission;
  - put only public merchant, legal or tax terms into a search (never buyer or client names, emails, card digits, order numbers, private amounts or records);
  - treat search results as leads and capture pages before relying on them;
  - keep four things separate: published identity/T-number, official status at a date, purchase association and tax treatment;
  - copy T-numbers literally and never derive one from a corporation number;
  - say "not officially rechecked" when the registry connection is missing;
  - use today's JST date and primary sources (NTA, e-Gov) for current rules;
  - cite captured sources only.
- The reply schema gains `citations` (≤8 × `{sourceId, quote, claim}`).
- The job file names only `{chrome, registry}`. It carries no token and no NTA id.
- `teaching-worker/actions-mcp.mjs` composes the server catalogue with `teaching-worker/company-public-tools.mjs` in the same owned MCP server:
  - `read_public_page`: public HTTPS GET through `research-worker/http.mjs`, with public DNS pinning, public redirects only and limits. It refuses the registry website. The page is decoded by its meta charset, strict UTF-8, then Shift_JIS.
  - `read_public_page_in_chrome`: only when `chrome` is true. Headless owned Chrome on `jobs/<id>/chrome` in the private job directory. GET-only interception. The main document is fetched first, so Chrome opens the actual final URL. UTF-8 is labelled. The browser is closed after each read. Legacy supplier research keeps its defaults.
  - `verify_invoice_registration`: a literal `T` + 13 digits. The server prepares the date, then the worker calls the official NTA API only when the Vault has an id. Otherwise it returns `connection_required`.
  - `list_public_sources`, `read_public_source`.
- Every read is captured to the job's own route `POST /api/finance-chat/worker/workspace/:id/sources`. The route is lease-bound and accepts only `prepare | capture | list | read`; it is not a proxy. The token is only the header. A lost reply is retried with the identical body.
- Failed or refused reads are recorded as activity.
- Mail, sheets, the Issey archive, documents, files, shell and checkout are not reachable.

## Server evidence

`server/services/companyPublicResearchService.ts` and `server/models/FinanceCompanyPublicSource.ts`.

Each source is a separate document, bound to the owner/company/conversation/segment/turn derived from the frozen job. It stores:

- kind: `web`, `chrome` or `registry`
- status: `captured`, `failed` or `unavailable`
- the requested and final URL, title and literal text (≤60 000 characters, with a truncation flag)
- the SHA-256 hash (verified), the character count and the capture time
- the registry observation, when there is one

`{conversationId, turnId, captureId}` is unique, so a duplicate or concurrent delivery returns the same row. A captureId reused with different content is a 409. There are at most 16 captures per message.

Checks on each capture:

- A web or Chrome URL must be a syntactically public HTTPS address that is not the registry host.
- Registry evidence must use the canonical API URL of the prepared number and date. That URL has no application id.
- The registry response must parse (`parseRegistry`) as that number at that date.

Registry date authority (`prepare`) is set by the server, never by the model:

- the frozen company's transaction date (JST) or invoice issue date;
- else a date the current user message literally contains (`YYYY-MM-DD`, `YYYY/M/D`, `YYYY年M月D日`);
- else today in JST. Future dates are refused.

A missing NTA connection is stored as `unavailable` with the prepared date. It is never shown as a green check.

## Citations and display

`validateCompanyAssistantReply` now refuses unknown top-level fields and shape-checks `citations`. The legacy 800-character general and purchase validators are unchanged.

At `finishCompanyAssistant` every citation must quote, literally, a captured source of the same owner/company conversation. Whitespace runs may differ; characters and digits may not. Failed, unavailable, foreign or unknown sources fail the reply.

The stored citation carries the server's own kind, title, final URL, capture time and evidence (`published_page` or `official_registry_observation`), plus the registry date and authority. A source from an earlier turn is marked `retained_earlier`: it is a historical observation, not a fresh check.

Display:

- The live view and archived history show source cards (metadata only) under their turn, including a turn whose reply failed.
- Source text never enters chat or archive documents.
- `GET /company-workspace/sources/:id` returns bounded text (6 000 characters) to a current member of that company only.
- `AssistantConversation.vue` shows citations and a collapsed source list under the reply in the existing accordion:
  - normal HTTPS links;
  - registry date and status;
  - "not checked" for a missing connection;
  - failed reads.
- While the job works, the waiting line counts only reads the server already captured.

## Inspected-record context

The history and memory views are read-only and have no composer. "この会話について相談する" or "この記憶について相談する" pins the record into the chat: a chip shows it, and "外す" clears it.

The pinned pointer `{kind: archive|knowledge, id}` travels in the message context. The server then:

1. Validates the pointer.
2. Checks the record belongs to this owner/company: archives through `getCompanyConversationArchive`; teachings through `getCompanyKnowledgeItem` in any status, with provenance and history.
3. Stores the pointer on the turn as part of the request identity.
4. Reads the record fresh at claim and gives it to the job as `inspected`. An archive arrives as a bounded digest of turns, receipts, citations and source cards, never source bodies. A record that disappeared arrives marked unavailable.

The prompt treats archived messages and teaching quotes as evidence, never as fresh write instructions. A paused teaching is for discussion only and is still not recalled as guidance.

## Tests (owned, no model, no provider, no external page)

- `scripts/finance-company-public-research.test.mjs`:
  - shared rules;
  - the real `http.mjs` checks, with DNS and HTTPS replaced in-process;
  - capture transport, including the lost-reply retry;
  - registry literal and connection behaviour;
  - decoding;
  - capability;
  - an actual owned headless Chrome read with final URL, JavaScript, GET-only interception and process end.
- `scripts/finance-company-public-research-integration.cjs`: ten native groups on the built app with its own MongoDB, including the real actions MCP child with a temp DPAPI Vault and private and offline targets only.
- Contract additions in `scripts/finance-interpreter-stream.test.mjs`, `scripts/finance-chat.test.mjs` and `scripts/finance-assistant.test.mjs`.
- Fixture `scripts/zoomer-fixtures/omf-company-public-research.mjs`: units, the integration, an unchanged packaged control and nine compiled defects:
  - list scope
  - detail scope
  - literal quote
  - stated date
  - hash
  - capability gate
  - registry number
  - inspected teaching scope
  - citation conversation scope

## Open / not claimed

- Real-model research quality on live public pages and installed-Chrome UI acceptance are for the parent's separate acceptance run.
- The NTA application id is not configured: live registry checks are untested.
- Search-term privacy for the built-in WebSearch is a prompt rule; the CLI's search queries cannot be intercepted here.
- Chrome and HTTP reads trust the worker machine's network; the server checks captured URLs syntactically only.
- No supplier, ledger or teaching is written by research itself.
- F1 write-audit, F3 legacy disposition, wider G4 custody, other domain adapters, independent review and deployment checks remain open.
