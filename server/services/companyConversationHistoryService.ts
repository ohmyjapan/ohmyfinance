// Explicit new chat and archived history for the company Navi conversation. The live owner/company conversation (its unique
// index unchanged) keeps one current segment; "new chat" copies that segment, with every receipt, into an immutable archive and
// then empties the live turns in one revision-checked write. Refused while an answer is being prepared or an action is still
// claimed. A lost reset reply is recognised by its request id. Every read rechecks the caller's live company membership.
import { createHash } from 'node:crypto'
import { FinanceCompanyAssistant as Conversation } from '../models/FinanceCompanyAssistant'
import { FinanceCompanyConversationArchive as Archive } from '../models/FinanceCompanyConversationArchive'
import { companyActionReceipt, reconcileCompanyActions } from './financeCompanyActionService'
import { fail, id } from './financeService'

const archiveScope = (ownerId: any, organizationId: any, archiveId: any) => ({ _id: archiveId, ownerId, organizationId })
const busy = (c: any) => ['queued', 'working'].includes(c.state)
const claimedAction = (c: any) => (c.turns || []).some((t: any) => (t.actions || []).some((a: any) => a.state === 'claimed'))
const preview = (text: any) => String(text || '').slice(0, 80)
const turnView = (t: any) => ({ ...t, ...(t.actions ? { actions: t.actions.map(companyActionReceipt) } : {}) })
const listView = (a: any) => ({ id: String(a._id), segment: a.segment, turnCount: a.turnCount, firstAt: a.firstAt, lastAt: a.lastAt, archivedAt: a.createdAt, preview: preview(a.turns?.[0]?.text) })

// ownerId/organizationId come from the authenticated session after the caller's fresh membership check.
export async function startNewCompanyConversation(ownerId: string, organizationId: any, body: any) {
  await Archive.init()
  if (!Number.isSafeInteger(body?.chatRevision) || !/^[-a-zA-Z0-9]{16,64}$/.test(body?.requestId || '')) fail(400, 'Invalid new conversation request')
  const identity = { ownerId, organizationId }
  let c: any = await Conversation.findOne(identity).lean()
  if (!c) return
  if (c.lastReset?.id === body.requestId) return
  c = await reconcileCompanyActions(c)
  if (c.revision !== body.chatRevision) fail(409, 'Conversation changed; reload')
  if (busy(c)) fail(409, '回答を作成中です。完了するか、失敗した場合は「もう一度取得する」の後に新しい会話を始めてください。')
  if (claimedAction(c)) fail(409, '保存処理の結果をまだ確認中です。結果が出てから新しい会話を始めてください。')
  if (!c.turns?.length) return
  const segment = c.segment || 0, turns = c.turns
  const archive = { ownerId: c.ownerId, organizationId: c.organizationId, conversationId: c._id, segment, resetId: body.requestId, fromRevision: c.revision, turns, turnCount: turns.length, firstAt: turns[0]?.at || null, lastAt: turns.at(-1)?.answeredAt || turns.at(-1)?.at || null, archivedBy: c.ownerId }
  let archived: any
  try { archived = (await Archive.create(archive)).toObject() } catch (e: any) {
    if (e?.code !== 11000) throw e
    const existing: any = await Archive.findOne({ conversationId: c._id, segment }).lean()
    // Same request retried after a crash between the two writes: reuse its copy. Another un-adopted copy of this still-live
    // segment (its reset never completed) is replaced; the live turns are its originals, so nothing is lost.
    if (existing?.resetId === body.requestId && existing.fromRevision === c.revision) archived = existing
    else if (existing) { await Archive.deleteOne({ _id: existing._id, resetId: existing.resetId, segment }); archived = (await Archive.create(archive)).toObject() }
    else throw e
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(turns.map((t: any) => [t.id, (t.actions || []).map((a: any) => [a.operationId, a.state])]))).digest('hex')
  const changed = await Conversation.updateOne({ ...identity, _id: c._id, revision: c.revision, segment: c.segment === undefined ? { $in: [null, 0] } : segment, state: { $nin: ['queued', 'working'] }, 'turns.actions.state': { $ne: 'claimed' } },
    { $set: { turns: [], state: 'idle', segment: segment + 1, lastReset: { id: body.requestId, archiveId: archived._id, segment, at: new Date(), fingerprint } }, $inc: { revision: 1 }, $unset: { currentId: '', context: '', lease: '', leaseUntil: '' } })
  if (!changed.matchedCount) {
    const fresh: any = await Conversation.findOne(identity).lean()
    if (fresh?.lastReset?.id === body.requestId) return
    fail(409, 'Conversation changed; reload')
  }
}
export async function listCompanyConversationArchives(ownerId: string, organizationId: any, query: any = {}) {
  await Archive.init()
  const c: any = await Conversation.findOne({ ownerId, organizationId }).select('_id segment').lean()
  const page = Math.max(1, Math.min(1000, Number(query.page) || 1)), limit = 20
  if (!c) return { archives: [], page, hasMore: false }
  // Only segments the live conversation has moved past are archived; an un-adopted copy is never listed.
  const rows: any[] = await Archive.find({ ownerId, organizationId, conversationId: c._id, segment: { $lt: c.segment || 0 } }).select({ turns: { $slice: 1 }, segment: 1, turnCount: 1, firstAt: 1, lastAt: 1, createdAt: 1 }).sort({ segment: -1 }).skip((page - 1) * limit).limit(limit + 1).lean()
  return { archives: rows.slice(0, limit).map(listView), page, hasMore: rows.length > limit }
}
export async function getCompanyConversationArchive(ownerId: string, organizationId: any, archiveId: string) {
  await Archive.init()
  const a: any = await Archive.findOne(archiveScope(ownerId, organizationId, id(archiveId))).lean()
  const live: any = a ? await Conversation.findOne({ _id: a.conversationId }).select('segment').lean() : null
  if (!a || !live || a.segment >= (live.segment || 0)) fail(404, 'Archived conversation not found')
  return { archive: { id: String(a._id), segment: a.segment, turnCount: a.turnCount, firstAt: a.firstAt, lastAt: a.lastAt, archivedAt: a.createdAt, turns: a.turns.map(turnView) } }
}
