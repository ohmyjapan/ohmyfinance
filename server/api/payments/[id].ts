import { updateCompanyCalendarEntry } from '../../services/companyPaymentWriteService'
import { getCompanyCalendarEntry } from '../../services/companyFinanceReadService'
// server/api/payments/[id].ts
import { defineEventHandler, readBody, createError, getRouterParam } from 'h3'
import { ensureConnection } from '../../config/database'
import { Payment } from '../../models/Payment'
import { requireAuth } from '../../middleware/auth'
import { calendarCompany } from '../../utils/calendarAccess'

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
      const payment = await updateCompanyCalendarEntry(organizationId, id, body)

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
