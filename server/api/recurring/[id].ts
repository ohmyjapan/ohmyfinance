// server/api/recurring/[id].ts
import { defineEventHandler, readBody, createError, setHeader } from 'h3'
import {
  getRecurringPaymentById,
  updateRecurringPayment,
  deleteRecurringPayment,
  generateTransaction
} from '../../services/recurringPaymentService'
import { requireAuth } from '../../middleware/auth'
import { ensureConnection } from '../../config/database'
import { calendarCompany } from '../../utils/calendarAccess'

/**
 * GET /api/recurring/:id - Get a recurring payment of the selected company
 * PUT /api/recurring/:id - Partially update it (whitelisted fields)
 * DELETE /api/recurring/:id - Delete it
 * POST /api/recurring/:id - Save the pending forecast for body.expectedNextDueDate (the nextDueDate the caller read)
 */
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  requireAuth(event)
  const id = event.context.params?.id
  const method = event.method

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Recurring payment ID is required'
    })
  }
  if (!['GET', 'PUT', 'PATCH', 'DELETE', 'POST'].includes(method)) {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method not allowed'
    })
  }
  await ensureConnection()
  const { organizationId: recurringItemCompany } = await calendarCompany(event)

  try {
    // GET - Get single recurring payment
    if (method === 'GET') {
      const payment = await getRecurringPaymentById(recurringItemCompany, id)
      if (!payment) {
        throw createError({
          statusCode: 404,
          statusMessage: `Recurring payment ${id} not found`
        })
      }
      return payment
    }

    // PUT - Update recurring payment
    if (method === 'PUT' || method === 'PATCH') {
      const payment = await updateRecurringPayment(recurringItemCompany, id, await readBody(event))
      return {
        success: true,
        message: 'Recurring payment updated',
        payment
      }
    }

    // DELETE - Delete recurring payment
    if (method === 'DELETE') {
      const payment = await deleteRecurringPayment(recurringItemCompany, id)
      return {
        success: true,
        message: 'Recurring payment deleted',
        payment
      }
    }

    // POST - Save the pending forecast for exactly the cycle the caller read
    const body = await readBody(event)
    const result = await generateTransaction(recurringItemCompany, id, { expectedNextDueDate: body?.expectedNextDueDate })
    return {
      success: true,
      message: result.existing ? 'Forecast already saved for this cycle' : 'Pending forecast saved',
      ...result
    }
  } catch (error: any) {
    if (error?.statusCode && error.statusCode < 500) throw error
    console.error('Company recurring payment request failed')
    throw createError({
      statusCode: 500,
      statusMessage: method === 'POST' ? 'Failed to generate transaction' : 'Failed to process recurring payment'
    })
  }
})
