// server/api/admin/users/index.ts
import { defineEventHandler, getQuery, createError } from 'h3'
import { ensureConnection } from '../../../config/database'
import User from '../../../models/User'
import Organization from '../../../models/Organization'

export default defineEventHandler(async (event) => {
  try {
    await ensureConnection()

    const query = getQuery(event)
    const page = parseInt(query.page as string) || 1
    const limit = parseInt(query.limit as string) || 20
    const search = query.search as string || ''
    const skip = (page - 1) * limit

    // Build search filter
    const filter: any = {}
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ]
    }

    // Get users with pagination
    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter)
    ])

    // Get organization info for each user
    const usersWithOrgs = await Promise.all(
      users.map(async (user) => {
        const orgs = await Organization.find({
          'members.userId': user._id,
          isActive: true
        }).select('name slug type').lean()

        return {
          ...user,
          id: user._id,
          organizations: orgs.map(org => ({
            id: org._id,
            name: org.name,
            slug: org.slug,
            type: org.type
          }))
        }
      })
    )

    return {
      success: true,
      data: usersWithOrgs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    }
  } catch (error: any) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
