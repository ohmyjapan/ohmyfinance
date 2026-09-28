import { defineEventHandler, readBody, createError } from 'h3'
import { matchReceiptWithTransaction, unmatchReceipt } from '../../../services/receiptLinkService'
import { getReceiptById } from '../../../services/receiptManagementService'
import { requireLedgerAccess } from '../../../services/ledgerAccessService'

export default defineEventHandler(async event => {
  const access = await requireLedgerAccess(event, 'write')
  if (!['POST', 'DELETE'].includes(event.method)) throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  await getReceiptById(access, event.context.params?.id!)
  const body = await readBody(event)
  if (!body?.transactionId) throw createError({ statusCode: 400, statusMessage: 'Transaction ID is required' })
  const action = event.method === 'POST' ? matchReceiptWithTransaction : unmatchReceipt
  return { success: true, ...await action(access, event.context.params?.id!, body.transactionId, body.linkVersion) }
})
