import type mongoose from 'mongoose'
import { createError } from 'h3'
import { getTransactions, getTransactionById } from './transactionService'
const refFields = ['customerId','supplierId','accountCategoryId','subAccountCategoryId','taxCategoryId','transactionCategoryId','sourceId']
const reference = (value: any) => value?._id ? { id: String(value._id), name: value.name || '', ...(value.code ? { code: value.code } : {}), ...(value.rate !== undefined ? { rate: value.rate } : {}) } : null
// Only facts from company-owned roots; never contacts, local paths, metadata, marker or source fingerprint.
export const transactionNaviView = (v: any) => ({ id: String(v._id), referenceNumber: v.referenceNumber, date: v.date, amount: v.amount, currency: v.currency || null, currencyEvidence: v.currency ? 'saved' : 'not_recorded', status: v.status, type: v.type, productName: v.productName || '', productPrice: v.productPrice ?? null, taxRate: v.taxRate ?? null, invoiceNumber: v.invoiceNumber || '', receiptNumber: v.receiptNumber || '', trackingNumber: v.trackingNumber || '', janCode: v.janCode || '', companyInfo: v.companyInfo || '', notes: String(v.notes || '').slice(0,2000), notesTruncated: String(v.notes || '').length > 2000, hasReceipt: v.hasReceipt === true, receiptEvidence: 'saved_flag_not_document_verification', paymentMethod: v.paymentMethod || '', cardNumber: String(v.cardNumber || '').slice(-4), ...Object.fromEntries(refFields.map(k => [k,reference(v[k])])), cardAccounting: v.cardAccounting ? { accountName: v.cardAccounting.accountName || '', subAccountName: v.cardAccounting.subAccountName || '', taxCategory: v.cardAccounting.taxCategory || '', sourceValuesProtected: true } : null, items: (v.items || []).slice(0,50).map((i: any) => ({ productName: i.productName, janCode: i.janCode, quantity: i.quantity, unitPrice: i.unitPrice, taxRate: i.taxRate })), itemsTruncated: (v.items?.length || 0) > 50, updatedAt: v.updatedAt || null })
export async function getCompanyNaviTransaction(organizationId: mongoose.Types.ObjectId, transactionId: string) {
  const value = await getTransactionById(transactionId, organizationId)
  if (!value) throw createError({ statusCode: 404, statusMessage: 'Transaction not found' })
  return transactionNaviView(value)
}
export async function listCompanyNaviTransactions(organizationId: mongoose.Types.ObjectId, args: any) {
  const { page = 1, limit = 50, ...filters } = args
  const values = await getTransactions(filters, organizationId, { skip: (page-1)*limit, limit: limit+1 })
  return { transactions: values.slice(0,limit).map(transactionNaviView), page, limit, hasMore: values.length > limit }
}
export async function companyTransactionChoices(organizationId: mongoose.Types.ObjectId) {
  const rows: any[] = await getTransactions({}, organizationId, { skip: 0, limit: 501 })
  const choices: any = {}, truncatedFields: string[] = []
  for (const key of refFields) {
    const seen = new Map<string, any>()
    for (const row of rows.slice(0,500)) { const value = reference(row[key]); if (value) seen.set(value.id,value) }
    choices[key] = [...seen.values()].slice(0,100); if (seen.size > 100) truncatedFields.push(key)
  }
  return { choices, source: 'references_observed_in_company_transactions', recordsScanned: Math.min(rows.length,500), truncated: rows.length > 500, truncatedFields, limit: 500, newUnusedReferences: 'not_in_this_history_view' }
}
