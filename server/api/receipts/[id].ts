import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getReceiptById } from '../../services/receiptService'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)
    const id = getRouterParam(event, 'id')!

    // Find receipt by ID
    const receipt = await getReceiptById(id)

    // Return 404 if not found
    if (!receipt) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Receipt not found'
        })
    }

    return receipt
})
