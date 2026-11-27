// server/middleware/developerEntry.ts — a request made inside a developer entry (plan omf-order-mapping §4.4). GUARD.
// Nitro runs server/middleware files in name order: after auth.ts (which leaves an entry token unauthenticated, as any token it does
// not accept) and before error.ts, file-upload.ts (which answers the old upload paths itself), rateLimit.ts and viewerReadOnly.ts.
//   1 Not an /api/ path, no bearer, or auth.ts already found an ordinary sign-in → nothing (a customer's request costs one comparison).
//   2 The bearer must verify as an entry token (signature, expiry, type 'entry', an entry id); anything else → nothing.
//   3 The entry row, read now: open, not past its end, the same token id; the developer still on the list, active, with the session
//     version of the start; the target still active and not a developer. A failure ends the row and answers 401 DEVELOPER_ENTRY_ENDED.
//     A row that cannot be read answers 503.
//   4 POST /api/auth/logout ends the row here; logout.ts is not reached.
//   5 GET /api/developer/me answers { developer: false } here. Any other request the entry does not allow (developerEntryService
//     entryRequestDecision) → 403 DEVELOPER_ENTRY_REFUSED, recorded.
//   6 One line for the request is written before the handler runs; if it cannot be written the request is refused (503), reads too.
//   7 event.context.auth becomes the target: id and current email, the entry's company, the target's role there read now.
// If this file were missing, an entry token would sign in nobody: no other reader accepts it.
import { defineEventHandler, getHeader, createError, type H3Event } from 'h3'
import { verifyEntryToken, type EntryTokenPayload } from '../services/authService'
import { companyRole } from '../utils/calendarAccess'
import {
  checkEntry, endEntry, entryRequestDecision, recordEntryRequest, recordEntryStatus,
  DEVELOPER_ENTRY_ENDED, DEVELOPER_ENTRY_ENDED_MESSAGE, DEVELOPER_ENTRY_REFUSED, DEVELOPER_ENTRY_REFUSED_MESSAGE
} from '../services/developerEntryService'

const unavailable = () => createError({ statusCode: 503, statusMessage: 'Developer entry unavailable', message: '開発者の入室を確認できません。少し待ってからもう一度お試しください。', data: { code: 'DEVELOPER_ENTRY_UNAVAILABLE' } })

async function developerEntryRequest(event: H3Event, payload: EntryTokenPayload, path: string) {
  const method = event.method, pathname = path.split('?')[0]
  let checked: Awaited<ReturnType<typeof checkEntry>>
  try { checked = await checkEntry(payload) } catch { throw unavailable() }
  if (!checked.ok) throw createError({ statusCode: 401, statusMessage: 'Developer entry ended', message: DEVELOPER_ENTRY_ENDED_MESSAGE, data: { code: DEVELOPER_ENTRY_ENDED, message: DEVELOPER_ENTRY_ENDED_MESSAGE } })
  const { entry, target } = checked
  const decision = entryRequestDecision(method, pathname)
  if (decision === 'logout') {
    try { await endEntry(entry, 'developer') } catch { throw unavailable() }
    return { success: true, ended: true }
  }
  if (decision === 'me') return { developer: false }
  if (decision === 'refused') {
    try { await recordEntryRequest(entry._id, method, pathname, true) } catch { /* refused either way */ }
    throw createError({ statusCode: 403, statusMessage: 'Developer entry refused', message: DEVELOPER_ENTRY_REFUSED_MESSAGE, data: { code: DEVELOPER_ENTRY_REFUSED, message: DEVELOPER_ENTRY_REFUSED_MESSAGE } })
  }
  let role: string | null
  try {
    const lineId = await recordEntryRequest(entry._id, method, pathname, false)
    event.node.res.once('finish', () => recordEntryStatus(lineId, event.node.res.statusCode))
    role = entry.organizationId ? await companyRole(String(target._id), String(entry.organizationId)) : null
  } catch { throw unavailable() }
  event.context.auth = {
    userId: String(target._id),
    email: target.email,
    organizationId: entry.organizationId ? String(entry.organizationId) : undefined,
    role: role ?? undefined,
    isAuthenticated: true
  }
}

export default defineEventHandler(async (event: H3Event) => {
  if (event.context.auth?.isAuthenticated) return
  const path = event.path || event.node.req.url || ''
  if (!path.startsWith('/api/')) return
  const header = getHeader(event, 'authorization')
  if (!header || !header.startsWith('Bearer ')) return
  const payload = verifyEntryToken(header.substring(7))
  if (!payload) return
  return developerEntryRequest(event, payload, path)
})
