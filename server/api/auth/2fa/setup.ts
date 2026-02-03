// server/api/auth/2fa/setup.ts
import { defineEventHandler, createError } from 'h3'
import { ensureConnection } from '../../../config/database'
import { requireAuth } from '../../../middleware/auth'
import User from '../../../models/User'
import {
  generateSecret,
  generateAuthUrl,
  generateQRCode,
  generateBackupCodes
} from '../../../services/twoFactorService'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const auth = requireAuth(event)

  try {
    await ensureConnection()

    const user = await User.findById(auth.userId)
    if (!user) {
      throw createError({ statusCode: 404, statusMessage: 'User not found' })
    }

    // Check if 2FA is already enabled
    if (user.twoFactorEnabled) {
      throw createError({ statusCode: 400, statusMessage: 'Two-factor authentication is already enabled' })
    }

    // Generate secret and backup codes
    const secret = generateSecret()
    const backupCodes = generateBackupCodes(10)
    const authUrl = generateAuthUrl(user.email, secret)
    const qrCodeDataUrl = await generateQRCode(authUrl)

    // Store secret temporarily (not enabled yet)
    // The secret will be saved permanently when user verifies with enable endpoint
    await User.findByIdAndUpdate(auth.userId, {
      twoFactorSecret: secret
    })

    return {
      success: true,
      qrCode: qrCodeDataUrl,
      secret, // For manual entry
      backupCodes // Show to user to save
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
