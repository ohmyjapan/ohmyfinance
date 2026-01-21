// server/api/transactions/index.ts
import { defineEventHandler, getQuery, readBody, getMethod } from 'h3'
import { getTransactions, createTransaction, getTransactionStats } from '../../services/transactionService'

export default defineEventHandler(async (event) => {
  const method = getMethod(event)

  if (method === 'GET') {
    // Get query parameters for filtering
    const query = getQuery(event)

    // Check if stats are requested
    if (query.stats === 'true') {
      const stats = await getTransactionStats()
      return { stats }
    }

    const filters = {
      status: query.status as string | undefined,
      source: query.source as string | undefined,
      dateFrom: query.dateFrom as string | undefined,
      dateTo: query.dateTo as string | undefined,
      minAmount: query.minAmount ? Number(query.minAmount) : undefined,
      maxAmount: query.maxAmount ? Number(query.maxAmount) : undefined,
      search: query.search as string | undefined,
      hasReceipt: query.hasReceipt === 'true' ? true : query.hasReceipt === 'false' ? false : undefined
    }

    // Remove undefined values
    Object.keys(filters).forEach(key => {
      if (filters[key as keyof typeof filters] === undefined) {
        delete filters[key as keyof typeof filters]
      }
    })

    const transactions = await getTransactions(filters)

    return {
      transactions,
      total: transactions.length
    }
  }

  if (method === 'POST') {
    const body = await readBody(event)

    // Validate required fields
    if (!body.amount) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'Amount is required'
      })
    }

    if (!body.customer?.name || !body.customer?.email) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'Customer name and email are required'
      })
    }

    const transaction = await createTransaction({
      ...body,
      date: body.date ? new Date(body.date) : new Date(),
      source: body.source || 'manual'
    })

    return transaction
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method Not Allowed'
  })
})
