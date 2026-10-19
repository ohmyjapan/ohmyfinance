import { listCompanyCalendarEntries } from '../../services/companyFinanceReadService'
import { createCompanyCalendarEntry } from '../../services/companyPaymentWriteService'
// server/api/payments/index.ts
import { defineEventHandler, readBody, getQuery, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import { requireAuth } from '../../middleware/auth'
import { calendarCompany } from '../../utils/calendarAccess'

export default defineEventHandler(async (event) => {
  requireAuth(event)
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

  // Every calendar reader and writer is scoped to the selected company, checked against its current membership
  // (GUARD, plan omf-calendar-gmail-build-20261015 §2 S2/S16): no company or a lapsed membership answers 403.
  const { organizationId } = await calendarCompany(event)

  // GET - List the selected company's payments (bills the owner removed from the calendar stay hidden)
  if (method === 'GET') {
    const query = getQuery(event)

    try {
      const payments = await listCompanyCalendarEntries(organizationId, query)
      return payments
    } catch (error: any) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to fetch payments',
        message: error.message
      })
    }
  }

  // POST - Create new payment (dates are kept at noon UTC so the calendar day is the same in every timezone). The shared operation
  // is the one company Navi uses; the body never supplies the company, id or marker.
  if (method === 'POST') {
    const body = await readBody(event)
    try {
      return await createCompanyCalendarEntry(organizationId, body)
    } catch (error: any) {
      if (error.statusCode === 400) throw error
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
