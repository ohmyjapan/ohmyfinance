import { createHash } from 'node:crypto'
import { FinanceCompanyAssistant as Conversation } from '../models/FinanceCompanyAssistant'
import { Payment } from '../models/Payment'
import { fail } from './financeService'
import { canonicalJson } from '../../shared/finance-action-proposal.mjs'
import { updateCompanyCalendarEntry, calendarUpdateFields } from './companyPaymentWriteService'

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const actionIdentity = (c: any) => ({ _id: c._id, ownerId: c.ownerId, organizationId: c.organizationId })
export const companyActionReceipt = (a: any) => ({ operationId: a.operationId, name: a.name, turnId: a.turnId, slot: a.slot, target: { paymentId: a.paymentId }, state: a.state === 'claimed' ? 'working' : a.state, requestedFields: a.requestedFields || [], nativeResourceIds: a.nativeResourceIds || null, acceptedRevision: null, completedAt: a.completedAt || null, recoveryOwner: a.recoveryOwner || null, safeError: a.safeError || null })
async function settle(c: any, turnId: string, op: any, values: any) {
  const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => ['turns.$[turn].actions.$[action].' + key, value]))
  await Conversation.updateOne(actionIdentity(c), { $set: changes }, { arrayFilters: [{ 'turn.id': turnId }, { 'action.operationId': op.operationId, 'action.state': 'claimed' }] })
}
// A domain marker proves a completed write even if its HTTP/journal reply was lost. Absence is not proof of failure.
// Unknown expired operations are never automatically executed again. No financial write happens during reconciliation.
export async function reconcileCompanyActions(c: any) {
  if (!c) return c
  for (const turn of c.turns || []) for (const op of turn.actions || []) {
    if (op.state !== 'claimed') continue
    const payment: any = await Payment.findOne({ _id: op.paymentId, organizationId: c.organizationId }).select('naviOperation').lean()
    const marker = payment?.naviOperation
    if (marker?.operationId === op.operationId && marker.payloadHash === op.payloadHash) {
      await settle(c, turn.id, op, { state: 'done', requestedFields: marker.requestedFields, nativeResourceIds: { paymentId: String(op.paymentId) }, completedAt: marker.appliedAt, recoveryOwner: null, safeError: null })
    } else if (new Date(op.leaseUntil).getTime() < Date.now() - 20000 && !(c.state === 'working' && c.lease === op.lease && new Date(c.leaseUntil).getTime() > Date.now())) {
      await settle(c, turn.id, op, { state: 'unresolved', recoveryOwner: 'user', safeError: '保存結果を確認できません。同じ操作は自動で繰り返していません。' })
    }
  }
  return Conversation.findOne(actionIdentity(c)).lean()
}
export async function companyActionReceipts(c: any, turnId: string, operationId?: string) {
  const fresh: any = await reconcileCompanyActions(c)
  return (fresh?.turns.find((t: any) => t.id === turnId)?.actions || []).filter((a: any) => !operationId || a.operationId === operationId).map(companyActionReceipt)
}
const response = (op: any, result?: any) => ({ name: op.name, effect: 'write', receipt: companyActionReceipt(op), ...(result ? { result } : {}) })
export async function updateCompanyCalendarAction(c: any, body: any, args: any, verifyJob: () => Promise<any>) {
  if (!Number.isSafeInteger(body.slot) || body.slot < 1 || body.slot > 500) fail(400, 'Invalid action slot')
  const requestedFields = Object.keys(args).filter(k => calendarUpdateFields.includes(k) && k !== 'bankTransfer')
  if (!requestedFields.length) fail(400, 'Name at least one calendar field to change')
  const name = 'update_company_calendar_entry', payloadHash = sha(canonicalJson({ name, args })), turnId = c.currentId
  let fresh: any = await reconcileCompanyActions(c), turn = fresh.turns.find((t: any) => t.id === turnId)
  const atSlot = turn.actions?.find((a: any) => a.slot === body.slot)
  if (atSlot && atSlot.payloadHash !== payloadHash) fail(409, 'Action slot has another meaning')
  const existing = atSlot || turn.actions?.find((a: any) => a.name === name && a.payloadHash === payloadHash)
  if (existing) return response(existing)
  const op: any = { operationId: sha([String(c.ownerId), String(c.organizationId), String(c._id), turnId, body.slot].join(':')).slice(0, 32), name, turnId, slot: body.slot, payloadHash, paymentId: args.paymentId, requestedFields, state: 'claimed', lease: body.lease, leaseUntil: c.leaseUntil, claimedAt: new Date() }
  // Claim both the slot and this exact intent atomically in the same frozen company conversation.
  const claimed = await Conversation.updateOne({ ...actionIdentity(c), state: 'working', currentId: turnId, lease: body.lease, leaseUntil: { $gt: new Date() }, turns: { $elemMatch: { id: turnId, actions: { $not: { $elemMatch: { $or: [{ slot: body.slot }, { name, payloadHash }] } } } } } }, { $push: { 'turns.$[turn].actions': op } }, { arrayFilters: [{ 'turn.id': turnId }] })
  if (!claimed.matchedCount) {
    fresh = await Conversation.findOne(actionIdentity(c)).lean(); turn = fresh?.turns.find((t: any) => t.id === turnId)
    const duplicate = turn?.actions?.find((a: any) => a.slot === body.slot || (a.name === name && a.payloadHash === payloadHash))
    if (!duplicate) fail(409, 'Company conversation job changed')
    if (duplicate.payloadHash !== payloadHash) fail(409, 'Action slot has another meaning')
    return response(duplicate)
  }
  try {
    await verifyJob()
    const payment: any = await updateCompanyCalendarEntry(c.organizationId, args.paymentId, args, { operationId: op.operationId, payloadHash, expectedUpdatedAt: args.expectedUpdatedAt })
    await settle(c, turnId, op, { state: 'done', nativeResourceIds: { paymentId: String(payment._id) }, completedAt: new Date(), recoveryOwner: null, safeError: null })
    await verifyJob()
    return response({ ...op, state: 'done', nativeResourceIds: { paymentId: String(payment._id) }, completedAt: payment.naviOperation.appliedAt }, { paymentId: String(payment._id), values: payment.naviOperation.values, updatedAt: payment.updatedAt, settlement: 'saved_status_only' })
  } catch (error: any) {
    const payment: any = await Payment.findOne({ _id: args.paymentId, organizationId: c.organizationId }).select('naviOperation').lean()
    const marker = payment?.naviOperation
    if (marker?.operationId === op.operationId && marker.payloadHash === payloadHash) {
      await settle(c, turnId, op, { state: 'done', nativeResourceIds: { paymentId: args.paymentId }, completedAt: marker.appliedAt, recoveryOwner: null, safeError: null })
      await verifyJob()
      return response({ ...op, state: 'done', nativeResourceIds: { paymentId: args.paymentId }, completedAt: marker.appliedAt })
    }
    const state = error?.statusCode || error?.name === 'ValidationError' ? 'failed' : 'unresolved'
    await settle(c, turnId, op, { state, completedAt: state === 'failed' ? new Date() : null, recoveryOwner: state === 'failed' ? 'model' : 'user', safeError: state === 'failed' ? '変更は保存されませんでした。対象と現在の値を確認してください。' : '保存結果を確認できません。同じ操作は自動で繰り返していません。' })
    throw error
  }
}
