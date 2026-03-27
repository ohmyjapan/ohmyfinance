// server/api/receipts/index.ts
import { defineEventHandler, getQuery, readBody, getMethod } from 'h3'
import { getReceipts, createReceipt, getReceiptStats } from '../../services/receiptService'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const method = getMethod(event)

  if (method === 'GET') {
    const query = getQuery(event)

    // Check if stats are requested
    if (query.stats === 'true') {
      const stats = await getReceiptStats()
      return { stats }
    }

    const filters = {
      status: query.status as string | undefined,
      dateFrom: query.dateFrom as string | undefined,
      dateTo: query.dateTo as string | undefined,
      minAmount: query.minAmount ? Number(query.minAmount) : undefined,
      maxAmount: query.maxAmount ? Number(query.maxAmount) : undefined,
      merchant: query.merchant as string | undefined,
      transactionId: query.transactionId as string | undefined,
      search: query.search as string | undefined
    }

    // Remove undefined values
    Object.keys(filters).forEach(key => {
      if (filters[key as keyof typeof filters] === undefined) {
        delete filters[key as keyof typeof filters]
      }
    })

    const receipts = await getReceipts(filters)

    return {
      receipts,
      total: receipts.length
    }
  }

  if (method === 'POST') {
    const body = await readBody(event)

    // Validate required fields
    if (!body.filename) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'Filename is required'
      })
    }

    const receipt = await createReceipt({
      filename: body.filename,
      originalFilename: body.originalFilename || body.filename,
      size: body.size || 0,
      mimeType: body.mimeType,
      fileUrl: body.fileUrl,
      filePath: body.filePath
    }, {
      amount: body.amount,
      currency: body.currency,
      merchant: body.merchant,
      receiptDate: body.receiptDate ? new Date(body.receiptDate) : undefined,
      category: body.category,
      notes: body.notes,
      tags: body.tags,
      uploadedBy: body.uploadedBy
    })

    return receipt
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method Not Allowed'
  })
})
