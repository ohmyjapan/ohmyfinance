import { defineEventHandler, readBody, createError } from 'h3'

// In a real app, you would use a database
// These are simple in-memory stores that would be shared with other handlers
let receipts = []
let transactions = []

/**
 * POST /api/receipts/:id/match
 * Match a receipt with a transaction
 */
export default defineEventHandler(async (event) => {
    if (event.method !== 'POST') {
        throw createError({
            statusCode: 405,
            statusMessage: 'Method Not Allowed',
            message: `Method ${event.method} not allowed for this endpoint`
        })
    }

    const receiptId = event.context.params.id
    const body = await readBody(event)

    // Validate request body
    if (!body.transactionId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Bad Request',
            message: 'Transaction ID is required'
        })
    }

    const transactionId = body.transactionId

    // Find the receipt
    const receiptIndex = receipts.findIndex(r => r.id === receiptId)

    if (receiptIndex === -1) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
            message: `Receipt with ID ${receiptId} not found`
        })
    }

    // Find the transaction
    const transactionIndex = transactions.findIndex(t => t.id === transactionId)

    if (transactionIndex === -1) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
            message: `Transaction with ID ${transactionId} not found`
        })
    }

    const receipt = receipts[receiptIndex]
    const transaction = transactions[transactionIndex]

    // Check if receipt is already matched
    if (receipt.status === 'matched' && receipt.transactionId && receipt.transactionId !== transactionId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Bad Request',
            message: `Receipt is already matched to transaction ${receipt.transactionId}`
        })
    }

    // Update receipt with transaction ID
    const updatedReceipt = {
        ...receipt,
        status: 'matched',
        transactionId,
        updatedAt: new Date().toISOString()
    }

    // Update receipt in the collection
    receipts[receiptIndex] = updatedReceipt

    // Update transaction with receipt reference
    const updatedTransaction = {
        ...transaction,
        receipt: {
            id: receipt.id,
            filename: receipt.filename,
            size: receipt.size,
            date: receipt.uploadDate,
            amount: receipt.amount,
            merchant: receipt.merchant,
            url: receipt.url
        },
        updatedAt: new Date().toISOString()
    }

    // Add a timeline event for the receipt match
    if (!updatedTransaction.timeline) {
        updatedTransaction.timeline = []
    }

    updatedTransaction.timeline.unshift({
        type: 'receipt_attached',
        title: 'Receipt Attached',
        timestamp: new Date().toISOString(),
        description: `Receipt "${receipt.filename}" matched to transaction`
    })

    // Update transaction in the collection
    transactions[transactionIndex] = updatedTransaction

    return {
        receipt: updatedReceipt,
        transaction: updatedTransaction,
        message: 'Receipt matched successfully'
    }
})