// server/api/email/send-reminders.ts
import { defineEventHandler, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import RecurringPayment from '../../models/RecurringPayment'
import { sendPaymentReminder } from '../../services/emailService'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  await ensureConnection()

  // Find payments due in the next 7 days
  const now = new Date()
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  const upcomingPayments = await RecurringPayment.find({
    isActive: true,
    nextDueDate: { $gte: now, $lte: weekFromNow }
  }).lean()

  const results: any[] = []

  for (const payment of upcomingPayments) {
    // Check if already notified (would need to track this)
    const sent = await sendPaymentReminder({
      name: payment.name,
      amount: payment.amount,
      dueDate: payment.nextDueDate,
      recipientEmail: (payment as any).notificationEmail || 'user@example.com'
    })

    results.push({
      payment: payment.name,
      dueDate: payment.nextDueDate,
      sent
    })
  }

  return {
    success: true,
    processed: results.length,
    results
  }
})
