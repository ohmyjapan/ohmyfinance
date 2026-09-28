// server/api/recurring/process.ts
import { defineEventHandler, createError } from 'h3'
import { processDuePayments, getUpcomingPayments } from '../../services/recurringPaymentService'
import { requireLedgerAccess } from '../../services/ledgerAccessService'

/**
 * POST /api/recurring/process - Process all due recurring payments
 * GET /api/recurring/process - Get upcoming payments
 */
export default defineEventHandler(async (event) => {
  const access = await requireLedgerAccess(event, event.method === 'GET' ? 'read' : 'write')
  const method = event.method

  // GET - Get upcoming payments
  if (method === 'GET') {
    try {
      const upcoming = await getUpcomingPayments(access, 30)
      return {
        success: true,
        ...upcoming
      }
    } catch (error: any) {
      if (error.statusCode) throw error
      console.error('Error fetching upcoming payments:', error)
      throw createError({
        statusCode: 500,
        statusMessage: error.message || 'Failed to fetch upcoming payments'
      })
    }
  }

  // POST - Process due payments
  if (method === 'POST') {
    try {
      const results = await processDuePayments(access)
      return {
        success: true,
        message: `Processed ${results.processed} payments, ${results.succeeded} succeeded, ${results.failed} failed`,
        ...results
      }
    } catch (error: any) {
      if (error.statusCode) throw error
      console.error('Error processing due payments:', error)
      throw createError({
        statusCode: 500,
        statusMessage: error.message || 'Failed to process due payments'
      })
    }
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method not allowed'
  })
})
