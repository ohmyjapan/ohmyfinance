import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'

// Reference to in-memory store (replace with DB in production)
import transactions from '../index'

/**
 * PATCH /api/transactions/:id/status
 * Update a transaction's status
 */
export const PATCH = defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const body = await readBody(event)

    // Validate required fields
    if (!body.status) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Status is required'
        })
    }

    // Validate status value
    const validStatuses = ['pending', 'processing', 'completed', 'failed', 'refunded', 'cancelled']
    if (!validStatuses.includes(body.status)) {
        throw createError({
            statusCode: 400,
            statusMessage: `Status must be one of: ${validStatuses.join(', ')}`
        })
    }

    // Find transaction index
    const transactionIndex = transactions.findIndex(t => t.id === id)

    // Return 404 if not found
    if (transactionIndex === -1) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Transaction not found'
        })
    }

    // Get current transaction
    const transaction = transactions[transactionIndex]

    // Validate status transition
    const invalidTransitions = [
        { from: 'completed', to: 'pending' },
        { from: 'completed', to: 'processing' },
        { from: 'refunded', to: 'pending' },
        { from: 'refunded', to: 'processing' },
        { from: 'refunded', to: 'completed' },
        { from: 'cancelled', to: 'pending' },
        { from: 'cancelled', to: 'processing' },
        { from: 'cancelled', to: 'completed' }
    ]

    const invalidTransition = invalidTransitions.find(
        t => t.from === transaction.status && t.to === body.status
    )

    if (invalidTransition) {
        throw createError({
            statusCode: 400,
            statusMessage: `Cannot transition from '${transaction.status}' to '${body.status}'`
        })
    }

    // Create a timeline event for the status change
    const now = new Date().toISOString()
    const timelineEvent = {
        type: body.status,
        title: `Transaction ${body.status.charAt(0).toUpperCase() + body.status.slice(1)}`,
        timestamp: now,
        description: body.notes || `Status changed from '${transaction.status}' to '${body.status}'`
    }

    // Update transaction with new status and timeline event
    const updatedTransaction = {
        ...transaction,
        status: body.status,
        timeline: [timelineEvent, ...transaction.timeline]
    }

    // Save updated transaction
    transactions[transactionIndex] = updatedTransaction

    return {
        success: true,
        message: 'Transaction status updated successfully',
        transaction: updatedTransaction
    }
})