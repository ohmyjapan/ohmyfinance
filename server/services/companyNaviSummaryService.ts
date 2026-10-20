// Company Navi read adapters for business facts: the company's saved profile, a bounded saved-record summary for an explicit local
// date range, receipt metadata and the server clock. Every query is bound to the trusted company of the frozen job. Results are saved
// facts and explicit unknowns only: no members, keys, credentials, files, paths, raw OCR, contacts or live bank claims.
import mongoose from 'mongoose'
import { createError } from 'h3'
import Organization from '../models/Organization'
import Transaction from '../models/Transaction'
import Invoice from '../models/Invoice'
import Receipt from '../models/Receipt'
import { Payment } from '../models/Payment'
import { ensureConnection } from '../config/database'
import { findCompanyMatchesForReceipt } from './receiptService'
import { getCompanyNaviTransaction } from './companyTransactionAssistantService'
import { validTimeZone, localBusinessDate, zonedRange, fiscalYearFor, currencyCode, isRealDateKey, zonedDayStart, addDayKey } from '../../shared/finance-navi-business.mjs'

const DEFAULT_ZONE = 'Asia/Tokyo'
const summaryScope = (organizationId: mongoose.Types.ObjectId) => ({ organizationId })
const summaryCurrency = (raw: unknown) => currencyCode(raw)
const bad = (statusCode: number, statusMessage: string): never => { throw createError({ statusCode, statusMessage }) }
const round = (value: number) => Math.round(value * 100) / 100

async function settings(organizationId: mongoose.Types.ObjectId) {
  const row: any = await Organization.findOne({ _id: organizationId }).select('name type address taxId settings.defaultCurrency settings.fiscalYearStart settings.timezone').lean()
  if (!row) bad(404, 'Company not found')
  const saved = validTimeZone(row.settings?.timezone)
  const fiscal = Number.isSafeInteger(row.settings?.fiscalYearStart) && row.settings.fiscalYearStart >= 1 && row.settings.fiscalYearStart <= 12 ? row.settings.fiscalYearStart : null
  return { row, timeZone: saved || DEFAULT_ZONE, timeZoneEvidence: saved ? 'saved' : 'not_saved_default_Asia/Tokyo', defaultCurrency: currencyCode(row.settings?.defaultCurrency), fiscalYearStart: fiscal }
}

/** Server-captured time with the company's saved zone, so an after-midnight conversation names the local business date. */
export async function companyClock(organizationId: mongoose.Types.ObjectId, now = new Date()) {
  await ensureConnection()
  const s = await settings(organizationId)
  return {
    clock: { capturedAt: now.toISOString(), timeZone: s.timeZone, timeZoneEvidence: s.timeZoneEvidence, localDate: localBusinessDate(now, s.timeZone), meaning: 'capturedAt is a UTC instant; name local days in timeZone. Saved record timestamps are UTC instants too.' },
    companySettings: { defaultCurrency: s.defaultCurrency, fiscalYearStart: s.fiscalYearStart, meaning: 'saved company settings; null means not recorded' }
  }
}

export async function companyProfile(organizationId: mongoose.Types.ObjectId) {
  await ensureConnection()
  const s = await settings(organizationId), a = s.row.address || {}
  return {
    profile: {
      name: s.row.name, type: s.row.type || null,
      address: { line1: a.line1 || '', line2: a.line2 || '', city: a.city || '', state: a.state || '', postalCode: a.postalCode || '', country: a.country || '' },
      taxId: s.row.taxId || '', taxIdEvidence: 'saved_company_profile_not_fresh_NTA_verification',
      defaultCurrency: s.defaultCurrency, fiscalYearStart: s.fiscalYearStart, timezone: validTimeZone(s.row.settings?.timezone), timezoneUsed: s.timeZone, timezoneEvidence: s.timeZoneEvidence
    }
  }
}

const amountOf = { $cond: [{ $isNumber: '$amount' }, '$amount', 0] }
// Saved-record facts for an explicit local date range: groups by actual recorded currency, type and status; mixed currencies are never
// added together and unknown currencies stay a separate, explicit group.
export async function companyFinanceSummary(organizationId: mongoose.Types.ObjectId, args: { dateFrom: string, dateTo: string }) {
  await ensureConnection()
  const s = await settings(organizationId)
  let range: { start: Date, end: Date }
  try { range = zonedRange(args.dateFrom, args.dateTo, s.timeZone) } catch (error: any) { return bad(400, error.message) }
  const window = { $gte: range.start, $lt: range.end }
  const [transactions, invoices, calendar, receipts] = await Promise.all([
    Transaction.aggregate([{ $match: { ...summaryScope(organizationId), date: window } }, { $group: { _id: { currency: { $ifNull: ['$currency', '$metadata.currency'] }, type: '$type', status: '$status' }, count: { $sum: 1 }, amount: { $sum: amountOf }, nonNumeric: { $sum: { $cond: [{ $isNumber: '$amount' }, 0, 1] } }, receiptTrue: { $sum: { $cond: [{ $eq: ['$hasReceipt', true] }, 1, 0] } } } }]),
    Invoice.aggregate([{ $match: { ...summaryScope(organizationId), issueDate: window } }, { $group: { _id: { currency: '$currency', status: '$status' }, count: { $sum: 1 }, total: { $sum: { $cond: [{ $isNumber: '$total' }, '$total', 0] } } } }]),
    Payment.aggregate([{ $match: { ...summaryScope(organizationId), suppressedAt: { $exists: false }, dueDate: window } }, { $group: { _id: { currency: '$currency', type: '$type', status: '$status' }, count: { $sum: 1 }, amount: { $sum: amountOf } } }]),
    Receipt.aggregate([{ $match: { ...summaryScope(organizationId), $or: [{ receiptDate: window }, { receiptDate: { $exists: false }, uploadDate: window }, { receiptDate: null, uploadDate: window }] } }, { $group: { _id: { status: '$status' }, count: { $sum: 1 } } }])
  ])
  const merged = new Map<string, any>()
  for (const row of transactions) {
    const currency = summaryCurrency(row._id.currency), key = JSON.stringify([currency, row._id.type ?? null, row._id.status ?? null])
    const g = merged.get(key) || { currency, type: row._id.type ?? null, status: row._id.status ?? null, count: 0, amount: 0, nonNumericAmounts: 0, receiptFlagTrue: 0 }
    g.count += row.count; g.amount += row.amount; g.nonNumericAmounts += row.nonNumeric; g.receiptFlagTrue += row.receiptTrue; merged.set(key, g)
  }
  const groups = [...merged.values()].map(g => ({ ...g, amount: round(g.amount) })).sort((a, b) => JSON.stringify([a.currency, a.type, a.status]).localeCompare(JSON.stringify([b.currency, b.type, b.status])))
  const byCurrency = new Map<string, any>()
  for (const g of groups) if (g.currency) {
    const c = byCurrency.get(g.currency) || { currency: g.currency, completedExpense: 0, completedIncome: 0, pendingExpense: 0, pendingIncome: 0, otherStatusCount: 0, otherTypeCount: 0 }
    const income = g.type === '入金', expense = g.type === '支出'
    if (!income && !expense) c.otherTypeCount += g.count
    else if (g.status === 'completed') c[income ? 'completedIncome' : 'completedExpense'] = round(c[income ? 'completedIncome' : 'completedExpense'] + g.amount)
    else if (g.status === 'pending') c[income ? 'pendingIncome' : 'pendingExpense'] = round(c[income ? 'pendingIncome' : 'pendingExpense'] + g.amount)
    else c.otherStatusCount += g.count
    byCurrency.set(g.currency, c)
  }
  const unknown = groups.filter(g => !g.currency), count = groups.reduce((n, g) => n + g.count, 0), receiptTrue = groups.reduce((n, g) => n + g.receiptFlagTrue, 0)
  return {
    range: { dateFrom: args.dateFrom, dateTo: args.dateTo, start: range.start.toISOString(), endExclusive: range.end.toISOString() },
    timeZone: s.timeZone, timeZoneEvidence: s.timeZoneEvidence, fiscalYear: fiscalYearFor(args.dateTo, s.fiscalYearStart), fiscalYearEvidence: s.fiscalYearStart ? 'saved_fiscal_year_start' : 'not_recorded',
    transactions: { count, groups, byCurrency: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)), unknownCurrency: { count: unknown.reduce((n, g) => n + g.count, 0), groups: unknown.length }, receiptFlags: { savedTrue: receiptTrue, notRecorded: count - receiptTrue, meaning: 'notRecorded means OMF has no saved receipt flag, not that no receipt exists' } },
    invoices: { groups: invoices.map((r: any) => ({ currency: summaryCurrency(r._id.currency), status: r._id.status ?? null, count: r.count, total: round(r.total) })).sort((a: any, b: any) => JSON.stringify([a.currency, a.status]).localeCompare(JSON.stringify([b.currency, b.status]))), basis: 'issueDate in range; saved status only' },
    calendar: { groups: calendar.map((r: any) => ({ currency: summaryCurrency(r._id.currency), type: r._id.type ?? null, status: r._id.status ?? null, count: r.count, amount: round(r.amount) })).sort((a: any, b: any) => JSON.stringify([a.currency, a.type, a.status]).localeCompare(JSON.stringify([b.currency, b.type, b.status]))), basis: 'dueDate in range; suppressed issuer bills excluded; plans, not payments' },
    receipts: { count: receipts.reduce((n: number, r: any) => n + r.count, 0), byStatus: Object.fromEntries(receipts.map((r: any) => [r._id.status || 'unknown', r.count])), basis: 'receipt date (else upload date) in range; saved documents, not verified purchases' },
    meaning: { source: 'saved_company_records', currencies: 'never added across currencies; currency null is unknown, not JPY', cash: 'Not a bank or cash balance: invoices, calendar plans and saved paid statuses are not bank settlement', tax: 'saved bookkeeping, not a tax determination' }
  }
}

// ---- Receipts: bounded, whitelisted metadata and extracted facts; the link is reported only when it points at this company.
const extracted = (e: any) => e ? { merchant: e.merchant || '', amount: e.amount ?? null, currency: currencyCode(e.currency), date: e.date || null, tax: e.tax ?? null, taxRate: e.taxRate ?? null, subtotal: e.subtotal ?? null, receiptNumber: e.receiptNumber || '', items: (e.items || []).slice(0, 50).map((i: any) => ({ description: String(i.description || '').slice(0, 300), quantity: i.quantity ?? null, unitPrice: i.unitPrice ?? null, totalPrice: i.totalPrice ?? null, tax: i.tax ?? null })), itemsTruncated: (e.items?.length || 0) > 50 } : null
const receiptView = (r: any) => ({ id: String(r._id), merchant: r.merchant || '', receiptDate: r.receiptDate || null, uploadDate: r.uploadDate || null, amount: r.amount ?? null, currency: currencyCode(r.currency), taxAmount: r.taxAmount ?? null, taxRate: r.taxRate ?? null, status: r.status, category: r.category || null, extracted: extracted(r.extractedData), meaning: 'saved receipt and OCR text; not a verified purchase or tax document check' })
async function linked(organizationId: mongoose.Types.ObjectId, r: any) {
  if (!r.transactionId) return { linkedTransactionId: null, linkStatus: 'not_linked' }
  return await Transaction.exists({ _id: r.transactionId, organizationId }) ? { linkedTransactionId: String(r.transactionId), linkStatus: 'linked_to_this_company' } : { linkedTransactionId: null, linkStatus: 'link_not_in_this_company' }
}
export async function listCompanyReceipts(organizationId: mongoose.Types.ObjectId, args: any) {
  await ensureConnection()
  const page = args.page || 1, limit = args.limit || 20, filter: any = { ...summaryScope(organizationId) }
  if (args.status) filter.status = args.status
  if (args.dateFrom || args.dateTo) {
    const { timeZone } = await settings(organizationId), window: any = {}
    if (args.dateFrom) { if (!isRealDateKey(args.dateFrom)) bad(400, 'Invalid date'); window.$gte = zonedDayStart(args.dateFrom, timeZone) }
    if (args.dateTo) { if (!isRealDateKey(args.dateTo)) bad(400, 'Invalid date'); window.$lt = zonedDayStart(addDayKey(args.dateTo, 1), timeZone) }
    filter.$or = [{ receiptDate: window }, { receiptDate: { $in: [null] }, uploadDate: window }]
  }
  const rows: any[] = await Receipt.find(filter).select('merchant receiptDate uploadDate amount currency taxAmount taxRate status category transactionId extractedData.merchant extractedData.amount extractedData.currency extractedData.date extractedData.tax extractedData.taxRate extractedData.subtotal extractedData.receiptNumber extractedData.items').sort({ uploadDate: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1).lean()
  const receipts = []
  for (const r of rows.slice(0, limit)) receipts.push({ ...receiptView(r), ...await linked(organizationId, r) })
  return { receipts, page, limit, hasMore: rows.length > limit }
}
export async function getCompanyReceipt(organizationId: mongoose.Types.ObjectId, receiptId: string) {
  await ensureConnection()
  const r: any = await Receipt.findOne({ ...summaryScope(organizationId), _id: new mongoose.Types.ObjectId(receiptId) }).select('-filePath -fileUrl -thumbnailUrl -extractedData.rawText -extractedData.merchantAddress -extractedData.merchantPhone -metadata -originalFilename -filename').lean()
  if (!r) bad(404, 'Receipt not found')
  return { receipt: { ...receiptView(r), ...await linked(organizationId, r) } }
}

// Use the same bounded, company-filtered candidate lookup as the receipt page. Its scores are heuristics, not probabilities
// or verified purchase links. Read candidate details through the existing company transaction whitelist, including the card's
// saved currency; the native scorer can suggest different-currency and unknown-currency rows, so preserve those facts.
export async function findCompanyReceiptMatches(organizationId: mongoose.Types.ObjectId, receiptId: string) {
  const { receipt } = await getCompanyReceipt(organizationId, receiptId)
  const candidates = await findCompanyMatchesForReceipt(receiptId, organizationId)
  if (!candidates) bad(404, 'Receipt not found')
  const matches = await Promise.all(candidates.map(async (candidate, index) => ({
    rank: index + 1,
    heuristicScore: candidate.confidence,
    factors: candidate.matchFactors,
    transaction: await getCompanyNaviTransaction(organizationId, candidate.transactionId)
  })))
  return {
    receipt, matches,
    search: { source: 'native_company_receipt_candidates', exhaustive: false },
    meaning: 'heuristic_candidates_not_verified_links_or_probability'
  }
}
