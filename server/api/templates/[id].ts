// server/api/templates/[id].ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import { MappingTemplate } from '../../models/MappingTemplate'
import { requireAuth } from '../../middleware/auth'
import { rejectSharedMasterWrite } from '../../utils/sharedMasterAccess'

/**
 * GET/PUT/DELETE /api/templates/:id — PUT/PATCH/DELETE refused for every session (shared master, S15)
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  const id = event.context.params?.id
  const method = event.method

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Template ID required' })
  }

  try {
    await ensureConnection()
  } catch (error) {
    throw createError({ statusCode: 503, statusMessage: 'Database connection failed' })
  }

  if (method === 'GET') {
    const template = await MappingTemplate.findById(id).lean()
    if (!template) {
      throw createError({ statusCode: 404, statusMessage: 'Template not found' })
    }
    return template
  }

  if (method === 'PUT' || method === 'PATCH') {
    rejectSharedMasterWrite(event)
    try {
      const body = await readBody(event)
      const { _id, createdAt, ...updateData } = body

      const template = await MappingTemplate.findByIdAndUpdate(id, updateData, { new: true }).lean()
      if (!template) {
        throw createError({ statusCode: 404, statusMessage: 'Template not found' })
      }
      return { success: true, template }
    } catch (error: any) {
      if (error.statusCode) throw error
      throw createError({ statusCode: 500, statusMessage: error.message })
    }
  }

  if (method === 'DELETE') {
    rejectSharedMasterWrite(event)
    const template = await MappingTemplate.findByIdAndDelete(id).lean()
    if (!template) {
      throw createError({ statusCode: 404, statusMessage: 'Template not found' })
    }
    return { success: true, message: 'Template deleted' }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
