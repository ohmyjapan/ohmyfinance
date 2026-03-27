// server/api/recurring/index.ts
import { defineEventHandler, getQuery, readBody, createError } from 'h3'
import {
  getRecurringPayments,
  createRecurringPayment,
  getRecurringPaymentStats
} from '../../services/recurringPaymentService'
import { requireAuth } from '../../middleware/auth'

/**
 * GET /api/recurring - List all recurring payments
 * POST /api/recurring - Create new recurring payment
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  const method = event.method

  // GET - List recurring payments
  if (method === 'GET') {
    try {
      const query = getQuery(event)

      // Check if stats are requested
      if (query.stats === 'true') {
        const stats = await getRecurringPaymentStats()
        return { success: true, ...stats }
      }

      const filters: Record<string, any> = {}
      if (query.status) filters.status = query.status
      if (query.frequency) filters.frequency = query.frequency
      if (query.search) filters.search = query.search

      const payments = await getRecurringPayments(filters)
      return payments
    } catch (error: any) {
      console.error('Error fetching recurring payments:', error)
      throw createError({
        statusCode: 500,
        statusMessage: error.message || 'Failed to fetch recurring payments'
      })
    }
  }

  // POST - Create recurring payment
  if (method === 'POST') {
    try {
      const body = await readBody(event)

      // Validate required fields
      if (!body.name || !body.amount || !body.frequency || !body.startDate || !body.customer?.name) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Missing required fields: name, amount, frequency, startDate, customer.name'
        })
      }

      // Validate frequency
      const validFrequencies = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']
      if (!validFrequencies.includes(body.frequency)) {
        throw createError({
          statusCode: 400,
          statusMessage: `Invalid frequency. Must be one of: ${validFrequencies.join(', ')}`
        })
      }

      const payment = await createRecurringPayment({
        name: body.name,
        description: body.description,
        amount: parseFloat(body.amount),
        currency: body.currency || 'JPY',
        frequency: body.frequency,
        dayOfMonth: body.dayOfMonth,
        dayOfWeek: body.dayOfWeek,
        startDate: new Date(body.startDate),
        endDate: body.endDate ? new Date(body.endDate) : undefined,
        nextDueDate: body.nextDueDate ? new Date(body.nextDueDate) : new Date(body.startDate),
        source: body.source || 'manual',
        customer: body.customer,
        category: body.category,
        tags: body.tags,
        notes: body.notes,
        autoGenerate: body.autoGenerate !== false,
        metadata: body.metadata
      })

      return {
        success: true,
        message: 'Recurring payment created',
        payment
      }
    } catch (error: any) {
      if (error.statusCode) throw error
      console.error('Error creating recurring payment:', error)
      throw createError({
        statusCode: 500,
        statusMessage: error.message || 'Failed to create recurring payment'
      })
    }
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method not allowed'
  })
})
