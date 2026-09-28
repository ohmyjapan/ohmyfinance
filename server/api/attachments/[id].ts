import { defineEventHandler, createError } from 'h3'
import { requireAuth } from '../../middleware/auth'

// Legacy filenames have no proven company ownership. Keep existing files intact
// for reviewed recovery; originals are now registered through /api/receipts/upload.
export default defineEventHandler((event) => {
  requireAuth(event)
  throw createError({ statusCode: 410, statusMessage: 'Legacy attachments are retired. Use the receipt workspace.' })
})
