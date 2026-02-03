// server/services/transactionService.ts
import Transaction from '../models/Transaction'
import type { ITransaction } from '../models/Transaction'
import { ensureConnection } from '../config/database'

interface TransactionFilters {
  status?: string
  type?: string // 支出 or 入金
  dateFrom?: string
  dateTo?: string
  minAmount?: number
  maxAmount?: number
  search?: string
  hasReceipt?: boolean
  customerId?: string
  supplierId?: string
  accountCategoryId?: string
  transactionCategoryId?: string
  sourceId?: string
}

/**
 * Get all transactions with optional filtering (OMF style)
 */
export async function getTransactions(filters: TransactionFilters = {}) {
  await ensureConnection()
  try {
    const query: any = {}

    // Build query based on filters
    if (filters.status) {
      query.status = filters.status
    }

    if (filters.type) {
      query.type = filters.type
    }

    if (filters.customerId) {
      query.customerId = filters.customerId
    }

    if (filters.supplierId) {
      query.supplierId = filters.supplierId
    }

    if (filters.accountCategoryId) {
      query.accountCategoryId = filters.accountCategoryId
    }

    if (filters.transactionCategoryId) {
      query.transactionCategoryId = filters.transactionCategoryId
    }

    if (filters.sourceId) {
      query.sourceId = filters.sourceId
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
      query.hasReceipt = filters.hasReceipt
    }

    if (filters.search) {
      query.$or = [
        { referenceNumber: { $regex: filters.search, $options: 'i' } },
        { productName: { $regex: filters.search, $options: 'i' } },
        { invoiceNumber: { $regex: filters.search, $options: 'i' } },
        { receiptNumber: { $regex: filters.search, $options: 'i' } },
        { companyInfo: { $regex: filters.search, $options: 'i' } },
        { notes: { $regex: filters.search, $options: 'i' } }
      ]
    }

    const transactions = await Transaction.find(query)
      .populate('customerId', 'name email')
      .populate('supplierId', 'name')
      .populate('accountCategoryId', 'name')
      .populate('subAccountCategoryId', 'name cardNumber cardProvider')
      .populate('taxCategoryId', 'name rate')
      .populate('transactionCategoryId', 'name')
      .populate('sourceId', 'name type')
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
  await ensureConnection()
  try {
    const transaction = await Transaction.findById(id)
      .populate('customerId', 'name email phone')
      .populate('supplierId', 'name companyInfo address email phone')
      .populate('accountCategoryId', 'name code')
      .populate('subAccountCategoryId', 'name cardNumber cardProvider')
      .populate('taxCategoryId', 'name rate')
      .populate('transactionCategoryId', 'name')
      .populate('sourceId', 'name type')
      .lean()
    return transaction
  } catch (error) {
    console.error(`Failed to get transaction ${id}:`, error)
    throw error
  }
}

/**
 * Create a new transaction (OMF style)
 */
export async function createTransaction(data: Partial<ITransaction>) {
  await ensureConnection()
  try {
    // Add initial timeline event
    if (!data.timeline) {
      data.timeline = []
    }
    data.timeline.push({
      type: 'created',
      title: '取引作成',
      timestamp: new Date(),
      description: '取引レコードが作成されました'
    })

    // Set defaults
    if (!data.status) {
      data.status = 'pending'
    }
    if (!data.type) {
      data.type = '支出'
    }
    if (data.hasReceipt === undefined) {
      data.hasReceipt = false
    }

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
  await ensureConnection()
  try {
    // Don't allow changing certain fields
    const { _id, createdAt, ...updateData } = data as any

    // Add timeline event for update
    const updateTimeline = {
      type: 'updated',
      title: '取引更新',
      timestamp: new Date(),
      description: '取引詳細が更新されました'
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
  await ensureConnection()
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
 * Import transactions from parsed file data (OMF style)
 */
export async function importTransactions(
  parsedData: any[],
  mappings: Record<string, string>,
  options: { skipDuplicates?: boolean; updateMatches?: boolean } = {}
) {
  await ensureConnection()
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
          timeline: [{
            type: 'imported',
            title: '取引インポート',
            timestamp: new Date(),
            description: `ファイルからインポート: ${record._sourceFile || 'unknown'}`
          }]
        }

        for (const [sourceField, targetField] of Object.entries(mappings)) {
          if (targetField && record[sourceField] !== undefined) {
            mappedTransaction[targetField] = record[sourceField]
          }
        }

        // Check for existing transaction by referenceNumber
        let existingTransaction = null
        if (mappedTransaction.referenceNumber) {
          existingTransaction = await Transaction.findOne({ referenceNumber: mappedTransaction.referenceNumber })
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
        mappedTransaction.status = mappedTransaction.status || 'pending'
        mappedTransaction.type = mappedTransaction.type || '支出'
        mappedTransaction.date = mappedTransaction.date || new Date()
        mappedTransaction.hasReceipt = mappedTransaction.hasReceipt || false

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
 * Link a receipt to a transaction (OMF style)
 */
export async function linkReceiptToTransaction(transactionId: string, receiptPath: string) {
  await ensureConnection()
  try {
    const transaction = await Transaction.findByIdAndUpdate(
      transactionId,
      {
        hasReceipt: true,
        receiptFilePath: receiptPath,
        receiptUploadedAt: new Date(),
        $push: {
          timeline: {
            $each: [{
              type: 'receipt_linked',
              title: '領収書添付',
              timestamp: new Date(),
              description: `領収書ファイルが添付されました`
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
 * Get transaction statistics (OMF style with income/expense)
 */
export async function getTransactionStats() {
  await ensureConnection()
  try {
    const totalCount = await Transaction.countDocuments()
    const totalAmount = await Transaction.aggregate([
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ])

    // Stats by status
    const statusStats = await Transaction.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          amount: { $sum: '$amount' }
        }
      }
    ])

    // Stats by type (income/expense)
    const typeStats = await Transaction.aggregate([
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          amount: { $sum: '$amount' }
        }
      }
    ])

    // Receipt stats
    const withReceipt = await Transaction.countDocuments({ hasReceipt: true })

    const statusMap = statusStats.reduce((acc: any, item: any) => {
      acc[item._id] = { count: item.count, amount: item.amount }
      return acc
    }, {})

    const typeMap = typeStats.reduce((acc: any, item: any) => {
      acc[item._id] = { count: item.count, amount: item.amount }
      return acc
    }, {})

    return {
      total: {
        count: totalCount,
        amount: totalAmount[0]?.total || 0
      },
      completed: statusMap.completed || { count: 0, amount: 0 },
      pending: statusMap.pending || { count: 0, amount: 0 },
      processing: statusMap.processing || { count: 0, amount: 0 },
      failed: statusMap.failed || { count: 0, amount: 0 },
      avgOrderValue: totalCount > 0 ? (totalAmount[0]?.total || 0) / totalCount : 0,
      receiptMatchRate: totalCount > 0 ? withReceipt / totalCount : 0,
      // Japanese accounting specific
      income: typeMap['入金'] || { count: 0, amount: 0 },
      expense: typeMap['支出'] || { count: 0, amount: 0 }
    }
  } catch (error) {
    console.error('Failed to get transaction stats:', error)
    throw error
  }
}
