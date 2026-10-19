# Company Navi workspace

Self-mapped (FOLD). Explicit GET/POST `/api/finance-chat/company-workspace` and POST `/company-workspace/retry` use the session selected company plus native source user and fresh active membership. Company conversations live in a separate owner/company-unique collection. Server actor/company fields are immutable; each turn/context captures the same identity. Legacy owner/purchase chats are not adopted, reindexed, shared or changed. Same request id can exist independently in different companies; a repeated request within one company must retain its text and selection.

Caller chain: native company route -> company assistant -> separate stored turn/context -> existing workspace worker claim -> company-only tool catalogue -> shared invoice/calendar read operation -> rechecked live job/member -> native result. Existing workspace worker protocol and model/provider selection are unchanged. Legacy jobs retain priority in the existing claim endpoint; company jobs are picked when no legacy job is available. Legacy journal recovery remains untouched. Heartbeat widens the old renewal exit to recognize company jobs and does not renew legacy operation journals for them.

New company jobs expose four read tools: list/detail of company invoices and visible calendar entries. The same domain queries serve native GET routes. Invoice pagination/counts, actual currency/dates, saved status and printed issuer T are retained; model results omit bank details and contact addresses. Calendar reads retain suppression and adoption/source facts, preserve noon-date/filter behavior, and return at most100 entries with explicit truncation. Native page list behavior is unchanged. Saved paid/sent state is not bank settlement/email delivery; printed T is not fresh NTA verification. Invoice/calendar linkage is unestablished. No bank balance is supplied.

Company prompt history comes only from that company conversation, with stored submission/reply times. It contains no global legacy learning/reference/card or other-company context. Worker actions cannot name a different company, call legacy tools or write financial records. Queued jobs, explicit retry, lease renew/reclaim and result admission use stored actor/company, not current UI selection or model/body company IDs. A removed/inactive membership cannot execute, renew, read history or deliver a result. Revoked/inactive queued jobs fail without exposing their context. Checks and domain writes are not one atomic membership/database transaction; that narrow race is not claimed eliminated.

New guards: authenticated selected membership; owner/company conversation/history key; request text/selection identity; frozen turn/context identity; live member/job/lease checks; strict read catalogue/arguments; foreign and suppressed record scope. They require independent review. `companyMembership` extracts the existing calendar predicate unchanged for frozen worker use; the broader shared-boundary audit is still required. Native invoice/payment non-GET suffixes are LF-byte-identical to the base, with proof in the hub report. Existing invoice/calendar defect fixtures point to the moved shared query, retaining their original assertions.

Invoice and calendar pages now use the explicit company conversation in the existing accordion. Company identity comes from the active access token; the server independently authorizes membership. Other pages and purchase chats retain their separate legacy conversations. Navi card posting stays legacy until company posting/draft/reference ownership is deliberately connected. Invoice/calendar mutations, bank settlement/Slack, memory/migration, viewer write policy, full operator/database/key/runtime custody, fresh native-model reasoning/historical/production observation and deployed replay remain open. A claimed API read or synthetic worker reply is not a real Opus evaluation or a production reliability rate.

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
- Native401/403 clears the displayed company conversation and disables sending until authorized loading succeeds. New UI guards require independent review. Backend authority and financial writes remain unchanged.
- Installed Chrome exercises the production build with native authentication and owned synthetic DB. Delayed/lost responses wrap real authorized native requests, not mock records. No model/provider/business sends.
- TeachingWorker/MCP use the supplied catalogue without transport edits. Company interpreter keeps the Japanese accountant role and claude-opus-5-5/high, names the four read tools, preserves saved currencies and distinguishes saved status/printed T from external proof. Legacy JPY prompts are unchanged. Prompt assertions/mocked interpreter transport do not establish real native-model reasoning quality.

All-feature actions/teaching, scoped posting/mutations, legacy migration, historical/production shared-guard reliability, infrastructure/operator key/runtime custody, independent review and final deployed replay remain open.


Navi visual identity (owner direction2026-10-19): `NaviAvatar.vue` reuses the byte-identical63,785-byte original Chapter7 reference JPG from the OMF introduction film. The short-haired girl with glasses, cream blouse and red vest appears in the accordion/standalone purchase header and workspace/purchase/research reply labels. The image is decorative beside the visible OMF Navi name; dimensions reserve space before loading. CSS frames the original locally served image, with no new generated artwork, external asset host, animation, overlay or model/permission/financial behavior change. Existing accordion and responsive layout remain. This presentation increment does not add company mutations or close G1-G4.
