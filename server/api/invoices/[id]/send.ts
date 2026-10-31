// server/api/invoices/[id]/send.ts — send one invoice of the token's company by the company Gmail (plan omf-invoice-tnumber-20261030
// C5): POST {to, subject, message}; owners, admins and 経理担当 only; another company's invoice answers 404. The reply comes when the
// delivery has ended (sent, failed or unknown); OMF sets no time limit of its own.
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../../config/database'
import { requireAuth } from '../../../middleware/auth'
import { invoiceSender } from '../../../utils/invoiceSenderAccess'
import { sendInvoiceByGmail } from '../../../services/companyGmailService'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  requireAuth(event)
  const id = event.context.params?.id
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invoice ID required' })
  await ensureConnection()
  const { auth, organizationId } = await invoiceSender(event)
  const body = await readBody(event)
  return sendInvoiceByGmail({ organizationId, userId: auth.userId, invoiceId: id, to: body?.to, subject: body?.subject, message: body?.message })
})
