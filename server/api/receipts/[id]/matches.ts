// server/api/receipts/[id]/matches.ts
import { defineEventHandler, createError, setHeader } from 'h3'
import mongoose from 'mongoose'
import { findCompanyMatchesForReceipt } from '../../../services/receiptService'
import { requireAuth } from '../../../middleware/auth'
import { ensureConnection } from '../../../config/database'
import { calendarCompany } from '../../../utils/calendarAccess'

/**
 * GET /api/receipts/:id/matches
 * Find potential transaction matches for a receipt
 */
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  requireAuth(event)
  await ensureConnection()
  const { organizationId } = await calendarCompany(event)
  const id = event.context.params?.id

  if (!id || !mongoose.isValidObjectId(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Valid receipt ID is required'
    })
  }

  try {
    const matches = await findCompanyMatchesForReceipt(id, organizationId)
    if (!matches) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Receipt not found'
      })
    }

    return {
      success: true,
      scope: 'selected_company',
      receiptId: id,
      matches,
      totalMatches: matches.length,
      highConfidenceMatches: matches.filter(m => m.confidence >= 80).length
    }
  } catch (error: any) {
    if (error.statusCode) throw error

    console.error('Company receipt candidate lookup failed')
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to find company receipt candidates'
    })
  }
})
