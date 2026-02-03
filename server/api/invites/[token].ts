// server/api/invites/[token].ts
import { defineEventHandler, createError, getRouterParam } from 'h3'
import { ensureConnection } from '../../config/database'
import Invite from '../../models/Invite'

export default defineEventHandler(async (event) => {
  if (event.method !== 'GET') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const token = getRouterParam(event, 'token')

  if (!token) {
    throw createError({ statusCode: 400, statusMessage: 'Token is required' })
  }

  await ensureConnection()

  try {
    // Find the invite by token
    const invite = await Invite.findOne({ token })
      .populate('organizationId', 'name slug type logo')
      .populate('createdBy', 'name')

    if (!invite) {
      throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
    }

    // Check status
    if (invite.status === 'accepted') {
      throw createError({ statusCode: 400, statusMessage: 'This invitation has already been accepted' })
    }

    if (invite.status === 'cancelled') {
      throw createError({ statusCode: 400, statusMessage: 'This invitation has been cancelled' })
    }

    // Check if expired
    if (invite.status === 'expired' || invite.expiresAt < new Date()) {
      if (invite.status === 'pending') {
        invite.status = 'expired'
        await invite.save()
      }
      throw createError({ statusCode: 400, statusMessage: 'This invitation has expired' })
    }

    const organization = invite.organizationId as any

    return {
      success: true,
      invite: {
        email: invite.email,
        role: invite.role,
        status: invite.status,
        expiresAt: invite.expiresAt,
        organization: organization ? {
          id: organization._id,
          name: organization.name,
          slug: organization.slug,
          type: organization.type,
          logo: organization.logo
        } : null,
        invitedBy: (invite.createdBy as any)?.name || 'Unknown'
      }
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
