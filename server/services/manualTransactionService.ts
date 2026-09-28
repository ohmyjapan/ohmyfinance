import { createHash } from 'node:crypto'
import { createError } from 'h3'
import Transaction, { type ITransaction } from '../models/Transaction'
import { ensureConnection } from '../config/database'
import { withReceiptLinks } from './receiptLinkService'
import type { LedgerAccess } from './ledgerAccessService'

const textFields = ['referenceNumber', 'companyInfo', 'invoiceNumber', 'receiptNumber', 'trackingNumber', 'paymentMethod', 'cardNumber', 'productName', 'janCode', 'notes']
const idFields = ['customerId', 'accountCategoryId', 'subAccountCategoryId', 'taxCategoryId', 'supplierId', 'transactionCategoryId', 'sourceId']
const numberFields = ['taxRate', 'productPrice']
const itemFields = ['productName', 'janCode', 'productUrl', 'quantity', 'unitPrice', 'taxCategoryId', 'taxRate']
const allowed = new Set(['date', 'amount', 'type', 'status', 'items', 'tags', ...textFields, ...idFields, ...numberFields])
const invalid = (message: string) => createError({ statusCode: 400, statusMessage: message })
const unavailable = () => createError({ statusCode: 503, statusMessage: 'Save outcome unavailable. Keep the original request key and reconcile before retrying.' })
const empty = (value: unknown) => value === undefined || value === null || value === ''

export function manualRequestKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) throw invalid('A 32-character lowercase hexadecimal Idempotency-Key is required')
  return value
}
function object(value: any, fields: Set<string>) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid('Manual purchase must be an object')
  if (Object.keys(value).some(key => !fields.has(key))) throw invalid('Unsupported manual purchase field')
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw invalid('Purchase text must be a string')
  return value
}
function number(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value))) throw invalid('Purchase numbers must be finite')
  return Number(value)
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) throw invalid('Invalid purchase selection ID')
  return value.toLowerCase()
}
function date(value: unknown): string {
  // Date-only values retain the existing API's UTC interpretation. Timestamps
  // must carry a timezone so hashing never depends on the server timezone.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) throw invalid('Use an ISO purchase date with an explicit timezone for timestamps')
  const day = new Date(value.slice(0, 10)), parsed = new Date(value)
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10) || !Number.isFinite(parsed.getTime())) throw invalid('Invalid purchase date')
  return parsed.toISOString()
}
function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
  return value
}

/** Version 1 describes purchase intent only; generated IDs/events are never hashed. */
export function canonicalManualPurchase(input: unknown) {
  object(input, allowed)
  const body = input as Record<string, any>
  const payload: Record<string, any> = {
    date: date(body.date), amount: number(body.amount),
    type: empty(body.type) ? '支出' : text(body.type), status: empty(body.status) ? 'pending' : text(body.status),
    items: [], tags: []
  }
  for (const key of textFields) if (!empty(body[key])) payload[key] = text(body[key])
  for (const key of idFields) if (!empty(body[key])) payload[key] = id(body[key])
  for (const key of numberFields) if (!empty(body[key])) payload[key] = number(body[key])
  if (body.items != null) {
    if (!Array.isArray(body.items)) throw invalid('Purchase items must be an array')
    payload.items = body.items.map((item: any) => {
      object(item, new Set(itemFields))
      const normalized: Record<string, any> = { quantity: item.quantity === undefined ? 1 : number(item.quantity), unitPrice: number(item.unitPrice) }
      for (const key of ['productName', 'janCode', 'productUrl']) if (!empty(item[key])) normalized[key] = text(item[key])
      if (!empty(item.taxCategoryId)) normalized.taxCategoryId = id(item.taxCategoryId)
      if (!empty(item.taxRate)) normalized.taxRate = number(item.taxRate)
      return normalized
    })
  }
  if (body.tags != null) {
    if (!Array.isArray(body.tags)) throw invalid('Purchase tags must be an array')
    payload.tags = body.tags.map(text)
  }
  const normalized = stable(payload)
  const validation = new Transaction(normalized).validateSync()
  if (validation) throw invalid('Invalid manual purchase fields')
  return { payload: normalized, payloadHash: createHash('sha256').update(JSON.stringify(normalized)).digest('hex') }
}

async function identityIndex() {
  await Transaction.init()
  const indexes = await Transaction.collection.indexes()
  const valid = indexes.some((index: any) => index.unique === true &&
    Object.keys(index.key).length === 2 && index.key.organizationId === 1 && index.key['manualCreate.key'] === 1 &&
    JSON.stringify(stable(index.partialFilterExpression)) === JSON.stringify({ 'manualCreate.key': { $type: 'string' } }))
  if (!valid) throw unavailable()
}
const find = (access: LedgerAccess, key: string) => Transaction.findOne({ organizationId: access.organizationId, 'manualCreate.key': key }).select('+manualCreate').read('primary').lean<ITransaction>()
async function outcome(access: LedgerAccess, row: any) {
  if (!row) return { state: 'absent' as const }
  const transactionId = String(row._id)
  if (row.deletedAt) return { state: 'deleted' as const, transactionId }
  const { manualCreate, deletedAt, deletedBy, ...visible } = row
  return { state: 'saved' as const, transactionId, transaction: (await withReceiptLinks(access, [{ ...visible, id: transactionId }]))[0] }
}

/** Absence is an observation, never permission to allocate a replacement key. */
export async function reconcileManualTransaction(access: LedgerAccess, value: unknown) {
  const key = manualRequestKey(value)
  await ensureConnection()
  return outcome(access, await find(access, key))
}

export async function createManualTransaction(access: LedgerAccess, value: unknown, input: unknown) {
  const key = manualRequestKey(value), { payload, payloadHash } = canonicalManualPurchase(input)
  await ensureConnection()
  await identityIndex()
  let row = await find(access, key)
  if (!row) {
    const document = new Transaction({
      ...payload, organizationId: access.organizationId,
      manualCreate: { key, payloadHash, schemaVersion: 1, createdBy: access.userId },
      timeline: [{ type: 'created', title: '取引作成', timestamp: new Date(), description: '取引レコードが作成されました' }]
    })
    try {
      await document.save({ w: 'majority', j: true })
    } catch (error: any) {
      // Only the expected company/request collision can mean this intent won.
      if (error.code !== 11000 || error.keyPattern?.organizationId !== 1 || error.keyPattern?.['manualCreate.key'] !== 1 || Object.keys(error.keyPattern).length !== 2) throw error
    }
    row = await find(access, key)
    if (!row) throw unavailable()
  }
  if (row.manualCreate?.schemaVersion !== 1 || row.manualCreate.payloadHash !== payloadHash) throw createError({
    statusCode: 409, statusMessage: 'This request key belongs to different purchase details. Reconcile the original save; do not replace its key.'
  })
  return outcome(access, row)
}
