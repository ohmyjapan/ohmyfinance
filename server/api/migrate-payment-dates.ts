import { defineEventHandler, createError } from 'h3'
import { requireLedgerAccess } from '../services/ledgerAccessService'
export default defineEventHandler(async event => {
  await requireLedgerAccess(event, 'write')
  throw createError({ statusCode: 410, statusMessage: 'The legacy global date migration has been retired. Edit a payment date from its company calendar.' })
})
