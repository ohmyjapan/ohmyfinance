import { createError } from 'h3'
import { Types } from 'mongoose'
import Transaction, { activeTransactionFilter } from '../models/Transaction'
import { ensureConnection } from '../config/database'
import { removeTransactions } from './transactionService'
import type { LedgerAccess } from './ledgerAccessService'

const conflict = (message: string) => createError({ statusCode: 409, statusMessage: message })
const identity = (value: any) => value
  ? JSON.stringify([value.key, value.payloadHash, value.schemaVersion, String(value.createdBy)])
  : 'unkeyed'

/**
 * Restore missing transaction identities; current records win over old snapshots.
 * This is the transaction portion of an archive, not a whole-database restore.
 */
export async function restoreTransactionArchive(access: LedgerAccess, input: unknown, clearExisting = false) {
  await ensureConnection()
  if (!Array.isArray(input)) throw createError({ statusCode: 400, statusMessage: 'An explicit transaction array is required' })
  const seen = new Set<string>(), keys = new Set<string>()
  const documents: any[] = []
  // Validate the complete set before clearing or inserting anything.
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw conflict('Invalid archived transaction')
    const id = item._id || item.id
    if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id) || (item.id && item._id && String(item.id) !== String(item._id))) throw conflict('Archive must preserve each original transaction ID')
    if (String(item.organizationId) !== access.organizationId) throw conflict('Archive transaction company binding needs review')
    const normalized = id.toLowerCase()
    if (seen.has(normalized)) throw conflict('Archive contains a repeated transaction ID')
    seen.add(normalized)
    if (item.deletedAt && !item.manualCreate) throw conflict('Deleted archive identity is incomplete')
    const { id: ignoredId, __v, ...fields } = item
    const document = new Transaction({ ...fields, _id: new Types.ObjectId(normalized), organizationId: access.organizationId })
    await document.validate()
    if (document.manualCreate) {
      if (keys.has(document.manualCreate.key)) throw conflict('Archive contains a repeated manual creation key')
      keys.add(document.manualCreate.key)
    }
    documents.push(document)
  }
  await Transaction.init()
  const ids = documents.map(document => document._id)
  if (await Transaction.exists({ _id: { $in: ids }, organizationId: { $ne: new Types.ObjectId(access.organizationId) } })) throw conflict('Archive transaction identity belongs to another company')
  const current: any[] = await Transaction.find({
    organizationId: access.organizationId,
    $or: [{ _id: { $in: ids } }, { 'manualCreate.key': { $in: [...keys] } }]
  }).select('+manualCreate').lean()
  const byId = new Map(current.map(row => [String(row._id), row]))
  const byKey = new Map(current.filter(row => row.manualCreate).map(row => [row.manualCreate.key, row]))
  for (const document of documents) {
    const existing = byId.get(String(document._id)), keyed = document.manualCreate && byKey.get(document.manualCreate.key)
    if (keyed && String(keyed._id) !== String(document._id)) throw conflict('Manual creation key belongs to a different transaction')
    if (existing && identity(existing.manualCreate) !== identity(document.manualCreate)) throw conflict('Archive cannot replace a transaction creation identity')
  }
  // Clear only the active records observed before restoration. A purchase created
  // while the archive is being written is not part of that captured clear set.
  const clearRows = clearExisting ? await Transaction.find(activeTransactionFilter({
    organizationId: access.organizationId, _id: { $nin: ids }
  })).select('_id').lean() : []
  const result = { restored: 0, skipped: 0, failed: 0, cleared: 0, clearSkipped: false }
  for (const document of documents) {
    if (byId.has(String(document._id))) { result.skipped++; continue }
    try {
      await document.save()
      result.restored++
    } catch (error: any) {
      // Another writer may have inserted this exact archived identity.
      const row: any = error.code === 11000
        ? await Transaction.findOne({ _id: document._id, organizationId: access.organizationId }).select('+manualCreate').lean()
        : null
      if (row && identity(row.manualCreate) === identity(document.manualCreate)) result.skipped++
      else result.failed++
    }
  }
  if (clearExisting && !result.failed) result.cleared = (await removeTransactions(access, { _id: { $in: clearRows.map(row => row._id) } })).deletedCount
  else if (clearExisting) result.clearSkipped = true
  return result
}
