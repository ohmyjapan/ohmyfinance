// server/api/users/me.ts
import { defineEventHandler, createError, readBody } from 'h3'
import { ensureConnection } from '../../config/database'
import User from '../../models/User'
import Organization from '../../models/Organization'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)

  try {
    await ensureConnection()

    if (event.method === 'GET') {
      // Get current user profile
      const user = await User.findById(auth.userId)
      if (!user) {
        throw createError({ statusCode: 404, statusMessage: 'User not found' })
      }

      // Get user's organizations with their role
      const organizations = await Organization.find({
        'members.userId': auth.userId,
        isActive: true
      }).lean()

      const orgsWithRole = organizations.map((org: any) => {
        const member = org.members.find((m: any) => m.userId.toString() === auth.userId)
        return {
          id: org._id,
          _id: org._id,
          name: org.name,
          slug: org.slug,
          type: org.type,
          role: member?.role || 'member',
          joinedAt: member?.joinedAt
        }
      })

      return {
        success: true,
        user: user.toJSON(),
        organizations: orgsWithRole
      }
    }

    if (event.method === 'PATCH') {
      // Update current user profile
      const body = await readBody(event)

      // Only allow updating specific fields
      const allowedFields = ['name', 'phone', 'avatar', 'preferences']
      const updateData: Record<string, any> = {}

      for (const field of allowedFields) {
        if (body[field] !== undefined) {
          if (field === 'preferences') {
            // Merge preferences instead of replacing
            updateData['preferences'] = body[field]
          } else {
            updateData[field] = body[field]
          }
        }
      }

      if (Object.keys(updateData).length === 0) {
        throw createError({ statusCode: 400, statusMessage: 'No valid fields to update' })
      }

      const user = await User.findByIdAndUpdate(
        auth.userId,
        { $set: updateData },
        { new: true, runValidators: true }
      )

      if (!user) {
        throw createError({ statusCode: 404, statusMessage: 'User not found' })
      }

      return {
        success: true,
        user: user.toJSON(),
        message: 'Profile updated successfully'
      }
    }

    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  } catch (error: any) {
    if (error.statusCode) throw error
    console.error('User profile error:', error)
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
