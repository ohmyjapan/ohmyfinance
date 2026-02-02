// server/api/payments/[id].ts
import { defineEventHandler, readBody, createError, getRouterParam } from 'h3'
import { ensureConnection } from '../../config/database'
import { Payment } from '../../models/Payment'

// Parse date string to noon UTC to avoid timezone boundary issues
const parseDateToNoonUTC = (dateString: string): Date => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [year, month, day] = dateString.split('-').map(Number)
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0))
  }
  return new Date(dateString)
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const method = event.method

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Payment ID is required'
    })
  }

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

  // GET - Get single payment
  if (method === 'GET') {
    try {
      const payment = await Payment.findById(id)

      if (!payment) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Payment not found'
        })
      }

      return payment
    } catch (error: any) {
      if (error.statusCode === 404) throw error
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to fetch payment',
        message: error.message
      })
    }
  }

  // PUT - Update payment
  if (method === 'PUT') {
    const body = await readBody(event)

    try {
      const updateData: Record<string, any> = {}

      // Only update provided fields
      if (body.title !== undefined) updateData.title = body.title
      if (body.amount !== undefined) updateData.amount = parseFloat(body.amount)
      if (body.currency !== undefined) updateData.currency = body.currency
      if (body.dueDate !== undefined) updateData.dueDate = parseDateToNoonUTC(body.dueDate)
      if (body.type !== undefined) updateData.type = body.type
      if (body.status !== undefined) updateData.status = body.status
      if (body.category !== undefined) updateData.category = body.category
      if (body.recurring !== undefined) updateData.recurring = body.recurring
      if (body.recurringFrequency !== undefined) updateData.recurringFrequency = body.recurringFrequency
      if (body.bankTransfer !== undefined) updateData.bankTransfer = body.bankTransfer
      if (body.notes !== undefined) updateData.notes = body.notes

      const payment = await Payment.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true, runValidators: true }
      )

      if (!payment) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Payment not found'
        })
      }

      return payment
    } catch (error: any) {
      if (error.statusCode === 404) throw error
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to update payment',
        message: error.message
      })
    }
  }

  // DELETE - Delete payment
  if (method === 'DELETE') {
    try {
      const payment = await Payment.findByIdAndDelete(id)

      if (!payment) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Payment not found'
        })
      }

      return { success: true, message: 'Payment deleted successfully' }
    } catch (error: any) {
      if (error.statusCode === 404) throw error
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to delete payment',
        message: error.message
      })
    }
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method not allowed'
  })
})
