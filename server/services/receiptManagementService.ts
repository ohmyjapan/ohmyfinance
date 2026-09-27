import { createError } from 'h3'
import mongoose from 'mongoose'
import Receipt, { type IReceipt } from '../models/Receipt'
import { ensureConnection } from '../config/database'
import type { Receipt as ReceiptResponse } from '../../types/receipt'

type ReceiptRecord = Omit<IReceipt, keyof mongoose.Document> & { _id: mongoose.Types.ObjectId }
type ReceiptFilters = { status?: string; dateFrom?: string; dateTo?: string; minAmount?: number; maxAmount?: number; merchant?: string; transactionId?: string; search?: string }
const editable = ['amount', 'currency', 'merchant', 'receiptDate', 'category', 'notes', 'tags', 'taxAmount', 'taxRate', 'extractedData'] as const

function receiptId(value: string) {
  if (!mongoose.isObjectIdOrHexString(value)) throw createError({ statusCode: 400, statusMessage: 'Invalid receipt ID' })
  return value
}

function visible(row: ReceiptRecord): ReceiptResponse {
  return {
    id: String(row._id), _id: String(row._id), filename: row.filename, originalFilename: row.originalFilename,
    size: row.size, mimeType: row.mimeType, uploadDate: row.uploadDate.toISOString(), status: row.status,
    amount: row.amount, currency: row.currency, merchant: row.merchant,
    transactionId: row.transactionId?.toString(), fileUrl: row.fileUrl, thumbnailUrl: row.thumbnailUrl,
    receiptDate: row.receiptDate?.toISOString(), category: row.category, notes: row.notes, tags: row.tags,
    uploadedBy: row.uploadedBy?.toString(), taxAmount: row.taxAmount, taxRate: row.taxRate,
    extractedData: row.extractedData ? { ...row.extractedData, date: row.extractedData.date?.toISOString() } : undefined,
    errorMessage: row.errorMessage, confidenceScore: row.confidenceScore, metadata: row.metadata,
    createdAt: row.createdAt?.toISOString(), updatedAt: row.updatedAt?.toISOString()
  }
}

export async function getReceipts(ownerId: string, filters: ReceiptFilters = {}): Promise<ReceiptResponse[]> {
  await ensureConnection()
  const query: mongoose.FilterQuery<IReceipt> = { uploadedBy: ownerId }
  if (filters.status) query.status = filters.status
  if (filters.transactionId) query.transactionId = filters.transactionId
  if (filters.merchant) query.merchant = { $regex: filters.merchant, $options: 'i' }
  if (filters.dateFrom || filters.dateTo) query.uploadDate = {
    ...(filters.dateFrom ? { $gte: new Date(filters.dateFrom) } : {}),
    ...(filters.dateTo ? { $lte: new Date(filters.dateTo) } : {})
  }
  if (filters.minAmount !== undefined || filters.maxAmount !== undefined) query.amount = {
    ...(filters.minAmount !== undefined ? { $gte: filters.minAmount } : {}),
    ...(filters.maxAmount !== undefined ? { $lte: filters.maxAmount } : {})
  }
  if (filters.search) query.$or = ['filename', 'originalFilename', 'merchant', 'notes'].map(key => ({ [key]: { $regex: filters.search, $options: 'i' } }))
  return (await Receipt.find(query).sort({ uploadDate: -1 }).lean()).map(visible)
}

export async function getReceiptById(ownerId: string, id: string): Promise<ReceiptResponse> {
  await ensureConnection()
  const row = await Receipt.findOne({ _id: receiptId(id), uploadedBy: ownerId }).lean()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Receipt not found' })
  return visible(row)
}

export async function createReceipt(ownerId: string, file: Partial<IReceipt>, metadata: Partial<IReceipt> = {}): Promise<ReceiptResponse> {
  await ensureConnection()
  const row = await Receipt.create({ ...file, ...metadata, uploadedBy: ownerId, status: 'unmatched', uploadDate: new Date() })
  return visible(row.toObject())
}

export async function updateReceipt(ownerId: string, id: string, data: Record<string, unknown>): Promise<ReceiptResponse> {
  await ensureConnection()
  const update = Object.fromEntries(editable.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]))
  const row = await Receipt.findOneAndUpdate({ _id: receiptId(id), uploadedBy: ownerId }, { $set: update }, { new: true, runValidators: true }).lean()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Receipt not found' })
  return visible(row)
}

export async function deleteReceipt(ownerId: string, id: string): Promise<ReceiptResponse> {
  await ensureConnection()
  const row = await Receipt.findOneAndDelete({ _id: receiptId(id), uploadedBy: ownerId }).lean()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Receipt not found' })
  // Keep the original file. Receipt links are owned by the separate matching flow.
  return visible(row)
}

export async function getReceiptStats(ownerId: string) {
  await ensureConnection()
  const counts = await Receipt.aggregate<{ _id: string; count: number }>([
    { $match: { uploadedBy: new mongoose.Types.ObjectId(ownerId) } },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ])
  const byStatus = Object.fromEntries(counts.map(row => [row._id, row.count]))
  const total = counts.reduce((sum, row) => sum + row.count, 0), matched = byStatus.matched || 0
  return { total, matched, unmatched: total - matched, processing: byStatus.processing || 0, error: byStatus.error || 0, matchRate: total ? Math.round(matched / total * 10000) / 100 : 0 }
}
