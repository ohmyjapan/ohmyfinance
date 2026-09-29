import { randomBytes } from 'node:crypto'
import { createError } from 'h3'
import { Payment } from '../models/Payment'
import { ensureConnection } from '../config/database'
import type { LedgerAccess } from './ledgerAccessService'
import { createManualTransaction, reconcileManualTransaction } from './manualTransactionService'

const conflict = (message: string, code = 'PAYMENT_REVIEW_REQUIRED') => createError({ statusCode: 409, statusMessage: message, data: { code } })
const missing = () => createError({ statusCode: 404, statusMessage: 'Payment not found', data: { code: 'PAYMENT_MISSING' } })
const scope = (access: LedgerAccess, id?: string) => ({ organizationId: access.organizationId, deletedAt: null, ...(id ? { _id: id } : {}) })
const fields = ['title', 'amount', 'currency', 'dueDate', 'type', 'status', 'category', 'recurring', 'recurringFrequency', 'bankTransfer', 'notes']
const publicPayment = (row: any) => {
  if (!row) return null
  const { posting, deletedAt, __v, ...visible } = row
  return { ...visible, id: String(row._id), revision: __v ?? 0, completionState: posting?.state || null, transactionId: posting?.transactionId || null }
}
function input(body: Record<string, any>) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400, statusMessage: 'Payment details are required' })
  const data: Record<string, any> = Object.fromEntries(fields.filter(key => body[key] !== undefined).map(key => [key, body[key]]))
  if (data.amount !== undefined) {
    if (!['number', 'string'].includes(typeof data.amount) || String(data.amount).trim() === '' || !Number.isFinite(Number(data.amount)) || Number(data.amount) < 0) throw createError({ statusCode: 400, statusMessage: 'Enter a non-negative payment amount' })
    data.amount = Number(data.amount)
  }
  if (data.dueDate !== undefined) {
    const value = String(data.dueDate), dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
    const date = new Date(dayOnly ? value + 'T12:00:00.000Z' : value)
    if (!Number.isFinite(date.getTime()) || (dayOnly && date.toISOString().slice(0, 10) !== value)) throw createError({ statusCode: 400, statusMessage: 'Enter a valid payment date' })
    data.dueDate = date
  }
  return data
}
const revision = (row: any, value: unknown) => {
  if (!Number.isInteger(value) || value !== (row.__v ?? 0)) throw conflict('Payment changed. Review the saved version before editing or completing it.', 'PAYMENT_CHANGED')
  return row.__v ?? { $exists: false }
}
async function read(access: LedgerAccess, id: string) {
  await ensureConnection()
  const row = await Payment.findOne(scope(access, id)).select('+posting').lean<any>()
  if (!row) throw missing()
  return row
}
export async function listCalendarPayments(access: LedgerAccess, query: Record<string, any> = {}) {
  await ensureConnection()
  const filter: Record<string, any> = scope(access)
  for (const key of ['type', 'status', 'category']) if (typeof query[key] === 'string') filter[key] = query[key]
  if (query.startDate || query.endDate) {
    filter.dueDate = {}
    if (query.startDate) filter.dueDate.$gte = input({ dueDate: query.startDate }).dueDate
    if (query.endDate) filter.dueDate.$lte = input({ dueDate: query.endDate }).dueDate
  }
  return (await Payment.find(filter).select('+posting').sort({ dueDate: 1 }).lean()).map(publicPayment)
}
export async function getCalendarPayment(access: LedgerAccess, id: string) { return publicPayment(await read(access, id)) }
export async function createCalendarPayment(access: LedgerAccess, body: Record<string, any>) {
  await ensureConnection()
  const data = input(body)
  if (new Payment(data).validateSync()) throw createError({ statusCode: 400, statusMessage: 'Enter valid payment details' })
  if (['paid', 'completed'].includes(data.status)) throw conflict('Save the payment first, then use Mark complete to record its transaction.')
  const row = await Payment.create({ ...data, organizationId: access.organizationId, createdBy: access.userId })
  return publicPayment(row.toObject())
}
export async function updateCalendarPayment(access: LedgerAccess, id: string, body: Record<string, any>) {
  const row = await read(access, id), data = input(body), version = revision(row, body.revision)
  if (new Payment({ ...row, ...data }).validateSync()) throw createError({ statusCode: 400, statusMessage: 'Enter valid payment details' })
  if (row.posting?.state === 'pending') throw conflict('Payment completion is pending. Retry Mark complete before editing.', 'PAYMENT_COMPLETION_PENDING')
  if (data.status !== undefined && data.status !== row.status && (row.posting || ['paid', 'completed'].includes(data.status) || ['paid', 'completed'].includes(row.status))) throw conflict('Use Mark complete to record payment. Review the linked transaction before changing a completed payment.')
  const updated = await Payment.findOneAndUpdate({ ...scope(access, id), __v: version, 'posting.state': { $ne: 'pending' } }, { $set: data, $inc: { __v: 1 } }, { new: true, runValidators: true }).select('+posting').lean()
  if (!updated) throw conflict('Payment changed. Review the saved version before editing.', 'PAYMENT_CHANGED')
  return publicPayment(updated)
}
export async function deleteCalendarPayment(access: LedgerAccess, id: string, displayedRevision: unknown) {
  const row = await read(access, id), version = revision(row, displayedRevision)
  if (row.posting?.state === 'pending') throw conflict('Payment completion is pending. Retry Mark complete before deleting.', 'PAYMENT_COMPLETION_PENDING')
  const result = await Payment.updateOne({ ...scope(access, id), __v: version, 'posting.state': { $ne: 'pending' } }, { $set: { deletedAt: new Date() }, $inc: { __v: 1 } }, { writeConcern: { w: 'majority', j: true } })
  if (!result.matchedCount) throw conflict('Payment changed. Review the saved version before deleting.', 'PAYMENT_CHANGED')
  return { success: true }
}
export async function completeCalendarPayment(access: LedgerAccess, id: string, displayedRevision: unknown) {
  let row = await read(access, id)
  if (!row.posting) {
    const version = revision(row, displayedRevision)
    if (['paid', 'completed'].includes(row.status)) throw conflict('This existing payment needs its saved transaction link reviewed; no new transaction was created.', 'PAYMENT_LINK_REVIEW')
    if (row.status === 'cancelled') throw conflict('Reopen this cancelled payment before completing it.', 'PAYMENT_CANCELLED')
    if (row.currency !== 'JPY') throw conflict('Review currency conversion before recording this payment in the JPY ledger.', 'PAYMENT_CURRENCY_REVIEW')
    const posting = { key: randomBytes(16).toString('hex'), state: 'pending', payload: {
      date: new Date(row.dueDate).toISOString(), amount: row.amount, type: row.type === 'income' ? '入金' : '支出', status: 'completed',
      notes: `支払いカレンダーより: ${row.title}`, referenceNumber: `PAY-${id}`
    } }
    const reserved = await Payment.findOneAndUpdate({ ...scope(access, id), __v: version, posting: null }, { $set: { posting }, $inc: { __v: 1 } }, { new: true, writeConcern: { w: 'majority', j: true } }).select('+posting').lean<any>()
    row = reserved || await read(access, id)
    if (!row.posting) throw conflict('Payment changed. Review the saved version before completing it.', 'PAYMENT_CHANGED')
  }
  // The existing retained company/key identity owns both insertion and replay.
  const outcome = row.posting.state === 'pending'
    ? await createManualTransaction(access, row.posting.key, row.posting.payload)
    : await reconcileManualTransaction(access, row.posting.key)
  if (outcome.state !== 'saved') {
    if (outcome.state === 'deleted') await Payment.updateOne({ ...scope(access, id), 'posting.key': row.posting.key }, { $set: { 'posting.state': 'deleted', 'posting.transactionId': outcome.transactionId }, $inc: { __v: 1 } })
    throw outcome.state === 'deleted'
      ? conflict('The linked transaction was deleted. Open Review to remove the calendar entry; its accounting history is retained.', 'PAYMENT_LINK_DELETED')
      : conflict('The linked transaction is unavailable. Review its saved details; no replacement will be created.', 'PAYMENT_LINK_UNAVAILABLE')
  }
  if (row.posting.state === 'pending') {
    await Payment.updateOne({ ...scope(access, id), 'posting.key': row.posting.key, 'posting.state': 'pending' }, { $set: { status: 'paid', 'posting.state': 'posted', 'posting.transactionId': outcome.transactionId }, $inc: { __v: 1 } }, { writeConcern: { w: 'majority', j: true } })
  }
  const saved = await read(access, id)
  if (saved.posting?.state !== 'posted') throw conflict('The transaction is saved. Retry completion to reconcile its payment.', 'PAYMENT_COMPLETION_PENDING')
  return { payment: publicPayment(saved), transaction: outcome.transaction }
}
