// server/services/companyGmailService.ts — a company sends its invoices from its own Gmail (plan omf-invoice-tnumber-20261030 C2).
// Settings come from the environment (OMF_GMAIL_CLIENT_ID/_CLIENT_SECRET/_REDIRECT_URI, OMF_MAIL_TOKEN_KEY: 32 bytes base64); any one
// missing → configured:false. Tokens and keys are never logged or returned. Callers own the role gate (server/utils/invoiceSenderAccess).
//  - Consent: scopes openid, email, gmail.send and gmail.labels; offline access, consent prompt, PKCE S256. GUARD at finish: the state
//    is this user's and this company's, unused and unexpired; the grant needs gmail.send, a refresh token and a verified address. The
//    refresh token is sealed (AES-256-GCM, bound to company and address). Without gmail.labels the connection still sends
//    (labelsGranted:false) and cases 7/8 below end unknown.
//  - Send: GUARD (send once) a `sending` delivery is pushed only when the invoice has none; then one Gmail send at a time per company
//    (an in-process queue; the Sent count needs it). Steps: token refresh, PDF, MIME to the outbox, SENT count before, postStartedAt,
//    POST messages.send with no OMF time limit. Gmail's answer decides:
//      1 401 → refresh, the same bytes once more · 2 403 rate/userRate, 429 concurrent → wait 1, 2, 4 s (budget 3) · 3 other 429 →
//      failed with the retry time · 4 invalid_grant/admin_policy_enforced, 401 after a fresh token → reconnect_required · 5 403
//      domainPolicy · 6 other 4xx → failed with Gmail's reason · 7 5xx and 8 a dropped connection after the POST began → the Sent
//      count: +1 sent, unchanged at +5 s and +30 s → resend from case 2's budget, anything else unknown · 9 2xx with an id → sent.
//      A failure before the POST began (refresh, PDF, a connection never made) is failed: nothing reached Gmail.
//  - Restart: a `sending` delivery of an earlier process goes through the same queue (server/plugins/invoiceMailRecovery.ts).
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { createError } from 'h3'
import Invoice from '../models/Invoice'
import CompanyMailConnection from '../models/CompanyMailConnection'
import GmailConnectRequest from '../models/GmailConnectRequest'
import InvoiceMailOutbox from '../models/InvoiceMailOutbox'
import { renderInvoicePdf } from './invoicePdfService'
import { canSendInvoices } from '../utils/invoiceSenderAccess'
import { ensureConnection } from '../config/database'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const SEND_URL = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media'
const SENT_LABEL_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/labels/SENT'
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
export const GMAIL_LABELS_SCOPE = 'https://www.googleapis.com/auth/gmail.labels'
const CONNECT_MS = 10 * 60000
const BACKOFF_MS = [1000, 2000, 4000]
const COUNT_WAITS_MS = [5000, 30000]
const CONNECT_ERRORS = ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']
const ONE_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// This process. A sending delivery with another boot id belongs to an earlier process and is recovered at start.
export const BOOT_ID = randomUUID()

const refuse = (statusCode: number, message: string): never => { throw createError({ statusCode, message }) }
const pause = (ms: number) => new Promise(r => setTimeout(r, ms))
const sha256 = (text: string) => createHash('sha256').update(text).digest()
const safe = (text: unknown) => String(text ?? '').replace(/[\r\n]+/g, ' ').slice(0, 200)
const errorCode = (error: any) => String(error?.cause?.code || error?.code || error?.cause?.cause?.code || error?.name || 'Error')
const shortError = (error: any) => safe(error?.cause?.code || error?.code || error?.message || error)

type Config = { clientId: string, clientSecret: string, redirectUri: string, key: Buffer }
function gmailConfig(): Config | null {
  const clientId = process.env.OMF_GMAIL_CLIENT_ID || '', clientSecret = process.env.OMF_GMAIL_CLIENT_SECRET || '', redirectUri = process.env.OMF_GMAIL_REDIRECT_URI || ''
  const key = Buffer.from(process.env.OMF_MAIL_TOKEN_KEY || '', 'base64')
  return clientId && clientSecret && redirectUri && key.length === 32 ? { clientId, clientSecret, redirectUri, key } : null
}
const requireConfig = () => gmailConfig() || refuse(400, 'このサーバーでは Gmail 送信がまだ設定されていません')

const aadOf = (organizationId: unknown, address: string) => Buffer.from(JSON.stringify({ v: 1, kind: 'omf-company-gmail', organizationId: String(organizationId), address }), 'utf8')
function seal(key: Buffer, organizationId: unknown, address: string, secret: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aadOf(organizationId, address))
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
}
function unseal(key: Buffer, organizationId: unknown, address: string, sealed: any): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(String(sealed?.iv || ''), 'base64'))
  decipher.setAAD(aadOf(organizationId, address))
  decipher.setAuthTag(Buffer.from(String(sealed?.tag || ''), 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(String(sealed?.data || ''), 'base64')), decipher.final()]).toString('utf8')
}
async function postForm(url: string, fields: Record<string, string>) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() })
  const text = await response.text(); let body: any = {}
  try { body = JSON.parse(text) } catch {}
  return { ok: response.ok, status: response.status, body }
}
function idTokenClaims(idToken: unknown): any {
  try { return JSON.parse(Buffer.from(String(idToken).split('.')[1] || '', 'base64url').toString('utf8')) } catch { return null }
}

export async function gmailStatus(organizationId: mongoose.Types.ObjectId, userId: string) {
  const row: any = await CompanyMailConnection.findOne({ organizationId }).lean()
  return { configured: !!gmailConfig(), connected: !!row, address: row?.address || null, labelsGranted: !!row?.labelsGranted, state: row ? row.state : 'not_connected', lastSentAt: row?.lastSentAt || null, lastError: row?.lastError || null, canSend: await canSendInvoices(organizationId, userId) }
}

export async function startGmailConnect(organizationId: mongoose.Types.ObjectId, userId: string) {
  const cfg = requireConfig()
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url')
  await GmailConnectRequest.create({ _id: sha256(state).toString('hex'), organizationId, userId, codeVerifier: verifier, expiresAt: new Date(Date.now() + CONNECT_MS) })
  const url = new URL(AUTH_URL)
  url.search = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: ['openid', 'email', GMAIL_SEND_SCOPE, GMAIL_LABELS_SCOPE].join(' '), access_type: 'offline', prompt: 'consent', state, code_challenge: sha256(verifier).toString('base64url'), code_challenge_method: 'S256' }).toString()
  return { url: url.toString() }
}

export async function finishGmailConnect(organizationId: mongoose.Types.ObjectId, userId: string, input: any) {
  const cfg = requireConfig()
  const code = typeof input?.code === 'string' ? input.code : '', state = typeof input?.state === 'string' ? input.state : ''
  if (!code || !state || code.length > 2000 || state.length > 200) refuse(400, 'Gmail の接続を最初からやり直してください')
  // GUARD: a consent this user started for this company, unused and unexpired; it is spent before the code is exchanged.
  const stateId = sha256(state).toString('hex')
  const request: any = await GmailConnectRequest.findOneAndUpdate({ _id: stateId, organizationId, userId, usedAt: null, expiresAt: { $gt: new Date() } }, { $set: { usedAt: new Date() } }, { new: true }).select('+codeVerifier').lean()
  if (!request) refuse(400, 'Gmail の接続を最初からやり直してください（接続の確認が無効か期限切れです）')
  const token = await postForm(TOKEN_URL, { code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code', code_verifier: request.codeVerifier })
  if (!token.ok) refuse(400, 'Google が接続を受け付けませんでした（' + safe(token.body?.error || token.status) + '）')
  const scopes = String(token.body?.scope || '').split(/\s+/).filter(Boolean)
  if (!scopes.includes(GMAIL_SEND_SCOPE)) refuse(400, 'Gmail の送信が許可されていません。もう一度接続し、送信を許可してください')
  if (!token.body?.refresh_token) refuse(400, 'Google から接続の更新に必要な情報が届きませんでした。もう一度接続してください')
  const claims = idTokenClaims(token.body?.id_token)
  const address = typeof claims?.email === 'string' ? claims.email.trim().toLowerCase() : ''
  if (!address || !(claims.email_verified === true || claims.email_verified === 'true')) refuse(400, '確認済みの Gmail アドレスではありません')
  await CompanyMailConnection.findOneAndUpdate({ organizationId }, { $set: { provider: 'gmail', address, scopes, labelsGranted: scopes.includes(GMAIL_LABELS_SCOPE), sealedRefreshToken: seal(cfg.key, organizationId, address, String(token.body.refresh_token)), state: 'ok', connectedBy: userId, connectedAt: new Date(), lastError: null, lastErrorAt: null } }, { upsert: true, new: true, setDefaultsOnInsert: true })
  return gmailStatus(organizationId, userId)
}

export async function disconnectGmail(organizationId: mongoose.Types.ObjectId) {
  const cfg = gmailConfig()
  const row: any = await CompanyMailConnection.findOne({ organizationId }).select('+sealedRefreshToken').lean()
  if (!row) return { disconnected: false, revoked: false }
  let revoked = false
  if (cfg) { try { revoked = (await postForm(REVOKE_URL, { token: unseal(cfg.key, organizationId, row.address, row.sealedRefreshToken) })).ok } catch {} }
  await CompanyMailConnection.deleteOne({ _id: row._id })
  return { disconnected: true, revoked }
}

// ---- One Gmail send at a time per company, in this process (U10: one OhMyFinance process).
const queues = new Map<string, Promise<unknown>>()
function enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) || Promise.resolve()).then(job, job)
  const tail = run.then(() => {}, () => {})
  queues.set(key, tail)
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key) })
  return run
}

type Ctx = { organizationId: mongoose.Types.ObjectId, invoiceId: mongoose.Types.ObjectId, sendId: string, to: string, subject: string, message: string | null, posted?: boolean }
type Outcome = { state: 'sent' | 'failed' | 'unknown', confirmedBy?: 'gmail_id' | 'sent_count', gmailMessageId?: string, gmailThreadId?: string, error?: string, retryAfter?: Date, sentCountAfter?: number | null }
type Next = { kind: 'post' } | { kind: 'count', anchor: Date, before: number | null, why: string }

export async function sendInvoiceByGmail(args: { organizationId: mongoose.Types.ObjectId, userId: string, invoiceId: string, to: unknown, subject: unknown, message: unknown }) {
  const { organizationId, userId } = args
  const to = typeof args.to === 'string' ? args.to.trim() : ''
  if (!to || to.length > 320 || !ONE_ADDRESS.test(to)) refuse(400, '宛先のメールアドレスを1件入力してください')
  const rawSubject = typeof args.subject === 'string' ? args.subject : '', subject = rawSubject.trim()
  if (!subject || /[\r\n]/.test(rawSubject) || subject.length > 200) refuse(400, '件名を1行で入力してください')
  const message = typeof args.message === 'string' ? args.message : ''
  if (message.length > 10000) refuse(400, '本文が長すぎます')
  if (!mongoose.isValidObjectId(args.invoiceId)) refuse(404, 'Invoice not found')
  requireConfig()
  const connection: any = await CompanyMailConnection.findOne({ organizationId }).lean()
  if (!connection) refuse(409, 'Gmail が接続されていません。会社設定で Gmail と接続してください')
  if (connection.state === 'reconnect_required') refuse(409, 'Gmail と再接続してください')
  const invoice: any = await Invoice.findOne({ _id: args.invoiceId, organizationId }).select('_id').lean()
  if (!invoice) refuse(404, 'Invoice not found')
  // GUARD (send once): the delivery is claimed only while the invoice has no sending delivery at all.
  const sendId = randomUUID()
  const claimed = await Invoice.updateOne({ _id: invoice._id, organizationId, 'deliveries.state': { $ne: 'sending' } }, { $push: { deliveries: { sendId, bootId: BOOT_ID, from: connection.address, to, subject, state: 'sending', attempts: 0, sentBy: new mongoose.Types.ObjectId(userId), startedAt: new Date() } } }, { timestamps: false })
  if (!claimed.matchedCount) refuse(409, 'この請求書は送信中です')
  await queueDelivery({ organizationId, invoiceId: invoice._id, sendId, to, subject, message })
  const row: any = await Invoice.findOne({ _id: invoice._id, organizationId }).lean()
  return { delivery: (row?.deliveries || []).find((d: any) => d.sendId === sendId) || null, invoice: { id: String(invoice._id), status: row?.status } }
}
function queueDelivery(ctx: Ctx) {
  return enqueue(String(ctx.organizationId), () => runDelivery(ctx))
}

// Every path ends the delivery: an unexpected error after a POST began is unknown, before it failed (nothing reached Gmail).
async function runDelivery(ctx: Ctx, resume?: { anchor: Date, before: number }) {
  let outcome: Outcome
  try { outcome = await deliver(ctx, resume) } catch (error) { outcome = { state: ctx.posted ? 'unknown' : 'failed', error: (ctx.posted ? '送信できたか確認できないエラーです（' : '送信前のエラーです（') + shortError(error) + '）' } }
  await settle(ctx, outcome)
}

async function deliver(ctx: Ctx, resume?: { anchor: Date, before: number }): Promise<Outcome> {
  const cfg = gmailConfig()
  const connection: any = await CompanyMailConnection.findOne({ organizationId: ctx.organizationId }).select('+sealedRefreshToken').lean()
  if (resume) ctx.posted = true
  if (!cfg || !connection) return ctx.posted ? { state: 'unknown', error: 'Gmail の接続がないため、送信済みフォルダを確認できません' } : { state: 'failed', error: 'Gmail が接続されていません' }
  let cached: string | null = null
  const accessToken = async (force: boolean) => {
    if (cached && !force) return cached
    let refresh: string
    try { refresh = unseal(cfg.key, ctx.organizationId, connection.address, connection.sealedRefreshToken) } catch { throw Object.assign(new Error('sealed token unreadable'), { reconnect: true, code: 'sealed_token' }) }
    const r = await postForm(TOKEN_URL, { client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refresh, grant_type: 'refresh_token' })
    if (!r.ok || !r.body?.access_token) { const code = safe(r.body?.error || r.status); throw Object.assign(new Error('token refresh ' + code), { reconnect: code === 'invalid_grant' || code === 'admin_policy_enforced', code }) }
    cached = String(r.body.access_token)
    return cached
  }
  const tokenFailure = async (error: any): Promise<Outcome> => {
    if (error?.reconnect) { await markReconnect(ctx.organizationId, 'Google: ' + safe(error.code)); return { state: 'failed', error: 'Gmail と再接続してください' } }
    return { state: 'failed', error: 'Gmail の認証を確認できませんでした（' + shortError(error) + '）' }
  }
  let budget = BACKOFF_MS.length, authRetried = false, mime: Uint8Array<ArrayBuffer> | null = null
  let next: Next = resume ? { kind: 'count', anchor: resume.anchor, before: resume.before, why: 'restart' } : { kind: 'post' }
  for (;;) {
    if (next.kind === 'count') {
      const counted = await sentCountRule(next, connection, accessToken)
      if (counted.outcome === 'sent') return { state: 'sent', confirmedBy: 'sent_count', sentCountAfter: counted.after }
      if (counted.outcome === 'unchanged') {
        if (budget > 0) { budget--; next = { kind: 'post' }; continue }
        return { state: 'failed', error: 'Gmail が一時的なエラーを返しました（未送信を確認）', sentCountAfter: counted.after }
      }
      return { state: 'unknown', error: counted.reason, sentCountAfter: counted.after ?? null }
    }
    let access: string
    try { access = await accessToken(false) } catch (error) { return tokenFailure(error) }
    if (!mime) {
      try { mime = new Uint8Array(await outboxMime(ctx, connection)) } catch (error: any) { return { state: 'failed', error: error?.noBytes ? '送信内容が残っていないため再送できませんでした（未送信を確認）。もう一度送ってください' : 'PDF を作れませんでした（' + shortError(error) + '）' } }
    }
    const before = connection.labelsGranted ? await readSentCount(access) : null
    await Invoice.updateOne({ _id: ctx.invoiceId, organizationId: ctx.organizationId }, { $set: { 'deliveries.$[d].postStartedAt': new Date(), 'deliveries.$[d].sentCountBefore': before }, $inc: { 'deliveries.$[d].attempts': 1 } }, { arrayFilters: [{ 'd.sendId': ctx.sendId }], timestamps: false })
    ctx.posted = true
    const sendHeaders = { Authorization: 'Bearer ' + access, 'Content-Type': 'message/rfc822' }
    let response: any = null, body: any = null, transport: any = null
    try {
      response = await fetch(SEND_URL, { method: 'POST', body: mime, headers: sendHeaders })
      const text = await response.text()
      try { body = JSON.parse(text) } catch { body = null }
    } catch (error) { transport = error }
    if (transport) {
      // A connection never made reached nothing; any other transport error after the POST began is decided by the count.
      if (CONNECT_ERRORS.includes(errorCode(transport))) return { state: 'failed', error: 'Gmail に接続できませんでした（' + errorCode(transport) + '）' }
      next = { kind: 'count', anchor: new Date(), before, why: 'transport' }
      continue
    }
    const status = Number(response.status)
    if (status >= 200 && status < 300) {
      if (body?.id) return { state: 'sent', confirmedBy: 'gmail_id', gmailMessageId: String(body.id), ...(body.threadId ? { gmailThreadId: String(body.threadId) } : {}) }
      next = { kind: 'count', anchor: new Date(), before, why: 'no-id' }
      continue
    }
    const message = safe(body?.error?.message), reasons: string[] = Array.isArray(body?.error?.errors) ? body.error.errors.map((e: any) => String(e?.reason || '')) : []
    if (status === 401) {
      if (!authRetried) { authRetried = true; try { await accessToken(true) } catch (error) { return tokenFailure(error) } continue }
      await markReconnect(ctx.organizationId, 'Gmail 401 after a fresh token')
      return { state: 'failed', error: 'Gmail と再接続してください' }
    }
    if ((status === 403 && reasons.some(r => r === 'rateLimitExceeded' || r === 'userRateLimitExceeded')) || (status === 429 && /concurrent/i.test(message))) {
      if (budget > 0) { await pause(BACKOFF_MS[BACKOFF_MS.length - budget]); budget--; continue }
      return { state: 'failed', error: 'Gmail が混み合っています。少し待ってから送ってください' }
    }
    if (status === 429) {
      const retryAfter = retryTime(response.headers.get('retry-after'), message)
      return { state: 'failed', ...(retryAfter ? { retryAfter, error: jst(retryAfter) + '以降に送れます（Gmail の送信上限）' } : { error: 'Gmail の送信上限に達しました（' + message + '）' }) }
    }
    if (status === 403 && reasons.includes('domainPolicy')) return { state: 'failed', error: '会社の Google 管理者に OMF の Gmail 利用を許可してもらってください' }
    if (status >= 400 && status < 500) return { state: 'failed', error: 'Gmail が送信を受け付けませんでした（' + status + (message ? ' ' + message : reasons.length ? ' ' + reasons.join(',') : '') + '）' }
    next = { kind: 'count', anchor: new Date(), before, why: String(status) }
  }
}

// The Sent-folder count after a 5xx, a dropped connection or a restart: +1 → sent; unchanged at +5 s and at +30 s → not sent; any
// other change, a failed read, no before-count or no labels permission → unknown.
async function sentCountRule(next: { anchor: Date, before: number | null, why: string }, connection: any, accessToken: (force: boolean) => Promise<string>) {
  const { anchor, before, why } = next
  const label = why === 'transport' ? '通信が途中で切れ' : why === 'restart' ? 'OMF が送信中に止まり' : why === 'no-id' ? 'Gmail の応答にメール ID がなく' : 'Gmail が ' + why + ' を返し'
  if (!connection.labelsGranted) return { outcome: 'unknown' as const, after: null, reason: label + '、送信済みフォルダの許可がないため確認できません' }
  if (typeof before !== 'number') return { outcome: 'unknown' as const, after: null, reason: label + '、送信前の件数がないため確認できません' }
  let after: number | null = null
  for (const wait of COUNT_WAITS_MS) {
    const delay = anchor.getTime() + wait - Date.now()
    if (delay > 0) await pause(delay)
    let access: string
    try { access = await accessToken(false) } catch { return { outcome: 'unknown' as const, after: null, reason: label + '、送信済みフォルダの件数を読めませんでした' } }
    after = await readSentCount(access)
    if (after === null) return { outcome: 'unknown' as const, after: null, reason: label + '、送信済みフォルダの件数を読めませんでした' }
    if (after === before + 1) return { outcome: 'sent' as const, after }
    if (after !== before) return { outcome: 'unknown' as const, after, reason: label + '、送信済みフォルダの件数が ' + (after - before) + ' 件変わったため確認できません' }
  }
  return { outcome: 'unchanged' as const, after }
}
async function readSentCount(access: string): Promise<number | null> {
  try {
    const r = await fetch(SENT_LABEL_URL, { headers: { Authorization: 'Bearer ' + access } })
    if (!r.ok) { await r.arrayBuffer().catch(() => {}); return null }
    const body: any = await r.json()
    return Number.isSafeInteger(body?.messagesTotal) ? body.messagesTotal : null
  } catch { return null }
}
function retryTime(header: string | null, message: string): Date | null {
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds >= 0) return new Date(Date.now() + seconds * 1000)
    const at = Date.parse(header); if (Number.isFinite(at)) return new Date(at)
  }
  const found = /Retry after (\d{4}-\d{2}-\d{2}T[0-9:.]+Z)/i.exec(message || '')
  const at = found ? Date.parse(found[1]) : NaN
  return Number.isFinite(at) ? new Date(at) : null
}
const jst = (date: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
async function markReconnect(organizationId: mongoose.Types.ObjectId, reason: string) {
  await CompanyMailConnection.updateOne({ organizationId }, { $set: { state: 'reconnect_required', lastError: 'Gmail と再接続してください（' + safe(reason) + '）', lastErrorAt: new Date() } })
}

// The exact bytes of this delivery: the stored outbox row, or (first attempt) the PDF and MIME built now and stored before any POST.
async function outboxMime(ctx: Ctx, connection: any): Promise<Buffer> {
  const saved: any = await InvoiceMailOutbox.findById(ctx.sendId)
  if (saved?.mime) return Buffer.from(saved.mime)
  if (ctx.message === null) throw Object.assign(new Error('no stored bytes'), { noBytes: true })
  const invoice: any = await Invoice.findOne({ _id: ctx.invoiceId, organizationId: ctx.organizationId }).lean()
  if (!invoice) throw new Error('Invoice not found')
  const pdf = await renderInvoicePdf(invoice)
  const filename = 'invoice_' + String(invoice.invoiceNumber || '').replace(/[^A-Za-z0-9._-]/g, '_') + '.pdf'
  const lines = (bytes: Buffer) => (bytes.toString('base64').match(/.{1,76}/g) || []).join('\r\n')
  const boundary = 'omf-' + ctx.sendId
  const mime = Buffer.from([
    'From: ' + connection.address, 'To: ' + ctx.to, 'Subject: =?UTF-8?B?' + Buffer.from(ctx.subject, 'utf8').toString('base64') + '?=', 'MIME-Version: 1.0', 'Date: ' + new Date().toUTCString(),
    'Content-Type: multipart/mixed; boundary="' + boundary + '"', '',
    '--' + boundary, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', lines(Buffer.from(ctx.message, 'utf8')),
    '--' + boundary, 'Content-Type: application/pdf; name="' + filename + '"', 'Content-Disposition: attachment; filename="' + filename + '"', 'Content-Transfer-Encoding: base64', '', lines(pdf),
    '--' + boundary + '--', ''
  ].join('\r\n'), 'utf8')
  await InvoiceMailOutbox.create({ _id: ctx.sendId, organizationId: ctx.organizationId, invoiceId: ctx.invoiceId, mime })
  return mime
}

async function settle(ctx: Ctx, outcome: Outcome) {
  const finishedAt = new Date(), set: Record<string, unknown> = { 'deliveries.$[d].state': outcome.state, 'deliveries.$[d].finishedAt': finishedAt }
  for (const key of ['confirmedBy', 'gmailMessageId', 'gmailThreadId', 'error', 'retryAfter', 'sentCountAfter'] as const) if (outcome[key] !== undefined) set['deliveries.$[d].' + key] = outcome[key]
  await Invoice.updateOne({ _id: ctx.invoiceId, organizationId: ctx.organizationId }, { $set: set }, { arrayFilters: [{ 'd.sendId': ctx.sendId, 'd.state': 'sending' }], timestamps: false })
  if (outcome.state === 'sent') await Invoice.updateOne({ _id: ctx.invoiceId, organizationId: ctx.organizationId, status: 'draft' }, { $set: { status: 'sent' } })
  await CompanyMailConnection.updateOne({ organizationId: ctx.organizationId }, { $set: outcome.state === 'sent' ? { lastSentAt: finishedAt } : { lastError: outcome.error || null, lastErrorAt: finishedAt } })
  await InvoiceMailOutbox.deleteOne({ _id: ctx.sendId })
}

// ---- Restart: each sending delivery of an earlier process, through its company queue. The one whose POST was in flight goes first,
// so a resend of another delivery can never move its count. No postStartedAt → resent with the stored bytes; postStartedAt with a
// before-count → the count rule (anchored at postStartedAt); otherwise unknown. Any error → unknown, so no row stays sending.
export async function recoverInterruptedDeliveries() {
  await ensureConnection()
  const rows: any[] = await Invoice.find({ deliveries: { $elemMatch: { state: 'sending', bootId: { $ne: BOOT_ID } } } }).select('organizationId deliveries').lean()
  const byCompany = new Map<string, { row: any, delivery: any }[]>()
  for (const row of rows) for (const delivery of row.deliveries || []) if (delivery.state === 'sending' && delivery.bootId !== BOOT_ID) { const key = String(row.organizationId); byCompany.set(key, [...(byCompany.get(key) || []), { row, delivery }]) }
  const jobs: Promise<unknown>[] = []
  for (const [key, list] of byCompany) {
    list.sort((a, b) => (a.delivery.postStartedAt ? 0 : 1) - (b.delivery.postStartedAt ? 0 : 1) || new Date(a.delivery.postStartedAt || a.delivery.startedAt || 0).getTime() - new Date(b.delivery.postStartedAt || b.delivery.startedAt || 0).getTime())
    for (const { row, delivery } of list) jobs.push(enqueue(key, () => recoverOne(row, delivery)).catch(() => {}))
  }
  await Promise.all(jobs)
  return jobs.length
}
async function recoverOne(row: any, delivery: any) {
  const ctx: Ctx = { organizationId: row.organizationId, invoiceId: row._id, sendId: delivery.sendId, to: delivery.to, subject: delivery.subject, message: null }
  try {
    const taken = await Invoice.updateOne({ _id: row._id, organizationId: row.organizationId }, { $set: { 'deliveries.$[d].bootId': BOOT_ID } }, { arrayFilters: [{ 'd.sendId': delivery.sendId, 'd.state': 'sending', 'd.bootId': { $ne: BOOT_ID } }], timestamps: false })
    if (!taken.modifiedCount) return
    if (!delivery.postStartedAt) {
      if (!await InvoiceMailOutbox.exists({ _id: delivery.sendId })) return settle(ctx, { state: 'failed', error: '送信の準備中に OMF が止まりました（未送信）。もう一度送ってください' })
      return runDelivery(ctx)
    }
    if (typeof delivery.sentCountBefore === 'number') return runDelivery(ctx, { anchor: new Date(delivery.postStartedAt), before: delivery.sentCountBefore })
    return settle(ctx, { state: 'unknown', error: 'OMF が送信中に止まり、送信前の件数がないため送信できたか確認できません' })
  } catch (error) {
    await settle(ctx, { state: 'unknown', error: '再起動後の確認に失敗しました（' + shortError(error) + '）' }).catch(() => {})
  }
}
