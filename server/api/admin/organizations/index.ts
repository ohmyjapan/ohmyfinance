// server/api/admin/organizations/index.ts
import { defineEventHandler, getQuery, readBody, createError } from 'h3'
import { ensureConnection } from '../../../config/database'
import Organization from '../../../models/Organization'
import User from '../../../models/User'

export default defineEventHandler(async (event) => {
  try {
    await ensureConnection()

    // GET - List organizations
    if (event.method === 'GET') {
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
          { slug: { $regex: search, $options: 'i' } }
        ]
      }

      const [organizations, total] = await Promise.all([
        Organization.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Organization.countDocuments(filter)
      ])

      // Get member details for each organization
      const orgsWithMembers = await Promise.all(
        organizations.map(async (org) => {
          const memberIds = org.members.map(m => m.userId)
          const members = await User.find({ _id: { $in: memberIds } })
            .select('name email')
            .lean()

          return {
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
        })
      )

      return {
        success: true,
        data: orgsWithMembers,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    }

    // POST - Create organization
    if (event.method === 'POST') {
      const body = await readBody(event)
      const { name, type, ownerId } = body

      if (!name) {
        throw createError({ statusCode: 400, statusMessage: 'Organization name is required' })
      }

      // Generate slug
      const slug = await (Organization as any).generateSlug(name)

      const orgData: any = {
        name,
        slug,
        type: type || 'personal',
        members: []
      }

      // Add owner if specified
      if (ownerId) {
        const owner = await User.findById(ownerId)
        if (!owner) {
          throw createError({ statusCode: 404, statusMessage: 'Owner user not found' })
        }
        orgData.members.push({
          userId: ownerId,
          role: 'owner',
          joinedAt: new Date()
        })
      }

      const organization = await Organization.create(orgData)

      return {
        success: true,
        data: organization
      }
    }

    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
