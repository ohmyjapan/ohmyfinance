import { defineEventHandler, readBody, createError, isError } from 'h3'
import { requireLedgerAccess } from '../../services/ledgerAccessService'
import { getReceiptById } from '../../services/receiptManagementService'
import { matchReceiptWithTransaction } from '../../services/receiptLinkService'

// Compatibility entrance: use the same company ownership and displayed-version protocol.
export default defineEventHandler(async event => {
  const access = await requireLedgerAccess(event, 'write')
  if (event.method !== 'POST') throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  try {
    const body = await readBody(event)
    if (!body?.receiptId || !body?.transactionId) throw createError({ statusCode: 400, statusMessage: 'Receipt ID and Transaction ID are required' })
    await getReceiptById(access, body.receiptId)
    return { success: true, ...await matchReceiptWithTransaction(access, body.receiptId, body.transactionId, body.linkVersion) }
  } catch (error) {
    if (isError(error)) throw error
    throw createError({ statusCode: 500, statusMessage: 'Failed to match receipt with transaction' })
  }
})
