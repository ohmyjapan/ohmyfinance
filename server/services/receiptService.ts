// server/services/receiptService.ts
import mongoose from 'mongoose'
import Receipt from '../models/Receipt'
import Transaction from '../models/Transaction'
import type { ITransaction } from '../models/Transaction'
import type { IReceipt } from '../models/Receipt'
import { ensureConnection } from '../config/database'
import { createError } from 'h3'
import { newReceiptLinkSync, completeAfterWrite, completePendingReceiptSyncs, receiptLinkStep } from './receiptLinkSyncService'

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
export async function getReceipts(filters: ReceiptFilters, organizationId: mongoose.Types.ObjectId) {
  await ensureConnection()
  try {
    const query: any = { organizationId }

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
    console.error('Failed to get company receipts')
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

// Only this entry supplies company-authorized candidates to the native read API.
// A persisted assignment is required; never infer ownership from the purchase details.
export async function findCompanyMatchesForReceipt(receiptId: string, organizationId: mongoose.Types.ObjectId) {
  await ensureConnection()
  const receipt = await Receipt.findOne({ _id: receiptId, organizationId }).lean()
  if (!receipt) return null
  return await receiptMatchCandidates(receipt, { organizationId })
}

async function receiptMatchCandidates(receipt: any, transactionScope: Record<string, unknown>) {
    // Build match query based on receipt data
    const matchQuery: any = {
      ...transactionScope,
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
      // Lean reads may contain old optional fields outside today's strict write schema. Keep their values unknown.
      .lean<Array<ITransaction & { currency?: unknown; customer?: { name?: unknown } | null; reference?: unknown }>>()

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
}

/**
 * Auto-match this company's unmatched receipts with its own high-confidence transactions (exactly one candidate at or above the
 * threshold). Candidates, the link and its badge use the same company-scoped entries as the receipt page and Navi.
 */
export async function autoMatchReceipts(organizationId: mongoose.Types.ObjectId, minConfidence: number = 85) {
  await ensureConnection()
  await completePendingReceiptSyncs(organizationId)
  const unmatchedReceipts = await Receipt.find({ status: 'unmatched', organizationId }).select('_id').lean()
  const results = {
    processed: 0,
    matched: 0,
    skipped: 0,
    matches: [] as { receiptId: string; transactionId: string; confidence: number }[]
  }
  for (const receipt of unmatchedReceipts) {
    results.processed++
    try {
      const matches = await findCompanyMatchesForReceipt(receipt._id.toString(), organizationId) || []
      const highConfidenceMatches = matches.filter(m => m.confidence >= minConfidence)
      if (highConfidenceMatches.length === 1) {
        const match = highConfidenceMatches[0]
        await matchReceiptWithTransaction(receipt._id.toString(), match.transactionId, organizationId)
        results.matched++
        results.matches.push({ receiptId: receipt._id.toString(), transactionId: match.transactionId, confidence: match.confidence })
      } else {
        results.skipped++
      }
    } catch (error: any) {
      console.error('Company receipt auto-match skipped one receipt', error?.statusCode || error?.name || 'Error')
      results.skipped++
    }
  }
  return results
}

// ---- Saved receipt link/unlink: the one company-scoped writer of the receipt page, auto-match and Navi.
// One atomic receipt write saves the canonical link and the badge work it owes (conditioned on everything read, so a concurrent change
// or older owed work is never overwritten); the badge is then completed under the transaction fence (receiptLinkSyncService). Every
// refusal carries a status: 400 identifiers, 404 not in this company, 409 changed/linked elsewhere.
export type ReceiptLinkOperation = { expectedUpdatedAt?: string, naviOperation?: Record<string, any> }
const NAVI_MARKERS = 20
const fail = (statusCode: number, statusMessage: string): never => { throw createError({ statusCode, statusMessage }) }
async function scopedReceipt(receiptId: string, organizationId: mongoose.Types.ObjectId, operation?: ReceiptLinkOperation) {
  if (!mongoose.isValidObjectId(receiptId)) fail(400, 'Invalid receipt identifier')
  const receipt: any = await Receipt.findOne({ _id: receiptId, organizationId }).select('organizationId status transactionId linkSync updatedAt').lean()
  if (!receipt) fail(404, 'Receipt not found')
  if (operation?.expectedUpdatedAt !== undefined && new Date(receipt.updatedAt).toISOString() !== operation.expectedUpdatedAt) fail(409, 'The receipt changed; read it again')
  return receipt
}
// The canonical write is conditioned on the exact state read (status, link, owed-work revision, and the Navi snapshot).
const readState = (receipt: any, operation?: ReceiptLinkOperation) => ({ _id: receipt._id, organizationId: receipt.organizationId, status: receipt.status, transactionId: receipt.transactionId ?? null, 'linkSync.rev': receipt.linkSync?.rev ?? null, ...(operation?.expectedUpdatedAt !== undefined ? { updatedAt: new Date(operation.expectedUpdatedAt) } : {}) })
const marker = (operation: ReceiptLinkOperation | undefined, values: Record<string, unknown>) => operation?.naviOperation ? { naviOperations: { $each: [{ ...operation.naviOperation, ...values }], $slice: -NAVI_MARKERS } } : null
// The transactions of THIS company a write's owed work touches (old owed work included). A legacy pointer to another company's or a
// missing transaction is never written by the completer and never named as an affected record.
async function ownedTransactions(organizationId: mongoose.Types.ObjectId, ids: any[]) {
  const owned: string[] = []
  for (const id of new Set(ids.filter(Boolean).map(String))) if (mongoose.isValidObjectId(id) && await Transaction.exists({ _id: id, organizationId })) owned.push(id)
  return owned
}
const workIds = (linkSync: any) => (linkSync?.work || []).map((w: any) => w.transactionId)
async function writeLink(receipt: any, update: any) {
  const saved = await Receipt.findOneAndUpdate(receipt.filter, update, { new: true }).select('_id').lean()
  if (saved) return
  if (!await Receipt.exists({ _id: receipt.filter._id, organizationId: receipt.filter.organizationId })) fail(404, 'Receipt not found')
  const changed: any = createError({ statusCode: 409, statusMessage: 'The receipt changed; read it again' })
  changed.receiptChanged = true
  throw changed
}
// A page or batch request (no Navi snapshot) that lost a concurrent change decides again from the new state (a truthful already_*
// exit or a refusal); a Navi request keeps its exact snapshot and answers 409.
async function decideAgain<T>(operation: ReceiptLinkOperation | undefined, run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await run() } catch (error: any) { if (!error?.receiptChanged || operation?.expectedUpdatedAt !== undefined || attempt >= 2) throw error }
  }
}

/**
 * Link a receipt of this company to a transaction of this company. Already linked to it: a harmless truthful exit that still
 * re-checks the badge (legacy links). Linked to another transaction: 409.
 */
export async function matchReceiptWithTransaction(receiptId: string, transactionId: string, organizationId: mongoose.Types.ObjectId, operation?: ReceiptLinkOperation) {
  await ensureConnection()
  return decideAgain(operation, () => linkOnce(receiptId, transactionId, organizationId, operation))
}
async function linkOnce(receiptId: string, transactionId: string, organizationId: mongoose.Types.ObjectId, operation?: ReceiptLinkOperation) {
  const receipt = await scopedReceipt(receiptId, organizationId, operation)
  if (!mongoose.isValidObjectId(transactionId)) fail(400, 'Invalid transaction identifier')
  const target = new mongoose.Types.ObjectId(transactionId)
  if (!await Transaction.exists({ _id: target, organizationId })) fail(404, 'Transaction not found')
  const already = receipt.status === 'matched' && String(receipt.transactionId) === String(target)
  if (receipt.transactionId && !already) fail(409, 'The receipt is linked to another transaction')
  const outcome = already ? 'already_linked' : 'linked', ids = { receiptId: String(receipt._id), transactionId: String(target) }
  const linkSync = newReceiptLinkSync(receipt.linkSync, [{ transactionId: target, event: already ? null : 'receipt_matched' }])
  const transactionIds = await ownedTransactions(organizationId, [target, ...workIds(linkSync)])
  const push = marker(operation, { rev: linkSync.rev, outcome, transactionId: String(target), transactionIds })
  await receiptLinkStep('before-truth', ids)
  await writeLink({ filter: readState(receipt, operation) }, { $set: { status: 'matched', transactionId: target, linkSync }, ...(push ? { $push: push } : {}) })
  await receiptLinkStep('after-truth', ids)
  const synchronization = await completeAfterWrite(receipt._id, organizationId, linkSync.rev)
  return { outcome, synchronization, ...ids, transactionIds }
}

/**
 * Unlink a receipt of this company. Not linked: a harmless truthful exit (owed work, if any, is re-armed). The transaction's badge is
 * recomputed from its remaining receipts and its own receipt file.
 */
export async function unmatchReceipt(receiptId: string, organizationId: mongoose.Types.ObjectId, operation?: ReceiptLinkOperation) {
  await ensureConnection()
  return decideAgain(operation, () => unlinkOnce(receiptId, organizationId, operation))
}
async function unlinkOnce(receiptId: string, organizationId: mongoose.Types.ObjectId, operation?: ReceiptLinkOperation) {
  const receipt = await scopedReceipt(receiptId, organizationId, operation)
  const previous = receipt.transactionId || null, ids = { receiptId: String(receipt._id), transactionId: previous ? String(previous) : '' }
  const ownedPrevious = previous && (await ownedTransactions(organizationId, [previous]))[0] || null
  if (!previous) {
    const owed = receipt.linkSync?.pending === true
    if (!owed && !operation?.naviOperation) return { outcome: 'already_unlinked', synchronization: 'synced' as const, receiptId: ids.receiptId, transactionId: null, transactionIds: [] }
    const linkSync = owed ? newReceiptLinkSync(receipt.linkSync, []) : null
    const transactionIds = await ownedTransactions(organizationId, workIds(linkSync))
    const push = marker(operation, { rev: linkSync?.rev || receipt.linkSync?.rev || null, outcome: 'already_unlinked', transactionId: null, transactionIds })
    await writeLink({ filter: readState(receipt, operation) }, { ...(linkSync ? { $set: { linkSync } } : {}), ...(push ? { $push: push } : {}) })
    const synchronization = linkSync ? await completeAfterWrite(receipt._id, organizationId, linkSync.rev) : 'synced' as const
    return { outcome: 'already_unlinked', synchronization, receiptId: ids.receiptId, transactionId: null, transactionIds }
  }
  const linkSync = newReceiptLinkSync(receipt.linkSync, [{ transactionId: previous, event: 'receipt_unmatched' }])
  const transactionIds = await ownedTransactions(organizationId, workIds(linkSync))
  const push = marker(operation, { rev: linkSync.rev, outcome: 'unlinked', transactionId: ownedPrevious, transactionIds })
  await receiptLinkStep('before-truth', ids)
  await writeLink({ filter: readState(receipt, operation) }, { $set: { status: 'unmatched', linkSync }, $unset: { transactionId: '' }, ...(push ? { $push: push } : {}) })
  await receiptLinkStep('after-truth', ids)
  const synchronization = await completeAfterWrite(receipt._id, organizationId, linkSync.rev)
  return { outcome: 'unlinked', synchronization, receiptId: ids.receiptId, transactionId: ownedPrevious, transactionIds }
}

/**
 * Get receipt statistics
 */
export async function getReceiptStats(organizationId: mongoose.Types.ObjectId) {
  await ensureConnection()
  try {
    const stats = await Receipt.aggregate([
      { $match: { organizationId } },
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
    console.error('Failed to get company receipt statistics')
    throw error
  }
}
