// server/api/receipts/auto-match.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { autoMatchReceipts } from '../../services/receiptService'
import { requireAuth } from '../../middleware/auth'

/**
 * POST /api/receipts/auto-match
 * Automatically match unmatched receipts with high-confidence transactions
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  if (event.method !== 'POST') {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method not allowed'
    })
  }

  try {
    const body = await readBody(event).catch(() => ({}))
    const minConfidence = body.minConfidence || 85

    if (minConfidence < 50 || minConfidence > 100) {
      throw createError({
        statusCode: 400,
        statusMessage: 'minConfidence must be between 50 and 100'
      })
    }

    const results = await autoMatchReceipts(minConfidence)

    return {
      success: true,
      message: `Auto-matched ${results.matched} of ${results.processed} receipts`,
      ...results
    }
  } catch (error: any) {
    if (error.statusCode) throw error

    console.error('Error in auto-match:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to auto-match receipts'
    })
  }
})
