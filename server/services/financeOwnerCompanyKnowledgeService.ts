// Same-company teaching bridge for the legacy owner workspace and purchase chats. The authority is never the card's company, a request
// body or a model argument: it is the company frozen on the turn at send (C1 posting company, checked then), a worker that is
// workspace-capable, and a membership of that company read fresh now (claim, action, result and recovery). With that authority the
// job receives the company's active teachings and the company-teaching tools; without it the turn is an ordinary owner/card chat with
// no company data and no teaching tools (absence of a company never blocks the card discussion).
// A turn that received company data is tagged (companyContext). A tagged turn is withheld from the model's earlier-message input and
// from the owner UI/history/archives whenever the current checked company is a different one or none, so another company's teaching
// never flows into a different company's or a card-only continuation. Teaching writes reuse the company knowledge service (exact current
// quote, expected revision, marker in the same atomic write) with conversationKind provenance; nothing here changes a draft, ledger row,
// legacy owner memory or setting.
import mongoose, { type Model } from 'mongoose'
import { createHash } from 'node:crypto'
import Organization from '../models/Organization'
import { companyMembership } from '../utils/calendarAccess'
import { frozenPostingCompany, frozenCompanyId } from './financeNaviPostingService'
import { relevantCompanyKnowledge, listCompanyKnowledge, checkCompanyKnowledgeWrite, applyCompanyKnowledgeWrite, companyKnowledgeMarker, companyKnowledgeResult } from './companyKnowledgeService'
import { fail } from './financeService'
import { canonicalJson } from '../../shared/finance-action-proposal.mjs'

export type TeachingCompany = { actorId: string, organizationId: string, name: string }
export const NO_TEACHING_AUTHORITY = '会社の記憶は、会社を選択して送信したメッセージで、会社の会話ができる接続担当がその会社の現在のメンバーとして確認できる場合だけ使えます。この会話はそのまま続けられます。'
export const companyTeachingActions = ['search_company_knowledge', 'remember_company_knowledge', 'correct_company_knowledge', 'set_company_knowledge_status']
const teachingWrites = ['remember_company_knowledge', 'correct_company_knowledge', 'set_company_knowledge_status']
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

// The authority for one turn, checked now. Null for a narrow worker, no frozen company, a removed membership or an inactive company.
export async function teachingCompany(agent: any, ownerId: any, frozenValue: any): Promise<TeachingCompany | null> {
  if (!agent?.workspaceEnabled) return null
  const frozen = frozenPostingCompany(frozenValue, String(ownerId)); if (!frozen) return null
  const checked = await companyMembership(String(ownerId), String(frozen.organizationId)).catch((error: any) => { if (error?.statusCode === 403) return null; throw error })
  if (!checked || !checked.equals(frozenCompanyId(frozen))) return null
  const company: any = await Organization.findOne({ _id: checked, isActive: true }).select('name').lean()
  return company ? { actorId: String(ownerId), organizationId: String(checked), name: String(company.name || '').slice(0, 200) } : null
}
export const companyTag = (turn: any) => turn?.companyContext?.organizationId ? String(turn.companyContext.organizationId) : null
const visibleTo = (turn: any, organizationId: string | null) => { const tag = companyTag(turn); return !tag || tag === organizationId }
// A withheld turn keeps its identity, times and its non-teaching receipts (owner actions on owner records); its text, reply, frozen
// company and teaching receipts are not shown.
function withheldTurn(t: any) {
  return { id: t.id, at: t.at, ...(t.answeredAt ? { answeredAt: t.answeredAt } : {}), ...(t.pageName ? { pageName: t.pageName } : {}), withheld: 'company_context', ...(Array.isArray(t.actions) ? { actions: t.actions.filter((a: any) => !companyTeachingActions.includes(a.name)) } : {}) }
}
export function maskTurns(turns: any[], organizationId: string | null) {
  return (turns || []).map((t: any) => visibleTo(t, organizationId) ? t : withheldTurn(t))
}
// Earlier messages for the model: each carries the turn id it came from; a tagged turn of another (or no) company is withheld.
export function withholdMessages(messages: any[], turns: any[], organizationId: string | null) {
  const byId = new Map((turns || []).map((t: any) => [t.id, t]))
  return (messages || []).map((m: any) => { const t: any = m?.turnId ? byId.get(m.turnId) : null; return t && !visibleTo(t, organizationId) ? { withheld: 'company_context', submittedAt: m.submittedAt || null } : m })
}
// Tags the claimed turn (lease-bound) before any company data reaches the job. False when the job lease changed.
export async function tagCompanyTurn(model: Model<any>, conversationId: any, lease: string, turnId: string, authority: TeachingCompany) {
  const tag = { actorId: authority.actorId, organizationId: authority.organizationId, at: new Date() }
  const r = await model.updateOne({ _id: conversationId, state: 'working', lease, leaseUntil: { $gt: new Date() } }, { $set: { 'turns.$[t].companyContext': tag } }, { arrayFilters: [{ 't.id': turnId, 't.companyContext': { $exists: false } }] })
  if (r.matchedCount) return true
  return false
}
// Claim: the authority, the earlier messages filtered for it, and (with authority) the recalled teachings; the turn is tagged when any
// teaching is supplied. A lost lease supplies nothing.
export async function companyClaim(model: Model<any>, c: any, turn: any, agent: any, lease: string, related: string[] = []) {
  const authority = await teachingCompany(agent, c.ownerId, turn?.postingCompany)
  const messages = withholdMessages(c.context?.messages, c.turns, authority?.organizationId || null)
  if (!authority) return { authority: null, messages }
  const recall = await relevantCompanyKnowledge(new mongoose.Types.ObjectId(authority.organizationId), String(turn.text || ''), related.filter(Boolean))
  if (recall.items.length && !await tagCompanyTurn(model, c._id, lease, turn.id, authority)) return { authority: null, messages: withholdMessages(c.context?.messages, c.turns, null) }
  return { authority, messages, knowledge: recall.items, knowledgeActiveTotal: recall.activeTotal }
}
// The result and retry check: a tagged turn whose company can no longer be confirmed keeps no reply (the owner sends a new message).
export async function companyContextLost(agent: any, ownerId: any, turn: any) {
  const tag = companyTag(turn); if (!tag) return false
  const authority = await teachingCompany(agent, ownerId, turn.postingCompany)
  return authority?.organizationId !== tag
}

// The company-teaching tools offered to an authorized owner/purchase job. Definitions only: the action service journals the writes.
const oid = { type: 'string', pattern: '^[a-fA-F0-9]{24}$' }, textFilter = { type: 'string', maxLength: 100 }
const schema = (properties: any, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) })
const refs = (pattern: string) => Object.fromEntries(['accountCategoryId', 'subAccountCategoryId', 'taxCategoryId', 'transactionCategoryId', 'customerId', 'supplierId'].map(k => [k, { type: 'string', pattern }]))
const conversationOf = (scope: any) => ({ _id: scope.conversation._id, ownerId: new mongoose.Types.ObjectId(String(scope.ownerId)), organizationId: new mongoose.Types.ObjectId(scope.teaching.organizationId), segment: scope.conversation.segment || 0, turns: scope.conversation.turns, currentId: scope.turnId, conversationKind: scope.kind })
async function teachingWrite(scope: any, name: string, args: any, operation: any) {
  const c = conversationOf(scope), checked = await checkCompanyKnowledgeWrite(c, name, args)
  const knowledgeId = name === 'remember_company_knowledge' ? operation.operationId.slice(0, 24) : args.knowledgeId
  const op = { operationId: operation.operationId, payloadHash: sha(canonicalJson({ name, args })), name, knowledgeId: new mongoose.Types.ObjectId(knowledgeId), turnId: scope.turnId }
  const row = await applyCompanyKnowledgeWrite(c, op, args, checked)
  const requestedFields = Object.keys(args).filter(k => !['knowledgeId', 'expectedRevision'].includes(k))
  return { receipt: { requestedFields, acceptedRevision: row.revision ?? null, nativeResourceIds: { knowledgeId: String(row._id) } }, result: { knowledge: await companyKnowledgeResult(row), company: scope.teaching.name, ledgerChanged: false, meaning: 'company_teaching_evidence_not_an_automatic_ledger_rule' } }
}
const teaching = (name: string, effect: 'read' | 'write', description: string, inputSchema: any, run: any) => ({ name, effect, modes: ['workspace', 'purchase'], targeted: false, needsLine: false, teaching: true, description, inputSchema, run })
export const companyTeachingDefinitions: any[] = [
  teaching('search_company_knowledge', 'read', 'Read teachings members of the company selected when this message was sent explicitly asked OMF to remember, with who/when/which conversation and correction history. Default active only. Company evidence, never an automatic ledger rule.', schema({ query: textFilter, merchant: textFilter, status: { type: 'string', enum: ['active', 'paused', 'all'] }, page: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1 } }),
    async (scope: any, args: any) => ({ ...await listCompanyKnowledge(new mongoose.Types.ObjectId(scope.teaching.organizationId), { ...args, limit: Math.min(args.limit || 20, 50) }), company: scope.teaching.name })),
  teaching('remember_company_knowledge', 'write', 'Only when the CURRENT message asks to remember something for the selected company: save the user\'s exact words (instruction must be a verbatim substring of the current message) with optional merchant/card/effective-date conditions. Shared with that company\'s members; saving never edits a draft, ledger row or owner memory.', schema({ instruction: { type: 'string', minLength: 2, maxLength: 1000 }, merchant: { type: 'string', minLength: 1, maxLength: 100 }, cardLast4: { type: 'string', pattern: '^[0-9]{4}$' }, effectiveFrom: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, ...refs('^[a-fA-F0-9]{24}$') }, ['instruction']),
    (scope: any, args: any, _target: any, operation: any) => teachingWrite(scope, 'remember_company_knowledge', args, operation)),
  teaching('correct_company_knowledge', 'write', 'On an explicit correction in the CURRENT message: replace parts of one company teaching using its current revision (new wording verbatim from the current message). The previous wording stays in its history.', schema({ knowledgeId: oid, expectedRevision: { type: 'integer', minimum: 1 }, instruction: { type: 'string', minLength: 2, maxLength: 1000 }, merchant: { type: 'string', maxLength: 100 }, cardLast4: { type: 'string', pattern: '^([0-9]{4})?$' }, effectiveFrom: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, ...refs('^([a-fA-F0-9]{24})?$') }, ['knowledgeId', 'expectedRevision']),
    (scope: any, args: any, _target: any, operation: any) => teachingWrite(scope, 'correct_company_knowledge', args, operation)),
  teaching('set_company_knowledge_status', 'write', 'On an explicit request in the CURRENT message: pause a company teaching or make a paused one active again, using its current revision.', schema({ knowledgeId: oid, expectedRevision: { type: 'integer', minimum: 1 }, status: { type: 'string', enum: ['active', 'paused'] } }, ['knowledgeId', 'expectedRevision', 'status']),
    (scope: any, args: any, _target: any, operation: any) => teachingWrite(scope, 'set_company_knowledge_status', args, operation))
]
// The claim of a teaching write keeps its authority and row (recovery never reads another company).
export function teachingClaim(name: string, operationId: string, args: any, authority: TeachingCompany | null | undefined) {
  if (!authority || !teachingWrites.includes(name)) return {}
  return { companyKnowledge: { actorId: authority.actorId, organizationId: authority.organizationId }, knowledgeId: name === 'remember_company_knowledge' ? operationId.slice(0, 24) : String(args.knowledgeId) }
}
// Recovery of a lost teaching write: the frozen company's membership is read fresh first; then only that row's marker decides.
export async function teachingOutcome(ownerId: string, op: any): Promise<{ state: 'done' | 'failed' | 'unresolved', receipt: any, recoveryOwner: string | null, safeError: string | null }> {
  const frozen = op.companyKnowledge, requestedFields = Object.keys(op.nativeArgs || {}).filter(k => !['knowledgeId', 'expectedRevision'].includes(k))
  const member = await companyMembership(String(ownerId), String(frozen?.organizationId)).catch((error: any) => { if (error?.statusCode === 403) return null; throw error })
  if (!member || String(frozen?.actorId) !== String(ownerId)) return { state: 'unresolved', receipt: { requestedFields, acceptedRevision: null, nativeResourceIds: null }, recoveryOwner: 'user', safeError: '会社の現在のメンバーであることを確認できないため、記憶の保存結果を確認できません。' }
  const marker: any = await companyKnowledgeMarker(member, new mongoose.Types.ObjectId(String(op.knowledgeId)), op.operationId)
  if (marker && marker.payloadHash === op.payloadHash) return { state: 'done', receipt: { requestedFields, acceptedRevision: null, nativeResourceIds: { knowledgeId: String(op.knowledgeId) } }, recoveryOwner: null, safeError: null }
  return { state: 'failed', receipt: { requestedFields, acceptedRevision: null, nativeResourceIds: null }, recoveryOwner: 'model', safeError: '前回の処理は書き込み前に中断されました。必要なら新しい操作として指示してください。' }
}
export const ownerTeachingTools = () => companyTeachingDefinitions.map(d => ({ name: d.name, description: d.description, inputSchema: d.inputSchema }))
export function assertTeachingAuthority(authority: TeachingCompany | null) { if (!authority) fail(403, NO_TEACHING_AUTHORITY); return authority! }
