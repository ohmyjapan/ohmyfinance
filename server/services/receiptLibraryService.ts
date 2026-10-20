import type mongoose from 'mongoose'
import Receipt from '../models/Receipt'
import { ensureConnection } from '../config/database'
import { currencyCode } from '../../shared/finance-navi-business.mjs'

// Display-only library. Existing raw receipt readers/exporters and receipt mutations keep their contracts.
export async function getReceiptLibrary(organizationId: mongoose.Types.ObjectId) {
  await ensureConnection()
  const rows = await Receipt.find({ organizationId }).select('filename originalFilename size uploadDate amount currency merchant status').sort({ uploadDate: -1, _id: -1 }).lean()
  const receipts = rows.map(row => ({
    id: String(row._id), filename: row.originalFilename || row.filename || '', size: row.size ?? 0,
    uploadDate: row.uploadDate || null, amount: row.amount ?? null, currency: currencyCode(row.currency),
    merchant: row.merchant || '', status: row.status || ''
  }))
  const count = (status: string) => receipts.filter(row => row.status === status).length
  const total = receipts.length, matched = count('matched')
  return { receipts, stats: { total, matched, unmatched: count('unmatched'), processing: count('processing'), error: count('error'), matchRate: total ? Math.round(matched / total * 10000) / 100 : 0 } }
}
