// server/api/auth/disable-pin.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import { requireAuth } from '../../middleware/auth'
import User from '../../models/User'
import { logAudit } from '../../utils/audit'

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

    // Verify current password
    const isPasswordValid = await user.comparePassword(password)
    if (!isPasswordValid) {
      throw createError({ statusCode: 401, statusMessage: 'Invalid password' })
    }

    // Disable PIN
    await User.findByIdAndUpdate(auth.userId, {
      $unset: { 'securityPreferences.pinHash': 1 },
      'securityPreferences.pinEnabled': false
    })

    // Log the action
    await logAudit({
      action: 'pin_disabled' as any,
      entityType: 'settings' as any,
      entityId: user._id.toString(),
      userId: auth.userId
    })

    return {
      success: true,
      message: 'PIN disabled successfully'
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
