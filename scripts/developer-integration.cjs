'use strict';
// Developer list and 開発者 page (plan omf-order-mapping piece 5) on the actual built app. Owned throwaway MongoDB (MongoMemoryServer),
// the built server on loopback, invented people and companies only; no model, provider, mail, bank or production address is reached.
// The developer list is written by the operator command scripts/manage-developers.ts, run here against the throwaway database only.
// Every check is labelled `developer:<id>` so the hub fixture (scripts/zoomer-fixtures/omf-developer-entry.mjs) can name the
// check a reintroduced defect must turn red. Checks do not stop at the first failure: each prints PASS or FAIL with its reason and the
// run exits 1 when any failed, so a fail-first run shows every check's own reason.
// Environment: OMF_DEVELOPER_APP_ROOT (the built app; default this tree), OMF_DEVELOPER_SOURCE_ROOT (the source tree whose route files,
// operator command and git history are read; default this tree), OMF_DEVELOPER_BROWSER=1 (installed Chrome, headless),
// OMF_DEVELOPER_MUTANT=1 (set by the fixture for put-back defects; skips the browser).
const assert = require('node:assert/strict')
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), net = require('node:net'), crypto = require('node:crypto')
const { spawn, execFile, execFileSync } = require('node:child_process')
const { MongoMemoryServer } = require('mongodb-memory-server')
const { MongoClient, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const otp = require('otplib')

const source = path.resolve(process.env.OMF_DEVELOPER_SOURCE_ROOT || path.join(__dirname, '..'))
const root = path.resolve(process.env.OMF_DEVELOPER_APP_ROOT || source)
const BROWSER = process.env.OMF_DEVELOPER_BROWSER === '1' && process.env.OMF_DEVELOPER_MUTANT !== '1'
const DB = 'developer_entry_regression', PASSWORD = 'Synthetic-password-Only1!', BASELINE = 'b29dc69'
const pause = ms => new Promise(r => setTimeout(r, ms))
const L = tag => 'developer:' + tag

const results = []
async function check(label, fn) {
  try { await fn(); results.push({ label, ok: true }); console.log('PASS ' + label) }
  catch (error) { const why = String(error?.message || error).replace(/\s+/g, ' ').slice(0, 600); results.push({ label, ok: false, why }); console.log('FAIL ' + label + ' :: ' + why) }
}
const sha = text => crypto.createHash('sha256').update(text).digest('hex')
const atBaseline = file => execFileSync('git', ['show', BASELINE + ':' + file], { cwd: source, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
const current = file => fs.readFileSync(path.join(source, file), 'utf8').replace(/\r\n/g, '\n')
const chromePath = () => process.env.PUPPETEER_EXECUTABLE_PATH || [path.join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'), path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'), path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')].find(fs.existsSync)
const mongodBinary = () => [process.env.OMF_MONGOD_BINARY, path.join(source, 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe'), path.resolve(source, '../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe')].find(p => p && fs.existsSync(p))

async function main() {
  let mongo, client, child, directory, browser, logs = ''
  try {
    directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'omf-developer-'))
    const binary = mongodBinary()
    mongo = await MongoMemoryServer.create({ binary: binary ? { systemBinary: binary, version: '8.2.1' } : undefined, instance: { launchTimeout: 300000 } })
    const uri = mongo.getUri(DB)
    assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, 'SETUP owned database is the local memory server')
    const listener = net.createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r)); const port = listener.address().port; await new Promise(r => listener.close(r))
    const origin = 'http://127.0.0.1:' + port, secret = crypto.randomBytes(32).toString('hex')
    const env = { ...process.env, MONGO_URI: uri, MONGODB_URI: uri, NUXT_MONGO_URI: uri, OMF_DATA_DIR: directory, JWT_SECRET: secret, NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port), OMF_SYNC_SCHEDULE_MS: '0', BASE_URL: origin, OMF_COLLECTOR_PUBLIC_ORIGIN: '', OMF_TRUST_CLOUDFLARE_LOOPBACK: '' }
    for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'SLACK_BOT_TOKEN', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'OMF_GMAIL_CLIENT_ID', 'OMF_GMAIL_CLIENT_SECRET']) env[key] = ''
    const start = async () => {
      child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: root, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
      child.closed = new Promise(r => child.once('exit', r))
      for (const stream of [child.stdout, child.stderr]) { stream.setEncoding('utf8'); stream.on('data', s => { logs = (logs + s).slice(-40000) }) }
      for (let i = 0; i < 300; i++) {
        if (child.exitCode !== null) throw Error('SETUP server exited: ' + logs.slice(-2000))
        try { const d = await (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) })).json(); if (d.database?.connected) { assert.equal(d.database.name, DB, 'SETUP owned database'); return } } catch (e) { if (e?.code === 'ERR_ASSERTION') throw e }
        await pause(200)
      }
      throw Error('SETUP owned app unavailable: ' + logs.slice(-2000))
    }
    const stop = async () => { if (child && child.exitCode === null) { child.kill(); await child.closed } child = null }
    await start()
    client = await MongoClient.connect(uri); const db = client.db(DB)
    assert.notEqual(db.databaseName, 'ohmyfinance', 'SETUP never the production database name')
    const col = name => db.collection(name)

    // HTTP: `token` sends `Authorization: Bearer <token>`, `authorization` sends a whole header value as it is.
    const call = async (route, { token, authorization, method = 'GET', body, raw, headers = {} } = {}) => {
      const h = { ...headers }
      if (authorization !== undefined) { if (authorization !== null) h.Authorization = authorization } else if (token) h.Authorization = 'Bearer ' + token
      let payload
      if (raw !== undefined) payload = raw
      else if (body !== undefined) { h['Content-Type'] = h['Content-Type'] || 'application/json'; payload = JSON.stringify(body) }
      const r = await fetch(origin + route, { method, headers: h, ...(payload === undefined ? {} : { body: payload }), redirect: 'manual', signal: AbortSignal.timeout(30000) })
      const text = await r.text(); let data; try { data = JSON.parse(text) } catch {}
      return { status: r.status, raw: text, data }
    }
    const code = r => r.data?.data?.code
    const expectStatus = (r, status, label) => assert.equal(r.status, status, label + ' answered ' + r.status + ' ' + r.raw.slice(0, 300))

    // Operator command, run as the operator would on the server, here against the throwaway database only.
    const manage = (...args) => new Promise(resolve => execFile(process.execPath, ['--import', 'tsx', path.join(source, 'scripts/manage-developers.ts'), ...args], { cwd: source, windowsHide: true, env: { ...process.env, MONGO_URI: uri }, timeout: 180000 }, (e, stdout, stderr) => resolve({ code: e ? (Number.isInteger(e.code) ? e.code : 1) : 0, out: String(stdout || '') + String(stderr || '') })))

    // ---- SETUP: invented people and companies. Users are stored with a real bcrypt hash (login checks it; registration is rate-limited).
    const hash = await require('bcryptjs').hash(PASSWORD, 4), people = {}, now = new Date()
    const person = async (key, name) => {
      const id = new ObjectId(), email = key.toLowerCase() + '@example.invalid'
      await col('users').insertOne({ _id: id, email, password: hash, name, isActive: true, isEmailVerified: true, preferences: { language: 'ja', currency: 'JPY', timezone: 'Asia/Tokyo', darkMode: false }, securityPreferences: { pinEnabled: false, screenLockTimeout: 15, forceLogoutTimeout: 8 }, loginAttempts: 0, twoFactorEnabled: false, sessionVersion: 0, createdAt: now, updatedAt: now })
      const p = { key, id, sid: String(id), email, name }
      p.plain = jwt.sign({ userId: p.sid, email, sv: 0, jti: crypto.randomUUID() }, secret, { expiresIn: '3h' })
      people[key] = p; return p
    }
    const dev = await person('dev', 'Synthetic Developer'), dev2 = await person('dev2', 'Synthetic Second Developer'), nofa = await person('nofa', 'Synthetic Listed Without 2FA')
    const cust = await person('cust', 'Synthetic Customer'), admin = await person('admin', 'Synthetic Company Admin'), loner = await person('loner', 'Synthetic Companyless')
    const companies = { dev: new ObjectId(), cust: new ObjectId() }, member = (p, role) => ({ userId: p.id, role, joinedAt: now })
    const settings = { defaultCurrency: 'JPY', fiscalYearStart: 4, timezone: 'Asia/Tokyo', invoicePrefix: 'INV', invoiceNextNumber: 1 }
    await col('organizations').insertMany([
      { _id: companies.dev, name: 'Synthetic Developer Works', slug: 'synthetic-developer-works', type: 'business', isActive: true, members: [member(dev, 'owner'), member(dev2, 'owner'), member(nofa, 'owner')], settings, createdAt: now, updatedAt: now },
      { _id: companies.cust, name: 'Synthetic Customer Trading', slug: 'synthetic-customer-trading', type: 'business', isActive: true, members: [member(cust, 'owner'), member(admin, 'admin')], settings, createdAt: now, updatedAt: now }])
    const ok = async (route, options, label) => { const r = await call(route, options); expectStatus(r, 200, 'SETUP ' + (label || route)); return r.data }
    const companyToken = async (p, company) => (await ok('/api/auth/switch-organization', { token: p.plain, method: 'POST', body: { organizationId: String(company) } }, 'switch ' + p.key)).tokens.accessToken
    cust.token = await companyToken(cust, companies.cust); admin.token = await companyToken(admin, companies.cust)
    // The developers turn on 2FA through the real routes; the developer then signs in with password and code (a full session).
    const enable2fa = async p => {
      const setup = await ok('/api/auth/2fa/setup', { token: p.plain, method: 'POST' }, '2fa setup ' + p.key)
      p.totp = setup.secret
      await ok('/api/auth/2fa/enable', { token: p.plain, method: 'POST', body: { code: otp.generateSync({ secret: p.totp, strategy: 'totp' }), backupCodes: setup.backupCodes } }, '2fa enable ' + p.key)
    }
    await enable2fa(dev); await enable2fa(dev2)
    const signIn = async p => {
      const first = await ok('/api/auth/login', { method: 'POST', body: { email: p.email, password: PASSWORD } }, 'login ' + p.key)
      if (!first.requires2FA) return first
      for (let attempt = 0; ; attempt++) {
        const r = await call('/api/auth/2fa/verify', { method: 'POST', body: { tempToken: first.tempToken, code: otp.generateSync({ secret: p.totp, strategy: 'totp' }) } })
        if (r.status === 200) return r.data
        if (attempt > 2) throw Error('SETUP 2FA sign-in ' + p.key + ' ' + r.raw.slice(0, 200))
        await pause(1500)
      }
    }
    const devSession = await signIn(dev); dev.token = devSession.tokens.accessToken; dev.refresh = devSession.tokens.refreshToken
    const custSession = await signIn(cust)
    const sign = (payload, options = { expiresIn: '10m' }, key = secret) => jwt.sign(payload, key, options)
    const unauthForms = [['none', null], ['basic', 'Basic ' + Buffer.from('dev:' + PASSWORD).toString('base64')], ['garbage', 'Bearer not-a-jwt'], ['empty-bearer', 'Bearer '],
      ['wrong-secret', 'Bearer ' + sign({ userId: dev.sid, email: dev.email, type: 'access' }, { expiresIn: '10m' }, crypto.randomBytes(32).toString('hex'))],
      ['expired', 'Bearer ' + sign({ userId: dev.sid, email: dev.email, type: 'access', exp: Math.floor(Date.now() / 1000) - 60 }, {})],
      ['refresh', 'Bearer ' + sign({ userId: dev.sid, email: dev.email, type: 'refresh' })], ['2fa-pending', 'Bearer ' + sign({ userId: dev.sid, email: dev.email, type: '2fa_pending' })],
      ['invite', 'Bearer ' + sign({ userId: dev.sid, email: dev.email, role: 'admin', type: 'invite' })]]
    const ordinary = [['companyless', loner.plain], ['customer-owner', cust.token], ['customer-admin', admin.token], ['developer-before-list', dev.token]]
    const otherPaths = [['GET', '/api/developer/accounts'], ['GET', '/api/developer/entries'], ['POST', '/api/developer/entries'], ['GET', '/api/developer/made-up/deeper'], ['POST', '/api/developer/me'], ['DELETE', '/api/developer/me']]

    // ======================= Piece 5: the developer list and the 開発者 page =======================
    await check(L('P5-signin-files-unchanged'), async () => {
      for (const file of ['server/middleware/auth.ts', 'server/middleware/api.ts', 'server/services/authService.ts', 'server/api/auth/logout.ts', 'server/middleware/viewerReadOnly.ts', 'server/utils/legacyAdminAccess.ts', 'utils/auth-session.ts', 'utils/session-fetch.ts', 'stores/user.ts', 'plugins/session.client.ts'])
        assert.equal(sha(current(file)), sha(atBaseline(file).replace(/\r\n/g, '\n')), file + ' differs from ' + BASELINE)
    })
    await check(L('P5-me-unauthenticated-401'), async () => {
      for (const [name, authorization] of unauthForms) { const r = await call('/api/developer/me', { authorization }); expectStatus(r, 401, 'me ' + name); assert.equal(r.data?.developer, undefined, 'me ' + name + ' carries no answer') }
      for (const [method, route] of otherPaths) for (const [name, authorization] of unauthForms.slice(0, 3)) expectStatus(await call(route, { authorization, method, body: method === 'GET' ? undefined : {} }), 401, method + ' ' + route + ' ' + name)
    })
    await check(L('P5-me-ordinary-false'), async () => {
      for (const [name, token] of ordinary) { const r = await call('/api/developer/me', { token }); expectStatus(r, 200, 'me ' + name); assert.deepEqual(r.data, { developer: false }, 'me ' + name) }
    })
    await check(L('P5-other-paths-403'), async () => {
      for (const [name, token] of ordinary) for (const [method, route] of otherPaths) {
        const r = await call(route, { token, method, body: method === 'GET' ? undefined : {} })
        expectStatus(r, 403, name + ' ' + method + ' ' + route); assert.equal(code(r), 'DEVELOPER_ONLY', name + ' ' + method + ' ' + route + ' code')
      }
    })
    await check(L('P5-add-dry-run'), async () => {
      const r = await manage('add', dev.email, '--note', 'Synthetic operator note')
      assert.equal(r.code, 0, 'dry run exit ' + r.code + ' ' + r.out.slice(0, 300)); assert.match(r.out, /DRY RUN/, 'dry run says so')
      assert.equal(await col('platformdevelopers').countDocuments(), 0, 'a dry run writes nothing')
      assert.deepEqual((await call('/api/developer/me', { token: dev.token })).data, { developer: false }, 'still not a developer after a dry run')
    })
    await check(L('P5-add-apply'), async () => {
      const r = await manage('add', dev.email, '--note', 'Synthetic operator note', '--apply')
      assert.equal(r.code, 0, 'add exit ' + r.code + ' ' + r.out.slice(0, 300))
      const rows = await col('platformdevelopers').find().toArray()
      assert.equal(rows.length, 1); assert.equal(String(rows[0].userId), dev.sid); assert.ok(rows[0].addedAt instanceof Date); assert.equal(rows[0].note, 'Synthetic operator note')
      const me = await call('/api/developer/me', { token: dev.token }); expectStatus(me, 200, 'me after add'); assert.deepEqual(me.data, { developer: true })
      const again = await manage('add', dev.email, '--apply')
      assert.equal(again.code, 0, 'adding an existing developer again is a no-op ' + again.out.slice(0, 200)); assert.equal(await col('platformdevelopers').countDocuments(), 1, 'adding twice keeps one row')
    })
    await check(L('P5-list'), async () => {
      const r = await manage('list'); assert.equal(r.code, 0, r.out.slice(0, 300)); assert.ok(r.out.includes(dev.email) && r.out.includes(dev.sid), 'list names the developer: ' + r.out.slice(0, 300))
    })
    await check(L('P5-developer-passes'), async () => {
      const r = await call('/api/developer/made-up/deeper', { token: dev.token }); expectStatus(r, 404, 'a developer passes the check and meets an unknown path')
      for (const [name, token] of ordinary.slice(0, 3)) assert.deepEqual((await call('/api/developer/me', { token })).data, { developer: false }, 'others stay non-developers: ' + name)
    })
    await check(L('P5-owner-admin-not-developer'), async () => {
      for (const token of [cust.token, admin.token]) { assert.deepEqual((await call('/api/developer/me', { token })).data, { developer: false }); const r = await call('/api/developer/accounts', { token }); expectStatus(r, 403, 'owner/admin'); assert.equal(code(r), 'DEVELOPER_ONLY') }
    })
    await check(L('P5-2fa-required'), async () => {
      assert.equal((await manage('add', nofa.email, '--apply')).code, 0, 'add the listed person without 2FA')
      assert.deepEqual((await call('/api/developer/me', { token: nofa.plain })).data, { developer: true }, 'on the list')
      const r = await call('/api/developer/made-up', { token: nofa.plain }); expectStatus(r, 403, 'no 2FA'); assert.equal(code(r), 'DEVELOPER_2FA_REQUIRED')
      assert.equal((await manage('remove', nofa.email, '--apply')).code, 0, 'remove again')
    })
    await check(L('P5-stale-session-refused'), async () => {
      const changed = await call('/api/users/me/password', { token: dev.token, method: 'POST', body: { currentPassword: PASSWORD, newPassword: PASSWORD + 'x', confirmPassword: PASSWORD + 'x' } })
      expectStatus(changed, 200, 'password change')
      const before = dev.token; dev.token = changed.data.tokens.accessToken
      try {
        const stale = await call('/api/developer/made-up', { token: before }); expectStatus(stale, 401, 'token minted before the password change')
        expectStatus(await call('/api/developer/made-up', { token: dev.token }), 404, 'the new token passes')
      } finally {
        const back = await call('/api/users/me/password', { token: dev.token, method: 'POST', body: { currentPassword: PASSWORD + 'x', newPassword: PASSWORD, confirmPassword: PASSWORD } })
        expectStatus(back, 200, 'password back'); dev.token = back.data.tokens.accessToken
      }
    })
    await check(L('P5-inactive-refused'), async () => {
      await col('users').updateOne({ _id: dev.id }, { $set: { isActive: false } })
      try {
        assert.deepEqual((await call('/api/developer/me', { token: dev.token })).data, { developer: false }, 'an inactive developer is not one')
        const r = await call('/api/developer/made-up', { token: dev.token }); expectStatus(r, 403, 'inactive'); assert.equal(code(r), 'DEVELOPER_ONLY')
      } finally { await col('users').updateOne({ _id: dev.id }, { $set: { isActive: true } }) }
    })
    await check(L('P5-admin-still-refused'), async () => {
      const r = await call('/api/admin/users', { token: dev.token }); expectStatus(r, 403, 'legacy admin for a developer'); assert.equal(code(r), 'GLOBAL_ADMIN_UNAVAILABLE')
    })
    await check(L('P5-no-in-app-writer'), async () => {
      const files = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(ts|js|mjs|vue)$/.test(e.name)) files.push(f) } }
      for (const d of ['server', 'pages', 'components', 'composables', 'stores', 'utils', 'plugins', 'middleware', 'shared']) if (fs.existsSync(path.join(source, d))) walk(path.join(source, d))
      const writers = files.filter(f => /PlatformDeveloper[\w$]*\s*\.\s*(create|insertMany|updateOne|updateMany|findOneAndUpdate|findByIdAndUpdate|replaceOne|deleteOne|deleteMany|findOneAndDelete|findByIdAndDelete|bulkWrite)\b|new\s+PlatformDeveloper\b/.test(fs.readFileSync(f, 'utf8')))
      assert.deepEqual(writers.map(f => path.relative(source, f)), [], 'no app file writes the developer list')
      assert.ok(fs.existsSync(path.join(source, 'server/models/PlatformDeveloper.ts')), 'the model exists')
    })
    if (BROWSER) await check(L('P5-browser-sidebar-link'), async () => {
      const puppeteer = require('puppeteer-core'), executablePath = chromePath()
      assert.ok(executablePath, 'installed Chrome')
      browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'] })
      const sessionFor = data => JSON.stringify({ sessionId: 'test-' + crypto.randomUUID(), tokens: data.tokens, user: data.user, organizations: data.organizations || [], currentOrganization: (data.organizations || [])[0] || null })
      const open = async (data, route) => {
        const context = await browser.createBrowserContext(), page = await context.newPage(), errors = []
        page.on('pageerror', e => errors.push(e.message))
        await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' })
        await page.evaluate(value => localStorage.setItem('ohmyfinance_session', value), sessionFor(data))
        await page.goto(origin + route, { waitUntil: 'networkidle2' })
        return { context, page, errors }
      }
      const fresh = await signIn(dev)
      const d = await open(fresh, '/')
      await d.page.waitForSelector('a[href="/developer"]', { timeout: 20000 })
      await d.page.goto(origin + '/developer', { waitUntil: 'networkidle2' })
      await d.page.waitForSelector('[data-developer-page]', { timeout: 20000 })
      assert.equal(await d.page.$('[data-developer-only]'), null, 'the developer sees the page itself')
      assert.deepEqual(d.errors, [], 'no page error for the developer')
      await d.context.close()
      const c = await open(custSession, '/')
      await c.page.waitForSelector('main', { timeout: 20000 }); await pause(1500)
      assert.equal(await c.page.$('a[href="/developer"]'), null, 'an ordinary user has no 開発者 link')
      await c.page.goto(origin + '/developer', { waitUntil: 'networkidle2' })
      await c.page.waitForSelector('[data-developer-only]', { timeout: 20000 })
      assert.deepEqual(c.errors, [], 'no page error for an ordinary user')
      await c.context.close()
    })
    await check(L('P5-remove'), async () => {
      const r = await manage('remove', dev.email, '--apply'); assert.equal(r.code, 0, r.out.slice(0, 300))
      assert.equal(await col('platformdevelopers').countDocuments({ userId: dev.id }), 0)
      assert.deepEqual((await call('/api/developer/me', { token: dev.token })).data, { developer: false }, 'the next call says false')
      const other = await call('/api/developer/made-up', { token: dev.token }); expectStatus(other, 403, 'removed'); assert.equal(code(other), 'DEVELOPER_ONLY')
      assert.equal((await manage('add', dev.email, '--apply')).code, 0, 'added back for the following checks')
    })
  } catch (error) {
    results.push({ label: 'SETUP', ok: false, why: String(error?.stack || error).slice(0, 1500) })
    console.log('FAIL SETUP :: ' + String(error?.stack || error).slice(0, 1500))
    console.log(logs.slice(-3000))
  } finally {
    if (browser) await browser.close().catch(() => {})
    if (child && child.exitCode === null) { child.kill(); await child.closed }
    if (client) await client.close()
    if (mongo) await mongo.stop()
    if (directory) await fsp.rm(directory, { recursive: true, force: true }).catch(() => {})
  }
  const passed = results.filter(r => r.ok).length, failed = results.filter(r => !r.ok)
  console.log('SUMMARY ' + JSON.stringify({ passed, failed: failed.length, total: results.length, failures: failed.map(f => f.label) }))
  console.log(`${passed} developer checks passed of ${results.length}`)
  if (failed.length) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
