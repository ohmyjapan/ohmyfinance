// Real built app + owned Mongo, behind a LOCAL transport simulation whose route
// decisions come from cloudflared's actual offline matcher. No public tunnel/browser.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { MongoMemoryServer } = require('mongodb-memory-server')
const { MongoClient } = require('mongodb')
const otp = require('otplib')
const root = path.resolve(__dirname, '..'), pause = ms => new Promise(r => setTimeout(r, ms))
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|windir|Path|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMDATA)$/i.test(key)))
async function listen(server) { await new Promise(r => server.listen(0, '127.0.0.1', r)); return server.address().port }
async function freePort() { const s = http.createServer(); const p = await listen(s); await new Promise(r => s.close(r)); return p }
async function request(port, route, { method = 'POST', token, body, raw, headers = {} } = {}) {
  const bytes = raw || (body === undefined ? undefined : Buffer.from(JSON.stringify(body)))
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers, ...(bytes ? { 'content-length': bytes.length } : {}) } }, res => {
      const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => {
        const text = Buffer.concat(chunks).toString(); let data = text
        try { data = JSON.parse(text) } catch {}
        resolve({ status: res.statusCode, headers: res.headers, data })
      })
    })
    req.on('error', reject); req.setTimeout(15000, () => req.destroy(Error('HTTP timeout: ' + method + ' ' + route + ' on owned port ' + port))); req.end(bytes)
  })
}

async function main() {
  const binary = process.argv[2]; assert.ok(binary, 'Pass installed cloudflared binary path')
  const { matchIngress, exampleConfig, publicOrigin, builtAssets } = await import('./check-collector-ingress.mjs')
  const assets = await builtAssets(path.join(root, '.output/public/_nuxt'))
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'omf-public-http-'))
  // Only these owned Node children receive the clock preload. Product code has
  // no test-time switch. Mongo, the parent and the machine clock stay unchanged.
  const clockFile = path.join(temp, 'clock-offset.txt'), clockPreload = path.join(temp, 'clock.cjs')
  let clockOffset = 0
  const appNow = () => Date.now() + clockOffset
  async function setAppTime(epoch) {
    clockOffset = epoch - Date.now()
    await fs.writeFile(clockFile + '.next', String(clockOffset))
    await fs.rename(clockFile + '.next', clockFile)
  }
  await setAppTime(Math.ceil(Date.now() / 900000) * 900000 + 60000)
  await fs.writeFile(clockPreload, `const fs=require('node:fs'), NativeDate=Date; class OwnedDate extends NativeDate { constructor(...args){ super(...(args.length?args:[OwnedDate.now()])) } static now(){ return NativeDate.now()+Number(fs.readFileSync(${JSON.stringify(clockFile)},'utf8')) } } Object.defineProperty(OwnedDate,'name',{value:'Date'}); global.Date=OwnedDate;`)
  const children = new Set(), proxies = [], logs = []
  let mongo, client, checks = 0
  const pass = name => { checks++; console.log('PASS ' + name) }
  try {
    mongo = await MongoMemoryServer.create()
    const uri = mongo.getUri('public_boundary_owned'), jwtSecret = crypto.randomBytes(32).toString('hex')
    client = await MongoClient.connect(uri); const db = client.db('public_boundary_owned')
    assert.notEqual(db.databaseName, 'ohmyfinance')
    async function start(port = undefined) {
      port ||= await freePort()
      const child = spawn(process.execPath, ['--require', clockPreload, path.join(root, '.output/server/index.mjs')], {
        cwd: temp, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...cleanEnv(), NODE_ENV: 'production', MONGO_URI: uri, NUXT_MONGO_URI: uri, JWT_SECRET: jwtSecret, HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port), OMF_DATA_DIR: path.join(temp, 'evidence'), OMF_TRUST_CLOUDFLARE_LOOPBACK: '1', OMF_COLLECTOR_PUBLIC_ORIGIN: publicOrigin }
      })
      children.add(child); let output = ''
      for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { output = (output + b).slice(-6000) })
      logs.push(() => output)
      for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null) throw Error('Owned app exited: ' + output)
        try { const health = await request(port, '/api/health', { method: 'GET' }); if (health.data.database?.connected) { assert.equal(health.data.database.name, db.databaseName); return { child, port } } } catch {}
        await pause(200)
      }
      throw Error('Owned app did not become healthy')
    }
    async function stop(app) { if (app.child.exitCode === null) { const ended = new Promise(r => app.child.once('exit', r)); app.child.kill(); await ended }; children.delete(app.child) }
    let app = await start(), second = await start()
    async function proxyFor(upstreamPort) {
      const proxy = http.createServer(async (req, res) => {
        try {
          const target = await matchIngress(binary, exampleConfig, 'https://' + req.headers.host + req.url)
          if (target === 'http_status:404') { res.writeHead(404); res.end('blocked'); return }
          assert.equal(target, 'http://127.0.0.1:8080')
          // Simulated edge overwrites CF-Connecting-IP, appends to caller-supplied
          // XFF, and preserves URL/method/body. x-test-peer never reaches OMF.
          const headers = { ...req.headers, 'cf-connecting-ip': req.headers['x-test-peer'] || '203.0.113.1', 'x-forwarded-for': (req.headers['x-forwarded-for'] || '') + ', 203.0.113.1' }
          delete headers['x-test-peer']
          const forward = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: req.url, method: req.method, headers }, upstream => { res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res) })
          forward.on('error', () => { res.writeHead(502); res.end('upstream failed') }); req.pipe(forward)
        } catch { res.writeHead(502); res.end('matcher failed') }
      })
      proxies.push(proxy); return listen(proxy)
    }
    const publicPort = await proxyFor(app.port), otherPort = await proxyFor(second.port)
    const call = (route, options = {}) => request(publicPort, route, { ...options, headers: { host: new URL(publicOrigin).host, ...options.headers } })
    const otherCall = (route, options = {}) => request(otherPort, route, { ...options, headers: { host: new URL(publicOrigin).host, ...options.headers } })
    const direct = (route, options) => request(app.port, route, options)
    for (const route of ['/api/upload/transaction', '/api/process-file', '/api/backup', '/api/auth/register', '/api/finance/collector/accounts/extra']) assert.equal((await call(route, { body: {} })).status, 404)
    assert.equal((await call('/api/auth/me', { method: 'GET', headers: { host: 'wrong.example.invalid' } })).status, 404)
    assert.equal((await call('/collector-connect?id=' + 'a'.repeat(64), { method: 'GET' })).status, 200)
    assert.equal((await call('/_nuxt/' + assets.find(a => a.name.endsWith('.js')).name, { method: 'GET' })).status, 200)
    pass('actual matcher plus local HTTP forwarding preserves public pages/assets and blocks private routes')

    const multipart = Buffer.from('--boundary\r\nContent-Disposition: form-data; name="file"; filename="synthetic.csv"\r\nContent-Type: text/csv\r\n\r\nitem,amount\nsynthetic,1\n\r\n--boundary--\r\n')
    const form = { raw: multipart, headers: { 'content-type': 'multipart/form-data; boundary=boundary' } }
    assert.equal((await call('/api/auth/login?x=/api/upload/transaction', form)).status, 400)
    assert.equal((await call('/api/finance/collector/upload?kind=/api/upload/receipt', form)).status, 401)
    assert.equal((await direct('/api/upload/receipt', form)).status, 401)
    await assert.rejects(fs.stat(path.join(temp, 'uploads')), { code: 'ENOENT' })
    pass('query upload probes reach real handlers without writing files; unauthenticated exact upload refuses before parsing')

    const credentials = i => ({ email: `boundary-${i}@example.invalid`, password: 'Synthetic-Password1!' })
    async function register(i) { const r = await direct('/api/auth/register', { body: { ...credentials(i), name: 'Synthetic boundary' } }); assert.equal(r.status, 200); return r.data.tokens.accessToken }
    const token = await register(1)
    for (const route of ['/api/upload/transaction?source=test', '/api/upload/receipt/?source=test']) {
      const r = await direct(route, { ...form, token }); assert.equal(r.status, 200)
      assert.equal(await fs.readFile(r.data.files[0].path, 'utf8'), 'item,amount\nsynthetic,1\n')
      assert.ok(path.resolve(r.data.files[0].path).startsWith(path.resolve(temp) + path.sep))
    }
    pass('authenticated legacy transaction and receipt uploads preserve original bytes in the owned directory')

    for (let i = 0; i < 10; i++) assert.equal((await call('/api/auth/login?q=' + i, { body: {}, headers: { 'x-test-peer': '198.51.100.10', 'x-forwarded-for': '192.0.2.' + i } })).status, 400)
    const limited = await call('/api/auth/login?q=11', { body: {}, headers: { 'x-test-peer': '198.51.100.10', 'x-forwarded-for': '192.0.2.99' } })
    assert.equal(limited.status, 429); assert.ok(Number(limited.headers['retry-after']) > 0)
    assert.equal((await call('/api/auth/login', { body: {}, headers: { 'x-test-peer': '198.51.100.11' } })).status, 400)
    pass('query/XFF changes cannot reset login limit; a different verified proxy client retains its budget')

    async function enable(i, userToken) {
      const setup = await direct('/api/auth/2fa/setup', { token: userToken }); assert.equal(setup.status, 200)
      const data = setup.data, code = () => otp.generateSync({ secret: data.secret, strategy: 'totp', epoch: Math.floor(appNow() / 1000) })
      const enabled = await direct('/api/auth/2fa/enable', { token: userToken, body: { code: code(), backupCodes: data.backupCodes } }); assert.equal(enabled.status, 200)
      return { ...data, code }
    }
    const mfa = await enable(1, token)
    async function challenge(i) { const r = await call('/api/auth/login', { body: credentials(i), headers: { 'x-test-peer': '203.0.113.' + i } }); assert.equal(r.status, 200); assert.equal(r.data.requires2FA, true); return r.data.tempToken }
    const pending = await challenge(1)
    const good = await call('/api/auth/2fa/verify', { body: { tempToken: pending, code: mfa.code() } }); assert.equal(good.status, 200)
    assert.equal((await call('/api/auth/2fa/verify', { body: { tempToken: pending, code: mfa.code() } })).status, 401)
    const backupPending = await challenge(1)
    const backup = await call('/api/auth/2fa/verify', { body: { tempToken: backupPending, code: mfa.backupCodes[0].toLowerCase() } }); assert.equal(backup.status, 200)
    const renewed = await call('/api/auth/refresh', { body: { refreshToken: backup.data.tokens.refreshToken } }); assert.equal(renewed.status, 200)
    assert.equal((await call('/api/auth/me', { method: 'GET', token: renewed.data.tokens.accessToken })).status, 200)
    pass('recovery MFA, one-use challenge, backup code, refresh and profile work through the restricted path set')

    // Exercise connection identity before changing the test clock.
    const connectWindow = Math.floor(appNow() / 60000)
    const publicKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' })
    const connectBody = () => ({ installationId: crypto.randomBytes(16).toString('hex'), generation: crypto.randomBytes(32).toString('hex'), trustHash: crypto.randomBytes(32).toString('hex'), state: crypto.randomBytes(32).toString('hex'), codeChallenge: crypto.randomBytes(32).toString('base64url'), pcName: 'Synthetic PC', publicKey, redirectUri: 'http://127.0.0.1:45678/collector-callback' })
    const routeConnect = '/api/finance/collector-connect/requests', bodyA = connectBody(), bodyB = connectBody()
    let requestId
    for (let i = 0; i < 30; i++) {
      const response = await call(routeConnect, { body: bodyA, headers: { 'x-test-peer': '198.51.100.41', 'x-forwarded-for': '192.0.2.' + i } })
      assert.equal(response.status, 200); requestId ||= response.data.id; assert.equal(response.data.id, requestId)
    }
    assert.equal((await call(routeConnect, { body: bodyA, headers: { 'x-test-peer': '198.51.100.41' } })).status, 429)
    const separate = await otherCall(routeConnect, { body: bodyB, headers: { 'x-test-peer': '198.51.100.42' } })
    assert.equal(separate.status, 200); assert.notEqual(separate.data.id, requestId)
    assert.equal((await otherCall(routeConnect, { body: bodyA, headers: { 'x-test-peer': '198.51.100.41' } })).status, 429)
    pass('initial Connect separates proxy clients across workers and preserves idempotent retries')
    const directBody = connectBody()
    for (let i = 0; i < 30; i++) assert.equal((await direct(routeConnect, { body: directBody, headers: { 'cf-connecting-ip': '203.0.113.' + i, 'x-forwarded-for': '192.0.2.' + i } })).status, 200)
    assert.equal((await direct(routeConnect, { body: directBody, headers: { 'cf-connecting-ip': '203.0.113.99' } })).status, 429)
    assert.equal(Math.floor(appNow() / 60000), connectWindow, 'connection probes must stay in one minute')
    pass('direct Connect retains socket identity despite forged forwarded headers')


    const token2 = await register(2), mfa2 = await enable(2, token2)
    const challengeA = await challenge(2), challengeB = await challenge(2)
    const windowKey = Math.floor(appNow() / 900000) * 900000
    const attempts = await Promise.all(Array.from({ length: 16 }, (_, i) => (i % 2 ? call : otherCall)('/api/auth/2fa/verify?q=' + i, { body: { tempToken: i % 2 ? challengeA : challengeB, code: 'INVALID' }, headers: { 'x-test-peer': '192.0.2.' + (i + 1) } })))
    assert.equal(Math.floor(appNow() / 900000) * 900000, windowKey, 'race must stay in one window')
    assert.equal(attempts.filter(r => r.status === 400).length, 10)
    assert.equal(attempts.filter(r => r.status === 429).length, 6)
    const user = await db.collection('users').findOne({ email: credentials(2).email })
    const counterId = `${user._id}:${windowKey}`
    const counter = await db.collection('authverificationattempts').findOne({ _id: counterId }); assert.equal(counter.count, 16)
    assert.deepEqual(Object.keys(counter).filter(key => key !== '__v').sort(), ['_id', 'count', 'expiresAt'])
    assert.equal(counter.expiresAt.getTime(), windowKey + 900000)
    const auditFilter = { entityType: 'auth', action: 'lockout', userId: String(user._id), 'metadata.reason': 'mfa_verification_limit' }
    const audits = await db.collection('auditlogs').find(auditFilter).toArray()
    assert.equal(audits.length, 1)
    assert.deepEqual(audits[0].metadata, { reason: 'mfa_verification_limit', windowStart: new Date(windowKey).toISOString(), expiresAt: new Date(windowKey + 900000).toISOString(), count: 11, maxAttempts: 10, windowMs: 900000 })
    pass('two app workers and new challenges share exactly ten MFA attempts in the same account/window')
    pass('concurrent excess MFA attempts write exactly one threshold audit with account/window/count and no code')
    await stop(app); app = await start(app.port)
    const persisted = await call('/api/auth/2fa/verify?after=restart', { body: { tempToken: challengeA, code: mfa2.code() }, headers: { 'x-test-peer': '192.0.2.80' } })
    assert.equal(persisted.status, 429)
    const independent = await call('/api/auth/2fa/verify', { body: { tempToken: await challenge(1), code: mfa.code() }, headers: { 'x-test-peer': '192.0.2.81' } }); assert.equal(independent.status, 200)
    pass('restart preserves exhausted MFA budget; a different account still signs in')
    const wait = Number(persisted.headers['retry-after']); assert.ok(wait > 60 && wait <= 900)
    await setAppTime(appNow() + 61000)
    assert.equal((await call('/api/auth/2fa/verify', { body: { tempToken: challengeA, code: mfa2.code() }, headers: { 'x-test-peer': '192.0.2.82' } })).status, 429)
    assert.equal(await db.collection('auditlogs').countDocuments(auditFilter), 1)
    await setAppTime(windowKey + 900000 + 1000)
    const expired = await call('/api/auth/2fa/verify', { body: { tempToken: challengeA, code: mfa2.code() } }); assert.equal(expired.status, 401)
    const recovered = await call('/api/auth/2fa/verify', { body: { tempToken: await challenge(2), code: mfa2.code() } }); assert.equal(recovered.status, 200)
    assert.equal(await db.collection('authverificationattempts').countDocuments({ _id: counterId }), 1, 'recovery does not depend on deleting the prior counter')
    assert.equal(await db.collection('auditlogs').countDocuments(auditFilter), 1)
    pass('owned clock proves fifteen-minute cooldown and fresh-challenge recovery without deleting the old counter')


    const userToken = recovered.data.tokens.accessToken
    const finance = (route, body) => direct('/api/finance/' + route, { token: userToken, body })
    const created = await finance('accounts', { name: 'Synthetic Amex', primaryCard: '12345', cardIdentifiers: ['12345'], otpRecipient: 'original@example.invalid', otpMailbox: 'forwarded@example.invalid' }); assert.equal(created.status, 200)
    const id = created.data.account._id
    const device = await finance('collectors', { name: 'Boundary test', accountIds: [id] }); assert.equal(device.status, 200)
    const collectorToken = device.data.token
    assert.equal((await call('/api/finance/collector/accounts', { method: 'GET', token: collectorToken })).data.accounts.length, 1)
    assert.equal((await finance('accounts/' + id + '/sync', {})).status, 200)
    const claimed = await call('/api/finance/collector/claim', { token: collectorToken, body: {} }); assert.equal(claimed.status, 200)
    const { HEADERS } = await import('../shared/amex.mjs')
    const csv = Buffer.from([HEADERS, ['2026/08/01', '2026/08/03', 'Synthetic shop', 'Test user', '12345', '1234', '', '']].map(row => row.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n'))
    const route = '/api/finance/collector/upload?kind=statement&start=2026-07-19&end=2026-08-18&accountId=' + id + '&jobId=' + claimed.data.account.jobId + '&pageCount=1&unused=/api/upload/receipt'
    const uploaded = await call(route, { token: collectorToken, raw: csv, headers: { 'content-type': 'text/csv' } }); assert.equal(uploaded.status, 200, JSON.stringify(uploaded.data))
    const repeat = await call(route, { token: collectorToken, raw: csv, headers: { 'content-type': 'text/csv' } }); assert.equal(repeat.data.id, uploaded.data.id); assert.equal(repeat.data.duplicateFile, true)
    assert.equal(await db.collection('financeimports').countDocuments(), 1)
    pass('scoped collector lists/claims/uploads with required query parameters; retry retains one imported statement')
    console.log(JSON.stringify({ pass: true, checks, assets: assets.length, retainedSyntheticDirectory: temp, limitation: 'Local forwarding simulation and controlled clocks in owned Node children; no real edge, issuer or wall-clock TTL acceptance' }))
  } catch (error) { console.error(error); console.error('Owned app tail:', logs.map(read => read()).join('\n').slice(-3000)); process.exitCode = 1 }
  finally {
    for (const proxy of proxies) { proxy.closeAllConnections(); await new Promise(r => proxy.close(r)) }
    for (const child of children) if (child.exitCode === null) { const ended = new Promise(r => child.once('exit', r)); child.kill(); await ended }
    if (client) await client.close()
    if (mongo) await mongo.stop()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
