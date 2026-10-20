// server/api/invoices/[id]/calendar.ts — the invoice's one income calendar entry (plan omf-navi-invoice-calendar-20261020).
// GET reads the link (saved snapshot, invoice now, entry now, differing fields); POST explicitly creates the entry once from the
// invoice as saved at the exact updatedAt the caller read. The selected company and the actor come from the token with a fresh
// membership check; the body names only expectedUpdatedAt (never a company, entry, amount, date, status or link).
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../../config/database'
import { requireAuth } from '../../../middleware/auth'
import { calendarCompany } from '../../../utils/calendarAccess'
import { readInvoiceCalendar, scheduleInvoicePayment } from '../../../services/companyInvoiceCalendarService'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const id = String(event.context.params?.id || '')
  const method = event.method
  if (method !== 'GET' && method !== 'POST') throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  await ensureConnection()
  const { auth, organizationId } = await calendarCompany(event)
  if (method === 'GET') return readInvoiceCalendar(organizationId, id)
  const body = await readBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => k !== 'expectedUpdatedAt')) throw createError({ statusCode: 400, statusMessage: 'Send only expectedUpdatedAt of the invoice you read' })
  return scheduleInvoicePayment(organizationId, id, { expectedUpdatedAt: body.expectedUpdatedAt, actorId: String(auth.userId) })
})
