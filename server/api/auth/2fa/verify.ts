// server/api/auth/2fa/verify.ts
import { defineEventHandler, readBody, createError, getHeader } from 'h3'
import { ensureConnection } from '../../../config/database'
import User from '../../../models/User'
import { verifyToken as verifyTOTP, verifyBackupCode, generateDeviceId, hashDeviceId } from '../../../services/twoFactorService'
import { verifyToken, completeLoginAfter2FA } from '../../../services/authService'
import UsedAuthChallenge from '../../../models/UsedAuthChallenge'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const body = await readBody(event)
  const { tempToken, rememberDevice } = body
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''

  if (!tempToken || !code) {
    throw createError({ statusCode: 400, statusMessage: 'Temporary token and verification code are required' })
  }

  try {
    await ensureConnection()

    // Verify temp token
    const payload = verifyToken(tempToken) as any
    if (!payload || payload.type !== '2fa_pending' || !payload.jti || !payload.exp) {
      throw createError({ statusCode: 401, statusMessage: 'Invalid or expired temporary token' })
    }

    const user = await User.findById(payload.userId).select('+twoFactorSecret +twoFactorBackupCodes')
    if (!user || !user.isActive || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw createError({ statusCode: 404, statusMessage: 'User not found' })
    }

    // Try TOTP verification first
    let isValid = /^\d{6}$/.test(code) && verifyTOTP(user.twoFactorSecret!, code)
    let usedBackupHash: string | undefined

    // If TOTP fails, try backup code
    if (!isValid && /^[A-F0-9]{8}$/.test(code) && user.twoFactorBackupCodes?.length) {
      const backupResult = await verifyBackupCode(code, user.twoFactorBackupCodes)
      if (backupResult.valid) {
        isValid = true
        usedBackupHash = user.twoFactorBackupCodes[backupResult.index]
      }
    }

    if (!isValid) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid verification code' })
    }

    // The unique index prevents concurrent verification from issuing two sessions.
    await UsedAuthChallenge.init()
    try {
      await UsedAuthChallenge.create({ jti: payload.jti, expiresAt: new Date(payload.exp * 1000) })
    } catch (error: any) {
      if (error.code === 11000) throw createError({ statusCode: 401, statusMessage: 'Verification challenge already used. Please sign in again.' })
      throw error
    }
    if (usedBackupHash) {
      const consumed = await User.updateOne({ _id: user._id, twoFactorBackupCodes: usedBackupHash }, { $pull: { twoFactorBackupCodes: usedBackupHash } })
      if (consumed.modifiedCount !== 1) throw createError({ statusCode: 400, statusMessage: 'Backup code already used' })
    }

    // Handle device trust
    let deviceId: string | undefined
    if (rememberDevice === true) {
      deviceId = generateDeviceId()
      const userAgent = getHeader(event, 'user-agent') || 'Unknown'
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 14) // 14 days

      await User.findByIdAndUpdate(user._id, {
        $push: {
          trustedDevices: {
            deviceId: hashDeviceId(deviceId),
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
