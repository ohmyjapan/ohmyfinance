// server/services/tokenBlacklistService.ts

// In-memory token blacklist
// In production, use Redis for distributed systems
const blacklist = new Map<string, number>() // jti -> expiresAt timestamp

// Cleanup interval (every 5 minutes)
let cleanupInterval: ReturnType<typeof setInterval> | null = null

/**
 * Add a token to the blacklist
 */
export function addToBlacklist(jti: string, expiresAt: Date): void {
  blacklist.set(jti, expiresAt.getTime())
}

/**
 * Check if a token is blacklisted
 */
export function isBlacklisted(jti: string): boolean {
  const expiresAt = blacklist.get(jti)
  if (!expiresAt) return false

  // If expired, remove from blacklist and return false
  if (Date.now() > expiresAt) {
    blacklist.delete(jti)
    return false
  }

  return true
}

/**
 * Remove expired entries from the blacklist
 */
export function cleanupBlacklist(): void {
  const now = Date.now()
  for (const [jti, expiresAt] of blacklist.entries()) {
    if (now > expiresAt) {
      blacklist.delete(jti)
    }
  }
}

/**
 * Start automatic cleanup
 */
export function startCleanup(): void {
  if (cleanupInterval) return

  // Run cleanup every 5 minutes
  cleanupInterval = setInterval(cleanupBlacklist, 5 * 60 * 1000)
}

/**
 * Stop automatic cleanup
 */
export function stopCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
    cleanupInterval = null
  }
}

/**
 * Get blacklist size (for monitoring)
 */
export function getBlacklistSize(): number {
  return blacklist.size
}

// Start cleanup on module load
startCleanup()
