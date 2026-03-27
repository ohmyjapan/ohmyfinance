// server/api/backup/index.ts
import { defineEventHandler, getQuery, setHeader, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Transaction from '../../models/Transaction'
import Receipt from '../../models/Receipt'
import RecurringPayment from '../../models/RecurringPayment'
import { MappingTemplate } from '../../models/MappingTemplate'
import { requireAuth } from '../../middleware/auth'

/**
 * GET /api/backup - Create a full backup of all data
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  try {
    await ensureConnection()

    const query = getQuery(event)
    const format = String(query.format || 'json').toLowerCase()
    const includeReceipts = query.receipts !== 'false'
    const includeTransactions = query.transactions !== 'false'
    const includeRecurring = query.recurring !== 'false'
    const includeTemplates = query.templates !== 'false'

    // Fetch all data
    const backupData: Record<string, any> = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      application: 'ohmyfinance'
    }

    if (includeTransactions) {
      const transactions = await Transaction.find({}).lean()
      backupData.transactions = transactions.map(cleanDocument)
    }

    if (includeReceipts) {
      const receipts = await Receipt.find({}).lean()
      backupData.receipts = receipts.map(cleanDocument)
    }

    if (includeRecurring) {
      const recurring = await RecurringPayment.find({}).lean()
      backupData.recurringPayments = recurring.map(cleanDocument)
    }

    if (includeTemplates) {
      const templates = await MappingTemplate.find({}).lean()
      backupData.mappingTemplates = templates.map(cleanDocument)
    }

    // Add counts for reference
    backupData.counts = {
      transactions: backupData.transactions?.length || 0,
      receipts: backupData.receipts?.length || 0,
      recurringPayments: backupData.recurringPayments?.length || 0,
      mappingTemplates: backupData.mappingTemplates?.length || 0
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
    console.error('Backup error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to create backup'
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
