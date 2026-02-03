// server/services/authService.ts
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import User from '../models/User'
import Organization from '../models/Organization'
import { addToBlacklist, isBlacklisted } from './tokenBlacklistService'
import { logAudit } from '../utils/audit'

const JWT_SECRET = process.env.JWT_SECRET || 'ohmyfinance-secret-key-change-in-production'
const JWT_EXPIRES_IN = '15m'      // Short-lived access token
const JWT_REFRESH_EXPIRES_IN = '7d' // Refresh token

// Failed login protection
const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION_MINUTES = 15

export interface TokenPayload {
  userId: string
  email: string
  organizationId?: string
  role?: string
  jti?: string // JWT ID for revocation
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export async function generateTokens(payload: TokenPayload): Promise<AuthTokens> {
  // Generate unique JWT IDs for revocation support
  const accessJti = uuidv4()
  const refreshJti = uuidv4()

  const accessToken = jwt.sign(
    { ...payload, jti: accessJti },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  )

  const refreshToken = jwt.sign(
    { ...payload, type: 'refresh', jti: refreshJti },
    JWT_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN }
  )

  return {
    accessToken,
    refreshToken,
    expiresIn: 15 * 60 // 15 minutes in seconds
  }
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload
    return decoded
  } catch (error) {
    return null
  }
}

export async function registerUser(data: {
  email: string
  password: string
  name: string
  createOrganization?: boolean
  organizationType?: 'personal' | 'business'
  organizationName?: string
}): Promise<{ user: any; organization: any | null; tokens: AuthTokens }> {
  // Check if user exists
  const existingUser = await User.findOne({ email: data.email.toLowerCase() })
  if (existingUser) {
    throw new Error('Email already registered')
  }

  // Create user
  const user = await User.create({
    email: data.email.toLowerCase(),
    password: data.password,
    name: data.name
  })

  let organization = null

  // Only create organization if explicitly requested
  if (data.createOrganization) {
    const orgName = data.organizationName || `${data.name}のワークスペース`
    const orgSlug = await (Organization as any).generateSlug(orgName)

    organization = await Organization.create({
      name: orgName,
      slug: orgSlug,
      type: data.organizationType || 'personal',
      members: [{
        userId: user._id,
        role: 'owner',
        joinedAt: new Date()
      }]
    })
  }

  // Generate tokens (organizationId is optional now)
  const tokens = await generateTokens({
    userId: user._id.toString(),
    email: user.email,
    organizationId: organization?._id?.toString(),
    role: organization ? 'owner' : undefined
  })

  return {
    user: user.toJSON(),
    organization: organization?.toJSON() || null,
    tokens
  }
}

export async function loginUser(email: string, password: string): Promise<{
  user: any
  organizations: any[]
  tokens: AuthTokens
  requires2FA?: boolean
  tempToken?: string
}> {
  // Find user with password
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password +twoFactorSecret')
  if (!user) {
    // Log failed attempt (user not found)
    await logAudit({
      action: 'login_failed',
      entityType: 'auth',
      metadata: { email, reason: 'user_not_found' }
    })
    throw new Error('Invalid email or password')
  }

  // Check if account is locked
  if (user.lockoutUntil && user.lockoutUntil > new Date()) {
    const remainingMinutes = Math.ceil((user.lockoutUntil.getTime() - Date.now()) / (1000 * 60))
    await logAudit({
      action: 'login_failed',
      entityType: 'auth',
      entityId: user._id.toString(),
      userId: user._id.toString(),
      metadata: { reason: 'account_locked', remainingMinutes }
    })
    throw new Error(`Account is locked. Try again in ${remainingMinutes} minutes.`)
  }

  // Check password
  const isMatch = await user.comparePassword(password)
  if (!isMatch) {
    // Increment login attempts
    user.loginAttempts = (user.loginAttempts || 0) + 1

    // Lock account if too many attempts
    if (user.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      user.lockoutUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000)
      await user.save()

      await logAudit({
        action: 'lockout',
        entityType: 'auth',
        entityId: user._id.toString(),
        userId: user._id.toString(),
        metadata: { attempts: user.loginAttempts }
      })

      throw new Error(`Account locked due to too many failed attempts. Try again in ${LOCKOUT_DURATION_MINUTES} minutes.`)
    }

    await user.save()

    await logAudit({
      action: 'login_failed',
      entityType: 'auth',
      entityId: user._id.toString(),
      userId: user._id.toString(),
      metadata: { attempts: user.loginAttempts, remaining: MAX_LOGIN_ATTEMPTS - user.loginAttempts }
    })

    throw new Error('Invalid email or password')
  }

  // Check if active
  if (!user.isActive) {
    throw new Error('Account is deactivated')
  }

  // Reset login attempts on successful password verification
  user.loginAttempts = 0
  user.lockoutUntil = undefined
  user.lastLoginAt = new Date()
  await user.save()

  // Check if 2FA is enabled
  if (user.twoFactorEnabled && user.twoFactorSecret) {
    // Generate temporary token for 2FA verification
    const tempToken = jwt.sign(
      {
        userId: user._id.toString(),
        email: user.email,
        type: '2fa_pending',
        jti: uuidv4()
      },
      JWT_SECRET,
      { expiresIn: '5m' } // 5 minutes to complete 2FA
    )

    return {
      user: { id: user._id, email: user.email, name: user.name },
      organizations: [],
      tokens: { accessToken: '', refreshToken: '', expiresIn: 0 },
      requires2FA: true,
      tempToken
    }
  }

  // Get user's organizations
  const organizations = await Organization.find({
    'members.userId': user._id,
    isActive: true
  }).lean()

  // Use first organization as default
  const defaultOrg = organizations[0]
  const userRole = defaultOrg?.members.find(
    (m: any) => m.userId.toString() === user._id.toString()
  )?.role || 'member'

  // Generate tokens
  const tokens = await generateTokens({
    userId: user._id.toString(),
    email: user.email,
    organizationId: defaultOrg?._id.toString(),
    role: userRole
  })

  // Log successful login
  await logAudit({
    action: 'login',
    entityType: 'auth',
    entityId: user._id.toString(),
    userId: user._id.toString()
  })

  return {
    user: user.toJSON(),
    organizations: organizations.map((org: any) => ({
      ...org,
      id: org._id,
      role: org.members.find((m: any) => m.userId.toString() === user._id.toString())?.role
    })),
    tokens
  }
}

export async function refreshTokens(refreshToken: string): Promise<AuthTokens | null> {
  const payload = verifyToken(refreshToken) as TokenPayload & { type?: string; exp?: number }
  if (!payload || payload.type !== 'refresh') {
    return null
  }

  // Check if token is blacklisted
  if (payload.jti && isBlacklisted(payload.jti)) {
    return null
  }

  // Verify user still exists and is active
  const user = await User.findById(payload.userId)
  if (!user || !user.isActive) {
    return null
  }

  return generateTokens({
    userId: payload.userId,
    email: payload.email,
    organizationId: payload.organizationId,
    role: payload.role
  })
}

/**
 * Revoke a token by adding it to the blacklist
 */
export function revokeToken(token: string): boolean {
  try {
    const decoded = jwt.decode(token) as { jti?: string; exp?: number }
    if (!decoded?.jti || !decoded?.exp) {
      return false
    }

    addToBlacklist(decoded.jti, new Date(decoded.exp * 1000))
    return true
  } catch {
    return false
  }
}

/**
 * Complete login after 2FA verification
 */
export async function completeLoginAfter2FA(tempToken: string): Promise<{
  user: any
  organizations: any[]
  tokens: AuthTokens
}> {
  const payload = verifyToken(tempToken) as any
  if (!payload || payload.type !== '2fa_pending') {
    throw new Error('Invalid or expired 2FA token')
  }

  const user = await User.findById(payload.userId)
  if (!user || !user.isActive) {
    throw new Error('User not found or inactive')
  }

  // Get user's organizations
  const organizations = await Organization.find({
    'members.userId': user._id,
    isActive: true
  }).lean()

  // Use first organization as default
  const defaultOrg = organizations[0]
  const userRole = defaultOrg?.members.find(
    (m: any) => m.userId.toString() === user._id.toString()
  )?.role || 'member'

  // Generate tokens
  const tokens = await generateTokens({
    userId: user._id.toString(),
    email: user.email,
    organizationId: defaultOrg?._id.toString(),
    role: userRole
  })

  // Log successful login
  await logAudit({
    action: 'login',
    entityType: 'auth',
    entityId: user._id.toString(),
    userId: user._id.toString(),
    metadata: { with2FA: true }
  })

  return {
    user: user.toJSON(),
    organizations: organizations.map((org: any) => ({
      ...org,
      id: org._id,
      role: org.members.find((m: any) => m.userId.toString() === user._id.toString())?.role
    })),
    tokens
  }
}

export async function switchOrganization(userId: string, organizationId: string): Promise<AuthTokens | null> {
  const organization = await Organization.findOne({
    _id: organizationId,
    'members.userId': userId,
    isActive: true
  })

  if (!organization) {
    return null
  }

  const user = await User.findById(userId)
  if (!user) {
    return null
  }

  const userRole = organization.members.find(
    m => m.userId.toString() === userId
  )?.role || 'member'

  return generateTokens({
    userId,
    email: user.email,
    organizationId,
    role: userRole
  })
}

export async function inviteUser(
  organizationId: string,
  inviterUserId: string,
  email: string,
  role: 'admin' | 'member' | 'viewer' = 'member'
): Promise<{ inviteToken: string; email: string }> {
  const organization = await Organization.findById(organizationId)
  if (!organization) {
    throw new Error('Organization not found')
  }

  // Check if inviter has permission
  const inviterMember = organization.members.find(
    m => m.userId.toString() === inviterUserId
  )
  if (!inviterMember || !['owner', 'admin'].includes(inviterMember.role)) {
    throw new Error('Not authorized to invite users')
  }

  // Check if user already a member
  const existingUser = await User.findOne({ email: email.toLowerCase() })
  if (existingUser) {
    const isMember = organization.members.some(
      m => m.userId.toString() === existingUser._id.toString()
    )
    if (isMember) {
      throw new Error('User is already a member')
    }
  }

  // Generate invite token
  const inviteToken = jwt.sign(
    {
      type: 'invite',
      organizationId,
      email: email.toLowerCase(),
      role,
      invitedBy: inviterUserId
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  )

  return { inviteToken, email }
}

export async function acceptInvite(inviteToken: string, userData?: {
  name?: string
  password?: string
}): Promise<{ user: any; organization: any; tokens: AuthTokens }> {
  const payload = verifyToken(inviteToken) as any
  if (!payload || payload.type !== 'invite') {
    throw new Error('Invalid or expired invite')
  }

  const organization = await Organization.findById(payload.organizationId)
  if (!organization) {
    throw new Error('Organization not found')
  }

  // Find or create user
  let user = await User.findOne({ email: payload.email })

  if (!user) {
    if (!userData?.name || !userData?.password) {
      throw new Error('Name and password required for new users')
    }
    user = await User.create({
      email: payload.email,
      name: userData.name,
      password: userData.password
    })
  }

  // Add user to organization
  const isMember = organization.members.some(
    m => m.userId.toString() === user!._id.toString()
  )

  if (!isMember) {
    organization.members.push({
      userId: user._id,
      role: payload.role,
      joinedAt: new Date(),
      invitedBy: payload.invitedBy
    })
    await organization.save()
  }

  // Generate tokens
  const tokens = await generateTokens({
    userId: user._id.toString(),
    email: user.email,
    organizationId: organization._id.toString(),
    role: payload.role
  })

  return {
    user: user.toJSON(),
    organization: organization.toJSON(),
    tokens
  }
}
