// server/api/transactions/[id].ts
import { defineEventHandler, readBody, getMethod, createError, setHeader } from 'h3'
import { getTransactionById, updateTransaction, deleteTransaction } from '../../services/transactionService'
import { requireAuth } from '../../middleware/auth'
import { isValidObjectId } from 'mongoose'
import { ensureConnection } from '../../config/database'
import { calendarCompany } from '../../utils/calendarAccess'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  requireAuth(event)
  const method = getMethod(event)
  const id = event.context.params?.id

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Transaction ID is required'
    })
  }

  if (method === 'GET') {
    await ensureConnection()
    const { organizationId } = await calendarCompany(event)
    if (!isValidObjectId(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid transaction ID' })
    let transaction
    try {
      transaction = await getTransactionById(id, organizationId)
    } catch {
      throw createError({ statusCode: 500, statusMessage: 'Failed to read company transaction' })
    }
    if (!transaction) throw createError({ statusCode: 404, statusMessage: 'Transaction not found' })
    return transaction
  }

  if (method === 'PATCH' || method === 'PUT') {
    const body = await readBody(event)

    try {
      const transaction = await updateTransaction(id, body)
      return transaction
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Not Found',
          message: error.message
        })
      }
      throw error
    }
  }

  if (method === 'DELETE') {
    try {
      const transaction = await deleteTransaction(id)
      return { success: true, deleted: transaction }
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Not Found',
          message: error.message
        })
      }
      throw error
    }
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method Not Allowed'
  })
})
