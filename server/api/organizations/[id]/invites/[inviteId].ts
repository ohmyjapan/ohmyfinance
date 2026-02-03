// server/api/organizations/[id]/invites/[inviteId].ts
import { defineEventHandler, createError, getRouterParam } from 'h3'
import { ensureConnection } from '../../../../config/database'
import Organization from '../../../../models/Organization'
import Invite from '../../../../models/Invite'
import { requireAuth } from '../../../../middleware/auth'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const organizationId = getRouterParam(event, 'id')
  const inviteId = getRouterParam(event, 'inviteId')

  if (!organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Organization ID is required' })
  }

  if (!inviteId) {
    throw createError({ statusCode: 400, statusMessage: 'Invite ID is required' })
  }

  await ensureConnection()

  // Find organization and check membership
  const organization = await Organization.findOne({
    _id: organizationId,
    'members.userId': auth.userId,
    isActive: true
  })

  if (!organization) {
    throw createError({ statusCode: 404, statusMessage: 'Organization not found' })
  }

  const userMember = organization.members.find(
    m => m.userId.toString() === auth.userId
  )
  const userRole = userMember?.role || 'viewer'

  // Only owner and admin can manage invites
  if (!['owner', 'admin'].includes(userRole)) {
    throw createError({ statusCode: 403, statusMessage: 'Not authorized to manage invites' })
  }

  // Find the invite
  const invite = await Invite.findOne({
    _id: inviteId,
    organizationId
  })

  if (!invite) {
    throw createError({ statusCode: 404, statusMessage: 'Invite not found' })
  }

  // GET - Get invite details
  if (event.method === 'GET') {
    await invite.populate('createdBy', 'name email')

    return {
      success: true,
      invite: {
        id: invite._id,
        email: invite.email,
        role: invite.role,
        status: invite.status,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
        createdBy: (invite.createdBy as any) ? {
          id: (invite.createdBy as any)._id,
          name: (invite.createdBy as any).name,
          email: (invite.createdBy as any).email
        } : null
      }
    }
  }

  // DELETE - Cancel invite
  if (event.method === 'DELETE') {
    try {
      if (invite.status !== 'pending') {
        throw createError({
          statusCode: 400,
          statusMessage: `Cannot cancel invite with status: ${invite.status}`
        })
      }

      invite.status = 'cancelled'
      await invite.save()

      return {
        success: true,
        message: 'Invite cancelled successfully'
      }
    } catch (error: any) {
      if (error.statusCode) throw error
      throw createError({ statusCode: 500, statusMessage: error.message })
    }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
