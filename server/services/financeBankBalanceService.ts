// Hourly background bank balances (plan omf-bank-hourly-balances-20261027): the owner's balance setting and view per bank account, the
// manual refresh, the hourly tick, the claim-time check and the collector's receipt — on the existing exclusive BankJob queue (kind
// `balance`, server/models/FinancePaymentMatch.ts) with immutable snapshots (server/models/FinanceBankBalance.ts). Balance only: no CSV,
// statement, row, calendar entry, transfer or forecast is ever written here; statements keep priority. The collector reads the balance
// in its protected background Chrome with the account's own saved login (collector/bank-balance.mjs); the schedule never touches a login.
// One automatic run per account and JST hour (the partial unique index on balance.slot) and never sooner than 60 minutes after the
// account's last bank access (shared balanceState); missed hours coalesce into one newest run. Nothing runs until the owner turns it on
// and selects one of their PCs already allowed this account (no new PC trust); an old collector that does not advertise balance-v1
// never receives a balance job, and only the selected PC does (financeBankCollectionService.claimBankJob).
import { randomUUID, createHash } from 'node:crypto'
import mongoose from 'mongoose'
import { createError } from 'h3'
import { ready, fail } from './financeService'
import { FinanceCollector } from '../models/Finance'
import { BankAccount, BankJob, initializePaymentMatching } from '../models/FinancePaymentMatch'
import { BankBalance, BankCollectorCapability, initializeBankBalances } from '../models/FinanceBankBalance'
import { ownedBankAccount } from './financeBankStatementService'
import { BALANCE_INTERVAL_MINUTES, BALANCE_SOURCES, balanceSettingInput, storedBalanceSetting, balanceBinding, sameBalanceBinding, balanceSupport, balanceState, balanceSlotKey, balanceReceiptInput, balanceLagStale, balanceFreshness } from '../../shared/finance-bank-balance.mjs'

async function init() { await ready(); await initializePaymentMatching(); await initializeBankBalances() }
const sid = (v: any) => String(v ?? '')
const oid = (v: any) => new mongoose.Types.ObjectId(String(v))
const ACTIVE = ['queued', 'running', 'verification_required'], UNAUTHORIZED = ['off', 'unsupported', 'reconfirm', 'waiting-pc', 'upgrade']
const STALE = '残高の確認の設定が他の画面で変更されました。再読み込みしてください。'
const UNSUPPORTED: Record<string, string> = {
  'no-connection': '先に銀行の接続を保存してください。',
  unsupported: 'この銀行・ログイン方式は残高の確認の対象外です（楽天銀行・PayPay銀行の標準ログインと池田泉州銀行のビジネスゲートが対象です）。',
  'no-identity': '口座の支店名・種別・口座番号（7桁）を接続に保存してください。銀行の画面でこの口座の残高を選んで読むために使います。'
}
const NOT_BEFORE_PC = '（PCが受け取る前に止めたため、銀行へのログインは行っていません）'
const CLOSED: Record<string, string> = {
  'balance-off': '1時間ごとの残高の確認がオフになったため、この予約は実行しません' + NOT_BEFORE_PC,
  'connection-changed': '予約した後に接続の銀行・ログイン方式・口座が変わったため、この残高の確認は実行しません' + NOT_BEFORE_PC,
  'setting-changed': '予約した後に残高の確認の設定（確認するPC）が変わったため、この予約は実行しません' + NOT_BEFORE_PC
}
const REPLACED_HOUR = '新しい時間の残高の確認に置き換えました' + NOT_BEFORE_PC
const REPLACED_SETTING = '残高の確認の設定または接続が変わったため、この予約は実行しません' + NOT_BEFORE_PC
export const BALANCE_YIELDED = '明細の取得を優先したため、この残高の確認は実行しません' + NOT_BEFORE_PC + '。明細の取得が終わると、次の確認を予約します'

// The selected PC as the balance state needs it: allowed this account now (unrevoked, in its bank scope) and its last claim capability.
async function collectorOf(account: any, collectorId: string | null) {
  if (!collectorId) return null
  const c: any = await FinanceCollector.findOne({ _id: collectorId, ownerId: account.ownerId }).select('_id name bankAccountIds revokedAt').lean()
  if (!c) return { id: collectorId, name: null, granted: false, capable: null, seenAt: null }
  const cap: any = await BankCollectorCapability.findOne({ ownerId: account.ownerId, collectorId: c._id }).lean()
  return { id: sid(c._id), name: c.name, granted: !c.revokedAt && (c.bankAccountIds || []).some((v: any) => sid(v) === sid(account._id)), capable: cap ? cap.balance === true : null, seenAt: cap?.seenAt ?? null }
}
// What balanceState needs: every active job of the account (any kind), its latest balance jobs and the latest claimed one.
// `authorization` reads only the setting, connection and PC (no job): whether the setting still authorizes automatic runs at all.
async function stateOf(account: any, now: Date, { authorization = false } = {}) {
  const scope = { ownerId: account.ownerId, bankAccountId: account._id }, s = storedBalanceSetting(account.balanceSetting)
  if (authorization) return balanceState({ setting: account.balanceSetting, connection: account.connection, collector: await collectorOf(account, s.collectorId), jobs: [], now })
  const [active, recent, claimed, collector] = await Promise.all([
    BankJob.find({ ...scope, state: { $in: ACTIVE } }).lean(),
    BankJob.find({ ...scope, kind: 'balance', state: { $ne: 'superseded' } }).sort({ requestedAt: -1, _id: -1 }).limit(5).lean(),
    BankJob.find({ ...scope, kind: 'balance', state: { $ne: 'superseded' }, 'balance.claimedAt': { $exists: true } }).sort({ 'balance.claimedAt': -1 }).limit(1).lean(),
    collectorOf(account, s.collectorId)
  ])
  const jobs = new Map<string, any>(); for (const j of [...active, ...recent, ...claimed] as any[]) jobs.set(sid(j._id), j)
  return balanceState({ setting: account.balanceSetting, connection: account.connection, collector, jobs: [...jobs.values()], now })
}
const snapView = (b: any, now: Date) => ({ id: sid(b._id), jobId: b.jobId, provider: b.provider, variant: b.variant, currency: b.currency, amount: b.amount, available: b.available ?? null, asOf: b.asOf, observedAt: b.observedAt, receivedAt: b.receivedAt, stale: b.stale === true, fresh: b.stale !== true && balanceFreshness({ asOf: b.asOf, now }) === 'fresh', trigger: b.trigger || 'manual', timeLabel: (BALANCE_SOURCES as any)[b.provider]?.timeLabel || null })
async function view(account: any, status: any, now: Date) {
  const s = storedBalanceSetting(account.balanceSetting), reason = balanceSupport(account.connection)
  const [snaps, devices] = await Promise.all([
    BankBalance.find({ ownerId: account.ownerId, bankAccountId: account._id }).sort({ asOf: -1, observedAt: -1, _id: -1 }).limit(10).lean(),
    FinanceCollector.find({ ownerId: account.ownerId, revokedAt: null }).select('_id name bankAccountIds').sort({ name: 1, _id: 1 }).lean()
  ])
  const caps: any[] = devices.length ? await BankCollectorCapability.find({ ownerId: account.ownerId, collectorId: { $in: devices.map((d: any) => d._id) } }).lean() : []
  const collectors = (devices as any[]).map(d => { const cap = caps.find(c => sid(c.collectorId) === sid(d._id)); return { id: sid(d._id), name: d.name, granted: (d.bankAccountIds || []).some((v: any) => sid(v) === sid(account._id)), capable: cap ? cap.balance === true : null, seenAt: cap?.seenAt ?? null } })
  return { supported: !reason, reason, provider: account.connection?.provider ?? null, variant: account.connection?.variant ?? null, intervalMinutes: BALANCE_INTERVAL_MINUTES, timezone: 'Asia/Tokyo', setting: { enabled: s.enabled, collectorId: s.collectorId, revision: s.revision, savedAt: s.savedAt }, collectors, status, latest: snaps[0] ? snapView(snaps[0], now) : null, history: (snaps as any[]).map(b => snapView(b, now)) }
}
// Close one still-queued balance job no PC received (the filter is its queued, unclaimed state); its slot moves to supersededSlot.
async function supersede(job: any, now: Date, message: string) {
  return (await BankJob.updateOne({ _id: job._id, kind: 'balance', state: 'queued', 'balance.claimedAt': { $exists: false } }, { $set: { state: 'superseded', open: false, completedAt: now, lastMessage: message, 'balance.supersededSlot': job.balance?.slot ?? null }, $unset: { 'balance.slot': '' } })).modifiedCount === 1
}
const queuedBalance = (account: any, filter: any = {}) => BankJob.find({ ownerId: account.ownerId, bankAccountId: account._id, kind: 'balance', state: 'queued', 'balance.claimedAt': { $exists: false }, ...filter }).lean()
/** Statements first: every never-claimed queued balance job of the account yields to a statement request (an in-flight one is never touched). */
export async function yieldQueuedBalance(ownerId: any, bankAccountId: any, now: Date) {
  let n = 0; for (const job of await queuedBalance({ ownerId, _id: bankAccountId })) if (await supersede(job, now, BALANCE_YIELDED)) n++ // guard:balance-statement-priority
  return n
}
// The interpretation frozen on a balance job: provider, login variant, currency and — 池田泉州銀行 — the account identity to read.
function snapshotOf(account: any) {
  const c = account.connection, snapshot: any = { kind: 'balance', parserVersion: 'bank-balance-1', provider: c.provider, variant: c.variant ?? null, currency: account.currency || 'JPY' }
  if (c.provider === 'ikeda' && c.accountIdentity) snapshot.accountIdentity = { branch: String(c.accountIdentity.branch), type: String(c.accountIdentity.type), number: String(c.accountIdentity.number) }
  return { snapshot, snapshotHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') }
}
async function queueBalanceJob(account: any, { trigger, now, slot = null, revision, collectorId }: { trigger: 'hourly' | 'manual', now: Date, slot?: string | null, revision: number, collectorId: any }) {
  const { snapshot, snapshotHash } = snapshotOf(account)
  const message = trigger === 'hourly' ? '1時間ごとの残高の確認を予約しました' : '残高の確認を予約しました'
  try { return (await BankJob.create({ ownerId: account.ownerId, bankAccountId: account._id, jobId: randomUUID(), kind: 'balance', state: 'queued', open: true, requestedAt: now, lastMessage: message, snapshot, snapshotHash, statementIds: [], observation: null, balance: { trigger, collectorId: oid(collectorId), revision, binding: balanceBinding(account.connection), ...(slot ? { slot } : {}) } })).toObject() }
  catch (e: any) { if (e?.code === 11000) return null; throw e }
}
/** One automatic run of `slot` for the setting read at `revision` (the tick; null when the hour or another open job already has one). */
export function queueHourlyBalance(account: any, { now, slot, revision, collectorId }: { now: Date, slot: string, revision: number, collectorId: any }) { return queueBalanceJob(account, { trigger: 'hourly', now, slot, revision, collectorId }) }

/** The owner's balance view of one account (owner-scoped; another owner's account is 404). Reads OMF only — never asks the bank. */
export async function readBankBalance(ownerId: string, accountId: string, now = new Date()) {
  await init(); const account = await ownedBankAccount(ownerId, accountId)
  return view(account, await stateOf(account, now), now)
}
/**
 * Save the setting at the revision the owner read (409 when another save came first). A selected PC must be one of the owner's
 * unrevoked PCs already allowed this account; turning it on needs a supported connection and records its binding. Saving never touches
 * the connection, the statement schedule or a job in flight; still-queued automatic runs of the earlier setting (and a queued manual run
 * for another PC) are closed — no PC received them.
 */
export async function saveBankBalanceSetting(ownerId: string, accountId: string, body: any, now = new Date()) {
  await init()
  let input: any; try { input = balanceSettingInput(body) } catch (e: any) { fail(400, e.message) }
  const account = await ownedBankAccount(ownerId, accountId), stored = storedBalanceSetting(account.balanceSetting)
  if (input.revision !== stored.revision) fail(409, STALE)
  if (input.enabled) { const reason = balanceSupport(account.connection); if (reason) fail(400, UNSUPPORTED[reason]) }
  let collectorId: any = null
  if (input.collectorId) {
    const c: any = await FinanceCollector.findOne({ _id: input.collectorId, ownerId, revokedAt: null }).select('_id bankAccountIds').lean()
    if (!c) fail(400, '残高を確認するPCを確認してください。')
    if (!(c.bankAccountIds || []).some((v: any) => sid(v) === sid(account._id))) fail(409, 'このPCにはこの口座の取得が許可されていません。「取得を許可するPC」でこの口座を許可してから選んでください。') // guard:balance-pc-granted
    collectorId = c._id
  }
  const next = { enabled: input.enabled, collectorId, intervalMinutes: BALANCE_INTERVAL_MINUTES, revision: stored.revision + 1, savedAt: now, binding: input.enabled ? balanceBinding(account.connection) : null }
  const raw = account.balanceSetting && typeof account.balanceSetting === 'object' ? account.balanceSetting.revision : undefined
  const saved = await BankAccount.updateOne({ _id: account._id, ownerId, 'balanceSetting.revision': raw === undefined ? { $exists: false } : raw }, { $set: { balanceSetting: next } })
  if (!saved.matchedCount) fail(409, STALE)
  const fresh: any = await BankAccount.findOne({ _id: account._id, ownerId }).lean()
  for (const job of await queuedBalance(fresh)) if (job.balance?.trigger === 'hourly' || sid(job.balance?.collectorId) !== sid(collectorId)) await supersede(job, now, REPLACED_SETTING) // guard:balance-save-closes
  return view(fresh, await stateOf(fresh, now), now)
}
/** The owner's 残高を更新: one balance job for the selected PC now (also while automatic checks are off); never over another open job. */
export async function queueBalanceRefresh(ownerId: string, accountId: string, now = new Date()) {
  await init(); const account = await ownedBankAccount(ownerId, accountId)
  const reason = balanceSupport(account.connection); if (reason) fail(400, UNSUPPORTED[reason])
  const s = storedBalanceSetting(account.balanceSetting); if (!s.collectorId) fail(400, '先に残高を確認するPCを選んで保存してください。')
  const collector = await collectorOf(account, s.collectorId)
  if (!collector?.granted) fail(409, 'PC未接続: 選んだPCがこの口座の取得を許可された接続済みのPCではありません。')
  if (collector.capable === false) fail(409, '選んだPCのダウンローダーは残高の確認に対応していません。ダウンローダーを更新してください。')
  const open: any = await BankJob.findOne({ ownerId, bankAccountId: account._id, state: { $in: ACTIVE } }).select('kind').lean()
  if (open) fail(409, open.kind === 'balance' ? '残高の確認はすでに予約・実行中です。' : '明細の取得を予約・実行中のため、終わってから残高を確認してください。')
  const job = await queueBalanceJob(account, { trigger: 'manual', now, revision: s.revision, collectorId: s.collectorId })
  if (!job) fail(409, '残高の確認はすでに予約・実行中です。')
  return { job: { jobId: job.jobId, kind: job.kind, state: job.state, requestedAt: job.requestedAt }, message: '残高の確認を予約しました。選んだPCが画面の裏で銀行にサインインして残高を読み取ります（PCが起動していない間は待ちます）' }
}
// One account at `now`: close queued automatic runs it no longer authorizes; replace an earlier hour's queued run (missed hours coalesce);
// when due, queue this hour's run; then read the setting again and close the new run if a save or connection change landed meanwhile.
async function scheduleBalance(account: any, now: Date) {
  const result: { queued: string | null, superseded: string[], state: string } = { queued: null, superseded: [], state: '' }
  const authorized = await stateOf(account, now, { authorization: true })
  if (UNAUTHORIZED.includes(authorized.state)) { result.state = authorized.state; for (const job of await queuedBalance(account, { 'balance.trigger': 'hourly' })) if (await supersede(job, now, REPLACED_SETTING)) result.superseded.push(job.jobId); return result } // guard:balance-tick-authorization
  let status = await stateOf(account, now); result.state = status.state
  if (UNAUTHORIZED.includes(status.state)) { for (const job of await queuedBalance(account, { 'balance.trigger': 'hourly' })) if (await supersede(job, now, REPLACED_SETTING)) result.superseded.push(job.jobId); return result }
  const slot = balanceSlotKey(now)
  for (const job of await queuedBalance(account, { 'balance.trigger': 'hourly' })) if (typeof job.balance?.slot === 'string' && job.balance.slot < slot && await supersede(job, now, REPLACED_HOUR)) result.superseded.push(job.jobId) // guard:balance-coalesce
  if (result.superseded.length) { status = await stateOf(account, now); result.state = status.state }
  if (status.state !== 'due') return result
  const s = storedBalanceSetting(account.balanceSetting)
  const job: any = await queueHourlyBalance(account, { now, slot, revision: s.revision, collectorId: s.collectorId })
  if (!job) return result
  const fresh: any = await BankAccount.findOne({ _id: account._id, ownerId: account.ownerId }).lean(), after = fresh ? storedBalanceSetting(fresh.balanceSetting) : null
  if (!after || !after.enabled || after.revision !== s.revision || !sameBalanceBinding(after.binding, balanceBinding(fresh.connection))) { if (await supersede(job, now, REPLACED_SETTING)) result.superseded.push(job.jobId); return result }
  result.queued = job.jobId
  return result
}
/** One hourly tick at `now` over every account whose balance check is on; one account's failure is logged by name only. */
export async function runBalanceSchedule(now = new Date()) {
  await init()
  const accounts: any[] = await BankAccount.find({ 'balanceSetting.enabled': true }).lean()
  const queued: string[] = [], superseded: string[] = [], states: Record<string, number> = {}; let failed = 0
  for (const account of accounts) {
    try { const r = await scheduleBalance(account, now); if (r.queued) queued.push(r.queued); superseded.push(...r.superseded); states[r.state] = (states[r.state] || 0) + 1 }
    catch (error: any) { failed++; console.error('[Finance] bank balance account failed', error?.name || 'Error') }
  }
  return { queued, superseded, states, failed }
}
/** The last bank claim of a PC: whether it advertised balance-v1 (written only when it changed or a minute has passed). */
export async function recordClaimCapability(device: any, balance: boolean, now = new Date()) {
  await initializeBankBalances()
  const seen: any = await BankCollectorCapability.findOne({ ownerId: device.ownerId, collectorId: device._id }).lean()
  if (seen && seen.balance === balance && now.getTime() - new Date(seen.seenAt).getTime() < 60000) return
  try { await BankCollectorCapability.updateOne({ ownerId: device.ownerId, collectorId: device._id }, { $set: { balance, seenAt: now } }, { upsert: true }) } catch (e: any) { if (e?.code !== 11000) throw e }
}
/** The claim filter part for balance jobs: only with balance-v1, and only those targeting this PC (also on a lease reclaim). */
export function balanceClaimScope(device: any, capable: boolean) {
  return capable ? { $or: [{ kind: { $ne: 'balance' } }, { kind: 'balance', 'balance.collectorId': device._id }] } : { kind: { $ne: 'balance' } } // guard:balance-claim-capability
}
/**
 * GUARD — a balance job no PC received yet is run only while the account still authorizes it: the same provider/variant/account it
 * froze, an automatic run under the setting's current revision while it is on, and the setting's PC is this PC. Otherwise it is closed
 * as superseded before the PC receives it (returns the reason). It is marked received (balance.claimedAt) before it is returned and is
 * never re-judged: a reclaim after an expired lease resumes it.
 */
export async function balanceClaimCheck(job: any, account: any, device: any, now: Date) {
  const s = storedBalanceSetting(account?.balanceSetting)
  let reason: string | null = null
  if (!account || balanceSupport(account.connection) || !sameBalanceBinding(job.balance?.binding, balanceBinding(account.connection))) reason = 'connection-changed' // guard:balance-claim-binding
  else if (job.balance?.trigger === 'hourly' && !s.enabled) reason = 'balance-off'
  else if ((job.balance?.trigger === 'hourly' && job.balance?.revision !== s.revision) || sid(s.collectorId) !== sid(device._id)) reason = 'setting-changed' // guard:balance-claim-setting
  if (reason) { await BankJob.updateOne({ _id: job._id, collectorId: device._id, state: 'running' }, { $set: { state: 'superseded', open: false, completedAt: now, lastMessage: CLOSED[reason], 'balance.supersededSlot': job.balance?.slot ?? null }, $unset: { 'balance.slot': '', leaseUntil: '' } }); return reason }
  await BankJob.updateOne({ _id: job._id, collectorId: device._id, state: 'running' }, { $set: { 'balance.claimedAt': now } })
  return null
}
// A permanent refusal with its stable code (the shape financeBankStatementService uses for capture-other-account).
const refused = (statusCode: number, code: string, message: string): never => { throw createError({ statusCode, statusMessage: 'Finance request failed', data: { message, code } }) }
/**
 * The collector's normalized balance receipt for a balance job of its bank scope that it received (any state: a lost acknowledgement or
 * a resent outbox may arrive after the lease). Bound to this PC, the job's snapshot hash, provider and variant (balanceReceiptInput);
 * refused with a stable code (the collector keeps it and never resends) when the account's connection no longer is the provider/variant/
 * account the job froze (balance-identity-changed) or another receipt was already stored for the job (balance-receipt-conflict). The
 * same receipt again returns the stored snapshot. Completion of the job then needs it (bankJobStatus).
 */
export async function acceptBalanceReceipt(device: any, query: any, bytes: Buffer, mimeType: string) {
  await init()
  if (typeof query?.jobId !== 'string' || !query.jobId) fail(400, 'Invalid job')
  if (mimeType !== 'application/json') fail(415, 'Balance JSON required')
  const job: any = await BankJob.findOne({ ownerId: device.ownerId, bankAccountId: { $in: device.bankAccountIds || [] }, jobId: query.jobId, kind: 'balance' }).lean()
  if (!job || sid(job.balance?.collectorId) !== sid(device._id) || !job.balance?.claimedAt) fail(409, 'Balance job is unavailable for this collector') // guard:balance-receipt-owner
  if (query.snapshotHash !== job.snapshotHash) fail(400, '残高の確認時の設定が一致しません。')
  let body: any; try { body = JSON.parse(bytes.toString('utf8')) } catch { fail(400, '残高の受信内容を確認できません。') }
  const now = new Date(); let receipt: any
  try { receipt = balanceReceiptInput(body, { jobId: job.jobId, snapshotHash: job.snapshotHash, provider: job.snapshot?.provider, variant: job.snapshot?.variant ?? null, now }) } catch (e: any) { fail(400, e.message) }
  const account: any = await BankAccount.findOne({ _id: job.bankAccountId, ownerId: job.ownerId }).lean()
  if (!account || !sameBalanceBinding(job.balance?.binding, balanceBinding(account.connection))) refused(409, 'balance-identity-changed', '残高の確認を予約した後に接続の銀行・口座が変わったため、この残高は保存しません。') // guard:balance-receipt-identity
  const receiptHash = createHash('sha256').update(JSON.stringify(receipt)).digest('hex')
  const doc = { ownerId: job.ownerId, bankAccountId: job.bankAccountId, jobId: job.jobId, collectorId: device._id, provider: receipt.provider, variant: receipt.variant, currency: receipt.currency, amount: receipt.amount, available: receipt.available, asOf: new Date(receipt.asOf), observedAt: new Date(receipt.observedAt), receivedAt: now, stale: balanceLagStale(receipt), trigger: job.balance?.trigger === 'hourly' ? 'hourly' : 'manual', snapshotHash: job.snapshotHash, receiptHash, source: receipt.source }
  let stored: any = null, duplicate = false
  try { stored = (await BankBalance.create(doc)).toObject() } catch (e: any) {
    if (e?.code !== 11000) throw e
    stored = await BankBalance.findOne({ ownerId: job.ownerId, jobId: job.jobId }).lean(); duplicate = true
    if (!stored || stored.receiptHash !== receiptHash) refused(409, 'balance-receipt-conflict', 'この残高の確認には別の内容の残高がすでに保存されています。') // guard:balance-receipt-idempotent
  }
  await BankJob.updateOne({ _id: job._id }, { $set: { 'balance.receiptAt': job.balance?.receiptAt ?? now, 'balance.snapshotId': stored._id } })
  const newest: any = await BankBalance.findOne({ ownerId: job.ownerId, bankAccountId: job.bankAccountId }).sort({ asOf: -1, observedAt: -1, _id: -1 }).select('_id').lean()
  return { stored: true, id: sid(stored._id), duplicate, latest: sid(newest?._id) === sid(stored._id) }
}
