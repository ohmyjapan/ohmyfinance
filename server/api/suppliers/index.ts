// server/api/suppliers/index.ts
import { defineEventHandler, getQuery, readBody, getMethod, createError } from 'h3'
import Supplier from '../../models/Supplier'
import { ensureConnection } from '../../config/database'
import { calendarCompany } from '../../utils/calendarAccess'

export default defineEventHandler(async (event) => {
  await ensureConnection()
  // The token's selected company with fresh membership: every read is filtered by it, every write stamped with it.
  const { organizationId } = await calendarCompany(event)
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

    const suppliers = await Supplier.find({ ...searchQuery, organizationId })
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

    // Official verification is server-maintained evidence, not a user-entered badge.
    if (body.metadata?.invoiceVerification !== undefined || Object.keys(body).some(key => key.startsWith('metadata.'))) {
      throw createError({ statusCode: 400, message: '公表情報の確認記録はこの画面から登録できません。' })
    }
    // A company named in the body is ignored; the row belongs to the token company.
    const supplier = new Supplier({ ...body, organizationId })
    await supplier.save()

    return supplier.toObject()
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method Not Allowed'
  })
})
