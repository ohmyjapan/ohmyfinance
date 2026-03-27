// server/api/transactions/stats.ts
import { defineEventHandler, createError } from 'h3'
import { getTransactionStats } from '../../services/transactionService'
import { ensureConnection } from '../../config/database'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  await ensureConnection()

  try {
    const stats = await getTransactionStats()
    return stats
  } catch (error: any) {
    console.error('Failed to get transaction stats:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error.message
    })
  }
})
