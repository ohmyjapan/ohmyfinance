// server/services/webhookService.ts
import Webhook from '../models/Webhook'
import crypto from 'crypto'

export async function triggerWebhooks(event: string, payload: any): Promise<void> {
  try {
    const webhooks = await Webhook.find({
      isActive: true,
      events: event
    })

    for (const webhook of webhooks) {
      triggerWebhook(webhook, event, payload)
    }
  } catch (error) {
    console.error('[Webhook] Failed to trigger webhooks:', error)
  }
}

async function triggerWebhook(webhook: any, event: string, payload: any): Promise<void> {
  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data: payload
  })

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Webhook-Event': event,
    'X-Webhook-Timestamp': Date.now().toString(),
    ...(webhook.headers || {})
  }

  // Add signature if secret is configured
  if (webhook.secret) {
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(body)
      .digest('hex')
    headers['X-Webhook-Signature'] = `sha256=${signature}`
  }

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10000) // 10 second timeout
    })

    await Webhook.findByIdAndUpdate(webhook._id, {
      lastTriggered: new Date(),
      lastStatus: response.status,
      failCount: response.ok ? 0 : webhook.failCount + 1
    })

    if (!response.ok) {
      console.error(`[Webhook] ${webhook.name} failed with status ${response.status}`)
    }
  } catch (error: any) {
    console.error(`[Webhook] ${webhook.name} failed:`, error.message)
    await Webhook.findByIdAndUpdate(webhook._id, {
      lastTriggered: new Date(),
      lastStatus: 0,
      failCount: webhook.failCount + 1
    })

    // Disable webhook after 5 consecutive failures
    if (webhook.failCount >= 4) {
      await Webhook.findByIdAndUpdate(webhook._id, { isActive: false })
      console.log(`[Webhook] ${webhook.name} disabled after 5 failures`)
    }
  }
}

export async function testWebhook(webhookId: string): Promise<{ success: boolean; status?: number; error?: string }> {
  const webhook = await Webhook.findById(webhookId)
  if (!webhook) {
    return { success: false, error: 'Webhook not found' }
  }

  const testPayload = {
    test: true,
    message: 'This is a test webhook from OhMyFinance'
  }

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Event': 'test'
      },
      body: JSON.stringify(testPayload),
      signal: AbortSignal.timeout(10000)
    })

    return { success: response.ok, status: response.status }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
