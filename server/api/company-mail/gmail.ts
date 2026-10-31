// server/api/company-mail/gmail.ts — the company's invoice Gmail (plan omf-invoice-tnumber-20261030 C5). GET: the status for any
// member of the token's company (configured, connected, address, labelsGranted, state, canSend from a fresh role read). POST
// {action:'start'} / {action:'finish', code, state} and DELETE: owners, admins and 経理担当 only (server/utils/invoiceSenderAccess).
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import { requireAuth } from '../../middleware/auth'
import { calendarCompany } from '../../utils/calendarAccess'
import { invoiceSender } from '../../utils/invoiceSenderAccess'
import { gmailStatus, startGmailConnect, finishGmailConnect, disconnectGmail } from '../../services/companyGmailService'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  await ensureConnection()
  if (event.method === 'GET') {
    const { auth, organizationId } = await calendarCompany(event)
    return gmailStatus(organizationId, auth.userId)
  }
  if (event.method === 'POST') {
    const { auth, organizationId } = await invoiceSender(event)
    const body = await readBody(event)
    if (body?.action === 'start') return startGmailConnect(organizationId, auth.userId)
    if (body?.action === 'finish') return finishGmailConnect(organizationId, auth.userId, body)
    throw createError({ statusCode: 400, statusMessage: 'Unknown action' })
  }
  if (event.method === 'DELETE') {
    const { organizationId } = await invoiceSender(event)
    return disconnectGmail(organizationId)
  }
  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
