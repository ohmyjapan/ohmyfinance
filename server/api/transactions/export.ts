// server/api/transactions/export.ts
import { defineEventHandler, getQuery, setHeader, createError } from 'h3'
import { getTransactions } from '../../services/transactionService'
import { requireAuth } from '../../middleware/auth'

/**
 * GET /api/transactions/export
 * Export transactions to CSV, JSON, or Excel format
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  try {
    // Get query parameters
    const query = getQuery(event)

    // Get format (default to CSV)
    const format = String(query.format || 'csv').toLowerCase()

    // Build filters from query params (OMF style)
    const filters: Record<string, any> = {}

    if (query.status) filters.status = query.status
    if (query.type) filters.type = query.type // 支出 or 入金
    if (query.dateFrom) filters.dateFrom = query.dateFrom
    if (query.dateTo) filters.dateTo = query.dateTo
    if (query.minAmount) filters.minAmount = parseFloat(String(query.minAmount))
    if (query.maxAmount) filters.maxAmount = parseFloat(String(query.maxAmount))
    if (query.supplierId) filters.supplierId = query.supplierId
    if (query.customerId) filters.customerId = query.customerId
    if (query.accountCategoryId) filters.accountCategoryId = query.accountCategoryId
    if (query.hasReceipt !== undefined) filters.hasReceipt = query.hasReceipt === 'true'

    // Fetch transactions from MongoDB
    const transactions = await getTransactions(filters)

    // Define fields and headers for export (OMF Japanese accounting style)
    const fields = [
      'id', 'referenceNumber', 'date', 'type', 'status',
      'amount', 'accountCategory', 'subAccountCategory',
      'taxCategory', 'taxRate', 'supplier', 'customer',
      'transactionCategory', 'companyInfo', 'invoiceNumber',
      'receiptNumber', 'productName', 'productPrice', 'janCode',
      'hasReceipt', 'notes', 'tags'
    ]

    const headers: Record<string, string> = {
      id: '取引ID',
      referenceNumber: '参照番号',
      date: '日付',
      type: '区別',
      status: 'ステータス',
      amount: '金額',
      accountCategory: '勘定科目',
      subAccountCategory: '補助科目',
      taxCategory: '税区分',
      taxRate: '税率',
      supplier: '仕入れ先',
      customer: '顧客',
      transactionCategory: '区分',
      companyInfo: '法人情報',
      invoiceNumber: 'インボイス番号',
      receiptNumber: '領収書番号',
      productName: '商品名',
      productPrice: '商品価格',
      janCode: 'JANコード',
      hasReceipt: '領収書',
      notes: '備考',
      tags: 'タグ'
    }

    // Transform data for export (OMF style)
    const exportData = transactions.map((transaction: any) => ({
      id: transaction._id?.toString() || transaction.id,
      referenceNumber: transaction.referenceNumber || '',
      date: transaction.date ? new Date(transaction.date).toLocaleDateString('ja-JP') : '',
      type: transaction.type || '支出',
      status: transaction.status || '',
      amount: transaction.amount || 0,
      accountCategory: transaction.accountCategoryId?.name || '',
      subAccountCategory: transaction.subAccountCategoryId?.name || '',
      taxCategory: transaction.taxCategoryId?.name || '',
      taxRate: transaction.taxRate ? `${transaction.taxRate}%` : '',
      supplier: transaction.supplierId?.name || '',
      customer: transaction.customerId?.name || '',
      transactionCategory: transaction.transactionCategoryId?.name || '',
      companyInfo: transaction.companyInfo || '',
      invoiceNumber: transaction.invoiceNumber || '',
      receiptNumber: transaction.receiptNumber || '',
      productName: transaction.productName || '',
      productPrice: transaction.productPrice || '',
      janCode: transaction.janCode || '',
      hasReceipt: transaction.hasReceipt ? 'あり' : 'なし',
      notes: transaction.notes || '',
      tags: Array.isArray(transaction.tags) ? transaction.tags.join(', ') : ''
    }))

    const timestamp = new Date().toISOString().split('T')[0]

    // Generate file content based on format
    if (format === 'csv') {
      const content = generateCSV(exportData, fields, headers)
      setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
      setHeader(event, 'Content-Disposition', `attachment; filename="transactions_${timestamp}.csv"`)
      return content
    }

    if (format === 'excel' || format === 'xlsx') {
      // Generate Excel-compatible CSV with BOM for proper Japanese character handling
      const content = '\ufeff' + generateCSV(exportData, fields, headers)
      setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
      setHeader(event, 'Content-Disposition', `attachment; filename="transactions_${timestamp}.csv"`)
      return content
    }

    if (format === 'json') {
      setHeader(event, 'Content-Type', 'application/json')
      setHeader(event, 'Content-Disposition', `attachment; filename="transactions_${timestamp}.json"`)
      return JSON.stringify(exportData, null, 2)
    }

    if (format === 'json-full') {
      // Full transaction data including nested objects
      setHeader(event, 'Content-Type', 'application/json')
      setHeader(event, 'Content-Disposition', `attachment; filename="transactions_full_${timestamp}.json"`)
      return JSON.stringify(transactions, null, 2)
    }

    // Default to JSON
    setHeader(event, 'Content-Type', 'application/json')
    return JSON.stringify(exportData)

  } catch (error: any) {
    console.error('Export error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to export transactions'
    })
  }
})

/**
 * Generate CSV content from data
 */
function generateCSV(data: any[], fields: string[], headers: Record<string, string>): string {
  // Header row
  const headerRow = fields.map(field => escapeCSV(headers[field] || field)).join(',')

  // Data rows
  const dataRows = data.map(row =>
    fields.map(field => escapeCSV(row[field])).join(',')
  )

  return [headerRow, ...dataRows].join('\n')
}

/**
 * Escape a value for CSV format
 */
function escapeCSV(value: any): string {
  if (value === null || value === undefined) return ''

  const str = String(value)

  // Quote the value if it contains comma, double quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }

  return str
}
