import RecurringPayment, { type IRecurringPayment } from '../models/RecurringPayment'
import Transaction, { activeTransactionFilter, type ITransaction } from '../models/Transaction'
import { Types } from 'mongoose'
import { createError } from 'h3'
import { ensureConnection } from '../config/database'
import type { LedgerAccess } from './ledgerAccessService'

interface RecurringPaymentFilters { status?: string; frequency?: string; search?: string }
type PaymentRecord = IRecurringPayment & { __v?: number }
const editable = ['name', 'description', 'amount', 'currency', 'frequency', 'dayOfMonth', 'dayOfWeek', 'startDate', 'endDate', 'nextDueDate', 'status', 'source', 'customer', 'category', 'tags', 'notes', 'autoGenerate', 'metadata'] as const
function fields(data: Partial<IRecurringPayment>) {
  return Object.fromEntries(editable.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]))
}
function scope(access: LedgerAccess, id: string) {
  if (!Types.ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Valid recurring payment ID required' })
  return { _id: id, organizationId: access.organizationId }
}
const publicPayment = (payment: any) => {
  if (!payment) return null
  const { occurrences, ...visible } = payment
  return { ...visible, id: String(payment._id) }
}
const conflict = (message: string) => createError({ statusCode: 409, statusMessage: message })

export async function getRecurringPayments(access: LedgerAccess, filters: RecurringPaymentFilters = {}) {
  await ensureConnection()
  const query: any = { organizationId: access.organizationId }
  if (filters.status) query.status = filters.status
  if (filters.frequency) query.frequency = filters.frequency
  if (filters.search) query.$or = ['name', 'customer.name', 'description'].map(key => ({ [key]: { $regex: filters.search, $options: 'i' } }))
  return (await RecurringPayment.find(query).sort({ nextDueDate: 1 }).lean()).map(publicPayment)
}

export async function getRecurringPaymentById(access: LedgerAccess, id: string) {
  await ensureConnection()
  return publicPayment(await RecurringPayment.findOne(scope(access, id)).lean())
}

export async function createRecurringPayment(access: LedgerAccess, data: Partial<IRecurringPayment>) {
  await ensureConnection()
  const payment = await RecurringPayment.create({
    ...fields(data), organizationId: access.organizationId, status: 'active',
    nextDueDate: data.nextDueDate || data.startDate
  })
  return publicPayment(payment.toObject())
}

export async function updateRecurringPayment(access: LedgerAccess, id: string, data: Partial<IRecurringPayment>) {
  await ensureConnection()
  const query = scope(access, id)
  const payment = await RecurringPayment.findOneAndUpdate(
    { ...query, 'occurrences.state': { $ne: 'reserved' } },
    { $set: fields(data), $inc: { __v: 1 } }, { new: true, runValidators: true }
  ).lean()
  if (payment) return publicPayment(payment)
  if (!await RecurringPayment.exists(query)) throw createError({ statusCode: 404, statusMessage: 'Recurring payment not found' })
  throw conflict('Resume the reserved occurrence before editing this payment')
}

export async function deleteRecurringPayment(access: LedgerAccess, id: string) {
  await ensureConnection()
  const query = scope(access, id)
  const payment = await RecurringPayment.findOneAndDelete({ ...query, 'occurrences.state': { $ne: 'reserved' } }).lean()
  if (payment) return publicPayment(payment)
  if (!await RecurringPayment.exists(query)) throw createError({ statusCode: 404, statusMessage: 'Recurring payment not found' })
  throw conflict('Resume the reserved occurrence before deleting this payment')
}

/** Keep the original calendar day when February or a shorter month intervenes. */
function calculateNextDueDate(payment: any, due: Date): Date {
  const next = new Date(due)
  const days: Record<string, number> = { daily: 1, weekly: 7, biweekly: 14 }
  if (days[payment.frequency]) next.setUTCDate(next.getUTCDate() + days[payment.frequency])
  else {
    const months: Record<string, number> = { monthly: 1, quarterly: 3, yearly: 12 }
    const step = months[payment.frequency]
    if (!step) throw conflict('Recurring frequency requires review')
    const day = payment.dayOfMonth || new Date(payment.startDate).getUTCDate()
    next.setUTCDate(1)
    next.setUTCMonth(next.getUTCMonth() + step)
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()
    next.setUTCDate(Math.min(day, lastDay))
  }
  return next
}

/** The due date is the caller's occurrence identity, including after a lost response. */
export async function generateTransaction(access: LedgerAccess, paymentId: string, expectedDueDate: unknown) {
  await ensureConnection()
  const query = scope(access, paymentId)
  let payment = await RecurringPayment.findOne(query).lean<PaymentRecord>()
  if (!payment) throw createError({ statusCode: 404, statusMessage: 'Recurring payment not found' })
  if (typeof expectedDueDate !== 'string' || !expectedDueDate || !Number.isFinite(Date.parse(expectedDueDate))) {
    throw createError({ statusCode: 400, statusMessage: 'The displayed dueDate is required to identify this occurrence' })
  }
  const due = new Date(expectedDueDate), dueKey = due.toISOString()
  let occurrence = payment.occurrences?.find((item: any) => new Date(item.dueDate).getTime() === due.getTime())
  if (!occurrence) {
    if (payment.status !== 'active' || new Date(payment.nextDueDate).getTime() !== due.getTime()) throw conflict('This occurrence changed; refresh the recurring payment')
    if (payment.currency !== 'JPY') throw conflict('Currency conversion requires review before posting to the JPY ledger')
    if (payment.endDate && due > payment.endDate) throw conflict('This occurrence is after the recurring end date')
    const transactionId = new Types.ObjectId(), nextDueDate = calculateNextDueDate(payment, due)
    const nextStatus = payment.endDate && nextDueDate > payment.endDate ? 'completed' : 'active'
    const reservation = {
      dueDate: due, transactionId, nextDueDate, nextStatus, state: 'reserved',
      transaction: {
        _id: transactionId, organizationId: access.organizationId,
        referenceNumber: `REC-${transactionId}`, date: due, amount: payment.amount,
        type: '支出', status: 'completed', tags: [...(payment.tags || []), 'recurring'],
        notes: `Auto-generated from recurring payment: ${payment.name}${payment.notes ? '\n' + payment.notes : ''}`,
        metadata: {
          recurringPaymentId: paymentId, recurringDueDate: dueKey, recurringPaymentName: payment.name,
          recurringCurrency: payment.currency, recurringCustomer: payment.customer,
          recurringSource: payment.source, recurringCategory: payment.category
        },
        timeline: [{ type: 'created', title: 'Transaction Created', timestamp: new Date(), description: `Recurring payment "${payment.name}"` }]
      }
    }
    // One document owns the snapshot and transaction ID. Edits and other workers
    // compete on this version; no time-based lease releases a partial write.
    const reserved = await RecurringPayment.findOneAndUpdate(
      { ...query, __v: payment.__v ?? { $exists: false }, status: 'active', nextDueDate: due, 'occurrences.dueDate': { $ne: due }, 'occurrences.state': { $ne: 'reserved' } },
      { $push: { occurrences: reservation }, $inc: { __v: 1 } }, { new: true, runValidators: true }
    ).lean<PaymentRecord>()
    payment = reserved || await RecurringPayment.findOne(query).lean<PaymentRecord>()
    occurrence = payment?.occurrences?.find((item: any) => new Date(item.dueDate).getTime() === due.getTime())
    if (!occurrence) throw conflict('Recurring payment changed; refresh before trying again')
  }
  const target = {
    _id: occurrence.transactionId, organizationId: access.organizationId,
    'metadata.recurringPaymentId': paymentId, 'metadata.recurringDueDate': dueKey
  }
  let transaction
  if (occurrence.state === 'posted') {
    transaction = await Transaction.findOne(activeTransactionFilter(target)).lean<ITransaction>()
    if (!transaction) throw conflict('Posted recurring transaction is missing or changed; review its history')
  } else {
    try {
      transaction = await Transaction.findOneAndUpdate(activeTransactionFilter(target), { $setOnInsert: occurrence.transaction }, {
        upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true
      }).lean<ITransaction>()
    } catch (error: any) {
      if (error.code !== 11000) throw error
      // Concurrent insert may have won; an unrelated target ID cannot be adopted.
      transaction = await Transaction.findOne(activeTransactionFilter(target)).lean<ITransaction>()
      if (!transaction) throw conflict('Reserved recurring transaction ID conflicts with an existing record')
    }
    const completed = await RecurringPayment.updateOne(
      { ...query, nextDueDate: due, occurrences: { $elemMatch: { transactionId: occurrence.transactionId, state: 'reserved' } } },
      { $set: { 'occurrences.$.state': 'posted', nextDueDate: occurrence.nextDueDate, status: occurrence.nextStatus, lastGeneratedDate: new Date() },
        $addToSet: { generatedTransactionIds: occurrence.transactionId }, $inc: { __v: 1 } }
    )
    if (!completed.matchedCount && !await RecurringPayment.exists({ ...query, occurrences: { $elemMatch: { transactionId: occurrence.transactionId, state: 'posted' } } })) {
      throw conflict('Ledger entry saved but its recurring checkpoint needs review')
    }
  }
  // A successful upsert with new:true returns the document; both read-only retry
  // branches explicitly reject a missing target above.
  return { transaction: transaction!, nextDueDate: occurrence.nextDueDate, status: occurrence.nextStatus }
}

/** One due occurrence per payment and request; the next catch-up is a new occurrence. */
export async function processDuePayments(access: LedgerAccess) {
  await ensureConnection()
  const duePayments = await RecurringPayment.find({ organizationId: access.organizationId, status: 'active', autoGenerate: true, nextDueDate: { $lte: new Date() } }).lean()
  const results = { processed: 0, succeeded: 0, failed: 0, transactions: [] as any[] }
  for (const payment of duePayments) {
    results.processed++
    try {
      const result = await generateTransaction(access, String(payment._id), payment.nextDueDate.toISOString())
      results.succeeded++
      results.transactions.push({ paymentId: payment._id, paymentName: payment.name, transactionId: result.transaction._id })
    } catch (error) {
      console.error(`Failed to process recurring payment ${payment._id}:`, error)
      results.failed++
    }
  }
  return results
}

export async function getUpcomingPayments(access: LedgerAccess, days = 30) {
  await ensureConnection()
  const endDate = new Date(); endDate.setDate(endDate.getDate() + days)
  const upcoming = await RecurringPayment.find({ organizationId: access.organizationId, status: 'active', nextDueDate: { $lte: endDate } }).sort({ nextDueDate: 1 }).lean()
  return { payments: upcoming.map(publicPayment), count: upcoming.length, totalAmount: upcoming.reduce((sum, p) => sum + p.amount, 0), currency: 'JPY' }
}

export async function getRecurringPaymentStats(access: LedgerAccess) {
  await ensureConnection()
  const [stats] = await RecurringPayment.aggregate([
    { $match: { organizationId: new Types.ObjectId(access.organizationId) } },
    { $facet: {
      byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
      byFrequency: [{ $match: { status: 'active' } }, { $group: { _id: '$frequency', count: { $sum: 1 }, amount: { $sum: '$amount' } } }],
      total: [{ $count: 'count' }]
    } }
  ])
  const byStatus = Object.fromEntries(stats.byStatus.map((s: any) => [s._id, s.count]))
  const byFrequency = Object.fromEntries(stats.byFrequency.map((f: any) => [f._id, { count: f.count, amount: f.amount }]))
  const factor: Record<string, number> = { daily: 30, weekly: 4.33, biweekly: 2.17, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }
  return { total: stats.total[0]?.count || 0, active: byStatus.active || 0, paused: byStatus.paused || 0,
    completed: byStatus.completed || 0, cancelled: byStatus.cancelled || 0, byFrequency,
    activeMonthlyAmount: Math.round(stats.byFrequency.reduce((sum: number, f: any) => sum + f.amount * (factor[f._id] || 0), 0)) }
}
