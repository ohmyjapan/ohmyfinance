# Support connection report

The existing OMF assistant accordion includes a separate, collapsed 「サポート用の接続診断」 section. A signed-in customer can generate and download a JSON report, inspect its fixed fields, then share it themselves. Creating it does not send anything to support. The report lives only in the current component until refresh, sign-out, lock/unmount or another request. Downloaded files remain on the customer's device.

`GET /api/support/report` reads only the authenticated user's active worker/collector metadata and checks that the user still exists. It accepts no user/company override. It returns a random per-request reference, generation time, schema version, the explicit `signed_in_user` scope, a 65-second heartbeat window, and three enumerated statuses. A reference identifies the exported report; it is not a stored support case, credential or lookup key.

- Navi uses `workspaceEnabled` and `chatLastSeenAt`.
- Research uses `researchEnabled` and `lastSeenAt`.
- Collector uses `lastSeenAt`.
- Revoked/disabled workers are excluded. Missing, stale or future signals do not indicate recent connectivity. A recent signal does not prove a successful model answer, bank login, download or completed business action.

The new API uses explicit field projections and a fixed output object. Errors contain only fixed codes; all responses are `no-store`. The UI validates and picks fields again before rendering/export, clears an earlier result during retry and discards stale session responses. This is a new authentication/output/stale-state guard and needs independent review before release.

## Caller and custody limits

Only `SupportReport.vue` calls the endpoint, from `AssistantPanel.vue`; this section is outside the bounded chat area and follows its existing light/dark styles. Existing conversation, draft and financial actions are unchanged. No platform support role, cross-company membership, impersonation, unmask exception, email/Slack send, provider call or AI call is added. The scope is a user's technical connections, not a company-wide support console.

This feature does **not** make OMF infrastructure operators unable to read raw records. Existing database/runtime/key access, backup/restore routes, audit exports, logging and AI worker artifacts require separate protection. Existing database connection logging also remains unchanged; this report's generic error boundary does not sanitize all server logs. G4 and the every-feature Navi goal remain open. No production deployment or historical customer-data evaluation is implied by synthetic tests.

Verification uses the actual built HTTP endpoint in an owned temporary Mongo process, two synthetic users, Mongo query profiling for metadata-only reads, legitimate/stale/revoked/disabled states, override attempts, deleted users, parallel/retry requests, safe errors, deliberate defects, and real installed Chrome with an isolated profile and actual JSON downloads. No live customer records, banking sessions or business sends are used. Fixture: `scripts/zoomer-fixtures/omf-support-report.mjs` through the hub's contained fixture runner.
