import { defineEventHandler, readBody, createError } from 'h3'
import { createTransaction } from '../../services/transactionService'
import AccountCategory from '../../models/AccountCategory'
import TaxCategory from '../../models/TaxCategory'
import Supplier from '../../models/Supplier'
import TransactionCategory from '../../models/TransactionCategory'
import Customer from '../../models/Customer'
import { ensureConnection } from '../../config/database'

/**
 * POST /api/transactions/import
 * Import pre-parsed transactions with field mappings applied.
 * Receives JSON body: { data: [...], mappings: {...}, options: {...} }
 * Data comes from the excel-processor API (already parsed).
 * Auth: handled by api.ts middleware for /api/transactions/* routes
 */
export default defineEventHandler(async (event) => {

    if (event.method !== 'POST') {
        throw createError({
            statusCode: 405,
            statusMessage: 'Method Not Allowed',
            message: `Method ${event.method} not allowed for this endpoint`
        })
    }

    const body = await readBody(event)

    if (!body || !body.data || !Array.isArray(body.data)) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Bad Request',
            message: 'Missing data array in request body'
        })
    }

    const mappings = body.mappings || {}
    const options = body.options || {}

    try {
        // Apply field mappings to raw data
        let parsedData = body.data

        if (mappings && Object.keys(mappings).length > 0) {
            parsedData = parsedData.map((row: any) => {
                const mappedRow: Record<string, any> = {}

                Object.keys(mappings).forEach(sourceField => {
                    const mapping = mappings[sourceField]
                    const targetField = mapping?.field

                    if (targetField && targetField !== '' && targetField !== 'null' && row[sourceField] !== undefined) {
                        mappedRow[targetField] = row[sourceField]
                    }
                })

                return mappedRow
            })
        }

        // Ensure MongoDB connection
        await ensureConnection()

        // Track import results
        const importResults = {
            total: parsedData.length,
            imported: 0,
            skipped: 0,
            updated: 0,
            errors: [] as any[]
        }

        // Process each record
        const importedTransactions: any[] = []

        // Helper function to find or create related records by name
        const findAccountCategory = async (name: string) => {
            if (!name) return null
            const cat = await AccountCategory.findOne({ name })
            return cat?._id || null
        }

        const findTaxCategory = async (name: string) => {
            if (!name) return null
            const cat = await TaxCategory.findOne({ name })
            return cat?._id || null
        }

        const findSupplier = async (name: string) => {
            if (!name) return null
            let supplier = await Supplier.findOne({ name })
            if (!supplier) {
                supplier = await Supplier.create({ name, isActive: true })
            }
            return supplier._id
        }

        const findCustomer = async (name: string) => {
            if (!name) return null
            let customer = await Customer.findOne({ name })
            if (!customer) {
                customer = await Customer.create({ name, isActive: true })
            }
            return customer._id
        }

        const findTransactionCategory = async (name: string) => {
            if (!name) return null
            const cat = await TransactionCategory.findOne({ name })
            return cat?._id || null
        }

        for (const record of parsedData) {
            try {
                // Parse amount — strip commas from formatted numbers like "32,995"
                const rawAmount = String(record.amount || '').replace(/,/g, '')
                const parsedAmount = parseFloat(rawAmount)

                // Validate required fields
                if (isNaN(parsedAmount)) {
                    importResults.errors.push({
                        record,
                        error: '金額は必須です (Missing or invalid amount)'
                    })
                    continue
                }

                // Parse date — handle YYYY/MM/DD format
                let transactionDate = new Date()
                if (record.date) {
                    const dateStr = String(record.date).replace(/\//g, '-')
                    transactionDate = new Date(dateStr)
                    if (isNaN(transactionDate.getTime())) {
                        transactionDate = new Date()
                    }
                }

                // Parse type (支出/入金)
                let transactionType = record.type || '支出'
                if (transactionType !== '支出' && transactionType !== '入金') {
                    transactionType = parsedAmount < 0 ? '支出' : '入金'
                }

                // Resolve related IDs by name
                const accountCategoryId = await findAccountCategory(record.accountCategoryName)
                const subAccountCategoryId = await findAccountCategory(record.subAccountCategoryName)
                const taxCategoryId = await findTaxCategory(record.taxCategoryName)
                const supplierId = await findSupplier(record.supplierName)
                const customerId = await findCustomer(record.customerName)
                const transactionCategoryId = await findTransactionCategory(record.transactionCategoryName)

                // Create a new transaction (OMF style)
                const transactionData = {
                    referenceNumber: record.referenceNumber || `IMP-${Date.now()}-${importResults.imported}`,
                    date: transactionDate,
                    amount: Math.abs(parsedAmount),
                    type: transactionType,
                    status: 'completed',
                    accountCategoryId,
                    subAccountCategoryId,
                    taxCategoryId,
                    taxRate: record.taxRate ? parseFloat(record.taxRate) : undefined,
                    supplierId,
                    customerId,
                    transactionCategoryId,
                    companyInfo: record.companyInfo || '',
                    invoiceNumber: record.invoiceNumber || '',
                    receiptNumber: record.receiptNumber || '',
                    productName: record.productName || '',
                    productPrice: record.productPrice ? parseFloat(record.productPrice) : undefined,
                    janCode: record.janCode || '',
                    notes: record.notes || '',
                    hasReceipt: false,
                    tags: ['imported'],
                    timeline: [
                        {
                            type: 'imported',
                            title: 'インポート完了',
                            timestamp: new Date(),
                            description: 'CSVインポート'
                        }
                    ]
                }

                const newTransaction = await createTransaction(transactionData)
                importedTransactions.push(newTransaction)
                importResults.imported++

            } catch (error: any) {
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

    } catch (error: any) {
        console.error('Transaction import error:', error)
        throw createError({
            statusCode: 500,
            statusMessage: 'Internal Server Error',
            message: `Failed to process file: ${error?.message || error}`
        })
    }
})