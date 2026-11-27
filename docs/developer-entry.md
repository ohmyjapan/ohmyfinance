# Developer entry into a customer's account

A developer can enter a customer's OMF account for up to 60 minutes and see the pages as the customer sees them, with the customer's real values. Inside an entry the developer can read everything the customer can read and do the eight 購入受付 writes listed below; every other write is refused. Every request inside an entry is recorded, and the customer's own activity log shows "開発者が入室" and "開発者が退室".

## Who is a developer

An ordinary OMF user whose id is in the `platformdevelopers` collection (`server/models/PlatformDeveloper.ts`). Only the operator command writes that list, on the server:

```
npx tsx scripts/manage-developers.ts list
npx tsx scripts/manage-developers.ts add <email or user id> [--note <text>] [--apply]
npx tsx scripts/manage-developers.ts remove <email or user id> [--apply]
```

`MONGO_URI` is required; add and remove are dry runs without `--apply`. No route, role, token claim, environment variable or first-user rule adds anyone.

`requireDeveloper` (`server/utils/developerAccess.ts`) is checked at every developer request: the ordinary sign-in, the user on the list (read at this request), an active account, the token's session version equal to the user's current one (a token minted before a password change is refused at once), and 2FA on. `GET /api/developer/me` answers `{ developer: true | false }` to any signed-in user so the sidebar can show the 開発者 link; every other `/api/developer/` path passes `requireDeveloper` first. A developer cannot be entered, by themselves or by another developer.

## Starting an entry

The developer signs in as themselves and opens 開発者 (`/developer`). The page lists the accounts that can be entered (`GET /api/developer/accounts`: active users that are not developers, with id, email, name and their companies' ids and names; nothing else). The developer chooses an account and one of its companies (none when it has none), may type a reason, and presses 入る.

`POST /api/developer/entries { userId, organizationId, reason }` ends any entry this developer still has open, writes the entry row, writes "開発者が入室" (with the entry id and reason) into the customer's activity log, and answers the entry token and the customer's profile in the shape of `GET /api/auth/me`. Nothing is done to the customer: no password check, no `lastLoginAt`, no `loginAttempts`, no sign-in line under their name.

## The entry token

One signed token `{ type: 'entry', eid, jti, forUser, forCompany }`, expiring when the entry ends (`signEntryToken` / `verifyEntryToken` in `server/services/authService.ts`). It has no `userId`, `email`, `organizationId` or `role` claim, so every existing reader refuses it: `verifyAccessToken` needs a user id and the access type, and each `verifyToken` reader (renewal, sign-out of a refresh token, 2FA completion, invitation) demands its own type. `server/middleware/auth.ts` leaves a request with an entry token unauthenticated. There is no refresh token for an entry.

`forUser` and `forCompany` are for the browser only: `tokenClaims` (`utils/auth-session.ts`) hands them on as `userId` and `organizationId`, so the pages that take the person and company from the token show the customer's data. No server code reads them; who is entered, by whom and into which company is the entry row.

## Every request inside an entry

`server/middleware/developerEntry.ts` runs after `auth.ts` and before `error.ts`, `file-upload.ts`, `rateLimit.ts` and `viewerReadOnly.ts` (Nitro runs the middleware files in name order):

1. Not an `/api/` path, no bearer, or an ordinary sign-in already found → nothing.
2. The bearer must verify as an entry token; anything else → nothing.
3. The entry row is read: not ended, not past its end, the same token id; the developer still on the list, active, with the session version of the start; the customer still active and not a developer. A failure ends the row with the reason and answers 401 `DEVELOPER_ENTRY_ENDED`. A row that cannot be read answers 503.
4. `POST /api/auth/logout` ends the row (終了) and answers itself.
5. `GET /api/developer/me` answers `{ developer: false }` itself. A request the entry does not allow answers 403 `DEVELOPER_ENTRY_REFUSED` and is recorded.
6. One line is written for the request before the handler runs. If it cannot be written, the request is refused (503), reads included.
7. The request then runs as the customer: their id and current email, the entry's company and their role there, read at this request.

If this middleware were missing, an entry token would sign in nobody.

## What an entry may do

One rule, `entryRequestDecision` in `server/services/developerEntryService.ts`, decided from method and path (query removed) before any handler:

- **Reading.** Every GET is open, as for the customer, except everything under `/api/developer/`, everything under `/api/auth/` but `GET /api/auth/me`, and everything under `/api/invites/`. `/api/admin/**` stays refused for everyone (`legacyAdminAccess.ts`).
- **The eight writes** (all in `server/api/finance-intake/[...path].ts`), each matched as a whole path with a 24-character lower-case id where an id stands:

| Allowed inside | What it is |
|---|---|
| `POST /api/finance-intake/files` | upload a file |
| `POST /api/finance-intake/files/:id/preview`, `POST …/import` | check and import it |
| `POST /api/finance-intake/records`, `PATCH /api/finance-intake/records/:id` | add or edit an order |
| `PUT /api/finance-intake/records/:id/archive` | archive or restore an order |
| `POST /api/finance-intake/records/:id/documents` | attach a file to an order |
| `PUT /api/finance-intake/templates` | save a column template |

- **Everything else that is not GET, HEAD or OPTIONS is refused**, including a longer, shorter, differently cased or encoded form of an allowed path, the old upload paths (`/api/upload/transaction`, `/receipt`), the per-order T-number lookup, Navi writes, and every path added to OMF later until it is named here.

A refused call shows the one refusal notice OMF already has for 閲覧のみ, with the entry's message; the page keeps working. An allowed write into a company where the customer is 閲覧のみ still answers `VIEWER_READ_ONLY`, as for the customer.

## The record

- `developerentries`: developer, customer, company, reason, start, planned end, actual end, how it ended (developer / expired / removed from the list / developer's password changed / customer deactivated / replaced by the developer's next entry / developer deactivated / customer made a developer / token mismatch), the developer's address and browser.
- `developerentryrequests`: entry id, time, method, path, status code (added when the response is sent), refused or not. Values and request bodies are not kept; for orders, the order's own history holds the before and after of every edit and import.
- `GET /api/developer/entries` shows the newest 50 entries with their lines, changes first; the 開発者 page shows them.
- The customer's activity log (`GET /api/audit`, their own lines) shows `developer_entered` and `developer_left` with the entry id and reason. An entry whose time ran out while nobody used it gets its "left" line when the developer next opens 開発者 or starts an entry. The "left" line is always dated at the entry's end (the row's `endedAt`; for an entry that ran out, its planned end), not at the moment it is written, so the activity log page shows when the developer really left.

## The customer's session and credentials

Their sessions keep working; their password, 2FA, PIN, trusted devices, session version and last sign-in are not read or changed. No ordinary token for the customer can come out of an entry: sign-in needs the password, renewal a refresh token, 2FA completion its pending token, and the company switch, password change and both invitation routes are refused by path. A password change by the customer does not end an entry; one by the developer does.

## In the browser

`stores/user.ts` keeps the developer's own session under `ohmyfinance_developer_session` while inside and puts the entry token in place with no refresh token. The banner (`components/common/DeveloperEntryBanner.vue`) names the customer and company, shows the time left and has 終了. The browser leaves the entry and returns to the developer's session at `/developer` on 終了, on the screen lock (which then asks for the developer's own password or PIN), when renewal would be due (up to a minute before the entry's end), on any 401 inside (the server ended it), and when another tab leaves. All tabs share the session, so entering or leaving in one tab takes every tab with it. When two tabs leave at once (both reach the entry's time together), the one that finds the kept session already put back by the other goes on with that stored session; only when no session is stored, or the stored one is still the entry's with nothing kept, does leaving sign out. The developer's own access token may run out while inside; it is renewed with the kept refresh token on leaving.

## Limits

- The entry works on any account that is not a developer's.
- A stolen developer sign-in can start entries for as long as it lasts (30 minutes without its refresh token); 2FA on the developer's account is what stands in front of it. The developer signing out on another device does not end an open entry.
- 2FA is checked when an entry starts, not at each request inside it.
- Some reads change small bookkeeping, as they do for the customer (an order's lookup card settles a lookup whose worker went away).

## Verification

`scripts/developer-integration.cjs` (built app, its own throwaway MongoDB, invented people and companies, installed Chrome headless with `OMF_DEVELOPER_BROWSER=1`) and `scripts/developer-entry-session.test.cjs` (the browser session code), run through the hub verifier as the fixture `omf-developer-entry`, which also runs a packaged copy of the build and four copies with one defect put back each (no entry-row check; every write allowed; `verifyAccessToken` accepting the entry type; `developerEntry.ts` doing nothing) and requires the named checks to fail on each.
