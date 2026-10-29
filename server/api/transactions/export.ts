// server/api/transactions/export.ts
import { defineEventHandler, getQuery, setHeader, createError } from 'h3'
import { exportTransactionRows } from '../../services/transactionExportService'
import { exportCriteriaFromQuery } from '../../../shared/finance-transaction-export.mjs'
import { reducedRateMark } from '../../../shared/finance-reduced-rate.mjs'
import { requireAuth } from '../../middleware/auth'
import { ensureConnection } from '../../config/database'
import { calendarCompany } from '../../utils/calendarAccess'

/**
 * GET /api/transactions/export
 * Export transactions to CSV, JSON, or Excel format
 */
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  requireAuth(event)
  await ensureConnection()
  const { organizationId } = await calendarCompany(event)
  try {
    // Get query parameters
    const query = getQuery(event)

    // Get format (default to CSV)
    const format = String(query.format || 'csv').toLowerCase()

    // The export recipe: the list route's filter set (search and transactionCategoryId included), typed. A real date key is a whole
    // local day of the company's saved time zone (transactionExportService); any other date string keeps its instant meaning.
    const criteria = exportCriteriaFromQuery(query)

    // Fetch transactions from MongoDB
    const { transactions } = await exportTransactionRows(organizationId, criteria)

    // Define fields and headers for export (OMF Japanese accounting style)
    const fields = [
      'id', 'referenceNumber', 'date', 'type', 'status',
      'amount', 'accountCategory', 'subAccountCategory',
      'taxCategory', 'taxRate', 'reducedMark', 'supplier', 'customer',
      'transactionCategory', 'companyInfo', 'invoiceNumber',
      'receiptNumber', 'productName', 'productPrice', 'janCode',
      'hasReceipt', 'notes', 'tags', 'cardAccountCategory', 'cardSubAccountCategory', 'cardTaxCategory'
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
      reducedMark: '軽減税率',
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
      tags: 'タグ', cardAccountCategory: '貸方勘定科目（カード）', cardSubAccountCategory: '貸方補助科目（カード）', cardTaxCategory: '貸方税区分（カード）'
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
      taxRate: transaction.taxRate === null || transaction.taxRate === undefined ? '' : String(transaction.taxRate) + '%',
      reducedMark: reducedRateMark(transaction),
      supplier: transaction.supplierId?.name || '',
      customer: transaction.customerId?.name || '',
      transactionCategory: transaction.transactionCategoryId?.name || '',
      companyInfo: transaction.companyInfo || '',
      invoiceNumber: transaction.invoiceNumber || '',
      receiptNumber: transaction.receiptNumber || '',
      productName: transaction.productName || '',
      productPrice: transaction.productPrice ?? '',
      janCode: transaction.janCode || '',
      hasReceipt: transaction.hasReceipt ? 'あり' : 'なし',
      notes: transaction.notes || '',
      tags: Array.isArray(transaction.tags) ? transaction.tags.join(', ') : '',
      cardAccountCategory: transaction.cardAccounting?.accountName || '',
      cardSubAccountCategory: transaction.cardAccounting?.subAccountName || '',
      cardTaxCategory: transaction.cardAccounting?.taxCategory || ''
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

  } catch {
    throw createError({ statusCode: 500, statusMessage: 'Failed to export company transactions' })
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
