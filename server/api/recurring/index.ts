// server/api/recurring/index.ts
import { defineEventHandler, getQuery, readBody, createError, setHeader } from 'h3'
import {
  getRecurringPayments,
  createRecurringPayment,
  getRecurringPaymentStats
} from '../../services/recurringPaymentService'
import { requireAuth } from '../../middleware/auth'
import { ensureConnection } from '../../config/database'
import { calendarCompany } from '../../utils/calendarAccess'

/**
 * GET /api/recurring - List the selected company's recurring payments
 * POST /api/recurring - Create a recurring payment in the selected company
 * The company is the token's selected company with a fresh active membership, never the request body.
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
  const { auth: recurringActor, organizationId: recurringCompany } = await calendarCompany(event)

  // GET - List recurring payments
  if (method === 'GET') {
    try {
      const query = getQuery(event)

      // Check if stats are requested
      if (query.stats === 'true') {
        const stats = await getRecurringPaymentStats(recurringCompany)
        return { success: true, ...stats }
      }

      return await getRecurringPayments(recurringCompany, { status: query.status, frequency: query.frequency, search: query.search })
    } catch (error: any) {
      if (error?.statusCode && error.statusCode < 500) throw error
      console.error('Company recurring payment read failed')
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to fetch recurring payments'
      })
    }
  }

  // POST - Create recurring payment (required: name, amount, currency, transactionType, frequency, startDate, customer.name)
  try {
    const payment = await createRecurringPayment(recurringCompany, recurringActor.userId, await readBody(event))
    return {
      success: true,
      message: 'Recurring payment created',
      payment
    }
  } catch (error: any) {
    if (error?.statusCode && error.statusCode < 500) throw error
    console.error('Company recurring payment creation failed')
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to create recurring payment'
    })
  }
})
