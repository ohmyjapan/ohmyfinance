// server/api/suppliers/[id].ts
import { defineEventHandler, readBody, createError } from 'h3'
import Supplier from '../../models/Supplier'
import { ensureConnection } from '../../config/database'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  await ensureConnection()
  const method = event.method
  const id = event.context.params?.id

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Supplier ID is required'
    })
  }

  // GET - Get supplier by ID
  if (method === 'GET') {
    const supplier = await Supplier.findById(id).lean()
    if (!supplier) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '仕入れ先が見つかりません'
      })
    }
    return supplier
  }

  // PUT - Update supplier
  if (method === 'PUT') {
    const body = await readBody(event)

    const supplier = await Supplier.findByIdAndUpdate(
      id,
      {
        name: body.name,
        companyName: body.companyName,
        serviceName: body.serviceName,
        invoiceNumber: body.invoiceNumber,
        companyInfo: body.companyInfo,
        address: body.address,
        contactPerson: body.contactPerson,
        email: body.email,
        phone: body.phone,
        website: body.website,
        notes: body.notes,
        tags: body.tags
      },
      { new: true, runValidators: true }
    ).lean()

    if (!supplier) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '仕入れ先が見つかりません'
      })
    }

    return supplier
  }

  // DELETE - Delete supplier
  if (method === 'DELETE') {
    const supplier = await Supplier.findByIdAndDelete(id)
    if (!supplier) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '仕入れ先が見つかりません'
      })
    }
    return { success: true, message: '仕入れ先を削除しました' }
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method Not Allowed'
  })
})
