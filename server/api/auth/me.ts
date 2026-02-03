// server/api/auth/me.ts
import { defineEventHandler, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import User from '../../models/User'
import Organization from '../../models/Organization'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async (event) => {
  if (event.method !== 'GET') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const auth = requireAuth(event)

  try {
    await ensureConnection()

    const user = await User.findById(auth.userId)
    if (!user) {
      throw createError({ statusCode: 404, statusMessage: 'User not found' })
    }

    // Get user's organizations
    const organizations = await Organization.find({
      'members.userId': auth.userId,
      isActive: true
    }).lean()

    // Get current organization
    let currentOrganization = null
    if (auth.organizationId) {
      currentOrganization = organizations.find(
        (org: any) => org._id.toString() === auth.organizationId
      )
    }

    return {
      success: true,
      user: user.toJSON(),
      organizations: organizations.map((org: any) => ({
        ...org,
        id: org._id,
        role: org.members.find((m: any) => m.userId.toString() === auth.userId)?.role
      })),
      currentOrganization: currentOrganization ? {
        ...currentOrganization,
        id: currentOrganization._id,
        role: currentOrganization.members.find((m: any) => m.userId.toString() === auth.userId)?.role
      } : null
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
