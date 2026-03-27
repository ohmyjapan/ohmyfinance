import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { Receipt } from '~/types/receipt'
import { getReceiptById, updateReceipt, deleteReceipt } from '../../services/receiptService'
import { requireAuth } from '../../middleware/auth'

/**
 * GET /api/receipts/:id
 * Get a receipt by ID
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
    const id = getRouterParam(event, 'id')

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

/**
 * PATCH /api/receipts/:id
 * Update a receipt
 */
export const PATCH = defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const body = await readBody(event)

    // Find receipt index
    const receiptIndex = receipts.findIndex(r => r.id === id)

    // Return 404 if not found
    if (receiptIndex === -1) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Receipt not found'
        })
    }

    // Update receipt with new data
    const updatedReceipt: Receipt = {
        ...receipts[receiptIndex],
        ...body,
        updatedAt: new Date().toISOString()
    }

    // Save updated receipt
    receipts[receiptIndex] = updatedReceipt

    return updatedReceipt
})

/**
 * DELETE /api/receipts/:id
 * Delete a receipt
 */
export const DELETE = defineEventHandler((event) => {
    const id = getRouterParam(event, 'id')

    // Find receipt index
    const receiptIndex = receipts.findIndex(r => r.id === id)

    // Return 404 if not found
    if (receiptIndex === -1) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Receipt not found'
        })
    }

    // Remove receipt from store
    const deletedReceipt = receipts[receiptIndex]
    receipts.splice(receiptIndex, 1)

    return {
        success: true,
        message: 'Receipt deleted successfully',
        receipt: deletedReceipt
    }
})