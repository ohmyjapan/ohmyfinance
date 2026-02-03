// server/api/budgets/index.ts
import { defineEventHandler, readBody, getQuery, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Budget from '../../models/Budget'
import Transaction from '../../models/Transaction'

export default defineEventHandler(async (event) => {
  await ensureConnection()
  const method = event.method

  if (method === 'GET') {
    const query = getQuery(event)
    const { active, period } = query

    const filter: any = {}
    if (active === 'true') filter.isActive = true
    if (period) filter.period = period

    const budgets = await Budget.find(filter).sort({ createdAt: -1 }).lean()

    // Calculate spending for each budget
    const budgetsWithSpending = await Promise.all(budgets.map(async (budget: any) => {
      const { startDate, endDate, period } = budget

      // Calculate period dates
      let periodStart = new Date(startDate)
      let periodEnd = endDate ? new Date(endDate) : new Date()

      const now = new Date()
      if (period === 'monthly') {
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
        periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      } else if (period === 'quarterly') {
        const quarter = Math.floor(now.getMonth() / 3)
        periodStart = new Date(now.getFullYear(), quarter * 3, 1)
        periodEnd = new Date(now.getFullYear(), (quarter + 1) * 3, 0)
      } else if (period === 'yearly') {
        periodStart = new Date(now.getFullYear(), 0, 1)
        periodEnd = new Date(now.getFullYear(), 11, 31)
      }

      // Build transaction query
      const txQuery: any = {
        date: { $gte: periodStart, $lte: periodEnd }
      }
      if (budget.category) {
        txQuery.$or = [
          { category: budget.category },
          { 'metadata.category': budget.category }
        ]
      }

      const transactions = await Transaction.find(txQuery).lean()
      const spent = transactions.reduce((sum: number, tx: any) => sum + (tx.amount || 0), 0)
      const percentage = budget.amount > 0 ? Math.round((spent / budget.amount) * 100) : 0
      const remaining = budget.amount - spent
      const isOverBudget = spent > budget.amount
      const isNearLimit = percentage >= budget.alertThreshold && !isOverBudget

      return {
        ...budget,
        id: budget._id,
        spent,
        remaining,
        percentage,
        isOverBudget,
        isNearLimit,
        periodStart,
        periodEnd,
        transactionCount: transactions.length
      }
    }))

    return { budgets: budgetsWithSpending }
  }

  if (method === 'POST') {
    const body = await readBody(event)

    if (!body.name || !body.amount) {
      throw createError({ statusCode: 400, statusMessage: 'Name and amount are required' })
    }

    const budget = await Budget.create({
      name: body.name,
      category: body.category,
      amount: body.amount,
      period: body.period || 'monthly',
      startDate: body.startDate || new Date(),
      endDate: body.endDate,
      alertThreshold: body.alertThreshold || 80,
      isActive: body.isActive !== false
    })

    return { budget, message: 'Budget created successfully' }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
