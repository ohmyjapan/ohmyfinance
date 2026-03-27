// server/api/briefing/[id].ts
// GET /api/briefing/:id - Get a single briefing
// PATCH /api/briefing/:id - Update user fields (bookmark, notes)
// DELETE /api/briefing/:id - Delete a briefing

import { defineEventHandler, getMethod, readBody, createError } from 'h3'
import {
  getBriefingById,
  deleteBriefing,
  updateBriefingUserFields
} from '../../services/briefingService'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const method = getMethod(event)
  const id = event.context.params?.id

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Briefing ID is required'
    })
  }

  // Validate MongoDB ObjectId format
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `Invalid briefing ID format: "${id}"`
    })
  }

  // ─── GET ───────────────────────────────────────────────────────
  if (method === 'GET') {
    try {
      const briefing = await getBriefingById(id)
      return {
        success: true,
        briefing
      }
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Not Found',
          message: `Briefing ${id} not found`
        })
      }
      throw createError({
        statusCode: 500,
        statusMessage: 'Internal Server Error',
        message: error.message
      })
    }
  }

  // ─── PATCH ─────────────────────────────────────────────────────
  if (method === 'PATCH') {
    const body = await readBody(event)

    // Only allow specific user-facing fields to be updated
    const allowedFields: Record<string, boolean> = {
      isBookmarked: true,
      userNotes: true
    }

    const updates: any = {}
    for (const key of Object.keys(body || {})) {
      if (allowedFields[key]) {
        updates[key] = body[key]
      }
    }

    if (Object.keys(updates).length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'No valid fields to update. Allowed fields: isBookmarked, userNotes'
      })
    }

    try {
      const briefing = await updateBriefingUserFields(id, updates)
      return {
        success: true,
        briefing
      }
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Not Found',
          message: `Briefing ${id} not found`
        })
      }
      throw createError({
        statusCode: 500,
        statusMessage: 'Internal Server Error',
        message: error.message
      })
    }
  }

  // ─── DELETE ────────────────────────────────────────────────────
  if (method === 'DELETE') {
    try {
      await deleteBriefing(id)
      return {
        success: true,
        message: `Briefing ${id} deleted`
      }
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Not Found',
          message: `Briefing ${id} not found`
        })
      }
      throw createError({
        statusCode: 500,
        statusMessage: 'Internal Server Error',
        message: error.message
      })
    }
  }

  // ─── Unsupported Method ────────────────────────────────────────
  throw createError({
    statusCode: 405,
    statusMessage: 'Method Not Allowed',
    message: `Method ${method} not supported. Use GET, PATCH, or DELETE.`
  })
})
