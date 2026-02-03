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

  try {
    await ensureConnection()

    const tokens = await refreshTokens(refreshToken)

    if (!tokens) {
      throw createError({ statusCode: 401, statusMessage: 'Invalid or expired refresh token' })
    }

    return {
      success: true,
      tokens
    }
  } catch (error: any) {
    throw createError({ statusCode: 401, statusMessage: error.message || 'Token refresh failed' })
  }
})
