// server/services/receiptLinkSyncService.ts — the derived transactions.hasReceipt badge of saved receipt links, kept correct on
// standalone MongoDB across processes, crashes and concurrent changes of different receipts (plan omf-navi-receipt-link-ready-20261028).
// Canonical truth is the receipt (status/transactionId) plus the transaction's own receipt file. A receipt link write records the work
// it owes (linkSync) in the same atomic write; any completer (the writer itself, the boot/periodic recovery tick of any process) then
// 1) records each owed timeline event once (a durable key on the event itself) and bumps the transaction's projection request counter
// (receiptSync.rev) AFTER the truth is durable, 2) computes the badge from the canonical receipts and writes it only if receiptSync.rev
// (and the direct file) is still what it read, 3) clears the receipt's owed work only for the exact revision it processed. A projection
// computed from older truth can only land before the newer change's bump, which then leaves rev > applied or a pending receipt: a
// stale value is never left as the acknowledged state. The recovery claim only avoids duplicated effort and counts attempts;
// correctness comes from these fences. Logs carry error names only.
import mongoose from 'mongoose'
import { randomUUID } from 'node:crypto'
import Receipt from '../models/Receipt'
import Transaction from '../models/Transaction'
import { ensureConnection } from '../config/database'

const setting = (name: string, fallback: number, min: number) => { const raw = process.env[name], value = Number(raw); return raw !== undefined && raw !== '' && Number.isFinite(value) && value >= min ? value : fallback }
// Defaults: a writer is given 5 s to finish its own work before recovery may claim it; failures back off from 60 s (doubling, at most
// one hour); a recovery claim lasts 2 minutes. Tests shorten them through the same variables.
export const receiptSyncTiming = () => ({ graceMs: setting('OMF_RECEIPT_SYNC_GRACE_MS', 5000, 0), backoffMs: setting('OMF_RECEIPT_SYNC_BACKOFF_MS', 60000, 50), leaseMs: setting('OMF_RECEIPT_SYNC_LEASE_MS', 120000, 1000) })
export const MAX_RECEIPT_SYNC_ATTEMPTS = 10
const PROJECTION_TRIES = 8, BACKOFF_CAP_MS = 3600000
const EVENTS: Record<string, { title: string, description: string }> = {
  receipt_matched: { title: 'Receipt Matched', description: 'Receipt matched to transaction' },
  receipt_unmatched: { title: 'Receipt Unmatched', description: 'Receipt was unmatched from transaction' }
}
export type ReceiptSyncResult = 'synced' | 'pending' | 'manual_review'
type WorkItem = { transactionId: mongoose.Types.ObjectId, event: 'receipt_matched' | 'receipt_unmatched' | null, key: string }
export class ReceiptSyncContention extends Error { constructor() { super('Receipt link projection contention'); this.name = 'ReceiptSyncContention' } }
const MISSING = Symbol('missing transaction')

// Durable step seam. A no-op in the application; the owned fixture replaces only this compiled function to crash, pause or fail the
// real writer at each durable boundary. It never changes data. It reads its identifiers so the bundler keeps them at every call.
export async function receiptLinkStep(point: string, ids: Record<string, string>) {
  if (typeof ids?.receiptId !== 'string' || (ids.transactionId !== undefined && typeof ids.transactionId !== 'string')) throw new Error('Receipt link step without identifiers: ' + point)
}

// The badge rule: a matched receipt of the transaction's own company, or the transaction's own receipt file.
export async function expectedReceiptFlag(transactionId: mongoose.Types.ObjectId | string, organizationId: mongoose.Types.ObjectId, receiptFilePath?: string | null) {
  if (receiptFilePath) return true
  return !!await Receipt.exists({ organizationId, transactionId, status: 'matched' })
}

// The owed work of a new canonical write: still-owed work of the replaced revision is kept (the caller's write is conditioned on that
// revision), plus this change. The new revision key also identifies its timeline event.
export function newReceiptLinkSync(previous: any, items: Omit<WorkItem, 'key'>[], now = new Date()) {
  const rev = randomUUID(), owed: WorkItem[] = previous?.pending ? (previous.work || []).map((w: any) => ({ transactionId: w.transactionId, event: w.event || null, key: w.key })) : []
  return { rev, pending: true, state: 'pending', reason: null, work: [...owed, ...items.map(w => ({ ...w, key: rev }))], at: now, attempts: 0, nextAttemptAt: new Date(now.getTime() + receiptSyncTiming().graceMs), claimToken: null, claimUntil: null, syncedAt: null }
}

// 1) Each owed event is appended only if no timeline event carries its key (one conditional write per event, oldest first, so a
// partly recorded set never blocks the rest); then the request bump, after the truth is durable.
async function bump(transactionId: mongoose.Types.ObjectId, items: any[], organizationId: mongoose.Types.ObjectId) {
  for (const w of items) {
    if (!w.event || !EVENTS[w.event]) continue
    await Transaction.updateOne({ _id: transactionId, organizationId, 'timeline.key': { $ne: w.key } }, { $push: { timeline: { $each: [{ type: w.event, ...EVENTS[w.event], timestamp: new Date(), key: w.key }], $position: 0 } } })
  }
  const row: any = await Transaction.findOneAndUpdate({ _id: transactionId, organizationId }, { $inc: { 'receiptSync.rev': 1 } }, { new: true, projection: { receiptSync: 1 }, timestamps: false }).lean()
  return row ? row.receiptSync.rev as number : MISSING
}
// 2) Project until a projection computed under a revision at least this bump exists. A vanished transaction is reported, not assumed.
async function project(transactionId: mongoose.Types.ObjectId, organizationId: mongoose.Types.ObjectId, requested: number, ids: Record<string, string>) {
  for (let i = 0; i < PROJECTION_TRIES; i++) {
    const t: any = await Transaction.findOne({ _id: transactionId, organizationId }).select('hasReceipt receiptFilePath receiptSync').lean()
    if (!t) return MISSING
    if ((t.receiptSync?.applied ?? -1) >= requested) return true
    const rev = t.receiptSync?.rev ?? 0, file = t.receiptFilePath ?? null
    const flag = await expectedReceiptFlag(transactionId, organizationId, file)
    await receiptLinkStep('after-compute', { ...ids, transactionId: String(transactionId) })
    const written = await Transaction.updateOne({ _id: transactionId, organizationId, 'receiptSync.rev': rev, receiptFilePath: file }, { $set: { hasReceipt: flag, 'receiptSync.applied': rev, 'receiptSync.at': new Date() } }, { timestamps: flag !== (t.hasReceipt === true) })
    if (written.matchedCount === 1) return true
  }
  return false
}
async function toManualReview(receiptId: any, rev: string, reason: 'transaction_missing' | 'retries_exhausted', claimToken?: string) {
  await Receipt.updateOne({ _id: receiptId, 'linkSync.rev': rev, 'linkSync.pending': true, ...(claimToken ? { 'linkSync.claimToken': claimToken } : {}) }, { $set: { 'linkSync.state': 'manual_review', 'linkSync.reason': reason, 'linkSync.claimToken': null, 'linkSync.claimUntil': null } }, { timestamps: false })
}
async function currentState(receiptId: any, organizationId: mongoose.Types.ObjectId): Promise<ReceiptSyncResult> {
  const row: any = await Receipt.findOne({ _id: receiptId, organizationId }).select('linkSync.pending linkSync.state').lean()
  return !row?.linkSync?.pending ? 'synced' : row.linkSync.state === 'manual_review' ? 'manual_review' : 'pending'
}

// Complete one receipt's owed work. With options.rev only that revision is processed (a newer one belongs to its own writer/owner).
export async function completeReceiptSync(receiptId: any, organizationId: mongoose.Types.ObjectId, options: { rev?: string, claimToken?: string } = {}): Promise<ReceiptSyncResult> {
  await ensureConnection()
  const receipt: any = await Receipt.findOne({ _id: receiptId, organizationId }).select('status transactionId linkSync').lean()
  const sync = receipt?.linkSync
  if (!sync?.pending) return 'synced'
  if (options.rev && sync.rev !== options.rev) return currentState(receipt._id, organizationId)
  if (sync.state === 'manual_review') return 'manual_review'
  const ids = { receiptId: String(receipt._id) }, targets = [...new Map((sync.work || []).map((w: any) => [String(w.transactionId), w.transactionId])).values()]
  // The receipt of this revision still points at a transaction that no longer exists in its company: a named state, never done or a
  // silent retry. Work for a transaction this receipt no longer points at has nothing left to project when that transaction is gone.
  const missing = async (transactionId: any) => {
    if (receipt.status === 'matched' && String(receipt.transactionId) === String(transactionId)) { await toManualReview(receipt._id, sync.rev, 'transaction_missing', options.claimToken); return true }
    return false
  }
  for (const transactionId of targets as mongoose.Types.ObjectId[]) {
    const step = { ...ids, transactionId: String(transactionId) }
    if (!await Transaction.exists({ _id: transactionId, organizationId })) { if (await missing(transactionId)) return currentState(receipt._id, organizationId); continue }
    await receiptLinkStep('before-bump', step)
    const requested = await bump(transactionId, (sync.work || []).filter((w: any) => String(w.transactionId) === String(transactionId)), organizationId)
    await receiptLinkStep('after-bump', step)
    const projected = requested === MISSING ? MISSING : await project(transactionId, organizationId, requested, ids)
    if (projected === MISSING) { if (await missing(transactionId)) return currentState(receipt._id, organizationId); continue }
    if (!projected) throw new ReceiptSyncContention()
    await receiptLinkStep('after-projection', step)
  }
  // 3) Clear only the processed revision; a newer revision keeps its (union of) owed work.
  const cleared = await Receipt.updateOne({ _id: receipt._id, organizationId, 'linkSync.rev': sync.rev, 'linkSync.pending': true }, { $set: { 'linkSync.pending': false, 'linkSync.state': 'synced', 'linkSync.reason': null, 'linkSync.work': [], 'linkSync.attempts': 0, 'linkSync.syncedAt': new Date(), 'linkSync.claimToken': null, 'linkSync.claimUntil': null } }, { timestamps: false })
  await receiptLinkStep('after-clear', ids)
  return cleared.modifiedCount === 1 ? 'synced' : currentState(receipt._id, organizationId)
}

// The writer's own completion right after its canonical write: never throws for synchronization; owed work stays for recovery.
export async function completeAfterWrite(receiptId: any, organizationId: mongoose.Types.ObjectId, rev: string): Promise<ReceiptSyncResult> {
  try { return await completeReceiptSync(receiptId, organizationId, { rev }) }
  catch (error: any) { if (!(error instanceof ReceiptSyncContention)) console.error('[Finance] receipt link synchronization deferred', error?.name || 'Error'); return currentState(receiptId, organizationId) }
}

// A recovery attempt is counted when it is claimed (one atomic write), so a crash anywhere after the claim still counts it. An
// attempt that did not fail as a business attempt (contention, superseded revision) is given back by its own claim owner.
async function releaseClaim(receiptId: any, rev: string, claimToken: string, delayMs: number) {
  await Receipt.updateOne({ _id: receiptId, 'linkSync.rev': rev, 'linkSync.claimToken': claimToken }, { $set: { 'linkSync.claimToken': null, 'linkSync.claimUntil': null, 'linkSync.nextAttemptAt': new Date(Date.now() + delayMs) }, $inc: { 'linkSync.attempts': -1 } }, { timestamps: false })
}
// A genuine failed attempt of the current claim owner: one conditional write records the bounded exponential backoff and, at the
// tenth counted attempt, the manual review. A stale owner (claim taken over or released) records nothing.
async function recordFailure(receiptId: any, rev: string, claimToken: string, attempts: number) {
  const { backoffMs } = receiptSyncTiming()
  await Receipt.updateOne({ _id: receiptId, 'linkSync.rev': rev, 'linkSync.claimToken': claimToken, 'linkSync.attempts': attempts, 'linkSync.pending': true }, { $set: { 'linkSync.claimToken': null, 'linkSync.claimUntil': null, 'linkSync.nextAttemptAt': new Date(Date.now() + Math.min(backoffMs * 2 ** (attempts - 1), BACKOFF_CAP_MS)), ...(attempts >= MAX_RECEIPT_SYNC_ATTEMPTS ? { 'linkSync.state': 'manual_review', 'linkSync.reason': 'retries_exhausted' } : {}) } }, { timestamps: false })
}

// One bounded recovery pass (boot and periodic tick of every process): due, unclaimed or expired-claim pending receipts only.
export async function runReceiptSyncRecovery(limit = 25) {
  await ensureConnection()
  const now = new Date(), free = [{ 'linkSync.claimUntil': null }, { 'linkSync.claimUntil': { $lte: now } }], outcome = { claimed: 0, synced: 0, pending: 0, manualReview: 0, failed: 0 }
  // Ten counted attempts whose last owner never recorded its result (it crashed): the bounded review transition, no eleventh attempt.
  await Receipt.updateMany({ 'linkSync.pending': true, 'linkSync.state': 'pending', 'linkSync.attempts': { $gte: MAX_RECEIPT_SYNC_ATTEMPTS }, $or: free }, { $set: { 'linkSync.state': 'manual_review', 'linkSync.reason': 'retries_exhausted', 'linkSync.claimToken': null, 'linkSync.claimUntil': null } }, { timestamps: false })
  const due: any[] = await Receipt.find({ 'linkSync.pending': true, 'linkSync.state': 'pending', 'linkSync.nextAttemptAt': { $lte: now }, 'linkSync.attempts': { $lt: MAX_RECEIPT_SYNC_ATTEMPTS }, $or: free }).select('organizationId linkSync.rev').sort({ 'linkSync.nextAttemptAt': 1 }).limit(limit).lean()
  for (const row of due) {
    const claimToken = randomUUID(), { leaseMs } = receiptSyncTiming(), at = new Date()
    const claimed: any = await Receipt.findOneAndUpdate({ _id: row._id, 'linkSync.rev': row.linkSync.rev, 'linkSync.pending': true, 'linkSync.state': 'pending', 'linkSync.attempts': { $lt: MAX_RECEIPT_SYNC_ATTEMPTS }, $or: [{ 'linkSync.claimUntil': null }, { 'linkSync.claimUntil': { $lte: at } }] }, { $set: { 'linkSync.claimToken': claimToken, 'linkSync.claimUntil': new Date(at.getTime() + leaseMs) }, $inc: { 'linkSync.attempts': 1 } }, { new: true, timestamps: false }).select('organizationId linkSync.rev linkSync.attempts').lean()
    if (!claimed) continue
    outcome.claimed++
    const ids = { receiptId: String(row._id) }
    try {
      await receiptLinkStep('after-failure-count', ids)
      await receiptLinkStep('recovery-claimed', ids)
      const result = await completeReceiptSync(row._id, claimed.organizationId, { rev: claimed.linkSync.rev, claimToken })
      if (result === 'synced') outcome.synced++
      else if (result === 'manual_review') outcome.manualReview++
      else { outcome.pending++; await releaseClaim(row._id, claimed.linkSync.rev, claimToken, 1000) }
    } catch (error: any) {
      // Contention is not a business failure: give the attempt back and retry soon.
      if (error instanceof ReceiptSyncContention) { outcome.pending++; await releaseClaim(row._id, claimed.linkSync.rev, claimToken, 1000); continue }
      outcome.failed++
      console.error('[Finance] receipt link recovery attempt failed', error?.name || 'Error')
      await recordFailure(row._id, claimed.linkSync.rev, claimToken, claimed.linkSync.attempts)
    }
  }
  return outcome
}

// Bounded assist by a company's own batch operation (auto-match): due owed work of this company only.
export async function completePendingReceiptSyncs(organizationId: mongoose.Types.ObjectId, limit = 10) {
  await ensureConnection()
  const rows: any[] = await Receipt.find({ organizationId, 'linkSync.pending': true, 'linkSync.state': 'pending', 'linkSync.nextAttemptAt': { $lte: new Date() } }).select('linkSync.rev').limit(limit).lean()
  for (const row of rows) await completeAfterWrite(row._id, organizationId, row.linkSync.rev)
}
