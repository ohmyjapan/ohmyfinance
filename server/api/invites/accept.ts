// server/api/invites/accept.ts
import { defineEventHandler, readBody, createError, getHeader } from 'h3'
import { ensureConnection } from '../../config/database'
import Organization from '../../models/Organization'
import Invite from '../../models/Invite'
import User from '../../models/User'
import { generateTokens, verifyToken } from '../../services/authService'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  await ensureConnection()

  const body = await readBody(event)
  const { token, name, password } = body

  if (!token) {
    throw createError({ statusCode: 400, statusMessage: 'Invite token is required' })
  }

  try {
    // Find the invite by token
    const invite = await Invite.findOne({
      token,
      status: 'pending'
    }).populate('organizationId')

    if (!invite) {
      throw createError({ statusCode: 404, statusMessage: 'Invitation not found or has been cancelled' })
    }

    // Check if expired
    if (invite.expiresAt < new Date()) {
      invite.status = 'expired'
      await invite.save()
      throw createError({ statusCode: 400, statusMessage: 'Invitation has expired' })
    }

    const organization = invite.organizationId as any
    if (!organization || !organization.isActive) {
      throw createError({ statusCode: 404, statusMessage: 'Organization not found or inactive' })
    }

    // Check if user is logged in
    const authHeader = getHeader(event, 'authorization')
    let currentUser = null

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const authToken = authHeader.substring(7)
      const payload = verifyToken(authToken)
      if (payload && payload.userId) {
        currentUser = await User.findById(payload.userId)
      }
    }

    // Find or create user
    let user = await User.findOne({ email: invite.email })

    if (!user) {
      // New user - requires name and password
      if (!name || !password) {
        // Return invite details so frontend can show registration form
        return {
          success: false,
          requiresRegistration: true,
          invite: {
            email: invite.email,
            role: invite.role,
            organization: {
              id: organization._id,
              name: organization.name,
              type: organization.type
            },
            expiresAt: invite.expiresAt
          }
        }
      }

      // Create new user
      user = await User.create({
        email: invite.email,
        name,
        password,
        isEmailVerified: true // Verified via invite
      })
    } else if (currentUser && currentUser.email !== invite.email) {
      // User is logged in but with different email
      throw createError({
        statusCode: 400,
        statusMessage: `This invitation is for ${invite.email}. Please log in with that account or log out first.`
      })
    }

    // Check if already a member
    const isMember = organization.members.some(
      (m: any) => m.userId.toString() === user!._id.toString()
    )

    if (isMember) {
      // Mark invite as accepted anyway
      invite.status = 'accepted'
      invite.acceptedAt = new Date()
      invite.acceptedBy = user._id
      await invite.save()

      throw createError({ statusCode: 400, statusMessage: 'You are already a member of this organization' })
    }

    // Add user to organization
    organization.members.push({
      userId: user._id,
      role: invite.role,
      joinedAt: new Date(),
      invitedBy: invite.createdBy
    })
    await organization.save()

    // Update invite status
    invite.status = 'accepted'
    invite.acceptedAt = new Date()
    invite.acceptedBy = user._id
    await invite.save()

    // Generate tokens
    const tokens = await generateTokens({
      userId: user._id.toString(),
      email: user.email,
      organizationId: organization._id.toString(),
      role: invite.role
    })

    return {
      success: true,
      message: 'Invitation accepted successfully',
      user: user.toJSON(),
      organization: {
        id: organization._id,
        name: organization.name,
        slug: organization.slug,
        type: organization.type,
        role: invite.role
      },
      tokens
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
