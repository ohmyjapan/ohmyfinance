// server/api/payments/[id]/verification.put.ts — the owner's verification statement on one saved calendar entry (plan
// omf-calendar-evidence-20261029 §2): { state, reason, expectedUpdatedAt }. Its own route beside the calendar edit (whose whitelist
// never carries the record); the selected company and the actor come from the token with a fresh membership check; a stale snapshot
// is 409, never a silent overwrite. Writes only paymentVerification: status, amount and dates stay as saved.
import { defineEventHandler, getRouterParam, readBody, createError, setHeader } from 'h3'
import { ensureConnection } from '../../../config/database'
import { requireAuth } from '../../../middleware/auth'
import { calendarCompany } from '../../../utils/calendarAccess'
import { setPaymentVerification } from '../../../services/companyCalendarEvidenceService'

const allowed = ['state', 'reason', 'expectedUpdatedAt']
export default defineEventHandler(async (event) => {
  requireAuth(event)
  setHeader(event, 'Cache-Control', 'no-store')
  await ensureConnection()
  const { auth, organizationId } = await calendarCompany(event)
  const body = await readBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => !allowed.includes(k))) throw createError({ statusCode: 400, statusMessage: 'Send only state, reason and expectedUpdatedAt of the entry you read' })
  try { return await setPaymentVerification(organizationId, String(getRouterParam(event, 'id') || ''), body, { actorId: String(auth.userId) }) }
  catch (error: any) {
    if (error?.statusCode) throw error
    console.error('[Calendar evidence] verification failed', error?.name || 'Error')
    throw createError({ statusCode: 500, statusMessage: 'Failed to save the verification' })
  }
})
