import Transaction from '../models/Transaction'
import { updateTransaction, transactionUpdateFields } from './transactionService'
import Invoice from '../models/Invoice'
import { updateCompanyInvoice } from './companyInvoiceWriteService'
import { createHash } from 'node:crypto'
import { FinanceCompanyAssistant as Conversation } from '../models/FinanceCompanyAssistant'
import { Payment } from '../models/Payment'
import { fail } from './financeService'
import { canonicalJson } from '../../shared/finance-action-proposal.mjs'
import { updateCompanyCalendarEntry, calendarUpdateFields } from './companyPaymentWriteService'
import { applyCompanyKnowledgeWrite, checkCompanyKnowledgeWrite, companyKnowledgeMarker, companyKnowledgeResult } from './companyKnowledgeService'
import { businessAdapter, recoverBusinessOperation, businessIdKey, invoiceResultValues } from './companyNaviBusinessService'
import { businessToolMeta } from '../../shared/finance-navi-business.mjs'

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const actionIdentity = (c: any) => ({ _id: c._id, ownerId: c.ownerId, organizationId: c.organizationId })
// Company teaching writes share this journal: same slot/intent claim, durable marker on the written row, no blind repeat.
export const companyKnowledgeActions = ['remember_company_knowledge', 'correct_company_knowledge', 'set_company_knowledge_status']
const knowledgeAction = (name: string) => companyKnowledgeActions.includes(name)
// Registered business operations (create/delete/budget/recurring/generate) share this journal with the same slot/intent rules.
const businessAction = (name: string) => !!businessAdapter(name)
export const companyActionReceipt = (a: any) => ({ operationId: a.operationId, name: a.name, turnId: a.turnId, slot: a.slot, target: businessAction(a.name) ? { [businessIdKey(a.name) as string]: a.resourceId ?? null } : a.name === 'update_company_transaction' ? { transactionId: a.transactionId } : a.name === 'update_company_invoice' ? { invoiceId: a.invoiceId } : knowledgeAction(a.name) ? { knowledgeId: a.knowledgeId } : { paymentId: a.paymentId }, state: a.state === 'claimed' ? 'working' : a.state, requestedFields: a.requestedFields || [], nativeResourceIds: a.nativeResourceIds || null, acceptedRevision: null, completedAt: a.completedAt || null, recoveryOwner: a.recoveryOwner || null, safeError: a.safeError || null })
async function knowledgeMarker(c: any, op: any) { const m = await companyKnowledgeMarker(c.organizationId, op.knowledgeId, op.operationId); return m ? { operationId: m.operationId, payloadHash: m.payloadHash, requestedFields: op.requestedFields, appliedAt: m.at } : null }
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
    const knowledge = knowledgeAction(op.name), business = businessAction(op.name)
    const payment: any = knowledge || business ? null : op.name === 'update_company_transaction' ? await Transaction.findOne({ _id: op.transactionId, organizationId: c.organizationId }).select('naviOperation').lean() : op.name === 'update_company_invoice' ? await Invoice.findOne({ _id: op.invoiceId, organizationId: c.organizationId }).select('naviOperation').lean() : await Payment.findOne({ _id: op.paymentId, organizationId: c.organizationId }).select('naviOperation').lean()
    const marker = business ? await recoverBusinessOperation(c, op) : knowledge ? await knowledgeMarker(c, op) : payment?.naviOperation
    if (marker?.operationId === op.operationId && marker.payloadHash === op.payloadHash) {
      await settle(c, turn.id, op, { state: 'done', requestedFields: marker.requestedFields || op.requestedFields, nativeResourceIds: business ? marker.nativeResourceIds || { [businessIdKey(op.name) as string]: String(op.resourceId) } : op.name === 'update_company_transaction' ? { transactionId: String(op.transactionId) } : op.name === 'update_company_invoice' ? { invoiceId: String(op.invoiceId) } : knowledge ? { knowledgeId: String(op.knowledgeId) } : { paymentId: String(op.paymentId) }, completedAt: marker.appliedAt, recoveryOwner: null, safeError: null })
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
export async function updateCompanyCalendarAction(c: any, body: any, args: any, verifyJob: () => Promise<any>) { return updateCompanyAction(c, body, args, verifyJob, 'calendar') }
export async function updateCompanyInvoiceAction(c: any, body: any, args: any, verifyJob: () => Promise<any>) { return updateCompanyAction(c, body, args, verifyJob, 'invoice') }
export async function updateCompanyTransactionAction(c: any, body: any, args: any, verifyJob: () => Promise<any>) { return updateCompanyAction(c, body, args, verifyJob, 'transaction') }
async function updateCompanyAction(c: any, body: any, args: any, verifyJob: () => Promise<any>, kind: string) {
  const invoice = kind === 'invoice', transaction = kind === 'transaction'
  if (!Number.isSafeInteger(body.slot) || body.slot < 1 || body.slot > 500) fail(400, 'Invalid action slot')
  const allowed = transaction ? transactionUpdateFields.filter(k => !['hasReceipt','sourceId'].includes(k)) : invoice ? ['status','issueDate','dueDate','paidDate','taxRate','currency','notes','terms','from','to','items','bankDetails','transactionId'] : calendarUpdateFields.filter(k => k !== 'bankTransfer')
  const requestedFields = Object.keys(args).filter(k => allowed.includes(k))
  if (!requestedFields.length) fail(400, 'Name at least one field to change')
  const name = transaction ? 'update_company_transaction' : invoice ? 'update_company_invoice' : 'update_company_calendar_entry', resourceId = transaction ? args.transactionId : invoice ? args.invoiceId : args.paymentId, resourceIds = transaction ? { transactionId: resourceId } : invoice ? { invoiceId: resourceId } : { paymentId: resourceId }, payloadHash = sha(canonicalJson({ name, args })), turnId = c.currentId
  let fresh: any = await reconcileCompanyActions(c), turn = fresh.turns.find((t: any) => t.id === turnId)
  const atSlot = turn.actions?.find((a: any) => a.slot === body.slot)
  if (atSlot && atSlot.payloadHash !== payloadHash) fail(409, 'Action slot has another meaning')
  const existing = atSlot || turn.actions?.find((a: any) => a.name === name && a.payloadHash === payloadHash)
  if (existing) return response(existing)
  const op: any = { operationId: sha([String(c.ownerId), String(c.organizationId), String(c._id), turnId, body.slot].join(':')).slice(0, 32), name, turnId, slot: body.slot, payloadHash, ...(transaction ? { transactionId: resourceId } : invoice ? { invoiceId: resourceId } : { paymentId: resourceId }), requestedFields, state: 'claimed', lease: body.lease, leaseUntil: c.leaseUntil, claimedAt: new Date() }
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
    const operation = { operationId: op.operationId, payloadHash, expectedUpdatedAt: args.expectedUpdatedAt }
    const payment: any = transaction ? await updateTransaction(args.transactionId, args, c.organizationId, operation) : invoice ? await updateCompanyInvoice(c.organizationId, args.invoiceId, args, operation) : await updateCompanyCalendarEntry(c.organizationId, args.paymentId, args, operation)
    await settle(c, turnId, op, { state: 'done', nativeResourceIds: resourceIds, completedAt: new Date(), recoveryOwner: null, safeError: null })
    await verifyJob()
    return response({ ...op, state: 'done', nativeResourceIds: resourceIds, completedAt: payment.naviOperation.appliedAt }, { ...resourceIds, values: invoice ? invoiceResultValues(payment.naviOperation.values) : payment.naviOperation.values, updatedAt: payment.updatedAt, settlement: 'saved_status_only' })
  } catch (error: any) {
    const payment: any = transaction ? await Transaction.findOne({ _id: args.transactionId, organizationId: c.organizationId }).select('naviOperation').lean() : invoice ? await Invoice.findOne({ _id: args.invoiceId, organizationId: c.organizationId }).select('naviOperation').lean() : await Payment.findOne({ _id: args.paymentId, organizationId: c.organizationId }).select('naviOperation').lean()
    const marker = payment?.naviOperation
    if (marker?.operationId === op.operationId && marker.payloadHash === payloadHash) {
      await settle(c, turnId, op, { state: 'done', nativeResourceIds: resourceIds, completedAt: marker.appliedAt, recoveryOwner: null, safeError: null })
      await verifyJob()
      return response({ ...op, state: 'done', nativeResourceIds: resourceIds, completedAt: marker.appliedAt })
    }
    const state = error?.statusCode || error?.name === 'ValidationError' ? 'failed' : 'unresolved'
    await settle(c, turnId, op, { state, completedAt: state === 'failed' ? new Date() : null, recoveryOwner: state === 'failed' ? 'model' : 'user', safeError: state === 'failed' ? '変更は保存されませんでした。対象と現在の値を確認してください。' : '保存結果を確認できません。同じ操作は自動で繰り返していません。' })
    throw error
  }
}
// Registered business operation: claim slot and intent first, run the one native operation once with its marker, settle from the
// native result. A lost reply is settled from the marker; an unprovable outcome (a hard delete) stays unresolved for the user and is
// never executed again. Already final receipts never change (settle only touches a claimed operation).
export async function companyBusinessAction(c: any, body: any, args: any, verifyJob: () => Promise<any>) {
  if (!Number.isSafeInteger(body.slot) || body.slot < 1 || body.slot > 500) fail(400, 'Invalid action slot')
  const adapter: any = businessAdapter(body.name), name = body.name, idKey = businessIdKey(name) as string, payloadHash = sha(canonicalJson({ name, args })), turnId = c.currentId
  const requestedFields = Object.keys(args).filter(k => k !== 'expectedUpdatedAt' && !(businessToolMeta[name].effect !== 'create' && k === idKey))
  let fresh: any = await reconcileCompanyActions(c), turn = fresh.turns.find((t: any) => t.id === turnId)
  const atSlot = turn.actions?.find((a: any) => a.slot === body.slot)
  if (atSlot && atSlot.payloadHash !== payloadHash) fail(409, 'Action slot has another meaning')
  const existing = atSlot || turn.actions?.find((a: any) => a.name === name && a.payloadHash === payloadHash)
  if (existing) return response(existing)
  if (adapter.precheck) await adapter.precheck(c, args)
  const operationId = sha([String(c.ownerId), String(c.organizationId), String(c._id), turnId, body.slot].join(':')).slice(0, 32)
  const op: any = { operationId, name, turnId, slot: body.slot, payloadHash, resourceKind: businessToolMeta[name].kind, resourceId: adapter.resource(args, operationId), ...(adapter.detail ? { detail: adapter.detail(args) } : {}), requestedFields, state: 'claimed', lease: body.lease, leaseUntil: c.leaseUntil, claimedAt: new Date() }
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
    const marker = { operationId, payloadHash, appliedAt: new Date(), requestedFields }
    const out = await adapter.run({ c, args, op, marker })
    await settle(c, turnId, op, { state: 'done', nativeResourceIds: out.resourceIds, completedAt: marker.appliedAt, recoveryOwner: null, safeError: null })
    await verifyJob()
    return response({ ...op, state: 'done', nativeResourceIds: out.resourceIds, completedAt: marker.appliedAt }, out.result)
  } catch (error: any) {
    const marker = await recoverBusinessOperation(c, op)
    if (marker?.operationId === operationId && marker.payloadHash === payloadHash) {
      const nativeResourceIds = marker.nativeResourceIds || { [idKey]: String(op.resourceId) }
      await settle(c, turnId, op, { state: 'done', nativeResourceIds, completedAt: marker.appliedAt, recoveryOwner: null, safeError: null })
      await verifyJob()
      return response({ ...op, state: 'done', nativeResourceIds, completedAt: marker.appliedAt })
    }
    const state = error?.statusCode || error?.name === 'ValidationError' ? 'failed' : 'unresolved'
    await settle(c, turnId, op, { state, completedAt: state === 'failed' ? new Date() : null, recoveryOwner: state === 'failed' ? 'model' : 'user', safeError: state === 'failed' ? '変更は保存されませんでした。対象と現在の値を確認してください。' : '保存結果を確認できません。同じ操作は自動で繰り返していません。' })
    throw error
  }
}
// Explicit company teaching (remember / correct / pause-resume). Arguments are checked before any claim (exact user quote,
// observed references, company record), so a refused call leaves no receipt. A claimed operation is executed once; its marker on
// the knowledge row proves completion even if this reply is lost. Never touches transactions, invoices, payments or the ledger.
export async function companyKnowledgeAction(c: any, body: any, args: any, verifyJob: () => Promise<any>) {
  if (!Number.isSafeInteger(body.slot) || body.slot < 1 || body.slot > 500) fail(400, 'Invalid action slot')
  const name = body.name, payloadHash = sha(canonicalJson({ name, args })), turnId = c.currentId
  const requestedFields = Object.keys(args).filter(k => !['knowledgeId', 'expectedRevision'].includes(k))
  let fresh: any = await reconcileCompanyActions(c), turn = fresh.turns.find((t: any) => t.id === turnId)
  const atSlot = turn.actions?.find((a: any) => a.slot === body.slot)
  if (atSlot && atSlot.payloadHash !== payloadHash) fail(409, 'Action slot has another meaning')
  const existing = atSlot || turn.actions?.find((a: any) => a.name === name && a.payloadHash === payloadHash)
  if (existing) return response(existing)
  const checked = await checkCompanyKnowledgeWrite(c, name, args)
  const operationId = sha([String(c.ownerId), String(c.organizationId), String(c._id), turnId, body.slot].join(':')).slice(0, 32)
  const knowledgeId = name === 'remember_company_knowledge' ? operationId.slice(0, 24) : args.knowledgeId
  const op: any = { operationId, name, turnId, slot: body.slot, payloadHash, knowledgeId, requestedFields, state: 'claimed', lease: body.lease, leaseUntil: c.leaseUntil, claimedAt: new Date() }
  const claimed = await Conversation.updateOne({ ...actionIdentity(c), state: 'working', currentId: turnId, lease: body.lease, leaseUntil: { $gt: new Date() }, turns: { $elemMatch: { id: turnId, actions: { $not: { $elemMatch: { $or: [{ slot: body.slot }, { name, payloadHash }] } } } } } }, { $push: { 'turns.$[turn].actions': op } }, { arrayFilters: [{ 'turn.id': turnId }] })
  if (!claimed.matchedCount) {
    fresh = await Conversation.findOne(actionIdentity(c)).lean(); turn = fresh?.turns.find((t: any) => t.id === turnId)
    const duplicate = turn?.actions?.find((a: any) => a.slot === body.slot || (a.name === name && a.payloadHash === payloadHash))
    if (!duplicate) fail(409, 'Company conversation job changed')
    if (duplicate.payloadHash !== payloadHash) fail(409, 'Action slot has another meaning')
    return response(duplicate)
  }
  const resourceIds = { knowledgeId }
  try {
    await verifyJob()
    const row = await applyCompanyKnowledgeWrite(c, op, args, checked)
    const marker = row.operations.find((m: any) => m.operationId === operationId)
    await settle(c, turnId, op, { state: 'done', nativeResourceIds: resourceIds, completedAt: marker.at, recoveryOwner: null, safeError: null })
    await verifyJob()
    return response({ ...op, state: 'done', nativeResourceIds: resourceIds, completedAt: marker.at }, { knowledge: await companyKnowledgeResult(row), ledgerChanged: false })
  } catch (error: any) {
    const marker = await knowledgeMarker(c, op)
    if (marker?.operationId === operationId && marker.payloadHash === payloadHash) {
      await settle(c, turnId, op, { state: 'done', nativeResourceIds: resourceIds, completedAt: marker.appliedAt, recoveryOwner: null, safeError: null })
      await verifyJob()
      return response({ ...op, state: 'done', nativeResourceIds: resourceIds, completedAt: marker.appliedAt })
    }
    const state = error?.statusCode || error?.name === 'ValidationError' ? 'failed' : 'unresolved'
    await settle(c, turnId, op, { state, completedAt: state === 'failed' ? new Date() : null, recoveryOwner: state === 'failed' ? 'model' : 'user', safeError: state === 'failed' ? '記憶は保存されませんでした。最新の内容を読み直してください。' : '記憶の保存結果を確認できません。同じ操作は自動で繰り返していません。' })
    throw error
  }
}
