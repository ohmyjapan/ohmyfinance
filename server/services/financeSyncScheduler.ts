// server/services/financeSyncScheduler.ts — the daily Aplus schedule (plan omf-auto-sync-build-20261014 §2 A4).
// One tick (server/plugins/syncSchedule.ts) reads every active Aplus account with 自動取得 on and, for each one that is due
// in JST, asks queueScheduledSync for the one atomic enqueue; that write's filter is the contract, dueAccounts is only the
// readable pre-filter (and the replay's). The one read outside the atom is the unrevoked-collector check, the same test the
// manual button makes: a revocation in that window leaves a queued job that no device can claim, exactly as today.
import { FinancialAccount, FinanceCollector } from '../models/Finance'
import { queueScheduledSync, ready } from './financeService'

const JST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
function jstParts(now: Date) { const parts: Record<string, string> = {}; for (const part of JST.formatToParts(now)) parts[part.type] = part.value; return parts }
/** The JST calendar day of `now`, YYYY-MM-DD. */
export function jstDay(now: Date) { const p = jstParts(now); return `${p.year}-${p.month}-${p.day}` }
/** The JST hour of `now`, 0-23. */
export function jstHour(now: Date) { return Number(jstParts(now).hour) % 24 }
/** The instant the JST day of `now` began (JST is UTC+9 with no daylight saving). */
export function jstDayStartUtc(now: Date) { const [y, m, d] = jstDay(now).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d) - 9 * 3600000) }
/** The rows whose hour has passed today, not queued today, with no job queued/running and none attempted today. */
export function dueAccounts(rows: any[], now: Date) {
  const day = jstDay(now), hour = jstHour(now), dayStart = jstDayStartUtc(now)
  return rows.filter(row => row?.provider === 'aplus' && row.active !== false && row.autoSync?.enabled === true && Number(row.autoSync.hour) <= hour && row.autoSync.lastQueuedDay !== day
    && !['queued','running','verification_required'].includes(row.jobState) && (!row.lastAttemptAt || new Date(row.lastAttemptAt) < dayStart))
}
/** One schedule tick at `now`: returns the ids queued by this tick. */
export async function runSyncSchedule(now = new Date()) {
  await ready()
  const day = jstDay(now), hour = jstHour(now), dayStartUtc = jstDayStartUtc(now)
  const rows: any[] = await FinancialAccount.find({ provider: 'aplus', active: true, 'autoSync.enabled': true }).lean()
  const queued: string[] = []
  for (const row of dueAccounts(rows, now)) {
    if (!await FinanceCollector.exists({ ownerId: row.ownerId, accountIds: row._id, revokedAt: null })) continue
    const updated: any = await queueScheduledSync(row, { day, hour, dayStartUtc, now })
    if (updated) queued.push(String(updated._id))
  }
  return { queued }
}
