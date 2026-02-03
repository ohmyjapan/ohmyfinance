// server/api/receipts/export.ts
import { defineEventHandler, getQuery, setHeader, createError } from 'h3'
import { getReceipts } from '../../services/receiptService'

/**
 * GET /api/receipts/export
 * Export receipts to CSV, JSON format
 */
export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const format = String(query.format || 'csv').toLowerCase()

    // Build filters from query params
    const filters: Record<string, any> = {}
    if (query.status) filters.status = query.status
    if (query.dateFrom) filters.dateFrom = query.dateFrom
    if (query.dateTo) filters.dateTo = query.dateTo
    if (query.minAmount) filters.minAmount = parseFloat(String(query.minAmount))
    if (query.maxAmount) filters.maxAmount = parseFloat(String(query.maxAmount))
    if (query.merchant) filters.merchant = query.merchant

    // Fetch receipts from MongoDB
    const receipts = await getReceipts(filters)

    // Define fields and headers for export (OMF Japanese style)
    const fields = [
      'id', 'filename', 'uploadDate', 'status', 'amount',
      'currency', 'merchant', 'receiptDate', 'transactionId',
      'notes', 'size'
    ]

    const headers: Record<string, string> = {
      id: '領収書ID',
      filename: 'ファイル名',
      uploadDate: 'アップロード日',
      status: 'ステータス',
      amount: '金額',
      currency: '通貨',
      merchant: '取引先',
      receiptDate: '領収書日付',
      transactionId: 'マッチ取引ID',
      notes: '備考',
      size: 'ファイルサイズ'
    }

    // Transform data for export
    const exportData = receipts.map((receipt: any) => ({
      id: receipt.id || receipt._id?.toString(),
      filename: receipt.originalFilename || receipt.filename || '',
      uploadDate: receipt.uploadDate || '',
      status: receipt.status || '',
      amount: receipt.amount || 0,
      currency: receipt.currency || 'JPY',
      merchant: receipt.merchant || '',
      receiptDate: receipt.receiptDate || '',
      transactionId: receipt.transactionId?.toString() || '',
      notes: receipt.notes || '',
      size: receipt.size ? formatFileSize(receipt.size) : ''
    }))

    const timestamp = new Date().toISOString().split('T')[0]

    if (format === 'csv' || format === 'excel') {
      const bom = format === 'excel' ? '\ufeff' : ''
      const content = bom + generateCSV(exportData, fields, headers)
      setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
      setHeader(event, 'Content-Disposition', `attachment; filename="receipts_${timestamp}.csv"`)
      return content
    }

    if (format === 'json') {
      setHeader(event, 'Content-Type', 'application/json')
      setHeader(event, 'Content-Disposition', `attachment; filename="receipts_${timestamp}.json"`)
      return JSON.stringify(exportData, null, 2)
    }

    if (format === 'json-full') {
      setHeader(event, 'Content-Type', 'application/json')
      setHeader(event, 'Content-Disposition', `attachment; filename="receipts_full_${timestamp}.json"`)
      return JSON.stringify(receipts, null, 2)
    }

    // Default to JSON
    setHeader(event, 'Content-Type', 'application/json')
    return JSON.stringify(exportData)

  } catch (error: any) {
    console.error('Receipt export error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to export receipts'
    })
  }
})

function generateCSV(data: any[], fields: string[], headers: Record<string, string>): string {
  const headerRow = fields.map(field => escapeCSV(headers[field] || field)).join(',')
  const dataRows = data.map(row =>
    fields.map(field => escapeCSV(row[field])).join(',')
  )
  return [headerRow, ...dataRows].join('\n')
}

function escapeCSV(value: any): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
