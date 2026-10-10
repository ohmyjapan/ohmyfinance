const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const h3 = require('h3')
const root = path.resolve(__dirname, '..')

function harness({ env = {}, sourceTransform = s => s, dependency = () => undefined } = {}) {
  let now = 1000000, reads = 0
  const writes = [], cache = new Map()
  const multipart = [{ filename: 'synthetic.csv', type: 'text/csv', data: Buffer.from('item,amount\ntest,1\n') }]
  class Clock extends Date { static now() { return now } }
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const module = { exports: {} }; cache.set(file, module.exports)
    const code = ts.transpileModule(sourceTransform(fs.readFileSync(path.join(root, file), 'utf8'), file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    vm.runInNewContext(code, {
      module, exports: module.exports, console: { log() {}, error() {} }, Date: Clock,
      process: { env, cwd: () => '/synthetic-owned-root' }, setInterval: () => 0,
      URL, Buffer, require: id => {
        const override = dependency(id, file)
        if (override !== undefined) return override
        if (id === 'h3') return { ...h3, readMultipartFormData: async () => { reads++; return multipart } }
        if (id === 'fs/promises') return { mkdir: async () => {}, writeFile: async (p, b) => { writes.push({ path: p, bytes: b.toString() }) } }
        if (id.includes('excel-processor')) return { processExcelFile: async () => { throw Error('Unexpected Excel parse') } }
        if (id.includes('authService')) return { verifyAccessToken: () => { throw Error('Unexpected token verification') } }
        if (id.includes('tokenBlacklistService')) return { isBlacklisted: () => false }
        if (id.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), id)) + '.ts')
        return require(id)
      }
    }, { filename: file })
    cache.set(file, module.exports); return module.exports
  }
  function event(url, { authenticated = false, peer = '192.0.2.10', headers = {}, method = 'POST' } = {}) {
    const responseHeaders = {}
    return { path: url, method, context: { auth: { isAuthenticated: authenticated, userId: authenticated ? 'synthetic-owner' : '' } }, node: { req: { method, url, socket: { remoteAddress: peer }, headers }, res: { setHeader: (k, v) => { responseHeaders[k] = v } } }, responseHeaders }
  }
  return { load, event, writes, multipart, reads: () => reads, advance: ms => { now += ms } }
}

test('query text on a public route never dispatches legacy upload or reads its body', async () => {
  const h = harness(), upload = h.load('server/middleware/file-upload.ts').default
  for (const route of ['/api/auth/login?x=/api/upload/transaction', '/api/finance/collector/upload?kind=/api/upload/receipt', '/collector-connect?x=/api/upload/transaction']) assert.equal(await upload(h.event(route)), undefined)
  assert.equal(h.reads(), 0); assert.equal(h.writes.length, 0)
})
test('nested and lookalike paths do not become an upload route', async () => {
  const h = harness(), upload = h.load('server/middleware/file-upload.ts').default
  for (const route of ['/prefix/api/upload/transaction', '/api/upload/transaction-else', '/api/upload/receipt/extra', '/api/upload/%74ransaction']) assert.equal(await upload(h.event(route)), undefined)
  assert.equal(h.reads(), 0); assert.equal(h.writes.length, 0)
})
test('exact legacy upload requires authentication before parsing or writing', async () => {
  const h = harness(), upload = h.load('server/middleware/file-upload.ts').default
  for (const route of ['/api/upload/transaction', '/api/upload/receipt/']) await assert.rejects(upload(h.event(route)), e => e.statusCode === 401)
  assert.equal(h.reads(), 0); assert.equal(h.writes.length, 0)
})
test('authenticated upload keeps transaction and receipt destinations with ordinary queries', async () => {
  const h = harness(), upload = h.load('server/middleware/file-upload.ts').default
  for (const route of ['/api/upload/transaction?source=test', '/api/upload/receipt/?source=test']) assert.equal((await upload(h.event(route, { authenticated: true }))).success, true)
  assert.equal(h.writes.length, 2)
  assert.match(h.writes[0].path, /uploads[\\/]transactions[\\/]/); assert.match(h.writes[1].path, /uploads[\\/]receipts[\\/]/)
})
test('rate limiting ignores query and X-Forwarded-For changes; cooldown recovers', async () => {
  const h = harness(), limit = h.load('server/middleware/rateLimit.ts').default
  const event = i => h.event('/api/auth/login?q=' + i, { headers: { 'x-forwarded-for': '198.51.100.' + i, 'cf-connecting-ip': '203.0.113.' + i } })
  for (let i = 1; i <= 10; i++) await limit(event(i))
  const blocked = event(11)
  await assert.rejects(limit(blocked), e => e.statusCode === 429)
  assert.equal(blocked.responseHeaders['Retry-After'], '60')
  h.advance(60001); await limit(event(12))
})
test('different direct peers retain separate budgets and unrelated collector requests do not consume login budget', async () => {
  const h = harness(), limit = h.load('server/middleware/rateLimit.ts').default
  for (let i = 0; i < 11; i++) await limit(h.event('/api/finance/collector/accounts'))
  for (let i = 0; i < 10; i++) await limit(h.event('/api/auth/login'))
  await assert.rejects(limit(h.event('/api/auth/login')), e => e.statusCode === 429)
  await limit(h.event('/api/auth/login', { peer: '192.0.2.11' }))
})

test('all configured auth families retain their thresholds across query and suffix changes', async () => {
  for (const [route, max] of [['login', 10], ['register', 5], ['2fa/verify', 10], ['reset-password', 3], ['verify-pin', 10], ['set-pin', 5]]) {
    const h = harness(), limit = h.load('server/middleware/rateLimit.ts').default
    for (let i = 0; i < max; i++) await limit(h.event(`/api/auth/${route}?i=${i}`))
    await assert.rejects(limit(h.event(`/api/auth/${route}/extra?q=different`)), e => e.statusCode === 429)
    h.advance(60000); await limit(h.event(`/api/auth/${route}`))
  }
})

test('only the configured loopback tunnel may supply a single client IP; IPv6 identities normalize', () => {
  const origin = 'https://omf-public.example.invalid'
  const h = harness({ env: { OMF_TRUST_CLOUDFLARE_LOOPBACK: '1', OMF_COLLECTOR_PUBLIC_ORIGIN: origin } })
  const identity = h.load('server/utils/request-client.ts').requestClient
  const event = (peer = '127.0.0.1', headers = {}) => h.event('/api/auth/login', { peer, headers: { host: 'omf-public.example.invalid', 'cf-connecting-ip': '203.0.113.7', ...headers } })
  for (const peer of ['127.0.0.1', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1']) assert.equal(identity(event(peer)), '203.0.113.7')
  assert.equal(identity(event('192.0.2.4')), '192.0.2.4')
  assert.equal(identity(event('::ffff:192.0.2.4')), '192.0.2.4')
  for (const value of ['203.0.113.7, 203.0.113.8', 'bad', '', '203.0.113.7:1234']) assert.equal(identity(event(undefined, { 'cf-connecting-ip': value })), '127.0.0.1')
  for (const host of ['wrong.invalid', 'omf-public.example.invalid.attacker.invalid', 'omf-public.example.invalid:8080']) assert.equal(identity(event(undefined, { host })), '127.0.0.1')
  assert.equal(identity(event(undefined, { 'cf-connecting-ip': '2001:0db8:0:0::1' })), '2001:db8::1')
  assert.equal(identity(event(undefined, { 'cf-connecting-ip': '::ffff:203.0.113.7' })), '203.0.113.7')
  for (const env of [{}, { OMF_TRUST_CLOUDFLARE_LOOPBACK: '1', OMF_COLLECTOR_PUBLIC_ORIGIN: 'http://omf-public.example.invalid' }, { OMF_TRUST_CLOUDFLARE_LOOPBACK: '1', OMF_COLLECTOR_PUBLIC_ORIGIN: origin + '/path' }]) {
    assert.equal(harness({ env }).load('server/utils/request-client.ts').requestClient(event()), '127.0.0.1')
  }
})

test('trusted tunnel users have separate budgets and spoofed XFF cannot reset one', async () => {
  const h = harness({ env: { OMF_TRUST_CLOUDFLARE_LOOPBACK: '1', OMF_COLLECTOR_PUBLIC_ORIGIN: 'https://omf-public.example.invalid' } })
  const limit = h.load('server/middleware/rateLimit.ts').default
  const event = (i, ip = '203.0.113.7') => h.event('/api/auth/login?q=' + i, { peer: '127.0.0.1', headers: { host: 'omf-public.example.invalid', 'cf-connecting-ip': ip, 'x-forwarded-for': '198.51.100.' + i } })
  for (let i = 0; i < 10; i++) await limit(event(i))
  await assert.rejects(limit(event(11)), e => e.statusCode === 429)
  await limit(event(12, '203.0.113.8'))
})

test('behavior probes detect reintroduced upload and rate-limit defects', async () => {
  const cases = [
    ['substring upload dispatch', s => s.replace("const pathname = (event.path || event.node.req.url || '').split('?')[0];", "const pathname = (event.path || '').slice((event.path || '').indexOf('/api/upload/'));"), async h => assert.equal(await h.load('server/middleware/file-upload.ts').default(h.event('/api/auth/login?x=/api/upload/transaction', { authenticated: true })), undefined)],
    ['missing upload authentication', s => s.replace('requireAuth(event);', ''), async h => assert.rejects(h.load('server/middleware/file-upload.ts').default(h.event('/api/upload/transaction')), e => e.statusCode === 401)],
    ['query-keyed login budget', s => s.replace('${requestClient(event)}:${route}', '${requestClient(event)}:${event.path}'), async h => { const limit = h.load('server/middleware/rateLimit.ts').default; for (let i = 0; i < 10; i++) await limit(h.event('/api/auth/login?q=' + i)); await assert.rejects(limit(h.event('/api/auth/login?q=11')), e => e.statusCode === 429) }],
    ['untrusted forwarded identity', s => s.replace("const peer = canonicalIP(event.node.req.socket?.remoteAddress) || 'unknown'", "const peer = getHeader(event, 'x-forwarded-for') || 'unknown'"), async h => assert.equal(h.load('server/utils/request-client.ts').requestClient(h.event('/api/auth/login', { headers: { 'x-forwarded-for': 'attacker' } })), '192.0.2.10')]
  ]
  for (const [label, transform, probe] of cases) {
    let applied = false
    const h = harness({ sourceTransform: s => { const changed = transform(s); applied ||= changed !== s; return changed } })
    await assert.rejects(async () => probe(h), { code: 'ERR_ASSERTION' }, label)
    assert.equal(applied, true, label + ' mutation applied')
  }
})

function mfaHarness(sourceTransform = s => s) {
  const counters = new Map(); let checks = 0, race = false, databaseDown = false
  const h = harness({ sourceTransform, dependency: id => {
    if (id === 'h3') return { ...h3, readBody: async event => event.body }
    if (id.endsWith('/database')) return { ensureConnection: async () => {} }
    if (id.endsWith('/User')) return { default: { findById: () => ({ select: async () => ({ _id: 'verified-user', isActive: true, twoFactorEnabled: true, twoFactorSecret: 'synthetic' }) }) }, __esModule: true }
    if (id.endsWith('/authService')) return { verifyToken: token => token === 'invalid' ? null : { type: '2fa_pending', jti: token, userId: 'verified-user', exp: 9999999 } }
    if (id.endsWith('/twoFactorService')) return { verifyToken: () => { checks++; return false } }
    if (id.endsWith('/UsedAuthChallenge')) return { default: {}, __esModule: true }
    if (id.endsWith('/AuthVerificationAttempt')) return { __esModule: true, default: { findOneAndUpdate: async ({ _id }, update) => {
      if (databaseDown) throw Error('synthetic database failure')
      if (race) { race = false; counters.set(_id, { count: 1 }); throw Object.assign(Error('race'), { code: 11000 }) }
      const entry = counters.get(_id) || { count: 0, expiresAt: update.$setOnInsert.expiresAt }
      entry.count++; counters.set(_id, entry); return entry
    } } }
  } })
  const verify = h.load('server/api/auth/2fa/verify.ts').default
  return { ...h, counters, checks: () => checks, race: () => { race = true }, databaseDown: () => { databaseDown = true }, attempt: token => { const event = h.event('/api/auth/2fa/verify'); event.body = { tempToken: token, code: '123456' }; return verify(event) } }
}

test('MFA reserves verified-account budget before OTP work, recovers after time and handles insert races', async () => {
  const h = mfaHarness()
  await assert.rejects(h.attempt('invalid'), e => e.statusCode === 401)
  assert.equal(h.counters.size, 0)
  for (let i = 0; i < 10; i++) await assert.rejects(h.attempt('signed-' + i), e => e.statusCode === 400)
  await assert.rejects(h.attempt('signed-next'), e => e.statusCode === 429)
  assert.equal(h.checks(), 10)
  h.advance(60000); await assert.rejects(h.attempt('signed-later'), e => e.statusCode === 400)
  assert.equal(h.checks(), 11)
  const raced = mfaHarness(); raced.race()
  await assert.rejects(raced.attempt('signed-race'), e => e.statusCode === 400)
  assert.equal([...raced.counters.values()][0].count, 2)
  const unavailable = mfaHarness(); unavailable.databaseDown()
  await assert.rejects(unavailable.attempt('signed-outage'), e => e.statusCode === 500)
  assert.equal(unavailable.checks(), 0)
})

test('MFA probes detect removing either reservation or enforcement', async () => {
  for (const transform of [s => s.replace('await limitMfaAttempt(event, String(user._id))', ''), s => s.replace('attempt.count > maxAttempts', 'false')]) {
    let applied = false
    const h = mfaHarness(s => { const mutated = transform(s); applied ||= mutated !== s; return mutated })
    for (let i = 0; i < 10; i++) await assert.rejects(h.attempt('signed-' + i), e => e.statusCode === 400)
    await assert.rejects(async () => assert.rejects(h.attempt('signed-next'), e => e.statusCode === 429), { code: 'ERR_ASSERTION' })
    assert.equal(applied, true)
  }
})
