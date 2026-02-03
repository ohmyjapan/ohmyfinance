// server/api/transactions/duplicates.ts
import { defineEventHandler, readBody, getQuery, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Transaction from '../../models/Transaction'

interface DuplicateGroup {
  key: string
  transactions: any[]
  confidence: number
  reason: string
}

export default defineEventHandler(async (event) => {
  await ensureConnection()
  const method = event.method

  if (method === 'GET') {
    const query = getQuery(event)
    const { threshold = '80' } = query
    const confidenceThreshold = parseInt(threshold as string)

    // Get all transactions
    const transactions = await Transaction.find({}).sort({ date: -1 }).lean()

    const duplicateGroups: DuplicateGroup[] = []
    const processed = new Set<string>()

    for (let i = 0; i < transactions.length; i++) {
      const tx1: any = transactions[i]
      if (processed.has(tx1._id.toString())) continue

      const group: any[] = [tx1]

      for (let j = i + 1; j < transactions.length; j++) {
        const tx2: any = transactions[j]
        if (processed.has(tx2._id.toString())) continue

        const { isDuplicate, confidence, reason } = checkDuplicate(tx1, tx2)

        if (isDuplicate && confidence >= confidenceThreshold) {
          group.push(tx2)
          processed.add(tx2._id.toString())
        }
      }

      if (group.length > 1) {
        processed.add(tx1._id.toString())
        const { confidence, reason } = checkDuplicate(group[0], group[1])
        duplicateGroups.push({
          key: `dup-${tx1._id}`,
          transactions: group.map((t: any) => ({
            id: t._id,
            reference: t.reference,
            date: t.date,
            amount: t.amount,
            customer: t.customer?.name,
            status: t.status,
            source: t.source
          })),
          confidence,
          reason
        })
      }
    }

    return {
      groups: duplicateGroups,
      totalDuplicates: duplicateGroups.reduce((sum, g) => sum + g.transactions.length - 1, 0)
    }
  }

  if (method === 'POST') {
    const body = await readBody(event)
    const { action, keepId, deleteIds } = body

    if (action === 'merge') {
      if (!keepId || !deleteIds || !Array.isArray(deleteIds)) {
        throw createError({ statusCode: 400, statusMessage: 'keepId and deleteIds required' })
      }

      // Get the transaction to keep
      const keepTx = await Transaction.findById(keepId)
      if (!keepTx) {
        throw createError({ statusCode: 404, statusMessage: 'Transaction to keep not found' })
      }

      // Merge metadata from duplicates
      const duplicates = await Transaction.find({ _id: { $in: deleteIds } })

      for (const dup of duplicates) {
        // Merge tags
        if (dup.tags) {
          keepTx.tags = [...new Set([...(keepTx.tags || []), ...dup.tags])]
        }

        // Merge notes
        if (dup.notes && dup.notes !== keepTx.notes) {
          keepTx.notes = `${keepTx.notes || ''}\n[Merged] ${dup.notes}`.trim()
        }

        // Keep attachments
        if (dup.attachments && dup.attachments.length > 0) {
          keepTx.attachments = [...(keepTx.attachments || []), ...dup.attachments]
        }
      }

      await keepTx.save()

      // Delete duplicates
      await Transaction.deleteMany({ _id: { $in: deleteIds } })

      return {
        success: true,
        message: `Merged ${deleteIds.length} duplicates into transaction ${keepTx.reference}`,
        kept: keepId,
        deleted: deleteIds.length
      }
    }

    if (action === 'delete') {
      if (!deleteIds || !Array.isArray(deleteIds)) {
        throw createError({ statusCode: 400, statusMessage: 'deleteIds required' })
      }

      await Transaction.deleteMany({ _id: { $in: deleteIds } })

      return {
        success: true,
        message: `Deleted ${deleteIds.length} duplicate transactions`,
        deleted: deleteIds.length
      }
    }

    if (action === 'ignore') {
      // Mark as not duplicates (add to ignore list in metadata)
      const { transactionIds } = body
      if (!transactionIds || !Array.isArray(transactionIds)) {
        throw createError({ statusCode: 400, statusMessage: 'transactionIds required' })
      }

      for (const id of transactionIds) {
        await Transaction.findByIdAndUpdate(id, {
          $addToSet: {
            'metadata.ignoredDuplicates': { $each: transactionIds.filter((tid: string) => tid !== id) }
          }
        })
      }

      return {
        success: true,
        message: 'Transactions marked as not duplicates'
      }
    }

    throw createError({ statusCode: 400, statusMessage: 'Invalid action' })
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})

function checkDuplicate(tx1: any, tx2: any): { isDuplicate: boolean; confidence: number; reason: string } {
  let confidence = 0
  const reasons: string[] = []

  // Check if ignored
  const ignored1 = tx1.metadata?.ignoredDuplicates || []
  const ignored2 = tx2.metadata?.ignoredDuplicates || []
  if (ignored1.includes(tx2._id.toString()) || ignored2.includes(tx1._id.toString())) {
    return { isDuplicate: false, confidence: 0, reason: 'Marked as not duplicate' }
  }

  // Same reference (very high confidence)
  if (tx1.reference === tx2.reference) {
    return { isDuplicate: true, confidence: 100, reason: 'Same reference number' }
  }

  // Same amount
  if (tx1.amount === tx2.amount) {
    confidence += 30
    reasons.push('Same amount')
  }

  // Same date
  const date1 = new Date(tx1.date).toDateString()
  const date2 = new Date(tx2.date).toDateString()
  if (date1 === date2) {
    confidence += 25
    reasons.push('Same date')
  }

  // Dates within 1 day
  const dayDiff = Math.abs(new Date(tx1.date).getTime() - new Date(tx2.date).getTime()) / (1000 * 60 * 60 * 24)
  if (dayDiff <= 1 && dayDiff > 0) {
    confidence += 15
    reasons.push('Within 1 day')
  }

  // Same customer name
  if (tx1.customer?.name && tx2.customer?.name) {
    const name1 = tx1.customer.name.toLowerCase().trim()
    const name2 = tx2.customer.name.toLowerCase().trim()
    if (name1 === name2) {
      confidence += 25
      reasons.push('Same customer')
    } else if (name1.includes(name2) || name2.includes(name1)) {
      confidence += 15
      reasons.push('Similar customer name')
    }
  }

  // Same customer email
  if (tx1.customer?.email && tx2.customer?.email) {
    if (tx1.customer.email.toLowerCase() === tx2.customer.email.toLowerCase()) {
      confidence += 15
      reasons.push('Same email')
    }
  }

  // Same source
  if (tx1.source === tx2.source) {
    confidence += 5
    reasons.push('Same source')
  }

  return {
    isDuplicate: confidence >= 70,
    confidence: Math.min(confidence, 99),
    reason: reasons.join(', ')
  }
}
