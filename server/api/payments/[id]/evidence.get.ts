// server/api/payments/[id]/evidence.get.ts — the supplier originals linked to one saved calendar entry and its verification record
// (plan omf-calendar-evidence-20261029 §2). Same company door as every calendar reader (calendarCompany: selected company, fresh
// membership); another company's entry and a hidden entry are 404. Names, sizes, hashes, dates and email text only: no paths, no bytes.
import { defineEventHandler, getRouterParam, createError, setHeader } from 'h3'
import { ensureConnection } from '../../../config/database'
import { requireAuth } from '../../../middleware/auth'
import { calendarCompany } from '../../../utils/calendarAccess'
import { listPaymentEvidence } from '../../../services/companyCalendarEvidenceService'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  setHeader(event, 'Cache-Control', 'no-store')
  await ensureConnection()
  const { organizationId } = await calendarCompany(event)
  try { return await listPaymentEvidence(organizationId, String(getRouterParam(event, 'id') || '')) }
  catch (error: any) {
    if (error?.statusCode) throw error
    console.error('[Calendar evidence] read failed', error?.name || 'Error')
    throw createError({ statusCode: 500, statusMessage: 'Failed to read calendar evidence' })
  }
})
