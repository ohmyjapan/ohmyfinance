import { defineEventHandler, readBody, getQuery, createError } from 'h3'
import { requireLedgerAccess } from '../../services/ledgerAccessService'
import { listCalendarPayments, createCalendarPayment } from '../../services/calendarPaymentService'
export default defineEventHandler(async event => {
  const access = await requireLedgerAccess(event, event.method === 'GET' ? 'read' : 'write')
  if (event.method === 'GET') return listCalendarPayments(access, getQuery(event))
  if (event.method === 'POST') return createCalendarPayment(access, await readBody(event))
  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
