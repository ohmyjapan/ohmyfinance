import type mongoose from 'mongoose'
import { createError } from 'h3'
import { getTransactions, getTransactionById } from './transactionService'
import { registeredAccountCatalogue } from './companyAccountRegistrationService'
import { companyDateFilters } from './transactionExportService'
const refFields = ['customerId','supplierId','accountCategoryId','subAccountCategoryId','taxCategoryId','transactionCategoryId','sourceId']
const reference = (value: any) => value?._id ? { id: String(value._id), name: value.name || '', ...(value.code ? { code: value.code } : {}), ...(value.rate !== undefined ? { rate: value.rate } : {}) } : null
// Only facts from company-owned roots; never contacts, local paths, metadata, marker or source fingerprint.
export const transactionNaviView = (v: any) => ({ id: String(v._id), referenceNumber: v.referenceNumber, date: v.date, amount: v.amount, currency: v.currency || v.metadata?.currency || null, currencyEvidence: v.currency ? 'saved' : v.metadata?.currency ? 'saved_card_source' : 'not_recorded', foreignAmount: v.metadata?.foreignAmount ?? null, exchangeRate: v.metadata?.exchangeRate ?? null, status: v.status, type: v.type, productName: v.productName || '', productPrice: v.productPrice ?? null, taxRate: v.taxRate ?? null, invoiceNumber: v.invoiceNumber || '', receiptNumber: v.receiptNumber || '', trackingNumber: v.trackingNumber || '', janCode: v.janCode || '', companyInfo: v.companyInfo || '', notes: String(v.notes || '').slice(0,2000), notesTruncated: String(v.notes || '').length > 2000, hasReceipt: v.hasReceipt === true, receiptEvidence: 'saved_flag_not_document_verification', paymentMethod: v.paymentMethod || '', cardNumber: String(v.cardNumber || '').slice(-4), ...Object.fromEntries(refFields.map(k => [k,reference(v[k])])), cardAccounting: v.cardAccounting ? { accountName: v.cardAccounting.accountName || '', subAccountName: v.cardAccounting.subAccountName || '', taxCategory: v.cardAccounting.taxCategory || '', sourceValuesProtected: true } : null, items: (v.items || []).slice(0,50).map((i: any) => ({ productName: i.productName, janCode: i.janCode, quantity: i.quantity, unitPrice: i.unitPrice, taxRate: i.taxRate })), itemsTruncated: (v.items?.length || 0) > 50, updatedAt: v.updatedAt || null })
export async function getCompanyNaviTransaction(organizationId: mongoose.Types.ObjectId, transactionId: string) {
  const value = await getTransactionById(transactionId, organizationId)
  if (!value) throw createError({ statusCode: 404, statusMessage: 'Transaction not found' })
  return transactionNaviView(value)
}
export async function listCompanyNaviTransactions(organizationId: mongoose.Types.ObjectId, args: any) {
  const { page = 1, limit = 50, ...filters } = args
  // Date keys are the company's whole local days, resolved exactly as the export route resolves them (the EX03 read lost the final day's
  // 23:30 JST row); the window is reported only when a date key was given.
  const resolved = await companyDateFilters(organizationId, filters)
  const values = await getTransactions(resolved.filters, organizationId, { skip: (page-1)*limit, limit: limit+1 })
  return { transactions: values.slice(0,limit).map(transactionNaviView), page, limit, hasMore: values.length > limit, ...(resolved.window ? { window: resolved.window } : {}) }
}
export async function companyTransactionChoices(organizationId: mongoose.Types.ObjectId, args: any = {}) {
  const rows: any[] = await getTransactions({}, organizationId, { skip: 0, limit: 501 })
  const choices: any = {}, observed: any = {}, truncatedFields: string[] = []
  for (const key of refFields) {
    const seen = new Map<string, any>()
    for (const row of rows.slice(0,500)) { const value = reference(row[key]); if (value) seen.set(value.id,value) }
    choices[key] = [...seen.values()].slice(0,100); observed[key] = seen; if (seen.size > 100) truncatedFields.push(key)
  }
  // Accounting accounts this company explicitly registered (unused ones included) join the history choices with their source; every
  // other reference stays observed-history only, and nothing global is listed.
  const registered = await registeredAccountCatalogue(organizationId, args);
  for (const account of registered.accounts) {
    const present = choices[account.field].find((c: any) => c.id === account.id)
    if (present) Object.assign(present, { registeredForCompany: true }, account.field === 'subAccountCategoryId' ? { parent: account.parent } : {})
    else choices[account.field].push({ id: account.id, name: account.name, ...(account.code ? { code: account.code } : {}), source: 'company_registration', observedInHistory: observed[account.field].has(account.id), ...(account.field === 'subAccountCategoryId' ? { parent: account.parent } : {}) })
  }
  return { choices, source: 'references_observed_in_company_transactions_plus_company_registered_accounts', recordsScanned: Math.min(rows.length,500), truncated: rows.length > 500, truncatedFields, limit: 500,
    registeredAccounts: { query: registered.query, page: registered.page, limit: registered.limit, returned: registered.accounts.length, hasMore: registered.hasMore, meaning: 'accounting accounts this company registered for Navi: availability, not use history, purpose or ownership' },
    newUnusedReferences: 'only_accounting_accounts_registered_for_this_company' }
}
// Pattern examples use the same whitelisted currency source as the transaction view (saved value, else the card statement's), never
// the whole metadata object; a missing one stays unknown.
const exampleCurrency = (row: any) => ({ currency: row.currency || row.metadata?.currency || null, currencyEvidence: row.currency ? 'saved' : row.metadata?.currency ? 'saved_card_source' : 'not_recorded' })
// The merchant text is matched literally (the shared list search is a regular expression).
const literalPattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const classificationFields = ['accountCategoryId','subAccountCategoryId','taxCategoryId','transactionCategoryId','customerId','supplierId']
// Pattern evidence for one merchant in this company's saved history: how it was classified, how often, dated examples of every
// classification (consistent and conflicting), the exact protected card credit account names and what the receipt flag means.
// Historical classification is evidence, not a legal or tax determination; a missing receipt flag only means OMF has none recorded.
export async function companyTransactionPatterns(organizationId: mongoose.Types.ObjectId, args: any) {
  const limit = 500, exampleLimit = args.exampleLimit || 5
  // The same company-zone day resolution as the list read and the export.
  const dates = { ...(args.dateFrom ? { dateFrom: args.dateFrom } : {}), ...(args.dateTo ? { dateTo: args.dateTo } : {}) }
  const resolved = await companyDateFilters(organizationId, dates)
  const rows: any[] = await getTransactions({ search: literalPattern(args.merchant), ...resolved.filters }, organizationId, { skip: 0, limit: limit + 1 })
  const scanned = rows.slice(0, limit).filter(row => !args.cardLast4 || String(row.cardNumber || '').slice(-4) === args.cardLast4)
  const groups = new Map<string, any>(), credit = new Map<string, any>(), receipts = { savedFlagTrue: 0, notRecordedInOMF: 0 }
  for (const row of scanned) {
    const classification: any = Object.fromEntries(classificationFields.map(k => [k.replace(/Id$/, ''), reference(row[k])]))
    const key = classificationFields.map(k => String(row[k]?._id || '')).join('|')
    const group = groups.get(key) || { classification, count: 0, firstDate: null, lastDate: null, examples: [] }
    group.count++; const date = row.date ? new Date(row.date) : null
    if (date && (!group.firstDate || date < group.firstDate)) group.firstDate = date
    if (date && (!group.lastDate || date > group.lastDate)) group.lastDate = date
    if (group.examples.length < exampleLimit) group.examples.push({ id: String(row._id), date: row.date, amount: row.amount, ...exampleCurrency(row), productName: row.productName || '', companyInfo: row.companyInfo || '', cardLast4: String(row.cardNumber || '').slice(-4), receiptFlag: row.hasReceipt === true ? 'saved_flag_true' : 'not_recorded_in_OMF' })
    groups.set(key, group)
    if (row.hasReceipt === true) receipts.savedFlagTrue++; else receipts.notRecordedInOMF++
    if (row.cardAccounting) { const ck = JSON.stringify([row.cardAccounting.accountName || '', row.cardAccounting.subAccountName || '']), c = credit.get(ck) || { accountName: row.cardAccounting.accountName || '', subAccountName: row.cardAccounting.subAccountName || '', count: 0 }; c.count++; credit.set(ck, c) }
  }
  const ordered = [...groups.values()].sort((a, b) => b.count - a.count || (b.lastDate?.getTime() || 0) - (a.lastDate?.getTime() || 0))
  return { merchant: args.merchant, matchedFields: 'referenceNumber, productName, invoiceNumber, receiptNumber, companyInfo, notes (literal, case-insensitive)', matched: scanned.length, groups: ordered, consistent: ordered.length === 1, conflicting: ordered.length > 1, cardCreditAccounts: [...credit.values()].sort((a, b) => b.count - a.count), receipts: { ...receipts, meaning: 'not_recorded_in_OMF means OMF has no saved receipt flag; it is not proof that no receipt exists' }, evidence: 'historical_classification_not_legal_or_tax_truth', scanned: Math.min(rows.length, limit), truncated: rows.length > limit, limit, exampleLimit, ...(resolved.window ? { window: resolved.window } : {}) }
}
