import { defineEventHandler, getRouterParam, setHeader } from 'h3'
import { requireLedgerAccess } from '../../../services/ledgerAccessService'
import { reconcileManualTransaction } from '../../../services/manualTransactionService'

export default defineEventHandler(async event => {
  const access = await requireLedgerAccess(event)
  setHeader(event, 'Cache-Control', 'no-store')
  return reconcileManualTransaction(access, getRouterParam(event, 'key'))
})
