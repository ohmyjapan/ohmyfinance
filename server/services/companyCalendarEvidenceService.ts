// Calendar supplier originals and the owner's payment verification (plan omf-calendar-evidence-20261029 §2). The native routes,
// company Navi and the backfill script call this one service; the caller owns fresh authorization and passes the selected company.
// Originals are retained by content hash under OMF_DATA_DIR (temp file + hard link + digest, as financeBankStatementService), registered
// as versions of an invoice identity and linked to saved calendar entries; a link never creates or edits a Payment. The verification
// record is the owner's statement ('unconfirmed' = 銀行照合待ち, 'owner_confirmed'), written alone with its Navi marker: never the
// lifecycle status, settledAt, amount or dates. The state enum has no bank_matched/conflict until a bank unit exists, so Mongoose is
// the only validator of a state. Reads give names, sizes, hashes, dates and email text; never a filesystem path.
import mongoose from 'mongoose'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile, link, unlink, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createError } from 'h3'
import { Payment, calendarCurrencies } from '../models/Payment'
import { CalendarEvidenceInvoice, CalendarEvidenceSource, CalendarEvidenceLink, initializeCalendarEvidence } from '../models/CalendarEvidence'
import { verificationSummary } from '../../shared/finance-calendar-verification.mjs'

export const CALENDAR_ORIGINAL_MAX_BYTES = 25 * 1024 * 1024
export const EVIDENCE_FILE_KINDS = ['invoice-pdf', 'companion', 'email'] as const
export const EVIDENCE_SOURCE_STATES = ['active', 'superseded'] as const
const MEANING = 'Supplier originals linked to this saved calendar entry: what the supplier sent (invoice identity, versions, files, email text), never proof that the bill was paid. The verification record is the owner\'s statement (unconfirmed = 銀行照合待ち, owner_confirmed), never a bank match; bank matching is not available. A link changes no amount, date or status and moves no money.'
const fail = (statusCode: number, statusMessage: string): never => { throw createError({ statusCode, statusMessage }) }
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const HEX64 = /^[a-f0-9]{64}$/, HEX24 = /^[a-fA-F0-9]{24}$/, DAY = /^\d{4}-\d{2}-\d{2}$/
const iso = (v: any) => { if (!v) return null; const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toISOString() : null }
const dataDir = () => process.env.OMF_DATA_DIR || path.join(os.homedir(), '.ohmyfinance')
const location = (organizationId: mongoose.Types.ObjectId, sha256: string) => { if (!HEX64.test(sha256)) fail(400, 'Invalid file identifier'); return path.join(dataDir(), 'calendar-evidence', String(organizationId), sha256) }
const objectId = (value: unknown, statusCode: number, message: string) => { if (typeof value !== 'string' || !HEX24.test(value)) fail(statusCode, message); return new mongoose.Types.ObjectId(value as string) }
const paymentObjectId = (paymentId: string) => objectId(paymentId, 400, 'Invalid payment identifier')
const evidenceObjectId = (evidenceId: string) => objectId(evidenceId, 400, 'Invalid evidence identifier')
const actorObjectId = (actorId: string) => objectId(actorId, 400, 'Invalid actor')
const text = (value: unknown, max: number, what: string) => { const s = typeof value === 'string' ? value.trim() : ''; if (!s || s.length > max) fail(400, 'Invalid ' + what); return s }
const dayKey = (value: unknown, what: string) => { const s = typeof value === 'string' ? value : ''; if (!DAY.test(s) || !Number.isFinite(Date.parse(s + 'T00:00:00.000Z')) || new Date(s + 'T00:00:00.000Z').toISOString().slice(0, 10) !== s) fail(400, 'Invalid ' + what); return s }
let ready: Promise<void> | null = null
const init = () => ready || (ready = initializeCalendarEvidence().catch(error => { ready = null; throw error }))

// ---- Views (no paths, no bytes, no actor ids)
const identityView = (v: any) => ({ id: String(v._id), supplier: v.supplier, invoiceNumber: v.invoiceNumber, servicePeriod: { from: v.servicePeriod?.from, to: v.servicePeriod?.to }, currency: v.currency, activeSourceId: v.activeSourceId ? String(v.activeSourceId) : null, registeredAt: iso(v.createdAt) })
const sourceView = (s: any) => ({ id: String(s._id), status: s.status, provider: s.provider, messageId: s.messageId, receivedAt: iso(s.receivedAt), issuedOn: s.issuedOn || null, totalAmount: s.totalAmount ?? null, email: { name: s.email?.name, size: s.email?.size, sha256: s.email?.sha256, text: s.email?.text || '' }, files: (s.files || []).map((f: any) => ({ fileId: f.fileId, name: f.name, mimeType: f.mimeType, size: f.size, kind: f.kind })), supersededReason: s.supersededReason || null })
async function identityWithVersions(organizationId: mongoose.Types.ObjectId, invoiceId: mongoose.Types.ObjectId) {
  const invoice: any = await CalendarEvidenceInvoice.findOne({ _id: invoiceId, organizationId }).lean()
  if (!invoice) return null
  const sources: any[] = await CalendarEvidenceSource.find({ organizationId, invoiceId: invoice._id }).sort({ receivedAt: -1, _id: -1 }).lean()
  const active = sources.find(s => String(s._id) === String(invoice.activeSourceId)) || null
  return { ...identityView(invoice), active: active ? sourceView(active) : null, versions: sources.filter(s => s !== active).map(sourceView) }
}

// ---- Originals: retained by content hash; identical bytes are one file. Over 25MB is refused before any write.
export async function retainCalendarOriginal(organizationId: mongoose.Types.ObjectId, bytes: Buffer, expectedSha256?: string) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) fail(400, 'Empty original')
  if (bytes.length > CALENDAR_ORIGINAL_MAX_BYTES) fail(413, 'An original must be at most 25MB; nothing was saved')
  const sha256 = digest(bytes)
  if (expectedSha256 !== undefined && expectedSha256 !== sha256) fail(400, 'Original file integrity mismatch')
  const target = location(organizationId, sha256)
  await mkdir(path.dirname(target), { recursive: true })
  const temp = target + '.' + randomUUID() + '.partial'
  await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 })
  try { await link(temp, target) } catch (error: any) { if (error.code !== 'EEXIST') throw error; if (digest(await readFile(target)) !== sha256) fail(500, 'Original file integrity mismatch') } finally { await unlink(temp) }
  return { sha256, size: bytes.length }
}

// ---- Registration: identity find-or-create, one version per email within the identity (existing returned), explicit status decides the active pointer.
export type EvidenceIdentityInput = { supplier: string, invoiceNumber: string, servicePeriod: { from: string, to: string }, currency: string }
export type EvidenceFileInput = { fileId: string, name: string, mimeType: string, size: number, kind: typeof EVIDENCE_FILE_KINDS[number] }
export type EvidenceSourceInput = { provider: string, messageId: string, receivedAt: string | Date, issuedOn?: string | null, totalAmount?: number | null, email: { sha256: string, name: string, size: number, text?: string }, files?: EvidenceFileInput[], status: typeof EVIDENCE_SOURCE_STATES[number], supersededReason?: string | null }
export async function registerCalendarEvidence(organizationId: mongoose.Types.ObjectId, input: { identity: EvidenceIdentityInput, source: EvidenceSourceInput }) {
  await init()
  const i: any = input?.identity || {}, s: any = input?.source || {}
  const identity = { supplier: text(i.supplier, 200, 'supplier'), invoiceNumber: text(i.invoiceNumber, 100, 'invoice number'), servicePeriod: { from: dayKey(i.servicePeriod?.from, 'service period'), to: dayKey(i.servicePeriod?.to, 'service period') }, currency: typeof i.currency === 'string' && calendarCurrencies.includes(i.currency) ? i.currency : fail(400, 'Unsupported evidence currency') }
  if (identity.servicePeriod.from > identity.servicePeriod.to) fail(400, 'Invalid service period')
  if (!EVIDENCE_SOURCE_STATES.includes(s.status)) fail(400, 'Invalid source status')
  const email: any = s.email || {}
  if (!HEX64.test(String(email.sha256))) fail(400, 'Invalid email hash')
  const emailFile: EvidenceFileInput = { fileId: email.sha256, name: text(email.name, 200, 'email name'), mimeType: 'message/rfc822', size: Number(email.size), kind: 'email' }
  const files: EvidenceFileInput[] = (Array.isArray(s.files) ? s.files : []).map((f: any) => ({ fileId: String(f?.fileId), name: text(f?.name, 200, 'file name'), mimeType: text(f?.mimeType, 100, 'file type'), size: Number(f?.size), kind: f?.kind }))
  if (!files.some(f => f.kind === 'email' && f.fileId === emailFile.fileId)) files.push(emailFile)
  for (const f of files) {
    if (!HEX64.test(f.fileId) || !EVIDENCE_FILE_KINDS.includes(f.kind) || !Number.isSafeInteger(f.size) || f.size < 1 || f.size > CALENDAR_ORIGINAL_MAX_BYTES) fail(400, 'Invalid evidence file')
    // Every file must already be retained (by this company) with exactly these bytes.
    let retained: any = null
    try { retained = await stat(location(organizationId, f.fileId)) } catch { fail(400, 'Retain the original before registering it') }
    if (retained.size !== f.size) fail(400, 'Retained original size differs')
  }
  const receivedAt = new Date(s.receivedAt); if (!Number.isFinite(receivedAt.getTime())) fail(400, 'Invalid receivedAt')
  const issuedOn = s.issuedOn === undefined || s.issuedOn === null || s.issuedOn === '' ? undefined : dayKey(s.issuedOn, 'issue date')
  const totalAmount = s.totalAmount === undefined || s.totalAmount === null ? undefined : Number(s.totalAmount)
  if (totalAmount !== undefined && !Number.isFinite(totalAmount)) fail(400, 'Invalid total amount')
  const emailText = typeof email.text === 'string' ? email.text.slice(0, 20000) : ''
  const identityFilter = { organizationId, supplier: identity.supplier, invoiceNumber: identity.invoiceNumber, 'servicePeriod.from': identity.servicePeriod.from, 'servicePeriod.to': identity.servicePeriod.to }
  // Find or create: an existing identity is read, never touched (a repeat registration leaves it byte-identical).
  let invoice: any = await CalendarEvidenceInvoice.findOne(identityFilter).lean()
  if (!invoice) {
    try { invoice = (await CalendarEvidenceInvoice.create({ organizationId, supplier: identity.supplier, invoiceNumber: identity.invoiceNumber, servicePeriod: identity.servicePeriod, currency: identity.currency, activeSourceId: null })).toObject() }
    catch (error: any) { if (error?.name === 'ValidationError') fail(400, 'Invalid evidence identity'); if (error?.code !== 11000) throw error; invoice = await CalendarEvidenceInvoice.findOne(identityFilter).lean(); if (!invoice) throw error }
  }
  if (invoice.currency !== identity.currency) fail(409, 'This invoice identity is registered with another currency')
  const sourceFilter = { organizationId, invoiceId: invoice._id, 'email.sha256': emailFile.fileId }
  let outcome: 'registered' | 'existing' = 'registered'
  let source: any = await CalendarEvidenceSource.findOne(sourceFilter).lean()
  if (source) outcome = 'existing'
  else {
    try { source = (await CalendarEvidenceSource.create({ organizationId, invoiceId: invoice._id, provider: text(s.provider, 40, 'provider'), messageId: text(s.messageId, 200, 'message id'), receivedAt, issuedOn, totalAmount, email: { sha256: emailFile.fileId, name: emailFile.name, size: emailFile.size, text: emailText }, files, status: s.status, supersededReason: typeof s.supersededReason === 'string' ? s.supersededReason.slice(0, 500) : undefined })).toObject() }
    catch (error: any) {
      if (error?.name === 'ValidationError' || error?.name === 'CastError') fail(400, 'Invalid evidence source')
      if (error?.code !== 11000) throw error
      source = await CalendarEvidenceSource.findOne(sourceFilter).lean(); if (!source) throw error
      outcome = 'existing'
    }
  }
  // The explicit status of a new registration decides the version the calendar shows; an existing version changes nothing.
  if (outcome === 'registered' && s.status === 'active') { await CalendarEvidenceInvoice.updateOne({ _id: invoice._id, organizationId }, { $set: { activeSourceId: source._id } }); invoice = { ...invoice, activeSourceId: source._id } }
  return { outcome, evidence: identityView(invoice), source: sourceView(source) }
}

// ---- Reads
export async function listPaymentEvidence(organizationId: mongoose.Types.ObjectId, paymentId: string) {
  await init()
  const payment: any = await Payment.findOne({ _id: paymentObjectId(paymentId), organizationId, suppressedAt: { $exists: false } }).select('status updatedAt paymentVerification').lean()
  if (!payment) fail(404, 'Payment not found')
  const links: any[] = await CalendarEvidenceLink.find({ organizationId, paymentId: payment._id, unlinkedAt: null }).sort({ linkedAt: 1, _id: 1 }).lean()
  const evidence: any[] = []
  for (const l of links) { const v = await identityWithVersions(organizationId, l.invoiceId); if (v) evidence.push({ ...v, linkedAt: iso(l.linkedAt) }) }
  return { payment: { id: String(payment._id), status: payment.status, updatedAt: iso(payment.updatedAt) }, verification: verificationSummary(payment.paymentVerification), evidence, meaning: MEANING }
}
export async function getCalendarEvidence(organizationId: mongoose.Types.ObjectId, evidenceId: string) {
  await init()
  const _id = evidenceObjectId(evidenceId)
  const evidence = await identityWithVersions(organizationId, _id)
  if (!evidence) fail(404, 'Evidence not found')
  const links: any[] = await CalendarEvidenceLink.find({ organizationId, invoiceId: _id, unlinkedAt: null }).sort({ linkedAt: 1, _id: 1 }).lean()
  return { evidence, links: links.map(l => ({ paymentId: String(l.paymentId), linkedAt: iso(l.linkedAt) })), meaning: MEANING }
}
// GUARD: the file must belong to a version of that identity in that company (404 otherwise); the stored bytes must still hash to their id.
export async function readCalendarOriginal(organizationId: mongoose.Types.ObjectId, evidenceId: string, fileId: string) {
  await init()
  const _id = evidenceObjectId(evidenceId)
  if (typeof fileId !== 'string' || !HEX64.test(fileId)) fail(400, 'Invalid file identifier')
  const invoice: any = await CalendarEvidenceInvoice.findOne({ _id, organizationId }).select('_id').lean()
  if (!invoice) fail(404, 'Evidence not found')
  const source: any = await CalendarEvidenceSource.findOne({ organizationId, invoiceId: invoice._id, 'files.fileId': fileId }).select('files').lean()
  if (!source) fail(404, 'File not found')
  const file = source.files.find((f: any) => f.fileId === fileId)
  let bytes: Buffer
  try { bytes = await readFile(location(organizationId, fileId)) } catch { return fail(404, 'File not found') }
  if (digest(bytes) !== fileId) fail(400, 'Original file integrity mismatch')
  return { file: { fileId, name: file.name, mimeType: file.mimeType, size: file.size }, bytes }
}

// ---- Links: one row per (company, identity, entry); link = one upsert (relink revives an unlinked row), unlink = one $set; the Navi
// marker rides in that same update. Outcomes linked | already_linked | unlinked | already_unlinked. A link writes nothing on a Payment.
export type EvidenceLinkOperation = { actorId: string, naviOperation?: Record<string, unknown> }
async function ownedPair(organizationId: mongoose.Types.ObjectId, evidenceId: string, paymentId: string) {
  const identity: any = await CalendarEvidenceInvoice.findOne({ _id: evidenceObjectId(evidenceId), organizationId }).select('_id invoiceNumber').lean()
  if (!identity) fail(404, 'Evidence not found')
  const payment: any = await Payment.findOne({ _id: paymentObjectId(paymentId), organizationId, suppressedAt: { $exists: false } }).select('_id').lean()
  if (!payment) fail(404, 'Payment not found')
  return { identity, payment }
}
const sameMarker = (row: any, operation: EvidenceLinkOperation) => !!operation.naviOperation && row?.naviOperation?.operationId === operation.naviOperation.operationId && row?.naviOperation?.payloadHash === operation.naviOperation.payloadHash
const historyEntry = (action: 'linked' | 'unlinked', at: Date, by: mongoose.Types.ObjectId, operation: EvidenceLinkOperation) => ({ action, at, by, ...(operation.naviOperation?.operationId ? { operationId: String(operation.naviOperation.operationId) } : {}) })
export async function linkCalendarEvidence(organizationId: mongoose.Types.ObjectId, evidenceId: string, paymentId: string, operation: EvidenceLinkOperation) {
  await init()
  const { identity, payment } = await ownedPair(organizationId, evidenceId, paymentId)
  const now = new Date(), actor = actorObjectId(operation.actorId)
  const attempt = () => CalendarEvidenceLink.findOneAndUpdate({ organizationId, invoiceId: identity._id, paymentId: payment._id, unlinkedAt: { $ne: null } }, { $set: { linkedAt: now, linkedBy: actor, unlinkedAt: null, unlinkedBy: null, ...operation.naviOperation ? { naviOperation: operation.naviOperation } : {} }, $push: { history: { $each: [historyEntry('linked', now, actor, operation)], $slice: -50 } } }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }).lean()
  let row: any = null, outcome: 'linked' | 'already_linked' = 'linked'
  try { row = await attempt() } catch (error: any) {
    if (error?.code !== 11000) throw error
    // The pair is linked already (or a concurrent writer just linked it): returned as it is. A row unlinked meanwhile is relinked once.
    const existing: any = await CalendarEvidenceLink.findOne({ organizationId, invoiceId: identity._id, paymentId: payment._id }).lean()
    if (!existing) throw error
    if (existing.unlinkedAt) { try { row = await attempt() } catch (again: any) { if (again?.code !== 11000) throw again } }
    if (!row) { row = await CalendarEvidenceLink.findOne({ organizationId, invoiceId: identity._id, paymentId: payment._id }).lean(); outcome = sameMarker(row, operation) ? 'linked' : 'already_linked' }
  }
  return { outcome, link: row }
}
export async function unlinkCalendarEvidence(organizationId: mongoose.Types.ObjectId, evidenceId: string, paymentId: string, operation: EvidenceLinkOperation) {
  await init()
  const { identity, payment } = await ownedPair(organizationId, evidenceId, paymentId)
  const now = new Date(), actor = actorObjectId(operation.actorId)
  const row: any = await CalendarEvidenceLink.findOneAndUpdate({ organizationId, invoiceId: identity._id, paymentId: payment._id, unlinkedAt: null }, { $set: { unlinkedAt: now, unlinkedBy: actor, ...operation.naviOperation ? { naviOperation: operation.naviOperation } : {} }, $push: { history: { $each: [historyEntry('unlinked', now, actor, operation)], $slice: -50 } } }, { new: true, runValidators: true }).lean()
  if (row) return { outcome: 'unlinked' as const, link: row }
  const current: any = await CalendarEvidenceLink.findOne({ organizationId, invoiceId: identity._id, paymentId: payment._id }).lean()
  return { outcome: sameMarker(current, operation) ? 'unlinked' as const : 'already_unlinked' as const, link: current || null }
}
// The marker of the last link/unlink of a pair (company Navi recovery after a lost reply); null when none.
export async function calendarEvidenceLinkMarker(organizationId: mongoose.Types.ObjectId, evidenceId: string, paymentId: string) {
  if (typeof evidenceId !== 'string' || !HEX24.test(evidenceId) || typeof paymentId !== 'string' || !HEX24.test(paymentId)) return null
  const row: any = await CalendarEvidenceLink.findOne({ organizationId, invoiceId: new mongoose.Types.ObjectId(evidenceId), paymentId: new mongoose.Types.ObjectId(paymentId) }).select('naviOperation').lean()
  return row?.naviOperation || null
}

// ---- Verification: CAS on the entry's exact updatedAt (as companyPaymentWriteService), writing only paymentVerification (+ the marker).
export type VerificationOperation = { actorId: string, naviOperation?: Record<string, unknown> }
export async function setPaymentVerification(organizationId: mongoose.Types.ObjectId, paymentId: string, body: any, operation: VerificationOperation) {
  await init()
  const _id = paymentObjectId(paymentId)
  const expected = body?.expectedUpdatedAt
  if (typeof expected !== 'string' || !Number.isFinite(Date.parse(expected)) || new Date(expected).toISOString() !== expected) fail(400, 'Read the current calendar entry and use its exact updatedAt')
  const record = { state: body?.state, reason: typeof body?.reason === 'string' ? body.reason.trim() : '', basis: 'owner_statement', updatedAt: new Date(), updatedBy: actorObjectId(operation.actorId), ...(operation.naviOperation?.operationId ? { operationId: String(operation.naviOperation.operationId) } : {}) }
  let payment: any
  try { payment = await Payment.findOneAndUpdate({ _id, organizationId, suppressedAt: { $exists: false }, updatedAt: new Date(expected) }, { $set: { paymentVerification: record, ...operation.naviOperation ? { naviOperation: operation.naviOperation } : {} } }, { new: true, runValidators: true }) }
  catch (error: any) { if (error?.name === 'ValidationError' || error?.name === 'CastError') fail(400, 'Invalid verification record'); throw error }
  if (!payment) {
    if (await Payment.exists({ _id, organizationId, suppressedAt: { $exists: false } })) fail(409, 'Calendar entry changed; read it again')
    fail(404, 'Payment not found')
  }
  return payment
}

// ---- Legacy adoption (the backfill): exactly the row whose Navi marker carries this fingerprint and an 'unverified' legacy state, and
// that has no typed record yet, becomes unconfirmed/missing_bank_period. Anything else writes nothing; a repeat is a no-op.
export async function adoptLegacyVerificationMarker(organizationId: mongoose.Types.ObjectId, paymentId: string, invoiceSourceSha256: string) {
  await init()
  if (typeof invoiceSourceSha256 !== 'string' || !HEX64.test(invoiceSourceSha256)) fail(400, 'Invalid fingerprint')
  const _id = paymentObjectId(paymentId)
  const legacyScope = { _id, organizationId, 'naviOperation.invoiceSourceSha256': invoiceSourceSha256, 'naviOperation.paymentVerification.state': 'unverified', paymentVerification: { $exists: false } }
  const legacy: any = await Payment.findOne(legacyScope).select('naviOperation').lean()
  if (!legacy) return { outcome: 'unchanged' as const, paymentId: String(_id) }
  const period = legacy.naviOperation?.paymentVerification?.missingBankPeriod
  const basis = ('legacy_navi_marker' + (period?.from && period?.to ? ' bank period ' + period.from + '..' + period.to : '')).slice(0, 120)
  const changed = await Payment.updateOne(legacyScope, { $set: { paymentVerification: { state: 'unconfirmed', reason: 'missing_bank_period', basis, updatedAt: new Date() } } }, { runValidators: true })
  return { outcome: changed.modifiedCount === 1 ? 'adopted' as const : 'unchanged' as const, paymentId: String(_id) }
}
