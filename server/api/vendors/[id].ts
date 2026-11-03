// server/api/vendors/[id].ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Vendor from '../../models/Vendor'
import Transaction from '../../models/Transaction'
import { requireAuth } from '../../middleware/auth'
import { calendarCompany } from '../../utils/calendarAccess'

// S13: the fields a PUT may change; the company, counters and ids never come from the body.
const vendorUpdateFields = ['name', 'email', 'phone', 'address', 'website', 'category', 'taxId', 'notes', 'isActive']

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const id = event.context.params?.id
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Vendor ID required' })
  }

  await ensureConnection()
  const { organizationId } = await calendarCompany(event)
  const method = event.method

  if (method === 'GET') {
    const vendor: any = await Vendor.findOne({ _id: id, organizationId }).lean()
    if (!vendor) {
      throw createError({ statusCode: 404, statusMessage: 'Vendor not found' })
    }

    // Get the company's transaction history with this vendor
    const transactions = await Transaction.find({
      organizationId,
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
    const values = Object.fromEntries(vendorUpdateFields.filter((key) => body?.[key] !== undefined).map((key) => [key, body[key]]))
    const vendor = await Vendor.findOneAndUpdate({ _id: id, organizationId }, { $set: values }, { new: true }).lean()
    if (!vendor) {
      throw createError({ statusCode: 404, statusMessage: 'Vendor not found' })
    }
    return { vendor: { ...vendor, id: vendor._id }, message: 'Vendor updated' }
  }

  if (method === 'DELETE') {
    const result = await Vendor.findOneAndDelete({ _id: id, organizationId })
    if (!result) {
      throw createError({ statusCode: 404, statusMessage: 'Vendor not found' })
    }
    return { message: 'Vendor deleted' }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
