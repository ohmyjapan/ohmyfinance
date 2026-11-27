// Developer entry in the browser session code (plan omf-order-mapping §4.8, §4.9): utils/auth-session.ts, stores/user.ts and
// utils/session-fetch.ts, loaded as scripts/auth-regression.test.cjs loads them (TypeScript transpiled into a sandbox with a fake
// localStorage, timers and fetch). Real tokens are signed with jsonwebtoken; for an ordinary token tokenClaims, accessExpiry and
// validRefresh must answer exactly what the code at b29dc69 answers.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')
const vue = require('vue')
const pinia = require('pinia')
const jwt = require('jsonwebtoken')
const root = path.resolve(__dirname, '..')
const SECRET = crypto.randomBytes(32).toString('hex')
const transpile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
const moduleFrom = code => { const module = { exports: {} }; vm.runInNewContext(transpile(code), { module, exports: module.exports, atob, Date }); return module.exports }

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
    fetch: async (url, options) => { requests.push({ url, options }); return handler(url, options) }
  }
  const vueMock = { ...vue, onMounted() {}, onUnmounted() {} }
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const module = { exports: {} }
    cache.set(file, module.exports)
    vm.runInNewContext(transpile(fs.readFileSync(path.join(root, file), 'utf8')), { ...context, module, exports: module.exports, require: id => {
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
  const seconds = () => Math.floor(now / 1000)
  const ordinary = (userId = 'aaaaaaaaaaaaaaaaaaaaaaaa', organizationId = 'cccccccccccccccccccccccc') => ({
    accessToken: jwt.sign({ userId, email: 'dev@example.invalid', organizationId, role: 'owner', sv: 0, jti: crypto.randomUUID(), iat: seconds(), exp: seconds() + 1800 }, SECRET),
    refreshToken: jwt.sign({ userId, email: 'dev@example.invalid', organizationId, role: 'owner', sv: 0, type: 'refresh', jti: crypto.randomUUID(), iat: seconds(), exp: seconds() + 604800 }, SECRET),
    expiresIn: 1800
  })
  const entryToken = (extra = {}, ttl = 3600) => jwt.sign({ type: 'entry', eid: 'eeeeeeeeeeeeeeeeeeeeeeee', jti: crypto.randomUUID(), forUser: 'bbbbbbbbbbbbbbbbbbbbbbbb', forCompany: 'dddddddddddddddddddddddd', iat: seconds(), exp: seconds() + ttl, ...extra }, SECRET)
  const signInDeveloper = () => store.acceptSession({ user: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Synthetic Developer' }, organizations: [{ id: 'cccccccccccccccccccccccc', name: 'Synthetic Developer Works' }], tokens: ordinary() })
  const entered = (token = entryToken()) => ({
    token,
    entry: { id: 'eeeeeeeeeeeeeeeeeeeeeeee', user: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', email: 'cust@example.invalid', name: 'Synthetic Customer' }, organization: { id: 'dddddddddddddddddddddddd', name: 'Synthetic Customer Trading' }, startedAt: new Date(now).toISOString(), endsAt: new Date(now + 3600000).toISOString() },
    user: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Synthetic Customer' }, organizations: [{ id: 'dddddddddddddddddddddddd', name: 'Synthetic Customer Trading' }], currentOrganization: { id: 'dddddddddddddddddddddddd', name: 'Synthetic Customer Trading' }
  })
  return { store, saved, timers, events, requests, load, now: () => now, advance: ms => { now += ms }, handle: fn => { handler = fn }, ordinary, entryToken, signInDeveloper, entered }
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

test('for an ordinary token tokenClaims, accessExpiry and validRefresh answer exactly what b29dc69 answers (real signed tokens)', () => {
  const h = harness(), current = h.load('utils/auth-session.ts')
  const before = moduleFrom(execFileSync('git', ['show', 'b29dc69:utils/auth-session.ts'], { cwd: root, encoding: 'utf8' }))
  const t = h.ordinary(), noCompany = jwt.sign({ userId: 'aaaaaaaaaaaaaaaaaaaaaaaa', email: 'x@example.invalid', sv: 2, jti: crypto.randomUUID() }, SECRET, { expiresIn: '30m' })
  const pending = jwt.sign({ userId: 'aaaaaaaaaaaaaaaaaaaaaaaa', email: 'x@example.invalid', type: '2fa_pending', jti: crypto.randomUUID() }, SECRET, { expiresIn: '5m' })
  const invite = jwt.sign({ type: 'invite', organizationId: 'cccccccccccccccccccccccc', email: 'x@example.invalid', role: 'member' }, SECRET, { expiresIn: '7d' })
  for (const token of [t.accessToken, t.refreshToken, noCompany, pending, invite, 'not-a-token', '', null, 'a.b.c']) {
    assert.equal(JSON.stringify(current.tokenClaims(token)), JSON.stringify(before.tokenClaims(token)), 'tokenClaims ' + String(token).slice(0, 20))
    assert.equal(current.accessExpiry(token), before.accessExpiry(token), 'accessExpiry')
    assert.equal(current.validRefresh(token), before.validRefresh(token), 'validRefresh')
  }
  assert.equal(current.tokenClaims(t.accessToken).userId, 'aaaaaaaaaaaaaaaaaaaaaaaa')
})

test('an entry token hands forUser/forCompany on as userId/organizationId, ignores any userId claim, and is never a refresh token', () => {
  const h = harness(), { tokenClaims, accessExpiry, validRefresh } = h.load('utils/auth-session.ts')
  for (const token of [h.entryToken(), h.entryToken({ userId: 'ffffffffffffffffffffffff', organizationId: '999999999999999999999999' })]) {
    const claims = tokenClaims(token)
    assert.equal(claims.userId, 'bbbbbbbbbbbbbbbbbbbbbbbb'); assert.equal(claims.organizationId, 'dddddddddddddddddddddddd'); assert.equal(claims.type, 'entry')
    assert.equal(accessExpiry(token), claims.exp * 1000); assert.equal(validRefresh(token), false)
  }
  assert.equal(tokenClaims(h.entryToken({ forCompany: undefined })).organizationId, undefined, 'an entry without a company')
  assert.equal(tokenClaims(h.entryToken({ forUser: '' })), null, 'an entry token without forUser names nobody')
})

test('entering keeps the developer session under its own key and puts the entry token in place with no refresh token', () => {
  const h = harness(); h.signInDeveloper()
  const developerToken = h.store.token, developerSession = h.store.sessionId
  h.store.enterAccount(h.entered())
  assert.equal(h.store.refreshToken, null); assert.equal(h.store.entry.id, 'eeeeeeeeeeeeeeeeeeeeeeee'); assert.equal(h.store.user.id, 'bbbbbbbbbbbbbbbbbbbbbbbb')
  assert.notEqual(h.store.sessionId, developerSession, 'a new session id')
  const kept = JSON.parse(h.saved.get('ohmyfinance_developer_session')); assert.equal(kept.tokens.accessToken, developerToken); assert.ok(kept.tokens.refreshToken)
  const stored = JSON.parse(h.saved.get('ohmyfinance_session')); assert.equal(stored.entry.id, 'eeeeeeeeeeeeeeeeeeeeeeee'); assert.equal(stored.tokens.refreshToken, null)
  // reload inside the entry
  const again = harness(h.saved); again.store.initAuth()
  assert.equal(again.store.entry?.id, 'eeeeeeeeeeeeeeeeeeeeeeee'); assert.equal(again.store.token, h.store.token); assert.equal(again.store.isAuthenticated, true)
})

test('enterAccount refuses an ordinary token, another person\'s profile, or a second entry; acceptSession still refuses an entry token', () => {
  const h = harness(); h.signInDeveloper()
  assert.throws(() => h.store.enterAccount({ ...h.entered(), token: h.ordinary().accessToken }))
  assert.throws(() => h.store.enterAccount({ ...h.entered(), user: { id: 'ffffffffffffffffffffffff' } }))
  h.store.enterAccount(h.entered())
  assert.throws(() => h.store.enterAccount(h.entered()), 'already inside')
  assert.throws(() => h.store.acceptSession({ user: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb' }, tokens: { accessToken: h.entryToken(), refreshToken: h.entryToken() } }), 'no refresh token, no ordinary session')
})

test('leaving restores the developer session, tells the server with the entry token, and keeps the screen lock', async () => {
  const h = harness(); h.signInDeveloper(); const developerToken = h.store.token
  h.store.enterAccount(h.entered()); const entryToken = h.store.token
  h.saved.set('ohmyfinance_locked_at', String(h.now()))
  h.handle(async () => json({ success: true, ended: true }))
  await h.store.leaveEntry('lock')
  assert.equal(h.store.entry, null); assert.equal(h.store.token, developerToken); assert.ok(h.store.refreshToken); assert.equal(h.store.user.id, 'aaaaaaaaaaaaaaaaaaaaaaaa')
  assert.equal(h.saved.get('ohmyfinance_developer_session'), undefined, 'the kept copy is gone')
  assert.equal(JSON.parse(h.saved.get('ohmyfinance_session')).entry, undefined)
  const call = h.requests.find(r => r.url === '/api/auth/logout'); assert.ok(call); assert.equal(call.options.headers.Authorization, 'Bearer ' + entryToken)
  assert.ok(h.saved.get('ohmyfinance_locked_at'), 'the lock stays on and now asks for the developer')
})

test('an entry expired on load returns to the developer session; logout() inside is leaving, not signing out', async () => {
  const h = harness(); h.signInDeveloper(); h.store.enterAccount(h.entered(h.entryToken({}, 120)))
  h.advance(130000)
  const again = harness(h.saved); again.advance(130000); again.store.initAuth()
  assert.equal(again.store.entry, null); assert.equal(again.store.user.id, 'aaaaaaaaaaaaaaaaaaaaaaaa'); assert.ok(again.store.refreshToken, 'the developer session with its refresh token')
  const h2 = harness(); h2.signInDeveloper(); h2.store.enterAccount(h2.entered()); h2.handle(async () => json({ success: true }))
  assert.equal(await h2.store.logout(), true)
  assert.equal(h2.store.isAuthenticated, true); assert.equal(h2.store.user.id, 'aaaaaaaaaaaaaaaaaaaaaaaa'); assert.equal(h2.store.entry, null)
})

test('inside an entry, renewal time leaves the entry without asking /api/auth/refresh', async () => {
  const h = harness(); h.signInDeveloper(); h.store.enterAccount(h.entered(h.entryToken({}, 90)))
  h.handle(async () => json({ success: true }))
  h.advance(40000)
  assert.equal(await h.store.ensureFreshToken(), false, 'within the last minute the entry is left')
  assert.equal(h.store.entry, null); assert.equal(h.store.user.id, 'aaaaaaaaaaaaaaaaaaaaaaaa')
  assert.ok(!h.requests.some(r => r.url === '/api/auth/refresh'), 'no renewal is asked for an entry')
})

test('inside an entry a 401 leaves at once with no retry; the entry refusal reaches the one notice', async () => {
  const h = harness(); h.signInDeveloper(); h.store.enterAccount(h.entered())
  const { createSessionFetch } = h.load('utils/session-fetch.ts'), notices = [], sent = []
  const original = async (input, init) => { sent.push(init.headers.get('Authorization')); return input.includes('refused') ? json({ data: { code: 'DEVELOPER_ENTRY_REFUSED', message: 'Synthetic refusal text' } }, 403) : json({ data: { code: 'DEVELOPER_ENTRY_ENDED' } }, 401) }
  const f = createSessionFetch(original, () => h.store, 'http://omf.test', text => notices.push(text))
  const entryToken = h.store.token
  h.handle(async () => json({ success: true }))
  const refused = await f('http://omf.test/api/transactions/refused', { method: 'POST', headers: { Authorization: 'Bearer ' + entryToken } })
  assert.equal(refused.status, 403); assert.deepEqual(notices, ['Synthetic refusal text']); assert.equal((await refused.json()).data.code, 'DEVELOPER_ENTRY_REFUSED', 'the response stays readable')
  const ended = await f('http://omf.test/api/finance-intake/records', { headers: { Authorization: 'Bearer ' + entryToken } })
  assert.equal(ended.status, 401); assert.equal(sent.filter(s => s === 'Bearer ' + entryToken).length, 2, 'the 401 is not retried')
  assert.equal(h.store.entry, null, 'left at once'); assert.equal(h.store.user.id, 'aaaaaaaaaaaaaaaaaaaaaaaa')
  assert.ok(!h.requests.some(r => r.url === '/api/auth/refresh'))
})

test('a 401 from /api/auth/me inside leaves the entry; another tab clearing the session leaves it too', async () => {
  const h = harness(); h.signInDeveloper(); h.store.enterAccount(h.entered())
  h.handle(async url => url === '/api/auth/me' ? json({ statusCode: 401 }, 401) : json({ success: true }))
  h.store.user = null
  await h.store.ensureSession()
  assert.equal(h.store.entry, null); assert.equal(h.store.isAuthenticated, true); assert.equal(h.store.user.id, 'aaaaaaaaaaaaaaaaaaaaaaaa')
  const h2 = harness(); h2.signInDeveloper(); h2.store.enterAccount(h2.entered())
  for (const cb of h2.events.storage || []) cb({ key: 'ohmyfinance_session', newValue: null })
  assert.equal(h2.store.entry, null); assert.equal(h2.store.isAuthenticated, true); assert.equal(h2.store.user.id, 'aaaaaaaaaaaaaaaaaaaaaaaa')
})

// Review finding 2: two tabs (two stores over one shared storage) inside one entry reach its time limit together. Tab A leaves first
// and puts the developer's session back; tab B leaves before its storage event for that change has run, so it finds no kept copy.
const developerSignedIn = (tab, name, stored) => {
  assert.equal(tab.store.isAuthenticated, true, name + ' is signed in'); assert.equal(tab.store.entry, null, name + ' left the entry')
  assert.equal(tab.store.user.id, 'aaaaaaaaaaaaaaaaaaaaaaaa', name + ' as the developer'); assert.ok(tab.store.refreshToken, name + ' with the developer\'s refresh token')
  assert.equal(tab.store.token, stored.tokens.accessToken, name + ' holds the stored session')
}
const insideTwoTabs = () => {
  const saved = new Map(), a = harness(saved)
  a.handle(async () => json({ success: true })); a.signInDeveloper(); a.store.enterAccount(a.entered())
  const b = harness(saved); b.handle(async () => json({ success: true })); b.store.initAuth()
  assert.equal(b.store.entry?.id, 'eeeeeeeeeeeeeeeeeeeeeeee', 'tab B is inside the same entry')
  return { saved, a, b }
}

test('two tabs leave one entry at once: the second loads the developer session the first put back instead of clearing it', async () => {
  const { saved, a, b } = insideTwoTabs()
  await a.store.leaveEntry('expired')
  await b.store.leaveEntry('expired')
  const stored = JSON.parse(saved.get('ohmyfinance_session') || 'null')
  assert.ok(stored, 'a session is still stored'); assert.equal(stored.entry, undefined, 'not an entry session'); assert.equal(stored.user.id, 'aaaaaaaaaaaaaaaaaaaaaaaa'); assert.ok(stored.tokens.refreshToken)
  developerSignedIn(a, 'tab A', stored); developerSignedIn(b, 'tab B', stored)
})

test('the same at a storage event: a tab inside that hears "session cleared" after the developer session was put back loads it', async () => {
  const { saved, a, b } = insideTwoTabs()
  await a.store.leaveEntry('developer')
  for (const cb of b.events.storage || []) cb({ key: 'ohmyfinance_session', newValue: null })
  const stored = JSON.parse(saved.get('ohmyfinance_session') || 'null')
  assert.ok(stored && !stored.entry, 'the developer session is still stored'); developerSignedIn(b, 'tab B', stored)
})

test('a real clear still signs out: nothing kept, and no session stored or the entry session still stored', async () => {
  const inside = (ttl = 3600) => { const h = harness(); h.handle(async () => json({ success: true })); h.signInDeveloper(); h.store.enterAccount(h.entered(h.entryToken({}, ttl))); h.saved.delete('ohmyfinance_developer_session'); return h }
  const signedOut = (h, label) => { assert.equal(h.store.isAuthenticated, false, label); assert.equal(h.store.entry, null, label); assert.equal(h.store.token, null, label) }
  const leftWithEntryStored = inside(); await leftWithEntryStored.store.leaveEntry('developer')
  signedOut(leftWithEntryStored, 'leaving, the entry session still stored'); assert.equal(leftWithEntryStored.saved.get('ohmyfinance_session'), undefined, 'and removed')
  const leftWithNothing = inside(); leftWithNothing.saved.delete('ohmyfinance_session'); await leftWithNothing.store.leaveEntry('developer')
  signedOut(leftWithNothing, 'leaving, no session stored')
  const expired = inside(120), loaded = harness(expired.saved); loaded.advance(130000); loaded.store.initAuth()
  signedOut(loaded, 'loading an expired entry session'); assert.equal(expired.saved.get('ohmyfinance_session'), undefined, 'and removed')
  const heardWithNothing = inside(); heardWithNothing.saved.delete('ohmyfinance_session')
  for (const cb of heardWithNothing.events.storage || []) cb({ key: 'ohmyfinance_session', newValue: null })
  signedOut(heardWithNothing, 'another tab cleared the session')
  const heardWithEntryStored = inside()
  for (const cb of heardWithEntryStored.events.storage || []) cb({ key: 'ohmyfinance_session', newValue: null })
  signedOut(heardWithEntryStored, 'a "session cleared" event with the entry session still stored')
})
