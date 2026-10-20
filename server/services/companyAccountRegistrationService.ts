// Company-registered accounting accounts (勘定科目/補助科目) for Navi. A registration says only "this company made this shared account
// available to its Navi": it is not ownership of the shared chart (edit/delete of the shared master is unchanged, wider G4), never
// adopts an unassigned legacy record, and never saves a transaction. The company always comes from the token, checked fresh; the
// registration list (company ids, actor) never leaves the server.
import mongoose from 'mongoose'
import { createError, type H3Event } from 'h3'
import AccountCategory from '../models/AccountCategory'
import { requireAuth } from '../middleware/auth'
import { companyMembership } from '../utils/calendarAccess'

export const registeredPageSize = 50
export const accountReferenceFields = ['accountCategoryId', 'subAccountCategoryId']
const registrationFilter = (organizationId: any) => ({ isActive: true, 'companyRegistrations.organizationId': organizationId })
// Account names are matched literally (case-insensitive), never as a regular expression.
const literalName = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const companyRegistrationEntry = (organizationId: any, registeredBy: any, via: 'created' | 'registered') => ({ organizationId, registeredBy: new mongoose.Types.ObjectId(String(registeredBy)), registeredAt: new Date(), via })

// Native create: a selected company is checked fresh now (403 for a removed member); no selected company keeps the legacy shared create.
export async function selectedCompany(event: H3Event) {
  const auth = requireAuth(event)
  if (!auth.organizationId) return { auth, organizationId: null }
  return { auth, organizationId: await companyMembership(String(auth.userId), String(auth.organizationId)) }
}

// Explicit registration of an existing active account for the freshly checked company. Atomic and idempotent: the filter admits one
// entry per company, so retries and concurrent requests add it once.
export async function registerAccountForCompany(accountId: string, organizationId: mongoose.Types.ObjectId, actorId: string) {
  if (!mongoose.isValidObjectId(accountId)) throw createError({ statusCode: 400, statusMessage: 'Invalid account category ID' })
  const changed = await AccountCategory.updateOne({ _id: accountId, isActive: true, 'companyRegistrations.organizationId': { $ne: organizationId } }, { $push: { companyRegistrations: companyRegistrationEntry(organizationId, actorId, 'registered') } })
  const account: any = await AccountCategory.findOne({ _id: accountId, ...registrationFilter(organizationId) }).select('name code parentId type').lean()
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Account category not found or inactive' })
  return { state: changed.modifiedCount ? 'registered' : 'already_registered', account: { id: String(account._id), name: account.name || '', ...(account.code ? { code: account.code } : {}), parentId: account.parentId ? String(account.parentId) : null, type: account.type || null }, company: { id: String(organizationId) }, meaning: 'available_to_this_company_navi_not_ownership_no_transaction_saved' }
}

// This company's registered active accounts, literal name search, bounded pages. A registered sub-account carries its actual parent,
// read directly by id (name and whether this company registered it); siblings are never listed and nothing is adopted.
export async function registeredAccountCatalogue(organizationId: any, args: any = {}) {
  const page = args.accountPage || 1, query = typeof args.accountQuery === 'string' && args.accountQuery.trim() ? args.accountQuery.trim() : null
  const filter: any = registrationFilter(organizationId)
  if (query) filter.name = { $regex: literalName(query), $options: 'i' }
  const rows: any[] = await AccountCategory.find(filter).select('name code parentId').sort({ order: 1, name: 1, _id: 1 }).skip((page - 1) * registeredPageSize).limit(registeredPageSize + 1).lean()
  const shown = rows.slice(0, registeredPageSize), parentIds = [...new Set(shown.filter(row => row.parentId).map(row => String(row.parentId)))]
  const parentRows: any[] = parentIds.length ? await AccountCategory.find({ _id: { $in: parentIds } }).select('name code').lean() : []
  const registeredParents = new Set((parentIds.length ? await AccountCategory.find({ _id: { $in: parentIds }, ...registrationFilter(organizationId) }).select('_id').lean() : []).map((p: any) => String(p._id)))
  const parents = new Map(parentRows.map(p => [String(p._id), { id: String(p._id), name: p.name || '', ...(p.code ? { code: p.code } : {}), registeredForCompany: registeredParents.has(String(p._id)) }]))
  const accounts = shown.map(row => ({ id: String(row._id), name: row.name || '', ...(row.code ? { code: row.code } : {}), field: row.parentId ? 'subAccountCategoryId' : 'accountCategoryId', parent: row.parentId ? parents.get(String(row.parentId)) || null : null }))
  return { accounts, hasMore: rows.length > registeredPageSize, page, limit: registeredPageSize, query }
}

// Direct trusted lookup (any page): an active account this company registered, top-level for accountCategoryId, a child for
// subAccountCategoryId.
export async function isRegisteredAccount(organizationId: any, field: string, id: any) {
  if (!accountReferenceFields.includes(field) || !mongoose.isValidObjectId(id)) return false
  return !!await AccountCategory.exists({ _id: id, ...registrationFilter(organizationId), parentId: field === 'subAccountCategoryId' ? { $ne: null } : null })
}
