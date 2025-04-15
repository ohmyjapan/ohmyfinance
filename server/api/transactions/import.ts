import { defineEventHandler, readMultipartFormData, createError } from 'h3'
import { v4 as uuidv4 } from 'uuid'
import * as Papa from 'papaparse'
import * as XLSX from 'xlsx'

// In a real app, you would use a database
// This is a simple in-memory store that would be shared with other handlers
let transactions = []

/**
 * POST /api/transactions/import
 * Import transactions from CSV or Excel files
 */
export default defineEventHandler(async (event) => {
    if (event.method !== 'POST') {
        throw createError({
            statusCode: 405,
            statusMessage: 'Method Not Allowed',
            message: `Method ${event.method} not allowed for this endpoint`
        })
    }

    // Parse multipart form data (file upload)
    const formData = await readMultipartFormData(event)

    if (!formData || formData.length === 0) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Bad Request',
            message: 'No file uploaded'
        })
    }

    // Get the file and options data
    const file = formData.find(part => part.name === 'file')
    const optionsParam = formData.find(part => part.name === 'options')
    const mappingsParam = formData.find(part => part.name === 'mappings')

    if (!file || !file.data) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Bad Request',
            message: 'Invalid file upload'
        })
    }

    // Parse options and mappings
    const options = optionsParam ? JSON.parse(optionsParam.data.toString()) : {}
    const mappings = mappingsParam ? JSON.parse(mappingsParam.data.toString()) : {}

    // Determine file type
    const fileName = file.filename || ''
    const isCSV = fileName.toLowerCase().endsWith('.csv')
    const isExcel = fileName.toLowerCase().endsWith('.xlsx') || fileName.toLowerCase().endsWith('.xls')

    if (!isCSV && !isExcel) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Bad Request',
            message: 'Unsupported file format. Please upload a CSV or Excel file.'
        })
    }

    try {
        // Parse the file based on type
        let parsedData = []

        if (isCSV) {
            // Parse CSV
            const csvString = file.data.toString()
            const parseResult = Papa.parse(csvString, {
                header: true,
                skipEmptyLines: true,
                dynamicTyping: true
            })

            parsedData = parseResult.data
        } else {
            // Parse Excel
            const workbook = XLSX.read(file.data, { type: 'buffer' })
            const firstSheetName = workbook.SheetNames[0]
            const worksheet = workbook.Sheets[firstSheetName]
            parsedData = XLSX.utils.sheet_to_json(worksheet)
        }

        // Apply field mappings if provided
        if (mappings && Object.keys(mappings).length > 0) {
            parsedData = parsedData.map(row => {
                const mappedRow = {}

                Object.keys(mappings).forEach(sourceField => {
                    const targetField = mappings[sourceField].field

                    if (targetField && row[sourceField] !== undefined) {
                        mappedRow[targetField] = row[sourceField]
                    }
                })

                return mappedRow
            })
        }

        // Track import results
        const importResults = {
            total: parsedData.length,
            imported: 0,
            skipped: 0,
            updated: 0,
            errors: []
        }

        // Process each record
        const importedTransactions = []

        for (const record of parsedData) {
            try {
                // Validate required fields
                if (!record.amount) {
                    importResults.errors.push({
                        record,
                        error: 'Missing required field: amount'
                    })
                    continue
                }

                // Create a transaction reference for matching
                const transactionReference = record.reference || record.transaction_id || ''

                // Check for duplicates if option is enabled
                if (options.skipDuplicates && transactionReference) {
                    const isDuplicate = transactions.some(t =>
                        t.reference === transactionReference
                    )

                    if (isDuplicate) {
                        importResults.skipped++
                        continue
                    }
                }

                // Check for existing transaction to update
                if (options.updateMatches && transactionReference) {
                    const existingIndex = transactions.findIndex(t =>
                        t.reference === transactionReference
                    )

                    if (existingIndex !== -1) {
                        // Update existing transaction
                        const existingTransaction = transactions[existingIndex]

                        // Update fields from the record
                        const updatedTransaction = {
                            ...existingTransaction,
                            amount: parseFloat(record.amount) || existingTransaction.amount,
                            status: record.status || record.transaction_status || existingTransaction.status,
                            currency: record.currency || record.currency_code || existingTransaction.currency,
                            updatedAt: new Date().toISOString()
                        }

                        // Update customer data if provided
                        if (record.customer_email || record.customer_name) {
                            updatedTransaction.customer = {
                                ...existingTransaction.customer,
                                email: record.customer_email || existingTransaction.customer.email,
                                name: record.customer_name || existingTransaction.customer.name
                            }
                        }

                        // Save the updated transaction
                        transactions[existingIndex] = updatedTransaction
                        importedTransactions.push(updatedTransaction)
                        importResults.updated++
                        continue
                    }
                }

                // Determine source type based on file name or options
                let source = 'manual'
                if (fileName.toLowerCase().includes('credit') || fileName.toLowerCase().includes('card')) {
                    source = 'credit_card'
                } else if (fileName.toLowerCase().includes('payment') || fileName.toLowerCase().includes('gateway')) {
                    source = 'payment_gateway'
                } else if (fileName.toLowerCase().includes('overseas') || fileName.toLowerCase().includes('order')) {
                    source = 'overseas'
                }

                // Create a new transaction
                const newTransaction = {
                    id: `TRX-${uuidv4().substring(0, 8)}`,
                    reference: record.reference || record.transaction_id || `REF-${Date.now()}-${importResults.imported}`,
                    createdAt: record.date || record.transaction_date || new Date().toISOString(),
                    status: record.status || record.transaction_status || 'completed',
                    source,
                    amount: parseFloat(record.amount),
                    currency: record.currency || record.currency_code || 'USD',
                    customer: {
                        name: record.customer_name || '',
                        email: record.customer_email || ''
                    },
                    timeline: [
                        {
                            type: 'created',
                            title: 'Transaction Imported',
                            timestamp: new Date().toISOString(),
                            description: `Imported from ${fileName}`
                        }
                    ],
                    notes: record.notes || '',
                    tags: ['imported'],
                    updatedAt: new Date().toISOString()
                }

                // Add to transactions
                transactions.push(newTransaction)
                importedTransactions.push(newTransaction)
                importResults.imported++

            } catch (error) {
                importResults.errors.push({
                    record,
                    error: error.message
                })
            }
        }

        return {
            success: true,
            results: importResults,
            transactions: importedTransactions
        }

    } catch (error) {
        console.error('Transaction import error:', error)
        throw createError({
            statusCode: 500,
            statusMessage: 'Internal Server Error',
            message: `Failed to process file: ${error.message}`
        })
    }
})