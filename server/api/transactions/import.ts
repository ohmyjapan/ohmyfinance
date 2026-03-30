import { defineEventHandler, readBody, createError } from 'h3'
import crypto from 'crypto'
import { createTransaction } from '../../services/transactionService'
import AccountCategory from '../../models/AccountCategory'
import TaxCategory from '../../models/TaxCategory'
import Supplier from '../../models/Supplier'
import TransactionCategory from '../../models/TransactionCategory'
import Customer from '../../models/Customer'
import Transaction from '../../models/Transaction'
import { ensureConnection } from '../../config/database'

/**
 * POST /api/transactions/import
 * Import pre-parsed transactions with field mappings applied.
 * Receives JSON body: { data: [...], mappings: {...}, options: {...}, source?: string, fileName?: string }
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
    const importSource = body.source || ''
    const importFileName = body.fileName || ''

    // Generate batch ID for this import
    const batchId = `IMP-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`

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

        // --- Lookup cache: pre-load all reference documents to avoid N+1 queries ---
        const [allAccountCategories, allTaxCategories, allTransactionCategories, allSuppliers, allCustomers] = await Promise.all([
            AccountCategory.find({}).lean(),
            TaxCategory.find({}).lean(),
            TransactionCategory.find({}).lean(),
            Supplier.find({}).lean(),
            Customer.find({}).lean(),
        ])

        const accountCategoryMap = new Map<string, any>()
        for (const doc of allAccountCategories) accountCategoryMap.set((doc as any).name, (doc as any)._id)

        const taxCategoryMap = new Map<string, any>()
        for (const doc of allTaxCategories) taxCategoryMap.set((doc as any).name, (doc as any)._id)

        const transactionCategoryMap = new Map<string, any>()
        for (const doc of allTransactionCategories) transactionCategoryMap.set((doc as any).name, (doc as any)._id)

        const supplierMap = new Map<string, any>()
        for (const doc of allSuppliers) supplierMap.set((doc as any).name, (doc as any)._id)

        const customerMap = new Map<string, any>()
        for (const doc of allCustomers) customerMap.set((doc as any).name, (doc as any)._id)

        // Cached lookup helpers
        const findAccountCategory = (name: string) => {
            if (!name) return null
            return accountCategoryMap.get(name) || null
        }

        const findTaxCategory = (name: string) => {
            if (!name) return null
            return taxCategoryMap.get(name) || null
        }

        const findTransactionCategory = (name: string) => {
            if (!name) return null
            return transactionCategoryMap.get(name) || null
        }

        const findSupplier = async (name: string) => {
            if (!name) return null
            if (supplierMap.has(name)) return supplierMap.get(name)
            // Auto-create and cache
            const supplier = await Supplier.create({ name, isActive: true })
            supplierMap.set(name, supplier._id)
            return supplier._id
        }

        const findCustomer = async (name: string) => {
            if (!name) return null
            if (customerMap.has(name)) return customerMap.get(name)
            // Auto-create and cache
            const customer = await Customer.create({ name, isActive: true })
            customerMap.set(name, customer._id)
            return customer._id
        }

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
                let transactionDate: Date
                if (record.date) {
                    const dateStr = String(record.date).replace(/\//g, '-')
                    transactionDate = new Date(dateStr)
                    if (isNaN(transactionDate.getTime())) {
                        // Invalid date → push to errors instead of silently using today
                        importResults.errors.push({
                            record,
                            error: `無効な日付です: ${record.date} (Invalid date)`
                        })
                        continue
                    }
                } else {
                    transactionDate = new Date()
                }

                // Parse type (支出/入金)
                let transactionType = record.type || '支出'
                if (transactionType !== '支出' && transactionType !== '入金') {
                    transactionType = parsedAmount < 0 ? '支出' : '入金'
                }

                // Skip duplicates check
                if (options.skipDuplicates) {
                    const existing = await Transaction.findOne({
                        date: transactionDate,
                        amount: Math.abs(parsedAmount),
                        notes: record.notes || ''
                    })
                    if (existing) {
                        importResults.skipped++
                        continue
                    }
                }

                // Resolve related IDs by name (using cached lookups)
                const accountCategoryId = findAccountCategory(record.accountCategoryName)
                const subAccountCategoryId = findAccountCategory(record.subAccountCategoryName)
                const taxCategoryId = findTaxCategory(record.taxCategoryName)
                const supplierId = await findSupplier(record.supplierName)
                const customerId = await findCustomer(record.customerName)
                const transactionCategoryId = findTransactionCategory(record.transactionCategoryName)

                // Build timeline description
                const timelineDesc = importFileName
                    ? `${importSource || 'CSV'}インポート (${importFileName})`
                    : `${importSource || 'CSV'}インポート`

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
                    tags: ['imported', `batch:${batchId}`],
                    metadata: {
                        importBatchId: batchId,
                        importSource: importSource || undefined,
                    },
                    timeline: [
                        {
                            type: 'imported',
                            title: 'インポート完了',
                            timestamp: new Date(),
                            description: timelineDesc
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
            batchId,
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
