// server/api/auth/verify-pin.ts
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
  const { pin } = body

  if (!pin) {
    throw createError({ statusCode: 400, statusMessage: 'PIN is required' })
  }

  try {
    await ensureConnection()

    const user = await User.findById(auth.userId).select('+securityPreferences.pinHash')
    if (!user) {
      throw createError({ statusCode: 404, statusMessage: 'User not found' })
    }

    if (!user.securityPreferences?.pinEnabled || !user.securityPreferences?.pinHash) {
      throw createError({ statusCode: 400, statusMessage: 'PIN is not enabled' })
    }

    const isValid = await user.comparePin(pin)

    // Log the attempt
    await logAudit({
      action: isValid ? 'unlock' : 'pin_failed' as any,
      entityType: 'settings' as any,
      entityId: user._id.toString(),
      userId: auth.userId,
      metadata: { success: isValid }
    })

    return {
      valid: isValid
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
