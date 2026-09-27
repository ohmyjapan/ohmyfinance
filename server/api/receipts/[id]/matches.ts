// server/api/receipts/[id]/matches.ts
import { defineEventHandler, createError } from 'h3'
import { findMatchesForReceipt } from '../../../services/receiptService'
import { getReceiptById } from '../../../services/receiptManagementService'
import { requireAuth } from '../../../middleware/auth'

/**
 * GET /api/receipts/:id/matches
 * Find potential transaction matches for a receipt
 */
export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const id = event.context.params?.id

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Receipt ID is required'
    })
  }

  try {
    // Verify receipt exists
    const receipt = await getReceiptById(auth.userId, id)
    if (!receipt) {
      throw createError({
        statusCode: 404,
        statusMessage: `Receipt ${id} not found`
      })
    }

    // Find potential matches
    const matches = await findMatchesForReceipt(id)

    return {
      success: true,
      receiptId: id,
      matches,
      totalMatches: matches.length,
      highConfidenceMatches: matches.filter(m => m.confidence >= 80).length
    }
  } catch (error: any) {
    if (error.statusCode) throw error

    console.error(`Error finding matches for receipt ${id}:`, error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to find matches'
    })
  }
})
