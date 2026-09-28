import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { requireLedgerAccess } from '../../../services/ledgerAccessService'
import { addTrackingEvent } from '../../../services/shipmentService'

export default defineEventHandler(async event => {
  const access = await requireLedgerAccess(event, 'write')
  if (event.method !== 'POST') throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  return addTrackingEvent(access, getRouterParam(event, 'id') || '', await readBody(event))
})
