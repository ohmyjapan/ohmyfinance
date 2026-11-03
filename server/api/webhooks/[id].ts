// server/api/webhooks/[id].ts
import { defineEventHandler, readBody, getQuery, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Webhook from '../../models/Webhook'
import { testWebhook } from '../../services/webhookService'
import { requireAuth } from '../../middleware/auth'
import { calendarCompany } from '../../utils/calendarAccess'
import { requireCompanyAdmin } from '../../utils/companyRoleAccess'

// S14: the secret is masked and the custom headers (which may carry credentials) are omitted from every response.
const publicWebhook = (w: any) => {
  const { headers, secret, ...rest } = w
  return { ...rest, id: w._id, secret: secret ? '••••••••' : undefined }
}
const webhookUpdateFields = ['name', 'url', 'events', 'secret', 'isActive', 'headers']

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const id = event.context.params?.id
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Webhook ID required' })
  }

  await ensureConnection()
  const { auth, organizationId } = await calendarCompany(event)
  await requireCompanyAdmin(auth.userId, organizationId)
  const method = event.method
  const query = getQuery(event)

  // Test webhook (a row outside the company keeps the existing { success: false, error: 'Webhook not found' } answer)
  if (query.test === 'true' && method === 'POST') {
    const result = await testWebhook(id, organizationId)
    return result
  }

  if (method === 'GET') {
    const webhook = await Webhook.findOne({ _id: id, organizationId }).lean()
    if (!webhook) {
      throw createError({ statusCode: 404, statusMessage: 'Webhook not found' })
    }
    return { webhook: publicWebhook(webhook) }
  }

  if (method === 'PUT') {
    const body = await readBody(event)
    const values = Object.fromEntries(webhookUpdateFields.filter((key) => body?.[key] !== undefined).map((key) => [key, body[key]]))
    const webhook = await Webhook.findOneAndUpdate({ _id: id, organizationId }, { $set: values }, { new: true }).lean()
    if (!webhook) {
      throw createError({ statusCode: 404, statusMessage: 'Webhook not found' })
    }
    return { webhook: publicWebhook(webhook), message: 'Webhook updated' }
  }

  if (method === 'DELETE') {
    const result = await Webhook.findOneAndDelete({ _id: id, organizationId })
    if (!result) {
      throw createError({ statusCode: 404, statusMessage: 'Webhook not found' })
    }
    return { message: 'Webhook deleted' }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
