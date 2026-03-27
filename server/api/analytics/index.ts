// server/api/analytics/index.ts
import { defineEventHandler, getQuery, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Transaction from '../../models/Transaction'
import Receipt from '../../models/Receipt'
import { requireAuth } from '../../middleware/auth'

interface DateRange {
  start: Date
  end: Date
  previousStart: Date
  previousEnd: Date
}

/**
 * GET /api/analytics
 * Get comprehensive analytics data
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  try {
    await ensureConnection()

    const query = getQuery(event)
    const range = String(query.range || 'last30days')

    // Calculate date ranges
    const dateRange = getDateRange(range, query.dateFrom as string, query.dateTo as string)

    // Fetch all analytics data in parallel
    const [
      keyMetrics,
      transactionsOverTime,
      sourceDistribution,
      statusDistribution,
      trends,
      receiptStats
    ] = await Promise.all([
      getKeyMetrics(dateRange),
      getTransactionsOverTime(dateRange),
      getSourceDistribution(dateRange),
      getStatusDistribution(dateRange),
      getTrends(dateRange),
      getReceiptStats(dateRange)
    ])

    return {
      success: true,
      dateRange: {
        start: dateRange.start.toISOString(),
        end: dateRange.end.toISOString(),
        range
      },
      keyMetrics,
      charts: {
        transactionsOverTime,
        sourceDistribution,
        statusDistribution
      },
      trends,
      receiptStats
    }
  } catch (error: any) {
    console.error('Analytics error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to fetch analytics'
    })
  }
})

/**
 * Calculate date range based on preset or custom dates
 */
function getDateRange(range: string, customFrom?: string, customTo?: string): DateRange {
  const now = new Date()
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)

  let start: Date
  let days: number

  switch (range) {
    case 'last7days':
      days = 7
      start = new Date(now)
      start.setDate(start.getDate() - days)
      break
    case 'last30days':
      days = 30
      start = new Date(now)
      start.setDate(start.getDate() - days)
      break
    case 'last90days':
      days = 90
      start = new Date(now)
      start.setDate(start.getDate() - days)
      break
    case 'lastYear':
      days = 365
      start = new Date(now)
      start.setFullYear(start.getFullYear() - 1)
      break
    case 'custom':
      if (customFrom && customTo) {
        start = new Date(customFrom)
        const customEnd = new Date(customTo)
        customEnd.setHours(23, 59, 59, 999)
        days = Math.ceil((customEnd.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
        return {
          start,
          end: customEnd,
          previousStart: new Date(start.getTime() - days * 24 * 60 * 60 * 1000),
          previousEnd: new Date(start.getTime() - 1)
        }
      }
      // Fall back to 30 days
      days = 30
      start = new Date(now)
      start.setDate(start.getDate() - days)
      break
    default:
      days = 30
      start = new Date(now)
      start.setDate(start.getDate() - days)
  }

  start.setHours(0, 0, 0, 0)

  // Previous period for comparison
  const previousEnd = new Date(start.getTime() - 1)
  const previousStart = new Date(previousEnd)
  previousStart.setDate(previousStart.getDate() - days)
  previousStart.setHours(0, 0, 0, 0)

  return { start, end, previousStart, previousEnd }
}

/**
 * Get key metrics with period comparison
 */
async function getKeyMetrics(dateRange: DateRange) {
  const { start, end, previousStart, previousEnd } = dateRange

  // Current period aggregation
  const currentStats = await Transaction.aggregate([
    { $match: { date: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: '$amount' },
        count: { $sum: 1 },
        avgAmount: { $avg: '$amount' },
        completedCount: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
        },
        completedAmount: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$amount', 0] }
        }
      }
    }
  ])

  // Previous period for comparison
  const previousStats = await Transaction.aggregate([
    { $match: { date: { $gte: previousStart, $lte: previousEnd } } },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: '$amount' },
        count: { $sum: 1 },
        avgAmount: { $avg: '$amount' }
      }
    }
  ])

  // Receipt stats
  const receiptStats = await Receipt.aggregate([
    { $match: { uploadDate: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ])

  const current = currentStats[0] || { totalAmount: 0, count: 0, avgAmount: 0, completedCount: 0, completedAmount: 0 }
  const previous = previousStats[0] || { totalAmount: 0, count: 0, avgAmount: 0 }

  const receiptByStatus = receiptStats.reduce((acc: any, r: any) => {
    acc[r._id] = r.count
    return acc
  }, {})

  // Calculate percentage changes
  const calcChange = (curr: number, prev: number) => {
    if (prev === 0) return curr > 0 ? 100 : 0
    return Math.round(((curr - prev) / prev) * 100 * 10) / 10
  }

  return {
    totalTransactions: {
      value: current.totalAmount,
      count: current.count,
      change: calcChange(current.totalAmount, previous.totalAmount)
    },
    averageOrderValue: {
      value: current.avgAmount || 0,
      change: calcChange(current.avgAmount || 0, previous.avgAmount || 0)
    },
    pendingReceipts: {
      value: receiptByStatus.unmatched || 0,
      change: 0 // Would need historical data for proper comparison
    },
    completedTransactions: {
      value: current.completedAmount,
      count: current.completedCount,
      rate: current.count > 0 ? Math.round((current.completedCount / current.count) * 100) : 0
    }
  }
}

/**
 * Get transactions over time for line chart
 */
async function getTransactionsOverTime(dateRange: DateRange) {
  const { start, end } = dateRange
  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))

  // Choose appropriate grouping based on range
  let groupBy: any
  let dateFormat: string

  if (days <= 7) {
    // Group by day
    groupBy = { $dateToString: { format: '%Y-%m-%d', date: '$date' } }
    dateFormat = 'day'
  } else if (days <= 90) {
    // Group by week
    groupBy = { $dateToString: { format: '%Y-%U', date: '$date' } }
    dateFormat = 'week'
  } else {
    // Group by month
    groupBy = { $dateToString: { format: '%Y-%m', date: '$date' } }
    dateFormat = 'month'
  }

  const data = await Transaction.aggregate([
    { $match: { date: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: groupBy,
        amount: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ])

  return {
    labels: data.map((d: any) => formatDateLabel(d._id, dateFormat)),
    datasets: [
      {
        label: 'Transaction Amount',
        data: data.map((d: any) => d.amount),
        borderColor: '#7c3aed',
        backgroundColor: 'rgba(124, 58, 237, 0.1)',
        tension: 0.4,
        fill: true
      }
    ],
    counts: data.map((d: any) => d.count)
  }
}

/**
 * Get source distribution for pie chart
 */
async function getSourceDistribution(dateRange: DateRange) {
  const { start, end } = dateRange

  const data = await Transaction.aggregate([
    { $match: { date: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: '$source',
        count: { $sum: 1 },
        amount: { $sum: '$amount' }
      }
    },
    { $sort: { amount: -1 } }
  ])

  const sourceLabels: Record<string, string> = {
    credit_card: 'Credit Card',
    payment_gateway: 'Payment Gateway',
    overseas: 'Overseas',
    manual: 'Manual Entry',
    other: 'Other'
  }

  const colors = ['#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#9ca3af']

  return {
    labels: data.map((d: any) => sourceLabels[d._id] || d._id || 'Unknown'),
    datasets: [{
      data: data.map((d: any) => d.count),
      amounts: data.map((d: any) => d.amount),
      backgroundColor: colors.slice(0, data.length),
      borderWidth: 0
    }]
  }
}

/**
 * Get status distribution for pie chart
 */
async function getStatusDistribution(dateRange: DateRange) {
  const { start, end } = dateRange

  const data = await Transaction.aggregate([
    { $match: { date: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        amount: { $sum: '$amount' }
      }
    },
    { $sort: { count: -1 } }
  ])

  const statusColors: Record<string, string> = {
    completed: '#10b981',
    pending: '#f59e0b',
    processing: '#3b82f6',
    failed: '#ef4444',
    refunded: '#8b5cf6',
    cancelled: '#9ca3af'
  }

  return {
    labels: data.map((d: any) => capitalize(d._id || 'Unknown')),
    datasets: [{
      data: data.map((d: any) => d.count),
      amounts: data.map((d: any) => d.amount),
      backgroundColor: data.map((d: any) => statusColors[d._id] || '#9ca3af'),
      borderWidth: 0
    }]
  }
}

/**
 * Get trend data for various metrics
 */
async function getTrends(dateRange: DateRange) {
  const { start, end } = dateRange
  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))

  // Weekly transaction counts (last 7 data points)
  const weeklyData = await Transaction.aggregate([
    { $match: { date: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
        count: { $sum: 1 },
        amount: { $sum: '$amount' }
      }
    },
    { $sort: { _id: -1 } },
    { $limit: 7 }
  ])

  // Failed transaction rate
  const failedRates = await Transaction.aggregate([
    { $match: { date: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
        total: { $sum: 1 },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
      }
    },
    { $sort: { _id: -1 } },
    { $limit: 7 }
  ])

  // Receipt match rate
  const receiptStats = await Receipt.aggregate([
    { $match: { uploadDate: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        matched: { $sum: { $cond: [{ $eq: ['$status', 'matched'] }, 1, 0] } }
      }
    }
  ])

  const weeklyValues = weeklyData.reverse().map((d: any) => d.count)
  const weeklyTotal = weeklyValues.reduce((a, b) => a + b, 0)

  const failedData = failedRates.reverse().map((d: any) =>
    d.total > 0 ? Math.round((d.failed / d.total) * 100 * 10) / 10 : 0
  )
  const currentFailedRate = failedData.length > 0 ? failedData[failedData.length - 1] : 0

  const receiptTotal = receiptStats[0]?.total || 0
  const receiptMatched = receiptStats[0]?.matched || 0
  const matchRate = receiptTotal > 0 ? Math.round((receiptMatched / receiptTotal) * 100 * 10) / 10 : 0

  return [
    {
      name: 'Weekly Transactions',
      period: 'Last 7 days',
      value: weeklyTotal,
      data: weeklyValues.length > 0 ? weeklyValues : [0],
      change: calculateTrendChange(weeklyValues)
    },
    {
      name: 'Failed Transaction Rate',
      period: `Last ${days} days`,
      value: currentFailedRate,
      unit: 'percent',
      data: failedData.length > 0 ? failedData : [0],
      change: -calculateTrendChange(failedData) // Negative is good for failures
    },
    {
      name: 'Receipt Match Rate',
      period: `Last ${days} days`,
      value: matchRate,
      unit: 'percent',
      data: [matchRate],
      change: 0
    }
  ]
}

/**
 * Get receipt-specific statistics
 */
async function getReceiptStats(dateRange: DateRange) {
  const { start, end } = dateRange

  const stats = await Receipt.aggregate([
    { $match: { uploadDate: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' }
      }
    }
  ])

  const byStatus = stats.reduce((acc: any, s: any) => {
    acc[s._id] = { count: s.count, amount: s.totalAmount }
    return acc
  }, {})

  const total = stats.reduce((sum, s: any) => sum + s.count, 0)
  const matched = byStatus.matched?.count || 0

  return {
    total,
    matched,
    unmatched: byStatus.unmatched?.count || 0,
    processing: byStatus.processing?.count || 0,
    error: byStatus.error?.count || 0,
    matchRate: total > 0 ? Math.round((matched / total) * 100 * 10) / 10 : 0,
    totalAmount: stats.reduce((sum, s: any) => sum + s.totalAmount, 0)
  }
}

// Helper functions
function formatDateLabel(dateStr: string, format: string): string {
  if (format === 'day') {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  if (format === 'week') {
    return `Week ${dateStr.split('-')[1]}`
  }
  if (format === 'month') {
    const [year, month] = dateStr.split('-')
    const date = new Date(parseInt(year), parseInt(month) - 1)
    return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  }
  return dateStr
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function calculateTrendChange(data: number[]): number {
  if (data.length < 2) return 0
  const first = data[0]
  const last = data[data.length - 1]
  if (first === 0) return last > 0 ? 100 : 0
  return Math.round(((last - first) / first) * 100 * 10) / 10
}
