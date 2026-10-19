import mongoose from 'mongoose'
import { createError } from 'h3'
import Invoice from '../models/Invoice'
import Transaction from '../models/Transaction'

export const invoiceUpdateFields = ['invoiceNumber','status','issueDate','dueDate','paidDate','from','to','items','taxRate','currency','notes','terms','bankDetails','transactionId']
export type InvoiceOperation = { operationId: string, payloadHash: string, expectedUpdatedAt: string }
const invalid = (message: string): never => { throw createError({ statusCode: 400, statusMessage: message }) }
async function fields(organizationId: mongoose.Types.ObjectId, body: any, previous: any = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Invalid invoice fields')
  const values: any = Object.fromEntries(invoiceUpdateFields.filter(k => body[k] !== undefined).map(k => [k, body[k]]))
  if (values.transactionId === '') values.transactionId = null
  if (values.transactionId != null && (!mongoose.isValidObjectId(values.transactionId) || !await Transaction.exists({ _id: values.transactionId, organizationId }))) throw createError({ statusCode: 404, statusMessage: 'Transaction not found' })
  for (const key of ['issueDate','dueDate','paidDate']) if (values[key] != null) { const date = new Date(values[key]); if (!Number.isFinite(date.getTime())) invalid('Invalid invoice date'); values[key] = date }
  if (body.items !== undefined || body.taxRate !== undefined) {
    const rate = Number(body.taxRate ?? previous.taxRate ?? 10)
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) invalid('Invalid invoice tax rate')
    let items = previous.items || []
    if (body.items !== undefined) {
      if (!Array.isArray(body.items)) invalid('Invalid invoice items')
      items = body.items.map((item: any) => {
        if (!item || typeof item !== 'object') invalid('Invalid invoice item')
        const quantity = Number(item.quantity ?? 1), unitPrice = Number(item.unitPrice), amount = Number(item.amount ?? quantity * unitPrice)
        if (![quantity,unitPrice,amount].every(Number.isFinite)) invalid('Invalid invoice item amount')
        return { description: item.description, quantity, unitPrice, amount, ...(item.tax !== undefined ? { tax: item.tax } : {}) }
      })
      values.items = items
    }
    const subtotal = items.reduce((sum: number, item: any) => sum + Number(item.amount ?? item.quantity * item.unitPrice), 0)
    if (!Number.isFinite(subtotal)) invalid('Invalid invoice subtotal')
    values.subtotal = subtotal; values.taxRate = rate; values.taxAmount = Math.round(subtotal * rate / 100); values.total = subtotal + values.taxAmount
  }
  return values
}
// Native form and frozen company Navi execute this same operation; callers own fresh authorization.
export async function updateCompanyInvoice(organizationId: mongoose.Types.ObjectId, invoiceId: string, body: any, operation?: InvoiceOperation) {
  const scope: any = { _id: invoiceId, organizationId }
  const previous: any = await Invoice.findOne(scope).lean()
  if (!previous) throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  const expected = operation ? operation.expectedUpdatedAt : previous.updatedAt?.toISOString() || ''
  if (expected && (!Number.isFinite(Date.parse(expected)) || new Date(expected).toISOString() !== expected)) invalid('Read the current invoice before editing')
  scope.updatedAt = expected ? new Date(expected) : null
  const values = await fields(organizationId, body, previous)
  if (operation) values.naviOperation = { operationId: operation.operationId, payloadHash: operation.payloadHash, appliedAt: new Date(), requestedFields: Object.keys(values), values: { ...values } }
  const invoice = await Invoice.findOneAndUpdate(scope, { $set: values }, { new: true, runValidators: true }).lean()
  if (!invoice) throw createError({ statusCode: 409, statusMessage: 'Invoice changed; read it again' })
  return invoice
}
// A trusted server operation (company Navi) may fix the new invoice id and its durable marker in this same original insert.
export type InvoiceCreateOperation = { id: mongoose.Types.ObjectId, naviOperation: Record<string, unknown> }
export async function createCompanyInvoice(organizationId: mongoose.Types.ObjectId, actorId: string, body: any, operation?: InvoiceCreateOperation) {
  const values = await fields(organizationId, { ...body, items: body?.items ?? [], taxRate: body?.taxRate ?? 10 })
  const count = await Invoice.countDocuments({ organizationId })
  const invoice = await Invoice.create({ ...values, organizationId, createdBy: actorId, invoiceNumber: values.invoiceNumber || `INV-${new Date().getFullYear()}-${String(count + 1).padStart(5,'0')}`, status: values.status || 'draft', issueDate: values.issueDate || new Date(), dueDate: values.dueDate || new Date(Date.now()+30*24*60*60*1000), currency: values.currency || 'JPY', ...(operation ? { _id: operation.id, naviOperation: operation.naviOperation } : {}) })
  return invoice.toObject()
}
// Native page and company Navi delete through this one operation; a trusted operation also requires its read snapshot.
export async function deleteCompanyInvoice(organizationId: mongoose.Types.ObjectId, invoiceId: string, operation?: { expectedUpdatedAt: string }) {
  if (!mongoose.isValidObjectId(invoiceId)) throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  const target: any = { _id: invoiceId, organizationId }
  if (operation) target.updatedAt = new Date(operation.expectedUpdatedAt)
  const deleted = await Invoice.findOneAndDelete(target).lean()
  if (!deleted) {
    if (operation && await Invoice.exists({ _id: invoiceId, organizationId })) throw createError({ statusCode: 409, statusMessage: 'Invoice changed; read it again' })
    throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  }
  return deleted
}
export function invoiceWriteError(error: any): never {
  if (error?.name === 'ValidationError' || error?.name === 'CastError') invalid('Invalid invoice fields')
  if (error?.code === 11000) throw createError({ statusCode: 409, statusMessage: 'Invoice number already exists in this company' })
  throw error
}
