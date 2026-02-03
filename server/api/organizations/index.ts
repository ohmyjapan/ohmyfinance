// server/api/organizations/index.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Organization from '../../models/Organization'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)

  await ensureConnection()

  // GET - List user's organizations
  if (event.method === 'GET') {
    try {
      const organizations = await Organization.find({
        'members.userId': auth.userId,
        isActive: true
      }).lean()

      return {
        success: true,
        organizations: organizations.map((org: any) => ({
          ...org,
          id: org._id,
          role: org.members.find((m: any) => m.userId.toString() === auth.userId)?.role
        }))
      }
    } catch (error: any) {
      throw createError({ statusCode: 500, statusMessage: error.message })
    }
  }

  // POST - Create new organization
  if (event.method === 'POST') {
    try {
      const body = await readBody(event)
      const { name, type, description } = body

      if (!name) {
        throw createError({ statusCode: 400, statusMessage: 'Organization name is required' })
      }

      const slug = await (Organization as any).generateSlug(name)

      const organization = await Organization.create({
        name,
        slug,
        type: type || 'personal',
        description,
        members: [{
          userId: auth.userId,
          role: 'owner',
          joinedAt: new Date()
        }]
      })

      return {
        success: true,
        organization: {
          ...organization.toJSON(),
          role: 'owner'
        }
      }
    } catch (error: any) {
      throw createError({ statusCode: 500, statusMessage: error.message })
    }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
