// Closed Navi status and exact reply read state (docs/navi-status-read-state.md). GUARD: new access and validation behind the
// existing authenticated finance-chat routes, for three named realms only: the owner workspace (masked for the token-selected
// posting company checked now), the actor's company conversation (fresh membership) and an owned purchase line (the same draft
// source authority every draft read uses). Status is a pure read: it never calls the full getters (no confirmation, research or
// action recovery), writes nothing, renews no heartbeat or lease and returns no reply or report text. Work in progress is reported from
// its own native deadline (naviWorkState), never from a worker heartbeat alone: an expired, exhausted or deadline-less job keeps its raw
// state and is not shown as progress; no lease token or deadline leaves the server. The purchase research follow-up is
// part of it only while a live visible turn of this segment started the current request. A read acknowledgement names one
// conversation segment and the exact delivered versions the client rendered; each must still be the live readable turn (and, for
// research, the current linked report) and is recorded with $max on that turn only. It never touches the conversation revision,
// timestamps, state, leases, actions, the research row or any financial record, and a delayed acknowledgement can neither lower a
// newer seen version nor mark a later reply. No actor, company or purchase is ever taken from the body.
import { FinanceAssistant } from '../models/FinanceAssistant'
import { FinanceCompanyAssistant } from '../models/FinanceCompanyAssistant'
import { FinanceChat, FinanceChatAgent } from '../models/FinanceChat'
import { FinanceResearch } from '../models/FinanceResearch'
import Organization from '../models/Organization'
import { companyMembership } from '../utils/calendarAccess'
import { fail, id } from './financeService'
import { readDraftSourceContext } from './financeDraftService'
import { maskTurns } from './financeOwnerCompanyKnowledgeService'
import type { PostingCompany } from './financeNaviPostingService'
import { naviTurnSummary, naviLinkedResearch, naviReadRequest, naviReadable, naviReplyVersion, naviWorkState } from '../../shared/finance-navi-status.mjs'

// Only what the counts need: turn identity, whether a reply was saved, versions, read records, the company-teaching tag (masking)
// and the research link, plus the native work deadline and claim count (naviWorkState). No text, reply body, context or lease token is
// read for this, and the deadline itself is never returned: only the derived work state.
const STATUS_FIELDS = '_id revision state currentId segment leaseUntil attempts turns.id turns.proposal.kind turns.replyVersion turns.seenReplyVersion turns.seenResearchVersion turns.companyContext turns.research.requestId'
const RESEARCH_FIELDS = '_id requestId reportVersion state report.summary leaseUntil attempts'
const CHANGED = '会話が更新されました。再読込してください。'
const liveChat = () => ({ $gt: new Date(Date.now() - 65000) })
// state stays the raw native state; work says whether its deadline is still ahead (only that is progress), judged at observedAt.
const conversationView = (c: any, now: number) => c ? { id: String(c._id), segment: c.segment || 0, state: String(c.state || 'idle'), work: naviWorkState(String(c.state || 'idle'), c.leaseUntil, c.attempts, now) } : null
const statusOf = (realm: string, scope: any, c: any, turns: any[], connected: boolean, extra: any = {}, now = Date.now()) => ({ realm, scope, observedAt: now, connected, conversation: conversationView(c, now), replies: naviTurnSummary(turns), ...extra })
// The same worker liveness the full getters report: owner and company conversations need a fresh workspace worker of this owner.
const workspaceConnected = async (ownerId: string) => !!await FinanceChatAgent.exists({ ownerId, enabled: true, revokedAt: null, workspaceEnabled: true, chatLastSeenAt: liveChat() })
async function memberCompany(ownerId: string, organizationId: any) {
  const trusted = await companyMembership(String(ownerId), String(organizationId))
  const row: any = await Organization.findOne({ _id: trusted, isActive: true }).select('name').lean()
  if (!row) fail(403, 'Access denied to this organization')
  return { id: String(trusted), name: String(row.name || '').slice(0, 200) }
}
function readRequest(body: any, research = false) {
  try { return naviReadRequest(body, { research }) } catch (error: any) { if (error?.naviRead) fail(400, '既読の記録を確認できません。'); throw error }
}
// The exact match the acknowledgement write must still find: a legacy version 0 is an absent field.
const exactVersion = (version: number) => version === 0 ? { $in: [null, 0] } : version
// A turn shown under the checked selection carries no company-teaching tag or that company's tag (maskTurns); undefined = no masking.
const visibleUnder = (organizationId: string | null | undefined) => organizationId === undefined ? {} : { $or: [{ 'companyContext.organizationId': { $in: [null, ''] } }, ...(organizationId ? [{ 'companyContext.organizationId': organizationId }] : [])] }
async function recordSeen(model: any, identity: any, c: any, turns: any[], request: any, organizationId: string | null | undefined, research: any = null) {
  if (!c || String(c._id) !== request.conversationId || (c.segment || 0) !== request.segment) fail(409, CHANGED)
  const live = new Map(turns.map((t: any) => [String(t.id), t]))
  for (const item of request.replies) { const turn = live.get(item.turnId); if (!naviReadable(turn) || naviReplyVersion(turn) !== item.replyVersion) fail(409, CHANGED) }
  const seen: any = {}, arrayFilters: any[] = [], still: any[] = []
  request.replies.forEach((item: any, i: number) => {
    seen['turns.$[r' + i + '].seenReplyVersion'] = item.replyVersion
    arrayFilters.push({ ['r' + i + '.id']: item.turnId, ['r' + i + '.replyVersion']: exactVersion(item.replyVersion) })
    still.push({ turns: { $elemMatch: { id: item.turnId, replyVersion: exactVersion(item.replyVersion), proposal: { $exists: true }, ...visibleUnder(organizationId) } } })
  })
  if (research) {
    seen['turns.$[q].seenResearchVersion'] = research.reportVersion
    arrayFilters.push({ 'q.id': research.turnId, 'q.research.requestId': research.requestId })
    still.push({ turns: { $elemMatch: { id: research.turnId, 'research.requestId': research.requestId, ...visibleUnder(organizationId) } } })
  }
  // Read state only: no revision, updatedAt, state, lease or action change, so the reader's own acknowledgement never stales a send.
  const changed = await model.updateOne({ ...identity, _id: c._id, segment: c.segment === undefined ? { $in: [null, 0] } : c.segment, $and: still }, { $max: seen }, { arrayFilters, timestamps: false })
  if (!changed.matchedCount) fail(409, CHANGED)
}

export async function workspaceNaviStatus(ownerId: string, posting: PostingCompany | null = null) {
  const checkedCompany = posting?.organizationId || null
  const ownerConversation: any = await FinanceAssistant.findOne({ ownerId }).select(STATUS_FIELDS).lean()
  return statusOf('workspace', { actorId: String(ownerId), organizationId: checkedCompany }, ownerConversation, maskTurns(ownerConversation?.turns || [], checkedCompany), await workspaceConnected(ownerId))
}
export async function workspaceNaviRead(ownerId: string, body: any, posting: PostingCompany | null = null) {
  const request = readRequest(body), checked = posting?.organizationId || null
  const c: any = await FinanceAssistant.findOne({ ownerId }).select(STATUS_FIELDS).lean()
  await recordSeen(FinanceAssistant, { ownerId }, c, maskTurns(c?.turns || [], checked), request, checked)
  return { ...await workspaceNaviStatus(ownerId, posting), acknowledged: { replies: request.replies.length, research: false } }
}
export async function companyNaviStatus(ownerId: string, organizationId: any) {
  const company = await memberCompany(ownerId, organizationId)
  const companyConversation: any = await FinanceCompanyAssistant.findOne({ ownerId, organizationId }).select(STATUS_FIELDS).lean()
  return statusOf('company', { actorId: String(ownerId), organizationId: company.id }, companyConversation, companyConversation?.turns || [], await workspaceConnected(ownerId), { company })
}
export async function companyNaviRead(ownerId: string, organizationId: any, body: any) {
  await memberCompany(ownerId, organizationId)
  const request = readRequest(body), c: any = await FinanceCompanyAssistant.findOne({ ownerId, organizationId }).select(STATUS_FIELDS).lean()
  await recordSeen(FinanceCompanyAssistant, { ownerId, organizationId }, c, c?.turns || [], request, undefined)
  return { ...await companyNaviStatus(ownerId, organizationId), acknowledged: { replies: request.replies.length, research: false } }
}
export async function purchaseNaviStatus(ownerId: string, importId: string, line: number, posting: PostingCompany | null = null) {
  const source: any = await readDraftSourceContext(ownerId, importId, line)
  const checked = posting?.organizationId || null, identity = { ownerId, importId: id(importId), line }
  const [purchaseConversation, research]: any[] = await Promise.all([FinanceChat.findOne(identity).select(STATUS_FIELDS).lean(), FinanceResearch.findOne(identity).select(RESEARCH_FIELDS).lean()])
  const turns = maskTurns(purchaseConversation?.turns || [], checked)
  // The purchase chat's own liveness: a fresh chat heartbeat of a worker holding this purchase's current source account.
  const connected = !!await FinanceChatAgent.exists({ ownerId, accountIds: source.account._id, enabled: true, revokedAt: null, chatLastSeenAt: liveChat() })
  // The linked research job's own deadline decides whether it is still in progress (a fresh chat worker says nothing about it).
  const now = Date.now(), linked = naviLinkedResearch(turns, research)
  return statusOf('purchase', { actorId: String(ownerId), organizationId: checked, importId: String(importId), line }, purchaseConversation, turns, connected, { research: linked && { ...linked, work: naviWorkState(linked.state, research.leaseUntil, research.attempts, now) } }, now)
}
export async function purchaseNaviRead(ownerId: string, importId: string, line: number, body: any, posting: PostingCompany | null = null) {
  await readDraftSourceContext(ownerId, importId, line)
  const request = readRequest(body, true), checked = posting?.organizationId || null, identity = { ownerId, importId: id(importId), line }
  const c: any = await FinanceChat.findOne(identity).select(STATUS_FIELDS).lean(), turns = maskTurns(c?.turns || [], checked)
  let research: any = null
  if (request.research) {
    const row: any = await FinanceResearch.findOne({ ...identity, _id: id(request.research.researchId) }).select(RESEARCH_FIELDS).lean()
    const linked = naviLinkedResearch(turns, row)
    if (!linked?.available || linked.requestId !== request.research.requestId || linked.reportVersion !== request.research.reportVersion || linked.turnId !== request.research.turnId) fail(409, '表示した調査結果が変わりました。再読込してください。')
    research = request.research
  }
  await recordSeen(FinanceChat, identity, c, turns, request, checked, research)
  return { ...await purchaseNaviStatus(ownerId, importId, line, posting), acknowledged: { replies: request.replies.length, research: !!research } }
}
