// server/api/auth/security-preferences.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import { requireAuth } from '../../middleware/auth'
import User from '../../models/User'

export default defineEventHandler(async (event) => {
  if (event.method !== 'PUT') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const auth = requireAuth(event)
  const body = await readBody(event)

  const { screenLockTimeout, forceLogoutTimeout } = body

  // Validate values
  const validScreenLockTimeouts = [5, 10, 15, 30, 60]
  const validForceLogoutTimeouts = [4, 8, 12, 24]

  if (screenLockTimeout !== undefined && !validScreenLockTimeouts.includes(screenLockTimeout)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid screen lock timeout' })
  }

  if (forceLogoutTimeout !== undefined && !validForceLogoutTimeouts.includes(forceLogoutTimeout)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid force logout timeout' })
  }

  try {
    await ensureConnection()

    const updateData: Record<string, any> = {}

    if (screenLockTimeout !== undefined) {
      updateData['securityPreferences.screenLockTimeout'] = screenLockTimeout
    }

    if (forceLogoutTimeout !== undefined) {
      updateData['securityPreferences.forceLogoutTimeout'] = forceLogoutTimeout
    }

    const user = await User.findByIdAndUpdate(
      auth.userId,
      { $set: updateData },
      { new: true }
    )

    if (!user) {
      throw createError({ statusCode: 404, statusMessage: 'User not found' })
    }

    return {
      success: true,
      securityPreferences: user.securityPreferences
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
