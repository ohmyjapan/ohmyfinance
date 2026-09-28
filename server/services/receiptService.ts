// server/services/receiptService.ts
import Receipt from '../models/Receipt'
import { createError } from 'h3'
import type { LedgerAccess } from './ledgerAccessService'
import Transaction from '../models/Transaction'
import type { IReceipt } from '../models/Receipt'
import type { ITransaction } from '../models/Transaction'
import type { Types } from 'mongoose'
import { ensureConnection } from '../config/database'
import { calculateMatchConfidence, receiptCandidateWindow, transactionCurrency } from '../utils/receiptMatching'

interface ReceiptFilters {
  status?: string
  dateFrom?: string
  dateTo?: string
  minAmount?: number
  maxAmount?: number
  merchant?: string
  transactionId?: string
  search?: string
}

/**
 * Get all receipts with optional filtering
 */
export async function getReceipts(filters: ReceiptFilters = {}) {
  await ensureConnection()
  try {
    const query: any = {}

    if (filters.status) {
      query.status = filters.status
    }

    if (filters.transactionId) {
      query.transactionId = filters.transactionId
    }

    if (filters.merchant) {
      query.merchant = { $regex: filters.merchant, $options: 'i' }
    }

    if (filters.dateFrom || filters.dateTo) {
      query.uploadDate = {}
      if (filters.dateFrom) {
        query.uploadDate.$gte = new Date(filters.dateFrom)
      }
      if (filters.dateTo) {
        query.uploadDate.$lte = new Date(filters.dateTo)
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

    if (filters.search) {
      query.$or = [
        { filename: { $regex: filters.search, $options: 'i' } },
        { originalFilename: { $regex: filters.search, $options: 'i' } },
        { merchant: { $regex: filters.search, $options: 'i' } },
        { notes: { $regex: filters.search, $options: 'i' } }
      ]
    }

    const receipts = await Receipt.find(query)
      .sort({ uploadDate: -1 })
      .lean()

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
  await ensureConnection()
  try {
    const receipt = await Receipt.findById(id).lean()
    return receipt
  } catch (error) {
    console.error(`Failed to get receipt ${id}:`, error)
    throw error
  }
}

/**
 * Create a new receipt from an uploaded file
 */
export async function createReceipt(fileData: Partial<IReceipt>, metadata: Partial<IReceipt> = {}) {
  await ensureConnection()
  try {
    const receiptData: Partial<IReceipt> = {
      ...fileData,
      ...metadata,
      status: 'unmatched',
      uploadDate: new Date()
    }

    const receipt = new Receipt(receiptData)
    await receipt.save()

    return receipt.toObject()
  } catch (error) {
    console.error('Failed to create receipt:', error)
    throw error
  }
}

/**
 * Update a receipt
 */
export async function updateReceipt(id: string, data: Partial<IReceipt>) {
  await ensureConnection()
  try {
    // Don't allow changing certain fields
    const { _id, createdAt, filename, ...updateData } = data as any

    const receipt = await Receipt.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).lean()

    if (!receipt) {
      throw new Error(`Receipt ${id} not found`)
    }

    return receipt
  } catch (error) {
    console.error(`Failed to update receipt ${id}:`, error)
    throw error
  }
}

/**
 * Delete a receipt
 */
export async function deleteReceipt(id: string) {
  await ensureConnection()
  try {
    const receipt = await Receipt.findById(id)
    if (!receipt) {
      throw new Error(`Receipt ${id} not found`)
    }

    // If receipt is matched to a transaction, update the transaction
    if (receipt.status === 'matched' && receipt.transactionId) {
      await Transaction.findByIdAndUpdate(receipt.transactionId, {
        receipt: null
      })
    }

    await Receipt.findByIdAndDelete(id)

    return receipt.toObject()
  } catch (error) {
    console.error(`Failed to delete receipt ${id}:`, error)
    throw error
  }
}

type CandidateTransaction = Pick<ITransaction, 'date' | 'amount' | 'companyInfo' | 'notes' | 'referenceNumber' | 'metadata' | 'type' | 'status'> & { _id: Types.ObjectId }

/** Rank the entire search window before limiting the display to ten results. */
export async function findMatchesForReceipt(access: LedgerAccess, receiptId: string) {
  await ensureConnection()
  const receipt = await Receipt.findOne({ _id: receiptId, organizationId: access.organizationId }).lean()
  if (!receipt) throw createError({ statusCode: 404, statusMessage: 'Receipt not found' })
  const window = receiptCandidateWindow(receipt)
  if (!Object.keys(window).length) return []

  // Either recorded side of an existing link excludes a candidate. This is a
  // read-time exclusion, not a reservation or a repair of old attachment writes.
  const linkedIds = await Receipt.distinct('transactionId', { organizationId: access.organizationId, transactionId: { $ne: null } })
  const cursor = Transaction.find({
    ...window,
    organizationId: access.organizationId,
    hasReceipt: { $ne: true },
    receiptFilePath: { $in: [null, ''] },
    _id: { $nin: linkedIds }
  }).select('_id date amount companyInfo notes referenceNumber metadata type status')
    .lean<CandidateTransaction[]>().cursor()

  type Candidate = {
    transactionId: string; date: Date; amount: number; currency?: string;
    description?: string; reference?: string; confidence: number;
    matchFactors: string[]; autoMatchEligible: boolean; matchReason: string;
  }
  const matches: Candidate[] = []
  try {
    for await (const transaction of cursor) {
      const { confidence, factors, autoMatchEligible } = calculateMatchConfidence(receipt, transaction)
      matches.push({
        transactionId: transaction._id.toString(), date: transaction.date, amount: transaction.amount,
        currency: transactionCurrency(transaction), description: transaction.companyInfo || transaction.notes || transaction.referenceNumber,
        reference: transaction.referenceNumber, confidence, matchFactors: factors, autoMatchEligible,
        matchReason: autoMatchEligible ? 'Strong recorded evidence; rule score' : 'Review the supporting evidence; rule score'
      })
      matches.sort((a, b) => b.confidence - a.confidence || a.transactionId.localeCompare(b.transactionId))
      if (matches.length > 10) matches.pop()
    }
  } finally { await cursor.close() }
  return matches
}

/**
 * Auto-match unmatched receipts with high-confidence transactions
 */
export async function autoMatchReceipts(access: LedgerAccess, minConfidence: number = 85) {
  await ensureConnection()
  try {
    // Find all unmatched receipts
    const unmatchedReceipts = await Receipt.find({ status: 'unmatched', organizationId: access.organizationId }).lean()

    const results = {
      processed: 0,
      matched: 0,
      skipped: 0,
      matches: [] as { receiptId: string; transactionId: string; confidence: number }[]
    }

    for (const receipt of unmatchedReceipts) {
      results.processed++

      try {
        const matches = await findMatchesForReceipt(access, receipt._id.toString())

        // Only auto-match if there's exactly one high-confidence match
        const highConfidenceMatches = matches.filter(m => m.confidence >= minConfidence)

        if (highConfidenceMatches.length === 1 && highConfidenceMatches[0].autoMatchEligible) {
          const match = highConfidenceMatches[0]
          await matchReceiptWithTransaction(access, receipt._id.toString(), match.transactionId)
          results.matched++
          results.matches.push({
            receiptId: receipt._id.toString(),
            transactionId: match.transactionId,
            confidence: match.confidence
          })
        } else {
          results.skipped++
        }
      } catch (error) {
        console.error(`Error auto-matching receipt ${receipt._id}:`, error)
        results.skipped++
      }
    }

    return results
  } catch (error) {
    console.error('Failed to auto-match receipts:', error)
    throw error
  }
}

/**
 * Match a receipt with a transaction
 */
export async function matchReceiptWithTransaction(access: LedgerAccess, receiptId: string, transactionId: string) {
  await ensureConnection()
  try {
    const receipt = await Receipt.findOne({ _id: receiptId, organizationId: access.organizationId })
    if (!receipt) {
      throw createError({ statusCode: 404, statusMessage: 'Receipt not found' })
    }

    const transaction = await Transaction.findOne({ _id: transactionId, organizationId: access.organizationId })
    if (!transaction) {
      throw createError({ statusCode: 404, statusMessage: 'Transaction not found' })
    }

    // Update receipt
    receipt.status = 'matched'
    receipt.transactionId = transaction._id
    await receipt.save()

    // Update transaction with receipt data
    await Transaction.findOneAndUpdate({ _id: transactionId, organizationId: access.organizationId }, {
      receipt: {
        receiptId: receipt._id,
        filename: receipt.originalFilename || receipt.filename,
        size: receipt.size,
        date: receipt.receiptDate,
        amount: receipt.amount,
        merchant: receipt.merchant,
        url: receipt.fileUrl
      },
      $push: {
        timeline: {
          $each: [{
            type: 'receipt_matched',
            title: 'Receipt Matched',
            timestamp: new Date(),
            description: `Receipt ${receipt.originalFilename || receipt.filename} matched to transaction`
          }],
          $position: 0
        }
      }
    })

    return {
      receipt: receipt.toObject(),
      transaction: await Transaction.findOne({ _id: transactionId, organizationId: access.organizationId }).lean()
    }
  } catch (error) {
    console.error(`Failed to match receipt ${receiptId} with transaction ${transactionId}:`, error)
    throw error
  }
}

/**
 * Unmatch a receipt from a transaction
 */
export async function unmatchReceipt(access: LedgerAccess, receiptId: string) {
  await ensureConnection()
  try {
    const receipt = await Receipt.findOne({ _id: receiptId, organizationId: access.organizationId })
    if (!receipt) {
      throw createError({ statusCode: 404, statusMessage: 'Receipt not found' })
    }

    if (receipt.status !== 'matched' || !receipt.transactionId) {
      throw new Error(`Receipt ${receiptId} is not matched to a transaction`)
    }

    const transactionId = receipt.transactionId
    if (!await Transaction.exists({ _id: transactionId, organizationId: access.organizationId })) {
      throw createError({ statusCode: 404, statusMessage: 'Transaction not found' })
    }

    // Update receipt
    receipt.status = 'unmatched'
    receipt.transactionId = undefined
    await receipt.save()

    // Update transaction
    await Transaction.findOneAndUpdate({ _id: transactionId, organizationId: access.organizationId }, {
      receipt: null,
      $push: {
        timeline: {
          $each: [{
            type: 'receipt_unmatched',
            title: 'Receipt Unmatched',
            timestamp: new Date(),
            description: 'Receipt was unmatched from transaction'
          }],
          $position: 0
        }
      }
    })

    return {
      receipt: receipt.toObject(),
      transactionId: transactionId.toString()
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
  await ensureConnection()
  try {
    const stats = await Receipt.aggregate([
      {
        $facet: {
          total: [{ $count: 'count' }],
          byStatus: [
            { $group: { _id: '$status', count: { $sum: 1 } } }
          ]
        }
      }
    ])

    const total = stats[0].total[0]?.count || 0
    const statusCounts = stats[0].byStatus.reduce((acc: any, item: any) => {
      acc[item._id] = item.count
      return acc
    }, {})

    const matched = statusCounts.matched || 0
    const unmatched = total - matched
    const matchRate = total > 0 ? (matched / total) * 100 : 0

    return {
      total,
      matched,
      unmatched,
      processing: statusCounts.processing || 0,
      error: statusCounts.error || 0,
      matchRate: Math.round(matchRate * 100) / 100
    }
  } catch (error) {
    console.error('Failed to get receipt stats:', error)
    throw error
  }
}
