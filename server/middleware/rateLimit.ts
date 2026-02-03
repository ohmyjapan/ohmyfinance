// server/middleware/rateLimit.ts
import { defineEventHandler, createError, getRequestIP, H3Event } from 'h3'

interface RateLimitEntry {
  count: number
  resetTime: number
}

// In-memory rate limit store
// In production, use Redis for distributed systems
const rateLimitStore = new Map<string, RateLimitEntry>()

// Rate limit configuration by route pattern
const rateLimitConfig: Record<string, { maxRequests: number; windowMs: number }> = {
  // Auth endpoints - stricter limits
  '/api/auth/login': { maxRequests: 10, windowMs: 60 * 1000 }, // 10 per minute
  '/api/auth/register': { maxRequests: 5, windowMs: 60 * 1000 }, // 5 per minute
  '/api/auth/2fa/verify': { maxRequests: 10, windowMs: 60 * 1000 }, // 10 per minute
  '/api/auth/reset-password': { maxRequests: 3, windowMs: 60 * 1000 }, // 3 per minute
  '/api/auth/verify-pin': { maxRequests: 10, windowMs: 60 * 1000 }, // 10 per minute
  '/api/auth/set-pin': { maxRequests: 5, windowMs: 60 * 1000 }, // 5 per minute
}

// Default rate limit for other API routes
const defaultRateLimit = { maxRequests: 100, windowMs: 60 * 1000 } // 100 per minute

// Auth endpoints that need rate limiting
const authEndpoints = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/2fa/verify',
  '/api/auth/reset-password',
  '/api/auth/verify-pin',
  '/api/auth/set-pin'
]

/**
 * Get rate limit key for a request
 */
function getRateLimitKey(event: H3Event, path: string): string {
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  return `${ip}:${path}`
}

/**
 * Check if a path should be rate limited
 */
function shouldRateLimit(path: string): boolean {
  // Only rate limit auth endpoints for now
  return authEndpoints.some(endpoint => path.startsWith(endpoint))
}

/**
 * Get rate limit config for a path
 */
function getRateLimitConfigForPath(path: string): { maxRequests: number; windowMs: number } {
  for (const [pattern, config] of Object.entries(rateLimitConfig)) {
    if (path.startsWith(pattern)) {
      return config
    }
  }
  return defaultRateLimit
}

/**
 * Clean up expired entries
 */
function cleanupExpiredEntries(): void {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key)
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredEntries, 5 * 60 * 1000)

export default defineEventHandler(async (event: H3Event) => {
  const path = event.path || event.node.req.url || ''

  // Skip rate limiting for non-rate-limited routes
  if (!shouldRateLimit(path)) {
    return
  }

  const key = getRateLimitKey(event, path)
  const config = getRateLimitConfigForPath(path)
  const now = Date.now()

  let entry = rateLimitStore.get(key)

  // Create new entry if doesn't exist or has expired
  if (!entry || now > entry.resetTime) {
    entry = {
      count: 1,
      resetTime: now + config.windowMs
    }
    rateLimitStore.set(key, entry)
    return
  }

  // Increment count
  entry.count++

  // Check if limit exceeded
  if (entry.count > config.maxRequests) {
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000)

    // Set rate limit headers
    event.node.res.setHeader('X-RateLimit-Limit', config.maxRequests.toString())
    event.node.res.setHeader('X-RateLimit-Remaining', '0')
    event.node.res.setHeader('X-RateLimit-Reset', entry.resetTime.toString())
    event.node.res.setHeader('Retry-After', retryAfter.toString())

    throw createError({
      statusCode: 429,
      statusMessage: `Too many requests. Please try again in ${retryAfter} seconds.`
    })
  }

  // Set rate limit headers for successful requests
  event.node.res.setHeader('X-RateLimit-Limit', config.maxRequests.toString())
  event.node.res.setHeader('X-RateLimit-Remaining', (config.maxRequests - entry.count).toString())
  event.node.res.setHeader('X-RateLimit-Reset', entry.resetTime.toString())
})
