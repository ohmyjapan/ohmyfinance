import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requireLedgerAccess } from '../../services/ledgerAccessService'
import { getCalendarPayment, updateCalendarPayment, deleteCalendarPayment } from '../../services/calendarPaymentService'
export default defineEventHandler(async event => {
  const access = await requireLedgerAccess(event, event.method === 'GET' ? 'read' : 'write'), id = getRouterParam(event, 'id')
  if (!id || !/^[a-f0-9]{24}$/i.test(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid payment ID' })
  if (event.method === 'GET') return getCalendarPayment(access, id)
  if (event.method === 'PUT') return updateCalendarPayment(access, id, await readBody(event))
  if (event.method === 'DELETE') return deleteCalendarPayment(access, id, (await readBody(event))?.revision)
  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
