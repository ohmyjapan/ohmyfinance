const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const pinia = require('pinia')
const root = path.resolve(__dirname, '..')

function harness(saved = new Map()) {
  let now = Date.now(), handler = async () => { throw new Error('Unexpected network request') }
  const cache = new Map(), timers = new Map(), events = {}, requests = []
  const activePinia = pinia.createPinia()
  pinia.setActivePinia(activePinia)
  const localStorage = { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, String(v)), removeItem: k => saved.delete(k) }
  class Clock extends Date { static now() { return now } }
  const context = {
    console, Date: Clock, process: { client: true }, atob, URL, Request, Response, Headers, AbortController, AbortSignal, DOMException,
    window: { localStorage, addEventListener: (n, cb) => { (events[n] ||= []).push(cb) } },
    document: { visibilityState: 'visible', body: { style: {} }, addEventListener: (n, cb) => { (events[n] ||= []).push(cb) } },
    localStorage, setTimeout: (cb, ms) => { const id = Symbol(); timers.set(id, { cb, ms }); return id },
    clearTimeout: id => timers.delete(id), setInterval: () => 1, clearInterval() {},
    fetch: async (url, options) => { requests.push({ url, options }); return handler(url, options) },
    defineNuxtRouteMiddleware: fn => fn, navigateTo: value => value
  }
  const vueMock = { ...vue, onMounted() {}, onUnmounted() {} }
  function load(file, overrides = {}) {
    if (cache.has(file)) return cache.get(file)
    const module = { exports: {} }
    cache.set(file, module.exports)
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    vm.runInNewContext(code, { ...context, ...overrides, module, exports: module.exports, require: id => {
      if (id === 'vue') return vueMock
      if (id === 'pinia') return pinia
      if (id.startsWith('~/')) return load(id.slice(2) + '.ts')
      if (id.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), id)) + '.ts')
      return require(id)
    } }, { filename: file })
    cache.set(file, module.exports)
    return module.exports
  }
  const store = load('stores/user.ts').useUserStore(activePinia)
  function tokens(userId = 'test-user', accessSeconds = 1800, refreshSeconds = 604800) {
    const encode = (type, seconds) => 'header.' + Buffer.from(JSON.stringify({ userId, ...(type ? { type } : {}), exp: Math.floor(now / 1000) + seconds })).toString('base64url') + '.synthetic'
    return { accessToken: encode(undefined, accessSeconds), refreshToken: encode('refresh', refreshSeconds), expiresIn: accessSeconds }
  }
  return { store, saved, timers, events, requests, load, tokens, now: () => now, advance: ms => { now += ms }, handle: fn => { handler = fn }, login: (userId = 'test-user') => store.acceptSession({ user: { id: userId, name: 'Synthetic' }, tokens: tokens(userId) }) }
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

test('both authentication APIs share the navigation session', async () => {
  const h = harness()
  h.handle(async () => json({ user: { id: 'test-user' }, tokens: h.tokens() }))
  assert.equal(await h.load('composables/useAuth.ts').useAuth().login({ email: 'test@example.invalid', password: 'unused' }), true)
  assert.equal(h.store.isAuthenticated, true)
  assert.equal(await h.load('middleware/auth.global.ts').default({ path: '/', fullPath: '/' }), undefined)
  assert.equal(h.timers.size, 1)
})

test('2FA challenge stays unauthenticated; completing it clears a stale screen lock', async () => {
  const h = harness()
  h.handle(async () => json({ requires2FA: true, tempToken: 'pending', user: { id: 'test-user' } }))
  assert.equal(await h.store.login('test@example.invalid', 'unused'), '2fa_required')
  assert.equal(h.store.isAuthenticated, false)
  assert.equal(h.saved.has('auth_tokens'), false)
  const tracker = h.load('composables/useActivityTracker.ts').useActivityTracker()
  tracker.lock()
  h.store.complete2FA({ user: { id: 'test-user' }, tokens: h.tokens() })
  assert.equal(tracker.isLocked.value, false)
  assert.equal(h.store.isAuthenticated, true)
})

test('successful renewal keeps usable tokens and synchronizes legacy storage', async () => {
  const h = harness(); h.login(); h.advance(1800000)
  const renewed = h.tokens()
  h.handle(async () => json({ success: true, tokens: renewed }))
  assert.equal(await h.store.refreshAuthToken(), 'refreshed')
  assert.equal(h.store.token, renewed.accessToken)
  assert.equal(h.saved.get('auth_token'), renewed.accessToken)
  assert.equal(JSON.parse(h.saved.get('auth_tokens')).accessToken, renewed.accessToken)
})

test('reload uses the JWT expiry rather than restarting expiresIn', async () => {
  const first = harness(); first.login()
  const h = harness(first.saved); h.advance(1800000)
  let refreshes = 0
  h.handle(async url => { if (url === '/api/auth/me') return json({ user: { id: 'test-user' } }); assert.equal(url, '/api/auth/refresh'); refreshes++; return json({ tokens: h.tokens() }) })
  assert.equal(await h.store.ensureSession(), true)
  assert.equal(refreshes, 1)
})

test('legacy alternate-login storage migrates and hydrates its user', async () => {
  const h = harness()
  h.saved.set('auth_tokens', JSON.stringify(h.tokens()))
  h.handle(async url => { assert.equal(url, '/api/auth/me'); return json({ user: { id: 'test-user' }, organizations: [] }) })
  assert.equal(await h.store.ensureSession(), true)
  assert.equal(h.store.user.id, 'test-user')
  assert.ok(h.saved.has('ohmyfinance_session'))
})

for (const failure of ['offline', 503, 429]) test(`renewal ${failure} preserves the session and schedules retry`, async () => {
  const h = harness(); h.login(); h.advance(1800000)
  h.handle(async () => { if (failure === 'offline') throw Error('offline'); return json({}, failure) })
  assert.equal(await h.store.ensureSession(), true)
  assert.equal(h.store.sessionUnavailable, true)
  assert.equal(h.saved.has('ohmyfinance_session'), true)
  assert.equal([...h.timers.values()][0].ms, 30000)
})

test('definitively rejected refresh clears every session format', async () => {
  const h = harness(); h.login(); h.handle(async () => json({}, 401))
  assert.equal(await h.store.refreshAuthToken(), 'rejected')
  assert.equal(h.store.isAuthenticated, false)
  for (const key of ['auth_tokens', 'auth_token', 'auth_refresh_token', 'auth_user', 'ohmyfinance_session']) assert.equal(h.saved.has(key), false)
})

test('simultaneous renewal requests share one network call', async () => {
  const h = harness(); h.login()
  let resolve
  h.handle(() => new Promise(r => { resolve = r }))
  const calls = [h.store.refreshAuthToken(), h.store.refreshAuthToken(), h.store.refreshAuthToken()]
  assert.equal(h.requests.length, 1)
  resolve(json({ tokens: h.tokens() }))
  assert.deepEqual(await Promise.all(calls), ['refreshed', 'refreshed', 'refreshed'])
})

test('late renewal cannot undo logout or overwrite a different login', async () => {
  for (const replacement of [false, true]) {
    const h = harness(); h.login(); let resolve
    h.handle(() => new Promise(r => { resolve = r }))
    const pending = h.store.refreshAuthToken()
    h.store.clearSession()
    if (replacement) h.login('another-user')
    resolve(json({ tokens: h.tokens() }))
    assert.equal(await pending, 'unavailable')
    assert.equal(h.store.isAuthenticated, replacement)
    if (replacement) assert.equal(h.store.user.id, 'another-user')
  }
})

test('cross-tab logout clears the in-memory session', () => {
  const h = harness(); h.login()
  h.saved.delete('ohmyfinance_session')
  for (const cb of h.events.storage) cb({ key: 'ohmyfinance_session', newValue: null })
  assert.equal(h.store.isAuthenticated, false)
})

test('reload revalidates the user and loads updated security preferences', async () => {
  const first = harness(); first.login()
  const h = harness(first.saved)
  h.handle(async url => { assert.equal(url, '/api/auth/me'); return json({ user: { id: 'test-user', securityPreferences: { pinEnabled: true } } }) })
  assert.equal(await h.store.ensureSession(), true)
  assert.equal(h.store.user.securityPreferences.pinEnabled, true)
  assert.equal(JSON.parse(h.saved.get('ohmyfinance_session')).user.securityPreferences.pinEnabled, true)
})

test('profile validation preserves the session when its renewal is temporarily unavailable', async () => {
  const first = harness(); first.login()
  const h = harness(first.saved)
  h.handle(async url => json({}, url === '/api/auth/me' ? 401 : 503))
  assert.equal(await h.store.ensureSession(), true)
  assert.equal(h.store.isAuthenticated, true)
  assert.equal(h.store.sessionUnavailable, true)
})

test('PIN operations use the current session and reach the server', async () => {
  const h = harness(); h.login()
  h.handle(async (url, options) => { assert.equal(options.headers.Authorization, 'Bearer ' + h.store.token); return json({ valid: true, success: true }) })
  const security = h.load('composables/useSecurityPin.ts').useSecurityPin()
  assert.equal((await security.verifyPin('123456')).valid, true)
  assert.equal((await security.setPin('123456', 'unused')).success, true)
  assert.equal((await security.disablePin('unused')).success, true)
  assert.equal(h.requests.length, 3)
})

test('safe redirects reject loops and external destinations; localized login is public', () => {
  const { safeRedirect, publicAuthRoute } = harness().load('utils/auth-session.ts')
  for (const value of ['//example.invalid', '/\\example.invalid', '/login', '/auth/login?redirect=/', '/ko/auth/login', 'https://example.invalid']) assert.equal(safeRedirect(value), '/')
  assert.equal(safeRedirect('/transactions?status=pending'), '/transactions?status=pending')
  assert.equal(publicAuthRoute('/ko/auth/login'), true)
  assert.equal(publicAuthRoute('/login-other'), false)
})

test('authenticated fetch renews/retries a 401 once and never retries a failed write', async () => {
  const { createSessionFetch } = harness().load('utils/session-fetch.ts')
  const owner = { token: 'old', sessionId: 'session-one', isAuthenticated: true, async ensureFreshToken() { return true }, async refreshAuthToken() { this.token = 'new'; return 'refreshed' } }
  let calls = 0
  const wrapped = createSessionFetch(async (url, opts) => { calls++; if (calls === 1) return json({}, 401); assert.equal(opts.headers.get('Authorization'), 'Bearer new'); return json({ ok: true }) }, () => owner, 'http://localhost')
  assert.equal((await wrapped('/api/payments', { method: 'POST', headers: { Authorization: 'Bearer old' }, body: '{}' })).status, 200)
  assert.equal(calls, 2)
  calls = 0
  const unavailable = createSessionFetch(async () => { calls++; throw Error('offline') }, () => owner, 'http://localhost')
  await assert.rejects(unavailable('/api/payments', { method: 'POST', headers: { Authorization: 'Bearer old' } }))
  assert.equal(calls, 1)
})

test('a request from an old session cannot be replayed after another login', async () => {
  const { createSessionFetch } = harness().load('utils/session-fetch.ts')
  const owner = { token: 'old', sessionId: 'one', isAuthenticated: true, async ensureFreshToken() { return true }, async refreshAuthToken() { throw Error('Must not refresh another session') } }
  let calls = 0
  const wrapped = createSessionFetch(async () => { calls++; owner.token = 'other-user'; owner.sessionId = 'two'; return json({}, 401) }, () => owner, 'http://localhost')
  assert.equal((await wrapped('/api/payments', { method: 'POST', headers: { Authorization: 'Bearer old' }, body: '{}' })).status, 401)
  assert.equal(calls, 1)
})

test('changing sessions while renewal is pending cannot replay an earlier write', async () => {
  const { createSessionFetch } = harness().load('utils/session-fetch.ts')
  const owner = { token: 'old', sessionId: 'one', isAuthenticated: true, async ensureFreshToken() { return true }, async refreshAuthToken() { this.token = 'new-user'; this.sessionId = 'two'; return 'refreshed' } }
  let calls = 0
  const wrapped = createSessionFetch(async () => { calls++; return json({}, 401) }, () => owner, 'http://localhost')
  assert.equal((await wrapped('/api/payments', { method: 'POST', headers: { Authorization: 'Bearer old' }, body: '{}' })).status, 401)
  assert.equal(calls, 1)
})
