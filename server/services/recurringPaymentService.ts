// server/services/recurringPaymentService.ts
import RecurringPayment from '../models/RecurringPayment'
import Transaction from '../models/Transaction'
import type { IRecurringPayment } from '../models/RecurringPayment'
import { ensureConnection } from '../config/database'

interface RecurringPaymentFilters {
  status?: string
  frequency?: string
  search?: string
}

/**
 * Get all recurring payments with optional filtering
 */
export async function getRecurringPayments(filters: RecurringPaymentFilters = {}) {
  await ensureConnection()
  try {
    const query: any = {}

    if (filters.status) {
      query.status = filters.status
    }

    if (filters.frequency) {
      query.frequency = filters.frequency
    }

    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: 'i' } },
        { 'customer.name': { $regex: filters.search, $options: 'i' } },
        { description: { $regex: filters.search, $options: 'i' } }
      ]
    }

    const payments = await RecurringPayment.find(query)
      .sort({ nextDueDate: 1 })
      .lean()

    return payments
  } catch (error) {
    console.error('Failed to get recurring payments:', error)
    throw error
  }
}

/**
 * Get a recurring payment by ID
 */
export async function getRecurringPaymentById(id: string) {
  await ensureConnection()
  try {
    const payment = await RecurringPayment.findById(id).lean()
    return payment
  } catch (error) {
    console.error(`Failed to get recurring payment ${id}:`, error)
    throw error
  }
}

/**
 * Create a new recurring payment
 */
export async function createRecurringPayment(data: Partial<IRecurringPayment>) {
  await ensureConnection()
  try {
    // Calculate next due date if not provided
    if (!data.nextDueDate && data.startDate) {
      data.nextDueDate = new Date(data.startDate)
    }

    const payment = new RecurringPayment({
      ...data,
      status: 'active'
    })

    await payment.save()
    return payment.toObject()
  } catch (error) {
    console.error('Failed to create recurring payment:', error)
    throw error
  }
}

/**
 * Update a recurring payment
 */
export async function updateRecurringPayment(id: string, data: Partial<IRecurringPayment>) {
  await ensureConnection()
  try {
    const { _id, createdAt, generatedTransactionIds, ...updateData } = data as any

    const payment = await RecurringPayment.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).lean()

    if (!payment) {
      throw new Error(`Recurring payment ${id} not found`)
    }

    return payment
  } catch (error) {
    console.error(`Failed to update recurring payment ${id}:`, error)
    throw error
  }
}

/**
 * Delete a recurring payment
 */
export async function deleteRecurringPayment(id: string) {
  await ensureConnection()
  try {
    const payment = await RecurringPayment.findByIdAndDelete(id).lean()
    if (!payment) {
      throw new Error(`Recurring payment ${id} not found`)
    }
    return payment
  } catch (error) {
    console.error(`Failed to delete recurring payment ${id}:`, error)
    throw error
  }
}

/**
 * Calculate next due date based on frequency
 */
function calculateNextDueDate(currentDate: Date, frequency: string, dayOfMonth?: number, dayOfWeek?: number): Date {
  const next = new Date(currentDate)

  switch (frequency) {
    case 'daily':
      next.setDate(next.getDate() + 1)
      break
    case 'weekly':
      next.setDate(next.getDate() + 7)
      break
    case 'biweekly':
      next.setDate(next.getDate() + 14)
      break
    case 'monthly':
      next.setMonth(next.getMonth() + 1)
      if (dayOfMonth) {
        // Handle months with fewer days
        const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
        next.setDate(Math.min(dayOfMonth, lastDay))
      }
      break
    case 'quarterly':
      next.setMonth(next.getMonth() + 3)
      if (dayOfMonth) {
        const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
        next.setDate(Math.min(dayOfMonth, lastDay))
      }
      break
    case 'yearly':
      next.setFullYear(next.getFullYear() + 1)
      break
  }

  return next
}

/**
 * Generate transaction for a recurring payment
 */
export async function generateTransaction(paymentId: string) {
  await ensureConnection()
  try {
    const payment = await RecurringPayment.findById(paymentId)
    if (!payment) {
      throw new Error(`Recurring payment ${paymentId} not found`)
    }

    if (payment.status !== 'active') {
      throw new Error(`Recurring payment ${paymentId} is not active`)
    }

    // Create the transaction
    const transaction = new Transaction({
      reference: `REC-${payment._id.toString().slice(-6)}-${Date.now()}`,
      date: new Date(),
      status: 'completed',
      source: payment.source || 'manual',
      amount: payment.amount,
      currency: payment.currency,
      customer: payment.customer,
      notes: `Auto-generated from recurring payment: ${payment.name}`,
      tags: [...(payment.tags || []), 'recurring'],
      metadata: {
        recurringPaymentId: payment._id,
        recurringPaymentName: payment.name
      },
      timeline: [{
        type: 'created',
        title: 'Transaction Created',
        timestamp: new Date(),
        description: `Auto-generated from recurring payment "${payment.name}"`
      }]
    })

    await transaction.save()

    // Update recurring payment
    const nextDueDate = calculateNextDueDate(
      payment.nextDueDate,
      payment.frequency,
      payment.dayOfMonth,
      payment.dayOfWeek
    )

    // Check if we've passed the end date
    let newStatus = payment.status
    if (payment.endDate && nextDueDate > payment.endDate) {
      newStatus = 'completed'
    }

    await RecurringPayment.findByIdAndUpdate(paymentId, {
      lastGeneratedDate: new Date(),
      nextDueDate,
      status: newStatus,
      $push: { generatedTransactionIds: transaction._id }
    })

    return {
      transaction: transaction.toObject(),
      nextDueDate,
      status: newStatus
    }
  } catch (error) {
    console.error(`Failed to generate transaction for recurring payment ${paymentId}:`, error)
    throw error
  }
}

/**
 * Process all due recurring payments
 * This would typically be called by a cron job or scheduled task
 */
export async function processDuePayments() {
  await ensureConnection()
  try {
    const now = new Date()

    // Find all active payments that are due
    const duePayments = await RecurringPayment.find({
      status: 'active',
      autoGenerate: true,
      nextDueDate: { $lte: now }
    })

    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      transactions: [] as any[]
    }

    for (const payment of duePayments) {
      results.processed++
      try {
        const result = await generateTransaction(payment._id.toString())
        results.succeeded++
        results.transactions.push({
          paymentId: payment._id,
          paymentName: payment.name,
          transactionId: result.transaction.id || result.transaction._id
        })
      } catch (error) {
        console.error(`Failed to process recurring payment ${payment._id}:`, error)
        results.failed++
      }
    }

    return results
  } catch (error) {
    console.error('Failed to process due payments:', error)
    throw error
  }
}

/**
 * Get upcoming payments summary
 */
export async function getUpcomingPayments(days: number = 30) {
  await ensureConnection()
  try {
    const endDate = new Date()
    endDate.setDate(endDate.getDate() + days)

    const upcoming = await RecurringPayment.find({
      status: 'active',
      nextDueDate: { $lte: endDate }
    })
      .sort({ nextDueDate: 1 })
      .lean()

    const totalAmount = upcoming.reduce((sum, p) => sum + p.amount, 0)

    return {
      payments: upcoming,
      count: upcoming.length,
      totalAmount,
      currency: 'JPY'
    }
  } catch (error) {
    console.error('Failed to get upcoming payments:', error)
    throw error
  }
}

/**
 * Get recurring payment statistics
 */
export async function getRecurringPaymentStats() {
  await ensureConnection()
  try {
    const stats = await RecurringPayment.aggregate([
      {
        $facet: {
          byStatus: [
            { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }
          ],
          byFrequency: [
            { $match: { status: 'active' } },
            { $group: { _id: '$frequency', count: { $sum: 1 }, amount: { $sum: '$amount' } } }
          ],
          total: [
            { $group: { _id: null, count: { $sum: 1 }, activeAmount: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, '$amount', 0] } } } }
          ]
        }
      }
    ])

    const byStatus = stats[0].byStatus.reduce((acc: any, s: any) => {
      acc[s._id] = { count: s.count, amount: s.amount }
      return acc
    }, {})

    const byFrequency = stats[0].byFrequency.reduce((acc: any, f: any) => {
      acc[f._id] = { count: f.count, amount: f.amount }
      return acc
    }, {})

    const total = stats[0].total[0] || { count: 0, activeAmount: 0 }

    // Calculate estimated monthly spend from active payments
    const monthlyEstimate = calculateMonthlyEstimate(stats[0].byFrequency)

    return {
      total: total.count,
      active: byStatus.active?.count || 0,
      paused: byStatus.paused?.count || 0,
      completed: byStatus.completed?.count || 0,
      cancelled: byStatus.cancelled?.count || 0,
      activeMonthlyAmount: monthlyEstimate,
      byFrequency
    }
  } catch (error) {
    console.error('Failed to get recurring payment stats:', error)
    throw error
  }
}

/**
 * Calculate estimated monthly amount from frequency data
 */
function calculateMonthlyEstimate(frequencyData: any[]): number {
  let monthly = 0

  for (const f of frequencyData) {
    const amount = f.amount || 0
    switch (f._id) {
      case 'daily':
        monthly += amount * 30
        break
      case 'weekly':
        monthly += amount * 4.33
        break
      case 'biweekly':
        monthly += amount * 2.17
        break
      case 'monthly':
        monthly += amount
        break
      case 'quarterly':
        monthly += amount / 3
        break
      case 'yearly':
        monthly += amount / 12
        break
    }
  }

  return Math.round(monthly)
}
