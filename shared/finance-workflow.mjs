// Durable workflow policy. Successful evidence checks come from the server;
// a worker's confidence score is never an evidence-completion signal.
export const WORKFLOW_VERSION = 1;
export const WORKFLOW_STAGES = ['purchase', 'inventory', 'shipment', 'documents'];
export const WORKFLOW_DEFAULTS = Object.freeze({ maxFailedNights: 10, shipmentReminderDays: 30 });
export const WORKFLOW_REASONS = Object.freeze({
  pending: '未処理',
  missing_purchase: '購入記録の照合待ち',
  missing_inventory: '在庫の照合待ち',
  missing_documents: '出荷書類の取得待ち',
  waiting_shipment: '出荷記録の照合待ち',
  waiting_dependency: '前の工程の資料待ち',
  connection_required: '接続の確認が必要',
  source_incomplete: '取得した資料の範囲を確認してください',
  source_required: '購入元の接続・資料が必要',
  ambiguous: '複数の候補を確認してください',
  conflict: '金額・数量・接続の矛盾を確認してください',
  evidence_changed: '根拠資料が変更されています',
  integrity_failed: '保存資料の整合性を確認してください',
  transient_error: '取得時に一時的なエラーが発生しました',
  exhausted: '10回の夜間照合で解決しませんでした',
  complete: '資料の接続を確認済み',
  not_applicable: '対象外として確認済み'
});

const waiting = new Set(['waiting_dependency', 'connection_required', 'source_incomplete']);
const review = new Set(['source_required', 'ambiguous', 'conflict', 'evidence_changed', 'integrity_failed']);
const failure = new Set(['missing_purchase', 'missing_inventory', 'missing_documents', 'transient_error']);
const validDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

export function workflowDay(value = new Date()) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw Error('Invalid workflow time');
  return new Date(time + 9 * 3600000).toISOString().slice(0, 10);
}

export function nextWorkflowMidnight(value = new Date()) {
  const day = workflowDay(value);
  return new Date(Date.parse(day + 'T00:00:00+09:00') + 86400000).toISOString();
}

export function newWorkflowStep(stage, unit = 'purchase') {
  if (!WORKFLOW_STAGES.includes(stage) || typeof unit !== 'string' || !unit || unit.length > 180) throw Error('Invalid workflow step');
  return { stage, unit, state: 'pending', reason: 'pending', cycle: 1, failedNights: 0, lifetimeFailedNights: 0, lastFailedDay: null, firstWaitingAt: null, lastCheckedAt: null, completedAt: null, snoozedUntil: null };
}

// Count at most once per JST date, including after a reviewed retry cycle. A
// refreshed, complete source is required to claim that expected data is absent.
export function applyWorkflowObservation(previous, observation, { now = new Date(), maxFailedNights = WORKFLOW_DEFAULTS.maxFailedNights } = {}) {
  if (!previous || !WORKFLOW_STAGES.includes(previous.stage) || !Number.isSafeInteger(previous.failedNights) || previous.failedNights < 0 || !Number.isSafeInteger(previous.lifetimeFailedNights) || previous.lifetimeFailedNights < previous.failedNights) throw Error('Invalid workflow state');
  if (!Number.isSafeInteger(maxFailedNights) || maxFailedNights < 1 || maxFailedNights > 100) throw Error('Invalid workflow attempt limit');
  const at = new Date(now).toISOString(), day = workflowDay(now), reason = observation?.reason;
  if (!Object.hasOwn(WORKFLOW_REASONS, reason) || reason === 'exhausted' || reason === 'pending') throw Error('Invalid workflow observation');
  if (previous.state === 'manual_review' && !observation.reviewResolved) return { step: { ...previous }, counted: false, changed: false };
  if (previous.snoozedUntil && previous.snoozedUntil > day && !['complete', 'integrity_failed', 'conflict', 'evidence_changed'].includes(reason)) return { step: { ...previous }, counted: false, changed: false };
  const step = { ...previous, reason, lastCheckedAt: at }, before = JSON.stringify(previous);
  let counted = false;
  if (reason === 'complete' || reason === 'not_applicable') {
    if (observation.evidenceVerified !== true || typeof observation.evidenceKey !== 'string' || !/^[a-f0-9]{64}$/.test(observation.evidenceKey)) throw Error('Verified evidence required for workflow completion');
    step.state = reason === 'complete' ? 'complete' : 'not_applicable';
    step.completedAt ||= at;
    step.evidenceKey = observation.evidenceKey;
    step.snoozedUntil = null;
  } else if (review.has(reason)) {
    step.state = 'manual_review'; step.completedAt = null;
  } else if (reason === 'waiting_shipment') {
    if (previous.stage !== 'shipment') throw Error('Shipment waiting belongs to the shipment stage');
    step.state = 'waiting'; step.firstWaitingAt ||= at; step.completedAt = null;
  } else if (waiting.has(reason)) {
    step.state = reason === 'connection_required' ? 'connection_required' : 'waiting'; step.firstWaitingAt ||= at; step.completedAt = null;
  } else if (failure.has(reason)) {
    const expectedStage = { missing_purchase: 'purchase', missing_inventory: 'inventory', missing_documents: 'documents' }[reason];
    if (expectedStage && previous.stage !== expectedStage) throw Error('Unexpected missing-data stage');
    if (observation.qualified !== true || observation.day !== day) throw Error('A qualified current-day check is required');
    step.state = 'waiting'; step.firstWaitingAt ||= at; step.completedAt = null;
    if (!previous.lastFailedDay || previous.lastFailedDay < day) {
      step.failedNights++; step.lifetimeFailedNights++; step.lastFailedDay = day; counted = true;
    }
    if (step.failedNights >= maxFailedNights) { step.state = 'manual_review'; step.reason = 'exhausted'; step.failureReason = reason; }
  }
  return { step, counted, changed: JSON.stringify(step) !== before };
}

export function reviewWorkflowStep(previous, { action, until, reason }, now = new Date()) {
  if (!previous || !WORKFLOW_STAGES.includes(previous.stage) || !['retry', 'snooze'].includes(action) || typeof reason !== 'string' || !reason.trim() || reason.length > 1000) throw Error('A review action and reason are required');
  if (['complete', 'not_applicable'].includes(previous.state)) throw Error('Completed evidence does not need a retry');
  if (action === 'snooze') {
    if (!validDate(until) || until <= workflowDay(now)) throw Error('Choose a future reminder date');
    return { ...previous, snoozedUntil: until, reviewReason: reason.trim() };
  }
  return { ...previous, state: 'pending', reason: 'pending', cycle: previous.cycle + 1, failedNights: 0, snoozedUntil: null, completedAt: null, reviewReason: reason.trim() };
}

export function workflowSummary(steps, now = new Date()) {
  const values = Object.values(steps || {});
  const state = !values.length ? 'pending' : values.some(s => s.state === 'manual_review') ? 'manual_review' : values.some(s => s.state === 'connection_required') ? 'connection_required' : values.every(s => s.state === 'not_applicable') ? 'not_applicable' : values.every(s => ['complete', 'not_applicable'].includes(s.state)) ? 'complete' : values.some(s => s.state === 'complete') ? 'partial' : 'waiting';
  const reminders = values.filter(s => s.reason === 'waiting_shipment' && s.firstWaitingAt && Date.parse(now) - Date.parse(s.firstWaitingAt) >= WORKFLOW_DEFAULTS.shipmentReminderDays * 86400000 && (!s.snoozedUntil || s.snoozedUntil <= workflowDay(now))).map(s => ({ stage: s.stage, unit: s.unit }));
  return { state, reminders, total: values.length, completed: values.filter(s => ['complete', 'not_applicable'].includes(s.state)).length, manualReview: values.filter(s => s.state === 'manual_review').length };
}
