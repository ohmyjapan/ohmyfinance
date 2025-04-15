import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'

// Reference to in-memory store (replace with DB in production)
import transactions from '../index'
import receipts from '../../receipts/index'

/**
 * PUT /api/transactions/:id/receipt
 * Attach a receipt to a transaction
 */
export const PUT = defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const body = await readBody(event)

    // Validate required fields
    if (!body.receiptId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Receipt ID is required'
        })
    }

    // Find transaction index
    const transactionIndex = transactions.findIndex(t => t.id === id)

    // Return 404 if transaction not found
    if (transactionIndex === -1) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Transaction not found'
        })
    }

    // Find receipt
    const receipt = receipts.find(r => r.id === body.receiptId)

    // Return 404 if receipt not found
    if (!receipt) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Receipt not found'
        })
    }

    // Check if receipt is already attached to another transaction
    if (receipt.transactionId && receipt.transactionId !== id) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Receipt is already attached to another transaction'
        })
    }

    // Create a receipt reference for the transaction
    const receiptReference = {
        id: receipt.id,
        filename: receipt.filename,
        size: receipt.size,
        date: receipt.date || receipt.uploadDate,
        amount: receipt.amount,
        merchant: receipt.merchant
    }

    // Create a timeline event for the receipt attachment
    const timelineEvent = {
        type: 'receipt_attached',
        title: 'Receipt Attached',
        timestamp: new Date().toISOString(),
        description: `Receipt "${receipt.filename}" attached to transaction`
    }

    // Update transaction with receipt reference and timeline event
    const updatedTransaction = {
        ...transactions[transactionIndex],
        receipt: receiptReference,
        timeline: [timelineEvent, ...transactions[transactionIndex].timeline]
    }

    // Save updated transaction
    transactions[transactionIndex] = updatedTransaction

    // Update receipt with transaction ID
    const receiptIndex = receipts.findIndex(r => r.id === receipt.id)
    if (receiptIndex !== -1) {
        receipts[receiptIndex] = {
            ...receipts[receiptIndex],
            status: 'matched',
            transactionId: id,
            updatedAt: new Date().toISOString()
        }
    }

    return {
        success: true,
        message: 'Receipt attached to transaction successfully',
        transaction: updatedTransaction
    }
})

/**
 * DELETE /api/transactions/:id/receipt
 * Remove a receipt from a transaction
 */
export const DELETE = defineEventHandler((event) => {
    const id = getRouterParam(event, 'id')

    // Find transaction index
    const transactionIndex = transactions.findIndex(t => t.id === id)

    // Return 404 if not found
    if (transactionIndex === -1) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Transaction not found'
        })
    }

    // Check if transaction has a receipt
    const transaction = transactions[transactionIndex]
    if (!transaction.receipt) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Transaction does not have an attached receipt'
        })
    }

    // Get receipt ID before removing
    const receiptId = transaction.receipt.id

    // Create a timeline event for the receipt removal
    const timelineEvent = {
        type: 'receipt_removed',
        title: 'Receipt Removed',
        timestamp: new Date().toISOString(),
        description: 'Receipt was removed from transaction'
    }

    // Update transaction to remove receipt and add timeline event
    const updatedTransaction = {
        ...transaction,
        receipt: null,
        timeline: [timelineEvent, ...transaction.timeline]
    }

    // Save updated transaction
    transactions[transactionIndex] = updatedTransaction

    // Update the receipt status to unmatched
    const receiptIndex = receipts.findIndex(r => r.id === receiptId)
    if (receiptIndex !== -1) {
        receipts[receiptIndex] = {
            ...receipts[receiptIndex],
            status: 'unmatched',
            transactionId: null,
            updatedAt: new Date().toISOString()
        }
    }

    return {
        success: true,
        message: 'Receipt removed from transaction successfully',
        transaction: updatedTransaction
    }
})