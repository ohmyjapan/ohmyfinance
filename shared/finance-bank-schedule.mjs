// Daily web-bank collection (plan omf-workflow-daily-20261025 Phase B): the JST time rules, the saved-setting input, which connections
// a schedule may run, the ONE derived state of an account's schedule and the check a scheduled job passes when a PC first claims it.
// The tick (server/services/financeBankScheduleService.ts) queues a job only in state `due`; the screen (components/intake/
// BankConnections.vue) shows the same state; claimBankJob (financeBankCollectionService.ts) runs scheduledRunCurrent. Portable
// browser/Node module: no database and no clock beyond the `now` passed in. JST is UTC+9 with no daylight saving.
// GUARDS (independent review required): opt-in, support, the saved connection binding, the active/claimable job and the one automatic
// run per JST day. Each is a state below, never a refusal of the connection or of the manual 取得. The PCs allowed an account are the
// existing grant (bank scope): the schedule adds no PC rule of its own. A failed run is shown (lastFailure), not held: the next day's run
// is queued as usual and the collector's own saved-login journal and pending marker keep an unconfirmed or refused login unsent.
import { bankCollectionMode, bankCoverageInput, bankCoverageWindow, bankIdentityRequired } from './finance-payment-match.mjs';

const JST_MS = 9 * 3600000, DAY_MS = 86400000;
const day0 = day => Date.parse(day + 'T00:00:00.000Z');
/** The JST calendar day of `now`, YYYY-MM-DD. */
export function jstDay(now) { return new Date(now.getTime() + JST_MS).toISOString().slice(0, 10); }
/** The JST hour of `now`, 0-23. */
export function jstHour(now) { return new Date(now.getTime() + JST_MS).getUTCHours(); }
/** The instant the JST day of `now` began. */
export function jstDayStart(now) { return new Date(day0(jstDay(now)) - JST_MS); }
/** The instant of `hour`:00 JST on `day`. */
export function jstInstant(day, hour) { return new Date(day0(day) + hour * 3600000 - JST_MS); }
/** The calendar day after `day`. */
export function nextDay(day) { return new Date(day0(day) + DAY_MS).toISOString().slice(0, 10); }

export const BANK_SCHEDULE_DEFAULT_HOUR = 9;
// The owner's save: enabled (boolean), hour (integer 0-23, JST) and revision (the stored revision the owner read; 0 before the first
// save). The rule of the Aplus autoSyncInput: anything else is a 400 with the reason.
export function bankScheduleInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('自動取得の設定を確認してください。');
  if (typeof body.enabled !== 'boolean') throw Error('自動取得のオン・オフを確認してください。');
  if (!Number.isInteger(body.hour) || body.hour < 0 || body.hour > 23) throw Error('自動取得の時刻は0〜23時（日本時間）で指定してください。');
  if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw Error('自動取得の設定を再読み込みしてください。');
  return { enabled: body.enabled, hour: body.hour, revision: body.revision };
}
/** The authority a schedule was saved for: the connection's provider, login variant and template (label/period are frozen per job). */
export function bankScheduleBinding(connection) {
  return { provider: String(connection?.provider ?? ''), variant: connection?.variant == null ? null : String(connection.variant), templateId: connection?.templateId == null ? null : String(connection.templateId) };
}
export function sameBinding(a, b) { return !!a && !!b && typeof a.provider === 'string' && a.provider === b.provider && (a.variant ?? null) === (b.variant ?? null) && (a.templateId ?? null) === (b.templateId ?? null); }
// A stored setting read tolerantly: anything malformed is "off" (never on, never a crash); a numeric revision is kept so the next
// save is compared against it.
export function storedBankSchedule(value) {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  const revision = Number.isSafeInteger(v?.revision) && v.revision > 0 ? v.revision : 0, hourOk = Number.isInteger(v?.hour) && v.hour >= 0 && v.hour <= 23;
  const enabled = !!v && v.enabled === true && hourOk && revision > 0 && !!v.binding && typeof v.binding.provider === 'string';
  return { enabled, hour: hourOk ? v.hour : BANK_SCHEDULE_DEFAULT_HOUR, revision, binding: enabled ? v.binding : null, savedAt: v?.savedAt ?? null };
}
// GUARD — what a schedule may run: a retrieving login variant (BANK_VARIANT_COLLECTION: 楽天銀行/PayPay銀行 標準) with a mapped
// template and a saved period valid today. Every other connection (observe stage, a template-free first capture, no period) keeps
// its manual button exactly as before; null = supported.
export function bankScheduleSupport(connection, today) {
  if (!connection?.provider) return 'no-connection';
  if (bankCollectionMode(connection.provider, connection.variant ?? null) !== 'retrieve') return 'observe-only';
  if (!connection.templateId) return 'unmapped';
  if (!connection.coverage) return 'no-coverage';
  try { bankCoverageInput(connection.coverage, today); } catch { return 'no-coverage'; }
  // Plan omf-ikeda-collector-20261025: a variant that chooses the account on the bank's screen needs its exact identity; a saved period
  // the bank no longer offers at all (a closed period before its window) can never run. Other providers are unaffected.
  if (bankIdentityRequired(connection.provider, connection.variant ?? null) && !connection.accountIdentity) return 'no-identity';
  const window = bankCoverageWindow(connection.provider, connection.variant ?? null, connection.coverage, today);
  if (window && !window.effective) return 'bank-window';
  return null;
}
const dayBefore = day => new Date(day0(day) - DAY_MS).toISOString().slice(0, 10);
/**
 * Plan omf-ikeda-collector-20261025 (pure): the parts of a requested period the bank no longer offers (before `availableFrom`) that no
 * `covered` period (the effective periods of retrievals whose capture was imported) holds — history the PC can no longer fetch. OMF's
 * imported rows and originals stay; a gap only says that automatic retrieval never confirmed those days (an owner CSV may still hold
 * them). Requested {from, to} are concrete days; the result is ordered, merged and empty when nothing is missing.
 */
export function bankArchiveGaps({ requested, covered = [], availableFrom }) {
  const day = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(day0(v)) && new Date(day0(v)).toISOString().slice(0, 10) === v;
  if (!requested || !day(requested.from) || !day(requested.to) || !day(availableFrom)) return [];
  const end = requested.to < availableFrom ? requested.to : dayBefore(availableFrom);
  if (requested.from > end) return [];
  const spans = (Array.isArray(covered) ? covered : []).filter(c => c && day(c.from) && day(c.to) && c.from <= c.to).sort((a, b) => a.from.localeCompare(b.from));
  const gaps = []; let cursor = requested.from;
  for (const c of spans) {
    if (c.to < cursor) continue;
    if (c.from > end) break;
    if (c.from > cursor) gaps.push({ from: cursor, to: dayBefore(c.from) < end ? dayBefore(c.from) : end });
    cursor = nextDay(c.to);
    if (cursor > end) return gaps;
  }
  if (cursor <= end) gaps.push({ from: cursor, to: end });
  return gaps;
}
// GUARD — a queued scheduled job is run only while its account's current setting still authorizes it: the schedule is on, the
// connection's provider/variant/template equal both the saved binding and the job's own binding, the job was queued under the saved
// setting's current revision (Phase C: not under an earlier hour, nor before the owner turned it off and on again), and no other
// retrieval of the account was requested earlier on the job's JST day (a manual 取得 that completed between the tick's read and its
// insert). claimBankJob asks this once, before the PC first receives the job; a job a PC already received is in flight and is never
// re-judged. `earlier` is that other retrieval or null. Returns null (run it) or the reason it is closed instead.
export function scheduledRunCurrent({ job, account, earlier = null }) {
  const s = storedBankSchedule(account?.schedule);
  if (!account || !s.enabled) return 'schedule-off';
  const current = bankScheduleBinding(account.connection);
  if (!sameBinding(s.binding, current) || !sameBinding(job?.schedule?.binding, current)) return 'connection-changed';
  if (job?.schedule?.revision !== s.revision) return 'setting-changed';
  if (earlier) return 'already-requested-today';
  return null;
}
const ACTIVE = ['queued', 'running', 'verification_required'];
const time = v => v ? new Date(v).getTime() : NaN;
const jobOf = j => ({ jobId: j.jobId, state: j.state, kind: j.kind, trigger: j.trigger === 'schedule' ? 'schedule' : 'manual', requestedAt: j.requestedAt ?? null, completedAt: j.completedAt ?? null, scheduledDay: j.schedule?.day ?? null, lastMessage: j.lastMessage || '' });
/**
 * The schedule state of one account at `now`, in this order: off · unsupported(reason) · reconfirm(connection-changed) · attention
 * (verification_required on a live lease) · running · interrupted (running/verification whose lease expired: still claimable, the PC
 * resumes the SAME job — the one recovery lane; nothing new is queued) · queued (any queued job; a scheduled job of an earlier day does
 * not count once today's run is due — the tick replaces it, so missed days coalesce into one run) · waiting-pc (no unrevoked PC allowed
 * this account) · done-today (a retrieval was already requested today, manual or scheduled, whatever its outcome: one automatic run per
 * day) · due (the hour has passed: the tick queues) · waiting (before the hour). `lastFailure` is the latest job when it failed (shown
 * in every state; a later job replaces it). `jobs` must hold every active job of the account, its latest job and its latest retrieval
 * requested today; superseded jobs are ignored.
 */
export function bankScheduleState({ schedule, connection, templateExists = true, collectorIds = [], jobs = [], now }) {
  const s = storedBankSchedule(schedule), day = jstDay(now), at = now.getTime(), due = s.hour <= jstHour(now);
  const live = jobs.filter(j => j && j.state !== 'superseded'), sorted = [...live].sort((a, b) => time(b.requestedAt) - time(a.requestedAt));
  const lastFailure = sorted[0]?.state === 'failed' ? jobOf(sorted[0]) : null;
  const out = (state, extra = {}) => ({ state, reason: null, day, hour: s.hour, nextAt: null, job: null, lastFailure, ...extra });
  if (!s.enabled) return out('off');
  const support = bankScheduleSupport(connection, day) ?? (templateExists ? null : 'template-missing');
  if (support) return out('unsupported', { reason: support });
  if (!sameBinding(s.binding, bankScheduleBinding(connection))) return out('reconfirm', { reason: 'connection-changed' });
  const stale = j => j.state === 'queued' && typeof j.schedule?.day === 'string' && j.schedule.day < day && due;
  const active = live.filter(j => ACTIVE.includes(j.state) && !stale(j)), leased = j => time(j.leaseUntil) > at;
  let j = active.find(x => x.state === 'verification_required' && leased(x));
  if (j) return out('attention', { job: jobOf(j) });
  if ((j = active.find(x => x.state === 'running' && leased(x)))) return out('running', { job: jobOf(j) });
  if ((j = active.find(x => x.state !== 'queued'))) return out('interrupted', { job: jobOf(j) });
  if ((j = active.find(x => x.state === 'queued'))) return out('queued', { job: jobOf(j) });
  if (!collectorIds.length) return out('waiting-pc');
  const start = jstDayStart(now).getTime(), today = sorted.find(x => x.kind === 'retrieve' && time(x.requestedAt) >= start);
  if (today) return out('done-today', { nextAt: jstInstant(nextDay(day), s.hour).toISOString(), job: jobOf(today) });
  if (due) return out('due', { nextAt: now.toISOString() });
  return out('waiting', { nextAt: jstInstant(day, s.hour).toISOString() });
}
