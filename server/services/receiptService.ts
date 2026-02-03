// server/services/receiptService.ts
import Receipt from '../models/Receipt'
import Transaction from '../models/Transaction'
import type { IReceipt } from '../models/Receipt'
import { ensureConnection } from '../config/database'

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

/**
 * Calculate text similarity between two strings (Jaccard similarity)
 */
function textSimilarity(str1?: string, str2?: string): number {
  if (!str1 || !str2) return 0

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim().split(/\s+/)
  const words1 = new Set(normalize(str1))
  const words2 = new Set(normalize(str2))

  if (words1.size === 0 || words2.size === 0) return 0

  const intersection = new Set([...words1].filter(x => words2.has(x)))
  const union = new Set([...words1, ...words2])

  return intersection.size / union.size
}

/**
 * Calculate match confidence score between receipt and transaction
 */
function calculateMatchConfidence(receipt: any, transaction: any): { confidence: number; factors: string[] } {
  let confidence = 30 // Base confidence
  const factors: string[] = []

  // Amount matching (max 35 points)
  if (receipt.amount && transaction.amount) {
    const amountDiff = Math.abs(receipt.amount - transaction.amount)
    const percentDiff = amountDiff / receipt.amount

    if (amountDiff === 0) {
      confidence += 35
      factors.push('Exact amount match')
    } else if (percentDiff < 0.01) {
      confidence += 30
      factors.push('Amount within 1%')
    } else if (percentDiff < 0.05) {
      confidence += 20
      factors.push('Amount within 5%')
    } else if (percentDiff < 0.1) {
      confidence += 10
      factors.push('Amount within 10%')
    }
  }

  // Date proximity (max 25 points)
  if (receipt.receiptDate && transaction.date) {
    const daysDiff = Math.abs(
      (new Date(receipt.receiptDate).getTime() - new Date(transaction.date).getTime()) / (1000 * 60 * 60 * 24)
    )

    if (daysDiff === 0) {
      confidence += 25
      factors.push('Same day')
    } else if (daysDiff <= 1) {
      confidence += 20
      factors.push('Within 1 day')
    } else if (daysDiff <= 3) {
      confidence += 15
      factors.push('Within 3 days')
    } else if (daysDiff <= 7) {
      confidence += 10
      factors.push('Within 1 week')
    }
  }

  // Merchant/Customer name matching (max 20 points)
  if (receipt.merchant) {
    const customerSimilarity = textSimilarity(receipt.merchant, transaction.customer?.name)
    const referenceSimilarity = textSimilarity(receipt.merchant, transaction.reference)
    const bestTextMatch = Math.max(customerSimilarity, referenceSimilarity)

    if (bestTextMatch > 0.7) {
      confidence += 20
      factors.push('Strong name match')
    } else if (bestTextMatch > 0.4) {
      confidence += 12
      factors.push('Partial name match')
    } else if (bestTextMatch > 0.2) {
      confidence += 5
      factors.push('Weak name match')
    }
  }

  // Currency matching (max 10 points)
  if (receipt.currency && transaction.currency) {
    if (receipt.currency === transaction.currency) {
      confidence += 10
      factors.push('Same currency')
    }
  } else {
    // No currency mismatch penalty if one is missing
    confidence += 5
  }

  return {
    confidence: Math.min(confidence, 100),
    factors
  }
}

/**
 * Find potential transaction matches for a receipt
 */
export async function findMatchesForReceipt(receiptId: string) {
  await ensureConnection()
  try {
    const receipt = await Receipt.findById(receiptId)
    if (!receipt) {
      throw new Error(`Receipt ${receiptId} not found`)
    }

    // Build match query based on receipt data
    const matchQuery: any = {
      receipt: null // Only match transactions without receipts
    }

    // If we have amount, find transactions within 15% tolerance (wider search)
    if (receipt.amount) {
      const tolerance = receipt.amount * 0.15
      matchQuery.amount = {
        $gte: receipt.amount - tolerance,
        $lte: receipt.amount + tolerance
      }
    }

    // If we have receipt date, find transactions within 14 days (wider search)
    if (receipt.receiptDate) {
      const receiptDate = new Date(receipt.receiptDate)
      const startDate = new Date(receiptDate)
      startDate.setDate(startDate.getDate() - 14)
      const endDate = new Date(receiptDate)
      endDate.setDate(endDate.getDate() + 14)
      matchQuery.date = { $gte: startDate, $lte: endDate }
    }

    const potentialMatches = await Transaction.find(matchQuery)
      .sort({ date: -1 })
      .limit(20)
      .lean()

    // Calculate confidence scores for each match
    const matches = potentialMatches.map(transaction => {
      const { confidence, factors } = calculateMatchConfidence(receipt, transaction)

      return {
        transactionId: transaction._id.toString(),
        date: transaction.date,
        amount: transaction.amount,
        currency: transaction.currency,
        description: transaction.customer?.name || transaction.reference,
        reference: transaction.reference,
        confidence,
        matchFactors: factors,
        matchReason: confidence >= 85 ? 'High confidence match' :
                     confidence >= 70 ? 'Good match' :
                     confidence >= 50 ? 'Possible match' : 'Low confidence'
      }
    })

    // Sort by confidence and return top 10
    return matches
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10)
  } catch (error) {
    console.error(`Failed to find matches for receipt ${receiptId}:`, error)
    throw error
  }
}

/**
 * Auto-match unmatched receipts with high-confidence transactions
 */
export async function autoMatchReceipts(minConfidence: number = 85) {
  await ensureConnection()
  try {
    // Find all unmatched receipts
    const unmatchedReceipts = await Receipt.find({ status: 'unmatched' }).lean()

    const results = {
      processed: 0,
      matched: 0,
      skipped: 0,
      matches: [] as { receiptId: string; transactionId: string; confidence: number }[]
    }

    for (const receipt of unmatchedReceipts) {
      results.processed++

      try {
        const matches = await findMatchesForReceipt(receipt._id.toString())

        // Only auto-match if there's exactly one high-confidence match
        const highConfidenceMatches = matches.filter(m => m.confidence >= minConfidence)

        if (highConfidenceMatches.length === 1) {
          const match = highConfidenceMatches[0]
          await matchReceiptWithTransaction(receipt._id.toString(), match.transactionId)
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
export async function matchReceiptWithTransaction(receiptId: string, transactionId: string) {
  await ensureConnection()
  try {
    const receipt = await Receipt.findById(receiptId)
    if (!receipt) {
      throw new Error(`Receipt ${receiptId} not found`)
    }

    const transaction = await Transaction.findById(transactionId)
    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found`)
    }

    // Update receipt
    receipt.status = 'matched'
    receipt.transactionId = transaction._id
    await receipt.save()

    // Update transaction with receipt data
    await Transaction.findByIdAndUpdate(transactionId, {
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
      transaction: await Transaction.findById(transactionId).lean()
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
  await ensureConnection()
  try {
    const receipt = await Receipt.findById(receiptId)
    if (!receipt) {
      throw new Error(`Receipt ${receiptId} not found`)
    }

    if (receipt.status !== 'matched' || !receipt.transactionId) {
      throw new Error(`Receipt ${receiptId} is not matched to a transaction`)
    }

    const transactionId = receipt.transactionId

    // Update receipt
    receipt.status = 'unmatched'
    receipt.transactionId = undefined
    await receipt.save()

    // Update transaction
    await Transaction.findByIdAndUpdate(transactionId, {
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
