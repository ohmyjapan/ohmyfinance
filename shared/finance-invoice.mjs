// 適格請求書 rules shared by the company settings route, the invoice writer, the print HTML and both pages (plan
// omf-invoice-tnumber-20261030 A1). No Node imports: the page bundle loads it too.
import { tNumberPattern } from './finance-company-public-research.mjs'
import { reducedRateMark } from './finance-reduced-rate.mjs'

// The 登録番号 as typed: NFKC (full-width letters and digits), trimmed, upper-case. Empty stays empty.
export function normalizeRegistrationNumber(value) {
  return String(value ?? '').normalize('NFKC').trim().toUpperCase()
}
// T and exactly 13 digits (the NTA format). The value is tested as given; callers normalize first.
export function isRegistrationNumber(value) {
  return typeof value === 'string' && tNumberPattern.test(value)
}
// The writer's arithmetic: subtotal of the line amounts, tax rounded to the yen, total.
export function invoiceTotals(items, rate) {
  const subtotal = (items || []).reduce((sum, item) => sum + Number(item.amount ?? item.quantity * item.unitPrice), 0)
  const taxAmount = Math.round(subtotal * rate / 100)
  return { subtotal, taxAmount, total: subtotal + taxAmount }
}
// ※軽減 for an invoice at 8% issued on or after 2019-10-01 JST (one rate per invoice), else ''.
export function invoiceReducedMark(invoice) {
  if (!invoice || typeof invoice !== 'object') return ''
  return reducedRateMark({ date: invoice.issueDate, taxRate: invoice.taxRate })
}
