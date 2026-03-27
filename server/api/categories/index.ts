// server/api/categories/index.ts
import { defineEventHandler, getQuery, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Category from '../../models/Category'
import { requireAuth } from '../../middleware/auth'

/**
 * GET /api/categories - List all categories
 * POST /api/categories - Create new category
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  await ensureConnection()
  const method = event.method

  if (method === 'GET') {
    try {
      const query = getQuery(event)
      const filter: Record<string, any> = {}

      if (query.type) {
        filter.type = { $in: [query.type, 'both'] }
      }

      const categories = await Category.find(filter).sort({ order: 1, name: 1 }).lean()
      return categories.map((c: any) => ({
        ...c,
        id: c._id.toString()
      }))
    } catch (error: any) {
      throw createError({ statusCode: 500, statusMessage: error.message })
    }
  }

  if (method === 'POST') {
    try {
      const body = await readBody(event)

      if (!body.name) {
        throw createError({ statusCode: 400, statusMessage: 'Name is required' })
      }

      // Check for duplicate
      const existing = await Category.findOne({ name: body.name })
      if (existing) {
        throw createError({ statusCode: 400, statusMessage: 'Category already exists' })
      }

      const category = new Category({
        name: body.name,
        type: body.type || 'both',
        color: body.color || '#7c3aed',
        icon: body.icon,
        parentId: body.parentId,
        order: body.order || 0
      })

      await category.save()
      return { success: true, category: category.toObject() }
    } catch (error: any) {
      if (error.statusCode) throw error
      throw createError({ statusCode: 500, statusMessage: error.message })
    }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
