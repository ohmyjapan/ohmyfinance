// server/api/auth/set-pin.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import { requireAuth } from '../../middleware/auth'
import User from '../../models/User'
import bcrypt from 'bcryptjs'
import { logAudit } from '../../utils/audit'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const auth = requireAuth(event)
  const body = await readBody(event)
  const { pin, password } = body

  if (!pin || !password) {
    throw createError({ statusCode: 400, statusMessage: 'PIN and password are required' })
  }

  // Validate PIN format (4-6 digits)
  if (!/^\d{4,6}$/.test(pin)) {
    throw createError({ statusCode: 400, statusMessage: 'PIN must be 4-6 digits' })
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

    // Hash the PIN
    const salt = await bcrypt.genSalt(12)
    const pinHash = await bcrypt.hash(pin, salt)

    // Update user with PIN
    await User.findByIdAndUpdate(auth.userId, {
      'securityPreferences.pinHash': pinHash,
      'securityPreferences.pinEnabled': true
    })

    // Log the action
    await logAudit({
      action: 'pin_set' as any,
      entityType: 'settings' as any,
      entityId: user._id.toString(),
      userId: auth.userId
    })

    return {
      success: true,
      message: 'PIN set successfully'
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
