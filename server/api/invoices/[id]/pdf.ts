// server/api/invoices/[id]/pdf.ts
import { defineEventHandler, createError, setHeader } from 'h3'
import { ensureConnection } from '../../../config/database'
import Invoice from '../../../models/Invoice'
import { requireAuth } from '../../../middleware/auth'
import { calendarCompany } from '../../../utils/calendarAccess'
import { generateInvoiceHTML, PRINT_POLICY } from '../../../utils/invoiceHtml'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const id = event.context.params?.id
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Invoice ID required' })
  }

  await ensureConnection()

  const { organizationId } = await calendarCompany(event)
  const invoice: any = await Invoice.findOne({ _id: id, organizationId }).lean()
  if (!invoice) {
    throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  }

  const html = generateInvoiceHTML(invoice)

  // A print preview, not a binary PDF: the browser prints it or saves it as PDF. No script may run in it (saved values are escaped
  // and the policy forbids scripts, frames and remote loads, also when the page opens it from an owned blob URL).
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setHeader(event, 'Content-Security-Policy', PRINT_POLICY)
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Content-Disposition', `inline; filename="invoice_${String(invoice.invoiceNumber || '').replace(/[^A-Za-z0-9._-]/g, '_')}.html"`)

  return html
})
