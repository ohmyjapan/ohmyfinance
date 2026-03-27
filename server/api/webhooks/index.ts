// server/api/webhooks/index.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Webhook from '../../models/Webhook'
import { testWebhook } from '../../services/webhookService'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  await ensureConnection()
  const method = event.method

  if (method === 'GET') {
    const webhooks = await Webhook.find({}).sort({ createdAt: -1 }).lean()
    return {
      webhooks: webhooks.map((w: any) => ({
        ...w,
        id: w._id,
        secret: w.secret ? '••••••••' : undefined
      }))
    }
  }

  if (method === 'POST') {
    const body = await readBody(event)

    if (!body.name || !body.url) {
      throw createError({ statusCode: 400, statusMessage: 'Name and URL required' })
    }

    const webhook = await Webhook.create({
      name: body.name,
      url: body.url,
      events: body.events || [],
      secret: body.secret,
      isActive: body.isActive !== false,
      headers: body.headers
    })

    return { webhook: { ...webhook.toObject(), id: webhook._id }, message: 'Webhook created' }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
