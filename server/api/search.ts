// server/api/search.ts
import { defineEventHandler, getQuery, createError } from 'h3'
import { ensureConnection } from '../config/database'
import Transaction from '../models/Transaction'
import Receipt from '../models/Receipt'
import RecurringPayment from '../models/RecurringPayment'
import { requireAuth } from '../middleware/auth'

/**
 * GET /api/search?q=query
 * Global search across all entities
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  try {
    await ensureConnection()

    const query = getQuery(event)
    const searchTerm = String(query.q || '').trim()
    const limit = Math.min(parseInt(String(query.limit || '10')), 50)
    const type = String(query.type || 'all') // all, transactions, receipts, recurring

    if (!searchTerm || searchTerm.length < 2) {
      return { results: [], total: 0 }
    }

    const searchRegex = { $regex: searchTerm, $options: 'i' }
    const results: any[] = []

    // Search transactions
    if (type === 'all' || type === 'transactions') {
      const transactions = await Transaction.find({
        $or: [
          { reference: searchRegex },
          { 'customer.name': searchRegex },
          { 'customer.email': searchRegex },
          { notes: searchRegex },
          { tags: searchRegex }
        ]
      })
        .sort({ date: -1 })
        .limit(limit)
        .lean()

      transactions.forEach((t: any) => {
        results.push({
          type: 'transaction',
          id: t._id.toString(),
          title: t.reference || `Transaction ${t._id.toString().slice(-6)}`,
          subtitle: t.customer?.name || '',
          amount: t.amount,
          date: t.date || t.createdAt,
          status: t.status,
          url: `/transactions/${t._id}`
        })
      })
    }

    // Search receipts
    if (type === 'all' || type === 'receipts') {
      const receipts = await Receipt.find({
        $or: [
          { filename: searchRegex },
          { originalFilename: searchRegex },
          { merchant: searchRegex },
          { notes: searchRegex }
        ]
      })
        .sort({ uploadDate: -1 })
        .limit(limit)
        .lean()

      receipts.forEach((r: any) => {
        results.push({
          type: 'receipt',
          id: r._id.toString(),
          title: r.originalFilename || r.filename || `Receipt ${r._id.toString().slice(-6)}`,
          subtitle: r.merchant || '',
          amount: r.amount,
          date: r.uploadDate || r.receiptDate,
          status: r.status,
          url: `/receipts?id=${r._id}`
        })
      })
    }

    // Search recurring payments
    if (type === 'all' || type === 'recurring') {
      const recurring = await RecurringPayment.find({
        $or: [
          { name: searchRegex },
          { description: searchRegex },
          { 'customer.name': searchRegex },
          { category: searchRegex },
          { notes: searchRegex }
        ]
      })
        .sort({ nextDueDate: 1 })
        .limit(limit)
        .lean()

      recurring.forEach((p: any) => {
        results.push({
          type: 'recurring',
          id: p._id.toString(),
          title: p.name,
          subtitle: `${p.frequency} - ${p.customer?.name || ''}`,
          amount: p.amount,
          date: p.nextDueDate,
          status: p.status,
          url: `/recurring?id=${p._id}`
        })
      })
    }

    // Sort by date (most recent first)
    results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    // Limit total results
    const limitedResults = results.slice(0, limit)

    return {
      query: searchTerm,
      results: limitedResults,
      total: results.length,
      hasMore: results.length > limit
    }
  } catch (error: any) {
    console.error('Search error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Search failed'
    })
  }
})
