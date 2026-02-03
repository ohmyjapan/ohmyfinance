// server/api/organizations/[id]/invite.ts
import { defineEventHandler, readBody, createError, getRouterParam } from 'h3'
import { ensureConnection } from '../../../config/database'
import { inviteUser } from '../../../services/authService'
import { requireAuth } from '../../../middleware/auth'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const auth = requireAuth(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Organization ID is required' })
  }

  await ensureConnection()

  try {
    const body = await readBody(event)
    const { email, role } = body

    if (!email) {
      throw createError({ statusCode: 400, statusMessage: 'Email is required' })
    }

    const result = await inviteUser(id, auth.userId, email, role || 'member')

    // In a real app, you would send an email with the invite link
    // For now, we return the token directly (for demo purposes)
    const inviteUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/auth/accept-invite?token=${result.inviteToken}`

    return {
      success: true,
      message: `Invitation sent to ${result.email}`,
      inviteUrl, // Remove this in production
      inviteToken: result.inviteToken // Remove this in production
    }
  } catch (error: any) {
    if (error.message.includes('Not authorized') || error.message.includes('already')) {
      throw createError({ statusCode: 403, statusMessage: error.message })
    }
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
