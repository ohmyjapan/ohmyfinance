// server/services/receiptService.ts
import Receipt from '../models/Receipt'
import Transaction from '../models/Transaction'
import type { IReceipt } from '../models/Receipt'

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
 * Find potential transaction matches for a receipt
 */
export async function findMatchesForReceipt(receiptId: string) {
  try {
    const receipt = await Receipt.findById(receiptId)
    if (!receipt) {
      throw new Error(`Receipt ${receiptId} not found`)
    }

    // Build match query based on receipt data
    const matchQuery: any = {
      receipt: null // Only match transactions without receipts
    }

    // If we have amount, find transactions within 10% tolerance
    if (receipt.amount) {
      const tolerance = receipt.amount * 0.1
      matchQuery.amount = {
        $gte: receipt.amount - tolerance,
        $lte: receipt.amount + tolerance
      }
    }

    // If we have receipt date, find transactions within 7 days
    if (receipt.receiptDate) {
      const receiptDate = new Date(receipt.receiptDate)
      const startDate = new Date(receiptDate)
      startDate.setDate(startDate.getDate() - 7)
      const endDate = new Date(receiptDate)
      endDate.setDate(endDate.getDate() + 7)
      matchQuery.date = { $gte: startDate, $lte: endDate }
    }

    const potentialMatches = await Transaction.find(matchQuery)
      .sort({ date: -1 })
      .limit(10)
      .lean()

    // Calculate confidence scores for each match
    return potentialMatches.map(transaction => {
      let confidence = 50 // Base confidence

      // Exact amount match
      if (receipt.amount && transaction.amount === receipt.amount) {
        confidence += 30
      } else if (receipt.amount && Math.abs(transaction.amount - receipt.amount) < receipt.amount * 0.05) {
        confidence += 20
      }

      // Date proximity
      if (receipt.receiptDate && transaction.date) {
        const daysDiff = Math.abs(
          (new Date(receipt.receiptDate).getTime() - new Date(transaction.date).getTime()) / (1000 * 60 * 60 * 24)
        )
        if (daysDiff === 0) confidence += 20
        else if (daysDiff <= 1) confidence += 15
        else if (daysDiff <= 3) confidence += 10
      }

      return {
        transactionId: transaction._id.toString(),
        date: transaction.date,
        amount: transaction.amount,
        description: transaction.customer?.name || transaction.reference,
        confidence: Math.min(confidence, 100),
        matchReason: confidence >= 80 ? 'High confidence match' : 'Potential match'
      }
    }).sort((a, b) => b.confidence - a.confidence)
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
