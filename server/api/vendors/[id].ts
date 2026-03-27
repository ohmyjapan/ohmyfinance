// server/api/vendors/[id].ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Vendor from '../../models/Vendor'
import Transaction from '../../models/Transaction'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const id = event.context.params?.id
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Vendor ID required' })
  }

  await ensureConnection()
  const method = event.method

  if (method === 'GET') {
    const vendor: any = await Vendor.findById(id).lean()
    if (!vendor) {
      throw createError({ statusCode: 404, statusMessage: 'Vendor not found' })
    }

    // Get transaction history
    const transactions = await Transaction.find({
      'customer.name': vendor.name
    }).sort({ date: -1 }).limit(50).lean()

    return {
      vendor: { ...vendor, id: vendor._id },
      transactions: transactions.map((t: any) => ({
        id: t._id,
        reference: t.reference,
        date: t.date,
        amount: t.amount,
        status: t.status
      }))
    }
  }

  if (method === 'PUT') {
    const body = await readBody(event)
    const vendor = await Vendor.findByIdAndUpdate(id, body, { new: true }).lean()
    if (!vendor) {
      throw createError({ statusCode: 404, statusMessage: 'Vendor not found' })
    }
    return { vendor: { ...vendor, id: vendor._id }, message: 'Vendor updated' }
  }

  if (method === 'DELETE') {
    const result = await Vendor.findByIdAndDelete(id)
    if (!result) {
      throw createError({ statusCode: 404, statusMessage: 'Vendor not found' })
    }
    return { message: 'Vendor deleted' }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
