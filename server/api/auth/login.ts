// server/api/auth/login.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import { loginUser } from '../../services/authService'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const body = await readBody(event)
  const { email, password } = body

  if (!email || !password) {
    throw createError({ statusCode: 400, statusMessage: 'Email and password are required' })
  }

  try {
    await ensureConnection()

    const result = await loginUser(email, password)

    // Check if 2FA is required
    if (result.requires2FA) {
      return {
        success: true,
        requires2FA: true,
        tempToken: result.tempToken,
        user: result.user,
        message: 'Two-factor authentication required'
      }
    }

    return {
      success: true,
      message: 'Login successful',
      user: result.user,
      organizations: result.organizations,
      tokens: result.tokens
    }
  } catch (error: any) {
    if (error.message.includes('Invalid') || error.message.includes('deactivated') || error.message.includes('locked')) {
      throw createError({ statusCode: 401, statusMessage: error.message })
    }
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
