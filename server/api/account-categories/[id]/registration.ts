// server/api/account-categories/[id]/registration.ts
// POST: make an existing account available to the selected company's Navi. The company is the token's, checked fresh now; the
// body is ignored (no company, actor or registry from the client). Idempotent; registering saves no transaction and does not make
// the shared account company-owned.
import { defineEventHandler, getMethod, createError } from 'h3'
import { ensureConnection } from '../../../config/database'
import { requireAuth } from '../../../middleware/auth'
import { calendarCompany } from '../../../utils/calendarAccess'
import { registerAccountForCompany } from '../../../services/companyAccountRegistrationService'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  if (getMethod(event) !== 'POST') throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  await ensureConnection()
  const { auth, organizationId } = await calendarCompany(event)
  return registerAccountForCompany(String(event.context.params?.id || ''), organizationId, auth.userId)
})
