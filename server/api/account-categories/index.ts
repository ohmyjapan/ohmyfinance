// server/api/account-categories/index.ts
import { defineEventHandler, getQuery, readBody, getMethod, createError } from 'h3'
import AccountCategory from '../../models/AccountCategory'
import { ensureConnection } from '../../config/database'
import { requireAuth } from '../../middleware/auth'
import { selectedCompany, companyRegistrationEntry } from '../../services/companyAccountRegistrationService'

const nativeCategoryFields = ['name', 'code', 'description', 'parentId', 'type', 'order', 'metadata']

export default defineEventHandler(async (event) => {
  requireAuth(event)
  await ensureConnection()
  const method = getMethod(event)

  if (method === 'GET') {
    const query = getQuery(event)
    const searchQuery: any = { isActive: true }

    // Filter by parent (for sub-categories)
    if (query.parentId) {
      searchQuery.parentId = query.parentId
    } else if (query.topLevel === 'true') {
      // Only top-level categories (no parent)
      searchQuery.parentId = null
    }

    // Filter by type
    if (query.type) {
      searchQuery.type = query.type
    }

    if (query.search) {
      searchQuery.name = { $regex: query.search, $options: 'i' }
    }

    const categories = await AccountCategory.find(searchQuery)
      .populate('children')
      .sort({ order: 1, name: 1 })
      .lean()

    return categories
  }

  if (method === 'POST') {
    const body = await readBody(event)

    if (!body?.name) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: '勘定科目名は必須です (Account category name is required)'
      })
    }

    // With a selected company (membership checked fresh before any write) the new account is created already available to that
    // company's Navi, in the same insert. No selected company keeps the legacy shared create with no registration. Only the
    // supported native fields come from the body; ids, company and registration fields from the body are ignored.
    const { auth, organizationId } = await selectedCompany(event)
    const values = Object.fromEntries(nativeCategoryFields.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]))
    const registration = organizationId ? { companyRegistrations: [companyRegistrationEntry(organizationId, auth.userId, 'created')] } : {}
    const category = new AccountCategory({
      ...values,
      ...registration,
      isActive: true
    })
    await category.save()

    const { companyRegistrations, ...created } = category.toObject()
    return { ...created, ...(organizationId ? { companyRegistration: { companyId: String(organizationId), state: 'registered', via: 'created' } } : {}) }
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method Not Allowed'
  })
})
