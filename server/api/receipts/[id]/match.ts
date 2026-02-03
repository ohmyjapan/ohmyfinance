// server/api/receipts/[id]/match.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { matchReceiptWithTransaction, unmatchReceipt, getReceiptById } from '../../../services/receiptService'

/**
 * POST /api/receipts/:id/match
 * Match a receipt with a transaction
 *
 * DELETE /api/receipts/:id/match
 * Unmatch a receipt from its transaction
 */
export default defineEventHandler(async (event) => {
  const receiptId = event.context.params?.id

  if (!receiptId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Receipt ID is required'
    })
  }

  // Handle DELETE - unmatch receipt
  if (event.method === 'DELETE') {
    try {
      const result = await unmatchReceipt(receiptId)
      return {
        success: true,
        message: 'Receipt unmatched successfully',
        ...result
      }
    } catch (error: any) {
      console.error(`Error unmatching receipt ${receiptId}:`, error)
      throw createError({
        statusCode: error.message?.includes('not found') ? 404 : 400,
        statusMessage: error.message || 'Failed to unmatch receipt'
      })
    }
  }

  // Handle POST - match receipt with transaction
  if (event.method !== 'POST') {
    throw createError({
      statusCode: 405,
      statusMessage: `Method ${event.method} not allowed`
    })
  }

  const body = await readBody(event)

  if (!body.transactionId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Transaction ID is required'
    })
  }

  try {
    // Verify receipt exists and is not already matched
    const receipt = await getReceiptById(receiptId)
    if (!receipt) {
      throw createError({
        statusCode: 404,
        statusMessage: `Receipt ${receiptId} not found`
      })
    }

    if (receipt.status === 'matched' && receipt.transactionId?.toString() !== body.transactionId) {
      throw createError({
        statusCode: 400,
        statusMessage: `Receipt is already matched to transaction ${receipt.transactionId}`
      })
    }

    // Match the receipt with transaction
    const result = await matchReceiptWithTransaction(receiptId, body.transactionId)

    return {
      success: true,
      message: 'Receipt matched successfully',
      ...result
    }
  } catch (error: any) {
    if (error.statusCode) throw error

    console.error(`Error matching receipt ${receiptId}:`, error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to match receipt'
    })
  }
})
