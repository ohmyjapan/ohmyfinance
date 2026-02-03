// server/middleware/auth.ts
import { defineEventHandler, getHeader, createError, H3Event } from 'h3'
import { verifyToken, TokenPayload } from '../services/authService'
import { isBlacklisted } from '../services/tokenBlacklistService'

// Extend H3Event to include auth context
declare module 'h3' {
  interface H3EventContext {
    auth?: TokenPayload & { isAuthenticated: boolean }
  }
}

// Routes that don't require authentication
const publicRoutes = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/accept-invite',
  '/api/invites/', // For getting invite details and accepting invites
  '/api/health',
  '/api/docs',
  '/_nuxt',
  '/__nuxt',
  '/manifest.json',
  '/sw.js',
  '/favicon.ico'
]

// Check if route is public
function isPublicRoute(path: string): boolean {
  return publicRoutes.some(route => path.startsWith(route))
}

// Check if route is an API route
function isApiRoute(path: string): boolean {
  return path.startsWith('/api/')
}

export default defineEventHandler(async (event: H3Event) => {
  const path = event.path || event.node.req.url || ''

  // Skip auth for non-API routes (let Nuxt handle page rendering)
  if (!isApiRoute(path)) {
    return
  }

  // Skip auth for public routes
  if (isPublicRoute(path)) {
    return
  }

  // Get authorization header
  const authHeader = getHeader(event, 'authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Set unauthenticated context but don't block
    // Let individual routes decide if auth is required
    event.context.auth = {
      isAuthenticated: false,
      userId: '',
      email: ''
    }
    return
  }

  const token = authHeader.substring(7) // Remove 'Bearer '

  try {
    const payload = verifyToken(token)

    if (!payload) {
      event.context.auth = {
        isAuthenticated: false,
        userId: '',
        email: ''
      }
      return
    }

    // Check if token is blacklisted
    if (payload.jti && isBlacklisted(payload.jti)) {
      event.context.auth = {
        isAuthenticated: false,
        userId: '',
        email: ''
      }
      return
    }

    // Set authenticated context
    event.context.auth = {
      ...payload,
      isAuthenticated: true
    }
  } catch (error) {
    event.context.auth = {
      isAuthenticated: false,
      userId: '',
      email: ''
    }
  }
})

// Helper function for protected routes
export function requireAuth(event: H3Event): TokenPayload {
  const auth = event.context.auth

  if (!auth?.isAuthenticated) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Authentication required'
    })
  }

  return auth as TokenPayload
}

// Helper function to require specific organization
export function requireOrganization(event: H3Event, organizationId?: string): TokenPayload {
  const auth = requireAuth(event)

  if (organizationId && auth.organizationId !== organizationId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Access denied to this organization'
    })
  }

  if (!auth.organizationId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No organization selected'
    })
  }

  return auth
}

// Helper function to require specific roles
export function requireRole(event: H3Event, allowedRoles: string[]): TokenPayload {
  const auth = requireAuth(event)

  if (!auth.role || !allowedRoles.includes(auth.role)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Insufficient permissions'
    })
  }

  return auth
}
