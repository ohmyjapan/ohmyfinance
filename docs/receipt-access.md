# Company receipt reads

Native receipt list/filter/search, statistics, detail and CSV/Excel/JSON/full-JSON export now use the existing selected-company membership boundary. The user must still belong to an active company on each request; owner/admin/member/viewer remain readers. Missing selection, lost membership or inactive company is403. Foreign or unassigned receipt IDs are404. No ownership is guessed or migrated.

List and export pass a required company ID into `getReceipts`; statistics match that ID before their facet/count/rate computation. Detail uses `_id` plus company directly. Query/body company overrides are not used. The existing data, sorting/filter/export shapes and detail/export read-method compatibility remain. These are customer business reads and return permitted receipt details; they are not masked support reports. Responses are no-store; scoped read failures use fixed client error text and the changed service/export logs omit raw exceptions.

## Self-mapped callers (FOLD)

- `pages/receipts/upload.vue` actually calls native list using auth headers; `plugins/session.client.ts` supplies authenticated fetch behavior. List handles GET only; its POST block remains unchanged.
- Analytics page also requests receipt statistics. Settings links to receipt CSV export. The normal receipt composable still contains mock data/commented native reads; no claim that this build connects that page is made.
- These two list/export calls are all `getReceipts` consumers. Native list is the only consumer of this service's `getReceiptStats` (the analytics API has its own separate function).
- Detail previously used the unscoped `getReceiptById`. It now queries directly with company; that old helper and its matching-route consumers remain untouched and are not certified safe by this build.
- Shared `calendarCompany`, schema, data and other read/write/worker/model callers are unchanged. There are no Menu51 Article/Memo callers on this seam.

## Limits and checks

This is a read prerequisite. Receipt creation/upload, matching/candidates/auto-match, OCR, global analytics/backup and file-serving paths still need separate ownership work. The receipt `/pdf` path actually generates HTML from `Transaction`, whose current schema has no company ID. It is outside this repair. No complete receipt CRUD/document privacy, database/key/runtime masking or every-feature Navi completion is claimed. Existing unassigned receipts remain stored and excluded. No current customer data is assigned, deleted or exported here.

New company/query/statistic/error guards require independent exact-source review. Verification runs actual built routes with an owned temporary Mongo process: two companies and overlapping values, foreign/unassigned records, all existing export formats, legitimate roles, removed/inactive/forged membership, no company, parallel company tokens, read-only snapshots and clean restart. Forced-error and meaningful compiled-defect controls check the boundary. Synthetic counts are not a reliability estimate. No production/customer receipt read, model/provider/bank call, business send or UI implementation change is part of these checks. Historical/production observation and final deployed replay remain pending.
