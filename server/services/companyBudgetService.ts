// server/services/companyBudgetService.ts
// Native company budgets: every read and write is bound to the trusted company the caller resolved from the fresh membership
// check (calendarCompany). Request bodies never supply ownership, creator or the internal Navi marker. Spending is the
// company's completed expense rows inside the budget's calendar period in the company's saved timezone; other currencies,
// unknown currencies, pending forecasts, refunds and unclassified rows are reported, never silently counted as zero.
import mongoose from 'mongoose'
import { createError } from 'h3'
import Budget from '../models/Budget'
import Transaction from '../models/Transaction'
import Organization from '../models/Organization'
import { ensureConnection } from '../config/database'

const DAY_MS = 86400000
export const DEFAULT_TIMEZONE = 'Asia/Tokyo'
const EXPENSE_TYPE = '支出'
const BUDGET_PERIODS = ['monthly', 'quarterly', 'yearly']
const PUBLIC_OMIT = ['naviOperation', '__v']

const budgetScope = (organizationId: mongoose.Types.ObjectId) => ({ organizationId })
const spendingScope = (organizationId: mongoose.Types.ObjectId) => ({ organizationId, type: EXPENSE_TYPE })

/** Trusted internal operation data (later Navi adapters). Never read from an HTTP body. */
export type BudgetOperation = { id?: mongoose.Types.ObjectId, naviOperation?: Record<string, unknown>, expectedUpdatedAt?: string }

export function fail(statusCode: number, statusMessage: string): never {
  throw createError({ statusCode, statusMessage })
}

export function requireCompany(organizationId: unknown): mongoose.Types.ObjectId {
  if (!(organizationId instanceof mongoose.Types.ObjectId)) throw new Error('A trusted company is required')
  return organizationId
}

// ---- Dates: a date-only fact is stored as UTC midnight of its calendar day ('YYYY-MM-DD' -> 'YYYY-MM-DDT00:00:00.000Z').
export function validTimeZone(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return value } catch { return null }
}

export function localDateKey(instant: Date, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant).map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function offsetMs(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(instant)).map(p => [p.type, p.value]))
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
  return asUtc - (instant - (((instant % 1000) + 1000) % 1000))
}

/** The instant a calendar day starts in the given timezone. */
export function zonedDayStart(key: string, timeZone: string): Date {
  const guess = Date.parse(`${key}T00:00:00.000Z`)
  let instant = guess - offsetMs(guess, timeZone)
  const corrected = guess - offsetMs(instant, timeZone)
  if (corrected !== instant) instant = corrected
  return new Date(instant)
}

export const dateKey = (value: Date) => value.toISOString().slice(0, 10)
export const keyDate = (key: string) => new Date(`${key}T00:00:00.000Z`)
export const addDays = (key: string, days: number) => dateKey(new Date(Date.parse(`${key}T00:00:00.000Z`) + days * DAY_MS))
export const clampDay = (year: number, month: number, day: number) => Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate())

function isRealDate(key: string) {
  const parsed = keyDate(key)
  return Number.isFinite(parsed.getTime()) && dateKey(parsed) === key
}

/** Date-only input: 'YYYY-MM-DD' as written, or an ISO instant read as that day in the company timezone. */
export function parseDateOnly(value: unknown, timeZone: string, label: string): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) return keyDate(localDateKey(value, timeZone))
  if (typeof value === 'string') {
    const text = value.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(text) && isRealDate(text)) return keyDate(text)
    if (/^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(text) && isRealDate(text.slice(0, 10))) return keyDate(text.slice(0, 10))
    if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(text) && Number.isFinite(Date.parse(text))) return keyDate(localDateKey(new Date(text), timeZone))
  }
  fail(400, `Invalid ${label}`)
}

export async function companySettings(organizationId: mongoose.Types.ObjectId) {
  const company: any = await Organization.findOne({ _id: organizationId }).select('settings').lean()
  return {
    timeZone: validTimeZone(company?.settings?.timezone) || DEFAULT_TIMEZONE,
    defaultCurrency: typeof company?.settings?.defaultCurrency === 'string' && /^[A-Z]{3}$/.test(company.settings.defaultCurrency) ? company.settings.defaultCurrency : null
  }
}

// ---- Field validation shared by create/update. Only listed fields are read; objects never pass for scalar fields.
export function text(value: unknown, label: string, max: number, required = false): string | undefined {
  if (value === undefined || value === null || value === '') { if (required) fail(400, `${label} is required`); return undefined }
  if (typeof value !== 'string') fail(400, `Invalid ${label}`)
  const trimmed = value.trim()
  if (!trimmed) { if (required) fail(400, `${label} is required`); return undefined }
  if (trimmed.length > max) fail(400, `${label} is too long`)
  return trimmed
}

const KNOWN_CURRENCIES: Set<string> | null = (() => { try { return new Set((Intl as any).supportedValuesOf('currency') as string[]) } catch { return null } })()
export function currencyCode(value: unknown): string {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (!/^[A-Z]{3}$/.test(code) || (KNOWN_CURRENCIES && !KNOWN_CURRENCIES.has(code))) fail(400, 'Currency must be an ISO 4217 code (for example JPY)')
  return code
}

export function money(value: unknown, label: string): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(number)) fail(400, `Invalid ${label}`)
  return number
}

function threshold(value: unknown) {
  if (value === undefined || value === null || value === '') return 80
  const number = money(value, 'alert threshold')
  if (number < 0 || number > 100) fail(400, 'Alert threshold must be between 0 and 100')
  return number
}

function bool(value: unknown, label: string) {
  if (typeof value !== 'boolean') fail(400, `Invalid ${label}`)
  return value
}

export function publicRecord(row: any) {
  if (!row) return row
  const out: any = { ...row, id: String(row._id) }
  for (const key of PUBLIC_OMIT) delete out[key]
  return out
}

function currentPeriodStart(period: string, timeZone: string, now: Date) {
  const [year, month] = localDateKey(now, timeZone).split('-').map(Number)
  const startMonth = period === 'yearly' ? 1 : period === 'quarterly' ? Math.floor((month - 1) / 3) * 3 + 1 : month
  return keyDate(`${year}-${String(startMonth).padStart(2, '0')}-01`)
}

// ---- CRUD
export async function listCompanyBudgets(organizationId: mongoose.Types.ObjectId, filters: { active?: unknown, period?: unknown } = {}, now = new Date()) {
  requireCompany(organizationId)
  await ensureConnection()
  const filter: any = budgetScope(organizationId)
  if (filters.active === 'true') filter.isActive = true
  if (filters.period !== undefined && filters.period !== '') {
    if (typeof filters.period !== 'string' || !BUDGET_PERIODS.includes(filters.period)) fail(400, 'Invalid budget period')
    filter.period = filters.period
  }
  const settings = await companySettings(organizationId)
  const budgets: any[] = await Budget.find(filter).sort({ createdAt: -1 }).limit(500).lean()
  const out = []
  for (const budget of budgets) out.push({ ...publicRecord(budget), ...await budgetSpending(organizationId, budget, settings.timeZone, now) })
  return out
}

export async function getCompanyBudget(organizationId: mongoose.Types.ObjectId, id: string) {
  requireCompany(organizationId)
  await ensureConnection()
  if (!mongoose.isValidObjectId(id)) return null
  return publicRecord(await Budget.findOne({ ...budgetScope(organizationId), _id: new mongoose.Types.ObjectId(id) }).lean())
}

export async function createCompanyBudget(organizationId: mongoose.Types.ObjectId, createdBy: string, body: any, operation: BudgetOperation = {}, now = new Date()) {
  requireCompany(organizationId)
  if (!mongoose.isValidObjectId(createdBy)) throw new Error('A trusted creator is required')
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Invalid budget')
  await ensureConnection()
  const settings = await companySettings(organizationId)
  const name = text(body.name, 'Name', 200)
  const hasAmount = body.amount !== undefined && body.amount !== null && body.amount !== '' && body.amount !== 0 && body.amount !== '0'
  if (!name || !hasAmount) fail(400, 'Name and amount are required')
  const amount = money(body.amount, 'amount')
  if (amount <= 0) fail(400, 'Amount must be greater than zero')
  const currency = body.currency === undefined || body.currency === null || body.currency === '' ? settings.defaultCurrency : currencyCode(body.currency)
  if (!currency) fail(400, 'Currency is required')
  const period = body.period === undefined || body.period === null || body.period === '' ? 'monthly' : body.period
  if (typeof period !== 'string' || !BUDGET_PERIODS.includes(period)) fail(400, 'Invalid budget period')
  const startDate = body.startDate === undefined || body.startDate === null || body.startDate === '' ? currentPeriodStart(period, settings.timeZone, now) : parseDateOnly(body.startDate, settings.timeZone, 'start date')
  const endDate = body.endDate === undefined || body.endDate === null || body.endDate === '' ? undefined : parseDateOnly(body.endDate, settings.timeZone, 'end date')
  if (endDate && endDate < startDate) fail(400, 'End date must not be before start date')
  const values: any = {
    name, amount, currency, period, startDate, alertThreshold: threshold(body.alertThreshold),
    isActive: body.isActive === undefined ? true : bool(body.isActive, 'active flag'),
    organizationId, createdBy: new mongoose.Types.ObjectId(createdBy)
  }
  const category = text(body.category, 'Category', 100)
  if (category) values.category = category
  if (endDate) values.endDate = endDate
  if (operation.id) values._id = operation.id
  if (operation.naviOperation) values.naviOperation = operation.naviOperation
  try {
    const budget = await Budget.create(values)
    return publicRecord(budget.toObject())
  } catch (error: any) {
    if (error?.name === 'ValidationError' || error?.name === 'CastError') fail(400, 'Invalid budget')
    if (error?.code === 11000 && operation.id) {
      const existing = await Budget.findOne({ ...budgetScope(organizationId), _id: operation.id }).lean()
      if (existing) return publicRecord(existing)
    }
    throw error
  }
}

export async function updateCompanyBudget(organizationId: mongoose.Types.ObjectId, id: string, body: any, operation: BudgetOperation = {}) {
  requireCompany(organizationId)
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Invalid budget')
  await ensureConnection()
  if (!mongoose.isValidObjectId(id)) fail(404, 'Budget not found')
  const scope: any = { ...budgetScope(organizationId), _id: new mongoose.Types.ObjectId(id) }
  const current: any = await Budget.findOne(scope).lean()
  if (!current) fail(404, 'Budget not found')
  const settings = await companySettings(organizationId)
  const set: any = {}, unset: any = {}
  if (body.name !== undefined) set.name = text(body.name, 'Name', 200, true)
  if (body.amount !== undefined) { set.amount = money(body.amount, 'amount'); if (set.amount <= 0) fail(400, 'Amount must be greater than zero') }
  if (body.currency !== undefined) set.currency = currencyCode(body.currency)
  if (body.period !== undefined) { if (typeof body.period !== 'string' || !BUDGET_PERIODS.includes(body.period)) fail(400, 'Invalid budget period'); set.period = body.period }
  if (body.alertThreshold !== undefined) set.alertThreshold = threshold(body.alertThreshold)
  if (body.isActive !== undefined) set.isActive = bool(body.isActive, 'active flag')
  if (body.category !== undefined) { const category = text(body.category, 'Category', 100); if (category) set.category = category; else unset.category = '' }
  if (body.startDate !== undefined && body.startDate !== null && body.startDate !== '') set.startDate = parseDateOnly(body.startDate, settings.timeZone, 'start date')
  if (body.endDate !== undefined) { if (body.endDate === null || body.endDate === '') unset.endDate = ''; else set.endDate = parseDateOnly(body.endDate, settings.timeZone, 'end date') }
  const start = set.startDate || current.startDate, end = unset.endDate !== undefined ? undefined : set.endDate || current.endDate
  if (start && end && end < start) fail(400, 'End date must not be before start date')
  if (operation.expectedUpdatedAt !== undefined) {
    if (!Number.isFinite(Date.parse(operation.expectedUpdatedAt))) fail(400, 'Read the current budget before editing')
    scope.updatedAt = new Date(operation.expectedUpdatedAt)
  }
  if (operation.naviOperation) set.naviOperation = operation.naviOperation
  const update: any = {}
  if (Object.keys(set).length) update.$set = set
  if (Object.keys(unset).length) update.$unset = unset
  if (!Object.keys(update).length) return publicRecord(current)
  try {
    const budget = await Budget.findOneAndUpdate(scope, update, { new: true, runValidators: true }).lean()
    if (!budget) fail(operation.expectedUpdatedAt !== undefined ? 409 : 404, operation.expectedUpdatedAt !== undefined ? 'Budget changed; read it again' : 'Budget not found')
    return publicRecord(budget)
  } catch (error: any) {
    if (error?.name === 'ValidationError' || error?.name === 'CastError') fail(400, 'Invalid budget')
    throw error
  }
}

export async function deleteCompanyBudget(organizationId: mongoose.Types.ObjectId, id: string, operation: BudgetOperation = {}) {
  requireCompany(organizationId)
  await ensureConnection()
  if (!mongoose.isValidObjectId(id)) fail(404, 'Budget not found')
  const scope: any = { ...budgetScope(organizationId), _id: new mongoose.Types.ObjectId(id) }
  if (operation.expectedUpdatedAt !== undefined) scope.updatedAt = new Date(operation.expectedUpdatedAt)
  const deleted = await Budget.findOneAndDelete(scope).lean()
  if (!deleted) fail(404, 'Budget not found')
  return publicRecord(deleted)
}

// ---- Spending
type Group = { count: number, amount: number }
const add = (group: Group, count: number, amount: number) => { group.count += count; group.amount += amount }
const round = (value: number) => Math.round(value * 100) / 100

export async function budgetSpending(organizationId: mongoose.Types.ObjectId, budget: any, timeZone: string, now = new Date()) {
  requireCompany(organizationId)
  const period = BUDGET_PERIODS.includes(budget.period) ? budget.period : 'monthly'
  const [year, month] = localDateKey(now, timeZone).split('-').map(Number)
  const firstMonth = period === 'yearly' ? 0 : period === 'quarterly' ? Math.floor((month - 1) / 3) * 3 : month - 1
  const lastMonth = period === 'yearly' ? 11 : period === 'quarterly' ? firstMonth + 2 : month - 1
  const periodRange = { start: dateKey(new Date(Date.UTC(year, firstMonth, 1))), end: dateKey(new Date(Date.UTC(year, lastMonth, clampDay(year, lastMonth, 31)))) }
  const budgetStart = budget.startDate ? dateKey(new Date(budget.startDate)) : periodRange.start
  const budgetEnd = budget.endDate ? dateKey(new Date(budget.endDate)) : periodRange.end
  const start = budgetStart > periodRange.start ? budgetStart : periodRange.start
  const end = budgetEnd < periodRange.end ? budgetEnd : periodRange.end
  const currency = typeof budget.currency === 'string' && /^[A-Z]{3}$/.test(budget.currency) ? budget.currency : null
  const category = typeof budget.category === 'string' && budget.category ? budget.category : null
  const periodStart = zonedDayStart(periodRange.start, timeZone), periodEnd = new Date(zonedDayStart(addDays(periodRange.end, 1), timeZone).getTime() - 1)
  const spending: any = {
    basis: 'completed_expense', timezone: timeZone, periodLabel: `calendar_${period === 'monthly' ? 'month' : period === 'quarterly' ? 'quarter' : 'year'}`,
    range: start <= end ? { start, end } : null, outsideBudgetDates: start > end,
    categoryMatch: category ? 'category_text' : 'all_expenses',
    pendingForecast: { count: 0, amount: 0 }, otherCurrencies: [] as any[], unknownCurrency: { count: 0, amount: 0 },
    negative: { count: 0, amount: 0 }, unclassified: category ? { count: 0 } : null, complete: !!currency
  }
  const totals = { completed: { count: 0, amount: 0 } }
  if (start <= end) {
    const match: any = { ...spendingScope(organizationId), status: { $in: ['completed', 'pending'] }, date: { $gte: zonedDayStart(start, timeZone), $lt: zonedDayStart(addDays(end, 1), timeZone) } }
    const matched = category ? { $or: [{ $eq: ['$category', category] }, { $eq: ['$metadata.category', category] }] } : { $literal: true }
    const classified = { $or: [{ $and: [{ $eq: [{ $type: '$category' }, 'string'] }, { $ne: ['$category', ''] }] }, { $and: [{ $eq: [{ $type: '$metadata.category' }, 'string'] }, { $ne: ['$metadata.category', ''] }] }] }
    const rows: any[] = await Transaction.aggregate([
      { $match: match },
      { $group: {
        _id: { status: '$status', currency: { $ifNull: ['$currency', '$metadata.currency'] }, matched, classified },
        count: { $sum: 1 }, amount: { $sum: { $cond: [{ $isNumber: '$amount' }, '$amount', 0] } },
        negativeCount: { $sum: { $cond: [{ $and: [{ $isNumber: '$amount' }, { $lt: ['$amount', 0] }] }, 1, 0] } },
        negativeAmount: { $sum: { $cond: [{ $and: [{ $isNumber: '$amount' }, { $lt: ['$amount', 0] }] }, '$amount', 0] } }
      } }
    ])
    const others = new Map<string, Group>()
    for (const row of rows) {
      const raw = row._id.currency
      const code = typeof raw === 'string' && /^[A-Za-z]{3}$/.test(raw.trim()) ? raw.trim().toUpperCase() : null
      if (category && row._id.status === 'completed' && !row._id.classified) spending.unclassified.count += row.count
      if (!row._id.matched) continue
      if (row._id.status === 'pending') { if (code && code === currency) add(spending.pendingForecast, row.count, row.amount); continue }
      if (!code) { add(spending.unknownCurrency, row.count, row.amount); continue }
      if (code !== currency) { const group = others.get(code) || { count: 0, amount: 0 }; add(group, row.count, row.amount); others.set(code, group); continue }
      add(totals.completed, row.count, row.amount)
      add(spending.negative, row.negativeCount, row.negativeAmount)
    }
    spending.otherCurrencies = [...others.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, group]) => ({ currency: code, count: group.count, amount: round(group.amount) }))
    if (spending.unknownCurrency.count) spending.complete = false
  }
  for (const group of [spending.pendingForecast, spending.unknownCurrency, spending.negative]) group.amount = round(group.amount)
  const spent = round(totals.completed.amount)
  const amount = Number(budget.amount) || 0
  const percentage = amount > 0 ? Math.round((spent / amount) * 100) : 0
  const isOverBudget = spent > amount
  return {
    currency, spent, remaining: round(amount - spent), percentage, isOverBudget,
    isNearLimit: percentage >= (budget.alertThreshold ?? 80) && !isOverBudget,
    periodStart, periodEnd, transactionCount: totals.completed.count, spending
  }
}
