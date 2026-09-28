import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import mongoose from 'mongoose'
import { requireLedgerAccess } from '../../../services/ledgerAccessService'
import { matchReceiptWithTransaction, unmatchReceipt } from '../../../services/receiptLinkService'
import { getTransactionById } from '../../../services/transactionService'

export default defineEventHandler(async event => {
  const access = await requireLedgerAccess(event, 'write')
  if (!['PUT', 'DELETE'].includes(event.method)) throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  const id = getRouterParam(event, 'id')!
  if (!mongoose.isObjectIdOrHexString(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid transaction ID' })
  const body = await readBody(event)
  if (!body?.receiptId) throw createError({ statusCode: 400, statusMessage: 'Receipt ID is required' })
  if (event.method === 'PUT') return { success: true, ...await matchReceiptWithTransaction(access, body.receiptId, id, body.linkVersion) }
  if (!await getTransactionById(access, id)) throw createError({ statusCode: 404, statusMessage: 'Transaction not found' })
  const result = await unmatchReceipt(access, body.receiptId, id, body.linkVersion)
  return { success: true, ...result, transaction: await getTransactionById(access, id) }
})
