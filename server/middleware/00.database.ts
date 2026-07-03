// server/middleware/00.database.ts
// Ensure the MongoDB connection is alive for EVERY /api request.
// Before this middleware, recovery after a disconnect relied on each handler calling
// ensureConnection() itself — 26 of 104 API files didn't, so an idle-time mongo hiccup
// left those routes failing until some covered route healed the connection.
// ensureConnection() is idempotent and a no-op when connected (readyState check),
// so the existing per-route calls remain harmless.
import { defineEventHandler } from 'h3'
import { ensureConnection } from '../config/database'

export default defineEventHandler(async (event) => {
  if (!event.path?.startsWith('/api/')) return
  try {
    await ensureConnection()
  } catch (error) {
    // Let the route handler surface its own error shape; connection state is flagged
    // and the next request retries. Logging here would fire on every request while
    // mongo is down — the database module already logs connect failures once.
  }
})
