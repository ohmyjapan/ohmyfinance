// server/api/backup/restore.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import { restoreTransactionArchive } from '../../services/transactionArchiveService'
import { requireLedgerAccess } from '../../services/ledgerAccessService'
import Receipt from '../../models/Receipt'
import RecurringPayment from '../../models/RecurringPayment'
import { MappingTemplate } from '../../models/MappingTemplate'
import { requireAuth } from '../../middleware/auth'

interface RestoreOptions {
  clearExisting?: boolean
  skipDuplicates?: boolean
  transactions?: boolean
  receipts?: boolean
  recurringPayments?: boolean
  mappingTemplates?: boolean
}

/**
 * POST /api/backup/restore - Restore data from a backup
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  if (event.method !== 'POST') {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method not allowed'
    })
  }

  try {
    await ensureConnection()

    const body = await readBody(event)

    if (!body || !body.data) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Backup data is required in the "data" field'
      })
    }

    const archive = typeof body.data === 'string' ? JSON.parse(body.data) : body.data
    // Scheduled and downloaded archives carry different envelopes.
    const backupData = archive?.data ? { ...archive.data, version: archive.version, application: archive.application, createdAt: archive.createdAt } : archive

    // Validate backup format
    if (!backupData.version || !backupData.application) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid backup format'
      })
    }

    const options: RestoreOptions = {
      clearExisting: body.clearExisting === true,
      skipDuplicates: body.skipDuplicates !== false, // default true
      transactions: body.transactions !== false,
      receipts: body.receipts !== false,
      recurringPayments: body.recurringPayments !== false,
      mappingTemplates: body.mappingTemplates !== false
    }

    const results = {
      transactions: { restored: 0, skipped: 0, failed: 0 },
      receipts: { restored: 0, skipped: 0, failed: 0 },
      recurringPayments: { restored: 0, skipped: 0, failed: 0 },
      mappingTemplates: { restored: 0, skipped: 0, failed: 0 }
    }

    // Transaction identity validation and restoration precede any legacy clears.
    // Existing transaction IDs are retained even when skipDuplicates is false.
    const transactionRestore = options.transactions
      ? await restoreTransactionArchive(await requireLedgerAccess(event, 'write'), backupData.transactions, !!options.clearExisting)
      : null
    if (transactionRestore) results.transactions = transactionRestore

    // Other archive collections retain their existing behavior pending their own audit.
    // Optionally clear existing data
    if (options.clearExisting) {
      if (options.receipts) await Receipt.deleteMany({})
      if (options.recurringPayments) await RecurringPayment.deleteMany({})
      if (options.mappingTemplates) await MappingTemplate.deleteMany({})
    }

    // Restore receipts
    if (options.receipts && backupData.receipts) {
      for (const item of backupData.receipts) {
        try {
          const doc = prepareDocument(item)

          if (options.skipDuplicates && !options.clearExisting) {
            const exists = await Receipt.findOne({
              $or: [
                { filename: doc.filename },
                { _id: item.id || item._id }
              ]
            })
            if (exists) {
              results.receipts.skipped++
              continue
            }
          }

          await Receipt.create(doc)
          results.receipts.restored++
        } catch (error) {
          console.error('Failed to restore receipt:', error)
          results.receipts.failed++
        }
      }
    }

    // Restore recurring payments
    if (options.recurringPayments && backupData.recurringPayments) {
      for (const item of backupData.recurringPayments) {
        try {
          const doc = prepareDocument(item)

          if (options.skipDuplicates && !options.clearExisting) {
            const exists = await RecurringPayment.findOne({
              $or: [
                { name: doc.name, 'customer.name': doc.customer?.name },
                { _id: item.id || item._id }
              ]
            })
            if (exists) {
              results.recurringPayments.skipped++
              continue
            }
          }

          await RecurringPayment.create(doc)
          results.recurringPayments.restored++
        } catch (error) {
          console.error('Failed to restore recurring payment:', error)
          results.recurringPayments.failed++
        }
      }
    }

    // Restore mapping templates
    if (options.mappingTemplates && backupData.mappingTemplates) {
      for (const item of backupData.mappingTemplates) {
        try {
          const doc = prepareDocument(item)

          if (options.skipDuplicates && !options.clearExisting) {
            const exists = await MappingTemplate.findOne({
              name: doc.name
            })
            if (exists) {
              results.mappingTemplates.skipped++
              continue
            }
          }

          await MappingTemplate.create(doc)
          results.mappingTemplates.restored++
        } catch (error) {
          console.error('Failed to restore mapping template:', error)
          results.mappingTemplates.failed++
        }
      }
    }

    // Calculate totals
    const totalRestored = Object.values(results).reduce((sum, r) => sum + r.restored, 0)
    const totalSkipped = Object.values(results).reduce((sum, r) => sum + r.skipped, 0)
    const totalFailed = Object.values(results).reduce((sum, r) => sum + r.failed, 0)

    return {
      success: true,
      message: `Restore completed: ${totalRestored} items restored, ${totalSkipped} skipped, ${totalFailed} failed${transactionRestore ? '. Existing transaction records and IDs were preserved.' : ''}${transactionRestore?.clearSkipped ? ' Transaction clearing was skipped because some records failed.' : ''}`,
      transactionRestore,
      transactionRestorePolicy: 'Existing transaction IDs and newer states are preserved; only missing identities are restored.',
      backupVersion: backupData.version,
      backupCreatedAt: backupData.createdAt,
      results,
      totals: {
        restored: totalRestored,
        skipped: totalSkipped,
        failed: totalFailed
      }
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    console.error('Restore error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to restore backup'
    })
  }
})

/**
 * Prepare document for insertion (remove id, convert dates)
 */
function prepareDocument(doc: any): any {
  const prepared = { ...doc }

  // Remove id fields (let MongoDB generate new ones)
  delete prepared.id
  delete prepared._id
  delete prepared.__v

  // Convert date strings to Date objects
  const dateFields = ['date', 'createdAt', 'updatedAt', 'uploadDate', 'receiptDate',
                      'startDate', 'endDate', 'nextDueDate', 'lastGeneratedDate']

  for (const field of dateFields) {
    if (prepared[field] && typeof prepared[field] === 'string') {
      prepared[field] = new Date(prepared[field])
    }
  }

  // Handle nested dates in timeline
  if (Array.isArray(prepared.timeline)) {
    prepared.timeline = prepared.timeline.map((event: any) => ({
      ...event,
      timestamp: event.timestamp ? new Date(event.timestamp) : new Date()
    }))
  }

  return prepared
}
