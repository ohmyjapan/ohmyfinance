// Daily web-bank collection (plan omf-workflow-daily-20261025 Phase B): the owner's opt-in setting per bank account and the tick that
// queues one retrieval per account and JST day on the existing durable BankJob queue. Bank-only and separate from the Aplus schedule
// (financeSyncScheduler.ts / plugins/syncSchedule.ts are not used or changed). The manual 取得 (queueBankSync) and the CSV import are
// unchanged; the collector claims a scheduled job exactly like a manual one, so its saved-login journal and one-attempt boundaries apply
// unchanged (collector/bank.mjs ensureBankLogin) — the schedule never touches a login.
// One run per day without a separate marker: the scheduled job IS the occurrence (unique owner/account/schedule.day index) and is open
// from its creation (the existing open-job index), so repeated or concurrent ticks, other server processes, restarts and a crash
// between any two writes leave at most one scheduled job per day. A running job whose lease expired is never closed or duplicated here:
// it stays claimable and the PC resumes it (the one recovery lane). A scheduled job still queued from an earlier day is replaced when
// today's run is due (missed/offline days coalesce into one run through today), and one whose setting or connection no longer authorizes
// it is closed as superseded; neither was ever claimed. A job a tick inserted from a setting read just before the owner changed it (or
// after a manual 取得 completed) and could not close because its process stopped is closed by the PC's claim instead
// (financeBankCollectionService.ts claimBankJob → scheduledRunCurrent), before any PC receives it. A failed run is shown, not held: the
// next day's run is queued as usual and the collector's own journal/marker never sends an unconfirmed or refused saved login again.
import mongoose from 'mongoose'
import { ready, fail } from './financeService'
import { FinanceCollector } from '../models/Finance'
import { BankAccount, BankTemplate, BankJob, initializePaymentMatching } from '../models/FinancePaymentMatch'
import { ownedBankAccount } from './financeBankStatementService'
import { queueScheduledBankJob } from './financeBankCollectionService'
import { frozenCoverage } from '../../shared/finance-payment-match.mjs'
import { bankScheduleInput, storedBankSchedule, bankScheduleBinding, bankScheduleSupport, bankScheduleState, jstDay, jstDayStart } from '../../shared/finance-bank-schedule.mjs'

async function init() { await ready(); await initializePaymentMatching() }
const sid = (v: any) => String(v ?? '')
const ACTIVE = ['queued', 'running', 'verification_required'], UNAUTHORIZED = ['off', 'unsupported', 'reconfirm']
const STALE = '自動取得の設定が他の画面で変更されました。再読み込みしてください。'
const UNSUPPORTED: Record<string, string> = {
  'no-connection': '先に銀行の接続を保存してください。',
  'observe-only': 'このログイン方式は自動取得の手順が未確認のため、毎日の自動取得の対象外です（「観察取得」「ガイド付き取得」のボタンはこれまでどおり使えます）。',
  unmapped: '列の割り当て（テンプレート）がない接続は、毎日の自動取得の対象外です。最初の明細を割り当てて、そのテンプレートで接続を保存してください。',
  'no-coverage': '取得期間（開始日）を接続に保存してください。',
  'template-missing': '接続のテンプレートが見つかりません。接続を保存し直してください。'
}
const REPLACED_DAY = '新しい日の自動取得に置き換えました（PCが受け取る前のため、銀行へのログインは行っていません）'
const REPLACED_SETTING = '自動取得の設定または接続が変わったため、この予約は実行しません（PCが受け取る前のため、銀行へのログインは行っていません）'

// The unrevoked PCs this account is granted to now (GUARD g1's scope, read the way the manual request reads it).
async function scopedCollectors(account: any): Promise<string[]> {
  return ((await FinanceCollector.find({ ownerId: account.ownerId, bankAccountIds: account._id, revokedAt: null }).select('_id').lean()) as any[]).map(c => sid(c._id)).sort()
}
async function templateExists(account: any) {
  const templateId = account.connection?.templateId
  if (!templateId) return true
  return mongoose.isValidObjectId(templateId) && !!await BankTemplate.exists({ _id: templateId, ownerId: account.ownerId })
}
// What bankScheduleState needs: every active job, the latest job and the latest retrieval requested today (superseded ones excluded).
async function stateOf(account: any, now: Date) {
  const scope = { ownerId: account.ownerId, bankAccountId: account._id }, live = { ...scope, state: { $ne: 'superseded' } }
  const [collectorIds, active, latest, today, template] = await Promise.all([
    scopedCollectors(account),
    BankJob.find({ ...scope, state: { $in: ACTIVE } }).lean(),
    BankJob.find(live).sort({ requestedAt: -1, _id: -1 }).limit(1).lean(),
    BankJob.find({ ...live, kind: 'retrieve', requestedAt: { $gte: jstDayStart(now) } }).sort({ requestedAt: -1, _id: -1 }).limit(1).lean(),
    templateExists(account)
  ])
  const jobs = new Map<string, any>(); for (const j of [...active, ...latest, ...today] as any[]) jobs.set(sid(j._id), j)
  return bankScheduleState({ schedule: account.schedule, connection: account.connection, templateExists: template, collectorIds, jobs: [...jobs.values()], now })
}
function view(account: any, status: any, now: Date) {
  const s = storedBankSchedule(account.schedule)
  let coverage: any = null; try { coverage = account.connection?.coverage ? frozenCoverage(account.connection.coverage, jstDay(now)) : null } catch { coverage = null }
  return { schedule: { enabled: s.enabled, hour: s.hour, revision: s.revision, savedAt: s.savedAt }, status, coverage, supported: !bankScheduleSupport(account.connection, jstDay(now)), timezone: 'Asia/Tokyo' }
}
// Close one still-queued scheduled job (never claimed: the filter is its queued state and day); its day moves to supersededDay.
async function supersede(job: any, now: Date, message: string) {
  const day = job.schedule?.day; if (typeof day !== 'string') return false
  return (await BankJob.updateOne({ _id: job._id, state: 'queued', 'schedule.day': day }, { $set: { state: 'superseded', open: false, completedAt: now, lastMessage: message, 'schedule.supersededDay': day }, $unset: { 'schedule.day': '' } })).modifiedCount === 1
}
const queuedScheduled = (account: any) => BankJob.find({ ownerId: account.ownerId, bankAccountId: account._id, state: 'queued', 'schedule.day': { $type: 'string' } }).lean()

/** The owner's setting and its current state (owner-scoped; another owner's account is 404). */
export async function readBankSchedule(ownerId: string, accountId: string, now = new Date()) {
  await init(); const account = await ownedBankAccount(ownerId, accountId)
  return view(account, await stateOf(account, now), now)
}
/**
 * Save the setting at the revision the owner read (409 when another save came first). Turning it on needs a supported connection and,
 * like the manual 取得, an unrevoked PC allowed this account; it records the connection's binding, so a later provider/variant/template
 * change stops the schedule until it is saved again (the PCs are the existing grant and are not recorded). Saving never touches the
 * connection or a job, except that a still-queued scheduled job the new setting no longer authorizes is closed (superseded).
 */
export async function saveBankSchedule(ownerId: string, accountId: string, body: any, now = new Date()) {
  await init()
  let input: any; try { input = bankScheduleInput(body) } catch (e: any) { fail(400, e.message) }
  const account = await ownedBankAccount(ownerId, accountId), stored = storedBankSchedule(account.schedule)
  if (input.revision !== stored.revision) fail(409, STALE)
  let next: any
  if (input.enabled) {
    const reason = bankScheduleSupport(account.connection, jstDay(now)) ?? (await templateExists(account) ? null : 'template-missing')
    if (reason) fail(400, UNSUPPORTED[reason])
    if (!(await scopedCollectors(account)).length) fail(409, 'PC未接続: この口座の取得を許可した接続済みのPCがありません。')
    next = { enabled: true, hour: input.hour, revision: stored.revision + 1, savedAt: now, binding: bankScheduleBinding(account.connection) }
  } else next = { enabled: false, hour: input.hour, revision: stored.revision + 1, savedAt: now, binding: null }
  // Compare-and-set on the stored revision exactly as read (absent for a first save or a malformed stored value).
  const raw = account.schedule && typeof account.schedule === 'object' ? account.schedule.revision : undefined
  const saved = await BankAccount.updateOne({ _id: account._id, ownerId, 'schedule.revision': raw === undefined ? { $exists: false } : raw }, { $set: { schedule: next } })
  if (!saved.matchedCount) fail(409, STALE)
  const fresh: any = await BankAccount.findOne({ _id: account._id, ownerId }).lean(), status = await stateOf(fresh, now)
  if (UNAUTHORIZED.includes(status.state)) for (const job of await queuedScheduled(fresh)) await supersede(job, now, REPLACED_SETTING)
  return view(fresh, UNAUTHORIZED.includes(status.state) ? await stateOf(fresh, now) : status, now)
}
// One account at `now`: close queued scheduled jobs it no longer authorizes; when due, replace an earlier day's queued run and queue
// today's; then read the setting again and close the new job if a save or connection change landed meanwhile.
async function scheduleAccount(account: any, now: Date) {
  const result: { queued: string | null, superseded: string[], state: string } = { queued: null, superseded: [], state: '' }
  const status = await stateOf(account, now); result.state = status.state
  if (UNAUTHORIZED.includes(status.state)) { for (const job of await queuedScheduled(account)) if (await supersede(job, now, REPLACED_SETTING)) result.superseded.push(job.jobId); return result }
  if (status.state !== 'due') return result
  const day = jstDay(now)
  for (const job of await queuedScheduled(account)) if (job.schedule.day < day && await supersede(job, now, REPLACED_DAY)) result.superseded.push(job.jobId)
  const template: any = await BankTemplate.findOne({ _id: account.connection.templateId, ownerId: account.ownerId }).lean(); if (!template) return result
  const job: any = await queueScheduledBankJob(account, template, { day, now, revision: storedBankSchedule(account.schedule).revision })
  if (!job) return result
  const fresh: any = await BankAccount.findOne({ _id: account._id, ownerId: account.ownerId }).lean(), after = fresh ? await stateOf(fresh, now) : null
  if (!after || UNAUTHORIZED.includes(after.state)) { if (await supersede(job, now, REPLACED_SETTING)) result.superseded.push(job.jobId); return result }
  result.queued = job.jobId
  return result
}
/** One tick at `now` over every account whose schedule is on; one account's failure is logged by name only and the others continue. */
export async function runBankSchedule(now = new Date()) {
  await init()
  const accounts: any[] = await BankAccount.find({ 'schedule.enabled': true }).lean()
  const queued: string[] = [], superseded: string[] = [], states: Record<string, number> = {}; let failed = 0
  for (const account of accounts) {
    try { const r = await scheduleAccount(account, now); if (r.queued) queued.push(r.queued); superseded.push(...r.superseded); states[r.state] = (states[r.state] || 0) + 1 }
    catch (error: any) { failed++; console.error('[Finance] bank schedule account failed', error?.name || 'Error') }
  }
  return { queued, superseded, states, failed }
}
