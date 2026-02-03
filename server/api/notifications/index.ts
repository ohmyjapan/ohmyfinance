// server/api/notifications/index.ts
import { defineEventHandler, getQuery, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import RecurringPayment from '../../models/RecurringPayment'
import Receipt from '../../models/Receipt'

/**
 * GET /api/notifications
 * Get pending notifications for the user
 */
export default defineEventHandler(async (event) => {
  try {
    await ensureConnection()

    const query = getQuery(event)
    const days = parseInt(String(query.days || '7'))

    const notifications: any[] = []
    const now = new Date()
    const futureDate = new Date(now)
    futureDate.setDate(futureDate.getDate() + days)

    // Check for upcoming recurring payments
    const upcomingPayments = await RecurringPayment.find({
      status: 'active',
      nextDueDate: { $gte: now, $lte: futureDate }
    })
      .sort({ nextDueDate: 1 })
      .lean()

    for (const payment of upcomingPayments) {
      const daysUntilDue = Math.ceil(
        (new Date(payment.nextDueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      )

      notifications.push({
        id: `payment-${payment._id}`,
        type: 'payment_reminder',
        priority: daysUntilDue <= 1 ? 'high' : daysUntilDue <= 3 ? 'medium' : 'low',
        title: 'Upcoming Payment',
        message: `${payment.name} is due ${daysUntilDue === 0 ? 'today' : daysUntilDue === 1 ? 'tomorrow' : `in ${daysUntilDue} days`}`,
        amount: payment.amount,
        dueDate: payment.nextDueDate,
        relatedId: payment._id,
        relatedType: 'recurring',
        url: '/recurring',
        createdAt: now.toISOString()
      })
    }

    // Check for overdue payments
    const overduePayments = await RecurringPayment.find({
      status: 'active',
      nextDueDate: { $lt: now }
    })
      .sort({ nextDueDate: 1 })
      .lean()

    for (const payment of overduePayments) {
      const daysOverdue = Math.ceil(
        (now.getTime() - new Date(payment.nextDueDate).getTime()) / (1000 * 60 * 60 * 24)
      )

      notifications.push({
        id: `overdue-${payment._id}`,
        type: 'payment_overdue',
        priority: 'high',
        title: 'Overdue Payment',
        message: `${payment.name} is ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue`,
        amount: payment.amount,
        dueDate: payment.nextDueDate,
        relatedId: payment._id,
        relatedType: 'recurring',
        url: '/recurring',
        createdAt: now.toISOString()
      })
    }

    // Check for unmatched receipts (older than 7 days)
    const oldUnmatchedDate = new Date(now)
    oldUnmatchedDate.setDate(oldUnmatchedDate.getDate() - 7)

    const unmatchedReceipts = await Receipt.countDocuments({
      status: 'unmatched',
      uploadDate: { $lt: oldUnmatchedDate }
    })

    if (unmatchedReceipts > 0) {
      notifications.push({
        id: 'unmatched-receipts',
        type: 'receipt_reminder',
        priority: 'low',
        title: 'Unmatched Receipts',
        message: `You have ${unmatchedReceipts} receipt${unmatchedReceipts > 1 ? 's' : ''} waiting to be matched`,
        count: unmatchedReceipts,
        url: '/receipts?status=unmatched',
        createdAt: now.toISOString()
      })
    }

    // Sort by priority then date
    const priorityOrder = { high: 0, medium: 1, low: 2 }
    notifications.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority as keyof typeof priorityOrder] - priorityOrder[b.priority as keyof typeof priorityOrder]
      if (priorityDiff !== 0) return priorityDiff
      return new Date(a.dueDate || a.createdAt).getTime() - new Date(b.dueDate || b.createdAt).getTime()
    })

    return {
      success: true,
      notifications,
      count: notifications.length,
      unreadCount: notifications.length // In a real app, track read status
    }
  } catch (error: any) {
    console.error('Notifications error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to fetch notifications'
    })
  }
})
