// server/services/transactionService.ts
import { randomUUID } from 'crypto'
import {
    findAll,
    findById,
    findBy,
    create,
    update,
    remove
} from '../utils/database'

/**
 * Get all transactions with optional filtering
 */
export async function getTransactions(filters = {}) {
    try {
        const transactions = await findAll('transactions')

        // Apply filters if provided
        if (Object.keys(filters).length > 0) {
            return transactions.filter(transaction => {
                for (const [key, value] of Object.entries(filters)) {
                    // Handle special cases
                    if (key === 'dateFrom' && transaction.date < value) return false
                    if (key === 'dateTo' && transaction.date > value) return false
                    if (key === 'minAmount' && transaction.amount < value) return false
                    if (key === 'maxAmount' && transaction.amount > value) return false
                    if (key === 'search') {
                        const searchValue = String(value).toLowerCase()
                        const searchFields = ['id', 'reference', 'customerName', 'customerEmail']
                        const matches = searchFields.some(field =>
                            transaction[field] &&
                            String(transaction[field]).toLowerCase().includes(searchValue)
                        )
                        if (!matches) return false
                    }
                    // Standard equality check for other fields
                    else if (key in transaction && transaction[key] !== value) {
                        return false
                    }
                }
                return true
            })
        }

        return transactions
    } catch (error) {
        console.error('Failed to get transactions:', error)
        throw error
    }
}

/**
 * Get a transaction by ID
 */
export async function getTransactionById(id: string) {
    try {
        return findById('transactions', id)
    } catch (error) {
        console.error(`Failed to get transaction ${id}:`, error)
        throw error
    }
}

/**
 * Create a new transaction
 */
export async function createTransaction(data: any) {
    try {
        const transaction = {
            id: `txn_${randomUUID().replace(/-/g, '')}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: data.status || 'pending',
            ...data
        }

        return create('transactions', transaction)
    } catch (error) {
        console.error('Failed to create transaction:', error)
        throw error
    }
}

/**
 * Update a transaction
 */
export async function updateTransaction(id: string, data: any) {
    try {
        // Don't allow changing certain fields
        const { id: _, createdAt, ...updateData } = data

        // Add updatedAt timestamp
        updateData.updatedAt = new Date().toISOString()

        return update('transactions', id, updateData)
    } catch (error) {
        console.error(`Failed to update transaction ${id}:`, error)
        throw error
    }
}

/**
 * Delete a transaction
 */
export async function deleteTransaction(id: string) {
    try {
        return remove('transactions', id)
    } catch (error) {
        console.error(`Failed to delete transaction ${id}:`, error)
        throw error
    }
}

/**
 * Import transactions from parsed file data
 */
export async function importTransactions(parsedData: any[], mappings: Record<string, string>, options = {}) {
    try {
        const results = {
            total: parsedData.length,
            imported: 0,
            updated: 0,
            skipped: 0,
            failed: 0,
            transactions: []
        }

        // Process each record
        for (const record of parsedData) {
            try {
                // Map fields according to provided mappings
                const mappedTransaction: any = {}

                for (const [sourceField, targetField] of Object.entries(mappings)) {
                    if (targetField && record[sourceField] !== undefined) {
                        mappedTransaction[targetField] = record[sourceField]
                    }
                }

                // Determine whether transaction exists already
                let existingTransaction
                if (mappedTransaction.reference) {
                    existingTransaction = (await findBy('transactions', { reference: mappedTransaction.reference }))[0]
                }

                // Handle existing transaction based on options
                if (existingTransaction) {
                    if (options['skipDuplicates']) {
                        results.skipped++
                        continue
                    } else if (options['updateMatches']) {
                        // Update existing transaction
                        await updateTransaction(existingTransaction.id, {
                            ...mappedTransaction,
                            updatedAt: new Date().toISOString()
                        })
                        results.updated++
                        results.transactions.push(existingTransaction.id)
                        continue
                    }
                }

                // Create new transaction
                const transaction = await createTransaction({
                    ...mappedTransaction,
                    source: record._sourceType || 'import',
                    status: mappedTransaction.status || 'pending',
                    importData: {
                        sourceFile: record._sourceFile,
                        importDate: record._importDate,
                        sourceType: record._sourceType
                    }
                })

                results.imported++
                results.transactions.push(transaction.id)
            } catch (error) {
                console.error('Failed to import transaction record:', error)
                results.failed++
            }
        }

        return results
    } catch (error) {
        console.error('Failed to import transactions:', error)
        throw error
    }
}

/**
 * Link a receipt to a transaction
 */
export async function linkReceiptToTransaction(transactionId: string, receiptId: string) {
    try {
        const transaction = await getTransactionById(transactionId)
        if (!transaction) {
            throw new Error(`Transaction ${transactionId} not found`)
        }

        // Update the transaction with receipt reference
        return updateTransaction(transactionId, {
            receiptId,
            hasReceipt: true,
            updatedAt: new Date().toISOString()
        })
    } catch (error) {
        console.error(`Failed to link receipt ${receiptId} to transaction ${transactionId}:`, error)
        throw error
    }
}

/**
 * Link a shipment to a transaction
 */
export async function linkShipmentToTransaction(transactionId: string, shipmentId: string) {
    try {
        const transaction = await getTransactionById(transactionId)
        if (!transaction) {
            throw new Error(`Transaction ${transactionId} not found`)
        }

        // Update the transaction with shipment reference
        return updateTransaction(transactionId, {
            shipmentId,
            hasShipment: true,
            updatedAt: new Date().toISOString()
        })
    } catch (error) {
        console.error(`Failed to link shipment ${shipmentId} to transaction ${transactionId}:`, error)
        throw error
    }
}

/**
 * Get transaction statistics
 */
export async function getTransactionStats() {
    try {
        const transactions = await findAll('transactions')

        // Calculate basic stats
        const total = {
            count: transactions.length,
            amount: transactions.reduce((sum, t) => sum + (t.amount || 0), 0)
        }

        const getStatusStats = (status) => ({
            count: transactions.filter(t => t.status === status).length,
            amount: transactions
                .filter(t => t.status === status)
                .reduce((sum, t) => sum + (t.amount || 0), 0)
        })

        const completed = getStatusStats('completed')
        const pending = getStatusStats('pending')
        const processing = getStatusStats('processing')
        const failed = getStatusStats('failed')

        // Calculate derived stats
        const avgOrderValue = total.count > 0 ? total.amount / total.count : 0
        const receiptsWithTransaction = transactions.filter(t => t.hasReceipt).length
        const receiptMatchRate = total.count > 0 ? receiptsWithTransaction / total.count : 0

        return {
            total,
            completed,
            pending,
            processing,
            failed,
            avgOrderValue,
            receiptMatchRate
        }
    } catch (error) {
        console.error('Failed to get transaction stats:', error)
        throw error
    }
}