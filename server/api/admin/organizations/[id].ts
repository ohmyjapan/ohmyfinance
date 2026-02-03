// server/api/admin/organizations/[id].ts
import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { ensureConnection } from '../../../config/database'
import Organization from '../../../models/Organization'
import User from '../../../models/User'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Organization ID is required' })
  }

  try {
    await ensureConnection()

    // GET - Get organization details
    if (event.method === 'GET') {
      const org = await Organization.findById(id).lean()

      if (!org) {
        throw createError({ statusCode: 404, statusMessage: 'Organization not found' })
      }

      // Get member details
      const memberIds = org.members.map(m => m.userId)
      const members = await User.find({ _id: { $in: memberIds } })
        .select('name email')
        .lean()

      return {
        success: true,
        data: {
          ...org,
          id: org._id,
          members: org.members.map(m => {
            const user = members.find(u => u._id.toString() === m.userId.toString())
            return {
              userId: m.userId,
              name: user?.name || 'Unknown',
              email: user?.email || '',
              role: m.role,
              joinedAt: m.joinedAt
            }
          })
        }
      }
    }

    // PATCH - Update organization
    if (event.method === 'PATCH') {
      const body = await readBody(event)
      const { name, type, isActive, settings } = body

      const updateData: any = {}
      if (name !== undefined) updateData.name = name
      if (type !== undefined) updateData.type = type
      if (isActive !== undefined) updateData.isActive = isActive
      if (settings !== undefined) updateData.settings = settings

      const org = await Organization.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true, runValidators: true }
      )

      if (!org) {
        throw createError({ statusCode: 404, statusMessage: 'Organization not found' })
      }

      return {
        success: true,
        data: org
      }
    }

    // DELETE - Delete organization
    if (event.method === 'DELETE') {
      const org = await Organization.findByIdAndDelete(id)

      if (!org) {
        throw createError({ statusCode: 404, statusMessage: 'Organization not found' })
      }

      return {
        success: true,
        message: 'Organization deleted successfully'
      }
    }

    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
