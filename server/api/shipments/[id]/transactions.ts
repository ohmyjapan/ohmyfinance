import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { requireLedgerAccess } from '../../../services/ledgerAccessService'
import { linkTransactions, unlinkTransactions } from '../../../services/shipmentService'

export default defineEventHandler(async event => {
  const access = await requireLedgerAccess(event, 'write')
  if (event.method !== 'POST' && event.method !== 'DELETE') throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  const id = getRouterParam(event, 'id') || '', body = await readBody(event)
  return event.method === 'POST'
    ? linkTransactions(access, id, body?.transactionIds)
    : unlinkTransactions(access, id, body?.transactionIds)
})
