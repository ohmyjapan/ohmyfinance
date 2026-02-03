// server/api/auth/logout.ts
import { defineEventHandler, createError, getHeader, readBody } from 'h3'
import { revokeToken } from '../../services/authService'
import { logAudit } from '../../utils/audit'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  // Get the access token from header
  const authHeader = getHeader(event, 'authorization')
  const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null

  // Get refresh token from body if provided
  const body = await readBody(event).catch(() => ({}))
  const refreshToken = body?.refreshToken

  // Revoke tokens
  let revokedAccess = false
  let revokedRefresh = false

  if (accessToken) {
    revokedAccess = revokeToken(accessToken)
  }

  if (refreshToken) {
    revokedRefresh = revokeToken(refreshToken)
  }

  // Log logout
  if (event.context.auth?.userId) {
    await logAudit({
      action: 'logout',
      entityType: 'auth',
      entityId: event.context.auth.userId,
      userId: event.context.auth.userId
    })
  }

  return {
    success: true,
    message: 'Logged out successfully',
    tokensRevoked: { access: revokedAccess, refresh: revokedRefresh }
  }
})
