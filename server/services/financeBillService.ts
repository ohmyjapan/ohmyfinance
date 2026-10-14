// server/services/financeBillService.ts — card bills in the payment calendar (plan omf-calendar-gmail-build-20261015 §2 S14/S15
// with the approved conditions B1–B3, B6). One function, reconcileBill, takes the issuer's evidence from either source (the
// confirmation mail or the statement CSV) and finds, updates, adopts or creates the one bill of that card account and
// cycle. Every automatic write is authorized by the holding company's CURRENT membership of the acting owner (B1), a
// hand-entered forecast is adopted only on a verified provider-and-cycle match and otherwise offered for review (B2), a
// settled, cancelled or removed bill is never rewritten or recreated (B3), and a stored notice is pending until its
// reconciliation completed (B6). Lines marked `// guard:<name>` are single predicates the fixture removes from a mutant
// copy to prove each is load-bearing.
import mongoose from 'mongoose'
import Organization from '../models/Organization'
import { Payment } from '../models/Payment'
import { FinancialAccount, FinanceImport, FinanceNotice } from '../models/Finance'
import { fail, id, ownedAccount, ownedImport, queueSync } from './financeService'
import { dateOnly } from '../../shared/amex.mjs'
import { aplusPeriod } from '../../shared/aplus.mjs'
import { BILLING_MAIL_PARSER } from '../../shared/billing-mail.mjs'

export type BillSource = 'issuer-mail' | 'statement-csv'
export interface BillEvidence { periodKey: string; statementMonth: string; statementTotal: number; paymentDueDate: string | null; importId?: string; sourceHash?: string; noticeId?: string; dueDateEvidence?: 'issuer-page' | 'user-entered' | 'issuer-mail' }
export interface ReconcileOptions { dryRun?: boolean; company?: string | null; force?: 'create' | null; hooks?: { beforeWrite?: (existing: any) => any; beforeCreate?: () => any } }

export const SETTLED_STATES = ['paid', 'completed', 'cancelled']
/** Notice states the collector may skip: the work is done or a member owns the next step. */
export const COMPLETED_NOTICE_STATES = ['linked', 'suppressed', 'review', 'queued', 'already-queued']
/** States a later binding, membership or re-delivery re-runs. */
export const WAKE_STATES = ['pending', 'unbound', 'unauthorized']
export const RETRY_IMPORT_STATES = ['pending', 'unbound', 'due-date-unresolved', 'review', 'unauthorized']
export const RETRY_NOTICE_STATES = ['pending', 'unbound', 'unauthorized', 'unpaired', 'no-account', 'inactive-account', 'queue-failed', 'due-date-unresolved']
/**
 * The one review reason a configuration change resolves without any member's choice (fold F1): two accounts reading one
 * mailbox, or an Amex card suffix matching more than one account. Such a notice is not reported as covered, so the claim
 * re-sends it and the re-delivery re-evaluates it; the member can also re-evaluate the stored notice at any time.
 * Every other review reason keeps its owner: authentication is never retried, changed-body/candidates/company need a choice.
 */
export const RECOVERABLE_REVIEW_REASONS = ['ambiguous-account']
export function retryableNotice(calendar: any) {
  if (!calendar?.state || RETRY_NOTICE_STATES.includes(calendar.state)) return true
  return calendar.state === 'review' && RECOVERABLE_REVIEW_REASONS.includes(calendar.reason) // guard:recoverable-retry
}
const PROVIDER_TITLE = /アプラス|aplus/i
const noon = (day: string) => new Date(day + 'T12:00:00.000Z')
const asId = (value: any) => (value === undefined || value === null || value === '' ? null : String(value))
const jstMonth = (date: Date) => new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 7)

async function member(ownerId: string, organizationId: any) {
  const org = asId(organizationId)
  if (!org || !mongoose.isValidObjectId(org) || !mongoose.isValidObjectId(ownerId)) return false
  return !!await Organization.exists({ _id: org, 'members.userId': ownerId, isActive: true })
}

/**
 * What proves ONE card account in a hand-entered title (fold F3): one of its stored four-digit card suffixes as a whole
 * number. An account nickname never does — 「法人カード」 or 「カード」 is a substring of many unrelated titles.
 */
function identityTokens(account: any): { suffixes: string[] } {
  const suffixes = (account?.cardIdentifiers || []).map((v: any) => String(v)).filter((v: string) => /^\d{4}$/.test(v))
  return { suffixes }
}
function namesAccount(title: any, tokens: { suffixes: string[] }) {
  const text = String(title || '')
  return tokens.suffixes.some(s => new RegExp('(?<!\\d)' + s + '(?!\\d)').test(text))
}
/**
 * Hand-entered Term Credit Card rows of the company in the cycle's payment window (B2, continuation F1, fold F3). A brand
 * word plus a matching amount and date is NOT the identity of a parent card account: automatic adoption needs a row that
 * names this account's stored card suffix and no sibling Aplus account of the owner, with the exact amount and date.
 * Every other provider-looking row, and any other row with the same amount and date, is offered for the member's choice.
 */
async function legacyCandidates(account: any, siblings: any[], company: string, evidence: BillEvidence, dueDate: string | null) {
  const period = aplusPeriod({ kind: 'statement', statementMonth: evidence.statementMonth })
  const start = new Date(period.start + 'T00:00:00.000Z'), end = new Date(new Date(period.end + 'T23:59:59.999Z').getTime() + 3 * 86400000)
  const rows: any[] = await Payment.find({ organizationId: company, source: { $exists: false }, suppressedAt: { $exists: false }, category: 'Term Credit Card', dueDate: { $gte: start, $lte: end } }).select('_id title amount dueDate status').limit(50).lean()
  const own = identityTokens(account), others = (siblings || []).map(identityTokens)
  const verifiedFor = (r: any) => namesAccount(r.title, own) && !others.some(t => namesAccount(r.title, t))
  const providerMatch = (r: any) => PROVIDER_TITLE.test(String(r.title || '')) || namesAccount(r.title, own) || others.some(t => namesAccount(r.title, t))
  const exact = (r: any) => r.amount === evidence.statementTotal && (!dueDate || new Date(r.dueDate).getTime() === noon(dueDate).getTime())
  const verified = rows.filter(verifiedFor), brand = rows.filter(r => !verifiedFor(r) && providerMatch(r)), same = rows.filter(r => !providerMatch(r) && exact(r))
  return { adopt: verified.length === 1 && exact(verified[0]) ? verified[0] : null, candidates: [...verified, ...brand, ...same].map(r => r._id) } // guard:verified-identity
}

/**
 * The one reconciliation of a card bill (both sources). Returns the calendar state written to the notice or the batch.
 * dryRun reads only and names what would happen; `company` is the member's explicit choice for an older cycle after a
 * rebinding; `force: 'create'` the member's choice to create beside the offered candidates.
 */
export async function reconcileBill(ownerId: string, account: any, evidence: BillEvidence, source: BillSource, options: ReconcileOptions = {}): Promise<any> {
  const { dryRun = false, hooks = {} } = options
  const at = new Date()
  let dueDate: string | null = null
  try { dueDate = evidence.paymentDueDate ? dateOnly(evidence.paymentDueDate) : null } catch { dueDate = null }
  const total = evidence.statementTotal
  const dueDateEvidence = evidence.dueDateEvidence || (source === 'issuer-mail' ? 'issuer-mail' : 'issuer-page')
  const observed = { amount: total, dueDate, evidence: source, at }
  const base = { evidence: source, statementTotal: total, dueDate, at }
  const company = asId(options.company) || asId(account.organizationId)
  const sourceFields: Record<string, any> = { statementTotal: total, dueDateEvidence, updatedAt: at }
  if (evidence.importId) sourceFields.importId = evidence.importId
  if (evidence.noticeId) sourceFields.noticeId = evidence.noticeId
  if (evidence.sourceHash) sourceFields.sourceHash = evidence.sourceHash
  const identity = { kind: 'card-statement', provider: 'aplus', accountId: account._id, periodKey: evidence.periodKey, statementMonth: evidence.statementMonth }
  for (let attempt = 0; attempt < 2; attempt++) {
    // (1) the bill of this account and cycle, wherever it lives
    const existing: any = await Payment.findOne({ 'source.kind': 'card-statement', 'source.accountId': account._id, 'source.periodKey': evidence.periodKey }).lean()
    if (existing) {
      if (existing.suppressedAt) return { ...base, state: 'suppressed', paymentId: existing._id, observed } // guard:suppressed
      if (!await member(ownerId, existing.organizationId)) return { ...base, state: 'unauthorized', paymentId: existing._id, observed, authorized: false } // guard:authority-update
      const settled = SETTLED_STATES.includes(existing.status) || !!existing.settledAt
      if (dryRun) return { ...base, state: 'dry-run', would: settled ? 'preserve' : 'update', paymentId: existing._id, observed }
      await hooks.beforeWrite?.(existing)
      // (2) one atomic update: the company, settlement and removal predicates travel with the write
      const set: any = { amount: total }
      for (const [key, value] of Object.entries(sourceFields)) set['source.' + key] = value
      if (dueDate) set.dueDate = noon(dueDate)
      const written = await Payment.updateOne({
        _id: existing._id, organizationId: existing.organizationId,
        status: { $nin: SETTLED_STATES }, settledAt: { $exists: false }, // guard:settled-predicates
        suppressedAt: { $exists: false }, // guard:settled-predicates-suppressed
      }, { $set: set })
      if (written.matchedCount === 1) return { ...base, state: 'linked', paymentId: existing._id }
      const again: any = await Payment.findById(existing._id).lean()
      if (!again) continue
      if (again.suppressedAt) return { ...base, state: 'suppressed', paymentId: again._id, observed }
      return { ...base, state: 'linked', paymentId: again._id, preserved: true, observed }
    }
    // (3)/(4) no bill yet
    if (!company) return { ...base, state: 'unbound' }
    const bound = account.organizationBoundAt instanceof Date ? account.organizationBoundAt : (account.organizationBoundAt ? new Date(account.organizationBoundAt) : null)
    const previous = asId(account.previousOrganizationId)
    if (!options.company && previous && previous !== company && bound && evidence.statementMonth < jstMonth(bound)) {
      return { ...base, state: dryRun ? 'dry-run' : 'review', ...(dryRun ? { would: 'review' } : {}), reason: 'company', companies: [previous, company] }
    }
    if (!await member(ownerId, company)) return { ...base, state: 'unauthorized', authorized: false } // guard:authority-create
    if (options.force !== 'create') {
      const siblings: any[] = await FinancialAccount.find({ ownerId, provider: 'aplus', _id: { $ne: account._id } }).select('name cardIdentifiers').lean()
      const found = await legacyCandidates(account, siblings, company, evidence, dueDate)
      if (found.adopt) {
        if (dryRun) return { ...base, state: 'dry-run', would: 'adopt', paymentId: found.adopt._id }
        const adopted: any = await Payment.findOneAndUpdate({ _id: found.adopt._id, organizationId: company, source: { $exists: false }, suppressedAt: { $exists: false }, amount: found.adopt.amount, dueDate: found.adopt.dueDate, status: found.adopt.status }, { $set: { source: { ...identity, ...sourceFields, adopted: true, adoptedAt: at } } }, { new: true }).lean()
        if (!adopted) continue
        const settled = SETTLED_STATES.includes(adopted.status) || !!adopted.settledAt
        return { ...base, state: 'linked', paymentId: adopted._id, adopted: true, ...(settled ? { preserved: true, observed } : {}) }
      }
      if (found.candidates.length) return { ...base, state: dryRun ? 'dry-run' : 'review', ...(dryRun ? { would: 'review' } : {}), reason: 'candidates', candidates: found.candidates }
    }
    if (!dueDate) return { ...base, state: 'due-date-unresolved' }
    if (dryRun) return { ...base, state: 'dry-run', would: 'create', company }
    await hooks.beforeCreate?.()
    try {
      const created: any = await Payment.create({ title: account.name || 'アプラス', amount: total, currency: 'JPY', dueDate: noon(dueDate), type: 'expense', status: 'pending', category: 'Term Credit Card', recurring: false, notes: source === 'issuer-mail' ? 'Aplusの請求確定メールから自動登録' : 'Aplus確定明細から自動登録', organizationId: company, source: { ...identity, ...sourceFields } })
      return { ...base, state: 'linked', paymentId: created._id, created: true }
    } catch (error: any) { if (error?.code !== 11000) throw error }
  }
  return { ...base, state: 'pending', retry: true }
}

/** The evidence a stored statement batch carries (a later delivery may add the due date). */
export function importEvidence(batch: any, paymentDueDate?: any): BillEvidence {
  let date: string | null = null
  try { date = paymentDueDate ? dateOnly(paymentDueDate) : null } catch { date = null }
  return { periodKey: batch.period.key, statementMonth: batch.period.statementMonth, statementTotal: Number(batch.reconciliation?.statementTotal), paymentDueDate: date ?? batch.reconciliation?.paymentDueDate ?? batch.calendar?.dueDate ?? null, importId: String(batch._id), sourceHash: batch.hash, dueDateEvidence: batch.collectorId ? 'issuer-page' : 'user-entered' }
}
export function noticeEvidence(notice: any): BillEvidence {
  const statementMonth = notice.claims.statementMonth
  return { periodKey: aplusPeriod({ kind: 'statement', statementMonth }).key, statementMonth, statementTotal: Number(notice.claims.amount), paymentDueDate: notice.claims.dueDate, noticeId: String(notice._id), dueDateEvidence: 'issuer-mail' }
}
export function importCalendarEligible(account: any, parsed: any) { return account?.provider === 'aplus' && parsed?.period?.kind === 'statement' && !parsed?.sourceStatus }

/**
 * Re-runs the other records of ONE account and cycle after a member's explicit choice (B6, continuation F3): the statement
 * batches and the other confirmation notices of that cycle that were waiting (pending, unbound, unauthorized, no due date,
 * or review of candidates/company). Nothing of another cycle or another account is touched; a review that needs more than a
 * bill choice (changed body, failed authentication, ambiguous account) is never re-run here.
 */
export async function wakeCycleWork(ownerId: string, account: any, periodKey: string, statementMonth: string, exceptNoticeId?: any, exceptImportId?: any) {
  const states = [...WAKE_STATES, 'review', 'due-date-unresolved']
  const choiceReview = (c: any) => c?.state !== 'review' || ['candidates', 'company'].includes(c?.reason)
  let imports = 0, notices = 0
  const batches: any[] = await FinanceImport.find({ accountId: account._id, provider: 'aplus', 'period.key': periodKey, ...(exceptImportId ? { _id: { $ne: exceptImportId } } : {}), 'calendar.state': { $in: states } }).select('_id period reconciliation calendar hash collectorId').lean()
  for (const batch of batches.filter(b => choiceReview(b.calendar))) {
    const calendar = await reconcileBill(ownerId, account, importEvidence(batch), 'statement-csv')
    await FinanceImport.updateOne({ _id: batch._id }, { $set: { calendar } }); imports++
  }
  const rows: any[] = await FinanceNotice.find({ accountId: account._id, kind: 'bill-confirmed', 'claims.statementMonth': statementMonth, ...(exceptNoticeId ? { _id: { $ne: exceptNoticeId } } : {}), 'calendar.state': { $in: states } }).lean()
  for (const notice of rows.filter(n => choiceReview(n.calendar))) {
    const calendar = await reconcileBill(ownerId, account, noticeEvidence(notice), 'issuer-mail')
    await FinanceNotice.updateOne({ _id: notice._id }, { $set: { calendar, lastAttemptAt: new Date() }, $inc: { attempts: 1 } }); notices++
  }
  return { imports, notices }
}

/** Re-runs the unfinished notice and statement work of one account (after a binding or a membership change). */
export async function wakeAccountWork(ownerId: string, account: any) {
  let imports = 0, notices = 0
  const batches: any[] = await FinanceImport.find({ accountId: account._id, provider: 'aplus', 'period.kind': 'statement', 'calendar.state': { $in: WAKE_STATES } }).select('_id period reconciliation calendar hash collectorId').lean()
  for (const batch of batches) {
    const calendar = await reconcileBill(ownerId, account, importEvidence(batch), 'statement-csv')
    await FinanceImport.updateOne({ _id: batch._id }, { $set: { calendar } }); imports++
  }
  const rows: any[] = await FinanceNotice.find({ accountId: account._id, kind: 'bill-confirmed', 'calendar.state': { $in: WAKE_STATES } }).lean()
  for (const notice of rows) {
    const calendar = await reconcileBill(ownerId, account, noticeEvidence(notice), 'issuer-mail')
    await FinanceNotice.updateOne({ _id: notice._id }, { $set: { calendar, lastAttemptAt: new Date() }, $inc: { attempts: 1 } }); notices++
  }
  return { imports, notices }
}

/** Mail ids the collector need not send again: completed or member-owned (B6: pending and transient states are retried; fold F1: the recoverable review is re-sent). */
export async function coveredNoticeIds(accountId: any): Promise<string[]> {
  const filter: any = { accountId, createdAt: { $gte: new Date(Date.now() - 60 * 86400000) } }
  filter['calendar.state'] = { $in: COMPLETED_NOTICE_STATES } // guard:covered-states
  filter.$nor = [{ 'calendar.state': 'review', 'calendar.reason': { $in: RECOVERABLE_REVIEW_REASONS } }] // guard:recoverable-uncovered
  return FinanceNotice.distinct('mailId', filter)
}

// ── PUT accounts/:id/calendar ──
export async function bindCalendarCompany(ownerId: string, account: any, body: any) {
  const requested = asId(body?.organizationId) === null ? null : id(body.organizationId)
  if (requested && !await member(ownerId, requested)) fail(403, 'Access denied to this organization')
  const current = asId(account.organizationId), at = new Date(), changed = requested !== current
  if (changed) {
    const previous = current ? { previousOrganizationId: current } : {}
    await FinancialAccount.updateOne({ _id: account._id, ownerId }, requested ? { $set: { organizationId: requested, organizationBoundAt: at, ...previous } } : { $unset: { organizationId: '' }, $set: { organizationBoundAt: at, ...previous } })
  }
  const existingBillsKept = await Payment.countDocuments({ 'source.kind': 'card-statement', 'source.accountId': account._id })
  const woken = requested ? await wakeAccountWork(ownerId, await FinancialAccount.findById(account._id).lean()) : { imports: 0, notices: 0 }
  return { organizationId: requested, existingBillsKept, changed, woken }
}

// ── PUT accounts/:id/billing-mail ──
export function billingMailInput(body: any): { enabled: boolean; mailbox: string | null } {
  if (!body || typeof body !== 'object' || typeof body.enabled !== 'boolean') fail(400, '請求メールの設定を確認してください')
  const raw = body.mailbox
  const mailbox = raw === undefined || raw === null || raw === '' ? null : (typeof raw === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) && raw.length < 255 ? raw.toLowerCase() : fail(400, '請求メールのメールボックスを確認してください'))
  if (body.enabled && !mailbox) fail(400, '請求メールのメールボックスを確認してください')
  return { enabled: body.enabled, mailbox }
}

// ── the collector's notice artifact ──
function noticeInput(value: any, account: any) {
  const hex = (v: any, min: number, max: number) => typeof v === 'string' && new RegExp('^[a-f0-9]{' + min + ',' + max + '}$').test(v)
  const text = (v: any, max: number) => (typeof v === 'string' && v.length <= max ? v : null)
  if (!value || typeof value !== 'object' || value.kind !== 'notice' || value.parserVersion !== BILLING_MAIL_PARSER) fail(400, 'Unsupported billing notice')
  if (!hex(value.mailId, 1, 32) || !hex(value.bodySha256, 64, 64)) fail(400, 'Invalid billing notice identity')
  const mailbox = typeof value.mailbox === 'string' ? value.mailbox.toLowerCase() : ''
  if (!account.billingMail?.enabled || !account.billingMail.mailbox || mailbox !== String(account.billingMail.mailbox).toLowerCase()) fail(409, 'Billing mail is not enabled for this account or the mailbox differs')
  if (!['aplus', 'amex'].includes(value.issuer) || !['bill-confirmed', 'bill-ready'].includes(value.noticeKind)) fail(400, 'Invalid billing notice')
  const subject = text(value.subject, 300), from = text(value.from, 300)
  if (subject === null || from === null) fail(400, 'Invalid billing notice headers')
  const dkim = text(value.authentication?.dkim, 20), dmarc = text(value.authentication?.dmarc, 20)
  if (!dkim || !dmarc) fail(400, 'Billing notice authentication results required')
  const internalDate = Number(value.internalDate)
  if (!Number.isFinite(internalDate) || internalDate <= 0) fail(400, 'Invalid billing notice date')
  const claims = value.claims || {}
  let parsed: any
  if (value.noticeKind === 'bill-confirmed') {
    if (value.issuer !== 'aplus' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(claims.statementMonth || ''))) fail(400, 'Invalid statement month')
    let dueDate = ''
    try { dueDate = dateOnly(claims.dueDate) } catch { fail(400, 'Invalid due date') }
    if (!dueDate.startsWith(claims.statementMonth)) fail(400, 'Due date outside the statement month')
    if (!Number.isSafeInteger(claims.amount) || claims.amount < 0 || claims.amount > 1e12) fail(400, 'Invalid amount')
    parsed = { statementMonth: claims.statementMonth, dueDate, amount: claims.amount, currency: 'JPY' }
  } else {
    if (value.issuer !== 'amex' || !/^\d{4,5}$/.test(String(claims.cardSuffix || ''))) fail(400, 'Invalid card suffix')
    parsed = { cardSuffix: String(claims.cardSuffix) }
  }
  return { mailId: value.mailId as string, threadId: hex(value.threadId, 1, 32) ? value.threadId as string : value.mailId as string, mailbox, issuer: value.issuer as string, kind: value.noticeKind as string, subject, from, internalDate: new Date(internalDate), bodySha256: value.bodySha256 as string, authentication: { dkim, dmarc }, parserVersion: value.parserVersion as string, claims: parsed }
}

type NoticeHooks = { afterInsert?: (notice: any) => any; afterIntent?: () => any; afterQueue?: (queued: any) => any }

async function processNotice(ownerId: string, account: any, notice: any, hooks: NoticeHooks = {}) {
  const at = new Date()
  if (notice.kind === 'bill-confirmed') return reconcileBill(ownerId, account, noticeEvidence(notice), 'issuer-mail')
  // bill-ready: the matching Amex account of the same owner gets the existing download enqueued; no calendar value is invented
  const suffix = String(notice.claims.cardSuffix)
  const matches: any[] = (await FinancialAccount.find({ ownerId, provider: 'amex' }).lean()).filter((a: any) => (suffix.length === 5 ? a.primaryCard === suffix : String(a.primaryCard || '').endsWith(suffix)))
  if (!matches.length) return { state: 'no-account', evidence: 'issuer-mail', at }
  // Identity is decided among the owner's ACTIVE Amex accounts (fold F1): a suffix matching more than one of them is the
  // recoverable ambiguity — corrected by changing a card identity or deactivating an account, then re-sent or retried.
  const active = matches.filter((a: any) => a.active !== false)
  if (active.length > 1) return { state: 'review', reason: 'ambiguous-account', detail: 'card-suffix', evidence: 'issuer-mail', candidates: active.map(t => t._id), at }
  if (!active.length) return { state: 'inactive-account', evidence: 'issuer-mail', targetAccountId: matches[0]._id, at }
  const target = active[0]
  // B6 (continuation F2): the intent to enqueue is durable on the notice BEFORE the enqueue. A retry after a crash between the
  // enqueue and the receipt finds the job the intent caused (requested at or after the intent) and records that one job;
  // it never queues a second. A crash before the enqueue leaves an intent with no job after it, and the retry enqueues once.
  let intentAt = notice.calendar?.intent?.at ? new Date(notice.calendar.intent.at) : null
  if (!intentAt || !Number.isFinite(intentAt.getTime())) {
    intentAt = at
    await FinanceNotice.updateOne({ _id: notice._id }, { $set: { 'calendar.intent': { targetAccountId: target._id, at: intentAt } } })
  }
  await hooks.afterIntent?.()
  const current: any = await FinancialAccount.findById(target._id).lean()
  if (current?.jobId && current.jobRequestedAt && new Date(current.jobRequestedAt).getTime() >= intentAt.getTime()) return { state: 'queued', evidence: 'issuer-mail', targetAccountId: target._id, jobId: current.jobId, jobState: current.jobState, recovered: true, at } // guard:intent-recovery
  try {
    const queued: any = await queueSync(ownerId, target)
    await hooks.afterQueue?.(queued)
    return { state: 'queued', evidence: 'issuer-mail', targetAccountId: target._id, jobId: queued.jobId, at }
  } catch (error: any) {
    if (error?.statusCode !== 409) throw error
    const message = String(error?.data?.message || '')
    if (/Pair a collector/.test(message)) return { state: 'unpaired', evidence: 'issuer-mail', targetAccountId: target._id, at }
    const fresh: any = await FinancialAccount.findById(target._id).lean()
    if (['queued', 'running', 'verification_required'].includes(fresh?.jobState)) return { state: 'already-queued', evidence: 'issuer-mail', targetAccountId: target._id, jobId: fresh.jobId, at }
    return { state: 'queue-failed', evidence: 'issuer-mail', targetAccountId: target._id, message, at }
  }
}

/**
 * The collector's notice upload: validate, store durably as pending (or find the stored row), then reconcile. The same
 * body again answers duplicate:true and retries only unfinished work; a different body for the same id keeps the first
 * claims and asks for review.
 */
export async function recordBillingNotice(ownerId: string, account: any, artifact: any, collectorId?: string, options: { hooks?: NoticeHooks } = {}) {
  const input = noticeInput(artifact, account)
  const at = new Date()
  let stored: any = await FinanceNotice.findOne({ accountId: account._id, mailId: input.mailId }).lean()
  let duplicate = !!stored
  if (!stored) {
    try { stored = (await FinanceNotice.create({ ownerId, accountId: account._id, ...(account.organizationId ? { organizationId: account.organizationId } : {}), ...input, versions: [{ bodySha256: input.bodySha256, receivedAt: at }], ...(collectorId ? { collectorId } : {}), calendar: { state: 'pending', at }, attempts: 0 })).toObject() }
    catch (error: any) { if (error?.code !== 11000) throw error; stored = await FinanceNotice.findOne({ accountId: account._id, mailId: input.mailId }).lean(); duplicate = true }
    if (!duplicate) await options.hooks?.afterInsert?.(stored)
  }
  if (duplicate && stored.bodySha256 !== input.bodySha256 && !(stored.versions || []).some((v: any) => v.bodySha256 === input.bodySha256)) {
    const calendar = { state: 'review', reason: 'changed-body', evidence: 'issuer-mail', previous: stored.calendar, at }
    await FinanceNotice.updateOne({ _id: stored._id }, { $push: { versions: { bodySha256: input.bodySha256, receivedAt: at } }, $set: { calendar, lastAttemptAt: at } })
    return { id: String(stored._id), duplicate: true, changed: true, calendar }
  }
  if (duplicate && stored.calendar && !retryableNotice(stored.calendar)) return { id: String(stored._id), duplicate: true, calendar: stored.calendar }
  const calendar = await evaluateNotice(ownerId, account, stored, options.hooks || {})
  await FinanceNotice.updateOne({ _id: stored._id }, { $set: { calendar, lastAttemptAt: at }, $inc: { attempts: 1 } })
  return { id: String(stored._id), duplicate, calendar }
}

/**
 * The evaluation of a stored, authenticated notice against the CURRENT account context — shared by the first delivery, the
 * collector's re-delivery and the member's explicit retry (fold F1): the mail's authentication verdicts, the mailbox
 * ambiguity among the owner's Aplus accounts, then the bill (Aplus) or the Amex enqueue.
 */
async function evaluateNotice(ownerId: string, account: any, stored: any, hooks: NoticeHooks = {}) {
  const at = new Date()
  if (stored.authentication?.dkim !== 'pass' || stored.authentication?.dmarc !== 'pass') return { state: 'review', reason: 'authentication', evidence: 'issuer-mail', at }
  if (await FinancialAccount.countDocuments({ ownerId, provider: 'aplus', _id: { $ne: account._id }, 'billingMail.enabled': true, 'billingMail.mailbox': String(stored.mailbox || '').toLowerCase() }) > 0) return { state: 'review', reason: 'ambiguous-account', detail: 'mailbox', evidence: 'issuer-mail', at }
  return processNotice(ownerId, account, stored, hooks)
}

/** The collector's durable receipt of one mail read (B5): a failed read is recorded even when the bank run succeeds. */
export async function recordBillingMailStatus(account: any, body: any) {
  if (!body || typeof body !== 'object' || body.kind !== 'billing-mail' || typeof body.ok !== 'boolean') fail(400, 'Invalid billing mail receipt')
  const readAt = new Date(body.readAt)
  if (!Number.isFinite(readAt.getTime())) fail(400, 'Invalid billing mail receipt time')
  const count = Number.isSafeInteger(body.noticesRead) && body.noticesRead >= 0 ? body.noticesRead : 0
  const error = body.ok ? null : (typeof body.error === 'string' && body.error.trim() ? body.error.trim().slice(0, 300) : '請求メールを読めませんでした')
  const set: any = { 'billingMail.lastAttemptAt': readAt, 'billingMail.lastError': error }
  if (body.ok) { set['billingMail.lastReadAt'] = readAt; set['billingMail.lastCount'] = count } else set['billingMail.lastErrorAt'] = readAt
  await FinancialAccount.updateOne({ _id: account._id }, { $set: set })
  return { recorded: true }
}

/** The choices a review state offers to THIS member: candidate bills of companies the member belongs to now, named companies. */
async function choiceOffers(ownerId: string, calendar: any, memberships = new Map<string, boolean>()) {
  const isMember = async (org: any) => { const key = asId(org); if (!key) return false; if (!memberships.has(key)) memberships.set(key, await member(ownerId, key)); return memberships.get(key)! }
  const candidateBills: any[] = [], companies: any[] = []
  if (calendar?.state === 'review' && calendar.reason === 'candidates' && Array.isArray(calendar.candidates)) {
    const bills: any[] = await Payment.find({ _id: { $in: calendar.candidates } }).select('_id title amount dueDate status organizationId').lean()
    for (const b of bills) if (await isMember(b.organizationId)) candidateBills.push({ id: String(b._id), title: b.title, amount: b.amount, dueDate: b.dueDate, status: b.status })
  }
  if (calendar?.state === 'review' && calendar.reason === 'company' && Array.isArray(calendar.companies)) {
    const orgs: any[] = await Organization.find({ _id: { $in: calendar.companies } }).select('_id name').lean()
    for (const o of orgs) companies.push({ id: String(o._id), name: o.name })
  }
  return { candidateBills, companies }
}

// ── GET notices?accountId ──
export async function listNotices(ownerId: string, accountId: string) {
  const account = await ownedAccount(ownerId, accountId)
  const rows: any[] = await FinanceNotice.find({ ownerId, accountId: account._id }).sort({ internalDate: -1, _id: -1 }).limit(100).lean()
  const memberships = new Map<string, boolean>()
  const notices: any[] = []
  for (const n of rows) {
    const offers = await choiceOffers(ownerId, n.calendar, memberships)
    notices.push({ _id: String(n._id), mailId: n.mailId, issuer: n.issuer, kind: n.kind, subject: n.subject, internalDate: n.internalDate, claims: n.claims, calendar: n.calendar, action: n.action, versions: (n.versions || []).length, attempts: n.attempts, lastAttemptAt: n.lastAttemptAt, createdAt: n.createdAt, ...offers })
  }
  return { notices }
}

/**
 * The member's explicit choice for one cycle, shared by the notice and the statement batch (fold F2): attach one of the
 * offered bills (fresh membership of its company; association only, then the same reconciliation), choose one of the
 * offered companies for an older cycle, or create beside the offered candidates. Returns null for a body that is not a
 * choice; the result is the reconciliation's calendar state and the recorded action.
 */
async function applyChoice(ownerId: string, account: any, evidence: BillEvidence, calendar: any, body: any, source: BillSource, provenance: { noticeId?: any; importId?: any }) {
  const state = calendar?.state, reason = calendar?.reason, at = new Date()
  if (body?.paymentId !== undefined) {
    if (state !== 'review' || reason !== 'candidates') fail(409, 'This record is not waiting for a bill choice')
    const chosen = id(body.paymentId)
    if (!(calendar.candidates || []).map(String).includes(chosen)) fail(400, 'Choose one of the offered bills')
    const bill: any = await Payment.findOne({ _id: chosen, source: { $exists: false }, suppressedAt: { $exists: false } }).lean()
    if (!bill) fail(409, 'The chosen bill changed; refresh and choose again')
    if (!await member(ownerId, bill.organizationId)) fail(403, 'Access denied to this organization') // guard:choice-membership
    const adopted = await Payment.findOneAndUpdate({ _id: bill._id, source: { $exists: false }, suppressedAt: { $exists: false } }, { $set: { source: { kind: 'card-statement', provider: 'aplus', accountId: account._id, periodKey: evidence.periodKey, statementMonth: evidence.statementMonth, ...(provenance.noticeId ? { noticeId: provenance.noticeId } : {}), ...(provenance.importId ? { importId: provenance.importId } : {}), statementTotal: evidence.statementTotal, dueDateEvidence: evidence.dueDateEvidence, adopted: true, adoptedAt: at, linkedBy: ownerId, linkedAt: at, updatedAt: at } } }, { new: true })
    if (!adopted) fail(409, 'The chosen bill changed; refresh and choose again')
    return { calendar: await reconcileBill(ownerId, account, evidence, source), action: { kind: 'payment', paymentId: bill._id, by: ownerId, at } }
  }
  if (body?.organizationId !== undefined) {
    if (state !== 'review' || reason !== 'company') fail(409, 'This record is not waiting for a company choice')
    const chosen = id(body.organizationId)
    if (!(calendar.companies || []).map(String).includes(chosen)) fail(400, 'Choose one of the offered companies')
    if (!await member(ownerId, chosen)) fail(403, 'Access denied to this organization')
    return { calendar: await reconcileBill(ownerId, account, evidence, source, { company: chosen }), action: { kind: 'organization', organizationId: chosen, by: ownerId, at } }
  }
  if (body?.create === true) {
    if (state !== 'review' || reason !== 'candidates') fail(409, 'This record is not waiting for a bill choice')
    if (!await member(ownerId, account.organizationId)) fail(403, 'Access denied to this organization')
    return { calendar: await reconcileBill(ownerId, account, evidence, source, { force: 'create' }), action: { kind: 'create', by: ownerId, at } }
  }
  return null
}

// ── PUT notices/:id/link — the member's explicit review action ──
export async function linkNotice(ownerId: string, noticeId: string, body: any) {
  const notice: any = await FinanceNotice.findOne({ _id: id(noticeId), ownerId }).lean()
  if (!notice) fail(404, 'Notice not found')
  const account = await ownedAccount(ownerId, String(notice.accountId))
  const state = notice.calendar?.state, reason = notice.calendar?.reason, at = new Date()
  let calendar: any, action: any
  if (body?.retry === true) {
    // changed-body: the member accepts the first claims again; ambiguous-account (fold F1): the stored notice is re-evaluated
    // against the corrected configuration, for an Aplus bill or an Amex enqueue alike. No other review reason is retried.
    if (state !== 'review' || !['changed-body', ...RECOVERABLE_REVIEW_REASONS].includes(reason)) fail(409, 'This notice is not waiting for a retry')
    if (reason === 'changed-body' && notice.kind !== 'bill-confirmed') fail(409, 'This notice has no calendar bill')
    if (RECOVERABLE_REVIEW_REASONS.includes(reason) && (!account.billingMail?.enabled || String(account.billingMail.mailbox || '').toLowerCase() !== String(notice.mailbox || '').toLowerCase())) fail(409, 'This account no longer reads the mailbox of this notice')
    calendar = reason === 'changed-body' ? await reconcileBill(ownerId, account, noticeEvidence(notice), 'issuer-mail') : await evaluateNotice(ownerId, account, notice)
    action = { kind: 'retry', by: ownerId, at }
  } else {
    if (notice.kind !== 'bill-confirmed') fail(409, 'This notice has no calendar bill')
    if (body?.restore === true) {
      if (state !== 'suppressed' || !notice.calendar.paymentId) fail(409, 'This notice has no removed bill to restore')
      const bill: any = await Payment.findById(notice.calendar.paymentId).lean()
      if (!bill || !bill.suppressedAt) fail(409, 'The removed bill is no longer there')
      if (!await member(ownerId, bill.organizationId)) fail(403, 'Access denied to this organization')
      await Payment.updateOne({ _id: bill._id, suppressedAt: { $exists: true } }, { $unset: { suppressedAt: '', suppressedBy: '' } })
      calendar = await reconcileBill(ownerId, account, noticeEvidence(notice), 'issuer-mail'); action = { kind: 'restore', paymentId: bill._id, by: ownerId, at }
    } else {
      const chosen = await applyChoice(ownerId, account, noticeEvidence(notice), notice.calendar, body, 'issuer-mail', { noticeId: notice._id })
      if (!chosen) return fail(400, 'Choose a bill, a company, create, retry or restore')
      calendar = chosen.calendar; action = chosen.action
    }
  }
  await FinanceNotice.updateOne({ _id: notice._id }, { $set: { calendar, action, lastAttemptAt: at }, $inc: { attempts: 1 } })
  // The same choice completes the cycle's other waiting records (its statement batches, its other notices) — nothing else.
  if (notice.kind !== 'bill-confirmed') return { calendar, woken: { imports: 0, notices: 0 } }
  const evidence = noticeEvidence(notice)
  const woken = await wakeCycleWork(ownerId, account, evidence.periodKey, evidence.statementMonth, notice._id)
  return { calendar, woken }
}

// ── GET imports/:id/calendar — the statement batch's calendar state and the choices it offers this member (fold F2) ──
export async function importCalendarReview(ownerId: string, importId: string) {
  const batch = await ownedImport(ownerId, importId)
  const offers = await choiceOffers(ownerId, batch.calendar)
  return { id: String(batch._id), calendar: batch.calendar || null, action: batch.calendar?.action || null, ...offers }
}

// ── PUT imports/:id/calendar — the member's explicit choice for a statement batch, no notice required (fold F2) ──
export async function linkImport(ownerId: string, importId: string, body: any) {
  const batch = await ownedImport(ownerId, importId)
  if (batch.provider !== 'aplus' || batch.period?.kind !== 'statement') fail(409, 'This import has no calendar bill')
  const account = await ownedAccount(ownerId, String(batch.accountId))
  const evidence = importEvidence(batch)
  const chosen = await applyChoice(ownerId, account, evidence, batch.calendar, body, 'statement-csv', { importId: batch._id })
  if (!chosen) return fail(400, 'Choose a bill, a company or create')
  // The member's action travels inside the batch's calendar record (the import schema declares `calendar` only).
  const calendar = { ...chosen.calendar, action: chosen.action }
  await FinanceImport.updateOne({ _id: batch._id }, { $set: { calendar } })
  const woken = await wakeCycleWork(ownerId, account, evidence.periodKey, evidence.statementMonth, undefined, batch._id)
  return { calendar, woken }
}
