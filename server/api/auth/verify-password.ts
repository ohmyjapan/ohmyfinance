// server/api/auth/verify-password.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import { requireAuth } from '../../middleware/auth'
import User from '../../models/User'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const auth = requireAuth(event)
  const body = await readBody(event)
  const { password } = body

  if (!password) {
    throw createError({ statusCode: 400, statusMessage: 'Password is required' })
  }

  try {
    await ensureConnection()

    const user = await User.findById(auth.userId).select('+password')
    if (!user) {
      throw createError({ statusCode: 404, statusMessage: 'User not found' })
    }

    const isValid = await user.comparePassword(password)

    return {
      valid: isValid
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
