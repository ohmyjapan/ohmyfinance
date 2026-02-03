// server/services/twoFactorService.ts
import { generateSecret as otpGenerateSecret, generateURI, verifySync } from 'otplib'
import QRCode from 'qrcode'
import crypto from 'crypto'

const APP_NAME = 'OhMyFinance'

/**
 * Generate a new TOTP secret
 */
export function generateSecret(): string {
  return otpGenerateSecret()
}

/**
 * Generate TOTP auth URL for QR code
 */
export function generateAuthUrl(email: string, secret: string): string {
  return generateURI({
    issuer: APP_NAME,
    label: email,
    secret,
    algorithm: 'sha1',
    digits: 6,
    period: 30
  })
}

/**
 * Generate QR code data URL
 */
export async function generateQRCode(authUrl: string): Promise<string> {
  return QRCode.toDataURL(authUrl, {
    width: 256,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#ffffff'
    }
  })
}

/**
 * Verify a TOTP token
 */
export function verifyToken(secret: string, token: string): boolean {
  try {
    return verifySync({
      secret,
      token,
      strategy: 'totp',
      epochTolerance: 1 // Allow 1 period tolerance for clock drift
    })
  } catch {
    return false
  }
}

/**
 * Generate backup codes
 */
export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    // Generate 8-character alphanumeric code
    const code = crypto.randomBytes(4).toString('hex').toUpperCase()
    codes.push(code)
  }
  return codes
}

/**
 * Hash backup codes for storage
 */
export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  const bcrypt = await import('bcryptjs')
  const hashedCodes: string[] = []
  for (const code of codes) {
    const hash = await bcrypt.hash(code, 10)
    hashedCodes.push(hash)
  }
  return hashedCodes
}

/**
 * Verify a backup code
 */
export async function verifyBackupCode(code: string, hashedCodes: string[]): Promise<{ valid: boolean; index: number }> {
  const bcrypt = await import('bcryptjs')
  for (let i = 0; i < hashedCodes.length; i++) {
    const isValid = await bcrypt.compare(code.toUpperCase(), hashedCodes[i])
    if (isValid) {
      return { valid: true, index: i }
    }
  }
  return { valid: false, index: -1 }
}

/**
 * Generate device ID for trusted devices
 */
export function generateDeviceId(): string {
  return crypto.randomBytes(32).toString('hex')
}
