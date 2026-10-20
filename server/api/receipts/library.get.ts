import { defineEventHandler, createError, setHeader } from 'h3'
import { requireAuth } from '../../middleware/auth'
import { calendarCompany } from '../../utils/calendarAccess'
import { ensureConnection } from '../../config/database'
import { getReceiptLibrary } from '../../services/receiptLibraryService'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'no-store')
  requireAuth(event)
  await ensureConnection()
  const { organizationId } = await calendarCompany(event)
  try { return await getReceiptLibrary(organizationId) }
  catch { throw createError({ statusCode: 500, statusMessage: 'Failed to read company receipt library' }) }
})
