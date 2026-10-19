import type mongoose from 'mongoose'
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
