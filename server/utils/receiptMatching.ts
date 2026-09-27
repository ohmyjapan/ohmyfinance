/** Rule scores rank suggestions; they are not calibrated probabilities. */
export interface ReceiptEvidence {
  amount?: number | null
  receiptDate?: Date | string | null
  merchant?: string | null
  currency?: string | null
}

export interface TransactionEvidence {
  amount?: number
  date?: Date | string
  companyInfo?: string
  notes?: string
  metadata?: Record<string, unknown>
  type?: string
  status?: string
}

const DAY = 86400000
const JST = 9 * 3600000
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const words = (value: unknown): string[] => typeof value === 'string'
  ? value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [] : []
const currency = (value: unknown): string | undefined => typeof value === 'string' && /^[A-Za-z]{3}$/.test(value.trim())
  ? value.trim().toUpperCase() : undefined

export function transactionCurrency(transaction: TransactionEvidence) {
  return currency(transaction.metadata?.currency)
}

export function receiptDay(value: Date | string | null | undefined): number | undefined {
  if (!(value instanceof Date) && (typeof value !== 'string' || !value.trim())) return undefined
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? Math.floor((timestamp + JST) / DAY) : undefined
}

function similarity(left: unknown, right: unknown) {
  const a = new Set(words(left)), b = new Set(words(right))
  if (!a.size || !b.size) return 0
  return [...a].filter(word => b.has(word)).length / new Set([...a, ...b]).size
}

export function calculateMatchConfidence(receipt: ReceiptEvidence, transaction: TransactionEvidence) {
  let confidence = 0
  const factors: string[] = []
  const receiptCurrency = currency(receipt.currency), storedCurrency = transactionCurrency(transaction)
  if (receiptCurrency && storedCurrency && receiptCurrency !== storedCurrency) {
    return { confidence: 0, factors: ['Currency mismatch; compare the original charge before linking'], autoMatchEligible: false }
  }

  const exactAmount = finite(receipt.amount) && finite(transaction.amount) && receipt.amount === transaction.amount
  if (exactAmount) { confidence += 40; factors.push('Exact amount match') }
  else if (finite(receipt.amount) && finite(transaction.amount) && receipt.amount !== 0) {
    const difference = Math.abs(receipt.amount - transaction.amount) / Math.abs(receipt.amount)
    if (difference < 0.01) { confidence += 30; factors.push('Amount within 1%') }
    else if (difference < 0.05) { confidence += 20; factors.push('Amount within 5%') }
    else if (difference < 0.1) { confidence += 10; factors.push('Amount within 10%') }
  }

  const receiptDate = receiptDay(receipt.receiptDate), transactionDate = receiptDay(transaction.date)
  const days = receiptDate === undefined || transactionDate === undefined ? Infinity : Math.abs(receiptDate - transactionDate)
  if (days === 0) { confidence += 20; factors.push('Same Japanese calendar day') }
  else if (days <= 1) { confidence += 18; factors.push('Within 1 day') }
  else if (days <= 3) { confidence += 15; factors.push('Within 3 days') }
  else if (days <= 7) { confidence += 10; factors.push('Within 1 week') }

  const merchant = words(receipt.merchant).join(' ')
  // The buyer and generated ledger reference are not merchant evidence.
  const exactMerchant = !!merchant && [transaction.companyInfo, transaction.notes].some(value => words(value).join(' ') === merchant)
  const nameScore = Math.max(similarity(receipt.merchant, transaction.companyInfo), similarity(receipt.merchant, transaction.notes))
  if (exactMerchant) { confidence += 30; factors.push('Exact normalized merchant or statement text') }
  else if (nameScore > 0.4) { confidence += 15; factors.push('Partial merchant or statement text') }
  else if (nameScore > 0.2) { confidence += 5; factors.push('Weak merchant or statement text') }

  const sameCurrency = !!receiptCurrency && receiptCurrency === storedCurrency
  if (sameCurrency) { confidence += 10; factors.push('Same recorded currency') }
  else factors.push('Currency evidence incomplete')

  return {
    confidence,
    factors,
    autoMatchEligible: exactAmount && receipt.amount! > 0 && days <= 3 && exactMerchant && sameCurrency
      && transaction.type === '支出' && !['failed', 'cancelled', 'refunded'].includes(transaction.status || '')
  }
}

/** Search tolerances preserve suggestions; exact evidence is assessed separately. */
export function receiptCandidateWindow(receipt: ReceiptEvidence) {
  const filter: Record<string, unknown> = {}
  if (finite(receipt.amount)) {
    const tolerance = Math.abs(receipt.amount) * 0.15
    filter.amount = { $gte: receipt.amount - tolerance, $lte: receipt.amount + tolerance }
  }
  const day = receiptDay(receipt.receiptDate)
  if (day !== undefined) filter.date = { $gte: new Date((day - 14) * DAY - JST), $lt: new Date((day + 15) * DAY - JST) }
  return filter
}
