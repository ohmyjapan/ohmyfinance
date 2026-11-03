// server/api/auth/logout.ts
import { defineEventHandler, createError, getHeader, readBody } from 'h3'
import { ensureConnection } from '../../config/database'
import { revokeToken, revokeRefreshToken } from '../../services/authService'
import { logAudit } from '../../utils/audit'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  await ensureConnection()

  // Get the access token from header
  const authHeader = getHeader(event, 'authorization')
  const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null

  // Get refresh token from body if provided
  const body = await readBody(event).catch(() => ({}))
  const refreshToken = body?.refreshToken

  // Revoke tokens: the access token for this process, the refresh token for good (S16, signature verified, persisted)
  let revokedAccess = false
  let revokedRefresh = false

  if (accessToken) {
    revokedAccess = revokeToken(accessToken)
  }

  if (refreshToken) {
    revokedRefresh = await revokeRefreshToken(refreshToken)
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
