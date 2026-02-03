// server/api/organizations/[id].ts
import { defineEventHandler, readBody, createError, getRouterParam } from 'h3'
import { ensureConnection } from '../../config/database'
import Organization from '../../models/Organization'
import { requireAuth } from '../../middleware/auth'

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

  // GET - Get organization details
  if (event.method === 'GET') {
    return {
      success: true,
      organization: {
        ...organization.toJSON(),
        role: userRole
      }
    }
  }

  // PUT/PATCH - Update organization
  if (event.method === 'PUT' || event.method === 'PATCH') {
    // Only owner and admin can update
    if (!['owner', 'admin'].includes(userRole)) {
      throw createError({ statusCode: 403, statusMessage: 'Not authorized to update organization' })
    }

    try {
      const body = await readBody(event)
      const { name, type, description, logo, website, email, phone, address, taxId, settings } = body

      // Update fields
      if (name !== undefined) organization.name = name
      if (type !== undefined && ['personal', 'business', 'enterprise'].includes(type)) {
        organization.type = type
      }
      if (description !== undefined) organization.description = description
      if (logo !== undefined) organization.logo = logo
      if (website !== undefined) organization.website = website
      if (email !== undefined) organization.email = email
      if (phone !== undefined) organization.phone = phone
      if (address !== undefined) organization.address = address
      if (taxId !== undefined) organization.taxId = taxId
      if (settings !== undefined) {
        organization.settings = { ...organization.settings, ...settings }
      }

      await organization.save()

      return {
        success: true,
        organization: {
          ...organization.toJSON(),
          role: userRole
        }
      }
    } catch (error: any) {
      throw createError({ statusCode: 500, statusMessage: error.message })
    }
  }

  // DELETE - Deactivate organization (only owner)
  if (event.method === 'DELETE') {
    if (userRole !== 'owner') {
      throw createError({ statusCode: 403, statusMessage: 'Only owner can delete organization' })
    }

    try {
      organization.isActive = false
      await organization.save()

      return {
        success: true,
        message: 'Organization deleted'
      }
    } catch (error: any) {
      throw createError({ statusCode: 500, statusMessage: error.message })
    }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
