import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { requireLedgerAccess } from '../../../services/ledgerAccessService'
import { completeCalendarPayment } from '../../../services/calendarPaymentService'
export default defineEventHandler(async event => {
  const access = await requireLedgerAccess(event, 'write'), id = getRouterParam(event, 'id')
  if (!id || !/^[a-f0-9]{24}$/i.test(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid payment ID' })
  return completeCalendarPayment(access, id, (await readBody(event))?.revision)
})
