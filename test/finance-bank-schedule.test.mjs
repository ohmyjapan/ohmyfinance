// Daily web-bank schedule (plan omf-workflow-daily-20261025 Phase B): the pure JST rules, the setting input, the support guard and the
// derived state that both the tick and the screen read (shared/finance-bank-schedule.mjs). Fictional accounts and jobs only; the
// database/route/Chrome legs are in scripts/zoomer-fixtures/omf-bank-schedule.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { jstDay, jstHour, jstDayStart, jstInstant, nextDay, bankScheduleInput, storedBankSchedule, bankScheduleBinding, sameBinding, bankScheduleSupport, bankScheduleState, scheduledRunCurrent } from '../shared/finance-bank-schedule.mjs';

const at = iso => new Date(iso);
const RAKUTEN = { provider: 'rakuten', variant: 'standard', templateId: 'a1a1a1a1a1a1a1a1a1a1a1a1', coverage: { from: '2025-11-01', to: null } };
const PAYPAY = { provider: 'paypay', variant: 'standard', templateId: 'b2b2b2b2b2b2b2b2b2b2b2b2', coverage: { from: '2025-11-01', to: null } };
const PC = 'c3c3c3c3c3c3c3c3c3c3c3c3', PC2 = 'd4d4d4d4d4d4d4d4d4d4d4d4';
const saved = (connection, extra = {}) => ({ enabled: true, hour: 9, revision: 1, savedAt: at('2026-10-20T00:00:00Z'), binding: bankScheduleBinding(connection), ...extra });
const state = (o = {}) => bankScheduleState({ schedule: saved(RAKUTEN), connection: RAKUTEN, collectorIds: [PC], jobs: [], now: at('2026-10-25T01:00:00Z'), ...o });
const job = (o = {}) => ({ jobId: 'j-' + Math.random().toString(36).slice(2), kind: 'retrieve', state: 'complete', requestedAt: at('2026-10-24T00:30:00Z'), completedAt: at('2026-10-24T00:35:00Z'), ...o });

test('JST day, hour and day start across UTC/JST midnight', () => {
  assert.equal(jstDay(at('2026-10-24T14:59:59.999Z')), '2026-10-24'); assert.equal(jstHour(at('2026-10-24T14:59:59.999Z')), 23);
  assert.equal(jstDay(at('2026-10-24T15:00:00Z')), '2026-10-25'); assert.equal(jstHour(at('2026-10-24T15:00:00Z')), 0);
  assert.equal(jstDay(at('2026-10-25T00:00:00Z')), '2026-10-25'); assert.equal(jstHour(at('2026-10-25T00:00:00Z')), 9);
  assert.equal(jstDayStart(at('2026-10-25T14:59:00Z')).toISOString(), '2026-10-24T15:00:00.000Z');
  assert.equal(jstInstant('2026-10-25', 9).toISOString(), '2026-10-25T00:00:00.000Z');
  assert.equal(jstInstant('2026-10-25', 0).toISOString(), '2026-10-24T15:00:00.000Z');
  assert.equal(nextDay('2026-12-31'), '2027-01-01'); assert.equal(nextDay('2028-02-28'), '2028-02-29');
});

test('setting input: booleans, integer JST hour 0-23, revision; malformed refused with a reason', () => {
  assert.deepEqual(bankScheduleInput({ enabled: true, hour: 0, revision: 0 }), { enabled: true, hour: 0, revision: 0 });
  assert.deepEqual(bankScheduleInput({ enabled: false, hour: 23, revision: 4 }), { enabled: false, hour: 23, revision: 4 });
  for (const bad of [null, [], 'on', { enabled: 'true', hour: 9, revision: 0 }, { enabled: true, hour: 24, revision: 0 }, { enabled: true, hour: -1, revision: 0 }, { enabled: true, hour: 9.5, revision: 0 }, { enabled: true, hour: '9', revision: 0 }, { enabled: true, hour: 9 }, { enabled: true, hour: 9, revision: -1 }])
    assert.throws(() => bankScheduleInput(bad), /自動取得/, JSON.stringify(bad));
});

test('stored setting is read tolerantly: malformed is off, never on', () => {
  assert.equal(storedBankSchedule(null).enabled, false); assert.equal(storedBankSchedule(null).revision, 0);
  assert.equal(storedBankSchedule('garbage').enabled, false);
  assert.equal(storedBankSchedule({ enabled: true, hour: 9, revision: 2 }).enabled, false, 'no binding');
  assert.equal(storedBankSchedule({ ...saved(RAKUTEN), hour: 30 }).enabled, false);
  assert.equal(storedBankSchedule({ ...saved(RAKUTEN), revision: 'x' }).revision, 0);
  assert.equal(storedBankSchedule(saved(RAKUTEN)).enabled, true);
  assert.equal(state({ schedule: { enabled: 'yes', hour: 9 } }).state, 'off');
});

test('support guard: retrieving standard variants with a mapped template and a period only', () => {
  assert.equal(bankScheduleSupport(RAKUTEN, '2026-10-25'), null);
  assert.equal(bankScheduleSupport(PAYPAY, '2026-10-25'), null);
  assert.equal(bankScheduleSupport(null, '2026-10-25'), 'no-connection');
  assert.equal(bankScheduleSupport({ ...RAKUTEN, variant: 'plus' }, '2026-10-25'), 'observe-only');
  assert.equal(bankScheduleSupport({ ...PAYPAY, variant: 'baplus' }, '2026-10-25'), 'observe-only');
  assert.equal(bankScheduleSupport({ provider: 'resona', variant: 'direct', templateId: 'x', coverage: { from: '2026-01-01', to: null } }, '2026-10-25'), 'observe-only');
  assert.equal(bankScheduleSupport({ ...PAYPAY, templateId: null }, '2026-10-25'), 'unmapped', 'template-free PayPay first capture stays manual');
  assert.equal(bankScheduleSupport({ ...RAKUTEN, coverage: null }, '2026-10-25'), 'no-coverage');
  assert.equal(bankScheduleSupport({ ...RAKUTEN, coverage: { from: '2026-10-26', to: null } }, '2026-10-25'), 'no-coverage');
  assert.equal(bankScheduleSupport({ ...RAKUTEN, coverage: { from: '2026-07-01', to: '2026-07-31' } }, '2026-10-25'), null, 'a closed period is kept, not refused');
});

test('due/waiting around the saved hour and JST midnight', () => {
  assert.equal(state({ now: at('2026-10-24T23:59:59Z') }).state, 'waiting');
  assert.equal(state({ now: at('2026-10-24T23:59:59Z') }).nextAt, '2026-10-25T00:00:00.000Z');
  assert.equal(state({ now: at('2026-10-25T00:00:00Z') }).state, 'due');
  const zero = o => state({ schedule: saved(RAKUTEN, { hour: 0 }), ...o });
  assert.equal(zero({ now: at('2026-10-24T14:59:59Z'), jobs: [job({ requestedAt: at('2026-10-23T15:00:01Z') })] }).state, 'done-today', '23:59 JST still the 24th');
  assert.equal(zero({ now: at('2026-10-24T15:00:00Z'), jobs: [job({ requestedAt: at('2026-10-23T15:00:01Z') })] }).state, 'due', '00:00 JST is a new day');
  const done = state({ jobs: [job({ requestedAt: at('2026-10-25T00:10:00Z'), completedAt: at('2026-10-25T00:20:00Z') })] });
  assert.equal(done.state, 'done-today'); assert.equal(done.nextAt, '2026-10-26T00:00:00.000Z');
});

test('one run per JST day: a manual retrieval requested today counts; superseded jobs never count', () => {
  assert.equal(state({ jobs: [job({ requestedAt: at('2026-10-24T22:00:00Z'), completedAt: at('2026-10-24T22:05:00Z') })] }).state, 'done-today', 'manual 07:00 JST before the 09:00 hour');
  assert.equal(state({ jobs: [job({ requestedAt: at('2026-10-24T14:00:00Z') })] }).state, 'due', '23:00 JST yesterday is another day');
  assert.equal(state({ jobs: [job({ state: 'superseded', requestedAt: at('2026-10-25T00:00:00Z'), schedule: { supersededDay: '2026-10-25' } })] }).state, 'due');
  assert.equal(state({ jobs: [job({ kind: 'observe', requestedAt: at('2026-10-25T00:00:00Z') })] }).state, 'due', 'an observe job is no retrieval');
});

test('active and claimable jobs block; an expired lease is interrupted (the PC resumes it), never a new run', () => {
  const now = at('2026-10-25T01:00:00Z'), live = at('2026-10-25T01:02:00Z'), expired = at('2026-10-25T00:58:00Z');
  assert.equal(state({ jobs: [job({ state: 'queued', requestedAt: at('2026-10-25T00:59:00Z'), completedAt: null, trigger: 'manual' })] }).state, 'queued');
  assert.equal(state({ jobs: [job({ state: 'running', leaseUntil: live })] }).state, 'running');
  assert.equal(state({ jobs: [job({ state: 'verification_required', leaseUntil: live })] }).state, 'attention');
  assert.equal(state({ jobs: [job({ state: 'running', leaseUntil: expired })] }).state, 'interrupted');
  assert.equal(state({ jobs: [job({ state: 'verification_required', leaseUntil: expired, open: false })] }).state, 'interrupted', 'a closed but claimable job still blocks');
  assert.equal(state({ now, jobs: [job({ state: 'queued', trigger: 'schedule', schedule: { day: '2026-10-23' }, requestedAt: at('2026-10-23T00:00:00Z') })] }).state, 'due', "an earlier day's unclaimed scheduled run is replaced when today's is due");
  assert.equal(state({ now: at('2026-10-24T23:00:00Z'), jobs: [job({ state: 'queued', trigger: 'schedule', schedule: { day: '2026-10-23' }, requestedAt: at('2026-10-23T00:00:00Z') })] }).state, 'queued', 'before the hour it still waits for the PC');
  assert.equal(state({ jobs: [job({ state: 'queued', trigger: 'manual', requestedAt: at('2026-10-23T00:00:00Z') })] }).state, 'queued', 'an old manual request is never replaced');
});

test('a failed run is shown, never held: the day still counts as run and the next day is due as usual', () => {
  const failed = job({ state: 'failed', requestedAt: at('2026-10-24T00:00:00Z'), completedAt: at('2026-10-24T00:06:00Z'), lastMessage: '楽天銀行にChromeでサインインしてください' });
  const next = state({ jobs: [failed] }); assert.equal(next.state, 'due'); assert.equal(next.lastFailure.jobId, failed.jobId);
  const sameDay = state({ jobs: [{ ...failed, requestedAt: at('2026-10-25T00:00:00Z'), completedAt: at('2026-10-25T00:06:00Z') }] });
  assert.deepEqual([sameDay.state, sameDay.job.state, !!sameDay.lastFailure], ['done-today', 'failed', true], 'one automatic run per day, also after a failure');
  assert.equal(state({ jobs: [failed, job({ requestedAt: at('2026-10-24T03:00:00Z'), completedAt: at('2026-10-24T03:05:00Z') })] }).lastFailure, null, 'a later success replaces the failure');
  assert.equal(state({ schedule: null, jobs: [failed] }).lastFailure.jobId, failed.jobId, 'shown even when off');
});

test('changed connection needs a re-save; PCs are the existing grant: a second PC or a removed one changes nothing, no PC waits', () => {
  assert.deepEqual([state({ connection: { ...RAKUTEN, templateId: 'e5e5e5e5e5e5e5e5e5e5e5e5' } }).state, state({ connection: { ...RAKUTEN, templateId: 'e5e5e5e5e5e5e5e5e5e5e5e5' } }).reason], ['reconfirm', 'connection-changed']);
  assert.equal(state({ schedule: saved(PAYPAY), connection: { ...RAKUTEN } }).reason, 'connection-changed');
  assert.equal(state({ connection: { ...RAKUTEN, variant: 'plus' } }).state, 'unsupported');
  assert.equal(state({ connection: { ...RAKUTEN, accountLabel: '普通 1111111', coverage: { from: '2026-01-01', to: '2026-03-31' } } }).state, 'due', 'label/period changes are frozen per job, not authority');
  assert.equal(state({ collectorIds: [PC, PC2] }).state, 'due', 'an owner-granted second PC does not stop the schedule');
  assert.equal(state({ collectorIds: [PC2] }).state, 'due', 'the old PC removed, a new one granted');
  assert.equal(state({ collectorIds: [] }).state, 'waiting-pc');
  assert.equal(state({ templateExists: false }).reason, 'template-missing');
  assert.equal(sameBinding(bankScheduleBinding(RAKUTEN), bankScheduleBinding({ ...RAKUTEN })), true);
  assert.equal(sameBinding(null, bankScheduleBinding(RAKUTEN)), false);
});

test('claim-time check of a scheduled job no PC received: off, changed connection or an earlier run that day closes it; otherwise it runs', () => {
  const account = { schedule: saved(RAKUTEN), connection: RAKUTEN }, scheduled = { trigger: 'schedule', schedule: { day: '2026-10-25', revision: 1, binding: bankScheduleBinding(RAKUTEN) } };
  assert.equal(scheduledRunCurrent({ job: scheduled, account }), null);
  assert.equal(scheduledRunCurrent({ job: scheduled, account: { ...account, schedule: { ...account.schedule, enabled: false } } }), 'schedule-off');
  assert.equal(scheduledRunCurrent({ job: scheduled, account: null }), 'schedule-off');
  assert.equal(scheduledRunCurrent({ job: scheduled, account: { ...account, schedule: { enabled: true, hour: 9 } } }), 'schedule-off', 'malformed stored setting');
  assert.equal(scheduledRunCurrent({ job: scheduled, account: { ...account, connection: { ...RAKUTEN, templateId: 'f6f6f6f6f6f6f6f6f6f6f6f6' } } }), 'connection-changed');
  assert.equal(scheduledRunCurrent({ job: { ...scheduled, schedule: { ...scheduled.schedule, binding: bankScheduleBinding(PAYPAY) } }, account }), 'connection-changed', 're-saved for another connection after this job was queued');
  assert.equal(scheduledRunCurrent({ job: scheduled, account, earlier: { _id: 'x' } }), 'already-requested-today');
  // Queued under an earlier saved setting (another hour, or turned off and on again): the current setting did not ask for this run.
  assert.equal(scheduledRunCurrent({ job: scheduled, account: { ...account, schedule: saved(RAKUTEN, { revision: 2, hour: 23 }) } }), 'setting-changed');
  assert.equal(scheduledRunCurrent({ job: scheduled, account: { ...account, schedule: saved(RAKUTEN, { revision: 3 }) } }), 'setting-changed', 'same hour, saved again');
  assert.equal(scheduledRunCurrent({ job: { ...scheduled, schedule: { ...scheduled.schedule, revision: 3 } }, account: { ...account, schedule: saved(RAKUTEN, { revision: 3 }) } }), null);
});
