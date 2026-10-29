// Calendar payment verification presentation (plan omf-calendar-evidence-20261029 §2): one definition for the grid, the day detail,
// the page, the store and both Navi projections. A verification record is the owner's explicit statement about a saved payment's
// bank settlement ('unconfirmed' = 銀行照合待ち, 'owner_confirmed'); it never changes the lifecycle status and is never a bank match.
// No Node imports: the page bundle loads it too.
export const VERIFICATION_STATES = Object.freeze(['unconfirmed', 'owner_confirmed'])

// The typed record, or null for a row without one (a legacy Navi marker, a widened or unknown state is no record).
export function verificationOf(payment) {
  const v = payment && typeof payment === 'object' ? payment.paymentVerification : null
  if (!v || typeof v !== 'object' || !VERIFICATION_STATES.includes(v.state)) return null
  return v
}

// An explicitly unknown payment: the owner recorded that its settlement is unconfirmed AND the row is still a plan (pending or a saved
// overdue). A paid, completed or cancelled row keeps its own badge even with a stale unconfirmed record.
export function awaitingVerification(payment) {
  const v = verificationOf(payment)
  return !!v && v.state === 'unconfirmed' && (payment.status === 'pending' || payment.status === 'overdue')
}

const dayKey = value => typeof value === 'string' ? value.slice(0, 10) : value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : ''
const pad = n => String(n).padStart(2, '0')
// Today as the local calendar day key, the same key the calendar store compares due days with.
export function localDayKey(date = new Date()) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` }
const iso = value => { if (!value) return null; const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toISOString() : null }

// What a calendar reader shows for a saved row today: badge 'bankWait' for an awaiting row (neutral, not a confirmed overdue bill);
// otherwise the lifecycle status with the store's past-due flip (a pending row past its due day is overdue, exactly as
// stores/calendar.ts flips it). confirmedOverdue says whether the row counts as an actual overdue bill.
export function calendarPresentation(payment, todayKey = localDayKey()) {
  const status = payment && typeof payment === 'object' ? payment.status : undefined
  if (awaitingVerification(payment)) return { badge: 'bankWait', confirmedOverdue: false, awaitingVerification: true }
  const pastDue = status === 'pending' && dayKey(payment.dueDate) !== '' && dayKey(payment.dueDate) < todayKey
  const badge = status === 'overdue' || pastDue ? 'overdue' : status
  return { badge, confirmedOverdue: badge === 'overdue', awaitingVerification: false }
}

// The record for a projection: state, reason and when it was stated; never the actor id.
export function verificationSummary(v) {
  const r = verificationOf({ paymentVerification: v })
  return r ? { state: r.state, reason: typeof r.reason === 'string' ? r.reason : '', updatedAt: iso(r.updatedAt) } : null
}
