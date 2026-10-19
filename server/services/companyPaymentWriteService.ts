import mongoose from 'mongoose'
import { createError } from 'h3'
import { Payment } from '../models/Payment'

export const calendarUpdateFields = ['title', 'amount', 'currency', 'dueDate', 'type', 'status', 'category', 'recurring', 'recurringFrequency', 'bankTransfer', 'notes']
const noon = (value: string) => { if (/^\d{4}-\d{2}-\d{2}$/.test(value)) { const [year, month, day] = value.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0)) } return new Date(value) }
export type CalendarOperation = { operationId: string, payloadHash: string, expectedUpdatedAt: string }

// Same operation for the native form and Navi. The authenticated route/frozen job owns authorization.
export async function updateCompanyCalendarEntry(organizationId: mongoose.Types.ObjectId, paymentId: string, body: any, operation?: CalendarOperation) {
  const updateData: Record<string, any> = {}
  for (const key of calendarUpdateFields) if (body[key] !== undefined) updateData[key] = key === 'amount' ? parseFloat(body[key]) : key === 'dueDate' ? noon(body[key]) : body[key]
  const scope: any = { _id: paymentId, organizationId, suppressedAt: { $exists: false } }
  if (operation) {
    const expected = operation.expectedUpdatedAt
    if (expected && (!Number.isFinite(Date.parse(expected)) || new Date(expected).toISOString() !== expected)) throw createError({ statusCode: 400, statusMessage: 'Read the current calendar entry before editing' })
    scope.updatedAt = expected ? new Date(expected) : null
    updateData.naviOperation = { operationId: operation.operationId, payloadHash: operation.payloadHash, appliedAt: new Date(), requestedFields: Object.keys(updateData), values: { ...updateData } }
  }
  const settled = updateData.status === 'paid' || updateData.status === 'completed'
  const payment = await Payment.findOneAndUpdate(scope, { $set: updateData, ...(settled ? { $min: { settledAt: new Date() } } : {}) }, { new: true, runValidators: true })
  if (!payment) {
    if (operation && await Payment.exists({ _id: paymentId, organizationId, suppressedAt: { $exists: false } })) throw createError({ statusCode: 409, statusMessage: 'Calendar entry changed; read it again' })
    throw createError({ statusCode: 404, statusMessage: 'Payment not found' })
  }
  return payment
}

// Native POST and company Navi create through this one operation (same fields, defaults and Mongoose validation as the page).
// A trusted server operation (Navi) may fix the id and its durable marker in this same original insert; a body never can.
export type CalendarCreateOperation = { id: mongoose.Types.ObjectId, naviOperation: Record<string, unknown> }
export async function createCompanyCalendarEntry(organizationId: mongoose.Types.ObjectId, body: any, operation?: CalendarCreateOperation) {
  if (!body || typeof body !== 'object' || !body.title || !body.amount || !body.dueDate || !body.type || !body.category) throw createError({ statusCode: 400, statusMessage: 'Missing required fields: title, amount, dueDate, type, category' })
  const payment = new Payment({
    title: body.title, amount: parseFloat(body.amount), currency: body.currency || 'JPY', dueDate: noon(body.dueDate), type: body.type, status: body.status || 'pending', category: body.category,
    recurring: body.recurring || false, recurringFrequency: body.recurringFrequency, bankTransfer: body.bankTransfer, notes: body.notes, organizationId,
    ...(operation ? { _id: operation.id, naviOperation: operation.naviOperation } : {})
  })
  await payment.save()
  return payment
}

// Native DELETE and company Navi removal. A bill the issuer's statement or notice produced is suppressed, never erased (B3): its
// financial fields stay, it leaves every calendar reader and can never be recreated. A trusted operation also requires its read
// snapshot and records its marker on the suppressed row in the same update, which proves the suppression after a lost reply. A hard
// delete leaves nothing to prove itself; its unknown outcome stays unresolved for the caller.
export type CalendarDeleteOperation = { expectedUpdatedAt: string, naviOperation: Record<string, unknown> }
export async function deleteCompanyCalendarEntry(organizationId: mongoose.Types.ObjectId, paymentId: string, actorId: string, operation?: CalendarDeleteOperation) {
  const target: any = { _id: paymentId, organizationId, suppressedAt: { $exists: false } }
  if (operation) target.updatedAt = new Date(operation.expectedUpdatedAt)
  const current: any = await Payment.findOne(target).lean()
  if (!current) {
    if (operation && await Payment.exists({ _id: paymentId, organizationId, suppressedAt: { $exists: false } })) throw createError({ statusCode: 409, statusMessage: 'Calendar entry changed; read it again' })
    throw createError({ statusCode: 404, statusMessage: 'Payment not found' })
  }
  if (current.source?.kind === 'card-statement') {
    const changed = await Payment.updateOne(target, { $set: { suppressedAt: new Date(), suppressedBy: actorId, ...(operation ? { naviOperation: operation.naviOperation } : {}) } })
    if (!changed.matchedCount) throw createError({ statusCode: 409, statusMessage: 'Calendar entry changed; read it again' })
    return { suppressed: true, payment: current }
  }
  const removed = await Payment.deleteOne(target)
  if (!removed.deletedCount) throw createError({ statusCode: 409, statusMessage: 'Calendar entry changed; read it again' })
  return { suppressed: false, payment: current }
}
