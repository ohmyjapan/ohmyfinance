// server/api/auth/2fa/disable.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../../config/database'
import { requireAuth } from '../../../middleware/auth'
import User from '../../../models/User'
import { verifyToken as verifyTOTP } from '../../../services/twoFactorService'
import { logAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const auth = requireAuth(event)
  const body = await readBody(event)
  const { password, code } = body

  if (!password || !code) {
    throw createError({ statusCode: 400, statusMessage: 'Password and verification code are required' })
  }

  try {
    await ensureConnection()

    const user = await User.findById(auth.userId).select('+password +twoFactorSecret')
    if (!user) {
      throw createError({ statusCode: 404, statusMessage: 'User not found' })
    }

    if (!user.twoFactorEnabled) {
      throw createError({ statusCode: 400, statusMessage: 'Two-factor authentication is not enabled' })
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password)
    if (!isPasswordValid) {
      throw createError({ statusCode: 401, statusMessage: 'Invalid password' })
    }

    // Verify TOTP code
    const isCodeValid = verifyTOTP(user.twoFactorSecret!, code)
    if (!isCodeValid) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid verification code' })
    }

    // Disable 2FA
    await User.findByIdAndUpdate(auth.userId, {
      twoFactorEnabled: false,
      $unset: {
        twoFactorSecret: 1,
        twoFactorBackupCodes: 1,
        trustedDevices: 1
      }
    })

    // Log the action
    await logAudit({
      action: '2fa_disabled',
      entityType: 'auth',
      entityId: user._id.toString(),
      userId: auth.userId
    })

    return {
      success: true,
      message: 'Two-factor authentication disabled successfully'
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
