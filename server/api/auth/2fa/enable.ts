// server/api/auth/2fa/enable.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../../config/database'
import { requireAuth } from '../../../middleware/auth'
import User from '../../../models/User'
import { verifyToken, hashBackupCodes, generateBackupCodes } from '../../../services/twoFactorService'
import { logAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const auth = requireAuth(event)
  const body = await readBody(event)
  const { code, backupCodes } = body

  if (!code) {
    throw createError({ statusCode: 400, statusMessage: 'Verification code is required' })
  }

  try {
    await ensureConnection()

    const user = await User.findById(auth.userId).select('+twoFactorSecret')
    if (!user) {
      throw createError({ statusCode: 404, statusMessage: 'User not found' })
    }

    if (!user.twoFactorSecret) {
      throw createError({ statusCode: 400, statusMessage: 'Please complete 2FA setup first' })
    }

    if (user.twoFactorEnabled) {
      throw createError({ statusCode: 400, statusMessage: 'Two-factor authentication is already enabled' })
    }

    // Verify the TOTP code
    const isValid = verifyToken(user.twoFactorSecret, code)
    if (!isValid) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid verification code' })
    }

    // Hash and store backup codes
    const codesToStore = backupCodes || generateBackupCodes(10)
    const hashedBackupCodes = await hashBackupCodes(codesToStore)

    // Enable 2FA
    await User.findByIdAndUpdate(auth.userId, {
      twoFactorEnabled: true,
      twoFactorBackupCodes: hashedBackupCodes
    })

    // Log the action
    await logAudit({
      action: '2fa_enabled',
      entityType: 'auth',
      entityId: user._id.toString(),
      userId: auth.userId
    })

    return {
      success: true,
      message: 'Two-factor authentication enabled successfully',
      backupCodes: codesToStore // Return backup codes one last time
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
