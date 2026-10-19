// server/api/recurring/process.ts
import { defineEventHandler, createError, setHeader } from 'h3'
import { processDuePayments, getUpcomingPayments } from '../../services/recurringPaymentService'
import { requireAuth } from '../../middleware/auth'
import { ensureConnection } from '../../config/database'
import { calendarCompany } from '../../utils/calendarAccess'

/**
 * POST /api/recurring/process - Save pending forecasts for the selected company's due autoGenerate payments (one cycle each)
 * GET /api/recurring/process - Upcoming payments of the selected company, grouped by saved currency
 * There is no all-company or global scheduler: only the token's selected company with a fresh active membership.
 */
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  requireAuth(event)
  const method = event.method
  if (method !== 'GET' && method !== 'POST') {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method not allowed'
    })
  }
  await ensureConnection()
  const { organizationId: processCompany } = await calendarCompany(event)

  // GET - Get upcoming payments
  if (method === 'GET') {
    try {
      const upcoming = await getUpcomingPayments(processCompany, 30)
      return {
        success: true,
        ...upcoming
      }
    } catch (error: any) {
      if (error?.statusCode && error.statusCode < 500) throw error
      console.error('Company upcoming recurring read failed')
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to fetch upcoming payments'
      })
    }
  }

  // POST - Process due payments
  try {
    const results = await processDuePayments(processCompany)
    return {
      success: true,
      message: `Processed ${results.processed} payments, ${results.succeeded} succeeded, ${results.failed} failed`,
      ...results
    }
  } catch (error: any) {
    if (error?.statusCode && error.statusCode < 500) throw error
    console.error('Company recurring processing failed')
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to process due payments'
    })
  }
})
