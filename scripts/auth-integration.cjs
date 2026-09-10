const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const crypto = require('node:crypto')
const https = require('node:https')
const { spawn } = require('node:child_process')
const { MongoMemoryServer } = require('mongodb-memory-server')
const { MongoClient } = require('mongodb')
const otp = require('otplib')
const root = path.resolve(__dirname, '..')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function port() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const selected = server.address().port
  await new Promise(resolve => server.close(resolve))
  return selected
}
function browserCall(action, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const request = https.request('https://localhost:6060/api/browser/' + action, { method: 'POST', rejectUnauthorized: false, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, response => {
      let text = ''; response.on('data', chunk => { text += chunk }); response.on('end', () => {
        try { const result = JSON.parse(text); if (response.statusCode >= 400) reject(Error(result.error || text)); else resolve(result) } catch (error) { reject(error) }
      })
    })
    request.on('error', reject); request.end(data)
  })
}

async function main() {
  let mongo, child, client, browserSession
  let serverOutput = '', checks = 0
  const pass = name => { checks++; console.log('PASS ' + name) }
  try {
    const localBinary = path.join(root, 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe')
    mongo = await MongoMemoryServer.create({ binary: fs.existsSync(localBinary) ? { systemBinary: localBinary, version: '8.2.1' } : undefined })
    const uri = mongo.getUri('auth_regression')
    const selectedPort = await port(), origin = `http://127.0.0.1:${selectedPort}`
    const jwtSecret = crypto.randomBytes(32).toString('hex')
    const start = async () => {
      child = spawn(process.execPath, ['.output/server/index.mjs'], {
        cwd: root, windowsHide: true,
        env: { ...process.env, MONGO_URI: uri, NUXT_MONGO_URI: uri, JWT_SECRET: jwtSecret, NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(selectedPort), NITRO_PORT: String(selectedPort) },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { serverOutput = (serverOutput + data).slice(-12000) })
      for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw Error('Test server exited: ' + serverOutput)
        try {
          const response = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) })
          const data = await response.json()
          if (data.database?.connected) { assert.equal(data.database.name, 'auth_regression'); return }
        } catch {}
        await pause(200)
      }
      throw Error('Isolated server failed to become healthy')
    }
    const stop = async () => {
      if (child && child.exitCode === null) { const ended = new Promise(resolve => child.once('exit', resolve)); child.kill(); await ended }
    }
    await start()
    client = await MongoClient.connect(uri)
    const db = client.db('auth_regression')
    assert.notEqual(db.databaseName, 'ohmyfinance')
    const call = async (route, { method = 'POST', token, body } = {}) => {
      const response = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) })
      const data = await response.json()
      return { status: response.status, data }
    }
    const credentials = { email: 'auth-regression@example.invalid', password: 'Synthetic-Only-Password1!' }
    const registered = await call('/api/auth/register', { body: { ...credentials, name: 'Authentication Test' } })
    assert.equal(registered.status, 200, JSON.stringify(registered.data))
    let tokens = registered.data.tokens
    assert.ok(tokens.accessToken && tokens.refreshToken)
    pass('isolated registration returns a session')
    assert.equal((await call('/api/dashboard/stats', { method: 'GET' })).status, 401)
    assert.equal((await call('/api/auth/me', { method: 'GET', token: tokens.refreshToken })).status, 401)
    pass('dashboard requires login and refresh tokens cannot act as access tokens')
    const setup = await call('/api/auth/2fa/setup', { token: tokens.accessToken })
    assert.equal(setup.status, 200)
    const secret = setup.data.secret, backupCodes = setup.data.backupCodes
    const correctCode = () => otp.generateSync({ secret, strategy: 'totp' })
    let wrongCode = '000000'
    while (otp.verifySync({ secret, token: wrongCode, strategy: 'totp', epochTolerance: 30 }).valid) wrongCode = String(Number(wrongCode) + 1).padStart(6, '0')
    assert.equal((await call('/api/auth/2fa/enable', { token: tokens.accessToken, body: { code: wrongCode, backupCodes } })).status, 400)
    assert.equal((await call('/api/auth/2fa/enable', { token: tokens.accessToken, body: { code: correctCode(), backupCodes } })).status, 200)
    const challenge = async deviceId => {
      const result = await call('/api/auth/login', { body: { ...credentials, deviceId } })
      assert.equal(result.status, 200, JSON.stringify(result.data))
      return result.data
    }
    const pending = await challenge()
    assert.equal(pending.requires2FA, true)
    assert.equal((await call('/api/auth/me', { method: 'GET', token: pending.tempToken })).status, 401)
    assert.equal((await call('/api/transactions/import', { token: pending.tempToken, body: { data: [] } })).status, 401)
    assert.equal((await call('/api/transactions/import', { token: 'synthetic-invalid-token', body: { data: [] } })).status, 401)
    assert.equal((await call('/api/auth/2fa/verify', { body: { tempToken: pending.tempToken, code: wrongCode } })).status, 400)
    const verified = await call('/api/auth/2fa/verify', { body: { tempToken: pending.tempToken, code: correctCode(), rememberDevice: true } })
    assert.equal(verified.status, 200, JSON.stringify(verified.data))
    tokens = verified.data.tokens
    pass('2FA rejects invalid codes and pending tokens; valid codes issue a session')
    assert.equal((await call('/api/auth/2fa/verify', { body: { tempToken: pending.tempToken, code: correctCode() } })).status, 401)
    pass('verified challenge cannot be replayed')
    const profile = await call('/api/auth/me', { method: 'GET', token: tokens.accessToken })
    assert.equal(profile.status, 200)
    for (const key of ['twoFactorSecret', 'twoFactorBackupCodes', 'trustedDevices']) assert.equal(profile.data.user[key], undefined)
    assert.equal(profile.data.user.securityPreferences?.pinHash, undefined)
    const fallbackToken = require('jsonwebtoken').sign({ userId: profile.data.user.id, email: credentials.email }, 'ohmyfinance-secret-key-change-in-production', { expiresIn: '30s' })
    assert.equal((await call('/api/auth/me', { method: 'GET', token: fallbackToken })).status, 401)
    const trusted = await challenge(verified.data.deviceId)
    assert.ok(trusted.tokens?.accessToken)
    assert.equal(trusted.requires2FA, undefined)
    const record = await db.collection('users').findOne({ email: credentials.email })
    assert.ok(record.trustedDevices[0].deviceId.startsWith('sha256:'))
    assert.notEqual(record.trustedDevices[0].deviceId, verified.data.deviceId)
    assert.equal((await challenge('a'.repeat(64))).requires2FA, true)
    await db.collection('users').updateOne({ _id: record._id }, { $set: { 'trustedDevices.0.expiresAt': new Date(0) } })
    assert.equal((await challenge(verified.data.deviceId)).requires2FA, true)
    pass('trusted devices work only for valid unexpired hashed credentials; user responses omit secrets')
    const backupChallenge = await challenge()
    const backup = await call('/api/auth/2fa/verify', { body: { tempToken: backupChallenge.tempToken, code: backupCodes[0].toLowerCase() } })
    assert.equal(backup.status, 200)
    const secondBackupChallenge = await challenge()
    assert.equal((await call('/api/auth/2fa/verify', { body: { tempToken: secondBackupChallenge.tempToken, code: backupCodes[0] } })).status, 400)
    const concurrent = await Promise.all([1, 2].map(() => call('/api/auth/2fa/verify', { body: { tempToken: secondBackupChallenge.tempToken, code: backupCodes[1] } })))
    assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 401])
    pass('backup codes accept eight characters and are consumed once; duplicate submission issues one session')
    const pin = await call('/api/auth/set-pin', { token: tokens.accessToken, body: { pin: '493817', password: credentials.password } })
    assert.equal(pin.status, 200, JSON.stringify(pin.data))
    assert.equal((await call('/api/auth/verify-pin', { token: tokens.accessToken, body: { pin: '493817' } })).data.valid, true)
    assert.equal((await call('/api/auth/verify-password', { token: tokens.accessToken, body: { password: credentials.password } })).data.valid, true)
    const refreshed = await call('/api/auth/refresh', { body: { refreshToken: tokens.refreshToken } })
    assert.equal(refreshed.status, 200)
    tokens = refreshed.data.tokens
    pass('PIN/password verification and token renewal succeed')
    await stop(); await start()
    const afterRestart = await call('/api/auth/refresh', { body: { refreshToken: tokens.refreshToken } })
    assert.equal(afterRestart.status, 200)
    tokens = afterRestart.data.tokens
    assert.equal((await call('/api/auth/2fa/verify', { body: { tempToken: pending.tempToken, code: correctCode() } })).status, 401)
    pass('server restart preserves renewable sessions and consumed 2FA challenges')

    const { insertedId: organizationId } = await db.collection('organizations').insertOne({ name: 'Invite Test', slug: 'invite-test', type: 'personal', isActive: true, members: [] })
    const invite = { token: crypto.randomBytes(32).toString('hex'), email: credentials.email, organizationId, role: 'member', createdBy: record._id, expiresAt: new Date(Date.now() + 600000), status: 'pending' }
    await db.collection('invites').insertOne(invite)
    assert.equal((await call('/api/invites/' + invite.token, { method: 'GET' })).data.requiresLogin, true)
    const pendingInvite = await challenge()
    for (const token of [undefined, pendingInvite.tempToken, tokens.refreshToken]) {
      const result = await call('/api/invites/accept', { token, body: { token: invite.token, name: 'Ignored', password: 'Incorrect-Password' } })
      assert.equal(result.data.requiresLogin, true)
      assert.equal(result.data.tokens, undefined)
    }
    const jwtInvite = require('jsonwebtoken').sign({ type: 'invite', email: credentials.email, organizationId: String(organizationId), role: 'member', invitedBy: String(record._id) }, jwtSecret, { expiresIn: '10m' })
    for (const token of [undefined, pendingInvite.tempToken, tokens.refreshToken]) assert.equal((await call('/api/auth/accept-invite', { token, body: { inviteToken: jwtInvite } })).status, 401)
    assert.equal((await db.collection('organizations').findOne({ _id: organizationId })).members.length, 0)
    assert.equal((await call('/api/invites/accept', { token: tokens.accessToken, body: { token: invite.token } })).status, 200)
    assert.equal((await call('/api/auth/accept-invite', { token: tokens.accessToken, body: { inviteToken: jwtInvite } })).status, 200)
    const newInvite = { ...invite, _id: undefined, token: crypto.randomBytes(32).toString('hex'), email: 'invited-new@example.invalid' }
    delete newInvite._id
    await db.collection('invites').insertOne(newInvite)
    const newMember = await call('/api/invites/accept', { body: { token: newInvite.token, name: 'New Invited User', password: credentials.password } })
    assert.equal(newMember.status, 200, JSON.stringify(newMember.data))
    assert.ok(newMember.data.tokens?.accessToken)
    pass('both invitation flows require full login for existing accounts; new-account invitations still work')

    if (process.argv.includes('--browser')) {
      const opened = await browserCall('open', { url: origin + '/auth/login', profile: 'ephemeral', background: true })
      browserSession = opened.session_id
      const evaluate = async script => JSON.parse((await browserCall('eval', { session_id: browserSession, script })).output)
      const waitFor = async script => { for (let i = 0; i < 80; i++) { try { if (await evaluate(script)) return } catch (error) { if (!/context was destroyed|Cannot find context/.test(error.message)) throw error } await pause(250) } throw Error('Browser condition timed out: ' + script) }
      await waitFor("location.pathname === '/login' && !!document.querySelector('#email')")
      const fill = (selector, value) => `(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`
      await evaluate(`(()=>{${fill('#email', credentials.email)};${fill('#password', credentials.password)};document.querySelector('form').requestSubmit();return true})()`)
      await waitFor("!!document.querySelector('#verification-code')")
      await evaluate(`(()=>{${fill('#verification-code', correctCode())};document.querySelector('#two-factor-form').requestSubmit();return true})()`)
      await waitFor("location.pathname === '/' && !!localStorage.getItem('ohmyfinance_session')")
      await evaluate("(()=>{setTimeout(()=>location.reload(),100);return true})()")
      await pause(500)
      await waitFor("location.pathname === '/' && !!document.querySelector('main')")
      const dom = await evaluate("({path:location.pathname,hasMain:!!document.querySelector('main'),text:document.body.innerText.slice(0,150)})")
      assert.equal(dom.path, '/')
      pass('real Chrome: alternate login URL, password, 2FA, navigation and reload stay signed in')

      const getStore = "document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user')"
      const expiredAccess = require('jsonwebtoken').sign({ userId: String(record._id), email: credentials.email, jti: crypto.randomUUID() }, jwtSecret, { expiresIn: -1 })
      await evaluate(`(()=>{const store=${getStore};store.token=${JSON.stringify(expiredAccess)};window.dispatchEvent(new Event('focus'));return true})()`)
      await waitFor(`(()=>{const store=${getStore};return store.isAuthenticated && store.token!==${JSON.stringify(expiredAccess)}})()`)
      pass('real Chrome: waking with an expired access token renews the session')

      const lockAndReload = async () => {
        await evaluate("(()=>{localStorage.setItem('ohmyfinance_locked_at',String(Date.now()));setTimeout(()=>location.reload(),100);return true})()")
        await pause(500)
        await waitFor("document.querySelectorAll('input[type=password][maxlength=\"1\"]').length===6")
      }
      await lockAndReload()
      await evaluate("(()=>{const inputs=[...document.querySelectorAll('input[type=password][maxlength=\"1\"]')];'493817'.split('').forEach((value,index)=>{inputs[index].value=value;inputs[index].dispatchEvent(new Event('input',{bubbles:true}))});return true})()")
      await waitFor("!localStorage.getItem('ohmyfinance_locked_at') && location.pathname==='/'")
      pass('real Chrome: PIN unlock completes without returning to login')
      await lockAndReload()
      const ja = JSON.parse(fs.readFileSync(path.join(root, 'i18n/locales/ja.json'), 'utf8'))
      await evaluate(`(()=>{[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(ja.security.usePassword)}).click();return true})()`)
      await waitFor("!!document.querySelector('input[type=password]:not([maxlength])')")
      await evaluate(`(()=>{${fill('input[type=password]:not([maxlength])', credentials.password)};document.querySelector('input[type=password]:not([maxlength])').dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true}));return true})()`)
      await waitFor("!localStorage.getItem('ohmyfinance_locked_at') && location.pathname==='/'")
      pass('real Chrome: switching from PIN to password unlock works and retains the session')
    }

    assert.equal((await call('/api/auth/logout', { token: tokens.accessToken, body: { refreshToken: tokens.refreshToken } })).status, 200)
    assert.equal((await call('/api/auth/refresh', { body: { refreshToken: tokens.refreshToken } })).status, 401)
    pass('explicit logout revokes both supplied tokens')
    console.log(`Authentication integration: ${checks} checks passed; production data untouched.`)
  } catch (error) {
    console.error(serverOutput.slice(-4000))
    throw error
  } finally {
    if (browserSession) await browserCall('close', { session_id: browserSession }).catch(() => {})
    if (child && child.exitCode === null) { const ended = new Promise(resolve => child.once('exit', resolve)); child.kill(); await ended }
    if (client) await client.close()
    if (mongo) await mongo.stop()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
