// server/utils/legacyAdminAccess.ts
// The legacy global administration routes (server/api/admin/**) list, change and delete every user and company and add anyone to
// any company. OMF has no trusted platform principal: the token's `role` is the selected company's role, so a company owner or
// admin holds no authority over other companies or users. No environment list, role claim, bootstrap user or hidden override is
// read here. Every legacy call is refused before any parameter, body or database access: 401 without a valid sign-in (the native
// requireAuth), otherwise a stable 403. Company members are managed per company in organization settings through
// server/api/organizations/[id]/members.ts and the invite routes, which keep their own membership and role checks.
import { createError, type H3Event } from 'h3'
import { requireAuth } from '../middleware/auth'

const GLOBAL_ADMIN_UNAVAILABLE = 'GLOBAL_ADMIN_UNAVAILABLE'

// Always throws (401 or 403). Typed void rather than never so the unchanged legacy handler bodies behind it keep their type
// narrowing; none of that code runs.
export function rejectLegacyPlatformAdmin(event: H3Event): void {
  requireAuth(event)
  throw createError({
    statusCode: 403,
    statusMessage: 'Global administration is unavailable',
    message: 'Global administration is unavailable. Company members are managed in organization settings.',
    data: { code: GLOBAL_ADMIN_UNAVAILABLE, organizationSettings: '/settings/organization' }
  })
}
