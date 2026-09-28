// server/api/transactions/[id].ts
import { defineEventHandler, readBody, getMethod, createError } from 'h3'
import { getTransactionById, updateTransaction, deleteTransaction } from '../../services/transactionService'
import { requireLedgerAccess } from '../../services/ledgerAccessService'

export default defineEventHandler(async (event) => {
  const access = await requireLedgerAccess(event, event.method === 'GET' ? 'read' : 'write')
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
    const transaction = await getTransactionById(access, id)

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
      const transaction = await updateTransaction(access, id, body)
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
      const transaction = await deleteTransaction(access, id)
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
