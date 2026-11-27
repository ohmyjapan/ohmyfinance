// server/utils/developerAccess.ts — who is a developer (plan omf-order-mapping piece 5, §4.1). The list is the platformdevelopers
// collection, written only by the operator command scripts/manage-developers.ts and read here at every developer request. No role,
// token claim, environment variable or first-user rule makes anyone a developer. GUARD.
//
// requireDeveloper(event) = the ordinary sign-in (requireAuth) + the user is on the list, read at this request + the user is active
// + the token's session version equals the user's current one (a token minted before a password change is refused here at once,
// where ordinary routes notice it only at renewal) + 2FA is on (owner's decision 2026-11-27). Answers: 401 without a sign-in or with a
// stale session, 403 DEVELOPER_ONLY for anyone not an active listed developer, 403 DEVELOPER_2FA_REQUIRED for a listed one without 2FA.
import mongoose from 'mongoose'
import { createError, type H3Event } from 'h3'
import { requireAuth } from '../middleware/auth'
import { ensureConnection } from '../config/database'
import User from '../models/User'
import PlatformDeveloper from '../models/PlatformDeveloper'
import type { TokenPayload } from '../services/authService'

export const DEVELOPER_ONLY = 'DEVELOPER_ONLY'
export const DEVELOPER_2FA_REQUIRED = 'DEVELOPER_2FA_REQUIRED'
const refuse = (statusCode: number, code: string, message: string) => createError({ statusCode, statusMessage: code === 'SESSION_EXPIRED' ? 'Session expired' : 'Developer only', message, data: { code, message } })

// The sidebar's question (GET /api/developer/me): an active user on the list. Any signed-in user may ask; the answer is a boolean.
export async function isDeveloper(userId: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(userId)) return false
  await ensureConnection()
  const [listed, user] = await Promise.all([PlatformDeveloper.exists({ userId }), User.exists({ _id: userId, isActive: true })])
  return !!listed && !!user
}

export async function requireDeveloper(event: H3Event): Promise<{ auth: TokenPayload; user: any }> {
  const auth = requireAuth(event)
  if (!mongoose.isValidObjectId(auth.userId)) throw refuse(401, 'SESSION_EXPIRED', 'サインインし直してください。')
  await ensureConnection()
  const [listed, user] = await Promise.all([
    PlatformDeveloper.exists({ userId: auth.userId }),
    User.findById(auth.userId).select('email name isActive sessionVersion twoFactorEnabled').lean() as Promise<any>
  ])
  if (!user) throw refuse(401, 'SESSION_EXPIRED', 'サインインし直してください。')
  if ((auth.sv ?? 0) !== (user.sessionVersion ?? 0)) throw refuse(401, 'SESSION_EXPIRED', 'パスワードが変更されました。サインインし直してください。')
  if (!listed || user.isActive === false) throw refuse(403, DEVELOPER_ONLY, 'この画面は開発者だけが使えます。')
  if (!user.twoFactorEnabled) throw refuse(403, DEVELOPER_2FA_REQUIRED, '開発者の画面を使うには、二段階認証を有効にしてください。')
  return { auth, user }
}
