// server/api/auth/register.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import { registerUser } from '../../services/authService'
import { validatePassword, isCommonPassword } from '../../utils/passwordValidator'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const body = await readBody(event)
  const { email, password, name, organizationType, organizationName } = body

  if (!email || !password || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Email, password, and name are required' })
  }

  // Validate password strength
  const passwordValidation = validatePassword(password)
  if (!passwordValidation.valid) {
    throw createError({
      statusCode: 400,
      statusMessage: passwordValidation.errors.join('. ')
    })
  }

  // Check for common passwords
  if (isCommonPassword(password)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This password is too common. Please choose a more secure password.'
    })
  }

  try {
    await ensureConnection()

    const result = await registerUser({
      email,
      password,
      name,
      organizationType,
      organizationName
    })

    return {
      success: true,
      message: 'Registration successful',
      user: result.user,
      organization: result.organization,
      tokens: result.tokens
    }
  } catch (error: any) {
    if (error.message === 'Email already registered') {
      throw createError({ statusCode: 409, statusMessage: error.message })
    }
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
