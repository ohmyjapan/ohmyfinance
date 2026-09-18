import test from 'node:test';
import assert from 'node:assert/strict';
import {newWorkflowStep, applyWorkflowObservation, reviewWorkflowStep, workflowDay, nextWorkflowMidnight, workflowSummary} from '../shared/finance-workflow.mjs';
const hash = 'a'.repeat(64), night = n => new Date(Date.UTC(2026, 8, n, 15));
const missing = (stage, at) => ({reason: 'missing_' + stage, qualified: true, day: workflowDay(at)});

test('daily key and next midnight use JST across month/year boundaries', () => {
  assert.equal(workflowDay('2026-12-31T14:59:59Z'), '2026-12-31');
  assert.equal(workflowDay('2026-12-31T15:00:00Z'), '2027-01-01');
  assert.equal(nextWorkflowMidnight('2026-12-31T14:59:59Z'), '2026-12-31T15:00:00.000Z');
});

test('ten distinct qualified nights escalate; repeated deliveries and restarts do not consume extra attempts', () => {
  let step = newWorkflowStep('inventory', 'item:1');
  for (let n = 1; n <= 10; n++) {
    const now = night(n), result = applyWorkflowObservation(step, missing('inventory', now), {now});
    assert.equal(result.counted, true); step = JSON.parse(JSON.stringify(result.step));
    assert.equal(step.failedNights, n);
    assert.equal(applyWorkflowObservation(step, missing('inventory', now), {now}).counted, false);
    assert.equal(step.state, n === 10 ? 'manual_review' : 'waiting');
  }
  assert.equal(step.reason, 'exhausted');
  assert.equal(applyWorkflowObservation(step, missing('inventory', night(11)), {now: night(11)}).changed, false);
});

test('offline sources, waiting dependencies and shipment storage do not count as failed transactions', () => {
  let step = newWorkflowStep('shipment', 'inventory:one');
  for (const reason of ['waiting_dependency', 'source_incomplete', 'connection_required', 'waiting_shipment']) {
    step = applyWorkflowObservation(step, {reason}, {now: night(1)}).step;
    assert.equal(step.failedNights, 0);
  }
  assert.equal(workflowSummary({step}, night(32)).reminders.length, 1);
  assert.equal(step.state, 'waiting');
});

test('unqualified and stale source checks cannot count as no-match attempts', () => {
  const step = newWorkflowStep('purchase');
  assert.throws(() => applyWorkflowObservation(step, {reason: 'missing_purchase'}, {now: night(1)}));
  assert.throws(() => applyWorkflowObservation(step, missing('purchase', night(1)), {now: night(2)}));
  assert.throws(() => applyWorkflowObservation(step, missing('inventory', night(1)), {now: night(1)}));
});

test('contradictions go directly to review; new worker confidence does not clear the review', () => {
  const step = applyWorkflowObservation(newWorkflowStep('purchase'), {reason: 'ambiguous'}, {now: night(1)}).step;
  assert.equal(step.state, 'manual_review'); assert.equal(step.failedNights, 0);
  assert.equal(applyWorkflowObservation(step, {reason: 'complete', evidenceVerified: true, evidenceKey: hash}, {now: night(2)}).changed, false);
});

test('review retry retains lifetime history and prevents another failure count on the same day', () => {
  const now = night(1);
  const failed = applyWorkflowObservation(newWorkflowStep('purchase'), missing('purchase', now), {now, maxFailedNights: 1}).step;
  const retried = reviewWorkflowStep(failed, {action: 'retry', reason: 'Receipt source repaired'}, now);
  assert.equal(retried.failedNights, 0); assert.equal(retried.lifetimeFailedNights, 1);
  assert.equal(applyWorkflowObservation(retried, missing('purchase', now), {now}).counted, false);
  assert.equal(applyWorkflowObservation(retried, missing('purchase', night(2)), {now: night(2)}).step.lifetimeFailedNights, 2);
});

test('completion requires verified evidence; one completed unit does not finish a split purchase', () => {
  const done = newWorkflowStep('documents', 'shipment:one');
  assert.throws(() => applyWorkflowObservation(done, {reason: 'complete', confidence: 0.99}));
  const verified = applyWorkflowObservation(done, {reason: 'complete', evidenceVerified: true, evidenceKey: hash}, {now: night(1)}).step;
  const waiting = newWorkflowStep('inventory', 'item:two');
  assert.equal(workflowSummary({verified, waiting}).state, 'partial');
  assert.equal(workflowSummary({verified}).state, 'complete');
  assert.equal(applyWorkflowObservation(verified, {reason: 'integrity_failed'}, {now: night(2)}).step.state, 'manual_review');
});

test('snoozing suppresses routine attempts but never hides new integrity problems', () => {
  const step = reviewWorkflowStep(newWorkflowStep('inventory'), {action: 'snooze', until: '2026-10-01', reason: 'Awaiting warehouse intake'}, night(1));
  assert.equal(applyWorkflowObservation(step, missing('inventory', night(2)), {now: night(2)}).changed, false);
  assert.equal(applyWorkflowObservation(step, {reason: 'conflict'}, {now: night(2)}).step.state, 'manual_review');
});
