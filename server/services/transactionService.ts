// server/services/transactionService.ts
import Transaction from '../models/Transaction'
import type { ITransaction } from '../models/Transaction'

interface TransactionFilters {
  status?: string
  source?: string
  dateFrom?: string
  dateTo?: string
  minAmount?: number
  maxAmount?: number
  search?: string
  hasReceipt?: boolean
}

/**
 * Get all transactions with optional filtering
 */
export async function getTransactions(filters: TransactionFilters = {}) {
  try {
    const query: any = {}

    // Build query based on filters
    if (filters.status) {
      query.status = filters.status
    }

    if (filters.source) {
      query.source = filters.source
    }

    if (filters.dateFrom || filters.dateTo) {
      query.date = {}
      if (filters.dateFrom) {
        query.date.$gte = new Date(filters.dateFrom)
      }
      if (filters.dateTo) {
        query.date.$lte = new Date(filters.dateTo)
      }
    }

    if (filters.minAmount !== undefined || filters.maxAmount !== undefined) {
      query.amount = {}
      if (filters.minAmount !== undefined) {
        query.amount.$gte = filters.minAmount
      }
      if (filters.maxAmount !== undefined) {
        query.amount.$lte = filters.maxAmount
      }
    }

    if (filters.hasReceipt !== undefined) {
      query['receipt'] = filters.hasReceipt ? { $ne: null } : null
    }

    if (filters.search) {
      query.$or = [
        { reference: { $regex: filters.search, $options: 'i' } },
        { 'customer.name': { $regex: filters.search, $options: 'i' } },
        { 'customer.email': { $regex: filters.search, $options: 'i' } },
        { notes: { $regex: filters.search, $options: 'i' } }
      ]
    }

    const transactions = await Transaction.find(query)
      .sort({ date: -1, createdAt: -1 })
      .lean()

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
    const transaction = await Transaction.findById(id).lean()
    return transaction
  } catch (error) {
    console.error(`Failed to get transaction ${id}:`, error)
    throw error
  }
}

/**
 * Create a new transaction
 */
export async function createTransaction(data: Partial<ITransaction>) {
  try {
    // Generate reference if not provided
    if (!data.reference) {
      data.reference = `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`
    }

    // Add initial timeline event
    if (!data.timeline) {
      data.timeline = []
    }
    data.timeline.push({
      type: 'created',
      title: 'Transaction Created',
      timestamp: new Date(),
      description: 'Transaction record created'
    })

    const transaction = new Transaction(data)
    await transaction.save()

    return transaction.toObject()
  } catch (error) {
    console.error('Failed to create transaction:', error)
    throw error
  }
}

/**
 * Update a transaction
 */
export async function updateTransaction(id: string, data: Partial<ITransaction>) {
  try {
    // Don't allow changing certain fields
    const { _id, createdAt, ...updateData } = data as any

    // Add timeline event for update
    const updateTimeline = {
      type: 'updated',
      title: 'Transaction Updated',
      timestamp: new Date(),
      description: 'Transaction details updated'
    }

    const transaction = await Transaction.findByIdAndUpdate(
      id,
      {
        ...updateData,
        $push: { timeline: { $each: [updateTimeline], $position: 0 } }
      },
      { new: true, runValidators: true }
    ).lean()

    if (!transaction) {
      throw new Error(`Transaction ${id} not found`)
    }

    return transaction
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
    const transaction = await Transaction.findByIdAndDelete(id).lean()

    if (!transaction) {
      throw new Error(`Transaction ${id} not found`)
    }

    return transaction
  } catch (error) {
    console.error(`Failed to delete transaction ${id}:`, error)
    throw error
  }
}

/**
 * Import transactions from parsed file data
 */
export async function importTransactions(
  parsedData: any[],
  mappings: Record<string, string>,
  options: { skipDuplicates?: boolean; updateMatches?: boolean } = {}
) {
  try {
    const results = {
      total: parsedData.length,
      imported: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      transactions: [] as string[]
    }

    for (const record of parsedData) {
      try {
        // Map fields according to provided mappings
        const mappedTransaction: any = {
          customer: {},
          timeline: [{
            type: 'imported',
            title: 'Transaction Imported',
            timestamp: new Date(),
            description: `Imported from file: ${record._sourceFile || 'unknown'}`
          }]
        }

        for (const [sourceField, targetField] of Object.entries(mappings)) {
          if (targetField && record[sourceField] !== undefined) {
            // Handle nested fields
            if (targetField.includes('.')) {
              const [parent, child] = targetField.split('.')
              if (!mappedTransaction[parent]) mappedTransaction[parent] = {}
              mappedTransaction[parent][child] = record[sourceField]
            } else {
              mappedTransaction[targetField] = record[sourceField]
            }
          }
        }

        // Ensure required customer fields
        if (!mappedTransaction.customer.name) {
          mappedTransaction.customer.name = 'Unknown'
        }
        if (!mappedTransaction.customer.email) {
          mappedTransaction.customer.email = 'unknown@example.com'
        }

        // Check for existing transaction by reference
        let existingTransaction = null
        if (mappedTransaction.reference) {
          existingTransaction = await Transaction.findOne({ reference: mappedTransaction.reference })
        }

        if (existingTransaction) {
          if (options.skipDuplicates) {
            results.skipped++
            continue
          } else if (options.updateMatches) {
            await Transaction.findByIdAndUpdate(existingTransaction._id, mappedTransaction)
            results.updated++
            results.transactions.push(existingTransaction._id.toString())
            continue
          }
        }

        // Set defaults
        mappedTransaction.source = record._sourceType || 'manual'
        mappedTransaction.status = mappedTransaction.status || 'pending'
        mappedTransaction.date = mappedTransaction.date || new Date()

        const transaction = new Transaction(mappedTransaction)
        await transaction.save()

        results.imported++
        results.transactions.push(transaction._id.toString())
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
export async function linkReceiptToTransaction(transactionId: string, receiptData: any) {
  try {
    const transaction = await Transaction.findByIdAndUpdate(
      transactionId,
      {
        receipt: receiptData,
        $push: {
          timeline: {
            $each: [{
              type: 'receipt_linked',
              title: 'Receipt Linked',
              timestamp: new Date(),
              description: `Receipt ${receiptData.filename || receiptData.receiptId} linked to transaction`
            }],
            $position: 0
          }
        }
      },
      { new: true }
    ).lean()

    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found`)
    }

    return transaction
  } catch (error) {
    console.error(`Failed to link receipt to transaction ${transactionId}:`, error)
    throw error
  }
}

/**
 * Link a shipment to a transaction
 */
export async function linkShipmentToTransaction(transactionId: string, shipmentData: any) {
  try {
    const transaction = await Transaction.findByIdAndUpdate(
      transactionId,
      {
        shipment: shipmentData,
        $push: {
          timeline: {
            $each: [{
              type: 'shipment_linked',
              title: 'Shipment Linked',
              timestamp: new Date(),
              description: `Shipment ${shipmentData.trackingNumber || shipmentData.shipmentId} linked to transaction`
            }],
            $position: 0
          }
        }
      },
      { new: true }
    ).lean()

    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found`)
    }

    return transaction
  } catch (error) {
    console.error(`Failed to link shipment to transaction ${transactionId}:`, error)
    throw error
  }
}

/**
 * Get transaction statistics
 */
export async function getTransactionStats() {
  try {
    const stats = await Transaction.aggregate([
      {
        $facet: {
          total: [
            { $count: 'count' },
            { $lookup: { from: 'transactions', pipeline: [{ $group: { _id: null, amount: { $sum: '$amount' } } }], as: 'sum' } }
          ],
          byStatus: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
                amount: { $sum: '$amount' }
              }
            }
          ],
          withReceipt: [
            { $match: { receipt: { $ne: null } } },
            { $count: 'count' }
          ]
        }
      }
    ])

    const totalCount = await Transaction.countDocuments()
    const totalAmount = await Transaction.aggregate([
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ])

    const statusStats = stats[0].byStatus.reduce((acc: any, item: any) => {
      acc[item._id] = { count: item.count, amount: item.amount }
      return acc
    }, {})

    const receiptsWithTransaction = stats[0].withReceipt[0]?.count || 0

    return {
      total: {
        count: totalCount,
        amount: totalAmount[0]?.total || 0
      },
      completed: statusStats.completed || { count: 0, amount: 0 },
      pending: statusStats.pending || { count: 0, amount: 0 },
      processing: statusStats.processing || { count: 0, amount: 0 },
      failed: statusStats.failed || { count: 0, amount: 0 },
      avgOrderValue: totalCount > 0 ? (totalAmount[0]?.total || 0) / totalCount : 0,
      receiptMatchRate: totalCount > 0 ? receiptsWithTransaction / totalCount : 0
    }
  } catch (error) {
    console.error('Failed to get transaction stats:', error)
    throw error
  }
}
