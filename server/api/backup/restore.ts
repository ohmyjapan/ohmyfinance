// server/api/backup/restore.ts
import { defineEventHandler, readBody, createError } from 'h3'
import mongoose from 'mongoose'
import { ensureConnection } from '../../config/database'
import Transaction from '../../models/Transaction'
import Receipt from '../../models/Receipt'
import RecurringPayment from '../../models/RecurringPayment'
import { calendarCompany } from '../../utils/calendarAccess'
import { backupScope, provesCompanySnapshot, recordedCompany, restorableValues, WITHHELD_FIELDS, type BackupSkipReason } from '../../services/companyBackupService'

type SectionKey = 'transactions' | 'receipts' | 'recurringPayments'
type SectionResult = { restored: number, skipped: number, failed: number, cleared: number, clearSkipped: string | null, reasons: Partial<Record<BackupSkipReason, number>>, withheld: Record<string, number> }

const sectionResult = (): SectionResult => ({ restored: 0, skipped: 0, failed: 0, cleared: 0, clearSkipped: null, reasons: {}, withheld: {} })
const skip = (result: SectionResult, reason: BackupSkipReason, count = 1) => { result.skipped += count; result.reasons[reason] = (result.reasons[reason] || 0) + count }
const objectId = (value: unknown) => typeof value === 'string' && mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(value) : null

// The selected company's own duplicate of a prepared row; no usable key means no duplicate (never an undefined-field query).
const duplicateKeys: Record<SectionKey, (doc: any, item: any) => any[]> = {
  transactions: (doc, item) => [...(typeof doc.referenceNumber === 'string' && doc.referenceNumber ? [{ referenceNumber: doc.referenceNumber }] : []), ...(objectId(item.id || item._id) ? [{ _id: objectId(item.id || item._id) }] : [])],
  receipts: (doc, item) => [...(typeof doc.filename === 'string' && doc.filename ? [{ filename: doc.filename }] : []), ...(objectId(item.id || item._id) ? [{ _id: objectId(item.id || item._id) }] : [])],
  recurringPayments: (doc, item) => [...(typeof doc.name === 'string' && doc.name && typeof doc.customer?.name === 'string' ? [{ name: doc.name, 'customer.name': doc.customer.name }] : []), ...(objectId(item.id || item._id) ? [{ _id: objectId(item.id || item._id) }] : [])]
}

/**
 * POST /api/backup/restore - Restore a backup into the token-selected company (final review F2). Only rows whose recorded
 * organizationId is that company are written, through the trusted company/creator setters; other-company, unassigned, malformed
 * and invalid rows are skipped with reasons. Duplicate checks and clearExisting are limited to that company, and a section is
 * cleared only when the file holds selected-company rows for it and none of them is invalid (or it is this company's exact empty
 * snapshot); otherwise valid rows are added and the existing rows stay.
 */
export default defineEventHandler(async (event) => {
  const { auth, organizationId } = await calendarCompany(event)
  if (event.method !== 'POST') {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method not allowed'
    })
  }

  try {
    await ensureConnection()

    const body = await readBody(event)

    if (!body || body.data === undefined || body.data === null) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Backup data is required in the "data" field'
      })
    }

    let backupData: any
    try {
      backupData = typeof body.data === 'string' ? JSON.parse(body.data) : body.data
    } catch {
      backupData = null
    }

    // Validate backup format
    if (!backupData || typeof backupData !== 'object' || Array.isArray(backupData) || !backupData.version || !backupData.application) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid backup format'
      })
    }

    const options = {
      clearExisting: body.clearExisting === true,
      skipDuplicates: body.skipDuplicates !== false, // default true
      transactions: body.transactions !== false,
      receipts: body.receipts !== false,
      recurringPayments: body.recurringPayments !== false,
      mappingTemplates: body.mappingTemplates !== false
    }
    const actor = new mongoose.Types.ObjectId(String(auth.userId))
    const models: Record<SectionKey, any> = { transactions: Transaction, receipts: Receipt, recurringPayments: RecurringPayment }
    const results: Record<SectionKey | 'mappingTemplates', SectionResult> = { transactions: sectionResult(), receipts: sectionResult(), recurringPayments: sectionResult(), mappingTemplates: sectionResult() }
    const prepared: Record<SectionKey, { doc: any, item: any }[]> = { transactions: [], receipts: [], recurringPayments: [] }
    const clear = new Set<SectionKey>()

    // 1. Classify and validate every section before anything is cleared or written.
    for (const key of Object.keys(models) as SectionKey[]) {
      const result = results[key], section = backupData[key]
      if (!options[key]) { if (options.clearExisting) result.clearSkipped = 'not_selected'; continue }
      if (section === undefined || section === null) { if (options.clearExisting) result.clearSkipped = 'section_absent'; continue }
      if (!Array.isArray(section)) { skip(result, 'malformed'); if (options.clearExisting) result.clearSkipped = 'section_malformed'; continue }
      for (const item of section) {
        const owner = recordedCompany(item, organizationId)
        if (owner !== 'selected') { skip(result, owner); continue }
        for (const field of WITHHELD_FIELDS) if (item[field] !== undefined && item[field] !== null) result.withheld[field] = (result.withheld[field] || 0) + 1
        const doc = new models[key](restorableValues(item))
        doc.set('organizationId', organizationId, { strict: false })
        if (key === 'recurringPayments') doc.set('createdBy', actor, { strict: false })
        if (key === 'receipts') doc.set('uploadedBy', actor)
        if (doc.validateSync()) { skip(result, 'invalid'); continue }
        prepared[key].push({ doc, item })
      }
      if (options.clearExisting) {
        // An invalid row of this company means the file is not a complete replacement: keep existing rows, add the valid ones.
        if (result.reasons.invalid) result.clearSkipped = 'selected_company_rows_invalid'
        else if (prepared[key].length > 0 || (section.length === 0 && provesCompanySnapshot(backupData, organizationId))) clear.add(key)
        else result.clearSkipped = 'no_selected_company_rows'
      }
    }
    if (options.mappingTemplates && Array.isArray(backupData.mappingTemplates) && backupData.mappingTemplates.length) skip(results.mappingTemplates, 'shared_template', backupData.mappingTemplates.length)
    if (options.clearExisting && options.mappingTemplates) results.mappingTemplates.clearSkipped = 'shared_not_company_scoped'

    // 2. Clear only the selected company's rows of the sections this file replaces.
    for (const key of clear) results[key].cleared = (await models[key].collection.deleteMany({ organizationId })).deletedCount || 0

    // 3. Write the prepared rows; duplicates are this company's own.
    for (const key of Object.keys(prepared) as SectionKey[]) {
      for (const { doc, item } of prepared[key]) {
        try {
          if (options.skipDuplicates && !clear.has(key)) {
            const keys = duplicateKeys[key](doc, item)
            if (keys.length && await models[key].exists({ organizationId, $or: keys })) { skip(results[key], 'duplicate'); continue }
          }
          await doc.save()
          results[key].restored++
        } catch {
          console.error('Company backup restore: one row could not be saved')
          results[key].failed++
        }
      }
    }

    const all = Object.values(results)
    const totals = { restored: all.reduce((s, r) => s + r.restored, 0), skipped: all.reduce((s, r) => s + r.skipped, 0), failed: all.reduce((s, r) => s + r.failed, 0), cleared: all.reduce((s, r) => s + r.cleared, 0) }

    return {
      success: true,
      message: `Restore completed for the selected company: ${totals.restored} items restored, ${totals.skipped} skipped, ${totals.failed} failed`,
      scope: backupScope(organizationId),
      backupVersion: backupData.version,
      backupCreatedAt: backupData.createdAt,
      results,
      totals
    }
  } catch (error: any) {
    if (error?.statusCode) throw error
    console.error('Company backup restore failed')
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to restore backup'
    })
  }
})
