// server/api/tax-categories/index.ts
import { defineEventHandler, getQuery, readBody, getMethod, createError } from 'h3'
import TaxCategory from '../../models/TaxCategory'
import { ensureConnection } from '../../config/database'

export default defineEventHandler(async (event) => {
  await ensureConnection()
  const method = getMethod(event)

  if (method === 'GET') {
    const query = getQuery(event)
    const searchQuery: any = {}

    if (query.search) {
      searchQuery.name = { $regex: query.search, $options: 'i' }
    }

    const categories = await TaxCategory.find(searchQuery)
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

    const category = new TaxCategory(body)
    await category.save()

    return category.toObject()
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method Not Allowed'
  })
})
