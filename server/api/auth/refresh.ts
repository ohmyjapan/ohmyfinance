// server/api/auth/refresh.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import { refreshTokens } from '../../services/authService'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const body = await readBody(event)
  const { refreshToken } = body

  if (!refreshToken) {
    throw createError({ statusCode: 400, statusMessage: 'Refresh token is required' })
  }

  // Infra problems (db down mid-restart etc.) must NOT read as an invalid token —
  // the client logs out only on a definitive 401. Report them as 503 so it retries.
  try {
    await ensureConnection()
  } catch (error: any) {
    throw createError({ statusCode: 503, statusMessage: 'Service temporarily unavailable' })
  }

  const tokens = await refreshTokens(refreshToken)

  if (!tokens) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or expired refresh token' })
  }

  return {
    success: true,
    tokens
  }
})
