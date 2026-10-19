import { createCompanyInvoice, invoiceWriteError } from '../../services/companyInvoiceWriteService'
import { listCompanyInvoices } from '../../services/companyFinanceReadService'
// server/api/invoices/index.ts
import { defineEventHandler, readBody, getQuery, createError } from 'h3'
import { ensureConnection } from '../../config/database'
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
    const { auth, organizationId } = await calendarCompany(event)
    const body = await readBody(event)
    try {
      const invoice = await createCompanyInvoice(organizationId, auth.userId, body)
      return { invoice: { ...invoice, id: invoice._id }, message: 'Invoice created' }
    } catch (error) { return invoiceWriteError(error) }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
