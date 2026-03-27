// server/api/invoices/[id].ts
import { defineEventHandler, readBody, createError, setHeader } from 'h3'
import { ensureConnection } from '../../config/database'
import Invoice from '../../models/Invoice'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const id = event.context.params?.id
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Invoice ID required' })
  }

  await ensureConnection()
  const method = event.method

  if (method === 'GET') {
    const invoice = await Invoice.findById(id).lean()
    if (!invoice) {
      throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
    }
    return { invoice: { ...invoice, id: invoice._id } }
  }

  if (method === 'PUT') {
    const body = await readBody(event)

    // Recalculate totals if items changed
    let updateData = { ...body }
    if (body.items) {
      const subtotal = body.items.reduce((sum: number, item: any) => sum + (item.amount || item.quantity * item.unitPrice), 0)
      const taxRate = body.taxRate || 10
      const taxAmount = Math.round(subtotal * (taxRate / 100))
      updateData = {
        ...updateData,
        subtotal,
        taxAmount,
        total: subtotal + taxAmount
      }
    }

    const invoice = await Invoice.findByIdAndUpdate(id, updateData, { new: true }).lean()
    if (!invoice) {
      throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
    }

    return { invoice: { ...invoice, id: invoice._id }, message: 'Invoice updated' }
  }

  if (method === 'DELETE') {
    const result = await Invoice.findByIdAndDelete(id)
    if (!result) {
      throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
    }
    return { message: 'Invoice deleted' }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
