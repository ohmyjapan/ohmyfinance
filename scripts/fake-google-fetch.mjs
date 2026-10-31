// Fixture-only fake Google for the invoice Gmail integration (plan omf-invoice-tnumber-20261030 §4). Never loaded by the app itself.
//  1. Preload: `node --import <this file> .output/server/index.mjs` with OMF_FAKE_GOOGLE_URL set wraps globalThis.fetch inside the
//     app process. A call to a Google host is forwarded to the fake below, a loopback call passes, every other host is refused, so a
//     run reaches no real service. The application code is unchanged and gets no seam.
//  2. startFakeGoogle(): the fake itself, run by the integration process, so its state (issued codes and tokens, accepted mails, the
//     SENT label count) outlives an app restart. It answers the consent-code exchange, refresh and revoke, users.labels.get SENT and
//     messages.send, and plays per-mailbox scripts: delays, Gmail error answers, 5xx before or after accepting, a connection reset
//     before or after accepting, a refused connection, extra mails in the Sent folder, failed label reads and refresh refusals.
import http from 'node:http'
import crypto from 'node:crypto'

const GOOGLE_HOSTS = new Set(['accounts.google.com', 'oauth2.googleapis.com', 'gmail.googleapis.com', 'www.googleapis.com', 'openidconnect.googleapis.com'])
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
export const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
export const LABELS_SCOPE = 'https://www.googleapis.com/auth/gmail.labels'

const forwardTo = process.env.OMF_FAKE_GOOGLE_URL
if (forwardTo && !globalThis.__omfFakeGoogleFetch) {
  globalThis.__omfFakeGoogleFetch = true
  const realFetch = globalThis.fetch
  const refusedPort = Number(process.env.OMF_FAKE_GOOGLE_REFUSED_PORT || 9)
  globalThis.fetch = async function fakeGoogleFetch(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (LOOPBACK.has(url.hostname)) return realFetch(input, init)
    if (!GOOGLE_HOSTS.has(url.hostname)) throw new TypeError('fake-google-fetch: outbound request to ' + url.hostname + ' refused in the fixture')
    const request = new Request(input, init)
    const headers = new Headers(request.headers)
    headers.set('x-fake-target', url.toString())
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : Buffer.from(await request.arrayBuffer())
    const response = await realFetch(forwardTo + '/forward', { method: request.method, headers, body, signal: init.signal || undefined })
    // A scripted refused connection: a genuine ECONNREFUSED from a closed loopback port, never a hand-made error object.
    if (response.headers.get('x-fake-transport') === 'refuse') { await response.arrayBuffer(); return realFetch('http://127.0.0.1:' + refusedPort + '/', { signal: init.signal || undefined }) }
    return response
  }
}

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const random = prefix => prefix + crypto.randomBytes(18).toString('hex')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const json = (res, status, value, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(value)) }
const gmailError = (code, reason, message, status) => ({ error: { code, message, errors: [{ message, domain: code === 403 || code === 429 ? 'usageLimits' : 'global', reason }], status } })
const decodeWords = value => String(value || '').replace(/=\?UTF-8\?B\?([^?]*)\?=/gi, (_, b) => Buffer.from(b, 'base64').toString('utf8')).replace(/\?=\s+=\?/g, '')

// The parts of one RFC 5322 multipart message: headers (lower-case keys, unfolded) and decoded bodies.
export function parseMime(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString('latin1') : String(raw)
  const split = (block) => { const at = block.indexOf('\r\n\r\n'); const head = at < 0 ? block : block.slice(0, at), body = at < 0 ? '' : block.slice(at + 4); const headers = {}; for (const line of head.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) { const i = line.indexOf(':'); if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim() } return { headers, body } }
  const top = split(text)
  const boundary = /boundary="?([^";]+)"?/i.exec(top.headers['content-type'] || '')?.[1]
  const parts = boundary ? top.body.split('--' + boundary).slice(1).filter(p => !p.startsWith('--')).map(p => split(p.replace(/^\r\n/, '').replace(/\r\n$/, ''))) : [top]
  const decoded = parts.map(p => { const enc = (p.headers['content-transfer-encoding'] || '').toLowerCase(); const bytes = enc === 'base64' ? Buffer.from(p.body.replace(/\s+/g, ''), 'base64') : Buffer.from(p.body, 'latin1'); return { headers: p.headers, bytes, filename: /filename="?([^";]+)"?/i.exec(p.headers['content-disposition'] || '')?.[1] || null } })
  const attachment = decoded.find(p => p.filename)
  const textPart = decoded.find(p => /^text\/plain/i.test(p.headers['content-type'] || ''))
  return { headers: top.headers, to: top.headers.to || '', from: top.headers.from || '', subject: decodeWords(top.headers.subject), filename: attachment?.filename || null, pdf: attachment?.bytes || null, pdfOk: !!attachment && attachment.bytes.subarray(0, 5).toString('latin1') === '%PDF-', text: textPart ? textPart.bytes.toString('utf8') : '', parts: decoded.length }
}

export async function startFakeGoogle({ clientId, clientSecret, redirectUri }) {
  const codes = new Map(), refreshTokens = new Map(), accessTokens = new Map(), mailboxes = new Map(), calls = [], revoked = []
  const mailbox = address => {
    let m = mailboxes.get(address)
    if (!m) { m = { address, sentTotal: 0, mails: [], posts: [], sendScript: [], labelScript: [], refreshScript: [], inFlight: 0, maxInFlight: 0, labelReads: [], refreshes: 0 }; mailboxes.set(address, m) }
    return m
  }
  const bearer = req => { const h = String(req.headers.authorization || ''); return h.startsWith('Bearer ') ? accessTokens.get(h.slice(7)) : null }
  const unauthenticated = res => json(res, 401, gmailError(401, 'authError', 'Request had invalid authentication credentials.', 'UNAUTHENTICATED'), { 'WWW-Authenticate': 'Bearer realm="https://accounts.google.com/"' })
  const issueAccess = (address, scopes) => { const token = random('ya29.fake-'); accessTokens.set(token, { address, scopes }); return token }
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const c of req) chunks.push(c)
      const body = Buffer.concat(chunks)
      const target = new URL(String(req.headers['x-fake-target'] || 'http://invalid/'))
      calls.push({ at: Date.now(), method: req.method, host: target.hostname, path: target.pathname })
      const route = req.method + ' ' + target.hostname + target.pathname
      if (route === 'POST oauth2.googleapis.com/token') {
        const form = new URLSearchParams(body.toString('utf8'))
        if (form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret) return json(res, 401, { error: 'invalid_client', error_description: 'The OAuth client was not found.' })
        if (form.get('grant_type') === 'authorization_code') {
          const entry = codes.get(form.get('code'))
          if (!entry || entry.used) return json(res, 400, { error: 'invalid_grant', error_description: 'Bad Request' })
          entry.used = true
          if (form.get('redirect_uri') !== redirectUri) return json(res, 400, { error: 'redirect_uri_mismatch', error_description: 'Bad Request' })
          if (b64url(crypto.createHash('sha256').update(String(form.get('code_verifier') || '')).digest()) !== entry.challenge) return json(res, 400, { error: 'invalid_grant', error_description: 'Missing code verifier.' })
          const access = issueAccess(entry.email, entry.scopes)
          const reply = { access_token: access, expires_in: 3599, scope: entry.scopes.join(' '), token_type: 'Bearer', id_token: [b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })), b64url(JSON.stringify({ iss: 'https://accounts.google.com', aud: clientId, sub: crypto.createHash('sha256').update(entry.email).digest('hex').slice(0, 21), email: entry.email, email_verified: entry.emailVerified, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })), 'fake-signature'].join('.') }
          if (entry.refresh !== false) { const refresh = random('1//fake-refresh-'); refreshTokens.set(refresh, { address: entry.email, scopes: entry.scopes, revoked: false }); reply.refresh_token = refresh; entry.refreshToken = refresh }
          return json(res, 200, reply)
        }
        if (form.get('grant_type') === 'refresh_token') {
          const entry = refreshTokens.get(form.get('refresh_token'))
          if (!entry || entry.revoked) return json(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
          const m = mailbox(entry.address); m.refreshes++
          const scripted = m.refreshScript.shift()
          if (scripted) return json(res, 400, { error: scripted, error_description: scripted === 'admin_policy_enforced' ? 'Access to this app has been restricted by the admin.' : 'Token has been expired or revoked.' })
          return json(res, 200, { access_token: issueAccess(entry.address, entry.scopes), expires_in: 3599, scope: entry.scopes.join(' '), token_type: 'Bearer' })
        }
        return json(res, 400, { error: 'unsupported_grant_type' })
      }
      if (route === 'POST oauth2.googleapis.com/revoke') {
        const token = new URLSearchParams(body.toString('utf8')).get('token') || target.searchParams.get('token')
        revoked.push(token)
        const entry = refreshTokens.get(token); if (entry) entry.revoked = true
        return json(res, 200, {})
      }
      if (route === 'GET gmail.googleapis.com/gmail/v1/users/me/labels/SENT') {
        const grant = bearer(req)
        if (!grant) return unauthenticated(res)
        if (!grant.scopes.includes(LABELS_SCOPE)) return json(res, 403, gmailError(403, 'insufficientPermissions', 'Request had insufficient authentication scopes.', 'PERMISSION_DENIED'))
        const m = mailbox(grant.address), scripted = m.labelScript.shift() || {}
        if (scripted.extra) m.sentTotal += scripted.extra
        m.labelReads.push({ at: Date.now(), value: scripted.fail ? null : m.sentTotal })
        if (scripted.fail) return json(res, 500, gmailError(500, 'backendError', 'Backend Error', 'INTERNAL'))
        return json(res, 200, { id: 'SENT', name: 'SENT', messageListVisibility: 'hide', labelListVisibility: 'labelShow', type: 'system', messagesTotal: m.sentTotal, messagesUnread: 0, threadsTotal: m.sentTotal, threadsUnread: 0 })
      }
      if (route === 'POST gmail.googleapis.com/upload/gmail/v1/users/me/messages/send') {
        const grant = bearer(req)
        if (!grant) return unauthenticated(res)
        if (target.searchParams.get('uploadType') !== 'media') return json(res, 400, gmailError(400, 'badRequest', 'Media upload expected.', 'INVALID_ARGUMENT'))
        if (!grant.scopes.includes(SEND_SCOPE)) return json(res, 403, gmailError(403, 'insufficientPermissions', 'Request had insufficient authentication scopes.', 'PERMISSION_DENIED'))
        const m = mailbox(grant.address), action = m.sendScript.shift() || { status: 200 }
        const mime = parseMime(body), sha = crypto.createHash('sha256').update(body).digest('hex')
        const post = { at: Date.now(), sha, filename: mime.filename, subject: mime.subject, to: mime.to, action: JSON.stringify(action), accepted: false, endedAt: null }
        m.posts.push(post)
        m.inFlight++; m.maxInFlight = Math.max(m.maxInFlight, m.inFlight)
        const accept = () => { m.sentTotal++; post.accepted = true; const id = random('msg-').slice(0, 20); m.mails.push({ id, threadId: id, at: Date.now(), sha, ...mime, pdf: undefined, pdfBytes: mime.pdf ? mime.pdf.length : 0 }); if (action.extra) m.sentTotal += action.extra; return id }
        try {
          if (action.delayMs) await sleep(action.delayMs)
          if (action.refuse) return void res.writeHead(200, { 'x-fake-transport': 'refuse' }).end()
          if (action.reset) { if (action.reset === 'after') accept(); req.socket.destroy(); return }
          if (action.status >= 200 && action.status < 300) { const id = accept(); return json(res, action.status, action.noId ? {} : { id, threadId: id, labelIds: ['SENT'] }) }
          if (action.status >= 500) { if (action.accept) accept(); return json(res, action.status, gmailError(action.status, 'backendError', 'Backend Error', 'UNAVAILABLE')) }
          return json(res, action.status, gmailError(action.status, action.reason || 'badRequest', action.message || 'Invalid To header', action.statusText || (action.status === 429 ? 'RESOURCE_EXHAUSTED' : action.status === 401 ? 'UNAUTHENTICATED' : action.status === 403 ? 'PERMISSION_DENIED' : 'INVALID_ARGUMENT')), action.headers || {})
        } finally { m.inFlight--; post.endedAt = Date.now() }
      }
      return json(res, 404, { error: { code: 404, message: 'fake-google: no such route ' + route } })
    } catch (error) { try { json(res, 500, { error: { code: 500, message: 'fake-google failure ' + String(error?.message || error) } }) } catch {} }
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const url = 'http://127.0.0.1:' + server.address().port
  return {
    url, calls, revoked, mailbox,
    // The browser's half of consent: Google would hand this code back to the redirect URI after the person allowed the scopes.
    issueCode({ challenge, scopes, email, emailVerified = true, refresh = true }) { const code = random('4/fake-code-'); codes.set(code, { challenge, scopes, email, emailVerified, refresh }); return code },
    refreshTokenOf(address) { for (const [token, entry] of refreshTokens) if (entry.address === address && !entry.revoked) return token; return null },
    allSecrets() { return [...refreshTokens.keys(), ...accessTokens.keys(), clientSecret] },
    send(address, ...actions) { mailbox(address).sendScript.push(...actions) },
    labels(address, ...actions) { mailbox(address).labelScript.push(...actions) },
    refreshRefusal(address, ...errors) { mailbox(address).refreshScript.push(...errors) },
    close: () => new Promise(r => { server.closeAllConnections?.(); server.close(() => r()) })
  }
}
