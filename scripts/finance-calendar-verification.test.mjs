// Calendar payment verification presentation (plan omf-calendar-evidence-20261029 §2, §4 leg 1): shared code only, no database,
// model or network. One definition decides what the grid, the day detail, the page, the store and both Navi projections show.
import test from 'node:test'
import assert from 'node:assert/strict'
import { verificationOf, awaitingVerification, calendarPresentation, verificationSummary, localDayKey, VERIFICATION_STATES } from '../shared/finance-calendar-verification.mjs'

const TODAY = '2026-10-29'
const row = (fields) => ({ id: 'a'.repeat(24), title: 'Synthetic bill', amount: 1, currency: 'JPY', dueDate: '2026-01-15T12:00:00.000Z', type: 'expense', status: 'pending', category: 'Invoice', recurring: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...fields })
const unconfirmed = { state: 'unconfirmed', reason: 'missing_bank_period', updatedAt: '2026-10-29T00:00:00.000Z', updatedBy: 'b'.repeat(24) }
const confirmed = { state: 'owner_confirmed', reason: 'Synthetic owner statement', updatedAt: '2026-10-29T01:00:00.000Z', updatedBy: 'b'.repeat(24) }

test('a legacy pending row past its due day is overdue, exactly as the calendar store flips it', () => {
  const p = calendarPresentation(row({}), TODAY)
  assert.deepEqual(p, { badge: 'overdue', confirmedOverdue: true, awaitingVerification: false }, 'verification:legacy-overdue')
  assert.equal(awaitingVerification(row({})), false)
  assert.equal(verificationOf(row({})), null)
  // Not yet due: a plan, never overdue.
  assert.deepEqual(calendarPresentation(row({ dueDate: '2026-12-01T12:00:00.000Z' }), TODAY), { badge: 'pending', confirmedOverdue: false, awaitingVerification: false }, 'verification:future-pending')
  // The day the bill is due is not past due.
  assert.equal(calendarPresentation(row({ dueDate: TODAY + 'T12:00:00.000Z' }), TODAY).badge, 'pending', 'verification:due-today')
  // A saved overdue status stays overdue.
  assert.equal(calendarPresentation(row({ status: 'overdue', dueDate: '2026-12-01T12:00:00.000Z' }), TODAY).badge, 'overdue')
})

test('an explicitly unconfirmed pending row past its due day shows 銀行照合待ち and is not a confirmed overdue bill', () => {
  const p = calendarPresentation(row({ paymentVerification: unconfirmed }), TODAY)
  assert.deepEqual(p, { badge: 'bankWait', confirmedOverdue: false, awaitingVerification: true }, 'verification:unconfirmed-bank-wait')
  assert.equal(awaitingVerification(row({ paymentVerification: unconfirmed })), true)
  // A saved overdue status with an unconfirmed record is awaiting too (the state, not the lifecycle status, decides).
  assert.equal(calendarPresentation(row({ status: 'overdue', paymentVerification: unconfirmed }), TODAY).badge, 'bankWait')
  // Date objects (server rows) and ISO strings (client rows) agree.
  assert.equal(calendarPresentation(row({ dueDate: new Date('2026-01-15T12:00:00.000Z') }), TODAY).badge, 'overdue', 'verification:date-object')
})

test('a paid row keeps its paid badge even with a stale unconfirmed record; cancelled and completed likewise', () => {
  for (const status of ['paid', 'completed', 'cancelled']) {
    const p = calendarPresentation(row({ status, paymentVerification: unconfirmed }), TODAY)
    assert.deepEqual(p, { badge: status, confirmedOverdue: false, awaitingVerification: false }, 'verification:paid-badge ' + status)
    assert.equal(awaitingVerification(row({ status, paymentVerification: unconfirmed })), false)
  }
})

test('an owner-confirmed row is not awaiting: past due it is overdue again, future it is a plan', () => {
  assert.equal(awaitingVerification(row({ paymentVerification: confirmed })), false, 'verification:owner-confirmed-not-awaiting')
  assert.deepEqual(calendarPresentation(row({ paymentVerification: confirmed }), TODAY), { badge: 'overdue', confirmedOverdue: true, awaitingVerification: false })
  assert.equal(calendarPresentation(row({ paymentVerification: confirmed, dueDate: '2026-12-01T12:00:00.000Z' }), TODAY).badge, 'pending')
})

test('only the two typed states count; anything else (a legacy marker, a widened state) is no verification record', () => {
  assert.deepEqual([...VERIFICATION_STATES], ['unconfirmed', 'owner_confirmed'])
  for (const bad of [{ state: 'bank_matched' }, { state: 'unverified' }, { state: 'conflict' }, {}, null, 'unconfirmed', 42]) {
    assert.equal(verificationOf(row({ paymentVerification: bad })), null, 'verification:typed-only ' + JSON.stringify(bad))
    assert.equal(awaitingVerification(row({ paymentVerification: bad })), false)
  }
  // The legacy Navi marker alone (naviOperation.paymentVerification.state 'unverified') is not the typed field: the row keeps today's flip.
  const legacy = row({ naviOperation: { paymentVerification: { state: 'unverified' }, invoiceSourceSha256: 'f'.repeat(64) } })
  assert.deepEqual(calendarPresentation(legacy, TODAY), { badge: 'overdue', confirmedOverdue: true, awaitingVerification: false }, 'verification:legacy-marker-not-typed')
})

test('the summary carries state, reason and updatedAt and never the actor id', () => {
  assert.deepEqual(verificationSummary(confirmed), { state: 'owner_confirmed', reason: 'Synthetic owner statement', updatedAt: '2026-10-29T01:00:00.000Z' }, 'verification:summary')
  assert.deepEqual(verificationSummary({ ...unconfirmed, updatedAt: new Date('2026-10-29T00:00:00.000Z') }), { state: 'unconfirmed', reason: 'missing_bank_period', updatedAt: '2026-10-29T00:00:00.000Z' })
  assert.equal(verificationSummary(null), null)
  assert.equal(verificationSummary({ state: 'bank_matched' }), null)
  assert.ok(!JSON.stringify(verificationSummary(confirmed)).includes('b'.repeat(24)), 'verification:summary-no-actor')
})

test('the default today is the local calendar day, the same key the store compares due days with', () => {
  const d = new Date(2026, 9, 29, 23, 30)
  assert.equal(localDayKey(d), '2026-10-29')
  assert.match(localDayKey(), /^\d{4}-\d{2}-\d{2}$/)
})
