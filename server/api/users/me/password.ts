// server/api/users/me/password.ts
import { defineEventHandler, createError, readBody } from 'h3'
import { ensureConnection } from '../../../config/database'
import User from '../../../models/User'
import { requireAuth } from '../../../middleware/auth'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const auth = requireAuth(event)

  try {
    await ensureConnection()

    const body = await readBody(event)
    const { currentPassword, newPassword, confirmPassword } = body

    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Current password, new password, and confirmation are required'
      })
    }

    if (newPassword !== confirmPassword) {
      throw createError({
        statusCode: 400,
        statusMessage: 'New password and confirmation do not match'
      })
    }

    if (newPassword.length < 6) {
      throw createError({
        statusCode: 400,
        statusMessage: 'New password must be at least 6 characters'
      })
    }

    // Get user with password field
    const user = await User.findById(auth.userId).select('+password')
    if (!user) {
      throw createError({ statusCode: 404, statusMessage: 'User not found' })
    }

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword)
    if (!isMatch) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Current password is incorrect'
      })
    }

    // Update password (will be hashed by pre-save hook)
    user.password = newPassword
    await user.save()

    return {
      success: true,
      message: 'Password changed successfully'
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    console.error('Password change error:', error)
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
