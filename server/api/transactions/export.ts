import { defineEventHandler, getQuery, setHeader } from 'h3'

// Reference to in-memory store (replace with DB in production)
import transactions from './index'

/**
 * GET /api/transactions/export
 * Export transactions to CSV or Excel format
 */
export default defineEventHandler(async (event) => {
    // Get query parameters
    const query = getQuery(event)

    // Get format (default to CSV)
    const format = String(query.format || 'csv').toLowerCase()

    // Apply filters (reusing filter logic from index.ts)
    let filteredTransactions = [...transactions]

    if (query.status) {
        filteredTransactions = filteredTransactions.filter(t => t.status === query.status)
    }

    if (query.source) {
        filteredTransactions = filteredTransactions.filter(t => t.source === query.source)
    }

    if (query.dateFrom) {
        const fromDate = new Date(String(query.dateFrom))
        filteredTransactions = filteredTransactions.filter(t => new Date(t.createdAt) >= fromDate)
    }

    if (query.dateTo) {
        const toDate = new Date(String(query.dateTo))
        toDate.setHours(23, 59, 59, 999) // End of the day
        filteredTransactions = filteredTransactions.filter(t => new Date(t.createdAt) <= toDate)
    }

    if (query.minAmount) {
        const min = parseFloat(String(query.minAmount))
        filteredTransactions = filteredTransactions.filter(t => t.amount >= min)
    }

    if (query.maxAmount) {
        const max = parseFloat(String(query.maxAmount))
        filteredTransactions = filteredTransactions.filter(t => t.amount <= max)
    }

    // Define fields to export
    const fields = [
        'id',
        'reference',
        'createdAt',
        'status',
        'source',
        'amount',
        'currency',
        'customerName',
        'customerEmail',
        'paymentMethod',
        'cardLast4',
        'hasReceipt',
        'hasShipment'
    ]

    // Define headers (prettier names for the export)
    const headers = {
        id: 'Transaction ID',
        reference: 'Reference',
        createdAt: 'Date',
        status: 'Status',
        source: 'Source',
        amount: 'Amount',
        currency: 'Currency',
        customerName: 'Customer Name',
        customerEmail: 'Customer Email',
        paymentMethod: 'Payment Method',
        cardLast4: 'Card Last 4',
        hasReceipt: 'Has Receipt',
        hasShipment: 'Has Shipment'
    }

    // Transform data for export
    const exportData = filteredTransactions.map(transaction => {
        return {
            id: transaction.id,
            reference: transaction.reference,
            createdAt: transaction.createdAt,
            status: transaction.status,
            source: transaction.source,
            amount: transaction.amount,
            currency: transaction.currency,
            customerName: transaction.customer?.name || '',
            customerEmail: transaction.customer?.email || '',
            paymentMethod: transaction.paymentMethod?.type || '',
            cardLast4: transaction.paymentMethod?.last4 || '',
            hasReceipt: transaction.receipt ? 'Yes' : 'No',
            hasShipment: transaction.shipment ? 'Yes' : 'No'
        }
    })

    // Generate file content based on format
    let content = ''

    if (format === 'csv') {
        // Generate CSV content
        const headerRow = fields.map(field => headers[field]).join(',')
        const dataRows = exportData.map(row => {
            return fields.map(field => {
                // Quote string values that might contain commas
                const value = row[field]
                if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                    return `"${value.replace(/"/g, '""')}"`
                }
                return value
            }).join(',')
        })

        content = [headerRow, ...dataRows].join('\n')

        // Set proper headers for CSV download
        setHeader(event, 'Content-Type', 'text/csv')
        setHeader(event, 'Content-Disposition', `attachment; filename="transactions_${new Date().toISOString().split('T')[0]}.csv"`)
    } else if (format === 'excel' || format === 'xlsx') {
        // For a real app, you would use a library like exceljs, xlsx, or similar
        // to generate Excel files. For this example, we'll just return JSON data
        // that could be processed by such a library.

        content = JSON.stringify({
            headers: fields.map(field => headers[field]),
            data: exportData.map(row => fields.map(field => row[field]))
        })

        // Set proper headers for JSON
        setHeader(event, 'Content-Type', 'application/json')
        setHeader(event, 'Content-Disposition', `attachment; filename="transactions_${new Date().toISOString().split('T')[0]}.json"`)
    } else {
        // Default to JSON for unsupported formats
        content = JSON.stringify(exportData)

        // Set proper headers for JSON
        setHeader(event, 'Content-Type', 'application/json')
        setHeader(event, 'Content-Disposition', `attachment; filename="transactions_${new Date().toISOString().split('T')[0]}.json"`)
    }

    return content
})