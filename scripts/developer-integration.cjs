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
const AMOUNT = { CUSTMARK: 4321, DEVMARK: 8765, OTHERMARK: 6543 }, AMOUNT_TEXT = { CUSTMARK: '4,321', DEVMARK: '8,765', OTHERMARK: '6,543' }
const SAMPLE_ID = '0123456789abcdef01234567', DB = 'developer_entry_regression', PASSWORD = 'Synthetic-password-Only1!', BASELINE = 'b29dc69'
const pause = ms => new Promise(r => setTimeout(r, ms))
const L = tag => 'developer:' + tag

const results = []
// OMF_DEVELOPER_CHECKS=<regex> runs only the matching checks (for working on one part; the fixture never sets it).
const ONLY = process.env.OMF_DEVELOPER_CHECKS ? new RegExp(process.env.OMF_DEVELOPER_CHECKS) : null
async function check(label, fn) {
  if (ONLY && !ONLY.test(label)) return
  try { await fn(); results.push({ label, ok: true }); console.log('PASS ' + label) }
  catch (error) { const why = String(error?.message || error).replace(/\s+/g, ' ').slice(0, 600); results.push({ label, ok: false, why }); console.log('FAIL ' + label + ' :: ' + why) }
}
const sha = text => crypto.createHash('sha256').update(text).digest('hex')
const clockless = text => String(text).replace(/"observedAt":\d+/g, '"observedAt":0') // a Navi status answer stamps its own read time
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
      const send = () => fetch(origin + route, { method, headers: h, ...(payload === undefined ? {} : { body: payload }), redirect: 'manual', signal: AbortSignal.timeout(30000) })
      // A GET that meets a keep-alive socket the server has just closed is sent once more; nothing else is ever repeated.
      let r; try { r = await send() } catch (error) { if (method !== 'GET' || error?.name === 'TimeoutError') throw error; await pause(100); r = await send() }
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

    // ======================= Piece 7: developer entry (§4) =======================
    // More invented people: a 閲覧のみ member of another company, a second customer with its own data, and a second developer.
    const viewer = await person('viewer', 'Synthetic Viewer Member'), vowner = await person('vowner', 'Synthetic Viewer Company Owner'), other = await person('other', 'Synthetic Other Customer')
    const quiet = await person('quiet', 'Synthetic Companyless Customer')
    companies.cust2 = new ObjectId(); companies.viewer = new ObjectId(); companies.other = new ObjectId()
    await col('organizations').insertMany([
      { _id: companies.cust2, name: 'Synthetic Customer Branch', slug: 'synthetic-customer-branch', type: 'business', isActive: true, members: [member(cust, 'owner')], settings, createdAt: now, updatedAt: now },
      { _id: companies.viewer, name: 'Synthetic Viewer Company', slug: 'synthetic-viewer-company', type: 'business', isActive: true, members: [member(vowner, 'owner'), member(viewer, 'viewer')], settings, createdAt: now, updatedAt: now },
      { _id: companies.other, name: 'Synthetic Other Company', slug: 'synthetic-other-company', type: 'business', isActive: true, members: [member(other, 'owner')], settings, createdAt: now, updatedAt: now }])
    other.token = await companyToken(other, companies.other)
    dev.companyToken = await companyToken({ ...dev, plain: dev.token }, companies.dev)
    // Marked data, written by each owner through the ordinary routes: the customer's (CUSTMARK), the developer's own (DEVMARK) and
    // the other customer's (OTHERMARK). A page or answer inside an entry must hold the first and neither of the others.
    const seed = async (who, token, mark) => {
      await ok('/api/transactions', { token, method: 'POST', body: { date: '2026-11-20', amount: AMOUNT[mark], type: '支出', productName: mark + ' transaction', description: mark + ' transaction', notes: mark + ' transaction' } }, 'seed transaction ' + who)
      await ok('/api/invoices', { token, method: 'POST', body: { from: { name: mark + ' issuer' }, to: { name: mark + ' client' }, items: [{ description: mark + ' invoice line', quantity: 1, unitPrice: 1000 }] } }, 'seed invoice ' + who)
      await ok('/api/budgets', { token, method: 'POST', body: { name: mark + ' budget', amount: 50000, currency: 'JPY' } }, 'seed budget ' + who)
      await ok('/api/payments', { token, method: 'POST', body: { title: mark + ' payment', amount: 2200, currency: 'JPY', dueDate: '2026-11-28', type: 'expense', category: 'Synthetic' } }, 'seed payment ' + who)
      await ok('/api/finance-intake/records', { token, method: 'POST', body: { values: { description: mark + ' intake order', merchant: mark + ' shop' } } }, 'seed intake ' + who)
      // A Navi turn needs a paired worker that is seen (OMF answers 409 otherwise); the worker never answers, so the question stays.
      const card = (await ok('/api/finance/accounts', { token, method: 'POST', body: { name: 'Synthetic ' + who + ' Amex', provider: 'amex', primaryCard: '12345', cardIdentifiers: ['12345'], otpRecipient: who + '@example.invalid', otpMailbox: who + '@example.invalid' } }, 'card account ' + who)).account
      const agent = await ok('/api/finance-chat/agents', { token, method: 'POST', body: { accountIds: [String(card._id)], workspaceEnabled: true } }, 'worker ' + who)
      expectStatus(await call('/api/finance-chat/worker/heartbeat', { token: agent.token, method: 'POST', body: {} }), 200, 'SETUP heartbeat ' + who)
      await ok('/api/finance-chat/company-workspace', { token, method: 'POST', body: { requestId: crypto.randomBytes(16).toString('hex'), chatRevision: 0, text: mark + ' navi question', context: { page: 'dashboard' } } }, 'seed navi ' + who)
      return { card, agent }
    }
    const custSeed = await seed('customer', cust.token, 'CUSTMARK'); await seed('developer', dev.companyToken, 'DEVMARK'); await seed('other', other.token, 'OTHERMARK')
    await col('receipts').insertMany([['CUSTMARK', companies.cust], ['DEVMARK', companies.dev], ['OTHERMARK', companies.other]].map(([mark, organizationId], i) => ({ _id: new ObjectId(), organizationId, filename: mark.toLowerCase() + '-receipt-' + i + '.png', originalName: mark + ' receipt.png', merchant: mark + ' receipt shop', date: now, total: 990, totalAmount: 990, currency: 'JPY', status: 'processed', createdAt: now, updatedAt: now })))
    // The customer's card account, bank account, PC (downloader), worker and review worker: the ten paths of §2 point at them.
    const amex = custSeed.card, worker = custSeed.agent
    const bankAccount = (await ok('/api/finance-payments/bank/accounts', { token: cust.token, method: 'POST', body: { name: 'Synthetic customer bank', currency: 'JPY' } }, 'bank account')).account
    const collector = await ok('/api/finance/collectors', { token: cust.token, method: 'POST', body: { name: 'Synthetic customer PC', accountIds: [String(amex._id)] } }, 'collector')
    const reviewer = await ok('/api/finance-review/agents', { token: cust.token, method: 'POST', body: { teamId: 'TSYNTH01', userId: 'USYNTH01', channelId: 'DSYNTH01', accountIds: [String(amex._id)] } }, 'review worker')
    assert.equal((await manage('add', dev2.email, '--apply')).code, 0, 'SETUP second developer')

    const snapshot = async (except = ['developerentryrequests']) => { const out = {}; for (const n of (await db.listCollections().toArray()).map(c => c.name).sort()) { if (except.includes(n)) continue; const docs = await col(n).find().sort({ _id: 1 }).toArray(); if (docs.length) out[n] = docs } return JSON.stringify(out) }
    const enter = (target, company, { reason = 'Synthetic support check', token = dev.token } = {}) => call('/api/developer/entries', { token, method: 'POST', body: { userId: target.sid, organizationId: company ? String(company) : '', reason } })
    const entered = async (target = cust, company = companies.cust, options) => { const r = await enter(target, company, options); expectStatus(r, 200, 'POST /api/developer/entries'); assert.ok(r.data?.token, 'an entry token'); return { ...r.data, eid: jwt.decode(r.data.token)?.eid } }
    const rowOf = eid => col('developerentries').findOne({ _id: new ObjectId(eid) })
    const linesOf = eid => col('developerentryrequests').find({ entryId: new ObjectId(eid) }).sort({ _id: 1 }).toArray()
    const ended = (r, label) => { expectStatus(r, 401, label); assert.equal(code(r), 'DEVELOPER_ENTRY_ENDED', label + ' code ' + r.raw.slice(0, 200)) }
    const refusedInside = (r, label) => { expectStatus(r, 403, label); assert.equal(code(r), 'DEVELOPER_ENTRY_REFUSED', label + ' code ' + r.raw.slice(0, 200)) }
    const intakeIds = async token => { const r = await call('/api/finance-intake/records', { token }); expectStatus(r, 200, 'intake list'); return r.data.records.map(x => x.id).sort() }
    const custUserBefore = await col('users').findOne({ _id: cust.id })
    const custAuditBefore = await col('auditlogs').countDocuments({ userId: cust.sid })

    await check(L('E-signin-unchanged-except-4.8'), async () => {
      for (const file of ['server/middleware/auth.ts', 'server/api/auth/logout.ts', 'server/middleware/viewerReadOnly.ts', 'server/utils/legacyAdminAccess.ts', 'plugins/session.client.ts', 'middleware/auth.global.ts', 'middleware/auth.ts', 'middleware/admin.ts', 'composables/useAuth.ts', 'components/security/ScreenLockOverlay.vue', 'server/api/auth/me.ts', 'server/api/auth/refresh.ts', 'server/api/auth/2fa/verify.ts', 'server/api/auth/accept-invite.ts', 'server/api/invites/accept.ts', 'server/api/users/me/password.ts'])
        assert.equal(sha(current(file)), sha(atBaseline(file).replace(/\r\n/g, '\n')), file + ' differs from ' + BASELINE)
      const fn = (text, name) => { const start = text.search(new RegExp('export (async )?function ' + name + '\\(')); assert.ok(start >= 0, 'function ' + name); const end = text.indexOf('\n}\n', start); assert.ok(end > start, 'end of ' + name); return text.slice(start, end + 2) }
      const now = current('server/services/authService.ts'), then = atBaseline('server/services/authService.ts').replace(/\r\n/g, '\n')
      for (const name of ['generateTokens', 'verifyToken', 'verifyAccessToken', 'registerUser', 'authenticatePrimary', 'loginUser', 'refreshTokens', 'revokeRefreshToken', 'revokeToken', 'completeLoginAfter2FA', 'switchOrganization', 'inviteUser', 'acceptInvite'])
        assert.equal(fn(now, name), fn(then, name), 'authService ' + name + ' is not edited')
      assert.ok(/export function signEntryToken\(/.test(now) && /export function verifyEntryToken\(/.test(now), 'authService gains signEntryToken and verifyEntryToken')
      const apiNow = current('server/middleware/api.ts').split('\n'), apiThen = atBaseline('server/middleware/api.ts').replace(/\r\n/g, '\n').split('\n')
      const changed = apiNow.filter(l => !apiThen.includes(l)), dropped = apiThen.filter(l => !apiNow.includes(l))
      assert.ok(changed.some(l => /verifyAccessToken\(token\)\s*&&\s*!verifyEntryToken\(token\)/.test(l)), 'api.ts lets a token through when verifyAccessToken or verifyEntryToken accepts it: ' + JSON.stringify(changed))
      assert.ok(dropped.every(l => /verifyAccessToken|before auth\.ts/.test(l)) && changed.every(l => /verifyAccessToken|verifyEntryToken|developerEntry|entry row|developer entry/.test(l)), 'api.ts changes only the token line, its import and its comment: ' + JSON.stringify({ changed, dropped }))
    })
    await check(L('E-accounts'), async () => {
      const r = await call('/api/developer/accounts', { token: dev.token }); expectStatus(r, 200, 'accounts')
      const c = r.data.accounts.find(a => a.id === cust.sid)
      assert.ok(c, 'the customer is listed'); assert.deepEqual(Object.keys(c).sort(), ['companies', 'email', 'id', 'name'], 'id, email, name and companies only')
      assert.equal(c.email, cust.email); assert.equal(c.name, cust.name)
      assert.deepEqual(c.companies.map(x => x.name).sort(), ['Synthetic Customer Branch', 'Synthetic Customer Trading'])
      for (const x of c.companies) assert.deepEqual(Object.keys(x).sort(), ['id', 'name'], 'a company carries its id and name only')
      for (const d of [dev, dev2]) assert.ok(!r.data.accounts.some(a => a.id === d.sid), 'a developer is not offered for entry')
      assert.ok(!r.raw.includes('password') && !r.raw.includes('twoFactor') && !r.raw.includes('sessionVersion'), 'no credential field')
      const n = await call('/api/developer/accounts', { token: cust.token }); expectStatus(n, 403, 'non-developer'); assert.equal(code(n), 'DEVELOPER_ONLY')
    })
    let main1, startFailure = 'E-start did not run'
    const needMain = () => { if (!main1) throw Error('no entry to work in: ' + startFailure); return main1 }
    await check(L('E-start'), async () => {
      const r = await enter(cust, companies.cust); startFailure = 'POST /api/developer/entries answered ' + r.status + ' ' + r.raw.slice(0, 120)
      expectStatus(r, 200, 'POST /api/developer/entries'); main1 = { ...r.data, eid: jwt.decode(r.data.token)?.eid }
      const claims = jwt.decode(main1.token)
      assert.equal(claims.type, 'entry'); assert.match(claims.eid, /^[a-f0-9]{24}$/); assert.ok(claims.jti); assert.equal(claims.forUser, cust.sid); assert.equal(claims.forCompany, String(companies.cust))
      for (const key of ['userId', 'email', 'organizationId', 'role', 'sv']) assert.equal(claims[key], undefined, 'the entry token carries no ' + key)
      const row = await rowOf(claims.eid)
      assert.equal(String(row.developerId), dev.sid); assert.equal(String(row.targetUserId), cust.sid); assert.equal(String(row.organizationId), String(companies.cust)); assert.equal(row.reason, 'Synthetic support check')
      assert.equal(row.endedAt, null); assert.equal(row.jti, claims.jti)
      assert.ok(Math.abs(row.endsAt - row.startedAt - 3600000) < 1000, '60 minutes'); assert.ok(Math.abs(claims.exp * 1000 - row.endsAt.getTime()) < 1000, 'the token expires when the entry ends')
      assert.ok(row.ipAddress && row.userAgent !== undefined, 'address and browser of the developer kept')
      assert.equal(main1.user.id || main1.user._id, cust.sid); assert.equal(String(main1.currentOrganization?.id), String(companies.cust)); assert.ok(main1.organizations.length === 2)
      for (const key of ['password', 'twoFactorSecret', 'twoFactorBackupCodes', 'trustedDevices']) assert.equal(main1.user[key], undefined, 'no ' + key)
      assert.equal(main1.user.securityPreferences?.pinHash, undefined)
    })
    await check(L('E-customer-audit-entered'), async () => {
      needMain()
      const r = await call('/api/audit?limit=100', { token: cust.token }); expectStatus(r, 200, 'customer audit')
      const line = r.data.logs.find(l => l.action === 'developer_entered' && (l.metadata?.entryId === main1.eid))
      assert.ok(line, 'the customer sees "developer entered" ' + JSON.stringify(r.data.logs.map(l => l.action)))
      assert.equal(line.metadata.reason, 'Synthetic support check')
    })
    await check(L('E-reads-as-customer'), async () => {
      needMain()
      const me = await call('/api/auth/me', { token: main1.token }); expectStatus(me, 200, 'me inside'); assert.equal(me.data.user.id, cust.sid); assert.equal(String(me.data.currentOrganization?.id), String(companies.cust))
      assert.deepEqual(await intakeIds(main1.token), await intakeIds(cust.token), 'the intake list equals the customer\'s, id by id (financeUser)')
      const tx = await call('/api/transactions', { token: main1.token }); expectStatus(tx, 200, 'transactions inside (api.ts)')
      assert.ok(tx.raw.includes('CUSTMARK') && !tx.raw.includes('DEVMARK') && !tx.raw.includes('OTHERMARK'), 'the customer\'s transactions')
      for (const route of ['/api/invoices', '/api/budgets', '/api/payments', '/api/receipts']) { const r = await call(route, { token: main1.token }); expectStatus(r, 200, route); assert.ok(r.raw.includes('CUSTMARK') && !r.raw.includes('DEVMARK') && !r.raw.includes('OTHERMARK'), route + ' holds the customer\'s data only') }
    })
    await check(L('E-navi-history-equal'), async () => {
      needMain()
      for (const route of ['/api/finance-chat/company-workspace', '/api/finance-chat/workspace', '/api/finance-chat/company-workspace/status']) {
        const a = await call(route, { token: main1.token }), b = await call(route, { token: cust.token })
        expectStatus(a, 200, route + ' inside'); assert.equal(clockless(a.raw), clockless(b.raw), route + ' inside equals the customer\'s (the read time aside)')
      }
      assert.ok((await call('/api/finance-chat/company-workspace', { token: main1.token })).raw.includes('CUSTMARK navi question'), 'the customer\'s Navi conversation')
    })
    await check(L('E-api-ts'), async () => {
      needMain()
      for (const [name, authorization] of unauthForms) expectStatus(await call('/api/transactions', { authorization }), 401, 'transactions ' + name)
      for (const [name, authorization] of unauthForms) expectStatus(await call('/api/admin/users', { authorization }), 401, 'admin ' + name)
      expectStatus(await call('/api/transactions', { token: main1.token }), 200, 'an open entry reads /api/transactions')
    })
    await check(L('E-forged-claims-act-as-row-target'), async () => {
      needMain()
      const claims = jwt.decode(main1.token), custIds = await intakeIds(cust.token)
      for (const [name, extra] of [['foreign forUser/forCompany', { forUser: other.sid, forCompany: String(companies.other) }], ['real other userId', { userId: other.sid, email: other.email, organizationId: String(companies.other), role: 'owner' }], ['made-up userId', { userId: new ObjectId().toHexString() }]]) {
        const forged = sign({ type: 'entry', eid: claims.eid, jti: claims.jti, forUser: claims.forUser, forCompany: claims.forCompany, ...extra }, { expiresIn: '10m' })
        const me = await call('/api/auth/me', { token: forged }); expectStatus(me, 200, name + ' me'); assert.equal(me.data.user.id, cust.sid, name + ': the row\'s target')
        assert.deepEqual(await intakeIds(forged), custIds, name + ': the customer\'s intake list')
        const tx = await call('/api/transactions', { token: forged }); assert.ok(tx.raw.includes('CUSTMARK') && !tx.raw.includes('OTHERMARK'), name + ': the customer\'s transactions')
      }
    })
    await check(L('E-access-type-with-eid-opens-nothing'), async () => {
      needMain()
      const claims = jwt.decode(main1.token), fake = sign({ type: 'access', eid: claims.eid, jti: claims.jti }, { expiresIn: '10m' })
      for (const route of ['/api/auth/me', '/api/finance-intake/records', '/api/transactions', '/api/invoices']) expectStatus(await call(route, { token: fake }), 401, route)
      expectStatus(await call('/api/developer/me', { token: fake }), 401, 'developer me')
    })
    // verifyAccessToken is the only guard of the two invitation routes (accept-invite.ts:22, invites/accept.ts:53) for a token the entry
    // middleware passes over (no entry id). A signed token of the entry type that names the customer in userId must sign in nobody there.
    await check(L('E-verifyAccessToken-refuses-entry-type'), async () => {
      const forged = sign({ type: 'entry', userId: cust.sid, email: cust.email, sv: 0, jti: crypto.randomUUID(), forUser: cust.sid }, { expiresIn: '10m' })
      const devMembers = JSON.stringify((await col('organizations').findOne({ _id: companies.dev })).members)
      const inv = await call('/api/organizations/' + companies.dev + '/invite', { token: dev.companyToken, method: 'POST', body: { email: cust.email, role: 'member' } }); expectStatus(inv, 200, 'SETUP invitation token')
      const a = await call('/api/auth/accept-invite', { token: forged, method: 'POST', body: { inviteToken: inv.data.inviteToken } })
      assert.notEqual(a.status, 200, 'accept-invite with an entry-type token answered 200'); assert.equal(a.data?.tokens, undefined, 'no tokens from accept-invite')
      const stored = { token: crypto.randomBytes(32).toString('hex'), email: cust.email, organizationId: companies.dev, role: 'member', createdBy: dev.id, expiresAt: new Date(Date.now() + 600000), status: 'pending', createdAt: new Date() }
      await col('invites').insertOne(stored)
      try {
        const b = await call('/api/invites/accept', { token: forged, method: 'POST', body: { token: stored.token } })
        assert.equal(b.data?.tokens, undefined, 'no tokens from invites/accept'); assert.equal(b.data?.requiresLogin, true, 'the entry-type token is not a sign-in')
      } finally { await col('invites').deleteOne({ _id: stored._id }) }
      assert.equal(JSON.stringify((await col('organizations').findOne({ _id: companies.dev })).members), devMembers, 'no membership added')
      expectStatus(await call('/api/auth/me', { token: forged }), 401, 'and nothing else either')
    })
    await check(L('E-refresh-and-revoke-refuse-entry'), async () => {
      needMain()
      const before = await col('revokedtokens').countDocuments()
      expectStatus(await call('/api/auth/refresh', { method: 'POST', body: { refreshToken: main1.token } }), 401, 'entry token as a refresh token')
      const spare = jwt.sign({ userId: dev2.sid, email: dev2.email, sv: 0, jti: crypto.randomUUID() }, secret, { expiresIn: '10m' })
      const out = await call('/api/auth/logout', { token: spare, method: 'POST', body: { refreshToken: main1.token } }); expectStatus(out, 200, 'ordinary logout carrying the entry token as refresh token')
      assert.equal(out.data.tokensRevoked.refresh, false, 'revokeRefreshToken refuses it')
      assert.equal(await col('revokedtokens').countDocuments(), before, 'nothing stored')
      expectStatus(await call('/api/auth/me', { token: main1.token }), 200, 'the entry is still open')
    })
    await check(L('E-2fa-refuses-entry'), async () => {
      needMain()
      const r = await call('/api/auth/2fa/verify', { method: 'POST', body: { tempToken: main1.token, code: '123456' } }); expectStatus(r, 401, 'entry token as the 2FA token'); assert.equal(r.data?.tokens, undefined)
      refusedInside(await call('/api/auth/2fa/verify', { token: main1.token, method: 'POST', body: { tempToken: main1.token, code: '123456' } }), '2FA path inside')
    })
    await check(L('E-invitation-misuses-fail'), async () => {
      needMain()
      const devMembers = JSON.stringify((await col('organizations').findOne({ _id: companies.dev })).members), custMembers = JSON.stringify((await col('organizations').findOne({ _id: companies.cust })).members), invitesBefore = await col('invites').countDocuments()
      // 1: the developer (own session) invites the customer's email into the developer's own company, then accepts it with the entry token.
      const inv = await call('/api/organizations/' + companies.dev + '/invite', { token: dev.companyToken, method: 'POST', body: { email: cust.email, role: 'member' } }); expectStatus(inv, 200, 'developer invites the customer\'s email')
      const accepted = await call('/api/auth/accept-invite', { token: main1.token, method: 'POST', body: { inviteToken: inv.data.inviteToken } }); refusedInside(accepted, 'accept-invite inside'); assert.equal(accepted.data?.tokens, undefined, 'no tokens')
      const stored = { token: crypto.randomBytes(32).toString('hex'), email: cust.email, organizationId: companies.dev, role: 'member', createdBy: dev.id, expiresAt: new Date(Date.now() + 600000), status: 'pending', createdAt: new Date() }
      await col('invites').insertOne(stored)
      const accepted2 = await call('/api/invites/accept', { token: main1.token, method: 'POST', body: { token: stored.token } }); refusedInside(accepted2, 'invites/accept inside'); assert.equal(accepted2.data?.tokens, undefined, 'no tokens')
      refusedInside(await call('/api/invites/' + stored.token, { token: main1.token }), 'invite read inside')
      assert.equal(JSON.stringify((await col('organizations').findOne({ _id: companies.dev })).members), devMembers, 'no membership added to the developer\'s company')
      // 2: from inside, inviting the developer's own email into the customer's company.
      refusedInside(await call('/api/organizations/' + companies.cust + '/invite', { token: main1.token, method: 'POST', body: { email: dev.email, role: 'admin' } }), 'invite route inside')
      refusedInside(await call('/api/organizations/' + companies.cust + '/invites', { token: main1.token, method: 'POST', body: { email: dev.email, role: 'admin' } }), 'invites route inside')
      assert.equal(JSON.stringify((await col('organizations').findOne({ _id: companies.cust })).members), custMembers, 'no membership added to the customer\'s company')
      assert.equal(await col('invites').countDocuments(), invitesBefore + 1, 'no invitation made from inside (only the one stored by the test)')
      await col('invites').deleteOne({ _id: stored._id })
    })
    await check(L('E-me-inside-false-no-line'), async () => {
      needMain()
      const before = (await linesOf(main1.eid)).length
      const r = await call('/api/developer/me', { token: main1.token }); expectStatus(r, 200, 'me inside'); assert.deepEqual(r.data, { developer: false })
      assert.equal((await linesOf(main1.eid)).length, before, 'no line, refused or not')
    })
    await check(L('E-closed-paths-inside'), async () => {
      needMain()
      const before = (await linesOf(main1.eid)).length
      const closed = [['GET', '/api/developer/accounts'], ['GET', '/api/developer/entries'], ['POST', '/api/developer/entries'], ['GET', '/api/developer/made-up'], ['POST', '/api/auth/switch-organization'], ['POST', '/api/auth/verify-password'], ['POST', '/api/auth/verify-pin'], ['POST', '/api/auth/set-pin'], ['POST', '/api/auth/disable-pin'], ['POST', '/api/auth/2fa/setup'], ['POST', '/api/auth/2fa/enable'], ['POST', '/api/auth/2fa/disable'], ['PUT', '/api/auth/security-preferences'], ['POST', '/api/auth/login'], ['POST', '/api/auth/register'], ['POST', '/api/auth/refresh'], ['GET', '/api/auth/made-up'], ['GET', '/api/invites/' + 'a'.repeat(64)]]
      for (const [method, route] of closed) refusedInside(await call(route, { token: main1.token, method, body: method === 'GET' ? undefined : { organizationId: String(companies.cust2), password: PASSWORD } }), method + ' ' + route)
      const lines = (await linesOf(main1.eid)).slice(before)
      assert.equal(lines.length, closed.length, 'each refusal is recorded'); assert.ok(lines.every(l => l.refused === true), 'marked refused')
      const legacy = await call('/api/admin/users', { token: main1.token }); expectStatus(legacy, 403, 'legacy admin inside'); assert.equal(code(legacy), 'GLOBAL_ADMIN_UNAVAILABLE', 'legacyAdminAccess answers inside an entry too')
    })
    await check(L('E-route-tree-refused-before-handler'), async () => {
      needMain()
      const files = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(ts|js|mjs)$/.test(e.name)) files.push(path.relative(path.join(source, 'server/api'), f).split(path.sep).join('/')) } }
      walk(path.join(source, 'server/api'))
      const SAMPLE = '0123456789abcdef01234567'
      const urls = new Set(); let catchAlls = 0
      for (const rel of files) {
        const parts = rel.replace(/\.(ts|js|mjs)$/, '').replace(/\.(get|post|put|patch|delete|head)$/, '').split('/'); if (parts[parts.length - 1] === 'index') parts.pop()
        const at = parts.findIndex(s => /^\[\.\.\.[^\]]+\]$/.test(s)), segs = parts.map(s => /^\[[^\]]+\]$/.test(s) ? SAMPLE : s)
        if (at >= 0) { catchAlls++; const base = '/api/' + segs.slice(0, at).join('/'); urls.add(base + '/x'); urls.add(base + '/made-up/deeper/path') } else urls.add('/api/' + segs.join('/'))
      }
      assert.ok(files.length >= 120 && catchAlls >= 16, 'the route tree is read at test time: ' + files.length + ' files, ' + catchAlls + ' catch-alls')
      const before = await snapshot(), linesBefore = (await linesOf(main1.eid)).length
      let sent = 0
      for (const url of [...urls].sort()) for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        if (method === 'POST' && url === '/api/auth/logout') continue
        sent++
        const r = await call(url, { token: main1.token, method, body: {} })
        refusedInside(r, method + ' ' + url)
      }
      assert.equal(await snapshot(), before, 'nothing written by any refused request')
      assert.equal((await linesOf(main1.eid)).length - linesBefore, sent, 'one refused line each')
      console.log('INFO route tree: ' + files.length + ' route files, ' + catchAlls + ' catch-alls, ' + urls.size + ' paths, ' + sent + ' write requests refused')
    })
    await check(L('E-allowed-path-variants-refused'), async () => {
      needMain()
      const id = SAMPLE_ID
      const variants = [['POST', '/api/finance-intake/files/'], ['POST', '/api/finance-intake/files/x'], ['POST', '/api/finance-intake/Files'], ['POST', '/api/finance-intake/files%2F' + id + '%2Fpreview'], ['POST', '/api/finance-intake/files/' + id + '/preview/x'], ['POST', '/api/finance-intake/files/' + id.toUpperCase() + '/preview'], ['POST', '/api/finance-intake/files/' + id + '/import/'], ['POST', '/api/finance-intake/files/' + id + '%2Fimport'], ['POST', '/api/finance-intake/records/'], ['POST', '/api/finance-intake/Records'], ['POST', '/api/finance-intake/records/x'], ['PATCH', '/api/finance-intake/records/' + id + '/x'], ['PATCH', '/api/finance-intake/records/' + id.toUpperCase()], ['PATCH', '/api/finance-intake/records/' + id.slice(1)], ['PATCH', '/api/finance-intake/records/' + id + '0'], ['PUT', '/api/finance-intake/records/' + id + '/archive/x'], ['PUT', '/api/finance-intake/records/' + id + '/Archive'], ['PUT', '/api/finance-intake/records/' + id + '%2Farchive'], ['POST', '/api/finance-intake/records/' + id + '/documents/x'], ['POST', '/api/finance-intake/records/' + id + '%2Fdocuments'], ['PUT', '/api/finance-intake/templates/'], ['PUT', '/api/finance-intake/templates/x'], ['PUT', '/api/finance-intake/Templates'], ['PUT', '/api/finance-intake%2Ftemplates'], ['POST', '/api/finance-intake/records/' + id + '/research'], ['POST', '/api/finance-intake/records/' + id + '/research/confirm'], ['PUT', '/api/finance-intake/records/' + id], ['DELETE', '/api/finance-intake/records/' + id], ['PATCH', '/api/finance-intake/templates']]
      for (const [method, route] of variants) refusedInside(await call(route, { token: main1.token, method, body: {} }), method + ' ' + route)
    })
    await check(L('E-ten-paths-change-nothing'), async () => {
      needMain()
      const a = String(amex._id), b = String(bankAccount.id || bankAccount._id), c = String(collector.id)
      const ten = [['POST', '/api/finance/accounts/' + a + '/sync', {}], ['PUT', '/api/finance/accounts/' + a + '/auto-sync', { enabled: true, hour: 6 }], ['PUT', '/api/finance/accounts/' + a + '/billing-mail', { enabled: true }],
        ['PUT', '/api/finance-payments/bank/accounts/' + b + '/connection', { provider: 'synthetic' }], ['POST', '/api/finance-payments/bank/accounts/' + b + '/sync', {}], ['PUT', '/api/finance-payments/bank/accounts/' + b + '/schedule', { enabled: true }], ['PUT', '/api/finance-payments/bank/accounts/' + b + '/balance', { enabled: true }], ['POST', '/api/finance-payments/bank/accounts/' + b + '/balance/refresh', {}], ['PUT', '/api/finance-payments/bank/collectors/' + c, { bankAccountIds: [b] }], ['PUT', '/api/finance-workflow/settings', { enabled: true }]]
      const before = await snapshot()
      for (const [method, route, body] of ten) refusedInside(await call(route, { token: main1.token, method, body }), method + ' ' + route)
      assert.equal(await snapshot(), before, 'the ten paths change nothing')
    })
    await check(L('E-navi-writes-refused'), async () => {
      needMain()
      const before = await snapshot(), status = clockless((await call('/api/finance-chat/company-workspace/status', { token: cust.token })).raw)
      for (const [route, body] of [['/api/finance-chat/company-workspace', { requestId: crypto.randomBytes(16).toString('hex'), chatRevision: 1, text: 'DEVENTRY navi from inside', context: { page: 'dashboard' } }], ['/api/finance-chat/company-workspace/read', { replies: [], research: false }], ['/api/finance-chat/company-workspace/new', {}], ['/api/finance-chat/workspace', { requestId: crypto.randomBytes(16).toString('hex'), chatRevision: 0, text: 'DEVENTRY owner navi' }], ['/api/finance-chat/workspace/read', {}]])
        refusedInside(await call(route, { token: main1.token, method: 'POST', body }), 'POST ' + route)
      assert.equal(await snapshot(), before, 'conversation and unread mark unchanged')
      assert.equal(clockless((await call('/api/finance-chat/company-workspace/status', { token: cust.token })).raw), status,'the customer\'s Navi status (unread) unchanged')
    })
    await check(L('E-old-upload-answered-by-entry'), async () => {
      needMain()
      const uploads = path.join(root, 'uploads'), list = d => fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).sort().join('|') : ''
      const before = list(uploads)
      for (const kind of ['transaction', 'receipt']) {
        const form = new FormData(); form.append('file', new Blob([Buffer.from('date,amount\n2026-11-20,1\n')], { type: 'text/csv' }), 'entry.csv')
        const r = await fetch(origin + '/api/upload/' + kind, { method: 'POST', headers: { Authorization: 'Bearer ' + main1.token }, body: form }), text = await r.text(); let data; try { data = JSON.parse(text) } catch {}
        assert.equal(r.status, 403, kind + ' upload inside answered ' + r.status + ' ' + text.slice(0, 200)); assert.equal(data?.data?.code, 'DEVELOPER_ENTRY_REFUSED', 'answered by developerEntry.ts before the upload middleware')
      }
      assert.equal(list(uploads), before, 'no file written')
    })
    let allowedRecord
    await check(L('E-eight-allowed-writes-saved-and-lined'), async () => {
      needMain()
      const t = main1.token, before = (await linesOf(main1.eid)).length, sent = []
      const go = async (method, route, options = {}) => { const r = await call(route, { token: t, method, ...options }); expectStatus(r, 200, method + ' ' + route.split('?')[0]); sent.push([method, route.split('?')[0]]); return r.data }
      const csv = Buffer.from('注文番号,商品名,購入金額,購入状況\r\nENTRY-0001,Synthetic entry item one,1200,購入済み\r\nENTRY-0002,Synthetic entry item two,3400,購入済み\r\n', 'utf8')
      const doc = (await go('POST', '/api/finance-intake/files?name=entry-orders.csv', { raw: csv, headers: { 'Content-Type': 'text/csv' } })).document
      const sheet = await call('/api/finance-intake/files/' + doc.id + '/sheet?sheet=' + encodeURIComponent(doc.sheetNames[0]) + '&headerRow=1', { token: t }); expectStatus(sheet, 200, 'sheet read'); sent.push(['GET', '/api/finance-intake/files/' + doc.id + '/sheet'])
      const plan = { sheet: doc.sheetNames[0], headerRow: 1, mapping: sheet.data.mapping, defaults: { service: '自社受付', account: '', currency: 'JPY' } }
      assert.equal((await go('POST', '/api/finance-intake/files/' + doc.id + '/preview', { body: plan })).counts.new, 2, 'preview')
      assert.equal((await go('POST', '/api/finance-intake/files/' + doc.id + '/import', { body: plan })).batch.counts.new, 2, 'import')
      let rec = await go('POST', '/api/finance-intake/records', { body: { values: { description: 'Synthetic entry hand order' } } })
      rec = await go('PATCH', '/api/finance-intake/records/' + rec.id, { body: { revision: rec.revision, values: { merchant: 'Synthetic entry shop' } } })
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
      await go('POST', '/api/finance-intake/records/' + rec.id + '/documents?name=entry-note.png&kind=attachment', { raw: png, headers: { 'Content-Type': 'image/png' } })
      rec = (await call('/api/finance-intake/records/' + rec.id, { token: t })).data; sent.push(['GET', '/api/finance-intake/records/' + rec.id])
      rec = await go('PUT', '/api/finance-intake/records/' + rec.id + '/archive', { body: { revision: rec.revision, archived: true } })
      await go('PUT', '/api/finance-intake/templates', { body: { name: 'Synthetic entry template', service: '自社受付', account: '', currency: 'JPY', headers: ['注文番号', '商品名', '購入金額', '購入状況'], mapping: plan.mapping } })
      allowedRecord = rec
      const records = await col('financeintakerecords').find({ 'values.orderId': { $in: ['ENTRY-0001', 'ENTRY-0002'] } }).toArray()
      assert.equal(records.length, 2); assert.ok(records.every(r => String(r.ownerId) === cust.sid), 'imported into the customer\'s account')
      const hand = await col('financeintakerecords').findOne({ _id: new ObjectId(rec.id) }); assert.equal(String(hand.ownerId), cust.sid); assert.equal(hand.values.merchant, 'Synthetic entry shop'); assert.equal(hand.archived, true)
      assert.equal(await col('financeintaketemplates').countDocuments({ ownerId: cust.id, name: 'Synthetic entry template' }), 1, 'template saved for the customer')
      await pause(300)
      const lines = (await linesOf(main1.eid)).slice(before)
      assert.equal(lines.length, sent.length, 'one line per request')
      for (let i = 0; i < sent.length; i++) { assert.equal(lines[i].method, sent[i][0]); assert.equal(lines[i].path, sent[i][1]); assert.equal(lines[i].refused, false); assert.equal(lines[i].status, 200, 'status added when the response is sent: ' + JSON.stringify(lines[i])) }
    })
    await check(L('E-line-write-fails-refuses-everything'), async () => {
      needMain()
      await col('developerentryrequests').insertOne({ entryId: new ObjectId(main1.eid), at: new Date(), method: 'GET', path: '/probe', status: 0, refused: false })
      await col('developerentryrequests').deleteOne({ path: '/probe' })
      await db.command({ collMod: 'developerentryrequests', validator: { $expr: { $eq: [1, 0] } }, validationLevel: 'strict', validationAction: 'error' })
      try {
        const before = await col('financeintakerecords').countDocuments()
        const read = await call('/api/finance-intake/records', { token: main1.token }); expectStatus(read, 503, 'a read without its line')
        const write = await call('/api/finance-intake/records', { token: main1.token, method: 'POST', body: { values: { description: 'Synthetic never saved' } } }); expectStatus(write, 503, 'a write without its line')
        assert.equal(await col('financeintakerecords').countDocuments(), before, 'nothing saved')
      } finally { await db.command({ collMod: 'developerentryrequests', validator: {}, validationLevel: 'off' }) }
      expectStatus(await call('/api/finance-intake/records', { token: main1.token }), 200, 'reads again once lines can be written')
    })
    await check(L('E-viewer-read-only-after-entry'), async () => {
      const e = await entered(viewer, companies.viewer)
      expectStatus(await call('/api/finance-intake/records', { token: e.token }), 200, 'a viewer entry reads')
      const r = await call('/api/finance-intake/records', { token: e.token, method: 'POST', body: { values: { description: 'Synthetic viewer entry order' } } })
      expectStatus(r, 403, 'an allowed intake write into a 閲覧のみ member'); assert.equal(code(r), 'VIEWER_READ_ONLY', 'viewerReadOnly answers: developerEntry.ts ran first')
      assert.equal(await col('financeintakerecords').countDocuments({ 'values.description': 'Synthetic viewer entry order' }), 0)
      expectStatus(await call('/api/auth/logout', { token: e.token, method: 'POST' }), 200, 'leave')
    })
    let main2
    await check(L('E-two-entries-newer-open'), async () => {
      needMain()
      const a = await entered(cust, companies.cust), b = await entered(cust, companies.cust2)
      ended(await call('/api/auth/me', { token: a.token }), 'the older entry')
      assert.ok((await rowOf(a.eid)).endedAt, 'older row ended'); assert.equal((await rowOf(a.eid)).endedHow, 'replaced')
      const me = await call('/api/auth/me', { token: b.token }); expectStatus(me, 200, 'the newer entry'); assert.equal(String(me.data.currentOrganization?.id), String(companies.cust2), 'another company of the same customer is a new entry')
      assert.equal(await col('developerentries').countDocuments({ developerId: dev.id, endedAt: null }), 1, 'only the newer open')
      ended(await call('/api/auth/me', { token: main1.token }), 'the first entry too')
      main2 = b
    })
    await check(L('E-cannot-enter-a-developer'), async () => {
      for (const [target, company] of [[dev2, companies.dev], [dev, companies.dev]]) { const r = await enter(target, company); expectStatus(r, 403, 'enter ' + target.key); assert.equal(r.data?.token, undefined) }
      const r2 = await enter(dev, companies.dev, { token: dev2.plain }); expectStatus(r2, 403, 'another developer enters a developer')
      assert.equal(await col('developerentries').countDocuments({ targetUserId: { $in: [dev.id, dev2.id] } }), 0, 'no row')
    })
    await check(L('E-target-and-company-checks'), async () => {
      expectStatus(await enter(cust, companies.other), 400, 'a company the target does not belong to')
      expectStatus(await enter(cust, null), 400, 'no company while the target has companies')
      const q = await entered(quiet, null, { reason: '' }); assert.equal((await rowOf(q.eid)).reason, '', 'a blank reason starts an entry'); assert.equal((await rowOf(q.eid)).organizationId, null)
      expectStatus(await call('/api/auth/me', { token: q.token }), 200, 'a companyless entry')
      await col('users').updateOne({ _id: other.id }, { $set: { isActive: false } })
      try { const r = await enter(other, companies.other); assert.ok(r.status === 404 || r.status === 403 || r.status === 400, 'an inactive target is refused: ' + r.status); assert.equal(r.data?.token, undefined) } finally { await col('users').updateOne({ _id: other.id }, { $set: { isActive: true } }) }
      expectStatus(await enter(cust, companies.cust, { token: cust.token }), 403, 'a non-developer cannot start an entry')
      main2 = await entered(cust, companies.cust)
    })
    await check(L('E-logout-ends-row-no-customer-logout-line'), async () => {
      const e = main2
      const r = await call('/api/auth/logout', { token: e.token, method: 'POST', body: { refreshToken: 'x' } }); expectStatus(r, 200, '終了'); assert.equal(r.data?.ended, true)
      const row = await rowOf(e.eid); assert.ok(row.endedAt); assert.equal(row.endedHow, 'developer')
      ended(await call('/api/auth/me', { token: e.token }), 'the same token after 終了'); ended(await call('/api/finance-intake/records', { token: e.token }), 'intake after 終了')
      expectStatus(await call('/api/transactions', { token: e.token }), 401, 'api.ts path after 終了')
      assert.equal(await col('auditlogs').countDocuments({ userId: cust.sid, action: 'logout' }), 0, 'no logout line under the customer')
      const left = await col('auditlogs').findOne({ userId: cust.sid, action: 'developer_left', entityId: e.eid }); assert.ok(left, 'the customer sees "developer left"')
    })
    const stopsNext = async (label, how, act, undo) => {
      const e = await entered(cust, companies.cust)
      expectStatus(await call('/api/auth/me', { token: e.token }), 200, label + ' before')
      await act(e)
      try {
        ended(await call('/api/finance-intake/records', { token: e.token }), label + ' next request')
        const row = await rowOf(e.eid); assert.ok(row.endedAt, label + ' row ended'); assert.equal(row.endedHow, how, label + ' how')
        ended(await call('/api/auth/me', { token: e.token }), label + ' stays ended')
      } finally { if (undo) await undo(e) }
    }
    await check(L('E-removed-developer-stops'), () => stopsNext('removed from the list', 'removed', async () => assert.equal((await manage('remove', dev.email, '--apply')).code, 0), async () => assert.equal((await manage('add', dev.email, '--apply')).code, 0)))
    await check(L('E-developer-password-stops'), () => stopsNext('developer password change', 'password_changed', async () => {
      const r = await call('/api/users/me/password', { token: dev.token, method: 'POST', body: { currentPassword: PASSWORD, newPassword: PASSWORD + 'y', confirmPassword: PASSWORD + 'y' } }); expectStatus(r, 200, 'password change'); dev.token = r.data.tokens.accessToken
    }, async () => { const r = await call('/api/users/me/password', { token: dev.token, method: 'POST', body: { currentPassword: PASSWORD + 'y', newPassword: PASSWORD, confirmPassword: PASSWORD } }); expectStatus(r, 200, 'password back'); dev.token = r.data.tokens.accessToken }))
    await check(L('E-target-deactivated-stops'), () => stopsNext('target deactivated', 'target_deactivated', async () => { await col('users').updateOne({ _id: cust.id }, { $set: { isActive: false } }) }, async () => { await col('users').updateOne({ _id: cust.id }, { $set: { isActive: true } }) }))
    await check(L('E-end-time-stops'), async () => {
      await stopsNext('end time passed', 'expired', async e => { await col('developerentries').updateOne({ _id: new ObjectId(e.eid) }, { $set: { endsAt: new Date(Date.now() - 1000) } }) })
      const e = await entered(cust, companies.cust), claims = jwt.decode(e.token)
      const late = sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 5 }, {})
      expectStatus(await call('/api/finance-intake/records', { token: late }), 401, 'a token past its end time')
      expectStatus(await call('/api/auth/logout', { token: e.token, method: 'POST' }), 200, 'leave')
    })
    await check(L('E-customer-removed-from-company-same-403'), async () => {
      const e = await entered(cust, companies.cust)
      const members = (await col('organizations').findOne({ _id: companies.cust })).members
      await col('organizations').updateOne({ _id: companies.cust }, { $pull: { members: { userId: cust.id } } })
      try {
        for (const route of ['/api/budgets', '/api/finance-chat/company-workspace']) {
          const a = await call(route, { token: cust.token }), b = await call(route, { token: e.token })
          expectStatus(a, 403, 'customer ' + route); expectStatus(b, 403, 'entry ' + route); assert.equal(b.data?.statusMessage, a.data?.statusMessage, 'the same refusal')
        }
      } finally { await col('organizations').updateOne({ _id: companies.cust }, { $set: { members } }) }
      expectStatus(await call('/api/budgets', { token: e.token }), 200, 'reads again once restored')
      expectStatus(await call('/api/auth/logout', { token: e.token, method: 'POST' }), 200, 'leave')
    })
    await check(L('E-every-request-lined'), async () => {
      const e = await entered(cust, companies.cust)
      const sent = [['GET', '/api/auth/me', 200], ['GET', '/api/finance-intake/records', 200], ['GET', '/api/transactions', 200], ['POST', '/api/transactions', 403], ['GET', '/api/invoices', 200]]
      for (const [method, route] of sent) await call(route, { token: e.token, method, body: method === 'GET' ? undefined : { date: '2026-11-21', amount: 1 } })
      await call('/api/developer/me', { token: e.token })
      await pause(300)
      const lines = await linesOf(e.eid)
      assert.deepEqual(lines.map(l => [l.method, l.path, l.status]), sent, 'one line per request with its status; GET /api/developer/me has none')
      assert.deepEqual(lines.map(l => l.refused), [false, false, false, true, false])
      expectStatus(await call('/api/auth/logout', { token: e.token, method: 'POST' }), 200, 'leave')
    })
    await check(L('E-other-token-kinds-untouched'), async () => {
      expectStatus(await call('/api/finance/collector/accounts', { token: collector.token }), 200, 'downloader omfc_')
      expectStatus(await call('/api/finance-chat/worker/heartbeat', { token: worker.token, method: 'POST', body: {} }), 200, 'worker omft_')
      expectStatus(await call('/api/finance-review/worker/jobs', { token: reviewer.token }), 200, 'review worker omfr_')
      for (const t of [collector.token, worker.token, reviewer.token]) expectStatus(await call('/api/finance-intake/records', { token: t }), 401, 'none of them is a sign-in')
    })
    await check(L('E-entries-listed-for-developers'), async () => {
      needMain()
      const r = await call('/api/developer/entries', { token: dev.token }); expectStatus(r, 200, 'entries')
      const e = r.data.entries.find(x => x.id === main1.eid); assert.ok(e, 'the first entry is listed')
      assert.equal(e.target.email, cust.email); assert.equal(e.endedHow, 'replaced'); assert.ok(e.lines.length > 0, 'its request lines')
      const firstRead = e.lines.findIndex(l => l.method === 'GET'), lastChange = e.lines.map(l => l.method !== 'GET').lastIndexOf(true)
      assert.ok(lastChange < firstRead || firstRead < 0, 'changes first')
      expectStatus(await call('/api/developer/entries', { token: cust.token }), 403, 'not for others')
    })
    await check(L('E-restart-row-decides'), async () => {
      const open = await entered(cust, companies.cust), done = await entered(other, companies.other, { token: dev2.plain })
      expectStatus(await call('/api/auth/logout', { token: done.token, method: 'POST' }), 200, 'end one')
      await stop(); await start()
      expectStatus(await call('/api/finance-intake/records', { token: open.token }), 200, 'an open entry survives a restart through its row')
      ended(await call('/api/finance-intake/records', { token: done.token }), 'an ended entry stays ended after a restart')
      expectStatus(await call('/api/auth/logout', { token: open.token, method: 'POST' }), 200, 'leave')
    })
    // Review finding 1: the customer's "developer left" line carries the entry's true end as its time, whenever it is written. An entry
    // that runs out unused (its start and end moved 3 h and 2 h into the past, standing for a closed browser) is settled when a developer
    // next opens the record, when the developer starts the next entry, or at a request whose token is still valid; one ends by 終了.
    await check(L('E-left-line-dated-at-the-end'), async () => {
      const past = async e => { const endsAt = new Date(Date.now() - 2 * 3600000); await col('developerentries').updateOne({ _id: new ObjectId(e.eid) }, { $set: { startedAt: new Date(Date.now() - 3 * 3600000), endsAt } }); return endsAt }
      const leftLines = async eid => { const r = await call('/api/audit?limit=100&entityId=' + eid, { token: cust.token }); expectStatus(r, 200, 'the customer\'s activity log'); return r.data.logs.filter(l => l.action === 'developer_left') }
      const dated = async (eid, label, plannedEnd) => {
        const row = await rowOf(eid), lines = await leftLines(eid)
        assert.ok(row.endedAt, label + ': row ended'); assert.equal(lines.length, 1, label + ': one "left" line')
        if (plannedEnd) { assert.equal(row.endedHow, 'expired', label + ': how'); assert.equal(row.endedAt.toISOString(), plannedEnd.toISOString(), label + ': the row ends at its planned end') }
        assert.equal(new Date(lines[0].timestamp).toISOString(), row.endedAt.toISOString(), label + ': the customer\'s "left" line is dated at the entry\'s end, not at the moment it was written')
      }
      const by = { token: dev2.plain }
      const a = await entered(cust, companies.cust, by), aEnd = await past(a)
      assert.deepEqual(await leftLines(a.eid), [], 'no "left" line while nobody has come back')
      await pause(1100)
      expectStatus(await call('/api/developer/entries', by), 200, 'the developer opens the record')
      await dated(a.eid, 'settled when the developer opens the record', aEnd)
      const b = await entered(cust, companies.cust, by), bEnd = await past(b)
      const c = await entered(cust, companies.cust, by)
      await dated(b.eid, 'settled when the developer starts the next entry', bEnd)
      const cEnd = await past(c)
      ended(await call('/api/auth/me', { token: c.token }), 'a request with a valid token after the row\'s end')
      await dated(c.eid, 'settled at a request', cEnd)
      const d = await entered(cust, companies.cust, by)
      expectStatus(await call('/api/auth/logout', { token: d.token, method: 'POST' }), 200, '終了')
      await dated(d.eid, '終了')
    })
    // Review finding 4: the customer's two lines are written so that a failure is seen. The throwaway database's activity log is made
    // to refuse one of the two developer actions (a collection validator); these entries go into another invented customer.
    const auditRefuses = async (action, fn) => {
      await db.command({ collMod: 'auditlogs', validator: { action: { $ne: action } }, validationLevel: 'strict', validationAction: 'error' })
      try { return await fn() } finally { await db.command({ collMod: 'auditlogs', validator: {}, validationLevel: 'off' }) }
    }
    await check(L('E-entered-line-fails-no-entry'), async () => {
      const by = { token: dev2.plain }, before = await col('developerentries').find({ targetUserId: other.id }).project({ _id: 1 }).toArray()
      const r = await auditRefuses('developer_entered', () => enter(other, companies.other, by))
      expectStatus(r, 503, 'a start whose "developer entered" line cannot be written'); assert.equal(code(r), 'DEVELOPER_ENTRY_UNAVAILABLE'); assert.equal(r.data?.token, undefined, 'no token')
      const added = (await col('developerentries').find({ targetUserId: other.id }).toArray()).filter(row => !before.some(b => String(b._id) === String(row._id)))
      assert.equal(added.length, 1, 'the start wrote its row'); assert.ok(added[0].endedAt, 'and the row is ended'); assert.equal(added[0].endedHow, 'entered_line_failed')
      assert.equal(await col('auditlogs').countDocuments({ entityId: String(added[0]._id) }), 0, 'no line for an entry that did not start')
      const again = await entered(other, companies.other, by)
      expectStatus(await call('/api/auth/me', { token: again.token }), 200, 'with the activity log writable again an entry starts')
      expectStatus(await call('/api/auth/logout', { token: again.token, method: 'POST' }), 200, 'and ends')
    })
    await check(L('E-left-line-fails-seen'), async () => {
      const e = await entered(other, companies.other, { token: dev2.plain })
      expectStatus(await call('/api/finance-intake/records', { token: e.token }), 200, 'inside')
      const r = await auditRefuses('developer_left', () => call('/api/auth/logout', { token: e.token, method: 'POST' }))
      expectStatus(r, 503, '終了 whose "developer left" line cannot be written'); assert.equal(code(r), 'DEVELOPER_ENTRY_UNAVAILABLE', 'the failure is answered, not swallowed')
      const row = await rowOf(e.eid); assert.ok(row.endedAt, 'the row still ends'); assert.equal(row.endedHow, 'developer')
      assert.equal(await col('auditlogs').countDocuments({ action: 'developer_left', entityId: e.eid }), 0, 'no "left" line was written')
      ended(await call('/api/finance-intake/records', { token: e.token }), 'the entry is over')
    })
    await check(L('E-customer-audit-and-account-untouched'), async () => {
      const entries = await col('developerentries').find({ targetUserId: cust.id }).toArray()
      assert.ok(entries.length >= 10, 'the entries of this run exist: ' + entries.length)
      const logs = await col('auditlogs').find({ userId: cust.sid }).toArray()
      for (const e of entries) {
        assert.ok(logs.some(l => l.action === 'developer_entered' && l.entityId === String(e._id)), 'entered line for ' + e._id)
        if (e.endedAt) assert.ok(logs.some(l => l.action === 'developer_left' && l.entityId === String(e._id)), 'left line for ' + e._id + ' (' + e.endedHow + ')')
      }
      assert.equal(logs.filter(l => !['developer_entered', 'developer_left'].includes(l.action)).length, custAuditBefore, 'no other line under the customer from the entries')
      const after = await col('users').findOne({ _id: cust.id })
      assert.deepEqual(after, custUserBefore, 'the customer\'s account (password, 2FA, PIN, devices, session version, last sign-in) is untouched')
    })

    // ---- Browser (installed Chrome, headless): enter, pages, reload, second tab, 終了, lock, expiry, >30 minutes, ended on the server.
    if (BROWSER) {
      const puppeteer = require('puppeteer-core'), executablePath = chromePath()
      if (!browser) browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'] })
      const shots = process.env.OMF_DEVELOPER_SCREENS || ''
      const shot = async (page, name) => { if (shots) { await fsp.mkdir(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: false }) } }
      const STORE = "document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user')"
      const PAGES = [['/', 'dashboard'], ['/transactions', '取引一覧'], ['/invoices', '請求書'], ['/receipts', '領収書'], ['/calendar', 'カレンダー'], ['/budgets', '予算'], ['/intake', '購入受付']]
      let context, page, errors = [], leftByEnd = false
      const fresh = async () => {
        if (context) await context.close().catch(() => {})
        const session = await signIn(dev)
        context = await browser.createBrowserContext(); page = await context.newPage(); errors = []
        page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept().catch(() => {}))
        if (process.env.OMF_DEVELOPER_DEBUG) page.on('console', m => console.log('PAGE ' + m.type() + ' ' + m.text().slice(0, 300)))
        await page.setViewport({ width: 1440, height: 900 })
        await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' })
        await page.evaluate(value => localStorage.setItem('ohmyfinance_session', value), JSON.stringify({ sessionId: 'test-' + crypto.randomUUID(), tokens: session.tokens, user: session.user, organizations: session.organizations, currentOrganization: session.organizations[0] }))
        return session
      }
      const store = (p = page) => p.evaluate(s => { const x = eval(s); return { token: x.token, refreshToken: x.refreshToken, userId: x.user?.id || x.user?._id, entry: x.entry ? { id: x.entry.id } : null, isAuthenticated: x.isAuthenticated } }, STORE)
      const textOf = (p = page) => p.evaluate(() => document.body.innerText)
      const waitText = async (needle, p = page, timeout = 20000) => { try { await p.waitForFunction(n => document.body.innerText.includes(n), { timeout, polling: 200 }, needle) } catch { throw Error('page ' + new URL(p.url()).pathname + ' never showed ' + needle + ': ' + (await textOf(p)).replace(/\s+/g, ' ').slice(0, 300)) } }
      const enterInPage = async (target = cust, company = companies.cust) => {
        // A check that failed while inside leaves its entry open in this page: leave it first, so each check starts as the developer.
        if ((await store().catch(() => null))?.entry) { await page.evaluate(s => eval(s).leaveEntry('developer'), STORE).catch(() => {}); await page.waitForFunction(() => location.pathname === '/developer', { timeout: 20000, polling: 200 }).catch(() => {}) }
        await page.goto(origin + '/developer', { waitUntil: 'networkidle2' })
        await page.waitForSelector(`[data-developer-account="${target.sid}"]`, { timeout: 20000 })
        await page.click(`[data-developer-account="${target.sid}"] [data-developer-choose]`)
        await page.waitForSelector('[data-developer-enter-form]', { timeout: 10000 })
        if (company) await page.select('[data-developer-company]', String(company))
        await page.type('[data-developer-reason]', 'Synthetic browser check')
        await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }), page.click('[data-developer-enter]')])
        assert.equal(new URL(page.url()).pathname, '/', 'entering opens the dashboard of the customer')
        await page.waitForSelector('[data-developer-entry-banner]', { timeout: 20000 })
      }
      // What identifies an owner's data on a page: the dashboard lists date, type, category, amount and status (no names), so there the
      // owner's own transaction amount stands for it; every other page shows the marked names.
      const needle = (route, mark) => route === '/' ? AMOUNT_TEXT[mark] : mark
      const pagesShow = async (mark, absent, label, p = page) => {
        const problems = []
        for (const [route, name] of PAGES) {
          await p.goto(origin + route, { waitUntil: 'networkidle2' })
          try { await waitText(needle(route, mark), p, 15000) } catch (error) { problems.push(name + ': ' + error.message); continue }
          const text = await textOf(p)
          for (const a of absent) if (text.includes(needle(route, a))) problems.push(name + ' shows ' + a)
        }
        assert.deepEqual(problems, [], label)
        await p.goto(origin + '/', { waitUntil: 'networkidle2' })
        await p.click('[data-assistant-toggle]')
        await waitText(mark + ' navi question', p)
        const navi = await textOf(p); for (const a of absent) assert.ok(!navi.includes(a + ' navi'), label + ': the Navi panel shows ' + a)
        await p.click('[data-assistant-close]').catch(() => {})
      }
      const backHome = async (label, p = page) => {
        await p.waitForFunction(() => location.pathname === '/developer', { timeout: 30000, polling: 200 }).catch(async () => { throw Error(label + ': not at /developer but ' + new URL(p.url()).pathname) })
        await p.waitForSelector('[data-developer-page]', { timeout: 20000 })
        const s = await store(p); assert.equal(s.entry, null, label + ': left the entry'); assert.equal(String(s.userId), dev.sid, label + ': the developer\'s own session'); assert.ok(s.refreshToken, label + ': with the developer\'s refresh token')
        assert.equal(await p.$('[data-developer-entry-banner]'), null, label + ': no banner')
      }
      await check(L('E-browser-enter-pages-show-customer'), async () => {
        await fresh(); await enterInPage()
        const s = await store(); assert.ok(s.entry, 'inside an entry'); assert.equal(String(s.userId), cust.sid); assert.equal(s.refreshToken, null, 'no refresh token inside')
        const banner = await page.$eval('[data-developer-entry-banner]', e => e.innerText)
        assert.ok(banner.includes(cust.name) && banner.includes('Synthetic Customer Trading'), 'the banner names the customer and company: ' + banner)
        await shot(page, 'entry-dashboard')
        await pagesShow('CUSTMARK', ['DEVMARK', 'OTHERMARK'], 'inside')
        await page.goto(origin + '/intake', { waitUntil: 'networkidle2' }); await waitText('CUSTMARK'); await shot(page, 'entry-intake')
        assert.deepEqual(errors, [], 'no page error')
      })
      await check(L('E-browser-every-sidebar-page-inside'), async () => {
        const links = await page.$$eval('nav a[href^="/"]', as => [...new Set(as.map(a => a.getAttribute('href')))])
        assert.ok(links.length >= 15, 'sidebar links: ' + links.length)
        assert.ok(!links.includes('/developer'), 'no 開発者 link inside an entry')
        for (const href of links) {
          errors.length = 0
          await page.goto(origin + href, { waitUntil: 'networkidle2' }); await pause(800)
          assert.deepEqual(errors, [], href + ' page error')
          assert.equal(await page.$('[data-viewer-refusal]'), null, href + ' shows a refusal notice nobody caused')
          assert.ok((await store()).entry, href + ' still inside')
        }
      })
      await check(L('E-browser-reload-and-second-tab'), async () => {
        await page.goto(origin + '/transactions', { waitUntil: 'networkidle2' }); await page.reload({ waitUntil: 'networkidle2' })
        await page.waitForSelector('[data-developer-entry-banner]', { timeout: 20000 }); await waitText('CUSTMARK')
        const second = await context.newPage(); second.on('pageerror', e => errors.push('tab2: ' + e.message))
        await second.goto(origin + '/budgets', { waitUntil: 'networkidle2' }); await second.waitForSelector('[data-developer-entry-banner]', { timeout: 20000 }); await waitText('CUSTMARK', second)
        await page.bringToFront()
        await page.click('[data-developer-entry-end]')
        await backHome('終了')
        await second.bringToFront()
        await backHome('second tab', second)
        leftByEnd = true
        await page.bringToFront()
        await second.close()
      })
      await check(L('E-browser-after-end-pages-show-developer'), async () => {
        assert.ok(leftByEnd, 'this browser entered the account of the customer and left it with 終了 just before')
        await pagesShow('DEVMARK', ['CUSTMARK', 'OTHERMARK'], 'after 終了')
        assert.deepEqual(errors, [], 'no page error')
      })
      await check(L('E-browser-lock-leaves-and-asks-developer'), async () => {
        await enterInPage()
        await page.evaluate(() => { localStorage.setItem('ohmyfinance_locked_at', String(Date.now())); setTimeout(() => location.reload(), 50) })
        await pause(800)
        await page.waitForFunction(() => location.pathname === '/developer', { timeout: 30000, polling: 200 })
        await page.waitForSelector('input[type=password]:not([maxlength])', { timeout: 20000 })
        const s = await store(); assert.equal(s.entry, null, 'the lock left the entry'); assert.equal(String(s.userId), dev.sid, 'the lock belongs to the developer\'s session')
        await page.type('input[type=password]:not([maxlength])', PASSWORD)
        await page.$eval('input[type=password]:not([maxlength])', el => el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })))
        await page.waitForFunction(() => !localStorage.getItem('ohmyfinance_locked_at'), { timeout: 20000, polling: 200 })
        await backHome('after unlock')
      })
      await check(L('E-browser-expiry-leaves'), async () => {
        await enterInPage()
        const s = await store(), claims = jwt.decode(s.token)
        await col('developerentries').updateOne({ _id: new ObjectId(claims.eid) }, { $set: { endsAt: new Date(Date.now() + 65000) } })
        const short = sign({ ...claims, exp: Math.floor(Date.now() / 1000) + 65 }, {})
        await page.evaluate((s, t) => { const x = eval(s); x.token = t; x.persistSession(); x.scheduleRefresh() }, STORE, short)
        await backHome('expiry')
      })
      await check(L('E-browser-over-30-minutes-inside'), async () => {
        await enterInPage()
        const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('ohmyfinance_developer_session') || 'null'))
        assert.ok(kept?.tokens?.refreshToken, 'the developer\'s own session is kept under its own key')
        const { iat, exp, ...keptClaims } = jwt.decode(kept.tokens.accessToken)
        const expired = jwt.sign({ ...keptClaims, exp: Math.floor(Date.now() / 1000) - 120 }, secret)
        await page.evaluate(v => { const k = JSON.parse(localStorage.getItem('ohmyfinance_developer_session')); k.tokens.accessToken = v; localStorage.setItem('ohmyfinance_developer_session', JSON.stringify(k)) }, expired)
        await page.click('[data-developer-entry-end]')
        await backHome('leaving after the developer\'s own token ran out')
        await page.waitForFunction((s, old) => eval(s).token !== old, { timeout: 20000, polling: 200 }, STORE, expired)
        const r = await page.evaluate(async () => (await fetch('/api/developer/entries', { headers: { Authorization: 'Bearer ' + document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user').token } })).status)
        assert.equal(r, 200, 'renewed with the kept refresh token')
      })
      await check(L('E-browser-server-ended-returns-at-next-request'), async () => {
        await enterInPage()
        const s = await store(), claims = jwt.decode(s.token)
        await col('developerentries').updateOne({ _id: new ObjectId(claims.eid) }, { $set: { endedAt: new Date(), endedHow: 'developer' } })
        assert.ok(jwt.decode(s.token).exp * 1000 > Date.now() + 600000, 'the token is still valid')
        await page.click('a[href="/intake"]')
        await backHome('ended on the server')
        // The developer's page after this run: the account list and the record, one entry opened (screenshots for the build report).
        await page.reload({ waitUntil: 'networkidle2' }); await page.waitForSelector('[data-developer-entries] [data-developer-entry]', { timeout: 20000 })
        await shot(page, 'developer-page')
        await page.click('[data-developer-entries] [data-developer-entry] button[aria-expanded]'); await pause(300)
        await page.$eval('[data-developer-entries]', e => e.scrollIntoView()); await pause(200)
        await shot(page, 'developer-record')
        await page.setViewport({ width: 390, height: 844 }); await page.reload({ waitUntil: 'networkidle2' }); await page.waitForSelector('[data-developer-page]', { timeout: 20000 })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways overflow on a phone width')
        await shot(page, 'developer-page-narrow')
        await enterInPage().catch(() => {}); await page.setViewport({ width: 390, height: 844 }); await shot(page, 'entry-banner-narrow')
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'the banner does not overflow a phone width')
        await page.click('[data-developer-entry-end]'); await backHome('narrow 終了'); await page.setViewport({ width: 1440, height: 900 })
      })
      await check(L('E-browser-ordinary-401-then-renewal'), async () => {
        if (context) await context.close(); context = await browser.createBrowserContext(); page = await context.newPage(); errors = []; page.on('pageerror', e => errors.push(e.message))
        const session = await signIn(cust)
        await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' })
        await page.evaluate(value => localStorage.setItem('ohmyfinance_session', value), JSON.stringify({ sessionId: 'test-' + crypto.randomUUID(), tokens: session.tokens, user: session.user, organizations: session.organizations, currentOrganization: session.organizations[0] }))
        await page.goto(origin + '/intake', { waitUntil: 'networkidle2' }); await waitText('CUSTMARK')
        const rejected = jwt.sign({ userId: cust.sid, email: cust.email, sv: 0, jti: crypto.randomUUID() }, crypto.randomBytes(32).toString('hex'), { expiresIn: '20m' })
        const result = await page.evaluate(async (s, bad) => { const x = eval(s); x.token = bad; const r = await fetch('/api/finance-intake/records', { headers: { Authorization: 'Bearer ' + bad } }); return { status: r.status, renewed: x.token !== bad, authenticated: x.isAuthenticated } }, STORE, rejected)
        assert.deepEqual(result, { status: 200, renewed: true, authenticated: true }, 'a 401 is followed by renewal for an ordinary user')
        assert.equal((await store()).entry, null)
      })
      // The customer's own activity log page, opened by the customer (signed in now) in a context of its own: `use` gets the table rows
      // (each the cells' text) once a row naming `entryId` is shown, and the page.
      const customerLog = async (who, route, entryId, use) => {
        const session = await signIn(who), own = await browser.createBrowserContext(), p = await own.newPage()
        try {
          await p.goto(origin + '/login', { waitUntil: 'domcontentloaded' })
          await p.evaluate(value => localStorage.setItem('ohmyfinance_session', value), JSON.stringify({ sessionId: 'test-' + crypto.randomUUID(), tokens: session.tokens, user: session.user, organizations: session.organizations || [], currentOrganization: (session.organizations || [])[0] || null }))
          await p.goto(origin + route, { waitUntil: 'networkidle2' })
          await p.waitForFunction(id => [...document.querySelectorAll('table tbody tr')].some(tr => tr.textContent.includes(id)), { timeout: 20000, polling: 200 }, entryId).catch(async () => { throw Error(route + ' never showed a row of entry ' + entryId + ': ' + (await textOf(p)).replace(/\s+/g, ' ').slice(0, 300)) })
          await use(await p.$$eval('table tbody tr', trs => trs.map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.replace(/\s+/g, ' ').trim()))), p)
        } finally { await own.close().catch(() => {}) }
      }
      await check(L('E-browser-customer-log-shows-end-time'), async () => {
        // Review finding 1 on the page: an entry into an invented customer ran out unused (start and end moved 3 h and 2 h into the past);
        // a developer opens the record afterwards. The customer's "開発者が退室" row shows the entry's end, not the moment of that visit.
        const q = await entered(quiet, null, { token: dev2.plain }), endsAt = new Date(Date.now() - 2 * 3600000)
        await col('developerentries').updateOne({ _id: new ObjectId(q.eid) }, { $set: { startedAt: new Date(Date.now() - 3 * 3600000), endsAt } })
        expectStatus(await call('/api/developer/entries', { token: dev2.plain }), 200, 'a developer opens the record')
        await customerLog(quiet, '/audit', q.eid, async (rows, p) => {
          const left = rows.find(r => r[3] === q.eid && r[1] === '開発者が退室'); assert.ok(left, 'the "left" row: ' + JSON.stringify(rows.filter(r => r[3] === q.eid)))
          const shown = iso => p.evaluate(value => { const d = new Date(value); return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' }) + d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) }, iso)
          const cell = left[0].replace(/\s+/g, ''), end = (await shown(endsAt.toISOString())).replace(/\s+/g, '')
          assert.equal(cell, end, 'the page shows the entry\'s end (' + end + '), not the visit (' + (await shown(new Date().toISOString())).replace(/\s+/g, '') + ')')
        })
      })
      await check(L('E-browser-customer-log-types-in-words'), async () => {
        // Review finding 3: on the customer's activity log page the 種類 column of the two developer lines (and of the sign-in lines,
        // which share the type) reads in words, in Japanese and Korean, never as the raw text key.
        const e = await entered(quiet, null, { token: dev2.plain })
        expectStatus(await call('/api/auth/logout', { token: e.token, method: 'POST' }), 200, '終了')
        for (const [route, enteredText, leftText, typeText] of [['/audit', '開発者が入室', '開発者が退室', '認証'], ['/ko/audit', '개발자 입실', '개발자 퇴실', '인증']]) {
          await customerLog(quiet, route, e.eid, async rows => {
            assert.deepEqual(rows.filter(r => r[3] === e.eid).map(r => r[1] + ' | ' + r[2]).sort(), [enteredText + ' | ' + typeText, leftText + ' | ' + typeText].sort(), route + ': the two lines of the entry')
            assert.deepEqual(rows.filter(r => /audit\./i.test(r[2])).map(r => r[1] + ' | ' + r[2]), [], route + ': rows with a raw key in the 種類 column')
          })
        }
      })
      if (context) await context.close().catch(() => {})
    }
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
