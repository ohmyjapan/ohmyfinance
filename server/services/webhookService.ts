// server/services/webhookService.ts
// S14 (plan omf-security-fixes-20261102, GUARD): a webhook is delivered only to a public destination. `deliverableUrl` decides from
// the URL rules and from EVERY address the name resolves to at this moment (an injectable lookup keeps the decision table testable
// without DNS); `deliver` opens the socket to that very address, so a name cannot resolve differently between the check and the
// connection, and never follows a redirect; `deliverTo` is the one place the outcome is adapted and written to the row, used by the
// event trigger and by the admin's test alike. A refusal is recorded as lastStatus 0 and answered as { success: false, error }.
import Webhook from '../models/Webhook'
import crypto from 'crypto'
import dns from 'node:dns/promises'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import type mongoose from 'mongoose'

export type AddressLookup = (hostname: string, options: { all: true }) => Promise<Array<{ address: string; family: number }>>
export interface DeliveryTarget { url: URL; address: string; family: number }
export interface DeliveryRequest { headers: Record<string, string>; body: string }
export interface DeliveryOutcome { success: boolean; status?: number; error?: string }

const DELIVERY_TIMEOUT_MS = 10000

// research-worker/http.mjs:9 — loopback, private, link-local, CGNAT, multicast, unspecified, benchmark and documentation ranges.
export function publicIPv4(address: string): boolean {
  if (net.isIP(address) !== 4) return false
  const [a, b] = address.split('.').map(Number)
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0))
}

// `::`, `::1`, fc00::/7, fe80::/10 and 64:ff9b::/96 are refused; an IPv4-mapped address (::ffff:a.b.c.d or ::ffff:xxxx:xxxx) is judged as IPv4.
export function publicIPv6(address: string): boolean {
  if (net.isIP(address) !== 6) return false
  // DNS answers can use expanded notation too; judge the same address identically in either spelling.
  let value: string
  try { value = new URL(`http://[${address}]/`).hostname.slice(1, -1) } catch { return false }
  const mapped = value.match(/^::ffff:(.+)$/)
  if (mapped) {
    const rest = mapped[1]
    if (net.isIP(rest) === 4) return publicIPv4(rest)
    const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (!hex) return false
    const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16)
    return publicIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
  }
  if (value === '::' || value === '::1') return false
  const first = value.startsWith('::') ? 0 : parseInt(value.split(':')[0] || '0', 16)
  if ((first & 0xfe00) === 0xfc00) return false // fc00::/7
  if ((first & 0xffc0) === 0xfe80) return false // fe80::/10
  if (/^64:ff9b::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})?)?$/.test(value)) return false // 64:ff9b::/96
  return true
}

const defaultLookup: AddressLookup = async (hostname, options) => dns.lookup(hostname, { verbatim: true, ...options }) as Promise<Array<{ address: string; family: number }>>

function parseWebhookUrl(value: unknown): URL {
  let url: URL
  try { url = new URL(String(value)) } catch { throw new Error('Webhook URL is not valid') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Webhook URL must be http or https')
  if (url.username || url.password) throw new Error('Webhook URL must not carry credentials')
  return url
}

export async function deliverableUrl(value: unknown, { lookup = defaultLookup }: { lookup?: AddressLookup } = {}): Promise<DeliveryTarget> {
  const url = parseWebhookUrl(value)
  const host = (url.hostname.startsWith('[') && url.hostname.endsWith(']') ? url.hostname.slice(1, -1) : url.hostname).toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.local')) throw new Error('Webhook destination is not public')
  const literal = net.isIP(host)
  const addresses = literal ? [{ address: host, family: literal }] : await lookup(host, { all: true })
  const isPublic = (entry: { address: string; family: number }) => entry.family === 4 ? publicIPv4(entry.address) : entry.family === 6 ? publicIPv6(entry.address) : false
  if (!addresses.length || !addresses.every(isPublic)) throw new Error('Webhook destination is not public')
  return { url, address: addresses[0].address, family: addresses[0].family }
}

// The socket goes to the address deliverableUrl checked, whatever the name resolves to now; TLS still verifies the URL's host name.
const pinnedLookup = (target: DeliveryTarget) => (_hostname: string, options: any, callback: any) => {
  if (typeof options === 'function') return options(null, target.address, target.family)
  return options?.all ? callback(null, [{ address: target.address, family: target.family }]) : callback(null, target.address, target.family)
}

export function deliver(target: DeliveryTarget, { method = 'POST', headers = {}, body, timeoutMs = DELIVERY_TIMEOUT_MS }: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }): Promise<{ status: number; ok: boolean }> {
  return new Promise((resolve, reject) => {
    const client = target.url.protocol === 'https:' ? https : http
    const request = client.request(target.url, {
      method,
      headers,
      lookup: pinnedLookup(target)
    }, (response) => {
      // Redirects are never followed: a 3xx is reported as that status.
      response.resume()
      response.on('end', () => {
        const status = response.statusCode || 0
        resolve({ status, ok: status >= 200 && status < 300 })
      })
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Webhook delivery timed out')))
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

export async function deliverTo(target: DeliveryTarget | Error, request: DeliveryRequest, webhook: any): Promise<DeliveryOutcome> {
  try {
    if (target instanceof Error) throw target
    const response = await deliver(target, { method: 'POST', headers: request.headers, body: request.body })

    await Webhook.findByIdAndUpdate(webhook._id, {
      lastTriggered: new Date(),
      lastStatus: response.status,
      failCount: response.ok ? 0 : (webhook.failCount || 0) + 1
    })

    if (!response.ok) {
      console.error(`[Webhook] ${webhook.name} failed with status ${response.status}`)
    }
    return { success: response.ok, status: response.status }
  } catch (error: any) {
    console.error(`[Webhook] ${webhook.name} failed:`, error.message)
    await Webhook.findByIdAndUpdate(webhook._id, {
      lastTriggered: new Date(),
      lastStatus: 0,
      failCount: (webhook.failCount || 0) + 1
    })

    // Disable webhook after 5 consecutive failures
    if ((webhook.failCount || 0) >= 4) {
      await Webhook.findByIdAndUpdate(webhook._id, { isActive: false })
      console.log(`[Webhook] ${webhook.name} disabled after 5 failures`)
    }
    return { success: false, error: error.message }
  }
}

async function checkedTarget(url: unknown): Promise<DeliveryTarget | Error> {
  try { return await deliverableUrl(url) } catch (error: any) { return error instanceof Error ? error : new Error(String(error)) }
}

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

  await deliverTo(await checkedTarget(webhook.url), { headers, body }, webhook)
}

export async function testWebhook(webhookId: string, organizationId: mongoose.Types.ObjectId): Promise<DeliveryOutcome> {
  const webhook = await Webhook.findOne({ _id: webhookId, organizationId })
  if (!webhook) {
    return { success: false, error: 'Webhook not found' }
  }

  const testPayload = {
    test: true,
    message: 'This is a test webhook from OhMyFinance'
  }

  return deliverTo(await checkedTarget(webhook.url), {
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Event': 'test'
    },
    body: JSON.stringify(testPayload)
  }, webhook)
}
