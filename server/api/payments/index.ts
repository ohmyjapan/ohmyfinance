// server/api/payments/index.ts
import { defineEventHandler, readBody, getQuery, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import { Payment } from '../../models/Payment'

// Parse date string to noon UTC to avoid timezone boundary issues
// Input: "2026-01-26" -> Output: Date object representing 2026-01-26 12:00:00 UTC
// Using noon UTC ensures the date part remains the same in any timezone (UTC-12 to UTC+14)
const parseDateToNoonUTC = (dateString: string): Date => {
  // If it's just a date string (YYYY-MM-DD), parse as noon UTC
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [year, month, day] = dateString.split('-').map(Number)
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0))
  }
  // If it already has time component, parse as-is
  return new Date(dateString)
}

export default defineEventHandler(async (event) => {
  const method = event.method

  // Ensure MongoDB connection
  try {
    await ensureConnection()
  } catch (error) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Database connection failed',
      message: 'Unable to connect to database. Please ensure MongoDB is running.'
    })
  }

  // GET - List all payments
  if (method === 'GET') {
    const query = getQuery(event)

    // Build filter
    const filter: Record<string, any> = {}

    if (query.type) {
      filter.type = query.type
    }

    if (query.status) {
      filter.status = query.status
    }

    if (query.category) {
      filter.category = query.category
    }

    // Date range filter
    if (query.startDate || query.endDate) {
      filter.dueDate = {}
      if (query.startDate) {
        filter.dueDate.$gte = parseDateToNoonUTC(query.startDate as string)
      }
      if (query.endDate) {
        filter.dueDate.$lte = parseDateToNoonUTC(query.endDate as string)
      }
    }

    try {
      const payments = await Payment.find(filter).sort({ dueDate: 1 })
      return payments
    } catch (error: any) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to fetch payments',
        message: error.message
      })
    }
  }

  // POST - Create new payment
  if (method === 'POST') {
    const body = await readBody(event)

    if (!body.title || !body.amount || !body.dueDate || !body.type || !body.category) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Missing required fields: title, amount, dueDate, type, category'
      })
    }

    try {
      const payment = new Payment({
        title: body.title,
        amount: parseFloat(body.amount),
        currency: body.currency || 'JPY',
        dueDate: parseDateToNoonUTC(body.dueDate),
        type: body.type,
        status: body.status || 'pending',
        category: body.category,
        recurring: body.recurring || false,
        recurringFrequency: body.recurringFrequency,
        bankTransfer: body.bankTransfer,
        notes: body.notes
      })

      await payment.save()
      return payment
    } catch (error: any) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to create payment',
        message: error.message
      })
    }
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method not allowed'
  })
})
