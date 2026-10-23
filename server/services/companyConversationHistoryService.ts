// Explicit new chat and archived history for the company Navi conversation. The live owner/company conversation (its unique
// index unchanged) keeps one current segment; "new chat" copies that segment, with every receipt, into an immutable archive and
// then empties the live turns in one revision-checked write. Refused while an answer is being prepared or an action is still
// claimed. A lost reset reply is recognised by its request id. Every read rechecks the caller's live company membership.
// A request id accepted in this conversation stays recognisable after New chat (findCompanyReceivedRequest, shared with the send), and
// a New chat may name the client's uncertain earlier send (docs/navi-selected-records.md): the answer for exactly that request is
// "accepted" with its actual turn and receipts, or "not accepted" only after this same reset advanced the conversation revision (also
// for an empty or absent conversation), so no earlier attempt of it can be queued afterwards. Nothing is cancelled, guessed or resent.
import { createHash } from 'node:crypto'
import { FinanceCompanyAssistant as Conversation } from '../models/FinanceCompanyAssistant'
import { FinanceCompanyConversationArchive as Archive } from '../models/FinanceCompanyConversationArchive'
import { companyActionReceipt, reconcileCompanyActions } from './financeCompanyActionService'
import { turnPublicSources } from './companyPublicResearchService'
import { fail, id } from './financeService'

const archiveScope = (ownerId: any, organizationId: any, archiveId: any) => ({ _id: archiveId, ownerId, organizationId })
const busy = (c: any) => ['queued', 'working'].includes(c.state)
const claimedAction = (c: any) => (c.turns || []).some((t: any) => (t.actions || []).some((a: any) => a.state === 'claimed'))
const preview = (text: any) => String(text || '').slice(0, 80)
const turnView = (t: any) => ({ ...t, ...(t.actions ? { actions: t.actions.map(companyActionReceipt) } : {}) })
const listView = (a: any) => ({ id: String(a._id), segment: a.segment, turnCount: a.turnCount, firstAt: a.firstAt, lastAt: a.lastAt, archivedAt: a.createdAt, preview: preview(a.turns?.[0]?.text) })
const busyRefusal = '回答を作成中です。完了するか、失敗した場合は「もう一度取得する」の後に新しい会話を始めてください。'
const claimedRefusal = '保存処理の結果をまだ確認中です。結果が出てから新しい会話を始めてください。'
// The answer about one request, scoped to the actor/company it was read for: accepted with its actual turn and receipts (live, or in an
// adopted archive with that reference), or not accepted. The request hash stays here; a different meaning is the caller's 409.
const requestAnswerScope = (ownerId: any, organizationId: any) => ({ actorId: String(ownerId), organizationId: String(organizationId) })
const notAcceptedAnswer = (ownerId: any, organizationId: any, requestId: string) => ({ requestId, outcome: 'not_accepted', scope: requestAnswerScope(ownerId, organizationId) })
const receivedTurnView = (t: any) => ({ id: t.id, text: t.text, at: t.at || null, answeredAt: t.answeredAt || null, replyState: t.proposal ? 'answered' : t.answeredAt ? 'failed' : 'not_answered', actions: (t.actions || []).map(companyActionReceipt) })
const receivedArchiveLimit = 10
// A repeated reset id must carry the meaning it was first sent with: no uncertain request, or the same request id and hash.
const sameResetMeaning = (saved: any, meaning: any) => (saved?.pending?.requestId ?? null) === (meaning?.requestId ?? null) && (saved?.pending?.requestHash ?? null) === (meaning?.requestHash ?? null)
// The conversation exactly as a reset read it: same row, revision and segment, not answering, no action still claimed.
const resetFenceFilter = (c: any) => ({ ownerId: c.ownerId, organizationId: c.organizationId, _id: c._id, revision: c.revision, segment: c.segment === undefined ? { $in: [null, 0] } : c.segment, state: { $nin: ['queued', 'working'] }, 'turns.actions.state': { $ne: 'claimed' } })

// One request id's evidence in this actor/company conversation, shared by the send and New chat. ownerId/organizationId come from the
// authenticated caller after its fresh membership check; `live` is the conversation row that caller just read, so the live turns and
// the adopted archives come from one snapshot. The live turn first; otherwise every ADOPTED archive of this conversation (a segment the
// live row has moved past) holding the id, newest first and bounded: an unadopted reset copy and another actor's, company's or
// conversation's archive are never read. A request accepted more than once before this check existed is reported with its count,
// never collapsed into one. Returns null (no evidence) or { requestHash, answer }.
export async function findCompanyReceivedRequest(ownerId: string, organizationId: any, requestId: string, live?: any) {
  await Archive.init()
  const c: any = live === undefined ? await Conversation.findOne({ ownerId, organizationId }).lean() : live
  if (!c || typeof requestId !== 'string' || !requestId) return null
  const scope = requestAnswerScope(ownerId, organizationId), turn = (c.turns || []).find((t: any) => t.id === requestId)
  if (turn) return { requestHash: turn.requestHash, answer: { requestId, outcome: 'accepted', where: 'live', scope, turn: receivedTurnView(turn) } }
  const rows: any[] = await Archive.find({ ownerId, organizationId, conversationId: c._id, segment: { $lt: c.segment || 0 }, 'turns.id': requestId }).select({ segment: 1, turnCount: 1, firstAt: 1, lastAt: 1, createdAt: 1, turns: { $elemMatch: { id: requestId } } }).sort({ segment: -1 }).limit(receivedArchiveLimit + 1).lean()
  const a = rows[0], t = a?.turns?.[0]
  if (!t) return null
  return { requestHash: t.requestHash, answer: { requestId, outcome: 'accepted', where: 'archive', scope, archive: { id: String(a._id), segment: a.segment, turnCount: a.turnCount, firstAt: a.firstAt, lastAt: a.lastAt, archivedAt: a.createdAt }, turn: receivedTurnView(t), occurrences: Math.min(rows.length, receivedArchiveLimit), occurrencesTruncated: rows.length > receivedArchiveLimit } }
}

// A reset whose write lost a race. Another request with this same reset id wrote after this one read the conversation (its archive or
// fence covers every attempt the client made before sending this one): answer as that write left the conversation. Anything else
// changed it: refused, and the uncertain request stays uncertain.
async function answerConcurrentReset(ownerId: string, organizationId: any, body: any, meaning: any) {
  const fresh: any = await Conversation.findOne({ ownerId, organizationId }).lean()
  if (fresh?.lastReset?.id !== body.requestId) fail(409, 'Conversation changed; reload')
  if (!sameResetMeaning(fresh.lastReset, meaning)) fail(409, 'Request id has another meaning')
  if (!meaning) return
  const found: any = await findCompanyReceivedRequest(ownerId, organizationId, meaning.requestId, fresh)
  if (found && found.requestHash !== meaning.requestHash) fail(409, 'Request id has another meaning')
  return found ? found.answer : notAcceptedAnswer(ownerId, organizationId, meaning.requestId)
}
// A repeated reset id (its reply was lost): nothing is archived again. Accepted evidence is answered as the history holds it now.
// Otherwise the conversation is fenced again before "not accepted" is answered, because while that reply was missing the client may
// have sent the same request again with the revision the first fence produced. Busy, claimed or changed conversations refuse.
async function answerRepeatedReset(ownerId: string, organizationId: any, body: any, meaning: any, c: any) {
  const found: any = await findCompanyReceivedRequest(ownerId, organizationId, meaning.requestId, c)
  if (found) { if (found.requestHash !== meaning.requestHash) fail(409, 'Request id has another meaning'); return found.answer }
  if (busy(c)) fail(409, busyRefusal)
  if (claimedAction(c)) fail(409, claimedRefusal)
  const fenced = await Conversation.updateOne({ ...resetFenceFilter(c), 'lastReset.id': body.requestId }, { $set: { 'lastReset.at': new Date(), 'lastReset.outcome': 'not_accepted', 'lastReset.revision': c.revision + 1 }, $inc: { revision: 1 } })
  if (!fenced.matchedCount) {
    const fresh: any = await Conversation.findOne({ ownerId, organizationId }).lean()
    const now: any = fresh ? await findCompanyReceivedRequest(ownerId, organizationId, meaning.requestId, fresh) : null
    if (now && now.requestHash === meaning.requestHash) return now.answer
    fail(409, 'Conversation changed; reload')
  }
  return notAcceptedAnswer(ownerId, organizationId, meaning.requestId)
}

// ownerId/organizationId come from the authenticated session after the caller's fresh membership check. `pending` (optional) is the
// client's uncertain earlier send, normalised by that caller with the send's own text, selection and hash rules into
// { requestId, requestHash }: context for this reset's answer, never authority. Without it this is the ordinary New chat (an empty or
// absent conversation stays a no-op) and nothing is returned; with it the answer for exactly that request is returned.
export async function startNewCompanyConversation(ownerId: string, organizationId: any, body: any, pending: any = null) {
  await Archive.init()
  if (!Number.isSafeInteger(body?.chatRevision) || !/^[-a-zA-Z0-9]{16,64}$/.test(body?.requestId || '')) fail(400, 'Invalid new conversation request')
  const identity = { ownerId, organizationId }, meaning = pending ? { requestId: pending.requestId, requestHash: pending.requestHash } : null
  let c: any = await Conversation.findOne(identity).lean()
  if (!c) {
    if (!meaning) return
    // Nothing was ever accepted here. The fence is the conversation row itself, created at revision 1 with this reset: an attempt of any
    // earlier request carries revision 0 and is refused, and a first send stored concurrently makes this creation fail instead.
    if (body.chatRevision !== 0) fail(409, 'Conversation changed; reload')
    try { await Conversation.create({ ...identity, revision: 1, lastReset: { id: body.requestId, at: new Date(), pending: meaning, outcome: 'not_accepted', revision: 1 } }) } catch (e: any) { if (e?.code === 11000) fail(409, 'Conversation changed; reload'); throw e }
    return notAcceptedAnswer(ownerId, organizationId, meaning.requestId)
  }
  if (c.lastReset?.id === body.requestId) {
    // A lost reset reply: the same reset id is recognised (never archived twice), and only with the meaning it was first sent with.
    if (!sameResetMeaning(c.lastReset, meaning)) fail(409, 'Request id has another meaning')
    if (!meaning) return
    return answerRepeatedReset(ownerId, organizationId, body, meaning, await reconcileCompanyActions(c))
  }
  c = await reconcileCompanyActions(c)
  if (c.revision !== body.chatRevision) fail(409, 'Conversation changed; reload')
  if (busy(c)) fail(409, busyRefusal)
  if (claimedAction(c)) fail(409, claimedRefusal)
  const found: any = meaning ? await findCompanyReceivedRequest(ownerId, organizationId, meaning.requestId, c) : null
  if (found && found.requestHash !== meaning?.requestHash) fail(409, 'Request id has another meaning')
  if (!c.turns?.length) {
    if (!meaning) return
    // An empty live segment: no archive (no history noise). The fence advances the revision and records this reset with its meaning.
    const fenced = await Conversation.updateOne(resetFenceFilter(c), { $set: { lastReset: { id: body.requestId, at: new Date(), pending: meaning, outcome: found ? 'accepted' : 'not_accepted', revision: c.revision + 1 } }, $inc: { revision: 1 } })
    if (!fenced.matchedCount) return answerConcurrentReset(ownerId, organizationId, body, meaning)
    return found ? found.answer : notAcceptedAnswer(ownerId, organizationId, meaning.requestId)
  }
  const segment = c.segment || 0, turns = c.turns
  const archive = { ownerId: c.ownerId, organizationId: c.organizationId, conversationId: c._id, segment, resetId: body.requestId, fromRevision: c.revision, turns, turnCount: turns.length, firstAt: turns[0]?.at || null, lastAt: turns.at(-1)?.answeredAt || turns.at(-1)?.at || null, archivedBy: c.ownerId }
  let archived: any
  try { archived = (await Archive.create(archive)).toObject() } catch (e: any) {
    if (e?.code !== 11000) throw e
    const existing: any = await Archive.findOne({ conversationId: c._id, segment }).lean()
    // Concurrent reset requests for the same revision share one copy. Never delete it: another request can already have
    // adopted that archive. A stale, still-unadopted revision is replaced atomically, retaining the id. A reset of its old
    // live revision cannot win the conversation CAS below after the live data has advanced to this revision.
    if (existing?.fromRevision === c.revision) archived = existing
    else if (existing && existing.fromRevision < c.revision) {
      const candidate = new Archive({ ...archive, _id: existing._id, createdAt: existing.createdAt })
      await candidate.validate()
      await Archive.collection.replaceOne({ _id: existing._id, ownerId: c.ownerId, organizationId: c.organizationId, conversationId: c._id, segment, fromRevision: existing.fromRevision }, candidate.toObject({ virtuals: false }))
      archived = await Archive.findById(existing._id).lean()
      if (!archived || archived.fromRevision !== c.revision) fail(409, 'Conversation changed; reload')
    } else fail(409, 'Conversation changed; reload')
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(turns.map((t: any) => [t.id, (t.actions || []).map((a: any) => [a.operationId, a.state])]))).digest('hex')
  const changed = await Conversation.updateOne({ ...identity, _id: c._id, revision: c.revision, segment: c.segment === undefined ? { $in: [null, 0] } : segment, state: { $nin: ['queued', 'working'] }, 'turns.actions.state': { $ne: 'claimed' } },
    { $set: { turns: [], state: 'idle', segment: segment + 1, lastReset: { id: body.requestId, archiveId: archived._id, segment, at: new Date(), fingerprint, ...(meaning ? { pending: meaning, outcome: found ? 'accepted' : 'not_accepted' } : {}) } }, $inc: { revision: 1 }, $unset: { currentId: '', context: '', lease: '', leaseUntil: '' } })
  if (!changed.matchedCount) return answerConcurrentReset(ownerId, organizationId, body, meaning)
  if (!meaning) return
  if (!found) return notAcceptedAnswer(ownerId, organizationId, meaning.requestId)
  // Accepted: its turn is now in the archive this reset adopted (or in an older one). Answer from the history as it is now.
  const archivedNow: any = await findCompanyReceivedRequest(ownerId, organizationId, meaning.requestId)
  return archivedNow && archivedNow.requestHash === meaning.requestHash ? archivedNow.answer : found.answer
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
  // Public source cards of the archived segment (metadata only; bodies stay in their own owner/company collection), including
  // those of a turn whose reply failed. Citations already travel with each turn's stored reply.
  const sources = await turnPublicSources(a.ownerId, a.organizationId, a.conversationId, a.segment)
  return { archive: { id: String(a._id), segment: a.segment, turnCount: a.turnCount, firstAt: a.firstAt, lastAt: a.lastAt, archivedAt: a.createdAt, turns: a.turns.map((t: any) => ({ ...turnView(t), ...(sources.get(t.id)?.length ? { sources: sources.get(t.id) } : {}) })) } }
}
