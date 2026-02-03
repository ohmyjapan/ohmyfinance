// server/api/customers/[id].ts
import { defineEventHandler, readBody, createError } from 'h3'
import Customer from '../../models/Customer'
import { ensureConnection } from '../../config/database'

export default defineEventHandler(async (event) => {
  await ensureConnection()
  const method = event.method
  const id = event.context.params?.id

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Customer ID is required'
    })
  }

  // GET - Get customer by ID
  if (method === 'GET') {
    const customer = await Customer.findById(id).lean()
    if (!customer) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '顧客が見つかりません'
      })
    }
    return customer
  }

  // PUT - Update customer
  if (method === 'PUT') {
    const body = await readBody(event)

    const customer = await Customer.findByIdAndUpdate(
      id,
      {
        name: body.name,
        email: body.email,
        phone: body.phone,
        company: body.company,
        invoiceNumber: body.invoiceNumber,
        address: body.address,
        notes: body.notes,
        tags: body.tags,
        isActive: body.isActive
      },
      { new: true, runValidators: true }
    ).lean()

    if (!customer) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '顧客が見つかりません'
      })
    }

    return customer
  }

  // DELETE - Delete customer
  if (method === 'DELETE') {
    const customer = await Customer.findByIdAndDelete(id)
    if (!customer) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '顧客が見つかりません'
      })
    }
    return { success: true, message: '顧客を削除しました' }
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method Not Allowed'
  })
})
