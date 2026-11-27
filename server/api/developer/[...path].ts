// server/api/developer/[...path].ts — the developer routes (plan omf-order-mapping piece 5, §4.2, §4.5). GET me answers
// { developer: true|false } to any signed-in user, so an ordinary user's sidebar check is not an error; every other path here passes
// requireDeveloper first (server/utils/developerAccess.ts), unknown paths included:
//   GET  accounts   the users that can be entered: id, email, name and their companies' names (with the company id), nothing else
//   GET  entries    the record: entries newest first with their request lines, changes first
//   POST entries    { userId, organizationId, reason } starts an entry and answers its token and the target's profile
// Inside an entry nothing here is reached: server/middleware/developerEntry.ts refuses /api/developer/** and answers GET me itself.
import { defineEventHandler, setHeader, createError, readBody, getHeader } from 'h3'
import { requireAuth } from '../../middleware/auth'
import { isDeveloper, requireDeveloper } from '../../utils/developerAccess'
import { requestClient } from '../../utils/request-client'
import { listEnterableAccounts, listEntries, startEntry } from '../../services/developerEntryService'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'no-store')
  const parts = (event.path.split('?')[0].split('/api/developer/')[1] || '').split('/').filter(Boolean), method = event.method
  if (parts.length === 1 && parts[0] === 'me' && method === 'GET') {
    const auth = requireAuth(event)
    return { developer: await isDeveloper(auth.userId) }
  }
  const { auth, user } = await requireDeveloper(event)
  if (parts.length === 1 && parts[0] === 'accounts' && method === 'GET') return listEnterableAccounts()
  if (parts.length === 1 && parts[0] === 'entries' && method === 'GET') return listEntries()
  if (parts.length === 1 && parts[0] === 'entries' && method === 'POST') {
    const body = await readBody(event).catch(() => null)
    return startEntry({ userId: auth.userId, sessionVersion: user.sessionVersion ?? 0 }, body, { ipAddress: requestClient(event), userAgent: String(getHeader(event, 'user-agent') || '').slice(0, 500) })
  }
  throw createError({ statusCode: 404, statusMessage: 'Developer endpoint not found' })
})
