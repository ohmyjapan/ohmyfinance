// server/api/categories/[id].ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Category from '../../models/Category'
import { requireAuth } from '../../middleware/auth'
import { rejectSharedMasterWrite } from '../../utils/sharedMasterAccess'

/**
 * GET/PUT/DELETE /api/categories/:id — PUT/PATCH/DELETE refused for every session (shared master, S15)
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  await ensureConnection()
  const id = event.context.params?.id
  const method = event.method

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Category ID required' })
  }

  if (method === 'GET') {
    const category = await Category.findById(id).lean()
    if (!category) {
      throw createError({ statusCode: 404, statusMessage: 'Category not found' })
    }
    return category
  }

  if (method === 'PUT' || method === 'PATCH') {
    rejectSharedMasterWrite(event)
    try {
      const body = await readBody(event)
      const { _id, createdAt, ...updateData } = body

      const category = await Category.findByIdAndUpdate(id, updateData, { new: true }).lean()
      if (!category) {
        throw createError({ statusCode: 404, statusMessage: 'Category not found' })
      }
      return { success: true, category }
    } catch (error: any) {
      if (error.statusCode) throw error
      throw createError({ statusCode: 500, statusMessage: error.message })
    }
  }

  if (method === 'DELETE') {
    rejectSharedMasterWrite(event)
    const category = await Category.findByIdAndDelete(id).lean()
    if (!category) {
      throw createError({ statusCode: 404, statusMessage: 'Category not found' })
    }
    return { success: true, message: 'Category deleted' }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
