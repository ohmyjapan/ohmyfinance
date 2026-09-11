import { defineEventHandler, setHeader } from 'h3'
import { financeUser, fail } from '../../services/financeService'
import { boundedBody } from '../../services/financeDraftService'
import { FinanceReviewAgent } from '../../models/FinanceReview'
import { reviewAgent, createReviewAgent, getReview, queueReview, workerJobs, claimQuestion, questionSent, receiveReviewReply, workerOutbox, deliveryUpdate } from '../../services/financeReviewService'

export default defineEventHandler(async event => {
  const parts = (event.path.split('?')[0].split('/api/finance-review/')[1] || '').split('/').filter(Boolean)
  setHeader(event, 'Cache-Control', 'no-store')
  try {
    const body = async () => { try { return JSON.parse((await boundedBody(event, 20000)).toString('utf8')) } catch (e: any) { if (e.statusCode) throw e; fail(400, 'Invalid review JSON') } }
    if (parts[0] === 'worker') {
      const agent = await reviewAgent(event)
      if (event.method === 'GET' && parts.length === 2 && parts[1] === 'jobs') return await workerJobs(agent)
      if (event.method === 'GET' && parts.length === 2 && parts[1] === 'outbox') return await workerOutbox(agent)
      if (event.method === 'POST' && parts.length === 3) {
        if (parts[2] === 'claim') return await claimQuestion(agent, parts[1])
        if (parts[2] === 'sent') return await questionSent(agent, parts[1], await body())
        if (parts[2] === 'reply') return await receiveReviewReply(agent, parts[1], await body())
        if (parts[2] === 'delivery') return await deliveryUpdate(agent, parts[1], await body())
      }
      fail(404, 'Review worker endpoint not found')
    }
    const ownerId = await financeUser(event)
    if (parts[0] === 'agents' && parts.length === 1) {
      if (event.method === 'POST') return await createReviewAgent(ownerId, await body())
      if (event.method === 'GET') return { agents: await FinanceReviewAgent.find({ ownerId }).select('-tokenHash').lean() }
    }
    if (parts[0] === 'agents' && parts.length === 2 && event.method === 'DELETE') {
      if (!/^[a-f\d]{24}$/.test(parts[1])) fail(400, 'Invalid identifier')
      const result = await FinanceReviewAgent.updateOne({ _id: parts[1], ownerId }, { $set: { revokedAt: new Date(), enabled: false } })
      if (!result.matchedCount) fail(404, 'Review worker not found')
      return { success: true }
    }
    if (parts[0] === 'imports' && parts[2] === 'drafts' && parts.length === 4) {
      if (event.method === 'GET') return await getReview(ownerId, parts[1], Number(parts[3]))
      if (event.method === 'POST') return await queueReview(ownerId, parts[1], Number(parts[3]), await body())
    }
    fail(404, 'Review endpoint not found')
  } catch (error: any) {
    if (error?.statusCode) throw error
    if (error?.code === 11000) fail(409, 'A review already exists; reload it')
    console.error('[Finance review] request failed', error?.name || 'Error')
    fail(500, 'Review request failed')
  }
})
