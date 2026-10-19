// Finite, named owner actions for the legacy owner workspace (and the feature guide for both owner realms), each an adapter over the
// SAME native service the owner's page uses, limited to the worker's assigned card accounts BEFORE anything is read or derived. No
// generic API, URL, bank, credential, OTP, pairing or collector/signing action exists here. A write carries the journal operationId
// into the native record in the same atomic write (account job/schedule marker, workflow event, allocation request id or history
// entry), so a lost reply is reconciled from that record and never repeated blindly. A queued card sync is queued, not downloaded;
// a saved workflow review is a review, not completed inventory/export documents; a saved allocation does not move money or change a
// calendar, ledger or bank row.
import { FinancialAccount, FinanceCollector, FinanceImport } from '../models/Finance'
import { PaymentMatch } from '../models/FinancePaymentMatch'
import { fail, id, queueSync, saveAutoSync } from './financeService'
// The workflow service and model load on first use: they stay in the purchase-workflow route's own bundle, unchanged.
const workflowService = () => import('./financeWorkflowService')
const workflowModel = async () => (await import('../models/FinanceWorkflow')).FinanceWorkflow
import { saveAllocation, releaseAllocation } from './financePaymentMatchService'
import { naviRealmFeatures } from '../../shared/finance-navi-features.mjs'

const oid = { type: 'string', pattern: '^[a-f0-9]{24}$' }
const allocationIdArg = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' }
const schema = (properties: any, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) })
const define = (name: string, effect: 'read' | 'write' | 'queue', modes: string[], description: string, inputSchema: any, run: any) => ({ name, effect, modes, targeted: false, needsLine: false, description, inputSchema, run })
const assignedIds = (scope: any) => scope.agent.accountIds.map(String)
const isAssigned = (scope: any, accountId: any) => assignedIds(scope).includes(String(accountId))
async function assignedAccount(scope: any, accountId: string) {
  if (!isAssigned(scope, accountId)) fail(404, 'Account not found')
  const account: any = await FinancialAccount.findOne({ _id: id(accountId), ownerId: scope.ownerId, active: true }).lean()
  if (!account) fail(404, 'Account not found')
  return account
}
// The card statement must be the owner's and on an assigned account (rechecked now, not at claim).
async function assignedStatement(scope: any, importId: string) {
  const batch: any = await FinanceImport.findOne({ _id: id(importId), ownerId: scope.ownerId }).select('accountId').lean()
  if (!batch || !isAssigned(scope, batch.accountId)) fail(404, '明細が見つかりません。')
  return batch
}
const money = (value: any, label: string) => { if (typeof value !== 'number' || !Number.isFinite(value)) fail(400, label + 'を数値で指定してください。'); return value }
const integer = (value: any, label: string) => { if (!Number.isSafeInteger(value) || value < 0) fail(400, label + 'を確認してください。'); return value }
const cardScope = (scope: any) => ({ cardAccountIds: assignedIds(scope) })
const stepView = (s: any) => ({ stage: s.stage, unit: s.unit, state: s.state, reason: s.reason, cycle: s.cycle, failedNights: s.failedNights, snoozedUntil: s.snoozedUntil || null, reviewReason: typeof s.reviewReason === 'string' ? s.reviewReason.slice(0, 300) : null, completedAt: s.completedAt || null })
const workflowRow = (r: any) => ({ id: r.id, accountId: r.accountId, importId: r.importId, line: r.line, revision: r.revision, payment: { date: r.payment?.date, amount: r.payment?.amount, merchant: r.payment?.merchant, accountName: r.payment?.accountName, purpose: r.payment?.purpose }, purchaseLinked: !!r.purchaseId, summary: r.summary, steps: Object.fromEntries(Object.entries(r.steps || {}).map(([k, s]: any) => [k, stepView(s)])), events: (r.events || []).slice(-10).map((e: any) => ({ at: e.at, action: e.action, step: e.step || null, reason: typeof e.reason === 'string' ? e.reason.slice(0, 300) : null })) })
const allocationOf = (view: any, requestId: string) => (view?.allocations || []).find((a: any) => a.requestId === requestId)

export const ownerActionNames = ['list_navi_features', 'get_card_sync_status', 'queue_card_sync', 'set_card_auto_sync', 'get_workflow_status', 'review_workflow_step', 'confirm_card_allocation', 'release_card_allocation', 'reconfirm_card_allocation']
export const ownerActions: any[] = [
  define('list_navi_features', 'read', ['workspace', 'purchase'], 'Read the OMF feature guide for THIS conversation: every page group with its local page and whether you can do it here with your tools (navi_tool, naming only tools this conversation has), the user does it on that page (page_handoff), or it is unsupported and why. Use it to explain where and how to do something; in the general conversation a reply may link one listed page.', schema({ query: { type: 'string', maxLength: 100 } }),
    async (scope: any, args: any) => ({ realm: 'owner', features: naviRealmFeatures('owner', scope.toolNames || [], args.query).map((f: any) => ({ id: f.id, group: f.group, label: f.label, labelKo: f.labelKo, route: f.route, disposition: f.disposition, reason: f.reason, tools: f.tools || [], sensitive: f.sensitive === true })), dispositions: { navi_tool: 'you can do it in this conversation with the named tools', page_handoff: 'the page provides it; explain it and link the page', unsupported: 'never linked or acted on here' } })),
  define('get_card_sync_status', 'read', ['workspace'], 'Read the statement collection status of the card accounts assigned to this conversation: whether a collector is paired, the current job state (idle, queued, running, verification_required, complete, failed), when it was requested, attempted and last succeeded, and the Aplus automatic schedule. No credentials, OTP addresses, collector tokens or raw errors are returned. queued/running is not a downloaded statement.', schema({}),
    async (scope: any) => {
      const accounts: any[] = await FinancialAccount.find({ ownerId: scope.ownerId, _id: { $in: scope.agent.accountIds }, active: true }).select('name provider primaryCard jobState jobRequestedAt lastAttemptAt lastSuccessAt autoSync').sort({ name: 1 }).lean()
      const paired = new Set((await FinanceCollector.find({ ownerId: scope.ownerId, revokedAt: null, accountIds: { $in: accounts.map(a => a._id) } }).select('accountIds').lean()).flatMap((d: any) => d.accountIds.map(String)))
      return { scope: 'assigned_card_accounts', accounts: accounts.map(a => ({ id: String(a._id), name: a.name, provider: a.provider || 'amex', primaryCard: a.primaryCard || '', collectorPaired: paired.has(String(a._id)), jobState: a.jobState || 'idle', jobRequestedAt: a.jobRequestedAt || null, lastAttemptAt: a.lastAttemptAt || null, lastSuccessAt: a.lastSuccessAt || null, autoSync: a.provider === 'aplus' ? { enabled: !!a.autoSync?.enabled, hour: a.autoSync?.hour ?? 9, lastQueuedDay: a.autoSync?.lastQueuedDay || null } : null })), meaning: 'A queued or running job is not a downloaded statement; a statement exists only when its import appears. Pairing, credentials and verification codes are handled by the owner on the connections page.' }
    }),
  define('queue_card_sync', 'queue', ['workspace'], 'On an explicit instruction in the CURRENT message: queue a statement download for one assigned card account through the native collector queue (the same as the page button). Refused without a paired collector or while a job is queued or running. The receipt says queued; it is never a completed download.', schema({ accountId: oid }, ['accountId']),
    async (scope: any, args: any, _target: any, operation: any) => {
      const account = await assignedAccount(scope, args.accountId)
      const queued: any = await queueSync(scope.ownerId, account, operation)
      return { outcome: 'queued', receipt: { requestedFields: [], acceptedRevision: null, nativeResourceIds: { accountId: String(account._id), jobId: queued.jobId } }, result: { accountId: String(account._id), jobState: 'queued', jobId: queued.jobId, downloaded: false, meaning: 'Queued for the paired collector; the statement is not downloaded yet.' } }
    }),
  define('set_card_auto_sync', 'write', ['workspace'], 'On an explicit instruction in the CURRENT message: turn the daily automatic statement collection of one assigned Aplus account on or off and set the JST hour (0-23) after which it runs. Amex accounts have no automatic collection. Returns the saved setting.', schema({ accountId: oid, enabled: { type: 'boolean' }, hour: { type: 'integer', minimum: 0 } }, ['accountId', 'enabled', 'hour']),
    async (scope: any, args: any, _target: any, operation: any) => {
      const account = await assignedAccount(scope, args.accountId)
      const saved = await saveAutoSync(scope.ownerId, account, { enabled: args.enabled, hour: args.hour }, operation)
      return { receipt: { requestedFields: ['enabled', 'hour'], acceptedRevision: null, nativeResourceIds: { accountId: String(account._id) } }, result: { accountId: String(account._id), autoSync: saved.autoSync } }
    }),
  define('get_workflow_status', 'read', ['workspace'], 'Read the purchase/inventory/shipment/documents reconciliation status of purchases on the card accounts assigned to this conversation (rows filtered to those cards before any count). Optional statement/line or summary state. Global workflow settings, nightly runs and workers are not included. A step state is saved evidence; complete inventory or export documents are worker outcomes, never promised by a review.', schema({ importId: oid, line: { type: 'integer', minimum: 2 }, state: { type: 'string', enum: ['manual_review', 'connection_required', 'waiting', 'partial', 'complete', 'not_applicable', 'pending'] }, limit: { type: 'integer', minimum: 1 } }),
    async (scope: any, args: any) => {
      const view: any = await (await workflowService()).workflowView(scope.ownerId, { ...(args.importId ? { importId: args.importId } : {}), ...(args.line !== undefined ? { line: args.line } : {}) }, { accountIds: assignedIds(scope) })
      const rows = view.rows.filter((r: any) => !args.state || r.summary?.state === args.state), limit = Math.min(args.limit || 50, 100)
      const counts = { total: rows.length, manualReview: rows.filter((r: any) => r.summary?.state === 'manual_review').length, connectionRequired: rows.filter((r: any) => r.summary?.state === 'connection_required').length, complete: rows.filter((r: any) => ['complete', 'not_applicable'].includes(r.summary?.state)).length }
      return { scope: view.scope, counts, rows: rows.slice(0, limit).map(workflowRow), truncated: rows.length > limit, accounts: view.accounts }
    }),
  define('review_workflow_step', 'write', ['workspace'], 'On an explicit instruction in the CURRENT message: put one non-complete step of an assigned-card workflow row back to retry, or snooze it until a future date (YYYY-MM-DD), with the user\'s reason, using the row\'s current revision from get_workflow_status. Only retry and snooze exist; accepting a purchase or creating documents is done on the purchase-workflow page.', schema({ workflowId: oid, expectedRevision: { type: 'integer', minimum: 0 }, step: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,80}$' }, action: { type: 'string', enum: ['retry', 'snooze'] }, until: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, reason: { type: 'string', minLength: 1, maxLength: 1000 } }, ['workflowId', 'expectedRevision', 'step', 'action', 'reason']),
    async (scope: any, args: any, _target: any, operation: any) => {
      const row: any = await (await workflowService()).reviewWorkflow(scope.ownerId, args.workflowId, { revision: args.expectedRevision, step: args.step, action: args.action, reason: args.reason, ...(args.until !== undefined ? { until: args.until } : {}) }, { readScope: { accountIds: assignedIds(scope) }, operation })
      return { receipt: { requestedFields: [args.step], acceptedRevision: row.revision, nativeResourceIds: { workflowId: row.id, step: args.step } }, result: { workflowId: row.id, revision: row.revision, step: stepView(row.steps[args.step]), summary: row.summary, meaning: 'The review is saved. Inventory, shipment and document steps complete only when their evidence is processed.' } }
    }),
  define('confirm_card_allocation', 'write', ['workspace'], 'On an explicit instruction in the CURRENT message: allocate an amount of one assigned-card charge (statement importId and line) to one owned intake record, using paymentRevision from get_card_payment_match and the record\'s current recordRevision. The native checks apply (same direction, never over the charge, current revisions). Bank rows, bank repayments and other cards are not available here. Saving an allocation moves no money and changes no ledger or calendar.', schema({ importId: oid, line: { type: 'integer', minimum: 2 }, recordId: oid, amount: { type: 'number' }, paymentRevision: { type: 'integer', minimum: 0 }, recordRevision: { type: 'integer', minimum: 0 }, recordAmount: { type: 'number' }, note: { type: 'string', maxLength: 2000 } }, ['importId', 'line', 'recordId', 'amount', 'paymentRevision', 'recordRevision']),
    async (scope: any, args: any, _target: any, operation: any) => {
      await assignedStatement(scope, args.importId)
      const requestId = 'navi_' + operation.operationId
      const view: any = await saveAllocation(scope.ownerId, 'card', args.importId, args.line, { confirm: true, requestId: 'navi_' + operation.operationId, paymentRevision: integer(args.paymentRevision, '明細の改訂'), recordRevision: integer(args.recordRevision, '受付の改訂'), amount: money(args.amount, '配分金額'), ...(args.recordAmount !== undefined ? { recordAmount: money(args.recordAmount, '受付通貨の金額') } : {}), ...(args.note !== undefined ? { note: args.note } : {}), target: { kind: 'intake', recordId: args.recordId } }, { readScope: cardScope(scope) })
      const allocation = allocationOf(view, requestId)
      if (!allocation) fail(409, '配分を確認できません。照合画面で状態を確認してください。')
      return { receipt: { requestedFields: ['amount'], acceptedRevision: null, nativeResourceIds: { importId: args.importId, line: args.line, recordId: args.recordId, allocationId: allocation.id } }, result: { allocationId: allocation.id, amount: allocation.amount, currency: allocation.currency, paymentState: view.payment?.state, remaining: view.payment?.remaining, scope: view.scope || null } }
    }),
  ...(['release', 'reconfirm'] as const).map(action => define(action + '_card_allocation', 'write', ['workspace'], action === 'release' ? 'On an explicit instruction in the CURRENT message: release one saved allocation of an assigned-card charge, using its allocationId and the current paymentRevision. The history keeps the earlier link.' : 'On an explicit instruction in the CURRENT message: re-confirm one linked allocation of an assigned-card charge against the intake record\'s current revision (after the record changed), using the current paymentRevision and recordRevision.',
    schema({ importId: oid, line: { type: 'integer', minimum: 2 }, allocationId: allocationIdArg, paymentRevision: { type: 'integer', minimum: 0 }, ...(action === 'reconfirm' ? { recordRevision: { type: 'integer', minimum: 0 } } : {}) }, ['importId', 'line', 'allocationId', 'paymentRevision', ...(action === 'reconfirm' ? ['recordRevision'] : [])]),
    async (scope: any, args: any, _target: any, operation: any) => {
      await assignedStatement(scope, args.importId)
      const view: any = await releaseAllocation(scope.ownerId, 'card', args.importId, args.line, args.allocationId, { confirm: true, action, paymentRevision: args.paymentRevision, ...(action === 'reconfirm' ? { recordRevision: args.recordRevision } : {}) }, { readScope: cardScope(scope), operation })
      const allocation = (view.allocations || []).find((a: any) => a.id === args.allocationId)
      return { receipt: { requestedFields: ['status'], acceptedRevision: null, nativeResourceIds: { importId: args.importId, line: args.line, allocationId: args.allocationId } }, result: { allocationId: args.allocationId, status: allocation?.status || null, paymentState: view.payment?.state, remaining: view.payment?.remaining, scope: view.scope || null } }
    }))
]
// Recovery of a lost owner write: the native record's marker decides (done with its recorded ids), its absence means the write did
// not happen (the caller settles it as interrupted). Null for any other action.
export async function ownerActionOutcome(ownerId: string, op: any): Promise<{ found: boolean, receipt?: any } | null> {
  const args = op.nativeArgs || {}
  if (op.name === 'queue_card_sync') {
    const account: any = await FinancialAccount.findOne({ _id: id(args.accountId), ownerId, 'jobOperation.operationId': op.operationId }).select('jobOperation').lean()
    return account ? { found: true, receipt: { outcome: 'queued', requestedFields: [], acceptedRevision: null, nativeResourceIds: { accountId: String(account._id), jobId: account.jobOperation.jobId } } } : { found: false }
  }
  if (op.name === 'set_card_auto_sync') {
    const account: any = await FinancialAccount.findOne({ _id: id(args.accountId), ownerId, 'autoSyncOperation.operationId': op.operationId }).select('_id').lean()
    return account ? { found: true, receipt: { requestedFields: ['enabled', 'hour'], acceptedRevision: null, nativeResourceIds: { accountId: String(account._id) } } } : { found: false }
  }
  if (op.name === 'review_workflow_step') {
    const row: any = await (await workflowModel()).findOne({ _id: id(args.workflowId), ownerId, 'events.operation.operationId': op.operationId }).select('events').lean()
    const event = row?.events.find((e: any) => e.operation?.operationId === op.operationId)
    return event ? { found: true, receipt: { requestedFields: [args.step], acceptedRevision: event.operation.revision ?? null, nativeResourceIds: { workflowId: String(row._id), step: args.step } } } : { found: false }
  }
  if (op.name === 'confirm_card_allocation') {
    const requestId = 'navi_' + op.operationId, match: any = await PaymentMatch.findOne({ ownerId, 'allocations.requestId': requestId }).select('allocations.id allocations.requestId').lean()
    const allocation = match?.allocations.find((a: any) => a.requestId === requestId)
    return allocation ? { found: true, receipt: { requestedFields: ['amount'], acceptedRevision: null, nativeResourceIds: { importId: args.importId, line: args.line, recordId: args.recordId, allocationId: allocation.id } } } : { found: false }
  }
  if (op.name === 'release_card_allocation' || op.name === 'reconfirm_card_allocation') {
    const match: any = await PaymentMatch.findOne({ ownerId, 'allocations.history.operation.operationId': op.operationId }).select('_id').lean()
    return match ? { found: true, receipt: { requestedFields: ['status'], acceptedRevision: null, nativeResourceIds: { importId: args.importId, line: args.line, allocationId: args.allocationId } } } : { found: false }
  }
  return null
}
