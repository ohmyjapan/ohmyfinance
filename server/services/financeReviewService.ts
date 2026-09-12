import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { getHeader, type H3Event } from 'h3'
import { FinanceReview, FinanceReviewAgent, FinanceHistory } from '../models/FinanceReview'
import { FinancialAccount } from '../models/Finance'
import { FinanceDraft } from '../models/FinanceDraft'
import { learningEvidence, customerContextEvidence } from './financeLearningService'
import User from '../models/User'
import { ready, fail, id, ownedImport } from './financeService'
import { readDraft, saveDraft } from './financeDraftService'
import { normalizeMerchant, validateValues } from '../../shared/finance-draft.mjs'
import { studyPurchase, validateReplyProposal, replyCommand, confirmationText } from '../../shared/finance-review.mjs'

const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const active = ['queued', 'sending', 'awaiting_reply', 'proposed', 'delivery_unknown']
export async function reviewAgent(event: H3Event) {
  const token = (getHeader(event, 'authorization') || '').replace(/^Bearer /, '')
  if (!/^omfr_[a-f\d]{64}$/.test(token)) fail(401, 'Review worker authorization required')
  await ready()
  const agent: any = await FinanceReviewAgent.findOne({ tokenHash: hash(token), enabled: true, revokedAt: null }).lean()
  if (!agent || !await User.exists({ _id: agent.ownerId })) fail(401, 'Review worker unavailable')
  await FinanceReviewAgent.updateOne({ _id: agent._id }, { $set: { lastSeenAt: new Date() } })
  return agent
}
export async function createReviewAgent(ownerId: string, body: any) {
  if (!/^T[A-Z0-9]{5,}$/.test(body?.teamId || '') || !/^U[A-Z0-9]{5,}$/.test(body?.userId || '') || !/^D[A-Z0-9]{5,}$/.test(body?.channelId || '')) fail(400, 'Verified Slack DM identifiers required')
  if (!Array.isArray(body.accountIds) || !body.accountIds.length || body.accountIds.length > 30) fail(400, 'Choose accounts')
  const accountIds = [...new Set(body.accountIds.map(id))]
  if (await FinancialAccount.countDocuments({ ownerId, _id: { $in: accountIds }, active: true }) !== accountIds.length) fail(400, 'Unknown account')
  const token = 'omfr_' + randomBytes(32).toString('hex')
  const agent = await FinanceReviewAgent.create({ ownerId, accountIds, teamId: body.teamId, userId: body.userId, channelId: body.channelId, tokenHash: hash(token), enabled: true })
  return { id: agent._id.toString(), token }
}
export async function reviewContext(ownerId: string, importId: string, line: number) {
  const draft = await readDraft(ownerId, importId, line)
  const accountId = draft.source.account.id, merchant = normalizeMerchant(draft.source.description)
  const learning = await learningEvidence(ownerId, accountId, merchant, draft.source.purchaseDate, draft.source.amount)
  const history = learning?.history ?? await FinanceHistory.find({ ownerId, accountId, merchant, date: { $lt: draft.source.purchaseDate } }).sort({ date: -1 }).limit(1000).lean()
  const candidates = await FinanceReview.find({ ownerId, accountId, status: 'resolved', 'memory.merchant': merchant, 'context.source.purchaseDate': { $lt: draft.source.purchaseDate } }).select('memory context.source importId line proposal').sort({ resolvedAt: -1 }).limit(200).lean()
  const saved = candidates.length ? await FinanceDraft.find({ ownerId, $or: candidates.map(c => ({ importId: c.importId, line: c.line })) }).select('importId line values').lean() : []
  // A subsequent web correction withdraws the older Slack observation from future proposals.
  const observations = candidates.filter(c => saved.some(d => d.importId.toString() === c.importId.toString() && d.line === c.line && Object.entries(c.proposal.patch).every(([key, value]) => d.values[key] === value)))
  const countable = observations.filter(c => (c.context.source.source?.rows?.length || 0) <= 1)
  const superseded = new Set(countable.flatMap(m => (m.context.source.source?.rows || []).map((r: number) => `${m.context.source.source.sheet}:${r}`)))
  const studiedHistory: any[] = history.filter(h => !superseded.has(`${h.sheet}:${h.row}`))
  for (const observation of countable) studiedHistory.push({ merchant, date: observation.context.source.purchaseDate, amount: observation.context.source.amount, purpose: observation.memory.purpose, customerId: observation.memory.customerId, customerLabel: draft.references.customers.find((c: any) => c._id.toString() === observation.memory.customerId)?.name || '', confirmed: true })
  const memories = observations.filter(m => m.memory.reusable && m.memory.purpose === draft.values.purpose && m.memory.customerId === draft.values.customerId)
  const batch = await ownedImport(ownerId, importId)
  const targetDate = Date.parse(draft.source.purchaseDate)
  const nearby = batch.rows.filter((r: any) => r.kind === 'expense' && r.line !== line && Math.abs(Date.parse(r.purchaseDate) - targetDate) <= 2 * 86400000).slice(0, 5).map((r: any) => ({ description: r.description, amount: r.amount, date: r.purchaseDate, line: r.line }))
  const study: any = studyPurchase(draft, studiedHistory, memories.map(m => m.memory), nearby)
  if (learning) study.learning = { datasetId: learning.datasetId, rules: learning.rules }
  study.customerPurchaseContexts = draft.values.purpose === 'customer' && draft.values.customerId ? await customerContextEvidence(ownerId,draft.values.customerId) : []
  const customers = draft.references.customers.map((c: any) => ({ id: c._id.toString(), name: c.name }))
  return { draft, study, customers }
}
export async function getReview(ownerId: string, importId: string, line: number) {
  const { draft, study } = await reviewContext(ownerId, importId, line)
  const review = await FinanceReview.findOne({ ownerId, importId, line }).select('-lock -lockUntil').lean()
  const agent = await FinanceReviewAgent.findOne({ ownerId, accountIds: draft.source.account.id, enabled: true, revokedAt: null }).select('lastSeenAt').lean()
  return { study, review, connected: !!agent, lastSeenAt: agent?.lastSeenAt || null }
}
export async function queueReview(ownerId: string, importId: string, line: number, body: any) {
  const { draft, study, customers } = await reviewContext(ownerId, importId, line)
  if (draft.locked || draft.source.kind !== 'expense') fail(409, 'This transaction cannot be reviewed')
  if (!study.needsQuestion) fail(409, 'Purchase details are already answered; no question is needed')
  if (body?.revision !== draft.revision || body?.key !== draft.key || body?.sourceHash !== draft.sourceHash) fail(409, 'Save and reload the latest draft first')
  const agent = await FinanceReviewAgent.findOne({ ownerId, accountIds: draft.source.account.id, enabled: true, revokedAt: null }).lean()
  if (!agent) fail(409, 'Slack review worker is not connected')
  const queueLock = randomUUID()
  const locked = await FinanceReviewAgent.findOneAndUpdate({ _id: agent._id, $or: [{ queueLockUntil: null }, { queueLockUntil: { $lt: new Date() } }] }, { $set: { queueLock, queueLockUntil: new Date(Date.now() + 30000) } })
  if (!locked) fail(409, 'Another question is being queued; retry shortly')
  try {
    const existing = await FinanceReview.findOne({ ownerId, importId, line }).lean()
    if (existing) return { review: existing }
    if (await FinanceReview.countDocuments({ ownerId, status: { $in: active } }) >= 3) fail(409, 'Finish or defer the three pending questions first')
    const review = await FinanceReview.create({ ownerId, accountId: draft.source.account.id, importId, line, key: draft.key, sourceHash: draft.sourceHash, revision: draft.revision, agentId: agent._id,
      context: { source: draft.source, values: draft.values, customers, study }, status: 'queued', channelId: agent.channelId })
    return { review }
  } finally { await FinanceReviewAgent.updateOne({ _id: agent._id, queueLock }, { $unset: { queueLock: '', queueLockUntil: '' } }) }
}
export async function workerJobs(agent: any) {
  const jobs = await FinanceReview.find({ agentId: agent._id, ownerId: agent.ownerId, accountId: { $in: agent.accountIds }, status: { $in: active } }).sort({ createdAt: 1 }).limit(10).select('-lock -lockUntil').lean()
  return { teamId: agent.teamId, userId: agent.userId, channelId: agent.channelId, jobs }
}
const scope = (agent: any, reviewId: string) => ({ _id: id(reviewId), ownerId: agent.ownerId, agentId: agent._id, accountId: { $in: agent.accountIds } })
export async function claimQuestion(agent: any, reviewId: string) {
  const queued = await FinanceReview.findOne({ ...scope(agent, reviewId), status: 'queued' }).lean()
  if (!queued) fail(409, 'Question has already been claimed')
  const current = await readDraft(agent.ownerId.toString(), queued.importId.toString(), queued.line)
  if (current.locked || current.revision !== queued.revision || current.key !== queued.key || current.sourceHash !== queued.sourceHash) {
    await FinanceReview.updateOne({ ...scope(agent, reviewId), status: 'queued' }, { $set: { status: 'conflict' } })
    fail(409, 'The draft changed before the question was sent')
  }
  const refreshed = await reviewContext(agent.ownerId.toString(), queued.importId.toString(), queued.line)
  if (!refreshed.study.needsQuestion) {
    await FinanceReview.updateOne({ ...scope(agent, reviewId), status: 'queued' }, { $set: { status: 'deferred' } })
    fail(409, 'The question has already been answered')
  }
  const review = await FinanceReview.findOneAndUpdate({ ...scope(agent, reviewId), status: 'queued' }, { $set: { status: 'sending', sendId: randomUUID(), context: { source: refreshed.draft.source, values: refreshed.draft.values, customers: refreshed.customers, study: refreshed.study } } }, { new: true }).lean()
  if (!review) fail(409, 'Question has already been claimed')
  return { review }
}
export async function questionSent(agent: any, reviewId: string, body: any) {
  if (body?.channelId !== agent.channelId || !/^\d{10,}\.\d{6}$/.test(body?.threadTs || '') || typeof body?.sendId !== 'string') fail(400, 'Invalid Slack delivery')
  const match = { ...scope(agent, reviewId), sendId: body.sendId }
  const previous = await FinanceReview.findOne(match).lean()
  if (previous?.threadTs === body.threadTs) return { success: true }
  const review = await FinanceReview.findOneAndUpdate({ ...match, status: 'sending' }, { $set: { threadTs: body.threadTs, channelId: body.channelId, sentAt: new Date(), status: 'awaiting_reply' } })
  if (!review) fail(409, 'Question delivery changed')
  return { success: true }
}
export async function receiveReviewReply(agent: any, reviewId: string, body: any) {
  if (body?.userId !== agent.userId || body?.channelId !== agent.channelId || !/^\d{10,}\.\d{6}$/.test(body?.ts || '') || typeof body?.text !== 'string' || !body.text.trim() || body.text.length > 4000) fail(400, 'Invalid reviewer reply')
  const lock = randomUUID(), filter = scope(agent, reviewId)
  const review = await FinanceReview.findOneAndUpdate({ ...filter, $or: [{ lockUntil: null }, { lockUntil: { $lt: new Date() } }] }, { $set: { lock, lockUntil: new Date(Date.now() + 90000) } }, { new: true }).lean()
  if (!review) fail(409, 'Another reply is being processed')
  try {
    if (body.threadTs !== review.threadTs || !review.threadTs) fail(400, 'Reply belongs to another thread')
    const previous = review.replies.find((r: any) => r.ts === body.ts)
    if (previous) return { result: previous, status: review.status }
    if (body.ts <= (review.replies.at(-1)?.ts || review.threadTs)) fail(409, 'Out-of-order reply')
    if (!['awaiting_reply', 'proposed'].includes(review.status)) fail(409, 'Review is closed')
    if (review.replies.length >= 40) fail(409, 'Review conversation limit reached')
    const command = replyCommand(body.text), at = new Date()
    const reply: any = { ts: body.ts, userId: body.userId, text: body.text, at }
    const set: any = {}, current = await readDraft(agent.ownerId.toString(), review.importId.toString(), review.line)
    const applied = current.history.find((h: any) => h.reviewId === reviewId && h.replyTs === body.ts)
    if ((current.revision !== review.revision || current.key !== review.key || current.sourceHash !== review.sourceHash || current.locked) && !applied) {
      set.status = 'conflict'; reply.response = 'OMF에서 초안이 변경되어 이 답변은 자동 반영하지 않았어요. 웹에서 최신 내용과 답변을 함께 확인해 주세요.'
    } else if (command === 'defer') {
      set.status = 'deferred'; reply.response = '보류해 둘게요. 답변은 보관하며 초안은 변경하지 않습니다.'
    } else if ((command === 'once' || command === 'pattern') && review.status === 'proposed') {
      if (!review.replies.some((r: any) => r.ts === review.proposal.ts && r.delivery === 'sent')) fail(409, 'Deliver the proposed changes before accepting confirmation')
      const result = await saveDraft(agent.ownerId.toString(), review.importId.toString(), review.line,
        { revision: review.revision, key: review.key, sourceHash: review.sourceHash, values: { ...review.context.values, ...review.proposal.patch }, remember: [], confirm: false },
        { reviewId, replyTs: body.ts, text: review.proposal.text, summary: review.proposal.summary, fields: Object.keys(review.proposal.patch), reusable: command === 'pattern' })
      set.status = 'resolved'; set.resolvedAt = at; set.appliedRevision = result.revision
      set.memory = { merchant: review.context.study.merchant, purpose: result.values.purpose, customerId: result.values.customerId, summary: review.proposal.summary, reusable: command === 'pattern', at }
      reply.response = `초안에 반영했어요. ${command === 'pattern' ? '같은 계정·이용처·용도·고객의 다음 판단에 참고하겠습니다.' : '이번 결제에만 적용했습니다.'} 勘定科目・税区分과 장부 등록은 OMF에서 확인해 주세요.`
    } else if (command) {
      reply.response = '아직 반영할 내용이 정해지지 않았어요. 무엇을 구매했고 누구를 위한 것이었는지 알려주세요.'
    } else {
      let proposal: any
      try { proposal = validateReplyProposal(body.interpretation, review.context.customers, body.text) } catch { fail(400, 'Reply interpretation needs valid supporting quotes') }
      if (proposal.kind === 'defer') { set.status = 'deferred'; reply.response = '보류해 둘게요. 초안은 변경하지 않았습니다.' }
      else if (proposal.kind === 'unclear') { set.status = 'awaiting_reply'; set.proposal = null; reply.response = '용도를 아직 확정하기 어려워요. 회사 사용인지 고객 구매인지, 고객 구매라면 어느 고객인지 조금 더 알려주세요. 모르면 ‘보류’라고 답해 주세요.' }
      else {
        const combined = { ...(review.proposal?.patch || {}), ...proposal.patch }
        if (combined.purpose && combined.purpose !== 'customer') combined.customerId = ''
        const next = { ...review.context.values, ...combined }
        try { validateValues(next) } catch { fail(400, 'Reply fields conflict; clarify the purchase purpose and customer together') }
        set.proposal = { ...proposal, patch: combined, text: [review.proposal?.text, body.text].filter(Boolean).join('\n').slice(-8000), ts: body.ts }
        if (next.purpose === 'customer' && !next.customerId) { set.status = 'awaiting_reply'; reply.response = '고객 구매로 이해했어요. 어느 고객의 구매였나요? 고객 ID와 구매 내용을 함께 알려주세요.' }
        else { set.status = 'proposed'; reply.response = confirmationText(set.proposal, review.context.customers) }
      }
    }
    reply.delivery = 'pending'
    await FinanceReview.updateOne({ ...filter, lock }, { $set: set, $push: { replies: reply } })
    return { result: reply, status: set.status || review.status }
  } finally { await FinanceReview.updateOne({ ...filter, lock }, { $unset: { lock: '', lockUntil: '' } }) }
}
export async function workerOutbox(agent: any) {
  const reviews = await FinanceReview.find({ ownerId: agent.ownerId, agentId: agent._id, accountId: { $in: agent.accountIds }, 'replies.delivery': 'pending' }).lean()
  return { messages: reviews.flatMap(r => r.replies.filter((m: any) => m.delivery === 'pending').map((m: any) => ({ reviewId: r._id.toString(), channelId: r.channelId, threadTs: r.threadTs, replyTs: m.ts, text: m.response }))).slice(0, 20) }
}
export async function deliveryUpdate(agent: any, reviewId: string, body: any) {
  if (!['claim', 'sent'].includes(body?.action) || typeof body.replyTs !== 'string') fail(400, 'Invalid delivery state')
  const from = body.action === 'claim' ? 'pending' : 'sending', to = body.action === 'claim' ? 'sending' : 'sent'
  const result = await FinanceReview.updateOne({ ...scope(agent, reviewId), replies: { $elemMatch: { ts: body.replyTs, delivery: from } } }, { $set: { 'replies.$.delivery': to } })
  if (!result.matchedCount) fail(409, 'Reply delivery already claimed')
  return { success: true }
}
