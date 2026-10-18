// server/api/transactions/stats.ts
import { defineEventHandler, createError, setHeader } from 'h3'
import { getTransactionStats } from '../../services/transactionService'
import { ensureConnection } from '../../config/database'
import { requireAuth } from '../../middleware/auth'
import { calendarCompany } from '../../utils/calendarAccess'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  requireAuth(event)
  await ensureConnection()
  const { organizationId } = await calendarCompany(event)

  try {
    const stats = await getTransactionStats(organizationId)
    return stats
  } catch {
    throw createError({ statusCode: 500, statusMessage: 'Failed to read company transaction statistics' })
  }
})
