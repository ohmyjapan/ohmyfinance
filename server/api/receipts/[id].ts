import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { getReceiptById, updateReceipt, deleteReceipt } from '../../services/receiptManagementService'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async event => {
  const auth = requireAuth(event), id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Receipt ID required' })
  if (event.method === 'GET') return getReceiptById(auth.userId, id)
  if (event.method === 'PATCH') {
    const body = await readBody(event)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400, statusMessage: 'Receipt metadata required' })
    return updateReceipt(auth.userId, id, body)
  }
  if (event.method === 'DELETE') return { success: true, message: 'Receipt deleted successfully', receipt: await deleteReceipt(auth.userId, id) }
  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
