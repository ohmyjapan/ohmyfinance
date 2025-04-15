import { defineEventHandler, readBody, createError } from 'h3'

// In a real app, you would use a database
// This is a simple in-memory store that would be shared with other handlers
// For a real implementation, use a database or a shared data store
let transactions = []

/**
 * Handles operations on a specific transaction by ID
 * GET, PATCH, DELETE /api/transactions/:id
 */
export default defineEventHandler(async (event) => {
    const method = event.method
    const id = event.context.params.id

    // Find the transaction
    const transactionIndex = transactions.findIndex(t => t.id === id)

    if (transactionIndex === -1) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
            message: `Transaction with ID ${id} not found`
        })
    }

    const transaction = transactions[transactionIndex]

    // GET - Retrieve transaction details
    if (method === 'GET') {
        return { transaction }
    }

    // PATCH - Update transaction
    if (method === 'PATCH') {
        const body = await readBody(event)

        // Update transaction fields
        const updatedTransaction = {
            ...transaction,
            ...body,
            // Ensure these fields can't be changed
            id: transaction.id,
            createdAt: transaction.createdAt,
            // Update the updatedAt timestamp
            updatedAt: new Date().toISOString()
        }

        // Add a timeline event if status is changing
        if (body.status && body.status !== transaction.status) {
            const statusEvent = {
                type: body.status,
                title: `Transaction ${body.status.charAt(0).toUpperCase() + body.status.slice(1)}`,
                timestamp: new Date().toISOString(),
                description: body.statusNotes || `Status changed to ${body.status}`
            }

            updatedTransaction.timeline = [
                statusEvent,
                ...(transaction.timeline || [])
            ]
        }

        // Save the updated transaction
        transactions[transactionIndex] = updatedTransaction

        return {
            transaction: updatedTransaction,
            message: 'Transaction updated successfully'
        }
    }

    // DELETE - Remove transaction
    if (method === 'DELETE') {
        // Remove the transaction
        transactions.splice(transactionIndex, 1)

        return {
            id,
            message: 'Transaction deleted successfully'
        }
    }

    // Method not allowed
    throw createError({
        statusCode: 405,
        statusMessage: 'Method Not Allowed',
        message: `Method ${method} not allowed for this endpoint`
    })
})