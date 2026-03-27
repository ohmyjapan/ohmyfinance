// server/api/transactions/[id].ts
import { defineEventHandler, readBody, getMethod, createError } from 'h3'
import { getTransactionById, updateTransaction, deleteTransaction } from '../../services/transactionService'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async (event) => {
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
    const transaction = await getTransactionById(id)

    if (!transaction) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: `Transaction ${id} not found`
      })
    }

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
