// server/api/vendors/index.ts
// Note: In OMF style, "Vendors" maps to "Suppliers" (仕入れ先)
// This API is kept for backward compatibility but uses Supplier model
import { defineEventHandler, readBody, getQuery, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Supplier from '../../models/Supplier'
import Transaction from '../../models/Transaction'

export default defineEventHandler(async (event) => {
  await ensureConnection()
  const method = event.method

  if (method === 'GET') {
    const query = getQuery(event)
    const { search, category, active, sync } = query

    // Sync vendors/suppliers from transactions if requested (OMF style)
    if (sync === 'true') {
      // Get unique suppliers from transactions
      const supplierIds = await Transaction.aggregate([
        { $match: { supplierId: { $exists: true, $ne: null } } },
        { $group: { _id: '$supplierId' } }
      ])

      for (const { _id: supplierId } of supplierIds) {
        if (!supplierId) continue

        // Update supplier stats
        const txs = await Transaction.find({ supplierId })
        const totalSpent = txs.reduce((sum: number, tx: any) => sum + (tx.amount || 0), 0)
        const lastTx = txs.sort((a: any, b: any) =>
          new Date(b.date).getTime() - new Date(a.date).getTime()
        )[0]

        await Supplier.findByIdAndUpdate(supplierId, {
          totalSpent,
          transactionCount: txs.length,
          lastTransactionDate: lastTx?.date
        })
      }
    }

    const filter: any = {}
    if (search) {
      filter.name = { $regex: search, $options: 'i' }
    }
    if (category) filter.category = category
    if (active === 'true') filter.isActive = true

    const suppliers = await Supplier.find(filter).sort({ totalSpent: -1 }).lean()

    return {
      vendors: suppliers.map((s: any) => ({ ...s, id: s._id })),
      total: suppliers.length
    }
  }

  if (method === 'POST') {
    const body = await readBody(event)

    if (!body.name) {
      throw createError({ statusCode: 400, statusMessage: 'Name is required' })
    }

    const supplier = await Supplier.create(body)
    return { vendor: { ...supplier.toObject(), id: supplier._id }, message: 'Vendor/Supplier created' }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
