// Company Navi teaching: inspect, search, recall, create, correct and pause the instructions a member explicitly asked Navi to
// remember. Company-owned and company-scoped: legacy owner learning, memories and other companies are never read. A teaching is
// evidence for later answers only; nothing here changes a transaction, invoice, payment or ledger.
import mongoose from 'mongoose'
import { FinanceCompanyKnowledge as Knowledge } from '../models/FinanceCompanyKnowledge'
import AccountCategory from '../models/AccountCategory'
import TaxCategory from '../models/TaxCategory'
import TransactionCategory from '../models/TransactionCategory'
import Customer from '../models/Customer'
import Supplier from '../models/Supplier'
import { ready, fail as bad } from './financeService'
import { companyTransactionChoices, getCompanyNaviTransaction } from './companyTransactionAssistantService'
import { accountReferenceFields, isRegisteredAccount } from './companyAccountRegistrationService'

const init = async () => { await ready(); await Knowledge.init() }
export const knowledgeReferenceFields = ['accountCategoryId', 'subAccountCategoryId', 'taxCategoryId', 'transactionCategoryId', 'customerId', 'supplierId']
const referenceModels: any = { accountCategoryId: AccountCategory, subAccountCategoryId: AccountCategory, taxCategoryId: TaxCategory, transactionCategoryId: TransactionCategory, customerId: Customer, supplierId: Supplier }
const companyKnowledge = (organizationId: any) => ({ organizationId })
const activeKnowledge = (organizationId: any) => ({ organizationId, status: 'active' })
const knowledgeScope = (organizationId: any, knowledgeId: any) => ({ _id: knowledgeId, organizationId })
const revisionScope = (organizationId: any, knowledgeId: any, expectedRevision: number) => ({ ...knowledgeScope(organizationId, knowledgeId), revision: expectedRevision })
// The instruction must be the user's own words: an exact substring of the server-stored CURRENT message, never model text.
const quotedInstruction = (turnText: string, value: string) => value.trim().length >= 2 && turnText.includes(value)
const normal = (value: any) => String(value || '').normalize('NFKC').toLowerCase()
const bigrams = (value: string) => { const s = normal(value).replace(/\s+/g, ''), out = new Set<string>(); for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2)); return out }

async function referenceNames(rows: any[]) {
  const ids: any = {}
  for (const row of rows) for (const k of knowledgeReferenceFields) if (row.suggested?.[k]) (ids[k] ||= new Set()).add(String(row.suggested[k]))
  const names: any = {}
  for (const k of Object.keys(ids)) { const found: any[] = await referenceModels[k].find({ _id: { $in: [...ids[k]] } }).select('name').lean(); for (const r of found) names[k + ':' + String(r._id)] = r.name || '' }
  return names
}
const suggestedView = (suggested: any, names: any) => Object.fromEntries(knowledgeReferenceFields.map(k => [k.replace(/Id$/, ''), suggested?.[k] ? { id: String(suggested[k]), name: names[k + ':' + String(suggested[k])] ?? '' } : null]))
const conditionsView = (c: any) => ({ merchant: c?.merchant || '', cardLast4: c?.cardLast4 || '', effectiveFrom: c?.effectiveFrom ? new Date(c.effectiveFrom).toISOString().slice(0, 10) : '' })
// conversationKind: where the member taught it — the company conversation (rows written before the owner/purchase bridge carry none and
// keep that meaning) or an owner workspace/purchase chat under the selected company (financeOwnerCompanyKnowledgeService).
const sourceView = (s: any) => s ? { actorId: String(s.actorId), conversationKind: s.conversationKind || 'company', conversationId: String(s.conversationId), segment: s.segment ?? 0, turnId: s.turnId, quote: s.quote, at: s.at, transactionId: s.transactionId || null } : null
export function knowledgeView(row: any, names: any = {}) {
  return { id: String(row._id), status: row.status, revision: row.revision, instruction: row.instruction, conditions: conditionsView(row.conditions), suggested: suggestedView(row.suggested, names), source: sourceView(row.source), createdBy: String(row.createdBy), createdAt: row.createdAt, updatedAt: row.updatedAt,
    history: (row.history || []).map((h: any) => ({ revision: h.revision, status: h.status, instruction: h.instruction, conditions: conditionsView(h.conditions), suggested: suggestedView(h.suggested, names), changedAt: h.changedAt, changedBy: h.changedBy ? String(h.changedBy) : null, replacedBy: h.replacedBy ? { turnId: h.replacedBy.turnId, conversationKind: h.replacedBy.conversationKind || 'company', segment: h.replacedBy.segment ?? 0, quote: h.replacedBy.quote || '', at: h.replacedBy.at, kind: h.replacedBy.kind } : null })),
    meaning: 'company_teaching_evidence_not_an_automatic_ledger_rule' }
}
async function views(rows: any[]) { const names = await referenceNames(rows); return rows.map(r => knowledgeView(r, names)) }

// Inspection (UI) and search (Navi tool). Default: active teachings only; status all/paused is explicit.
export async function listCompanyKnowledge(organizationId: any, args: any = {}) {
  await init()
  const status = args.status === 'all' ? null : args.status === 'paused' ? 'paused' : 'active', page = Math.max(1, Number(args.page) || 1), limit = Math.min(50, Math.max(1, Number(args.limit) || 20))
  const filter: any = { ...companyKnowledge(organizationId), ...(status ? { status } : {}) }
  const query = typeof args.query === 'string' ? normal(args.query).trim() : '', merchant = typeof args.merchant === 'string' ? normal(args.merchant).trim() : ''
  let rows: any[] = await Knowledge.find(filter).sort({ updatedAt: -1, _id: -1 }).limit(501).lean()
  const truncated = rows.length > 500; rows = rows.slice(0, 500)
  if (query) rows = rows.filter(r => [r.instruction, r.conditions?.merchant].some(v => normal(v).includes(query)))
  if (merchant) rows = rows.filter(r => normal(r.conditions?.merchant).includes(merchant) || normal(r.instruction).includes(merchant))
  const items = await views(rows.slice((page - 1) * limit, page * limit))
  return { items, page, limit, hasMore: rows.length > page * limit, status: status || 'all', scannedLimit: 500, truncated, source: 'company_teachings_only' }
}

// One teaching the user selected in the memory view to discuss: any status (a paused one is shown with its state, provenance and
// history for discussion, never recalled as guidance), this company only.
const selectedKnowledge = (organizationId: any, knowledgeId: any) => ({ _id: knowledgeId, organizationId })
export async function getCompanyKnowledgeItem(organizationId: any, knowledgeId: string) {
  await init()
  if (typeof knowledgeId !== 'string' || !/^[a-f0-9]{24}$/i.test(knowledgeId)) bad(404, 'Company teaching not found')
  const row: any = await Knowledge.findOne(selectedKnowledge(organizationId, new mongoose.Types.ObjectId(knowledgeId))).lean()
  if (!row) bad(404, 'Company teaching not found')
  return (await views([row]))[0]
}

// Recall for a claimed job: active teachings related to the current message or the selected transaction's merchant text.
export async function relevantCompanyKnowledge(organizationId: any, text: string, related: string[] = []) {
  await init()
  const rows: any[] = await Knowledge.find(activeKnowledge(organizationId)).sort({ updatedAt: -1, _id: -1 }).limit(500).lean()
  const haystack = normal([text, ...related].join(' ')), grams = bigrams([text, ...related].join(' '))
  const scored = rows.map(r => {
    const merchant = normal(r.conditions?.merchant).trim(), own = bigrams(r.instruction || '')
    let shared = 0; for (const g of own) if (grams.has(g)) shared++
    return { r, score: (merchant && haystack.includes(merchant) ? 100 : 0) + shared }
  }).filter(x => x.score >= 100 || x.score >= 6).sort((a, b) => b.score - a.score).slice(0, 8)
  return { items: await views(scored.map(x => x.r)), activeTotal: rows.length }
}

async function validatedValues(organizationId: any, args: any, turnText: string, clearing: boolean) {
  const values: any = {}
  if (args.instruction !== undefined) { if (!quotedInstruction(turnText, args.instruction)) bad(400, 'The instruction must quote the current user message exactly; do not save your own wording'); values.instruction = args.instruction.trim() }
  const conditions: any = {}
  if (args.merchant !== undefined) conditions.merchant = args.merchant.trim()
  if (args.cardLast4 !== undefined) conditions.cardLast4 = args.cardLast4
  if (args.effectiveFrom !== undefined) conditions.effectiveFrom = args.effectiveFrom ? new Date(args.effectiveFrom + 'T00:00:00Z') : ''
  const wanted = knowledgeReferenceFields.filter(k => args[k] !== undefined && args[k] !== '')
  if (wanted.length) {
    // Suggested values must be references this company actually used, or accounting accounts it explicitly registered (checked
    // directly, any catalogue page), never guessed or global ids.
    const observed = (await companyTransactionChoices(organizationId)).choices
    for (const k of wanted) {
      if ((observed[k] || []).some((r: any) => r.id === args[k])) continue
      if (accountReferenceFields.includes(k) && await isRegisteredAccount(organizationId, k, args[k])) continue;
      bad(400, 'Use a reference observed in this company history, or an accounting account registered for this company (list_company_transaction_choices), for ' + k)
    }
  }
  const suggested: any = {}
  for (const k of knowledgeReferenceFields) if (args[k] !== undefined) suggested[k] = args[k] === '' ? (clearing ? null : undefined) : new mongoose.Types.ObjectId(args[k])
  if (args.transactionId) await getCompanyNaviTransaction(organizationId, args.transactionId)
  return { values, conditions, suggested }
}
// Checks a write's arguments before the journal claims a slot: wrong quote, unobserved reference or foreign record is a 400/404
// with no receipt and no effect.
export async function checkCompanyKnowledgeWrite(c: any, name: string, args: any) {
  await init()
  const turn = c.turns.find((t: any) => t.id === c.currentId), text = String(turn?.text || '')
  if (name === 'remember_company_knowledge') return validatedValues(c.organizationId, args, text, false)
  if (!await Knowledge.exists(knowledgeScope(c.organizationId, args.knowledgeId))) bad(404, 'Company teaching not found')
  if (name === 'correct_company_knowledge') { const v = await validatedValues(c.organizationId, args, text, true); if (!Object.keys(v.values).length && !Object.keys(v.conditions).length && !Object.keys(v.suggested).length) bad(400, 'Name at least one part of the teaching to correct'); return v }
  return { values: {}, conditions: {}, suggested: {} }
}
const marker = (op: any, kind: string) => ({ operationId: op.operationId, payloadHash: op.payloadHash, kind, turnId: op.turnId, at: new Date() })
const snapshot = (row: any) => ({ revision: row.revision, status: row.status, instruction: row.instruction, conditions: row.conditions || {}, suggested: row.suggested || {} })
// Executes one claimed teaching operation. The knowledge row carries the operation marker in the same atomic write.
export async function applyCompanyKnowledgeWrite(c: any, op: any, args: any, checked: any) {
  await init()
  const turn = c.turns.find((t: any) => t.id === c.currentId), at = new Date(), organizationId = c.organizationId
  // c.conversationKind is set only by the owner/purchase bridge (workspace | purchase); the company conversation writes none, as before.
  const provenance = { actorId: c.ownerId, ...(c.conversationKind ? { conversationKind: c.conversationKind } : {}), conversationId: c._id, segment: c.segment || 0, turnId: turn.id, at }
  if (op.name === 'remember_company_knowledge') {
    const conditions = Object.fromEntries(Object.entries(checked.conditions).filter(([, v]) => v !== '' && v !== undefined)), suggested = Object.fromEntries(Object.entries(checked.suggested).filter(([, v]) => v))
    try {
      await Knowledge.create({ _id: op.knowledgeId, organizationId, createdBy: c.ownerId, updatedBy: c.ownerId, status: 'active', revision: 1, instruction: checked.values.instruction, conditions, suggested, source: { ...provenance, quote: checked.values.instruction, transactionId: args.transactionId || null }, history: [], operations: [marker(op, 'create')] })
    } catch (e: any) { if (e?.code !== 11000) throw e }
  } else {
    const current: any = await Knowledge.findOne(knowledgeScope(organizationId, op.knowledgeId)).lean()
    if (!current) bad(404, 'Company teaching not found')
    if (current.operations?.some((m: any) => m.operationId === op.operationId)) return current
    // The expected revision is enforced only by the atomic write below; the history snapshot is pinned to the same revision.
    const set: any = { updatedBy: c.ownerId }, unset: any = {}
    if (op.name === 'set_company_knowledge_status') set.status = args.status
    else {
      if (checked.values.instruction) set.instruction = checked.values.instruction
      for (const [k, v] of Object.entries(checked.conditions)) { if (v === '' ) unset['conditions.' + k] = ''; else set['conditions.' + k] = v }
      for (const [k, v] of Object.entries(checked.suggested)) { if (v === null) unset['suggested.' + k] = ''; else set['suggested.' + k] = v }
    }
    const replacedBy = { kind: op.name === 'set_company_knowledge_status' ? 'status:' + args.status : 'correction', turnId: turn.id, ...(c.conversationKind ? { conversationKind: c.conversationKind } : {}), segment: c.segment || 0, conversationId: c._id, quote: checked.values.instruction || '', at, actorId: c.ownerId, operationId: op.operationId }
    // $and pins the snapshotted revision too, so the audit entry is exactly the content this write replaces.
    const changed = await Knowledge.updateOne({ ...revisionScope(organizationId, op.knowledgeId, args.expectedRevision), $and: [{ revision: current.revision }], 'operations.operationId': { $ne: op.operationId } }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}), $inc: { revision: 1 }, $push: { history: { ...snapshot(current), changedAt: at, changedBy: c.ownerId, replacedBy }, operations: { $each: [marker(op, op.name === 'set_company_knowledge_status' ? 'status' : 'correct')], $slice: -100 } } })
    if (!changed.matchedCount) {
      const fresh: any = await Knowledge.findOne(knowledgeScope(organizationId, op.knowledgeId)).lean()
      if (fresh?.operations?.some((m: any) => m.operationId === op.operationId)) return fresh
      bad(409, 'The teaching changed (now revision ' + (fresh?.revision ?? '?') + '); read it again before correcting')
    }
  }
  const row: any = await Knowledge.findOne(knowledgeScope(organizationId, op.knowledgeId)).lean()
  if (!row?.operations?.some((m: any) => m.operationId === op.operationId && m.payloadHash === op.payloadHash)) bad(409, 'Company teaching write was not recorded')
  return row
}
// Durable marker lookup used by the company journal's reconciliation: the operation is done only if the row carries it.
export async function companyKnowledgeMarker(organizationId: any, knowledgeId: any, operationId: string) {
  await init()
  const row: any = await Knowledge.findOne(knowledgeScope(organizationId, knowledgeId)).select('operations').lean()
  return row?.operations?.find((m: any) => m.operationId === operationId) || null
}
export async function companyKnowledgeResult(row: any) { return (await views([row]))[0] }
