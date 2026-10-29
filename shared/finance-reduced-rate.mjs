// The reduced-rate (軽減税率) mark of one transaction, shared by the transaction list, the detail page and the export route. No Node
// imports: the page bundle loads it too. The 税区分's own rate decides when it has one, else the row's 税率; the name is never read.
export const REDUCED_RATE_MARK = '※軽減'
const REDUCED_RATE_START = Date.UTC(2019, 8, 30, 15) // 2019-10-01 00:00 JST
export function reducedRateMark(row) {
  if (!row || typeof row !== 'object') return ''
  const at = new Date(row.date).getTime()
  if (Number.isFinite(at) && at < REDUCED_RATE_START) return ''
  const c = row.taxCategoryId
  const rate = c && typeof c === 'object' && c.rate !== undefined && c.rate !== null ? c.rate : row.taxRate
  return Number(rate) === 8 ? REDUCED_RATE_MARK : ''
}
