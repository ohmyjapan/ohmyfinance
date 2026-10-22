# Legacy global administration is unavailable

The five legacy global administration routes refuse every call: `/api/admin/users`, `/api/admin/users/:id`, `/api/admin/organizations`, `/api/admin/organizations/:id` and `/api/admin/organizations/:id/members`, for every method. Each handler first calls `rejectLegacyPlatformAdmin` (`server/utils/legacyAdminAccess.ts`), before any route parameter, body or database access. A request without a valid sign-in gets 401 (the existing API middleware and the native `requireAuth`). A signed-in request gets a stable 403 with `data.code` `GLOBAL_ADMIN_UNAVAILABLE` and `data.organizationSettings` `/settings/organization`. The response carries no user, company or member record, and nothing is written.

## Why

OMF has no trusted platform principal. The token `role` is the selected company's role (`generateTokens` in `authService.ts`), and the user model has no platform authority field. Before this change the five handlers had no server authorization: any signed-in user, including the owner or admin of one company, could list every user and company, change or delete them, create a company for any owner, and add herself to another company with any role, then open that company's records and company Navi through the normal membership checks. The client page middleware's role check (`middleware/admin.ts`) was never a server boundary.

The refusal reads no environment allowlist, role claim, bootstrap user or hidden override. A future platform support role needs its own separately designed principal that cannot grant itself company membership or read company content; masked support (goal G4) stays a separate design.

## What stays the same

Company members and permissions are managed per company in organization settings: `server/api/organizations/[id]/members.ts`, `server/api/organizations/[id].ts` and the invite routes keep their own active-membership and owner/admin checks, owner protections and invite flow. Sign-in, sessions, company switching, profile self-service, the company Navi membership checks and every financial operation are unchanged. The legacy handler bodies remain in the source behind the refusal.

The legacy pages `pages/admin/users/index.vue` and `pages/admin/organizations/index.vue` still exist; their API calls now receive the refusal, so they show no records.

## Navi

The catalogue entry `admin` (`shared/finance-navi-features.mjs`) is `unsupported` with no route. Navi explains that the legacy global administration is unavailable, that a company owner or admin role gives no authority over other companies or users, and that the user's own company members are managed in 組織設定. A company or owner reply that links `admin` is refused; the organization settings page stays linkable. Page context on `/admin/...` still names the entry.

## Source map (self-mapped, FOLD)

Upstream: the two legacy pages and any script that calls the five routes -> the five handlers -> `rejectLegacyPlatformAdmin` -> native `requireAuth`. Downstream: 401 or the stable 403; the user continues in `/settings/organization` through the native per-company routes. Navi catalogue consumers (`financeCompanyAssistantService` `list_navi_features` and reply validation, `financeOwnerActionService` owner realm, `teaching-worker/interpreter.mjs` link enums, `AssistantConversation.vue` links, `AssistantPanel.vue` page context) read the entry through the shared module. There are no Menu51 Article/Memo callers on this seam.

## Verification

`scripts/finance-platform-admin-integration.cjs`, run only through the hub verifier as fixture `omf-platform-admin`, uses the built app on loopback, an owned MongoMemoryServer and synthetic people and companies:

1. A company A owner cannot add herself to company B, read B or the user list; B's membership is unchanged and B's company Navi stays forbidden to her.
2. All five route shapes x GET/HEAD/POST/PUT/PATCH/DELETE for nine unauthenticated forms (none, Basic, garbage, empty, wrong secret, expired, refresh, 2FA-pending, invite) get 401, and ten signed-in forms (companyless, A member/admin/owner, owner without a selected company, B owner, signed platform-admin/superadmin/foreign-owner/system claims) get the stable 403, without record text or writes.
3. Query, id, body, trailing/double slash, case and percent-encoding variants and malformed JSON bodies reach no record and change nothing; the CORS preflight carries no record.
4. Repeated and concurrent refused calls leave memberships, emails, companies and ledgers unchanged.
5. Native member list, owner/admin role changes, owner protections, member limits, removal and invite-based re-entry, company update, profile self-service, own-company reads and company Navi for A and B work as before.
6. A real company Navi turn on the built server lists `admin` as unsupported with no route, refuses an `admin` link and accepts the organization settings link.
7. A fresh session gets 403, the same session after sign-out 401, and a deleted account's token changes nothing.
8. After an owned-app restart the boundary still refuses with no writes and native company management still answers.

The fixture also runs a packaged copy of the same build (must pass) and that copy with the compiled `rejectLegacyPlatformAdmin` returning at once (must fail the cross-company assertion).

## Limits

No platform principal, masked support viewer, operator-blind storage or automatic membership is provided. Sign-out revocation is the existing in-memory list and is not restart-safe; the refusal does not depend on it. Memberships or edits made through the legacy routes before this change cannot be told apart from normal ones by `joinedAt` alone, and no production data was examined. No model, provider, mail or bank call is made by the tests, and synthetic counts are not a reliability rate. This is a shared guard: independent review, the shared-guard audit and the final deployed replay remain required.
