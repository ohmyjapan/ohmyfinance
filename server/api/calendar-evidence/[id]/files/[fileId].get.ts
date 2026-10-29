// server/api/calendar-evidence/[id]/files/[fileId].get.ts — the bytes of one retained original (plan omf-calendar-evidence-20261029 §2,
// GUARD): the selected company with a fresh membership check, the file must belong to a version of that invoice identity in that
// company (404 otherwise), the stored bytes must still hash to their id (400 otherwise). Delivered as finance-intake does: the saved
// type, nosniff, no-store and a UTF-8 filename.
import { defineEventHandler, getRouterParam, createError, setHeader } from 'h3'
import { ensureConnection } from '../../../../config/database'
import { requireAuth } from '../../../../middleware/auth'
import { calendarCompany } from '../../../../utils/calendarAccess'
import { readCalendarOriginal } from '../../../../services/companyCalendarEvidenceService'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  setHeader(event, 'Cache-Control', 'no-store')
  await ensureConnection()
  const { organizationId } = await calendarCompany(event)
  try {
    const { file, bytes } = await readCalendarOriginal(organizationId, String(getRouterParam(event, 'id') || ''), String(getRouterParam(event, 'fileId') || ''))
    setHeader(event, 'Content-Type', file.mimeType); setHeader(event, 'Content-Length', bytes.length); setHeader(event, 'X-Content-Type-Options', 'nosniff')
    setHeader(event, 'Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(file.name))
    return bytes
  } catch (error: any) {
    if (error?.statusCode) throw error
    console.error('[Calendar evidence] original read failed', error?.name || 'Error')
    throw createError({ statusCode: 500, statusMessage: 'Failed to read the original' })
  }
})
