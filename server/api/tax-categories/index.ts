// server/api/tax-categories/index.ts
import { defineEventHandler, getQuery, readBody, getMethod, createError } from 'h3'
import TaxCategory from '../../models/TaxCategory'
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
      searchQuery.name = { $regex: query.search, $options: 'i' }
    }

    const categories = await TaxCategory.find({ ...searchQuery, organizationId })
      .sort({ name: 1 })
      .lean()

    return categories
  }

  if (method === 'POST') {
    const body = await readBody(event)

    if (!body.name) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: '税区分名は必須です (Tax category name is required)'
      })
    }

    // A company named in the body is ignored; the row belongs to the token company.
    const category = new TaxCategory({ ...body, organizationId })
    await category.save()

    return category.toObject()
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method Not Allowed'
  })
})
