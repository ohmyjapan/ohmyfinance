// server/api/receipts/[id]/match.ts
import { defineEventHandler, readBody, createError } from 'h3'
import mongoose from 'mongoose'
import { matchReceiptWithTransaction, unmatchReceipt } from '../../../services/receiptService'
import { requireAuth } from '../../../middleware/auth'
import { ensureConnection } from '../../../config/database'
import { calendarCompany } from '../../../utils/calendarAccess'

/**
 * POST /api/receipts/:id/match
 * Link a receipt of the selected company with one of its transactions
 *
 * DELETE /api/receipts/:id/match
 * Unlink a receipt of the selected company from its transaction
 *
 * The token must select a company the user is still a member of; both records must belong to it. Refusals keep their status
 * (400 identifiers, 404 not in this company, 409 changed or linked elsewhere); the answer carries the saved outcome and whether the
 * transaction badge is synchronized.
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  if (event.method !== 'POST' && event.method !== 'DELETE') {
    throw createError({
      statusCode: 405,
      statusMessage: `Method ${event.method} not allowed`
    })
  }
  await ensureConnection()
  const { organizationId } = await calendarCompany(event)
  const receiptId = event.context.params?.id

  if (!receiptId || !mongoose.isValidObjectId(receiptId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Valid receipt ID is required'
    })
  }

  // Handle DELETE - unmatch receipt
  if (event.method === 'DELETE') {
    try {
      const result = await unmatchReceipt(receiptId, organizationId)
      return {
        success: true,
        message: result.outcome === 'unlinked' ? 'Receipt unmatched successfully' : 'Receipt was not matched',
        ...result
      }
    } catch (error: any) {
      if (error.statusCode) throw error
      console.error('Company receipt unlink failed', error?.name || 'Error')
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to unmatch receipt'
      })
    }
  }

  const body = await readBody(event).catch(() => null)

  if (!body?.transactionId || typeof body.transactionId !== 'string' || !mongoose.isValidObjectId(body.transactionId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Valid transaction ID is required'
    })
  }

  try {
    const result = await matchReceiptWithTransaction(receiptId, body.transactionId, organizationId)

    return {
      success: true,
      message: result.outcome === 'linked' ? 'Receipt matched successfully' : 'Receipt was already matched to this transaction',
      ...result
    }
  } catch (error: any) {
    if (error.statusCode) throw error

    console.error('Company receipt link failed', error?.name || 'Error')
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to match receipt'
    })
  }
})
