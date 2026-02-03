// server/api/dashboard/stats.ts
import { defineEventHandler, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Transaction from '../../models/Transaction'
import Receipt from '../../models/Receipt'
import { Payment } from '../../models/Payment'
import Organization from '../../models/Organization'
import User from '../../models/User'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async (event) => {
  if (event.method !== 'GET') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  // Try to get auth, but allow unauthenticated access with limited data
  const auth = event.context.auth

  try {
    await ensureConnection()

    // If authenticated, get user and organization data
    let user = null
    let organization = null
    let organizationId = auth?.organizationId

    if (auth?.isAuthenticated && auth?.userId) {
      user = await User.findById(auth.userId).lean()

      if (organizationId) {
        organization = await Organization.findById(organizationId).lean()
      }
    }

    // Build query filter based on organization
    // Note: Currently Transaction and Payment models don't have organizationId
    // So we fetch all data. When multi-tenancy is added, filter by organizationId
    const transactionFilter: Record<string, any> = {}
    const receiptFilter: Record<string, any> = {}
    const paymentFilter: Record<string, any> = {}

    // If organization exists and Receipt has organizationId, filter by it
    if (organizationId) {
      receiptFilter.organizationId = organizationId
    }

    // Get transaction stats
    const [
      totalTransactions,
      recentTransactions,
      transactionStats,
      receiptCount,
      upcomingPaymentsCount,
      recentActivity
    ] = await Promise.all([
      // Total transaction count
      Transaction.countDocuments(transactionFilter),

      // Recent 5 transactions
      Transaction.find(transactionFilter)
        .populate('accountCategoryId', 'name')
        .populate('supplierId', 'name')
        .sort({ date: -1, createdAt: -1 })
        .limit(5)
        .lean(),

      // Transaction stats by type
      Transaction.aggregate([
        { $match: transactionFilter },
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 },
            amount: { $sum: '$amount' }
          }
        }
      ]),

      // Receipt count
      Receipt.countDocuments(receiptFilter),

      // Upcoming payments (pending payments with future due date)
      Payment.countDocuments({
        ...paymentFilter,
        status: { $in: ['pending', 'overdue'] },
        dueDate: { $gte: new Date() }
      }),

      // Recent activity - last 7 days transactions
      Transaction.countDocuments({
        ...transactionFilter,
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      })
    ])

    // Parse transaction stats
    const typeStats = transactionStats.reduce((acc: any, item: any) => {
      acc[item._id] = { count: item.count, amount: item.amount }
      return acc
    }, {})

    // Calculate totals
    const totalAmount = transactionStats.reduce((sum: number, item: any) => sum + (item.amount || 0), 0)
    const expenseStats = typeStats['支出'] || { count: 0, amount: 0 }
    const incomeStats = typeStats['入金'] || { count: 0, amount: 0 }

    // Get receipt match rate
    const transactionsWithReceipt = await Transaction.countDocuments({
      ...transactionFilter,
      hasReceipt: true
    })
    const receiptMatchRate = totalTransactions > 0 ? transactionsWithReceipt / totalTransactions : 0

    return {
      success: true,
      user: user ? {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar
      } : null,
      organization: organization ? {
        id: organization._id,
        name: organization.name,
        type: organization.type,
        slug: organization.slug
      } : null,
      hasOrganization: !!organization,
      stats: {
        total: {
          count: totalTransactions,
          amount: totalAmount
        },
        expense: expenseStats,
        income: incomeStats,
        receiptMatchRate,
        receiptsCount: receiptCount,
        upcomingPaymentsCount,
        recentActivityCount: recentActivity
      },
      recentTransactions: recentTransactions.map((tx: any) => ({
        _id: tx._id,
        id: tx._id.toString(),
        date: tx.date,
        amount: tx.amount,
        type: tx.type,
        status: tx.status,
        accountCategoryId: tx.accountCategoryId,
        supplierId: tx.supplierId,
        productName: tx.productName,
        referenceNumber: tx.referenceNumber,
        hasReceipt: tx.hasReceipt
      }))
    }
  } catch (error: any) {
    console.error('Failed to get dashboard stats:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error.message
    })
  }
})
