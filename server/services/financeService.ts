import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile, link, unlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import mongoose from 'mongoose'
import { createError, getHeader, type H3Event } from 'h3'
import { ensureConnection } from '../config/database'
import { requireAuth } from '../middleware/auth'
import UserModel, { type IUser } from '../models/User'
import TransactionModel, { type ITransaction } from '../models/Transaction'
import AccountCategoryModel, { type IAccountCategory } from '../models/AccountCategory'
import { FinancialAccount, FinanceCollector, FinanceImport, FinanceEntry, initializeFinance } from '../models/Finance'
import { parseAmex, period, digest, MAX_BYTES, type AmexRow } from '../../shared/amex.mjs'

import { mappingRows } from '../../shared/finance-mapping.mjs'

const User = UserModel as mongoose.Model<IUser>
const Transaction = TransactionModel as mongoose.Model<ITransaction>
const AccountCategory = AccountCategoryModel as mongoose.Model<IAccountCategory>

export const fail = (statusCode: number, message: string): never => { throw createError({ statusCode, statusMessage: message }) }
export function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) fail(400, 'Invalid identifier')
  return value as string
}
export async function ready() { await ensureConnection(); await initializeFinance() }
export async function financeUser(event: H3Event) {
  const auth = requireAuth(event)
  await ready()
  if (!mongoose.isValidObjectId(auth.userId) || !await User.exists({ _id: auth.userId })) fail(401, 'User unavailable')
  return auth.userId
}
export async function financeDevice(event: H3Event): Promise<any> {
  const token = getHeader(event, 'authorization')?.replace(/^Bearer /, '') || ''
  if (!/^omfc_[a-f\d]{64}$/.test(token)) fail(401, 'Collector authorization required')
  await ready()
  const device: any = await FinanceCollector.findOne({ tokenHash: digest(token), revokedAt: null }).lean()
  if (!device || !await User.exists({ _id: device.ownerId })) fail(401, 'Collector unavailable')
  await FinanceCollector.updateOne({ _id: device._id, revokedAt: null }, { $set: { lastSeenAt: new Date() } })
  return device
}
export async function ownedAccount(ownerId: string, accountId: string): Promise<any> {
  const account: any = await FinancialAccount.findOne({ _id: id(accountId), ownerId }).lean()
  if (!account) fail(404, 'Account not found')
  return account
}
export async function ownedImport(ownerId: string, importId: string): Promise<any> {
  const batch: any = await FinanceImport.findOne({ _id: id(importId), ownerId }).lean()
  if (!batch) fail(404, 'Import not found')
  return batch
}
export function accountInput(body: any) {
  if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100) fail(400, 'Account name required')
  if (!Array.isArray(body.cardIdentifiers)) fail(400, 'Card identifiers must be an array')
  const cards = [...new Set<string>(body.cardIdentifiers)]
  if (!Array.isArray(body.cardIdentifiers) || !cards.length || cards.length > 30 || cards.some(v => typeof v !== 'string' || !/^\d{5}$/.test(v))) fail(400, 'Use the five-digit card identifiers from the Amex CSV')
  const email = (v: unknown) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length < 255
  if (!email(body.otpRecipient) || !email(body.otpMailbox)) fail(400, 'OTP email addresses required')
  if (!cards.includes(body.primaryCard)) fail(400, 'Primary card must be registered')
  return { name: body.name.trim(), cardIdentifiers: cards, primaryCard: body.primaryCard, otpRecipient: body.otpRecipient.toLowerCase(), otpMailbox: body.otpMailbox.toLowerCase(), forwarded: body.otpRecipient.toLowerCase() !== body.otpMailbox.toLowerCase() }
}
export async function createCollector(ownerId: string, body: any) {
  if (typeof body?.name !== 'string' || !body.name.trim() || body.name.length > 100 || !Array.isArray(body.accountIds) || !body.accountIds.length || body.accountIds.length > 30) fail(400, 'Collector name and accounts required')
  const accountIds = [...new Set(body.accountIds.map(id))]
  if (await FinancialAccount.countDocuments({ ownerId, _id: { $in: accountIds }, active: true }) !== accountIds.length) fail(400, 'Unknown account')
  const token = `omfc_${randomBytes(32).toString('hex')}`
  const device = await FinanceCollector.create({ ownerId, name: body.name.trim(), tokenHash: digest(token), accountIds })
  return { id: device._id.toString(), token }
}
export async function csvBody(event: H3Event): Promise<Buffer> {
  if (Number(getHeader(event, 'content-length') || 0) > MAX_BYTES) fail(413, 'CSV exceeds 5MB')
  const chunks: Buffer[] = []; let length = 0
  for await (const data of event.node.req) { const chunk = Buffer.from(data); length += chunk.length; if (length > MAX_BYTES) fail(413, 'CSV exceeds 5MB'); chunks.push(chunk) }
  return Buffer.concat(chunks)
}
function archivePath(hash: string) {
  if (!/^[a-f\d]{64}$/.test(hash)) fail(400, 'Invalid file hash')
  return path.join(process.env.OMF_DATA_DIR || path.join(os.homedir(), '.ohmyfinance'), 'imports', hash.slice(0, 2), `${hash}.csv`)
}
export async function originalFile(batch: any) { return readFile(archivePath(batch.hash)) }
export async function acceptImport(ownerId: string, account: any, bytes: Buffer, metadata: any, collectorId?: string) {
  let parsed: ReturnType<typeof parseAmex>, coverage: ReturnType<typeof period>
  try { parsed = parseAmex(bytes, account.cardIdentifiers); coverage = period(metadata) } catch (error: any) { fail(400, error.message) }
  if (metadata.pageCount !== undefined && (!Number.isSafeInteger(Number(metadata.pageCount)) || Number(metadata.pageCount) !== parsed!.rows.length)) fail(400, 'CSV row count does not match Amex page')
  const existing: any = await FinanceImport.findOne({ accountId: account._id, hash: parsed!.sha256 }).select('_id rowCount').lean()
  if (existing) return { id: existing._id.toString(), rowCount: existing.rowCount, duplicateFile: true }
  const target = archivePath(parsed!.sha256); await mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${randomUUID()}.partial`
  await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
  try { await link(temporary, target) } catch (error: any) { if (error.code !== 'EEXIST') throw error; if (digest(await readFile(target)) !== parsed!.sha256) fail(500, 'Archived file integrity mismatch') }
  finally { await unlink(temporary) }
  let batch: any
  try {
    batch = await FinanceImport.create({ ownerId, accountId: account._id, hash: parsed!.sha256, originalName: 'amex-activity.csv', bytes: bytes.length, encoding: parsed!.encoding, parserVersion: parsed!.parserVersion, period: coverage!, rows: parsed!.rows, rowCount: parsed!.rows.length, downloadedAt: new Date(), collectorId })
  } catch (error: any) { if (error.code !== 11000) throw error; batch = await FinanceImport.findOne({ accountId: account._id, hash: parsed!.sha256 }) }
  await FinancialAccount.updateOne({ _id: account._id, ownerId }, { $set: { lastSuccessAt: new Date(), lastMessage: `${parsed!.rows.length} rows downloaded` } })
  return { id: batch._id.toString(), rowCount: batch.rowCount, duplicateFile: false }
}

async function candidates(account: any, rows: AmexRow[]) {
  const dates = [...new Set(rows.map(row => row.purchaseDate))]
  const cards = account.cardIdentifiers.map((v: string) => v.slice(-4))
  const sorted = dates.sort()
  if (!sorted.length) return []
  const records: any[] = await Transaction.find({ date: { $gte: new Date(Date.parse(sorted[0]) - 9*3600000), $lt: new Date(Date.parse(sorted.at(-1)!) + 86400000) }, amount: { $in: rows.map(r => Math.abs(r.amount)) }, 'metadata.financeEntryId': { $exists: false }, $or: [{ cardNumber: { $in: [...cards, ...account.cardIdentifiers] } }, { cardNumber: { $exists: false } }, { cardNumber: '' }, { cardNumber: null }] }).select('_id date amount notes productName cardNumber type').limit(10001).lean()
  if (records.length > 10000) fail(409, 'Too many historical matches; split the import period')
  return records
}
export async function reviewImport(ownerId: string, importId: string) {
  const batch = await ownedImport(ownerId, importId)
  const account = await ownedAccount(ownerId, batch.accountId.toString())
  const rows: AmexRow[] = batch.rows
  const [entries, legacy] = await Promise.all([FinanceEntry.find({ accountId: account._id, $or: [{ fingerprint: { $in: rows.map(r => r.fingerprint) } }, { 'row.purchaseDate': { $in: rows.map(r => r.purchaseDate) }, 'row.amount': { $in: rows.map(r => r.amount) } }] }).limit(20001).lean(), candidates(account, rows)])
  if (entries.length > 20000) fail(409, 'Too many source matches; split the import period')
  const byKey = new Map(entries.map((entry: any) => [entry.key, entry]))
  const view = rows.map(row => {
    const entry: any = byKey.get(row.key)
    const manual: any = byKey.get(`${row.key}:manual:${batch._id}:${row.line}`)
    const matches = legacy.filter(v => [new Date(v.date).toISOString().slice(0, 10), new Date(new Date(v.date).getTime()+9*3600000).toISOString().slice(0,10)].includes(row.purchaseDate) && v.amount === Math.abs(row.amount)).slice(0,10)
    let state = row.kind === 'repayment' ? 'repayment' : row.kind === 'credit_review' ? 'credit_review' : 'new'
    if (entry) state = entry.importId.toString() === batch._id.toString() ? entry.state === 'posted' ? 'posted' : entry.linkedExisting ? 'legacy_review' : 'new' : entry.state !== 'posted' ? 'in_progress' : entry.coverage === batch.period.key ? 'duplicate' : 'overlap_review'
    else if (matches.length && row.kind === 'expense') state = 'legacy_review'
    else if (row.kind === 'expense' && entries.some((e: any) => e.fingerprint !== row.fingerprint && e.row.purchaseDate === row.purchaseDate && e.row.cardIdentifier === row.cardIdentifier && e.row.amount === row.amount && e.row.description.normalize('NFC') === row.description.normalize('NFC'))) state = 'correction_review'
    if (manual?.state === 'posted') state = 'posted'
    return { ...row, state, skipped: batch.decisions?.[String(row.line)] === 'skip', transactionId: manual?.transactionId || entry?.transactionId, existing: matches.map(v => ({ id: v._id.toString(), date: v.date, amount: v.amount, description: v.notes || v.productName || '', cardNumber: v.cardNumber || '' })) }
  })
  const { commitLease: _lease, commitLeaseUntil: _leaseUntil, ...visibleAccount } = account
  return { id: batch._id.toString(), account: visibleAccount, period: batch.period, rowCount: batch.rowCount, downloadedAt: batch.downloadedAt, hash: batch.hash, mappingPreview: !!batch.mappingPreview, rows: view }
}

export async function reviewMapping(ownerId: string, importId: string) {
  const batch = await ownedImport(ownerId, importId)
  const account = await ownedAccount(ownerId, batch.accountId.toString())
  let rows: ReturnType<typeof mappingRows>
  try { rows = mappingRows(batch) } catch { fail(409, 'Saved mapping does not match the original statement; review the source before continuing') }
  return { id: batch._id.toString(), account: { id: account._id.toString(), name: account.name }, period: batch.period, preparedAt: batch.mappingPreview?.preparedAt || null, rows: rows! }
}

export async function commitImport(ownerId: string, importId: string, body: any) {
  if (!Array.isArray(body?.decisions) || !body.decisions.length || body.decisions.length > 5000) fail(400, 'Select rows to review')
  const initial = await ownedImport(ownerId, importId)
  // External client/category labels are preview data, not ledger ObjectIds.
  if (initial.mappingPreview && body.decisions.some((decision: any) => decision?.action === 'import')) fail(409, 'This statement has a classification preview; ledger posting requires the client and category mappings to be finalized')
  const lease = randomUUID(), now = new Date()
  const locked = await FinancialAccount.findOneAndUpdate({ _id: initial.accountId, ownerId, $or: [{ commitLeaseUntil: { $exists: false } }, { commitLeaseUntil: null }, { commitLeaseUntil: { $lte: now } }] }, { $set: { commitLease: lease, commitLeaseUntil: new Date(Date.now() + 60000) } }, { new: true })
  if (!locked) fail(409, 'Another import is being reviewed; retry shortly')
  let posted = 0, linked = 0, skipped = 0
  try {
    const view = await reviewImport(ownerId, importId)
    const rows = new Map(view.rows.map(r => [r.line, r]))
    const seen = new Set<number>()
    if (body.accountCategoryId && !await AccountCategory.exists({ _id: id(body.accountCategoryId) })) fail(400, 'Unknown accounting category')
    // Validate the complete request before recording any decision. Writes remain resumable after an interruption.
    for (const decision of body.decisions) {
      const row = rows.get(decision?.line)
      if (!row || seen.has(decision.line) || !['import','skip','link'].includes(decision.action)) fail(400, 'Invalid review decision')
      seen.add(decision.line)
      if (['posted','duplicate'].includes(row.state) || decision.action === 'skip') continue
      if (row.state === 'in_progress') fail(409, 'An earlier import must finish before this row can be reviewed')
      if (row.kind !== 'expense') fail(400, 'Repayments and credits are retained for reconciliation; only spending can be posted here')
      if (['legacy_review','overlap_review','correction_review'].includes(row.state) && decision.confirmNew !== true && decision.action !== 'link') fail(409, 'Resolve the possible duplicate before posting')
      if (decision.action === 'link' && (row.state !== 'legacy_review' || !row.existing.some(v => v.id === decision.transactionId))) fail(400, 'Choose an exact historical candidate')
    }
    for (const decision of body.decisions) {
      const row = rows.get(decision.line)!
      if (row.state === 'posted' || row.state === 'duplicate') { skipped++; continue }
      if (decision.action === 'skip') { await FinanceImport.updateOne({ _id: initial._id, ownerId }, { $set: { [`decisions.${row.line}`]: 'skip' } }); skipped++; continue }
      if (row.kind !== 'expense') fail(400, 'Repayments and credits are retained for reconciliation; only spending can be posted here')
      if (['legacy_review','overlap_review','correction_review'].includes(row.state) && decision.confirmNew !== true && decision.action !== 'link') fail(409, 'Resolve the possible duplicate before posting')
      const renewed = await FinancialAccount.updateOne({ _id: initial.accountId, commitLease: lease, commitLeaseUntil: { $gt: new Date() } }, { $set: { commitLeaseUntil: new Date(Date.now() + 60000) } })
      if (!renewed.matchedCount) fail(409, 'Import lease expired; retry')
      const key = row.state === 'overlap_review' && decision.action === 'import' ? `${row.key}:manual:${initial._id}:${row.line}` : row.key
      let transactionId = new mongoose.Types.ObjectId()
      if (decision.action === 'link') {
        const selected = row.existing.find(v => v.id === decision.transactionId)
        if (!selected || row.state !== 'legacy_review') fail(400, 'Choose an exact historical candidate')
        transactionId = new mongoose.Types.ObjectId(id(decision.transactionId))
      }
      const entry: any = await FinanceEntry.findOneAndUpdate({ accountId: initial.accountId, key }, { $setOnInsert: { ownerId, fingerprint: row.fingerprint, occurrence: row.occurrence, coverage: initial.period.key, importId: initial._id, line: row.line, transactionId, row, linkedExisting: decision.action === 'link', state: 'reserved' } }, { upsert: true, new: true })
      if (entry.importId.toString() !== initial._id.toString()) fail(409, 'Source row was claimed by another import; refresh the review')
      if (entry.state === 'posted') { skipped++; continue }
      if (entry.linkedExisting !== (decision.action === 'link') || (entry.linkedExisting && entry.transactionId.toString() !== decision.transactionId)) fail(409, 'Resume the previously selected action for this row')
      if (entry.linkedExisting) {
        // A link records evidence without rewriting the user's existing accounting data.
        if (!await Transaction.exists({ _id: entry.transactionId })) fail(409, 'Historical transaction no longer exists')
        linked++
      } else {
        await Transaction.updateOne({ _id: entry.transactionId }, { $setOnInsert: {
          referenceNumber: `AMEX-${entry._id}`, date: new Date(row.purchaseDate), amount: row.amount, type: '支出', status: 'completed',
          accountCategoryId: body.accountCategoryId || undefined, paymentMethod: 'クレジットカード', cardNumber: row.cardIdentifier.slice(-4),
          hasReceipt: false, notes: row.description, items: [], attachments: [], tags: ['imported','amex'],
          metadata: { financeEntryId: entry._id.toString(), financialAccountId: initial.accountId.toString(), importBatchId: initial._id.toString(), importSource: 'amex', originalCardIdentifier: row.cardIdentifier, processingDate: row.processingDate, currency: row.currency, foreignAmount: row.foreignAmount, exchangeRate: row.exchangeRate },
          timeline: [{ type: 'imported', title: 'Amex取込', timestamp: new Date(), description: `${view.account.name} / ${initial.period.start} - ${initial.period.end}` }]
        } }, { upsert: true, runValidators: true })
        posted++
      }
      await FinanceEntry.updateOne({ _id: entry._id }, { $set: { state: 'posted' } })
      await FinanceImport.updateOne({ _id: initial._id }, { $unset: { [`decisions.${row.line}`]: '' } })
    }
    return { posted, linked, skipped }
  } finally { await FinancialAccount.updateOne({ _id: initial.accountId, commitLease: lease }, { $unset: { commitLease: '', commitLeaseUntil: '' } }) }
}
