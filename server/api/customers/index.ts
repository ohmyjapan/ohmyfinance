// server/api/customers/index.ts
import { defineEventHandler, getQuery, readBody, getMethod, createError } from 'h3'
import Customer from '../../models/Customer'
import { ensureConnection } from '../../config/database'
import { calendarCompany } from '../../utils/calendarAccess'

export default defineEventHandler(async (event) => {
  await ensureConnection()
  // The token's selected company with fresh membership: every read is filtered by it, every write stamped with it.
  const { organizationId } = await calendarCompany(event)
  const method = getMethod(event)

  if (method === 'GET') {
    const query = getQuery(event)
    const searchQuery: any = {}

    if (query.search) {
      searchQuery.$or = [
        { name: { $regex: query.search, $options: 'i' } },
        { email: { $regex: query.search, $options: 'i' } },
        { company: { $regex: query.search, $options: 'i' } }
      ]
    }

    const customers = await Customer.find({ ...searchQuery, organizationId })
      .sort({ name: 1 })
      .lean()

    return customers
  }

  if (method === 'POST') {
    const body = await readBody(event)

    if (!body.name) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: '顧客名は必須です (Customer name is required)'
      })
    }

    // A company named in the body is ignored; the row belongs to the token company.
    const customer = new Customer({ ...body, organizationId })
    await customer.save()

    return customer.toObject()
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method Not Allowed'
  })
})
