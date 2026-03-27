// server/api/tags/index.ts
import { defineEventHandler, getQuery, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Transaction from '../../models/Transaction'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  await ensureConnection()

  if (event.method === 'GET') {
    // Get all unique tags with counts
    const result = await Transaction.aggregate([
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $project: { tag: '$_id', count: 1, _id: 0 } }
    ])

    return {
      tags: result,
      total: result.length
    }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
