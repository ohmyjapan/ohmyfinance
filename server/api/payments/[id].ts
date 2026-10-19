import { getCompanyCalendarEntry } from '../../services/companyFinanceReadService'
// server/api/payments/[id].ts
import { defineEventHandler, readBody, createError, getRouterParam } from 'h3'
import { ensureConnection } from '../../config/database'
import { Payment } from '../../models/Payment'
import { requireAuth } from '../../middleware/auth'
import { calendarCompany } from '../../utils/calendarAccess'

// Parse date string to noon UTC to avoid timezone boundary issues
const parseDateToNoonUTC = (dateString: string): Date => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [year, month, day] = dateString.split('-').map(Number)
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0))
  }
  return new Date(dateString)
}

export default defineEventHandler(async (event) => {
  requireAuth(event)
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

  // Scoped to the selected company, checked against its current membership (GUARD, plan omf-calendar-gmail-build-20261015
  // §2 S3/S16); another company's payment and a bill the owner removed from the calendar are 404 here.
  const { auth, organizationId } = await calendarCompany(event)
  const scope = { _id: id, organizationId, suppressedAt: { $exists: false } }

  // GET - Get single payment
  if (method === 'GET') {
    try {
      const payment = await getCompanyCalendarEntry(organizationId, id)

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

      // Settlement: paid or completed stamps settledAt once ($min keeps the first instant); never cleared here.
      const settled = updateData.status === 'paid' || updateData.status === 'completed'
      const payment = await Payment.findOneAndUpdate(
        scope,
        { $set: updateData, ...(settled ? { $min: { settledAt: new Date() } } : {}) },
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

  // DELETE - Delete payment. A bill the issuer's statement or notice produced is not erased but suppressed (B3): the row
  // keeps its financial fields, leaves every calendar reader, and a later notice or statement for that cycle can never
  // recreate it; only an explicit, freshly authorized restore brings it back. Manual payments are deleted as before.
  if (method === 'DELETE') {
    try {
      const payment = await Payment.findOne(scope)

      if (!payment) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Payment not found'
        })
      }

      if (payment.source?.kind === 'card-statement') {
        await Payment.updateOne({ _id: payment._id, organizationId, suppressedAt: { $exists: false } }, { $set: { suppressedAt: new Date(), suppressedBy: auth.userId } })
        return { success: true, suppressed: true, message: 'Payment removed from the calendar; the issuer cannot recreate it' }
      }

      await Payment.deleteOne({ _id: payment._id, organizationId })

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
