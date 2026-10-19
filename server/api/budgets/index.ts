// server/api/budgets/index.ts
// Company budgets: the company is the token's selected company with a fresh active membership (calendarCompany), never
// the request body. Reads and writes go through the shared native companyBudgetService.
import { defineEventHandler, readBody, getQuery, createError, setHeader } from 'h3'
import { ensureConnection } from '../../config/database'
import { requireAuth } from '../../middleware/auth'
import { calendarCompany } from '../../utils/calendarAccess'
import { listCompanyBudgets, createCompanyBudget } from '../../services/companyBudgetService'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  requireAuth(event)
  const method = event.method
  if (method !== 'GET' && method !== 'POST') throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  await ensureConnection()
  const { auth: budgetActor, organizationId: budgetCompany } = await calendarCompany(event)

  try {
    if (method === 'GET') {
      const query = getQuery(event)
      return { budgets: await listCompanyBudgets(budgetCompany, { active: query.active, period: query.period }) }
    }
    const budget = await createCompanyBudget(budgetCompany, budgetActor.userId, await readBody(event))
    return { budget, message: 'Budget created successfully' }
  } catch (error: any) {
    if (error?.statusCode && error.statusCode < 500) throw error
    console.error('Company budget request failed')
    throw createError({ statusCode: 500, statusMessage: method === 'GET' ? 'Failed to read company budgets' : 'Failed to create company budget' })
  }
})
