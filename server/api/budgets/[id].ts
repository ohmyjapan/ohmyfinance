// server/api/budgets/[id].ts
// One company budget: read/update/delete only inside the token's selected company with a fresh active membership.
import { defineEventHandler, readBody, createError, setHeader } from 'h3'
import { ensureConnection } from '../../config/database'
import { requireAuth } from '../../middleware/auth'
import { calendarCompany } from '../../utils/calendarAccess'
import { getCompanyBudget, updateCompanyBudget, deleteCompanyBudget } from '../../services/companyBudgetService'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  requireAuth(event)
  const id = event.context.params?.id
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Budget ID required' })
  }
  const method = event.method
  if (!['GET', 'PUT', 'DELETE'].includes(method)) throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })

  await ensureConnection()
  const { organizationId: budgetItemCompany } = await calendarCompany(event)

  try {
    if (method === 'GET') {
      const budget = await getCompanyBudget(budgetItemCompany, id)
      if (!budget) throw createError({ statusCode: 404, statusMessage: 'Budget not found' })
      return { budget }
    }
    if (method === 'PUT') {
      const budget = await updateCompanyBudget(budgetItemCompany, id, await readBody(event))
      return { budget, message: 'Budget updated' }
    }
    await deleteCompanyBudget(budgetItemCompany, id)
    return { message: 'Budget deleted' }
  } catch (error: any) {
    if (error?.statusCode && error.statusCode < 500) throw error
    console.error('Company budget item request failed')
    throw createError({ statusCode: 500, statusMessage: 'Failed to process company budget' })
  }
})
