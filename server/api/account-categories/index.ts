// server/api/account-categories/index.ts
import { defineEventHandler, getQuery, getMethod, createError } from 'h3'
import AccountCategory from '../../models/AccountCategory'
import { ensureConnection } from '../../config/database'
import { requireAuth } from '../../middleware/auth'
import { rejectSharedMasterWrite } from '../../utils/sharedMasterAccess'

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
    // Owner ruling 2026-11-02 (S15): nobody writes the shared chart in-app; the operator adds a code with scripts/manage-masters.ts and
    // a company then registers it for its Navi (account-categories/[id]/registration.ts).
    rejectSharedMasterWrite(event)
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method Not Allowed'
  })
})
