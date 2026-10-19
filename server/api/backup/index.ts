// server/api/backup/index.ts
import { defineEventHandler, getQuery, setHeader, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Transaction from '../../models/Transaction'
import Receipt from '../../models/Receipt'
import RecurringPayment from '../../models/RecurringPayment'
import { calendarCompany } from '../../utils/calendarAccess'
import { backupExclusions, backupScope } from '../../services/companyBackupService'

/**
 * GET /api/backup - Back up the token-selected company (fresh membership): its recorded transactions, receipts and recurring
 * payments only, in the legacy format with a scope block. Unassigned rows and shared mapping templates are never included.
 */
export default defineEventHandler(async (event) => {
  const { organizationId } = await calendarCompany(event)
  try {
    await ensureConnection()

    const query = getQuery(event)
    const format = String(query.format || 'json').toLowerCase()
    const includeReceipts = query.receipts !== 'false'
    const includeTransactions = query.transactions !== 'false'
    const includeRecurring = query.recurring !== 'false'

    // Fetch the selected company's data
    const backupData: Record<string, any> = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      application: 'ohmyfinance',
      scope: backupScope(organizationId),
      excluded: { ...backupExclusions }
    }

    if (includeTransactions) {
      const transactions = await Transaction.find({ organizationId }).lean()
      backupData.transactions = transactions.map(cleanDocument)
    }

    if (includeReceipts) {
      const receipts = await Receipt.find({ organizationId }).lean()
      backupData.receipts = receipts.map(cleanDocument)
    }

    if (includeRecurring) {
      const recurring = await RecurringPayment.find({ organizationId }).lean()
      backupData.recurringPayments = recurring.map(cleanDocument)
    }

    // Add counts for reference
    backupData.counts = {
      transactions: backupData.transactions?.length || 0,
      receipts: backupData.receipts?.length || 0,
      recurringPayments: backupData.recurringPayments?.length || 0,
      mappingTemplates: 0
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

    if (format === 'download' || format === 'file') {
      setHeader(event, 'Content-Type', 'application/json')
      setHeader(event, 'Content-Disposition', `attachment; filename="ohmyfinance_backup_${timestamp}.json"`)
    } else {
      setHeader(event, 'Content-Type', 'application/json')
    }

    return JSON.stringify(backupData, null, 2)
  } catch (error: any) {
    if (error?.statusCode) throw error
    console.error('Company backup export failed')
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to create backup'
    })
  }
})

/**
 * Clean MongoDB document for export
 */
function cleanDocument(doc: any): any {
  const cleaned = { ...doc }

  // Convert ObjectId to string
  if (cleaned._id) {
    cleaned.id = cleaned._id.toString()
    delete cleaned._id
  }

  // Remove __v
  delete cleaned.__v

  // Convert nested ObjectIds
  if (cleaned.transactionId && typeof cleaned.transactionId === 'object') {
    cleaned.transactionId = cleaned.transactionId.toString()
  }

  if (Array.isArray(cleaned.generatedTransactionIds)) {
    cleaned.generatedTransactionIds = cleaned.generatedTransactionIds.map(
      (id: any) => typeof id === 'object' ? id.toString() : id
    )
  }

  return cleaned
}
