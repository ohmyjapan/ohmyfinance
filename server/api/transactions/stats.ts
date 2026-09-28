// server/api/transactions/stats.ts
import { defineEventHandler, createError } from 'h3'
import { getTransactionStats } from '../../services/transactionService'
import { ensureConnection } from '../../config/database'
import { requireLedgerAccess } from '../../services/ledgerAccessService'

export default defineEventHandler(async (event) => {
  const access = await requireLedgerAccess(event)
  await ensureConnection()

  try {
    const stats = await getTransactionStats(access)
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
