// server/api/webhooks/index.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Webhook from '../../models/Webhook'
import { requireAuth } from '../../middleware/auth'
import { calendarCompany } from '../../utils/calendarAccess'
import { requireCompanyAdmin } from '../../utils/companyRoleAccess'

// S14: the secret is masked and the custom headers (which may carry credentials) are omitted from every response.
const publicWebhook = (w: any) => {
  const { headers, secret, ...rest } = w
  return { ...rest, id: w._id, secret: secret ? '••••••••' : undefined }
}

export default defineEventHandler(async (event) => {
  requireAuth(event)
  await ensureConnection()
  const { auth, organizationId } = await calendarCompany(event)
  await requireCompanyAdmin(auth.userId, organizationId)
  const method = event.method

  if (method === 'GET') {
    const webhooks = await Webhook.find({ organizationId }).sort({ createdAt: -1 }).lean()
    return {
      webhooks: webhooks.map((w: any) => publicWebhook(w))
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
