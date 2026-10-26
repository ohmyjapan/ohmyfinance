// The transaction export recipe on the server: the company's saved time zone, the export window (a real date key is a whole local day
// of that zone, dateTo inclusive to its last millisecond; any other string keeps its new Date(value) instant meaning), the shared
// getTransactions query and the page's search predicate applied in memory. Used by the export route and by the Navi
// prepare_company_transaction_export adapter, which only counts. The row mapping and the CSV text stay in the route.
import mongoose from 'mongoose'
import Organization from '../models/Organization'
import { getTransactions } from './transactionService'
import { ensureConnection } from '../config/database'
import { validTimeZone, isRealDateKey, zonedDayStart, addDayKey } from '../../shared/finance-navi-business.mjs'
import { exportSearchMatches } from '../../shared/finance-transaction-export.mjs'
import type { TransactionExportCriteria } from '../../shared/finance-transaction-export.mjs'

const DEFAULT_ZONE = 'Asia/Tokyo'
type Edge = Date | string | null
const instant = (v: Edge) => v === null ? null : v instanceof Date ? v.toISOString() : v

/** The company's saved time zone or Asia/Tokyo, read the same way as companyNaviSummaryService reads it. */
export async function exportTimeZone(organizationId: mongoose.Types.ObjectId | string) {
  await ensureConnection()
  const row: any = await Organization.findOne({ _id: organizationId }).select('settings.timezone').lean()
  const saved = validTimeZone(row?.settings?.timezone)
  return { timeZone: saved || DEFAULT_ZONE, timeZoneEvidence: saved ? 'saved' : 'not_saved_default_Asia/Tokyo' }
}

/** A real date key resolves to the whole local day in timeZone; any other date string keeps the legacy instant meaning. */
export function exportWindow(criteria: TransactionExportCriteria, timeZone: string): { start: Edge, end: Edge } {
  const start: Edge = !criteria.dateFrom ? null : isRealDateKey(criteria.dateFrom) ? zonedDayStart(criteria.dateFrom, timeZone) : criteria.dateFrom
  const end: Edge = !criteria.dateTo ? null : isRealDateKey(criteria.dateTo) ? new Date(zonedDayStart(addDayKey(criteria.dateTo, 1), timeZone).getTime() - 1) : criteria.dateTo
  return { start, end }
}

/** The matching transactions of the frozen company for the criteria, with the resolved window. */
export async function exportTransactionRows(organizationId: mongoose.Types.ObjectId, criteria: TransactionExportCriteria) {
  const zone = await exportTimeZone(organizationId)
  const window = exportWindow(criteria, zone.timeZone)
  const filters: Record<string, any> = {}
  if (criteria.status) filters.status = criteria.status
  if (criteria.type) filters.type = criteria.type
  if (window.start) filters.dateFrom = instant(window.start)
  if (window.end) filters.dateTo = instant(window.end)
  if (criteria.minAmount !== undefined) filters.minAmount = criteria.minAmount
  if (criteria.maxAmount !== undefined) filters.maxAmount = criteria.maxAmount
  if (criteria.supplierId) filters.supplierId = criteria.supplierId
  if (criteria.customerId) filters.customerId = criteria.customerId
  if (criteria.accountCategoryId) filters.accountCategoryId = criteria.accountCategoryId
  if (criteria.transactionCategoryId) filters.transactionCategoryId = criteria.transactionCategoryId
  if (criteria.hasReceipt !== undefined) filters.hasReceipt = criteria.hasReceipt
  let transactions: any[] = await getTransactions(filters, organizationId)
  // The page's predicate in memory: the shared getTransactions search (a regex over other fields) is deliberately not used.
  if (criteria.search) transactions = transactions.filter((row) => exportSearchMatches(row, criteria.search))
  return { transactions, window: { start: instant(window.start), end: instant(window.end), timeZone: zone.timeZone, timeZoneEvidence: zone.timeZoneEvidence } }
}
