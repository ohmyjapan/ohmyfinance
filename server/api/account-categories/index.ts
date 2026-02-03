// server/api/account-categories/index.ts
import { defineEventHandler, getQuery, readBody, getMethod, createError } from 'h3'
import AccountCategory from '../../models/AccountCategory'
import { ensureConnection } from '../../config/database'

export default defineEventHandler(async (event) => {
  await ensureConnection()
  const method = getMethod(event)

  if (method === 'GET') {
    const query = getQuery(event)
    const searchQuery: any = { isActive: true }

    // Filter by parent (for sub-categories)
    if (query.parentId) {
      searchQuery.parentId = query.parentId
    } else if (query.topLevel === 'true') {
      // Only top-level categories (no parent)
      searchQuery.parentId = { $exists: false }
    }

    // Filter by type
    if (query.type) {
      searchQuery.type = query.type
    }

    if (query.search) {
      searchQuery.name = { $regex: query.search, $options: 'i' }
    }

    const categories = await AccountCategory.find(searchQuery)
      .populate('children')
      .sort({ order: 1, name: 1 })
      .lean()

    return categories
  }

  if (method === 'POST') {
    const body = await readBody(event)

    if (!body.name) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: '勘定科目名は必須です (Account category name is required)'
      })
    }

    const category = new AccountCategory({
      ...body,
      isActive: true
    })
    await category.save()

    return category.toObject()
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method Not Allowed'
  })
})
