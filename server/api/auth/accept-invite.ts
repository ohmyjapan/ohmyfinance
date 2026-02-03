// server/api/auth/accept-invite.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import { acceptInvite } from '../../services/authService'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const body = await readBody(event)
  const { inviteToken, name, password } = body

  if (!inviteToken) {
    throw createError({ statusCode: 400, statusMessage: 'Invite token is required' })
  }

  try {
    await ensureConnection()

    const result = await acceptInvite(inviteToken, { name, password })

    return {
      success: true,
      message: 'Invitation accepted',
      user: result.user,
      organization: result.organization,
      tokens: result.tokens
    }
  } catch (error: any) {
    if (error.message.includes('Invalid') || error.message.includes('expired')) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    if (error.message.includes('required')) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
