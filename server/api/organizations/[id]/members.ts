// server/api/organizations/[id]/members.ts
import { defineEventHandler, readBody, createError, getRouterParam } from 'h3'
import { ensureConnection } from '../../../config/database'
import Organization from '../../../models/Organization'
import User from '../../../models/User'
import { requireAuth } from '../../../middleware/auth'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Organization ID is required' })
  }

  await ensureConnection()

  // Find organization and check membership
  const organization = await Organization.findOne({
    _id: id,
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

  // GET - List members
  if (event.method === 'GET') {
    try {
      // Get user details for all members
      const memberIds = organization.members.map(m => m.userId)
      const users = await User.find({ _id: { $in: memberIds } }).lean()
      const userMap = new Map(users.map((u: any) => [u._id.toString(), u]))

      const members = organization.members.map(m => {
        const userData = userMap.get(m.userId.toString()) as any
        return {
          userId: m.userId,
          role: m.role,
          joinedAt: m.joinedAt,
          invitedBy: m.invitedBy,
          user: userData ? {
            id: userData._id,
            email: userData.email,
            name: userData.name,
            avatar: userData.avatar
          } : null
        }
      })

      return {
        success: true,
        members
      }
    } catch (error: any) {
      throw createError({ statusCode: 500, statusMessage: error.message })
    }
  }

  // PUT - Update member role
  if (event.method === 'PUT') {
    // Only owner and admin can update roles
    if (!['owner', 'admin'].includes(userRole)) {
      throw createError({ statusCode: 403, statusMessage: 'Not authorized to manage members' })
    }

    try {
      const body = await readBody(event)
      const { userId, role } = body

      if (!userId || !role) {
        throw createError({ statusCode: 400, statusMessage: 'User ID and role are required' })
      }

      // Validate role
      if (!['admin', 'member', 'viewer'].includes(role)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid role' })
      }

      // Can't change owner role
      const targetMember = organization.members.find(m => m.userId.toString() === userId)
      if (!targetMember) {
        throw createError({ statusCode: 404, statusMessage: 'Member not found' })
      }

      if (targetMember.role === 'owner') {
        throw createError({ statusCode: 403, statusMessage: 'Cannot change owner role' })
      }

      // Admins can't change other admins
      if (userRole === 'admin' && targetMember.role === 'admin') {
        throw createError({ statusCode: 403, statusMessage: 'Admins cannot change other admin roles' })
      }

      targetMember.role = role
      await organization.save()

      return {
        success: true,
        message: 'Member role updated'
      }
    } catch (error: any) {
      if (error.statusCode) throw error
      throw createError({ statusCode: 500, statusMessage: error.message })
    }
  }

  // DELETE - Remove member
  if (event.method === 'DELETE') {
    // Only owner and admin can remove members
    if (!['owner', 'admin'].includes(userRole)) {
      throw createError({ statusCode: 403, statusMessage: 'Not authorized to remove members' })
    }

    try {
      const body = await readBody(event)
      const { userId } = body

      if (!userId) {
        throw createError({ statusCode: 400, statusMessage: 'User ID is required' })
      }

      const targetMember = organization.members.find(m => m.userId.toString() === userId)
      if (!targetMember) {
        throw createError({ statusCode: 404, statusMessage: 'Member not found' })
      }

      // Can't remove owner
      if (targetMember.role === 'owner') {
        throw createError({ statusCode: 403, statusMessage: 'Cannot remove owner' })
      }

      // Admins can't remove other admins
      if (userRole === 'admin' && targetMember.role === 'admin') {
        throw createError({ statusCode: 403, statusMessage: 'Admins cannot remove other admins' })
      }

      organization.members = organization.members.filter(
        m => m.userId.toString() !== userId
      )
      await organization.save()

      return {
        success: true,
        message: 'Member removed'
      }
    } catch (error: any) {
      if (error.statusCode) throw error
      throw createError({ statusCode: 500, statusMessage: error.message })
    }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
