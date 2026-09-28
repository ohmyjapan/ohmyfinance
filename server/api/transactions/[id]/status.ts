import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { Types } from 'mongoose'
import { TRANSACTION_STATUSES } from '../../../models/Transaction'
import { updateTransaction } from '../../../services/transactionService'
import { requireAuth } from '../../../middleware/auth'
import { requireLedgerAccess } from '../../../services/ledgerAccessService'

/** Use the same persistence and permissions as the normal transaction edit. */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  if (event.method !== 'PATCH') {
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }
  const access = await requireLedgerAccess(event, 'write')
  const id = getRouterParam(event, 'id')
  if (!id || !Types.ObjectId.isValid(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Valid transaction ID is required' })
  }
  const body = await readBody<Record<string, unknown> | null>(event)
  if (!body || Array.isArray(body) || typeof body.status !== 'string' || !TRANSACTION_STATUSES.includes(body.status)) {
    throw createError({ statusCode: 400, statusMessage: 'Valid transaction status is required' })
  }
  if (body.notes !== undefined && typeof body.notes !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Transaction notes must be text' })
  }
  try {
    const transaction = await updateTransaction(access, id, {
      status: body.status,
      ...(body.notes !== undefined ? { notes: body.notes as string } : {})
    })
    return { success: true, message: 'Transaction status updated successfully', transaction }
  } catch (error) {
    if (error instanceof Error && error.message === `Transaction ${id} not found`) {
      throw createError({ statusCode: 404, statusMessage: 'Transaction not found' })
    }
    throw error
  }
})
