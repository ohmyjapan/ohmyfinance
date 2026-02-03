// server/api/suppliers/index.ts
import { defineEventHandler, getQuery, readBody, getMethod, createError } from 'h3'
import Supplier from '../../models/Supplier'
import { ensureConnection } from '../../config/database'

export default defineEventHandler(async (event) => {
  await ensureConnection()
  const method = getMethod(event)

  if (method === 'GET') {
    const query = getQuery(event)
    const searchQuery: any = {}

    if (query.search) {
      searchQuery.$or = [
        { name: { $regex: query.search, $options: 'i' } },
        { companyInfo: { $regex: query.search, $options: 'i' } }
      ]
    }

    const suppliers = await Supplier.find(searchQuery)
      .sort({ name: 1 })
      .lean()

    return suppliers
  }

  if (method === 'POST') {
    const body = await readBody(event)

    if (!body.name) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: '仕入れ先名は必須です (Supplier name is required)'
      })
    }

    const supplier = new Supplier(body)
    await supplier.save()

    return supplier.toObject()
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method Not Allowed'
  })
})
