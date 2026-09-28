import { createError } from 'h3'
import mongoose from 'mongoose'
import Receipt from '../models/Receipt'
import Transaction from '../models/Transaction'
import { ensureConnection } from '../config/database'
import type { LedgerAccess } from './ledgerAccessService'

const conflict = () => createError({ statusCode: 409, statusMessage: 'Receipt link changed. Reload the receipt before trying again.' })
function validId(id: string) {
  if (!mongoose.isObjectIdOrHexString(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid record ID' })
}
export function linkVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw createError({ statusCode: 400, statusMessage: 'The displayed receipt link version is required' })
  return Number(value)
}
const versionFilter = (version: number) => version === 0
  ? { $or: [{ linkVersion: 0 }, { linkVersion: { $exists: false } }] }
  : { linkVersion: version }
function publicReceipt(row: any) {
  const { filePath, linkHistory, ...visible } = row
  return { ...visible, id: String(row._id), linkVersion: row.linkVersion || 0 }
}

// Receipt.transactionId is the only stored relationship. Do not mirror it into
// Transaction: this database also runs standalone, without multi-document commits.
export async function withReceiptLinks(access: LedgerAccess, rows: any[]): Promise<any[]> {
  if (!rows.length) return rows
  const receipts = await Receipt.find({ organizationId: access.organizationId, transactionId: { $in: rows.map(row => row._id) } })
    .select('_id transactionId originalFilename filename size receiptDate amount merchant fileUrl uploadDate linkVersion').lean()
  const byTransaction = new Map(receipts.map(row => [String(row.transactionId), row]))
  return rows.map(row => {
    const receipt = byTransaction.get(String(row._id))
    if (!receipt) return row
    return { ...row, hasReceipt: true, receiptFilePath: receipt.fileUrl || row.receiptFilePath,
      receiptUploadedAt: receipt.uploadDate,
      receipt: { id: String(receipt._id), receiptId: String(receipt._id), filename: receipt.originalFilename || receipt.filename,
        size: receipt.size, date: receipt.receiptDate, amount: receipt.amount, merchant: receipt.merchant,
        url: receipt.fileUrl, linkVersion: receipt.linkVersion || 0 } }
  })
}

export async function receiptPresence(access: LedgerAccess, present: boolean) {
  const ids = await Receipt.distinct('transactionId', { organizationId: access.organizationId, transactionId: { $type: 'objectId' } })
  return present ? { $or: [{ hasReceipt: true }, { _id: { $in: ids } }] }
    : { hasReceipt: { $ne: true }, _id: { $nin: ids } }
}

export async function matchReceiptWithTransaction(access: LedgerAccess, receiptId: string, transactionId: string, expectedVersion: number) {
  await ensureConnection()
  validId(receiptId); validId(transactionId)
  const version = linkVersion(expectedVersion)
  // Failed index initialization must not fall back to read-then-write.
  await Receipt.init()
  const receipt = await Receipt.findOne({ _id: receiptId, organizationId: access.organizationId }).lean()
  const transaction: any = await Transaction.findOne({ _id: transactionId, organizationId: access.organizationId }).lean()
  if (!receipt || !transaction) throw createError({ statusCode: 404, statusMessage: 'Receipt or transaction not found' })
  const result = async (row: any) => ({ receipt: publicReceipt(row), transaction: (await withReceiptLinks(access, [transaction]))[0] })
  if (String(receipt.transactionId) === transactionId && receipt.linkVersion === version + 1) return result(receipt)
  if (receipt.transactionId || (receipt.linkVersion || 0) !== version) throw conflict()
  if (transaction.hasReceipt || transaction.receiptFilePath) throw createError({ statusCode: 409, statusMessage: 'Transaction already has receipt evidence' })
  try {
    const updated = await Receipt.findOneAndUpdate({ _id: receiptId, organizationId: access.organizationId, transactionId: null, ...versionFilter(version) }, {
      $set: { transactionId, status: 'matched' }, $inc: { linkVersion: 1 },
      $push: { linkHistory: { action: 'attached', transactionId, userId: access.userId, version: version + 1, at: new Date() } }
    }, { new: true, runValidators: true }).lean()
    if (updated) return result(updated)
    const current = await Receipt.findOne({ _id: receiptId, organizationId: access.organizationId }).lean()
    if (current && String(current.transactionId) === transactionId && current.linkVersion === version + 1) return result(current)
    throw conflict()
  } catch (error: any) {
    if (error.code === 11000) throw createError({ statusCode: 409, statusMessage: 'Transaction already has another receipt' })
    throw error
  }
}

export async function unmatchReceipt(access: LedgerAccess, receiptId: string, transactionId: string, expectedVersion: number) {
  await ensureConnection()
  validId(receiptId); validId(transactionId)
  const version = linkVersion(expectedVersion)
  const receipt = await Receipt.findOne({ _id: receiptId, organizationId: access.organizationId }).lean()
  if (!receipt) throw createError({ statusCode: 404, statusMessage: 'Receipt not found' })
  const result = (row: any) => ({ receipt: publicReceipt(row), transactionId })
  if (!receipt.transactionId && receipt.linkVersion === version + 1 && String(receipt.lastUnmatchedTransactionId) === transactionId) return result(receipt)
  if (String(receipt.transactionId) !== transactionId || (receipt.linkVersion || 0) !== version) throw conflict()
  // A stale reference can be unlinked even after target deletion. Only this
  // company's receipt changes; no other company's ledger is ever written.
  const updated = await Receipt.findOneAndUpdate({ _id: receiptId, organizationId: access.organizationId, transactionId, ...versionFilter(version) }, {
    $set: { status: 'unmatched', lastUnmatchedTransactionId: transactionId }, $unset: { transactionId: '' }, $inc: { linkVersion: 1 },
    $push: { linkHistory: { action: 'detached', transactionId, userId: access.userId, version: version + 1, at: new Date() } }
  }, { new: true, runValidators: true }).lean()
  if (updated) return result(updated)
  const current = await Receipt.findOne({ _id: receiptId, organizationId: access.organizationId }).lean()
  if (current && !current.transactionId && current.linkVersion === version + 1 && String(current.lastUnmatchedTransactionId) === transactionId) return result(current)
  throw conflict()
}
