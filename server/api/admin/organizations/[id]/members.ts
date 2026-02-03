// server/api/admin/organizations/[id]/members.ts
import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { ensureConnection } from '../../../../config/database'
import Organization from '../../../../models/Organization'
import User from '../../../../models/User'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Organization ID is required' })
  }

  try {
    await ensureConnection()

    const org = await Organization.findById(id)
    if (!org) {
      throw createError({ statusCode: 404, statusMessage: 'Organization not found' })
    }

    // POST - Add member to organization
    if (event.method === 'POST') {
      const body = await readBody(event)
      const { userId, role } = body

      if (!userId) {
        throw createError({ statusCode: 400, statusMessage: 'User ID is required' })
      }

      // Check if user exists
      const user = await User.findById(userId)
      if (!user) {
        throw createError({ statusCode: 404, statusMessage: 'User not found' })
      }

      // Check if user is already a member
      const existingMember = org.members.find(m => m.userId.toString() === userId)
      if (existingMember) {
        throw createError({ statusCode: 409, statusMessage: 'User is already a member' })
      }

      // Add member
      org.members.push({
        userId,
        role: role || 'member',
        joinedAt: new Date()
      })

      await org.save()

      return {
        success: true,
        message: 'Member added successfully',
        data: {
          userId,
          name: user.name,
          email: user.email,
          role: role || 'member'
        }
      }
    }

    // PATCH - Update member role
    if (event.method === 'PATCH') {
      const body = await readBody(event)
      const { userId, role } = body

      if (!userId || !role) {
        throw createError({ statusCode: 400, statusMessage: 'User ID and role are required' })
      }

      const memberIndex = org.members.findIndex(m => m.userId.toString() === userId)
      if (memberIndex === -1) {
        throw createError({ statusCode: 404, statusMessage: 'Member not found in organization' })
      }

      org.members[memberIndex].role = role
      await org.save()

      return {
        success: true,
        message: 'Member role updated successfully'
      }
    }

    // DELETE - Remove member from organization
    if (event.method === 'DELETE') {
      const body = await readBody(event)
      const { userId } = body

      if (!userId) {
        throw createError({ statusCode: 400, statusMessage: 'User ID is required' })
      }

      const memberIndex = org.members.findIndex(m => m.userId.toString() === userId)
      if (memberIndex === -1) {
        throw createError({ statusCode: 404, statusMessage: 'Member not found in organization' })
      }

      org.members.splice(memberIndex, 1)
      await org.save()

      return {
        success: true,
        message: 'Member removed successfully'
      }
    }

    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
