# Company Navi workspace

Self-mapped (FOLD). Explicit GET/POST `/api/finance-chat/company-workspace` and POST `/company-workspace/retry` use the session selected company plus native source user and fresh active membership. Company conversations live in a separate owner/company-unique collection. Server actor/company fields are immutable; each turn/context captures the same identity. Legacy owner/purchase chats are not adopted, reindexed, shared or changed. Same request id can exist independently in different companies; a repeated request within one company must retain its text and selection.

Caller chain: native company route -> company assistant -> separate stored turn/context -> existing workspace worker claim -> company-only tool catalogue -> shared invoice/calendar read operation -> rechecked live job/member -> native result. Existing workspace worker protocol and model/provider selection are unchanged. Legacy jobs retain priority in the existing claim endpoint; company jobs are picked when no legacy job is available. Legacy journal recovery remains untouched. Heartbeat widens the old renewal exit to recognize company jobs and does not renew legacy operation journals for them.

New company jobs expose four read tools: list/detail of company invoices and visible calendar entries. The same domain queries serve native GET routes. Invoice pagination/counts, actual currency/dates, saved status and printed issuer T are retained; model results omit bank details and contact addresses. Calendar reads retain suppression and adoption/source facts, preserve noon-date/filter behavior, and return at most100 entries with explicit truncation. Native page list behavior is unchanged. Saved paid/sent state is not bank settlement/email delivery; printed T is not fresh NTA verification. Invoice/calendar linkage is unestablished. No bank balance is supplied.

Company prompt history comes only from that company conversation, with stored submission/reply times. It contains no global legacy learning/reference/card or other-company context. Worker actions cannot name a different company, call legacy tools or write financial records. Queued jobs, explicit retry, lease renew/reclaim and result admission use stored actor/company, not current UI selection or model/body company IDs. A removed/inactive membership cannot execute, renew, read history or deliver a result. Revoked/inactive queued jobs fail without exposing their context. Checks and domain writes are not one atomic membership/database transaction; that narrow race is not claimed eliminated.

New guards: authenticated selected membership; owner/company conversation/history key; request text/selection identity; frozen turn/context identity; live member/job/lease checks; strict read catalogue/arguments; foreign and suppressed record scope. They require independent review. `companyMembership` extracts the existing calendar predicate unchanged for frozen worker use; the broader shared-boundary audit is still required. Native invoice/payment non-GET suffixes are LF-byte-identical to the base, with proof in the hub report. Existing invoice/calendar defect fixtures point to the moved shared query, retaining their original assertions.

This slice is API/worker functionality. The current UI is not wired to the new conversation route, company-switch response invalidation is not implemented, and Navi card posting stays legacy until company posting/draft/reference ownership is deliberately connected. Invoice/calendar mutations, bank settlement/Slack, memory/migration, viewer write policy, full operator/database/key/runtime custody, fresh native-model reasoning/historical/production observation and deployed replay remain open. A claimed API read or synthetic worker reply is not a real Opus evaluation or a production reliability rate.

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
