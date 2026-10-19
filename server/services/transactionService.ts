// server/services/transactionService.ts
import Transaction from '../models/Transaction'
import { createError } from 'h3'
import mongoose from 'mongoose'
import Customer from '../models/Customer'
import Supplier from '../models/Supplier'
import AccountCategory from '../models/AccountCategory'
import TaxCategory from '../models/TaxCategory'
import TransactionCategory from '../models/TransactionCategory'
import DataSource from '../models/DataSource'
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
export async function getTransactions(filters: TransactionFilters, organizationId: mongoose.Types.ObjectId, window?: { skip: number, limit: number }) {
  await ensureConnection()
  try {
    const query: any = { organizationId }

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

    const request = Transaction.find(query)
      .populate({ path: 'customerId', select: 'name email', model: Customer })
      .populate({ path: 'supplierId', select: 'name', model: Supplier })
      .populate({ path: 'accountCategoryId', select: 'name', model: AccountCategory })
      .populate({ path: 'subAccountCategoryId', select: 'name cardNumber cardProvider', model: AccountCategory })
      .populate({ path: 'taxCategoryId', select: 'name rate', model: TaxCategory })
      .populate({ path: 'transactionCategoryId', select: 'name', model: TransactionCategory })
      .populate({ path: 'sourceId', select: 'name type', model: DataSource })
      .sort({ date: -1, createdAt: -1 })
    if (window) request.sort({ date: -1, createdAt: -1, _id: -1 }).skip(window.skip).limit(window.limit)
    const transactions = await request.lean()
    return transactions
  } catch (error) {
    console.error('Company transaction list read failed')
    throw error
  }
}

/**
 * Get a transaction by ID
 */
export async function getTransactionById(id: string, organizationId: mongoose.Types.ObjectId) {
  await ensureConnection()
  try {
    const transaction = await Transaction.findOne({ _id: id, organizationId })
      .populate({ path: 'customerId', select: 'name email phone', model: Customer })
      .populate({ path: 'supplierId', select: 'name companyInfo address email phone', model: Supplier })
      .populate({ path: 'accountCategoryId', select: 'name code', model: AccountCategory })
      .populate({ path: 'subAccountCategoryId', select: 'name cardNumber cardProvider', model: AccountCategory })
      .populate({ path: 'taxCategoryId', select: 'name rate', model: TaxCategory })
      .populate({ path: 'transactionCategoryId', select: 'name', model: TransactionCategory })
      .populate({ path: 'sourceId', select: 'name type', model: DataSource })
      .lean()
    return transaction
  } catch (error) {
    console.error('Company transaction detail read failed')
    throw error
  }
}

/**
 * Create a new transaction (OMF style)
 */
// Legacy imports remain unassigned until their company provenance is explicitly established.
export async function createTransaction(data: Partial<ITransaction>) {
  return saveTransaction(data)
}

// Only trusted server callers supply this company; never read it from a transaction payload. A trusted server operation (company Navi)
// may also fix the new row's id and its durable marker; both go into this one original insert, never a later side update.
export type TransactionCreateOperation = { id: mongoose.Types.ObjectId, naviOperation: Record<string, unknown> }
export async function createCompanyTransaction(data: Partial<ITransaction>, organizationId: mongoose.Types.ObjectId, operation?: TransactionCreateOperation) {
  return saveTransaction(data, organizationId, operation)
}

async function saveTransaction(data: Partial<ITransaction>, organizationId?: mongoose.Types.ObjectId, operation?: TransactionCreateOperation) {
  await ensureConnection()
  try {
    if (data.cardAccounting !== undefined) throw createError({ statusCode: 400, message: 'Card accounting is assigned through the reviewed import.' })
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

    const { naviOperation: _nativeMarker, ...values } = data as any
    const transaction = new Transaction(values)
    if (organizationId) transaction.set('organizationId', organizationId, { strict: false })
    if (operation?.id) transaction.set('_id', operation.id)
    if (operation?.naviOperation) transaction.set('naviOperation', operation.naviOperation)
    await transaction.save()

    return transaction.toObject()
  } catch (error) {
    if (organizationId) console.error('Company transaction creation failed')
    else console.error('Failed to create transaction:', error)
    throw error
  }
}

/**
 * Update a transaction
 */
export const transactionReferenceModels: Record<string, any> = { customerId: Customer, supplierId: Supplier, accountCategoryId: AccountCategory, subAccountCategoryId: AccountCategory, taxCategoryId: TaxCategory, transactionCategoryId: TransactionCategory, sourceId: DataSource }
export const transactionUpdateFields = ['referenceNumber','date','amount','type','status',...Object.keys(transactionReferenceModels),'taxRate','companyInfo','invoiceNumber','receiptNumber','trackingNumber','paymentMethod','cardNumber','productName','productPrice','janCode','hasReceipt','items','notes','tags']
export type TransactionOperation = { operationId: string, payloadHash: string, expectedUpdatedAt: string }
export async function updateTransaction(id: string, data: Partial<ITransaction>, organizationId: mongoose.Types.ObjectId, operation?: TransactionOperation) {
  await ensureConnection()
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw createError({ statusCode: 400, statusMessage: 'Invalid transaction fields' })
  if (Object.keys(data).some(k => k.startsWith('$') || k.includes('.')) || data.cardAccounting !== undefined) throw createError({ statusCode: 400, message: 'Card accounting cannot be replaced by a transaction edit.' })
  const scope: any = { _id: id, organizationId }
  const current: any = await Transaction.findOne(scope).lean()
  if (!current) throw createError({ statusCode: 404, statusMessage: 'Transaction not found' })
  const updateData: any = Object.fromEntries(transactionUpdateFields.filter(k => (data as any)[k] !== undefined).map(k => [k, (data as any)[k]]))
  if (current.cardAccounting) for (const key of ['amount', 'type', 'paymentMethod', 'cardNumber']) if (updateData[key] !== undefined && updateData[key] !== current[key]) throw createError({ statusCode: 409, message: 'Imported card source values cannot be changed.' })
  for (const [key, model] of Object.entries(transactionReferenceModels)) if (updateData[key] !== undefined) {
    if (updateData[key] === '' || updateData[key] === null) updateData[key] = null
    else if (!mongoose.isValidObjectId(updateData[key]) || !await model.exists({ _id: updateData[key] })) throw createError({ statusCode: 400, statusMessage: 'Choose an existing transaction reference' })
  }
  if (updateData.taxRate !== undefined && (!Number.isFinite(Number(updateData.taxRate)) || Number(updateData.taxRate) < 0 || Number(updateData.taxRate) > 100)) throw createError({ statusCode: 400, statusMessage: 'Invalid transaction tax rate' })
  const expected = operation ? operation.expectedUpdatedAt : current.updatedAt?.toISOString() || ''
  if (expected && (!Number.isFinite(Date.parse(expected)) || new Date(expected).toISOString() !== expected)) throw createError({ statusCode: 400, statusMessage: 'Read the current transaction before editing' })
  scope.updatedAt = expected ? new Date(expected) : null
  if (operation) updateData.naviOperation = { operationId: operation.operationId, payloadHash: operation.payloadHash, appliedAt: new Date(), requestedFields: Object.keys(updateData), values: { ...updateData } }
  const updateTimeline = { type: 'updated', title: '取引更新', timestamp: new Date(), description: '取引詳細が更新されました' }
  try {
    const transaction = await Transaction.findOneAndUpdate(scope, { $set: updateData, $push: { timeline: { $each: [updateTimeline], $position: 0 } } }, { new: true, runValidators: true }).lean()
    if (!transaction) throw createError({ statusCode: 409, statusMessage: 'Transaction changed; read it again' })
    return transaction
  } catch (error: any) {
    if (error?.name === 'ValidationError' || error?.name === 'CastError') throw createError({ statusCode: 400, statusMessage: 'Invalid transaction fields' })
    throw error
  }
}

/** Delete only the selected company record; no guessed legacy assignment. A trusted operation also requires its read snapshot. */
export type TransactionDeleteOperation = { expectedUpdatedAt: string }
export async function deleteTransaction(id: string, organizationId: mongoose.Types.ObjectId, operation?: TransactionDeleteOperation) {
  await ensureConnection()
  const removal: any = { _id: id, organizationId }
  if (operation) removal.updatedAt = new Date(operation.expectedUpdatedAt)
  const transaction = await Transaction.findOneAndDelete(removal).lean()
  if (!transaction) {
    if (operation && await Transaction.exists({ _id: id, organizationId })) throw createError({ statusCode: 409, statusMessage: 'Transaction changed; read it again' })
    throw createError({ statusCode: 404, statusMessage: 'Transaction not found' })
  }
  return transaction
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
export async function getTransactionStats(organizationId: mongoose.Types.ObjectId) {
  await ensureConnection()
  try {
    const totalCount = await Transaction.countDocuments({ organizationId })
    const totalAmount = await Transaction.aggregate([
      { $match: { organizationId } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ])

    // Stats by status
    const statusStats = await Transaction.aggregate([
      { $match: { organizationId } },
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
      { $match: { organizationId } },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          amount: { $sum: '$amount' }
        }
      }
    ])

    // Receipt stats
    const withReceipt = await Transaction.countDocuments({ organizationId, hasReceipt: true })

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
    console.error('Company transaction statistics read failed')
    throw error
  }
}
