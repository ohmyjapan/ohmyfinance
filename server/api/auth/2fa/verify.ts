// server/api/auth/2fa/verify.ts
import { defineEventHandler, readBody, createError, getHeader } from 'h3'
import { ensureConnection } from '../../../config/database'
import User from '../../../models/User'
import { verifyToken as verifyTOTP, verifyBackupCode, generateDeviceId } from '../../../services/twoFactorService'
import { verifyToken, completeLoginAfter2FA } from '../../../services/authService'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const body = await readBody(event)
  const { tempToken, code, rememberDevice } = body

  if (!tempToken || !code) {
    throw createError({ statusCode: 400, statusMessage: 'Temporary token and verification code are required' })
  }

  try {
    await ensureConnection()

    // Verify temp token
    const payload = verifyToken(tempToken) as any
    if (!payload || payload.type !== '2fa_pending') {
      throw createError({ statusCode: 401, statusMessage: 'Invalid or expired temporary token' })
    }

    const user = await User.findById(payload.userId).select('+twoFactorSecret +twoFactorBackupCodes')
    if (!user) {
      throw createError({ statusCode: 404, statusMessage: 'User not found' })
    }

    // Try TOTP verification first
    let isValid = verifyTOTP(user.twoFactorSecret!, code)

    // If TOTP fails, try backup code
    if (!isValid && user.twoFactorBackupCodes?.length) {
      const backupResult = await verifyBackupCode(code, user.twoFactorBackupCodes)
      if (backupResult.valid) {
        isValid = true
        // Remove used backup code
        const updatedCodes = [...user.twoFactorBackupCodes]
        updatedCodes.splice(backupResult.index, 1)
        await User.findByIdAndUpdate(user._id, {
          twoFactorBackupCodes: updatedCodes
        })
      }
    }

    if (!isValid) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid verification code' })
    }

    // Handle device trust
    let deviceId: string | undefined
    if (rememberDevice) {
      deviceId = generateDeviceId()
      const userAgent = getHeader(event, 'user-agent') || 'Unknown'
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 14) // 14 days

      await User.findByIdAndUpdate(user._id, {
        $push: {
          trustedDevices: {
            deviceId,
            userAgent,
            expiresAt
          }
        }
      })
    }

    // Complete login and get tokens
    const result = await completeLoginAfter2FA(tempToken)

    return {
      success: true,
      message: 'Two-factor authentication successful',
      user: result.user,
      organizations: result.organizations,
      tokens: result.tokens,
      deviceId // Client should store this if remember device was selected
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
