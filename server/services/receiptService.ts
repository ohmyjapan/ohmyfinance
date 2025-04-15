// server/services/receiptService.ts
import { randomUUID } from 'crypto'
import {
    findAll,
    findById,
    findBy,
    create,
    update,
    remove
} from '../utils/database'
import { extractReceiptData, findReceiptMatches } from './fileUploadService'
import { getTransactionById, linkReceiptToTransaction } from './transactionService'

/**
 * Get all receipts with optional filtering
 */
export async function getReceipts(filters = {}) {
    try {
        const receipts = await findAll('receipts')

        // Apply filters if provided
        if (Object.keys(filters).length > 0) {
            return receipts.filter(receipt => {
                for (const [key, value] of Object.entries(filters)) {
                    // Handle special cases
                    if (key === 'dateFrom' && receipt.date < value) return false
                    if (key === 'dateTo' && receipt.date > value) return false
                    if (key === 'minAmount' && receipt.amount < value) return false
                    if (key === 'maxAmount' && receipt.amount > value) return false
                    if (key === 'search') {
                        const searchValue = String(value).toLowerCase()
                        const searchFields = ['id', 'filename', 'merchant']
                        const matches = searchFields.some(field =>
                            receipt[field] &&
                            String(receipt[field]).toLowerCase().includes(searchValue)
                        )
                        if (!matches) return false
                    }
                    // Standard equality check for other fields
                    else if (key in receipt && receipt[key] !== value) {
                        return false
                    }
                }
                return true
            })
        }

        return receipts
    } catch (error) {
        console.error('Failed to get receipts:', error)
        throw error
    }
}

/**
 * Get a receipt by ID
 */
export async function getReceiptById(id: string) {
    try {
        return findById('receipts', id)
    } catch (error) {
        console.error(`Failed to get receipt ${id}:`, error)
        throw error
    }
}

/**
 * Create a new receipt from an uploaded file
 */
export async function createReceipt(fileRecord: any, metadata = {}) {
    try {
        // Extract data from receipt using OCR/document parsing
        const extractedData = await extractReceiptData(fileRecord)

        // Combine extracted data with provided metadata
        const receiptData = {
            ...extractedData,
            ...metadata,
            id: `rec_${randomUUID().replace(/-/g, '')}`,
            fileId: fileRecord.id,
            filename: fileRecord.originalName,
            size: fileRecord.size,
            uploadDate: fileRecord.uploadDate,
            status: 'unmatched',
            transactionId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }

        // Save receipt to database
        const receipt = await create('receipts', receiptData)

        return receipt
    } catch (error) {
        console.error('Failed to create receipt:', error)
        throw error
    }
}

/**
 * Update a receipt
 */
export async function updateReceipt(id: string, data: any) {
    try {
        // Don't allow changing certain fields
        const { id: _, createdAt, fileId, ...updateData } = data

        // Add updatedAt timestamp
        updateData.updatedAt = new Date().toISOString()

        return update('receipts', id, updateData)
    } catch (error) {
        console.error(`Failed to update receipt ${id}:`, error)
        throw error
    }
}

/**
 * Delete a receipt
 */
export async function deleteReceipt(id: string) {
    try {
        // Get the receipt first
        const receipt = await getReceiptById(id)
        if (!receipt) {
            throw new Error(`Receipt ${id} not found`)
        }

        // If receipt is matched to a transaction, update the transaction
        if (receipt.status === 'matched' && receipt.transactionId) {
            // This is a simplified version - in a real app, you'd use a transaction
            // to ensure atomicity
            const transaction = await getTransactionById(receipt.transactionId)
            if (transaction) {
                await update('transactions', receipt.transactionId, {
                    receiptId: null,
                    hasReceipt: false,
                    updatedAt: new Date().toISOString()
                })
            }
        }

        // Remove the receipt
        return remove('receipts', id)
    } catch (error) {
        console.error(`Failed to delete receipt ${id}:`, error)
        throw error
    }
}

/**
 * Find potential transaction matches for a receipt
 */
export async function findMatchesForReceipt(receiptId: string) {
    try {
        const receipt = await getReceiptById(receiptId)
        if (!receipt) {
            throw new Error(`Receipt ${receiptId} not found`)
        }

        // Get potential matches based on receipt data
        const matches = await findReceiptMatches({
            date: receipt.date,
            amount: receipt.amount,
            merchant: receipt.merchant
        })

        // For each potential match, get full transaction details
        const matchDetails = []
        for (const match of matches) {
            const transaction = await getTransactionById(match.transactionId)
            if (transaction) {
                matchDetails.push({
                    ...match,
                    transaction
                })
            }
        }

        return matchDetails
    } catch (error) {
        console.error(`Failed to find matches for receipt ${receiptId}:`, error)
        throw error
    }
}

/**
 * Match a receipt with a transaction
 */
export async function matchReceiptWithTransaction(receiptId: string, transactionId: string) {
    try {
        const receipt = await getReceiptById(receiptId)
        if (!receipt) {
            throw new Error(`Receipt ${receiptId} not found`)
        }

        const transaction = await getTransactionById(transactionId)
        if (!transaction) {
            throw new Error(`Transaction ${transactionId} not found`)
        }

        // Update receipt to reflect the match
        await updateReceipt(receiptId, {
            status: 'matched',
            transactionId,
            updatedAt: new Date().toISOString()
        })

        // Update transaction to link to the receipt
        await linkReceiptToTransaction(transactionId, receiptId)

        return {
            receipt: await getReceiptById(receiptId),
            transaction: await getTransactionById(transactionId)
        }
    } catch (error) {
        console.error(`Failed to match receipt ${receiptId} with transaction ${transactionId}:`, error)
        throw error
    }
}

/**
 * Unmatch a receipt from a transaction
 */
export async function unmatchReceipt(receiptId: string) {
    try {
        const receipt = await getReceiptById(receiptId)
        if (!receipt) {
            throw new Error(`Receipt ${receiptId} not found`)
        }

        if (receipt.status !== 'matched' || !receipt.transactionId) {
            throw new Error(`Receipt ${receiptId} is not matched to a transaction`)
        }

        const transactionId = receipt.transactionId

        // Update receipt to reflect unmatched status
        await updateReceipt(receiptId, {
            status: 'unmatched',
            transactionId: null,
            updatedAt: new Date().toISOString()
        })

        // Update transaction to remove receipt reference
        await update('transactions', transactionId, {
            receiptId: null,
            hasReceipt: false,
            updatedAt: new Date().toISOString()
        })

        return {
            receipt: await getReceiptById(receiptId),
            transactionId
        }
    } catch (error) {
        console.error(`Failed to unmatch receipt ${receiptId}:`, error)
        throw error
    }
}

/**
 * Get receipt statistics
 */
export async function getReceiptStats() {
    try {
        const receipts = await findAll('receipts')

        const total = receipts.length
        const matched = receipts.filter(r => r.status === 'matched').length
        const unmatched = total - matched
        const matchRate = total > 0 ? (matched / total) * 100 : 0

        return {
            total,
            matched,
            unmatched,
            matchRate: Math.round(matchRate * 100) / 100 // Round to 2 decimal places
        }
    } catch (error) {
        console.error('Failed to get receipt stats:', error)
        throw error
    }
}