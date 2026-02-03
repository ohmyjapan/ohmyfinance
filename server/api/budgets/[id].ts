// server/api/budgets/[id].ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Budget from '../../models/Budget'

export default defineEventHandler(async (event) => {
  const id = event.context.params?.id
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Budget ID required' })
  }

  await ensureConnection()
  const method = event.method

  if (method === 'GET') {
    const budget = await Budget.findById(id).lean()
    if (!budget) {
      throw createError({ statusCode: 404, statusMessage: 'Budget not found' })
    }
    return { budget: { ...budget, id: budget._id } }
  }

  if (method === 'PUT') {
    const body = await readBody(event)
    const budget = await Budget.findByIdAndUpdate(id, {
      name: body.name,
      category: body.category,
      amount: body.amount,
      period: body.period,
      startDate: body.startDate,
      endDate: body.endDate,
      alertThreshold: body.alertThreshold,
      isActive: body.isActive
    }, { new: true }).lean()

    if (!budget) {
      throw createError({ statusCode: 404, statusMessage: 'Budget not found' })
    }

    return { budget: { ...budget, id: budget._id }, message: 'Budget updated' }
  }

  if (method === 'DELETE') {
    const result = await Budget.findByIdAndDelete(id)
    if (!result) {
      throw createError({ statusCode: 404, statusMessage: 'Budget not found' })
    }
    return { message: 'Budget deleted' }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
