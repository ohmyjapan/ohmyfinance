// server/api/transactions/index.ts
import { defineEventHandler, getQuery, readBody, getMethod, createError, setHeader } from 'h3'
import { getTransactions, createTransaction, getTransactionStats } from '../../services/transactionService'
import { requireAuth } from '../../middleware/auth'
import { ensureConnection } from '../../config/database'
import { calendarCompany } from '../../utils/calendarAccess'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  requireAuth(event)
  const method = getMethod(event)

  if (method === 'GET') {
    await ensureConnection()
    const { organizationId } = await calendarCompany(event)
    try {
    // Get query parameters for filtering
    const query = getQuery(event)

    // Check if stats are requested
    if (query.stats === 'true') {
      const stats = await getTransactionStats(organizationId)
      return { stats }
    }

    const filters = {
      status: query.status as string | undefined,
      type: query.type as string | undefined, // 支出 or 入金
      dateFrom: query.dateFrom as string | undefined,
      dateTo: query.dateTo as string | undefined,
      minAmount: query.minAmount ? Number(query.minAmount) : undefined,
      maxAmount: query.maxAmount ? Number(query.maxAmount) : undefined,
      search: query.search as string | undefined,
      hasReceipt: query.hasReceipt === 'true' ? true : query.hasReceipt === 'false' ? false : undefined,
      customerId: query.customerId as string | undefined,
      supplierId: query.supplierId as string | undefined,
      accountCategoryId: query.accountCategoryId as string | undefined,
      transactionCategoryId: query.transactionCategoryId as string | undefined,
      sourceId: query.sourceId as string | undefined
    }

    // Remove undefined values
    Object.keys(filters).forEach(key => {
      if (filters[key as keyof typeof filters] === undefined) {
        delete filters[key as keyof typeof filters]
      }
    })

    const transactions = await getTransactions(filters, organizationId)

    return {
      transactions,
      total: transactions.length
    }
    } catch {
      throw createError({ statusCode: 500, statusMessage: 'Failed to read company transactions' })
    }
  }

  if (method === 'POST') {
    const body = await readBody(event)

    // Validate required fields (OMF style)
    if (!body.amount && body.amount !== 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: '金額は必須です (Amount is required)'
      })
    }

    if (!body.date) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: '日付は必須です (Date is required)'
      })
    }

    const transaction = await createTransaction({
      ...body,
      date: new Date(body.date),
      type: body.type || '支出',
      status: body.status || 'pending'
    })

    return transaction
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method Not Allowed'
  })
})
