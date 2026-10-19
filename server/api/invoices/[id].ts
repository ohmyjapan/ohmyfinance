import { updateCompanyInvoice, deleteCompanyInvoice, invoiceWriteError } from '../../services/companyInvoiceWriteService'
import { getCompanyInvoice } from '../../services/companyFinanceReadService'
// server/api/invoices/[id].ts
import { defineEventHandler, readBody, createError, setHeader } from 'h3'
import { ensureConnection } from '../../config/database'
import { requireAuth } from '../../middleware/auth'
import { calendarCompany } from '../../utils/calendarAccess'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const id = event.context.params?.id
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Invoice ID required' })
  }

  await ensureConnection()
  const method = event.method

  if (method === 'GET') {
    const { organizationId } = await calendarCompany(event)
    return getCompanyInvoice(organizationId, id)
  }

  if (method === 'PUT') {
    const { organizationId } = await calendarCompany(event)
    const body = await readBody(event)
    try {
      const invoice = await updateCompanyInvoice(organizationId, id, body)
      return { invoice: { ...invoice, id: invoice._id }, message: 'Invoice updated' }
    } catch (error) { return invoiceWriteError(error) }
  }

  if (method === 'DELETE') {
    const { organizationId } = await calendarCompany(event)
    await deleteCompanyInvoice(organizationId, id)
    return { message: 'Invoice deleted' }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
