import { listCompanyInvoices } from '../../services/companyFinanceReadService'
// server/api/invoices/index.ts
import { defineEventHandler, readBody, getQuery, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Invoice from '../../models/Invoice'
import Transaction from '../../models/Transaction'
import { requireAuth } from '../../middleware/auth'
import { calendarCompany } from '../../utils/calendarAccess'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  await ensureConnection()
  const method = event.method

  if (method === 'GET') {
    const { organizationId } = await calendarCompany(event)
    return listCompanyInvoices(organizationId, getQuery(event))
  }

  if (method === 'POST') {
    const body = await readBody(event)

    // Generate invoice number
    const count = await Invoice.countDocuments()
    const invoiceNumber = body.invoiceNumber || `INV-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`

    // Calculate totals
    const items = body.items || []
    const subtotal = items.reduce((sum: number, item: any) => sum + (item.amount || item.quantity * item.unitPrice), 0)
    const taxRate = body.taxRate || 10
    const taxAmount = Math.round(subtotal * (taxRate / 100))
    const total = subtotal + taxAmount

    const invoice = await Invoice.create({
      invoiceNumber,
      transactionId: body.transactionId,
      status: body.status || 'draft',
      issueDate: body.issueDate || new Date(),
      dueDate: body.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      from: body.from,
      to: body.to,
      items: items.map((item: any) => ({
        ...item,
        amount: item.amount || item.quantity * item.unitPrice
      })),
      subtotal,
      taxRate,
      taxAmount,
      total,
      currency: body.currency || 'JPY',
      notes: body.notes,
      terms: body.terms,
      bankDetails: body.bankDetails
    })

    return { invoice: { ...invoice.toObject(), id: invoice._id }, message: 'Invoice created' }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
