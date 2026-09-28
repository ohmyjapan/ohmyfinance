// server/services/transactionService.ts
import { withReceiptLinks, receiptPresence } from './receiptLinkService'
import Transaction, { activeTransactionFilter } from '../models/Transaction'
import { createError } from 'h3'
import { Types } from 'mongoose'
import type { LedgerAccess } from './ledgerAccessService'
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
export async function getTransactions(access: LedgerAccess, filters: TransactionFilters = {}) {
  await ensureConnection()
  try {
    const query: any = { organizationId: access.organizationId }

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
      query.$and = [await receiptPresence(access, filters.hasReceipt)]
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

    const transactions = await Transaction.find(activeTransactionFilter(query))
      .populate('customerId', 'name email')
      .populate('supplierId', 'name')
      .populate('accountCategoryId', 'name')
      .populate('subAccountCategoryId', 'name cardNumber cardProvider')
      .populate('taxCategoryId', 'name rate')
      .populate('transactionCategoryId', 'name')
      .populate('sourceId', 'name type')
      .sort({ date: -1, createdAt: -1 })
      .lean()

    return withReceiptLinks(access, transactions)
  } catch (error) {
    console.error('Failed to get transactions:', error)
    throw error
  }
}

/**
 * Get a transaction by ID
 */
export async function getTransactionById(access: LedgerAccess, id: string) {
  await ensureConnection()
  try {
    const transaction = await Transaction.findOne(activeTransactionFilter({ _id: id, organizationId: access.organizationId }))
      .populate('customerId', 'name email phone')
      .populate('supplierId', 'name companyInfo address email phone')
      .populate('accountCategoryId', 'name code')
      .populate('subAccountCategoryId', 'name cardNumber cardProvider')
      .populate('taxCategoryId', 'name rate')
      .populate('transactionCategoryId', 'name')
      .populate('sourceId', 'name type')
      .lean()
    return transaction ? (await withReceiptLinks(access, [transaction]))[0] : null
  } catch (error) {
    console.error(`Failed to get transaction ${id}:`, error)
    throw error
  }
}

/**
 * Create a new transaction (OMF style)
 */
export async function createTransaction(access: LedgerAccess, data: Partial<ITransaction>) {
  await ensureConnection()
  try {
    if (data.cardAccounting !== undefined) throw createError({ statusCode: 400, message: 'Card accounting is assigned through the reviewed import.' })
    // Generic metadata cannot register evidence or adopt a client-supplied path.
    const { _id, manualCreate, deletedAt, deletedBy, receipt, hasReceipt, receiptFilePath, receiptUploadedAt, attachments, ...metadata } = data as any
    data = metadata
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

    const transaction = new Transaction({ ...data, organizationId: access.organizationId })
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
export async function updateTransaction(access: LedgerAccess, id: string, data: Partial<ITransaction>) {
  await ensureConnection()
  try {
    // Don't allow changing certain fields
    // Receipt fields returned by reads are projections, not editable evidence.
    const { _id, createdAt, organizationId, manualCreate, deletedAt, deletedBy, receipt, hasReceipt, receiptFilePath, receiptUploadedAt, attachments, ...updateData } = data as any

    if (Object.keys(updateData).some(k => k.startsWith('$') || k.includes('.')) || updateData.cardAccounting !== undefined) throw createError({ statusCode: 400, message: 'Card accounting cannot be replaced by a transaction edit.' })
    const current: any = await Transaction.findOne(activeTransactionFilter({ _id: id, organizationId: access.organizationId })).select('cardAccounting amount type paymentMethod cardNumber metadata').lean()
    if (!current) throw new Error(`Transaction ${id} not found`)
    if (current.cardAccounting) {
      for (const key of ['amount', 'type', 'paymentMethod', 'cardNumber']) if (updateData[key] !== undefined && updateData[key] !== current[key]) throw createError({ statusCode: 409, message: 'Imported card source values cannot be changed.' })
      if (updateData.metadata !== undefined) updateData.metadata = { ...updateData.metadata, ...current.metadata }
    }
    // Add timeline event for update
    const updateTimeline = {
      type: 'updated',
      title: '取引更新',
      timestamp: new Date(),
      description: '取引詳細が更新されました'
    }

    const transaction = await Transaction.findOneAndUpdate(
      activeTransactionFilter({ _id: id, organizationId: access.organizationId }),
      {
        ...updateData,
        $push: { timeline: { $each: [updateTimeline], $position: 0 } }
      },
      { new: true, runValidators: true }
    ).lean()

    if (!transaction) {
      throw new Error(`Transaction ${id} not found`)
    }

    return (await withReceiptLinks(access, [transaction]))[0]
  } catch (error) {
    console.error(`Failed to update transaction ${id}:`, error)
    throw error
  }
}

/**
 * Delete a transaction
 */
/** Keep keyed identities after deletion; legacy unkeyed rows retain their old behavior. */
export async function removeTransactions(access: LedgerAccess, filter: Record<string, any>) {
  await ensureConnection()
  const scope = { $and: [{ organizationId: access.organizationId }, filter] }
  const archived = await Transaction.updateMany(
    activeTransactionFilter({ $and: [scope, { 'manualCreate.key': { $type: 'string' } }] }),
    { $set: { deletedAt: new Date(), deletedBy: access.userId } }
  )
  // The exclusion is evaluated at the actual delete, not on an earlier snapshot.
  const removed = await Transaction.deleteMany({
    $and: [scope, { manualCreate: null, deletedAt: null }]
  })
  return { deletedCount: archived.modifiedCount + removed.deletedCount }
}

export async function deleteTransaction(access: LedgerAccess, id: string) {
  await ensureConnection()
  try {
    const scope = { _id: id, organizationId: access.organizationId }
    const archived = await Transaction.findOneAndUpdate(
      activeTransactionFilter({ ...scope, 'manualCreate.key': { $type: 'string' } }),
      { $set: { deletedAt: new Date(), deletedBy: access.userId } },
      { new: false }
    ).lean()
    // Keep the legacy removal atomic; two concurrent deletes cannot both remove it.
    const transaction = archived || await Transaction.findOneAndDelete({
      ...scope, manualCreate: null, deletedAt: null
    }).lean() || await Transaction.findOne({
      ...scope, 'manualCreate.key': { $type: 'string' }, deletedAt: { $ne: null }
    }).lean()

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
  access: LedgerAccess,
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
          existingTransaction = await Transaction.findOne(activeTransactionFilter({ organizationId: access.organizationId, referenceNumber: mappedTransaction.referenceNumber }))
        }

        if (existingTransaction) {
          if (options.skipDuplicates) {
            results.skipped++
            continue
          } else if (options.updateMatches) {
            const { timeline, ...updates } = mappedTransaction
            await updateTransaction(access, existingTransaction._id.toString(), updates)
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

        const transaction = await createTransaction(access, mappedTransaction)

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
 * Get transaction statistics (OMF style with income/expense)
 */
export async function getTransactionStats(access: LedgerAccess) {
  await ensureConnection()
  try {
    const scope = { organizationId: new Types.ObjectId(access.organizationId) }
    const totalCount = await Transaction.countDocuments(activeTransactionFilter(scope))
    const totalAmount = await Transaction.aggregate([
      { $match: activeTransactionFilter({}) },
      { $match: scope },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ])

    // Stats by status
    const statusStats = await Transaction.aggregate([
      { $match: activeTransactionFilter({}) },
      { $match: scope },
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
      { $match: activeTransactionFilter({}) },
      { $match: scope },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          amount: { $sum: '$amount' }
        }
      }
    ])

    // Receipt stats
    const withReceipt = await Transaction.countDocuments(activeTransactionFilter({ ...scope, ...await receiptPresence(access, true) }))

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
