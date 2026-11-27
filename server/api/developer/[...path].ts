// server/api/developer/[...path].ts — the developer routes (plan omf-order-mapping piece 5). GET me answers { developer: true|false }
// to any signed-in user, so an ordinary user's sidebar check is not an error; every other path here passes requireDeveloper first
// (server/utils/developerAccess.ts), unknown paths included.
import { defineEventHandler, setHeader, createError } from 'h3'
import { requireAuth } from '../../middleware/auth'
import { isDeveloper, requireDeveloper } from '../../utils/developerAccess'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'no-store')
  const parts = (event.path.split('?')[0].split('/api/developer/')[1] || '').split('/').filter(Boolean), method = event.method
  if (parts.length === 1 && parts[0] === 'me' && method === 'GET') {
    const auth = requireAuth(event)
    return { developer: await isDeveloper(auth.userId) }
  }
  await requireDeveloper(event)
  throw createError({ statusCode: 404, statusMessage: 'Developer endpoint not found' })
})
