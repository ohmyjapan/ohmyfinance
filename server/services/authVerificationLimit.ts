import { createError, setHeader, type H3Event } from 'h3'
import AuthVerificationAttempt from '../models/AuthVerificationAttempt'
import { logAudit } from '../utils/audit'

// A durable budget shared by all challenges, IPs and workers for this account.
// Called only after validating the signed pending token and active MFA user.
export async function limitMfaAttempt(event: H3Event, userId: string): Promise<void> {
  const now = Date.now(), windowMs = 15 * 60_000, maxAttempts = 10
  const windowStart = Math.floor(now / windowMs) * windowMs
  const expiresAt = new Date(windowStart + windowMs)
  const _id = `${userId}:${windowStart}`
  let attempt
  try {
    attempt = await AuthVerificationAttempt.findOneAndUpdate(
      { _id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt } }, { upsert: true, new: true }
    )
  } catch (error: any) {
    if (error.code !== 11000) throw error
    // Another worker inserted this account/window first; still reserve our attempt.
    attempt = await AuthVerificationAttempt.findOneAndUpdate({ _id }, { $inc: { count: 1 } }, { new: true })
  }
  if (!attempt) throw createError({ statusCode: 503, statusMessage: 'Verification temporarily unavailable. Please try again.' })
  if (attempt.count > maxAttempts) {
    // The atomic increment gives exactly one worker the threshold crossing.
    // Repeated blocked attempts must not flood the existing auth audit log.
    if (attempt.count === maxAttempts + 1) await logAudit({
      action: 'lockout', entityType: 'auth', userId,
      metadata: { reason: 'mfa_verification_limit', windowStart: new Date(windowStart).toISOString(), expiresAt: expiresAt.toISOString(), count: attempt.count, maxAttempts, windowMs }
    })
    const retryAfter = Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000))
    setHeader(event, 'Retry-After', retryAfter)
    throw createError({ statusCode: 429, statusMessage: `Too many verification attempts. Please try again in ${retryAfter} seconds.` })
  }
}
