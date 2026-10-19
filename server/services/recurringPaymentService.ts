// server/services/recurringPaymentService.ts
// Company recurring payments. Every exported operation requires the trusted company the caller resolved from a fresh
// membership check; nothing reads ownership, creator or the internal Navi marker from a request body. Generation saves a
// PENDING forecast transaction (never a completed/paid actual) whose identity is fixed by company + recurring payment +
// scheduled cycle date, so retries, parallel requests and a crash between the insert and the cycle advance all converge on
// one row. The cycle advances only by compare-and-set on the cycle (and snapshot) that produced the forecast.
import mongoose from 'mongoose'
import { createHash } from 'node:crypto'
import RecurringPayment from '../models/RecurringPayment'
import Transaction from '../models/Transaction'
import { ensureConnection } from '../config/database'
import { createCompanyTransaction } from './transactionService'
import {
  fail, requireCompany, companySettings, localDateKey, parseDateOnly, dateKey, keyDate, addDays, clampDay,
  text, currencyCode, money, publicRecord
} from './companyBudgetService'

const FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']
const STATUSES = ['active', 'paused', 'completed', 'cancelled']
const TRANSACTION_TYPES = ['支出', '入金']
const FORECAST_STATUS = "pending"
const MONTH_STEP: Record<string, number> = { monthly: 1, quarterly: 3, yearly: 12 }

const recurringScope = (organizationId: mongoose.Types.ObjectId) => ({ organizationId })
const dueScope = (organizationId: mongoose.Types.ObjectId, through: Date) => ({ organizationId, status: "active", autoGenerate: true, nextDueDate: { $lte: through } })
const forecastId = (organizationId: mongoose.Types.ObjectId, paymentId: string, cycle: string) => new mongoose.Types.ObjectId(createHash("sha256").update(["omf-recurring-forecast", String(organizationId), paymentId, cycle].join("|")).digest("hex").slice(0, 24))

/** Trusted internal operation data (later Navi adapters). Never read from an HTTP body. */
export type RecurringOperation = { id?: mongoose.Types.ObjectId, naviOperation?: Record<string, unknown>, expectedUpdatedAt?: string }

interface RecurringPaymentFilters {
  status?: unknown
  frequency?: unknown
  search?: unknown
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const output = (row: any) => publicRecord(row)
const plainCurrency = (value: unknown) => typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null
const plainType = (value: unknown) => typeof value === 'string' && TRANSACTION_TYPES.includes(value) ? value : null
const round = (value: number) => Math.round(value * 100) / 100

function objectId(id: string) {
  return mongoose.isValidObjectId(id) && /^[a-f0-9]{24}$/i.test(String(id)) ? new mongoose.Types.ObjectId(id) : null
}

function integerIn(value: unknown, label: string, min: number, max: number) {
  const number = money(value, label)
  if (!Number.isInteger(number) || number < min || number > max) fail(400, `Invalid ${label}`)
  return number
}

function tags(value: unknown) {
  if (!Array.isArray(value) || value.length > 20 || value.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 50)) fail(400, 'Invalid tags')
  return (value as string[]).map(tag => tag.trim())
}

function metadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Invalid metadata')
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > 20 || entries.some(([key, item]) => !/^[A-Za-z0-9_-]{1,40}$/.test(key) || !(item === null || ['string', 'number', 'boolean'].includes(typeof item)) || (typeof item === 'string' && item.length > 500))) fail(400, 'Invalid metadata')
  return Object.fromEntries(entries)
}

function transactionType(value: unknown) {
  if (typeof value !== 'string' || !TRANSACTION_TYPES.includes(value)) fail(400, 'Choose expense (支出) or income (入金)')
  return value
}

/** The first scheduled date on or after the start date that honours dayOfWeek/dayOfMonth. */
function firstDueDate(startKey: string, frequency: string, dayOfMonth?: number, dayOfWeek?: number) {
  if ((frequency === 'weekly' || frequency === 'biweekly') && dayOfWeek !== undefined) {
    const shift = (dayOfWeek - keyDate(startKey).getUTCDay() + 7) % 7
    return addDays(startKey, shift)
  }
  if (MONTH_STEP[frequency] && dayOfMonth !== undefined) {
    const [year, month, day] = startKey.split('-').map(Number)
    if (Math.min(dayOfMonth, clampDay(year, month - 1, 31)) >= day) return dateKey(new Date(Date.UTC(year, month - 1, clampDay(year, month - 1, dayOfMonth))))
    return shiftMonths(startKey, MONTH_STEP[frequency], dayOfMonth)
  }
  return startKey
}

function shiftMonths(key: string, months: number, anchorDay: number) {
  const [year, month] = key.split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  return dateKey(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), clampDay(target.getUTCFullYear(), target.getUTCMonth(), anchorDay))))
}

/** Next cycle from the current cycle. Month-based schedules clamp the anchor day (no Jan 31 -> Mar 3 overflow) and return to it. */
export function nextCycle(key: string, payment: { frequency: string, dayOfMonth?: number, startDate?: Date }) {
  switch (payment.frequency) {
    case 'daily': return addDays(key, 1)
    case 'weekly': return addDays(key, 7)
    case 'biweekly': return addDays(key, 14)
    default: {
      const step = MONTH_STEP[payment.frequency]
      if (!step) fail(409, 'Unknown recurring frequency')
      const anchor = payment.dayOfMonth || (payment.startDate ? new Date(payment.startDate).getUTCDate() : Number(key.slice(8, 10)))
      return shiftMonths(key, step, anchor)
    }
  }
}

function expectedCycle(value: unknown) {
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})(T00:00:00(\.000)?Z)?$/.exec(value.trim())
    if (match && dateKey(keyDate(match[1])) === match[1]) return match[1]
  }
  fail(400, 'Read the current recurring payment and send its nextDueDate as expectedNextDueDate')
}

/** Validated create/update values. `partial` reads only fields present in the body. */
function recurringValues(body: any, timeZone: string, partial: boolean) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Invalid recurring payment')
  const set: any = {}, unset: any = {}
  const has = (key: string) => body[key] !== undefined
  const clearable = (key: string) => body[key] === null || body[key] === ''
  if (!partial || has('name')) set.name = text(body.name, 'Name', 200, true)
  if (!partial || has('amount')) { const amount = money(body.amount, 'amount'); if (amount <= 0) fail(400, 'Amount must be greater than zero'); set.amount = amount }
  if (!partial || has('currency')) { if (!partial && (body.currency === undefined || body.currency === null || body.currency === '')) fail(400, 'Currency is required'); set.currency = currencyCode(body.currency) }
  if (!partial || has('transactionType')) set.transactionType = transactionType(body.transactionType)
  if (!partial || has('frequency')) { if (typeof body.frequency !== 'string' || !FREQUENCIES.includes(body.frequency)) fail(400, `Invalid frequency. Must be one of: ${FREQUENCIES.join(', ')}`); set.frequency = body.frequency }
  for (const [key, min, max] of [['dayOfMonth', 1, 31], ['dayOfWeek', 0, 6]] as const) if (has(key)) { if (clearable(key)) unset[key] = ''; else set[key] = integerIn(body[key], key, min, max) }
  if (!partial || has('startDate')) { if (!partial && (body.startDate === undefined || body.startDate === null || body.startDate === '')) fail(400, 'Start date is required'); if (!clearable('startDate')) set.startDate = parseDateOnly(body.startDate, timeZone, 'start date') }
  if (has('endDate')) { if (clearable('endDate')) unset.endDate = ''; else set.endDate = parseDateOnly(body.endDate, timeZone, 'end date') }
  if (has('nextDueDate') && !clearable('nextDueDate')) set.nextDueDate = parseDateOnly(body.nextDueDate, timeZone, 'next due date')
  if (partial && has('status')) { if (typeof body.status !== 'string' || !STATUSES.includes(body.status)) fail(400, 'Invalid status'); set.status = body.status }
  if (!partial || has('customer')) {
    const customer = body.customer
    if (!customer || typeof customer !== 'object' || Array.isArray(customer)) fail(400, 'Missing required fields: name, amount, frequency, startDate, customer.name')
    if (!partial || customer.name !== undefined) set['customer.name'] = text(customer.name, 'Customer name', 200, true)
    for (const key of ['email', 'id']) if (customer[key] !== undefined) { const value = text(customer[key], 'Customer ' + key, 200); if (value) set['customer.' + key] = value; else unset['customer.' + key] = '' }
  }
  for (const [key, max] of [['description', 2000], ['category', 100], ['notes', 2000], ['source', 50]] as const) if (has(key)) { const value = text(body[key], key, max); if (value) set[key] = value; else unset[key] = '' }
  if (has('tags')) { if (clearable('tags')) unset.tags = ''; else set.tags = tags(body.tags) }
  if (has('metadata')) { if (clearable('metadata')) unset.metadata = ''; else set.metadata = metadata(body.metadata) }
  if (!partial || has('autoGenerate')) { if (body.autoGenerate === undefined) set.autoGenerate = true; else if (typeof body.autoGenerate !== 'boolean') fail(400, 'Invalid autoGenerate'); else set.autoGenerate = body.autoGenerate }
  return { set, unset }
}

const nested = (set: any) => {
  const values: any = {}
  for (const [key, value] of Object.entries(set)) {
    if (key.startsWith('customer.')) (values.customer ||= {})[key.slice(9)] = value
    else values[key] = value
  }
  return values
}

/**
 * Get the company's recurring payments with optional filtering
 */
export async function getRecurringPayments(organizationId: mongoose.Types.ObjectId, filters: RecurringPaymentFilters = {}) {
  requireCompany(organizationId)
  await ensureConnection()
  const query: any = recurringScope(organizationId)
  if (filters.status !== undefined && filters.status !== '') { if (typeof filters.status !== 'string' || !STATUSES.includes(filters.status)) fail(400, 'Invalid status'); query.status = filters.status }
  if (filters.frequency !== undefined && filters.frequency !== '') { if (typeof filters.frequency !== 'string' || !FREQUENCIES.includes(filters.frequency)) fail(400, 'Invalid frequency'); query.frequency = filters.frequency }
  if (filters.search !== undefined && filters.search !== '') {
    if (typeof filters.search !== 'string' || filters.search.length > 100) fail(400, 'Invalid search')
    const literal = { $regex: escapeRegex(filters.search), $options: 'i' }
    query.$or = [{ name: literal }, { 'customer.name': literal }, { description: literal }]
  }
  const payments = await RecurringPayment.find(query).sort({ nextDueDate: 1 }).limit(1000).lean()
  return payments.map(output)
}

/**
 * Get one recurring payment of the company by ID (null when absent, foreign or unassigned)
 */
export async function getRecurringPaymentById(organizationId: mongoose.Types.ObjectId, id: string) {
  requireCompany(organizationId)
  await ensureConnection()
  const _id = objectId(id)
  if (!_id) return null
  return output(await RecurringPayment.findOne({ ...recurringScope(organizationId), _id }).lean())
}

/**
 * Create a company recurring payment; company and creator come only from the trusted caller.
 */
export async function createRecurringPayment(organizationId: mongoose.Types.ObjectId, createdBy: string, body: any, operation: RecurringOperation = {}) {
  requireCompany(organizationId)
  if (!mongoose.isValidObjectId(createdBy)) throw new Error('A trusted creator is required')
  await ensureConnection()
  const { timeZone } = await companySettings(organizationId)
  const { set } = recurringValues(body, timeZone, false)
  const values = nested(set)
  if (values.endDate && values.endDate < values.startDate) fail(400, 'End date must not be before start date')
  values.nextDueDate ||= keyDate(firstDueDate(dateKey(values.startDate), values.frequency, values.dayOfMonth, values.dayOfWeek))
  values.source ||= 'manual'
  values.status = 'active'
  values.generatedTransactionIds = []
  if (operation.id) values._id = operation.id
  if (operation.naviOperation) values.naviOperation = operation.naviOperation
  try {
    const payment = new RecurringPayment(values)
    payment.set('organizationId', organizationId, { strict: false })
    payment.set('createdBy', new mongoose.Types.ObjectId(createdBy), { strict: false })
    await payment.save()
    return output(payment.toObject({ virtuals: false, transform: false }))
  } catch (error: any) {
    if (error?.name === 'ValidationError' || error?.name === 'CastError') fail(400, 'Invalid recurring payment')
    if (error?.code === 11000 && operation.id) {
      const existing = await RecurringPayment.findOne({ ...recurringScope(organizationId), _id: operation.id }).lean()
      if (existing) return output(existing)
    }
    throw error
  }
}

/**
 * Partially update a company recurring payment (whitelisted fields only).
 */
export async function updateRecurringPayment(organizationId: mongoose.Types.ObjectId, id: string, body: any, operation: RecurringOperation = {}) {
  requireCompany(organizationId)
  await ensureConnection()
  const _id = objectId(id)
  if (!_id) fail(404, `Recurring payment ${id} not found`)
  const scope: any = { ...recurringScope(organizationId), _id }
  const current: any = await RecurringPayment.findOne(scope).lean()
  if (!current) fail(404, `Recurring payment ${id} not found`)
  const { timeZone } = await companySettings(organizationId)
  const { set, unset } = recurringValues(body, timeZone, true)
  const start = set.startDate || current.startDate, end = unset.endDate !== undefined ? undefined : set.endDate || current.endDate
  if (start && end && end < start) fail(400, 'End date must not be before start date')
  if (operation.expectedUpdatedAt !== undefined) {
    if (!Number.isFinite(Date.parse(operation.expectedUpdatedAt))) fail(400, 'Read the current recurring payment before editing')
    scope.updatedAt = new Date(operation.expectedUpdatedAt)
  }
  if (operation.naviOperation) set.naviOperation = operation.naviOperation
  const update: any = {}
  if (Object.keys(set).length) update.$set = set
  if (Object.keys(unset).length) update.$unset = unset
  if (!Object.keys(update).length) return output(current)
  try {
    const payment = await RecurringPayment.findOneAndUpdate(scope, update, { new: true, runValidators: true }).lean()
    if (!payment) fail(operation.expectedUpdatedAt !== undefined ? 409 : 404, operation.expectedUpdatedAt !== undefined ? 'Recurring payment changed; read it again' : `Recurring payment ${id} not found`)
    return output(payment)
  } catch (error: any) {
    if (error?.name === 'ValidationError' || error?.name === 'CastError') fail(400, 'Invalid recurring payment')
    throw error
  }
}

/**
 * Delete a company recurring payment. Forecasts it already saved stay as ordinary company transactions.
 */
export async function deleteRecurringPayment(organizationId: mongoose.Types.ObjectId, id: string, operation: RecurringOperation = {}) {
  requireCompany(organizationId)
  await ensureConnection()
  const _id = objectId(id)
  if (!_id) fail(404, `Recurring payment ${id} not found`)
  const scope: any = { ...recurringScope(organizationId), _id }
  if (operation.expectedUpdatedAt !== undefined) scope.updatedAt = new Date(operation.expectedUpdatedAt)
  const payment = await RecurringPayment.findOneAndDelete(scope).lean()
  if (!payment) fail(404, `Recurring payment ${id} not found`)
  return output(payment)
}

type GenerateIntent = { expectedNextDueDate: unknown, expectedUpdatedAt?: Date, automatic?: boolean, now?: Date }

async function existingForecast(organizationId: mongoose.Types.ObjectId, paymentId: string, cycle: string) {
  const forecast: any = await Transaction.findOne({ _id: forecastId(organizationId, paymentId, cycle) }).lean()
  if (!forecast) return null
  // The same identity must belong to this company, this recurring payment and this cycle; anything else is never adopted.
  if (String(forecast.organizationId) !== String(organizationId) || forecast.metadata?.recurringPaymentId !== paymentId || forecast.metadata?.recurringCycle !== cycle) fail(409, 'A different transaction holds this recurring cycle; review it before generating')
  return forecast
}

/**
 * Save the pending forecast for exactly the cycle the caller read (expectedNextDueDate) and advance to the next cycle.
 */
export async function generateTransaction(organizationId: mongoose.Types.ObjectId, paymentId: string, intent: GenerateIntent) {
  requireCompany(organizationId)
  await ensureConnection()
  const _id = objectId(paymentId)
  if (!_id) fail(404, `Recurring payment ${paymentId} not found`)
  const id = String(_id)
  const payment: any = await RecurringPayment.findOne({ ...recurringScope(organizationId), _id }).lean()
  if (!payment) fail(404, `Recurring payment ${paymentId} not found`)
  const cycle = expectedCycle(intent.expectedNextDueDate)
  const current = dateKey(new Date(payment.nextDueDate))
  if (current !== cycle) {
    // An already-advanced cycle returns the forecast it produced; an unknown/changed intent is refused.
    const forecast = await existingForecast(organizationId, id, cycle)
    if (!forecast) fail(409, 'Recurring payment changed; read it again')
    return { transaction: forecast, existing: true, cycle, nextDueDate: payment.nextDueDate, status: payment.status }
  }
  if (payment.status !== 'active') fail(400, `Recurring payment ${paymentId} is not active`)
  if (intent.automatic && payment.autoGenerate !== true) fail(409, 'Automatic generation is off for this recurring payment')
  if (intent.expectedUpdatedAt && new Date(payment.updatedAt).getTime() !== intent.expectedUpdatedAt.getTime()) fail(409, 'Recurring payment changed; read it again')
  if (payment.endDate && cycle > dateKey(new Date(payment.endDate))) fail(409, 'Recurring payment period has ended')
  const { timeZone } = await companySettings(organizationId)
  if (intent.automatic && cycle > localDateKey(intent.now || new Date(), timeZone)) fail(409, 'This cycle is not due yet')
  const type = plainType(payment.transactionType), currency = plainCurrency(payment.currency)
  if (!type) fail(409, 'Choose expense or income for this recurring payment before generating')
  if (!currency) fail(409, 'Choose the currency for this recurring payment before generating')

  let forecast: any = await existingForecast(organizationId, id, cycle), existing = !!forecast
  if (!forecast) {
    try {
      forecast = await createCompanyTransaction({
        _id: forecastId(organizationId, id, cycle),
        referenceNumber: `REC-${cycle.replace(/-/g, '')}-${id.slice(-6)}`,
        date: new Date(`${cycle}T12:00:00.000Z`),
        amount: payment.amount,
        type,
        status: FORECAST_STATUS,
        hasReceipt: false,
        notes: `定期支払いの予定（未払い・未確定）: ${payment.name}`,
        tags: [...(Array.isArray(payment.tags) ? payment.tags : []), 'recurring', 'forecast'],
        metadata: {
          recurringPaymentId: id, recurringPaymentName: payment.name, recurringCycle: cycle, recurringForecast: true,
          currency, ...(payment.category ? { category: payment.category } : {}), ...(payment.customer?.name ? { payee: payment.customer.name } : {})
        }
      } as any, organizationId)
    } catch (error: any) {
      if (error?.code !== 11000) throw error
      forecast = await existingForecast(organizationId, id, cycle)
      if (!forecast) throw error
      existing = true
    }
  }

  const next = nextCycle(cycle, payment)
  const status = payment.endDate && next > dateKey(new Date(payment.endDate)) ? 'completed' : 'active'
  const advanceScope = { ...recurringScope(organizationId), _id, nextDueDate: payment.nextDueDate, status: 'active', updatedAt: payment.updatedAt, ...(intent.automatic ? { autoGenerate: true } : {}) }
  const advanced: any = await RecurringPayment.findOneAndUpdate(advanceScope, { $set: { lastGeneratedDate: new Date(), nextDueDate: keyDate(next), status }, $addToSet: { generatedTransactionIds: forecast._id } }, { new: true }).lean()
  if (!advanced) {
    // Another request advanced the same cycle with the same forecast, or the payment changed: never skip a cycle.
    const latest: any = await RecurringPayment.findOne({ ...recurringScope(organizationId), _id }).lean()
    const moved = latest && dateKey(new Date(latest.nextDueDate)) !== cycle && (latest.generatedTransactionIds || []).some((value: any) => String(value) === String(forecast._id))
    if (!moved) fail(409, 'Recurring payment changed; read it again')
    return { transaction: forecast, existing, cycle, nextDueDate: latest.nextDueDate, status: latest.status }
  }
  return { transaction: forecast, existing, cycle, nextDueDate: advanced.nextDueDate, status: advanced.status }
}

/**
 * Process the selected company's due recurring payments: one cycle per due autoGenerate=true row per call.
 */
export async function processDuePayments(organizationId: mongoose.Types.ObjectId, now = new Date()) {
  requireCompany(organizationId)
  await ensureConnection()
  const { timeZone } = await companySettings(organizationId)
  const today = localDateKey(now, timeZone)
  const due: any[] = await RecurringPayment.find(dueScope(organizationId, keyDate(today))).sort({ nextDueDate: 1 }).limit(200).lean()
  const results = { processed: 0, succeeded: 0, existing: 0, failed: 0, transactions: [] as any[], failures: [] as any[], through: today }
  for (const snapshot of due) {
    results.processed++
    try {
      const result = await generateTransaction(organizationId, String(snapshot._id), { expectedNextDueDate: dateKey(new Date(snapshot.nextDueDate)), expectedUpdatedAt: new Date(snapshot.updatedAt), automatic: true, now })
      results.succeeded++
      if (result.existing) results.existing++
      results.transactions.push({ paymentId: String(snapshot._id), paymentName: snapshot.name, transactionId: String(result.transaction._id), cycle: result.cycle, existing: result.existing })
    } catch (error: any) {
      results.failed++
      const statusCode = error?.statusCode && error.statusCode < 500 ? error.statusCode : 500
      if (statusCode === 500) console.error('Company recurring payment processing failed')
      results.failures.push({ paymentId: String(snapshot._id), statusCode, reason: statusCode === 500 ? 'Failed to generate the forecast' : error.statusMessage })
    }
  }
  return results
}

function currencyGroups(rows: any[], amountOf: (row: any) => number) {
  const groups = new Map<string, { currency: string | null, transactionType: string | null, count: number, amount: number }>()
  for (const row of rows) {
    const currency = plainCurrency(row.currency), type = plainType(row.transactionType), key = `${currency}|${type}`
    const group = groups.get(key) || { currency, transactionType: type, count: 0, amount: 0 }
    group.count++
    group.amount += amountOf(row)
    groups.set(key, group)
  }
  return [...groups.values()].map(group => ({ ...group, amount: round(group.amount) })).sort((a, b) => `${a.currency}|${a.transactionType}`.localeCompare(`${b.currency}|${b.transactionType}`))
}

/** A single compatibility number only when every row shares one established currency and transaction type. */
function single(groups: ReturnType<typeof currencyGroups>) {
  return groups.length === 1 && groups[0].currency && groups[0].transactionType ? { amount: groups[0].amount, currency: groups[0].currency } : { amount: null, currency: null }
}

/**
 * Upcoming company payments within the next `days` days of the company's local today, grouped by saved currency/type.
 */
export async function getUpcomingPayments(organizationId: mongoose.Types.ObjectId, days: number = 30, now = new Date()) {
  requireCompany(organizationId)
  await ensureConnection()
  const { timeZone } = await companySettings(organizationId)
  const through = addDays(localDateKey(now, timeZone), days)
  const rows: any[] = await RecurringPayment.find({ ...recurringScope(organizationId), status: 'active', nextDueDate: { $lte: keyDate(through) } }).sort({ nextDueDate: 1 }).limit(500).lean()
  const upcoming = rows.filter(row => !row.endDate || new Date(row.nextDueDate) <= new Date(row.endDate))
  const totals = currencyGroups(upcoming, row => Number(row.amount) || 0), compatible = single(totals)
  return { payments: upcoming.map(output), count: upcoming.length, totals, totalAmount: compatible.amount, currency: compatible.currency, days, through }
}

const MONTHLY_FACTOR: Record<string, number> = { daily: 30, weekly: 4.33, biweekly: 2.17, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }

/**
 * Company recurring statistics; monthly estimates are grouped by saved currency and transaction type.
 */
export async function getRecurringPaymentStats(organizationId: mongoose.Types.ObjectId) {
  requireCompany(organizationId)
  await ensureConnection()
  const rows: any[] = await RecurringPayment.find(recurringScope(organizationId)).select('status frequency amount currency transactionType').limit(5000).lean()
  const count = (status: string) => rows.filter(row => row.status === status).length
  const active = rows.filter(row => row.status === 'active')
  const monthlyEstimates = currencyGroups(active, row => (Number(row.amount) || 0) * (MONTHLY_FACTOR[row.frequency] || 0)), compatible = single(monthlyEstimates)
  const byFrequency: Record<string, any> = {}
  for (const frequency of FREQUENCIES) {
    const rowsOf = active.filter(row => row.frequency === frequency)
    if (rowsOf.length) byFrequency[frequency] = { count: rowsOf.length, byCurrency: currencyGroups(rowsOf, row => Number(row.amount) || 0) }
  }
  return {
    total: rows.length,
    active: active.length,
    paused: count('paused'),
    completed: count('completed'),
    cancelled: count('cancelled'),
    activeMonthlyAmount: compatible.amount,
    currency: compatible.currency,
    monthlyEstimates,
    byFrequency
  }
}
