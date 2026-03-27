// server/api/webhooks/[id].ts
import { defineEventHandler, readBody, getQuery, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Webhook from '../../models/Webhook'
import { testWebhook } from '../../services/webhookService'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const id = event.context.params?.id
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Webhook ID required' })
  }

  await ensureConnection()
  const method = event.method
  const query = getQuery(event)

  // Test webhook
  if (query.test === 'true' && method === 'POST') {
    const result = await testWebhook(id)
    return result
  }

  if (method === 'GET') {
    const webhook = await Webhook.findById(id).lean()
    if (!webhook) {
      throw createError({ statusCode: 404, statusMessage: 'Webhook not found' })
    }
    return { webhook: { ...webhook, id: webhook._id } }
  }

  if (method === 'PUT') {
    const body = await readBody(event)
    const webhook = await Webhook.findByIdAndUpdate(id, body, { new: true }).lean()
    if (!webhook) {
      throw createError({ statusCode: 404, statusMessage: 'Webhook not found' })
    }
    return { webhook: { ...webhook, id: webhook._id }, message: 'Webhook updated' }
  }

  if (method === 'DELETE') {
    const result = await Webhook.findByIdAndDelete(id)
    if (!result) {
      throw createError({ statusCode: 404, statusMessage: 'Webhook not found' })
    }
    return { message: 'Webhook deleted' }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
