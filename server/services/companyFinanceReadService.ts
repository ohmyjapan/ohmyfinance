import type mongoose from 'mongoose'
import { createError } from 'h3'
import Invoice from '../models/Invoice'
import { Payment } from '../models/Payment'
// Native GET queries, shared with company Navi. Authorization belongs to the authenticated route/frozen job.
export async function listCompanyInvoices(organizationId: mongoose.Types.ObjectId, query: any = {}) {
  const { status, page = '1', limit = '20' } = query
  const filter: any = { organizationId }
  if (status) filter.status = status
  const pageNumber = parseInt(page as string), pageSize = parseInt(limit as string)
  const [invoices, total] = await Promise.all([
    Invoice.find(filter).sort({ createdAt: -1 }).skip((pageNumber - 1) * pageSize).limit(pageSize).lean(),
    Invoice.countDocuments(filter)
  ])
  return { invoices: invoices.map((inv: any) => ({ ...inv, id: inv._id })), pagination: { page: pageNumber, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) } }
}
export async function getCompanyInvoice(organizationId: mongoose.Types.ObjectId, invoiceId: string) {
  const invoice = await Invoice.findOne({ _id: invoiceId, organizationId }).lean()
  if (!invoice) throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  return { invoice: { ...invoice, id: invoice._id } }
}
const noon = (dateString: string): Date => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [year, month, day] = dateString.split('-').map(Number)
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0))
  }
  return new Date(dateString)
}
export async function listCompanyCalendarEntries(organizationId: mongoose.Types.ObjectId, query: any = {}, maxRows?: number) {
  const filter: any = { suppressedAt: { $exists: false } }
  filter.organizationId = organizationId // guard:company-filter
  if (query.type) filter.type = query.type
  if (query.status) filter.status = query.status
  if (query.category) filter.category = query.category
  if (query.startDate || query.endDate) {
    filter.dueDate = {}
    if (query.startDate) filter.dueDate.$gte = noon(query.startDate as string)
    if (query.endDate) filter.dueDate.$lte = noon(query.endDate as string)
  }
  const request = Payment.find(filter).sort({ dueDate: 1 })
  if (maxRows !== undefined) request.limit(maxRows)
  return request
}
export async function getCompanyCalendarEntry(organizationId: mongoose.Types.ObjectId, paymentId: string) {
  const payment = await Payment.findOne({ _id: paymentId, organizationId, suppressedAt: { $exists: false } })
  if (!payment) throw createError({ statusCode: 404, statusMessage: 'Payment not found' })
  return payment
}
