// server/api/reports/index.ts
import { defineEventHandler, getQuery, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Transaction from '../../models/Transaction'
import Receipt from '../../models/Receipt'
import RecurringPayment from '../../models/RecurringPayment'

/**
 * GET /api/reports
 * Generate financial reports
 */
export default defineEventHandler(async (event) => {
  try {
    await ensureConnection()

    const query = getQuery(event)
    const reportType = String(query.type || 'monthly') // monthly, yearly, custom
    const year = parseInt(String(query.year || new Date().getFullYear()))
    const month = query.month ? parseInt(String(query.month)) : undefined

    let startDate: Date
    let endDate: Date
    let periodLabel: string

    if (reportType === 'yearly') {
      startDate = new Date(year, 0, 1)
      endDate = new Date(year, 11, 31, 23, 59, 59)
      periodLabel = `${year}`
    } else if (reportType === 'monthly' && month !== undefined) {
      startDate = new Date(year, month - 1, 1)
      endDate = new Date(year, month, 0, 23, 59, 59)
      periodLabel = `${year}-${String(month).padStart(2, '0')}`
    } else {
      // Default to current month
      const now = new Date()
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
      periodLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    }

    // Get transaction summary
    const transactionSummary = await Transaction.aggregate([
      { $match: { date: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
          avgAmount: { $avg: '$amount' },
          maxAmount: { $max: '$amount' },
          minAmount: { $min: '$amount' }
        }
      }
    ])

    // Get breakdown by status
    const byStatus = await Transaction.aggregate([
      { $match: { date: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          amount: { $sum: '$amount' }
        }
      },
      { $sort: { amount: -1 } }
    ])

    // Get breakdown by source
    const bySource = await Transaction.aggregate([
      { $match: { date: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: '$source',
          count: { $sum: 1 },
          amount: { $sum: '$amount' }
        }
      },
      { $sort: { amount: -1 } }
    ])

    // Get daily breakdown
    const dailyBreakdown = await Transaction.aggregate([
      { $match: { date: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          count: { $sum: 1 },
          amount: { $sum: '$amount' }
        }
      },
      { $sort: { _id: 1 } }
    ])

    // Get top customers
    const topCustomers = await Transaction.aggregate([
      { $match: { date: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: '$customer.name',
          count: { $sum: 1 },
          amount: { $sum: '$amount' }
        }
      },
      { $sort: { amount: -1 } },
      { $limit: 10 }
    ])

    // Get receipt stats
    const receiptStats = await Receipt.aggregate([
      { $match: { uploadDate: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          amount: { $sum: '$amount' }
        }
      }
    ])

    // Get recurring payments active during period
    const recurringActive = await RecurringPayment.countDocuments({
      status: 'active',
      startDate: { $lte: endDate },
      $or: [
        { endDate: { $exists: false } },
        { endDate: null },
        { endDate: { $gte: startDate } }
      ]
    })

    const recurringMonthlyEstimate = await RecurringPayment.aggregate([
      {
        $match: {
          status: 'active',
          startDate: { $lte: endDate },
          $or: [
            { endDate: { $exists: false } },
            { endDate: null },
            { endDate: { $gte: startDate } }
          ]
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ])

    const summary = transactionSummary[0] || {
      totalAmount: 0,
      count: 0,
      avgAmount: 0,
      maxAmount: 0,
      minAmount: 0
    }

    const receiptsByStatus = receiptStats.reduce((acc: any, r: any) => {
      acc[r._id] = { count: r.count, amount: r.amount }
      return acc
    }, {})

    return {
      success: true,
      period: {
        type: reportType,
        label: periodLabel,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      },
      summary: {
        transactions: {
          total: summary.count,
          totalAmount: summary.totalAmount,
          averageAmount: Math.round(summary.avgAmount || 0),
          maxAmount: summary.maxAmount || 0,
          minAmount: summary.minAmount || 0
        },
        receipts: {
          total: Object.values(receiptsByStatus).reduce((sum: number, r: any) => sum + r.count, 0),
          matched: receiptsByStatus.matched?.count || 0,
          unmatched: receiptsByStatus.unmatched?.count || 0,
          totalAmount: Object.values(receiptsByStatus).reduce((sum: number, r: any) => sum + (r.amount || 0), 0)
        },
        recurring: {
          active: recurringActive,
          monthlyEstimate: recurringMonthlyEstimate[0]?.total || 0
        }
      },
      breakdown: {
        byStatus: byStatus.map((s: any) => ({
          status: s._id || 'unknown',
          count: s.count,
          amount: s.amount,
          percentage: summary.count > 0 ? Math.round((s.count / summary.count) * 100) : 0
        })),
        bySource: bySource.map((s: any) => ({
          source: s._id || 'unknown',
          count: s.count,
          amount: s.amount,
          percentage: summary.count > 0 ? Math.round((s.count / summary.count) * 100) : 0
        })),
        daily: dailyBreakdown.map((d: any) => ({
          date: d._id,
          count: d.count,
          amount: d.amount
        })),
        topCustomers: topCustomers.map((c: any) => ({
          name: c._id || 'Unknown',
          count: c.count,
          amount: c.amount
        }))
      }
    }
  } catch (error: any) {
    console.error('Report error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to generate report'
    })
  }
})
