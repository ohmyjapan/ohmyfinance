import { defineEventHandler, readBody, getQuery, createError } from 'h3'
import { v4 as uuidv4 } from 'uuid'

// In a real app, you would use a database
// This is a simple in-memory store for demo purposes
let transactions = []

/**
 * GET /api/transactions
 * Get a list of transactions with filtering options
 */
export default defineEventHandler(async (event) => {
    const method = event.method

    // GET - List transactions
    if (method === 'GET') {
        const query = getQuery(event)

        // Apply filters if provided
        let filteredTransactions = [...transactions]

        if (query.status) {
            filteredTransactions = filteredTransactions.filter(t =>
                t.status === query.status
            )
        }

        if (query.source) {
            filteredTransactions = filteredTransactions.filter(t =>
                t.source === query.source
            )
        }

        if (query.dateFrom) {
            const fromDate = new Date(query.dateFrom as string)
            filteredTransactions = filteredTransactions.filter(t =>
                new Date(t.createdAt) >= fromDate
            )
        }

        if (query.dateTo) {
            const toDate = new Date(query.dateTo as string)
            toDate.setHours(23, 59, 59, 999) // End of day
            filteredTransactions = filteredTransactions.filter(t =>
                new Date(t.createdAt) <= toDate
            )
        }

        if (query.minAmount) {
            const min = parseFloat(query.minAmount as string)
            filteredTransactions = filteredTransactions.filter(t =>
                t.amount >= min
            )
        }

        if (query.maxAmount) {
            const max = parseFloat(query.maxAmount as string)
            filteredTransactions = filteredTransactions.filter(t =>
                t.amount <= max
            )
        }

        if (query.search) {
            const search = (query.search as string).toLowerCase()
            filteredTransactions = filteredTransactions.filter(t =>
                t.id.toLowerCase().includes(search) ||
                t.reference.toLowerCase().includes(search) ||
                (t.customer?.name?.toLowerCase().includes(search) || false) ||
                (t.customer?.email?.toLowerCase().includes(search) || false)
            )
        }

        // Pagination
        const page = parseInt(query.page as string) || 1
        const limit = parseInt(query.limit as string) || 10
        const startIndex = (page - 1) * limit
        const endIndex = page * limit

        // Calculate stats
        const total = filteredTransactions.length
        const totalAmount = filteredTransactions.reduce((sum, t) => sum + t.amount, 0)

        // Return paginated results with metadata
        return {
            transactions: filteredTransactions.slice(startIndex, endIndex),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            },
            stats: {
                total,
                totalAmount
            }
        }
    }

    // POST - Create a new transaction
    if (method === 'POST') {
        const body = await readBody(event)

        // Validate required fields
        if (!body.amount || !body.source) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Bad Request',
                message: 'Amount and source are required fields'
            })
        }

        // Create new transaction
        const newTransaction = {
            id: `TRX-${uuidv4().substring(0, 8)}`,
            reference: body.reference || `REF-${Date.now()}`,
            createdAt: new Date().toISOString(),
            status: body.status || 'pending',
            source: body.source,
            amount: parseFloat(body.amount),
            currency: body.currency || 'USD',
            customer: body.customer || {},
            items: body.items || [],
            notes: body.notes || '',
            tags: body.tags || [],
            updatedAt: new Date().toISOString()
        }

        // Add to the collection
        transactions.push(newTransaction)

        return {
            transaction: newTransaction,
            message: 'Transaction created successfully'
        }
    }

    // Method not allowed
    throw createError({
        statusCode: 405,
        statusMessage: 'Method Not Allowed',
        message: `Method ${method} not allowed for this endpoint`
    })
})