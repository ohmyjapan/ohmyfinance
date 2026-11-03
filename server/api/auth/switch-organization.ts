// server/api/auth/switch-organization.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import { switchOrganization } from '../../services/authService'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const auth = requireAuth(event)
  const body = await readBody(event)
  const { organizationId } = body

  if (!organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Organization ID is required' })
  }

  try {
    await ensureConnection()

    const tokens = await switchOrganization(auth.userId, organizationId, { sv: auth.sv })

    if (!tokens) {
      throw createError({ statusCode: 403, statusMessage: 'Not a member of this organization' })
    }

    return {
      success: true,
      tokens
    }
  } catch (error: any) {
    // S16: a stale session answers 401 (and the 403 above keeps its code) instead of a 500
    if (error.statusCode) throw createError({ statusCode: error.statusCode, statusMessage: error.statusMessage || error.message })
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
