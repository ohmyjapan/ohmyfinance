// server/api/admin/users/[id].ts
import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { ensureConnection } from '../../../config/database'
import User from '../../../models/User'
import Organization from '../../../models/Organization'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'User ID is required' })
  }

  try {
    await ensureConnection()

    // GET - Get user details
    if (event.method === 'GET') {
      const user = await User.findById(id).select('-password').lean()

      if (!user) {
        throw createError({ statusCode: 404, statusMessage: 'User not found' })
      }

      // Get user's organizations
      const organizations = await Organization.find({
        'members.userId': user._id,
        isActive: true
      }).lean()

      return {
        success: true,
        data: {
          ...user,
          id: user._id,
          organizations: organizations.map(org => ({
            id: org._id,
            name: org.name,
            slug: org.slug,
            type: org.type,
            role: org.members.find(m => m.userId.toString() === id)?.role
          }))
        }
      }
    }

    // PATCH - Update user
    if (event.method === 'PATCH') {
      const body = await readBody(event)
      const { name, email, isActive, role } = body

      const updateData: any = {}
      if (name !== undefined) updateData.name = name
      if (email !== undefined) updateData.email = email.toLowerCase()
      if (isActive !== undefined) updateData.isActive = isActive
      if (role !== undefined) updateData.role = role

      const user = await User.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true, runValidators: true }
      ).select('-password')

      if (!user) {
        throw createError({ statusCode: 404, statusMessage: 'User not found' })
      }

      return {
        success: true,
        data: user
      }
    }

    // DELETE - Delete user
    if (event.method === 'DELETE') {
      // Remove user from all organizations first
      await Organization.updateMany(
        { 'members.userId': id },
        { $pull: { members: { userId: id } } }
      )

      // Delete user
      const user = await User.findByIdAndDelete(id)

      if (!user) {
        throw createError({ statusCode: 404, statusMessage: 'User not found' })
      }

      return {
        success: true,
        message: 'User deleted successfully'
      }
    }

    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
