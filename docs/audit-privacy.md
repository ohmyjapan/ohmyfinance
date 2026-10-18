# Personal audit access

`GET /api/audit` is a personal activity view. It queries both rows and counts with the authenticated existing user's `userId`. Query/body user, owner, company or role claims do not select another user's data. An admin label grants no global audit access. Rows without `userId` are excluded rather than guessed from email/entity name. Response `scope` is `signed_in_user`.

The current schema has no company identifier. Current native writers cover authentication/security events and downloader-connect authentication; known-user events set `userId`, while unknown-email failures do not. This repair does not create company/team audit permissions, reinterpret historical data or claim that actor ownership establishes company authorization for future financial audit events. Company-aware financial audit is still a separate prerequisite.

Own authorized audit details and the existing `logs`/`pagination` response remain available. Sorting, entity/action/date filters and pagination operate inside the personal filter. Malformed nonpositive/unsafe pagination falls back; page size is capped at100. Invalid dates return a fixed400 code. Non-GET requests, missing/invalid auth and deleted users are refused. Responses are `no-store`. The route's internal failure response/log uses fixed text; errors contain empty result containers and no raw exception or request URL.

## Source map (self-mapped, FOLD)

Header/sidebar links -> `pages/audit/index.vue` -> this single API -> `AuditLog.find` and `countDocuments`. Native writers in `authService`, MFA verification limiter, PIN/2FA/logout routes and collector-connect authentication -> `logAudit` -> the same collection. No writer, shared authentication function, schema, company model, Navi tool or frontend implementation changes. There are no Menu51 Article/Memo callers on this seam.

The new personal/live-user/method/input/error checks are customer-path guards and require independent exact-source review. The contained fixture uses real built HTTP, owned synthetic Mongo, actual login/logout writer receipts, two-user nested sentinels, query overrides, legitimate filters/pagination, revocation within one runtime, parallel/retry reads, a clean server restart, an injected internal failure and deliberate behavioral defects. Read snapshots exclude intentional auth writes; the audit reads do not change audit/financial/action records.

## Limits

This closes one application API's global audit read. It does not provide a masked financial record viewer, a platform support principal, operator-blind storage or protection for other APIs, backup/restore, database access, worker files or existing audit writer/DB logging. Infrastructure operators still need separate key/runtime custody design. Shared token blacklist storage is an existing in-memory Map; restart-safe or cross-process revocation is not supplied by this repair. The restart test uses an active user's token and makes no durability claim about revoked tokens.

No customer/production audit records, provider/model calls or external messages are used in these tests. Historical corpus evaluation, normal production observation, independent review and deployed replay remain pending; synthetic test counts are not a reliability estimate. All four Navi/privacy goals remain open.
