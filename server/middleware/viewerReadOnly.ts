// server/middleware/viewerReadOnly.ts — GUARD (plan omf-role-writes-20261101 C2): a 閲覧のみ member only reads. Nitro registers the
// server/middleware files sorted by name, so this runs after auth.ts has set event.context.auth. Every non-read /api request (and
// GET /api/seed, which writes the masters) by an authenticated token whose selected company holds the user as viewer — read fresh
// from the Organization at this request, never the token's role claim — answers 403 VIEWER_READ_ONLY before any handler runs.
// Own-account paths stay open to a viewer: /api/auth/* (logout, refresh, switch-organization, 2FA, PIN, password check, security
// preferences), /api/users/me and /api/users/me/password, POST /api/organizations (creating one's own company) and /api/invites/*.
// Collector (omfc_) and worker (omft_) tokens are never authenticated here and pass through; a token whose user is no longer a
// member passes through to the route's own membership check (no second decision here).
import { defineEventHandler, createError, type H3Event } from 'h3'
import { companyRole } from '../utils/calendarAccess'

export const VIEWER_READ_ONLY = 'VIEWER_READ_ONLY'
export const VIEWER_READ_ONLY_MESSAGE = '閲覧のみのメンバーは変更できません（閲覧だけができます）。'
const READ_METHODS = ['GET', 'HEAD', 'OPTIONS']

function ownAccountPath(path: string, method: string): boolean {
  if (path.startsWith('/api/auth/') || path.startsWith('/api/invites/')) return true
  if (path === '/api/users/me' || path.startsWith('/api/users/me/')) return true
  return method === 'POST' && path === '/api/organizations'
}

export default defineEventHandler(async (event: H3Event) => {
  const path = (event.path || event.node.req.url || '').split('?')[0]
  if (!path.startsWith('/api/')) return
  const method = event.method
  if (READ_METHODS.includes(method) && path !== '/api/seed') return
  const auth = event.context.auth
  if (!auth?.isAuthenticated || !auth.organizationId) return
  if (ownAccountPath(path, method)) return
  if (await companyRole(auth.userId, String(auth.organizationId)) !== 'viewer') return
  throw createError({ statusCode: 403, statusMessage: 'Viewer read only', message: VIEWER_READ_ONLY_MESSAGE, data: { code: VIEWER_READ_ONLY, message: VIEWER_READ_ONLY_MESSAGE } })
})
