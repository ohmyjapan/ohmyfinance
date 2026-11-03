// Qualified invoices on the actual built application (plan omf-invoice-tnumber-20261030 §4): 登録番号 settings and copy, ※軽減 print,
// the invoice screen, Gmail sending with each Gmail answer, the 経理担当 role and the invite link. Owned throwaway MongoDB, synthetic
// companies A and B (owner, admin, a second admin, accountant, member, viewer) plus restart companies C-H, a fake Google
// (scripts/fake-google-fetch.mjs: the app is started with `--import` of it, so every Google call reaches the fake and every other
// non-loopback call is refused) and, when asked, installed Chrome headless. No model, provider, SMTP/Slack or real Google call.
// The app is started three times: without Gmail settings (L1-L3, L6, L7, M1), with them (L5, L4) and again for the restart leg (M21).
// The first section prints a non-throwing PROBE ledger for the fail-first legs; every later group asserts under its own label.
// OMF_INVOICE_LEGS selects legs (default all): probe, L1, L2, L3, L4, L5 (or L5:<M id>), L6, L7, M21.
const assert = require('node:assert/strict'), fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), net = require('node:net'), crypto = require('node:crypto')
const { spawn } = require('node:child_process'), { MongoMemoryServer } = require('mongodb-memory-server'), { MongoClient, ObjectId } = require('mongodb')
const { createRequire } = require('node:module'), { pathToFileURL } = require('node:url')
const jwt = require('jsonwebtoken')
const root = path.resolve(process.env.OMF_INVOICE_APP_ROOT || path.join(__dirname, '..')), pause = ms => new Promise(r => setTimeout(r, ms))
const ALL = ['probe', 'L1', 'L2', 'L3', 'L6', 'L7', 'L5', 'L4', 'M21']
const LEGS = new Set((process.env.OMF_INVOICE_LEGS || ALL.join(',')).split(',').map(s => s.trim()).filter(Boolean))
const BROWSER = process.env.OMF_INVOICE_BROWSER === '1'
const has = leg => LEGS.has(leg) || (leg === 'L5' && [...LEGS].some(l => l.startsWith('L5:')))
const wantM = id => LEGS.has('L5') || LEGS.has('L5:' + id)
const PASSWORD = 'Synthetic-password-Only1!', VALID = 'T1234567890123', MARK = '※軽減'
const FORMAT_MESSAGE = '登録番号は T と13桁の数字で入力してください。'
const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send', LABELS_SCOPE = 'https://www.googleapis.com/auth/gmail.labels'
const CLIENT_ID = 'fake-omf-client.apps.googleusercontent.com', CLIENT_SECRET = 'fake-omf-client-secret-' + crypto.randomBytes(12).toString('hex'), REDIRECT_URI = 'https://omf.example.invalid/settings/gmail-callback'
const TOKEN_KEY = crypto.randomBytes(32).toString('base64')
const chromePath = () => [path.join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'), path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'), path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')].find(fs.existsSync)
const puppeteerLib = () => { for (const p of [path.join(__dirname, '../collector/package.json'), path.resolve(__dirname, '../../collector/package.json')]) { try { return createRequire(p)('rebrowser-puppeteer-core') } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e } } throw Error('rebrowser-puppeteer-core not found') }
const freePort = async () => { const l = net.createServer(); await new Promise(r => l.listen(0, '127.0.0.1', r)); const p = l.address().port; await new Promise(r => l.close(r)); return p }
const digits = s => String(s || '').replace(/[^0-9]/g, '')

async function main() {
  let mongo, client, directory, fake, app = null, browser = null, allLogs = '', checks = 0
  const pass = s => { checks++; console.log('PASS ' + s) }
  try {
    directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'omf-invoice-'))
    const binary = path.resolve(__dirname, '../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe'), mongoStarted = Date.now()
    mongo = await MongoMemoryServer.create({ binary: fs.existsSync(binary) ? { systemBinary: binary, version: '8.2.1' } : undefined, instance: { launchTimeout: 300000 } })
    console.log('TIMING ' + JSON.stringify({ mongoMs: Date.now() - mongoStarted }))
    const dbName = 'invoice_registration_gmail_regression', uri = mongo.getUri(dbName), secret = crypto.randomBytes(32).toString('hex')
    assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, 'SETUP owned database is the local memory server')
    const { startFakeGoogle, parseMime } = await import(pathToFileURL(path.join(__dirname, 'fake-google-fetch.mjs')).href)
    fake = await startFakeGoogle({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI })
    const refusedPort = await freePort(), chrome = chromePath()
    client = await MongoClient.connect(uri); const db = client.db(dbName)
    let origin = ''
    const boot = async (label, gmail) => {
      const port = await freePort(); origin = 'http://127.0.0.1:' + port
      const gmailEnv = gmail ? { OMF_GMAIL_CLIENT_ID: CLIENT_ID, OMF_GMAIL_CLIENT_SECRET: CLIENT_SECRET, OMF_GMAIL_REDIRECT_URI: REDIRECT_URI, OMF_MAIL_TOKEN_KEY: TOKEN_KEY } : { OMF_GMAIL_CLIENT_ID: '', OMF_GMAIL_CLIENT_SECRET: '', OMF_GMAIL_REDIRECT_URI: '', OMF_MAIL_TOKEN_KEY: '' }
      const child = spawn(process.execPath, ['--import', pathToFileURL(path.join(__dirname, 'fake-google-fetch.mjs')).href, '.output/server/index.mjs'], { cwd: root, windowsHide: true, env: { ...process.env, MONGO_URI: uri, MONGODB_URI: uri, NUXT_MONGO_URI: uri, OMF_DATA_DIR: directory, JWT_SECRET: secret, NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port), OMF_FAKE_GOOGLE_URL: fake.url, OMF_FAKE_GOOGLE_REFUSED_PORT: String(refusedPort), OMF_CHROME_PATH: chrome || '', ...gmailEnv }, stdio: ['ignore', 'pipe', 'pipe'] })
      child.closed = new Promise(r => child.once('close', r)); child.logs = ''
      for (const s of [child.stdout, child.stderr]) s.on('data', v => { child.logs = (child.logs + v).slice(-200000); allLogs = (allLogs + v).slice(-2000000) })
      const started = Date.now(); let healthy = false
      for (let i = 0; i < 1500; i++) { try { const r = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) }), d = await r.json(); if (d.database?.connected) { assert.equal(d.database.name, dbName); healthy = true; break } } catch {} await pause(200) }
      assert.ok(healthy, 'SETUP owned app ' + label + ' ' + child.logs.slice(-1500))
      console.log('TIMING ' + JSON.stringify({ boot: label, appMs: Date.now() - started }))
      app = child; return child
    }
    const stop = async (hard = false) => { if (app) { const c = app; app = null; if (hard && process.platform === 'win32') { try { require('node:child_process').execSync('taskkill /F /T /PID ' + c.pid, { stdio: 'ignore' }) } catch {} } else c.kill(); await c.closed } }
    const api = async (route, token, method = 'GET', body, timeout = 30000) => { const r = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout) }), raw = await r.text(); let data; try { data = JSON.parse(raw) } catch {} return { status: r.status, data, raw } }
    const ok = async (route, token, method = 'GET', body, label = 'positive', timeout) => { const r = await api(route, token, method, body, timeout); assert.equal(r.status, 200, 'invoice:' + label + ' ' + method + ' ' + route + ' ' + r.raw.slice(0, 400)); return r.data }
    const said = r => JSON.stringify(r.data || r.raw || '')

    await boot('plain', false)
    // ---- SETUP: users and companies. The accountant members are added at L6 (the unchanged schema has no such role).
    const users = {}
    // Registration is rate-limited to 5 a minute, so the synthetic users are inserted with a real bcrypt hash (the login page still
    // checks it) and their company-less access tokens are signed with this run's own secret; company tokens come from the server.
    const passwordHash = await require('bcryptjs').hash(PASSWORD, 4)
    const register = async (key, email) => { const id = new ObjectId(), at = new Date(); await db.collection('users').insertOne({ _id: id, email, password: passwordHash, name: 'Synthetic ' + key, isActive: true, isEmailVerified: true, preferences: { language: 'ja', currency: 'JPY', timezone: 'Asia/Tokyo', darkMode: false }, loginAttempts: 0, twoFactorEnabled: false, createdAt: at, updatedAt: at }); users[key] = { key, email, id, plain: jwt.sign({ userId: String(id), email, jti: crypto.randomUUID() }, secret, { expiresIn: '3h' }) }; return users[key] }
    for (const k of ['ownerA', 'adminA', 'adminA2', 'accA', 'memberA', 'viewerA', 'ownerB', 'adminB', 'accB', 'memberB', 'viewerB', 'q12existing']) await register(k, k.toLowerCase() + '@example.invalid')
    const A = new ObjectId(), B = new ObjectId(), now = new Date(), m = (u, role) => ({ userId: users[u].id, role, joinedAt: now })
    const companyA = { _id: A, name: 'Synthetic invoice A', slug: 'invoice-a', type: 'business', isActive: true, taxId: VALID, email: 'issuer-a@example.invalid', phone: '03-0000-0001', website: '', description: '', address: { line1: '1-1 Synthetic', city: 'Chiyoda', state: 'Tokyo', postalCode: '100-0001', country: 'JP' }, members: [m('ownerA', 'owner'), m('adminA', 'admin'), m('adminA2', 'admin'), m('memberA', 'member'), m('viewerA', 'viewer')], settings: { defaultCurrency: 'JPY', fiscalYearStart: 4, timezone: 'Asia/Tokyo', invoicePrefix: 'INV', invoiceNextNumber: 1 }, createdAt: now, updatedAt: now }
    const companyB = { _id: B, name: 'Synthetic invoice B', slug: 'invoice-b', type: 'business', isActive: true, email: 'issuer-b@example.invalid', address: { country: 'JP' }, members: [m('ownerB', 'owner'), m('adminB', 'admin'), m('memberB', 'member'), m('viewerB', 'viewer')], settings: { defaultCurrency: 'JPY', fiscalYearStart: 4, timezone: 'Asia/Tokyo', invoicePrefix: 'INV', invoiceNextNumber: 1 }, createdAt: now, updatedAt: now }
    await db.collection('organizations').insertMany([companyA, companyB])
    const tokenOf = async (u, company) => (await ok('/api/auth/switch-organization', users[u].plain, 'POST', { organizationId: String(company) }, 'switch')).tokens.accessToken
    const T = {}
    for (const u of ['ownerA', 'adminA', 'adminA2', 'memberA', 'viewerA']) T[u] = await tokenOf(u, A)
    for (const u of ['ownerB', 'adminB', 'memberB', 'viewerB']) T[u] = await tokenOf(u, B)
    const invoices = db.collection('invoices'), orgs = db.collection('organizations')
    let seq = 0
    const invoiceDoc = (company, o = {}) => ({ _id: new ObjectId(), organizationId: company, invoiceNumber: 'INV-T-' + String(++seq).padStart(4, '0'), status: 'draft', issueDate: new Date('2026-10-20T03:00:00Z'), dueDate: new Date('2026-11-30T03:00:00Z'), from: { name: 'Synthetic issuer' }, to: { name: 'Synthetic client', email: 'client-' + seq + '@example.invalid' }, items: [{ description: 'Synthetic work ' + seq, quantity: 1, unitPrice: 1000, amount: 1000 }], subtotal: 1000, taxRate: 10, taxAmount: 100, total: 1100, currency: 'JPY', createdAt: new Date(Date.now() + seq), updatedAt: new Date(Date.now() + seq), ...o })
    const settingsBody = (o, taxId) => ({ name: o.name, type: o.type, email: o.email || '', phone: o.phone || '', website: o.website || '', taxId, description: o.description || '', settings: { defaultCurrency: 'JPY', timezone: 'Asia/Tokyo', fiscalYearStart: 4 } })
    const putSettings = async (token, company, taxId, name) => { const o = await orgs.findOne({ _id: company }); return api('/api/organizations/' + company, token, 'PUT', { ...settingsBody(o, taxId), ...(name ? { name } : {}) }) }

    // ---- 0. Fail-first ledger (non-throwing): the legs the plan names must FAIL on the unchanged build.
    const probe = (label, v) => { console.log((v ? 'PROBE-OK ' : 'PROBE-FAIL ') + label); return v }
    if (LEGS.has('probe')) {
      { const r = await putSettings(T.ownerA, A, 'T12345'); probe('L1 invoice:settings-invalid (a changed T12345 is refused 400)', r.status === 400); await orgs.updateOne({ _id: A }, { $set: { taxId: VALID } }) }
      { const r = await api('/api/invoices', T.ownerA, 'POST', { from: { name: 'Probe issuer' }, to: { name: 'Probe client' }, items: [{ description: 'Probe', quantity: 1, unitPrice: 100 }], taxRate: 10 }); const row = r.status === 200 ? await invoices.findOne({ _id: new ObjectId(String(r.data.invoice._id)) }) : null; probe('L2 invoice:copy (a new invoice carries the company 登録番号)', row?.from?.taxId === VALID) }
      { const doc = invoiceDoc(A, { from: { name: 'Probe issuer', taxId: VALID }, taxRate: 8, taxAmount: 80, total: 1080 }); await invoices.insertOne(doc); const r = await api('/api/invoices/' + doc._id + '/pdf', T.ownerA); probe('L3 invoice:print (登録番号 and ※軽減 printed)', r.status === 200 && r.raw.includes('登録番号 ' + VALID) && r.raw.includes(MARK)) }
      { const dir = path.join(root, '.output/public/_nuxt'); let issuer = false, role = false, link = false; for (const f of await fsp.readdir(dir)) if (f.endsWith('.js')) { const s = await fsp.readFile(path.join(dir, f), 'utf8'); issuer ||= s.includes('data-invoice-issuer'); role ||= s.includes('経理担当'); link ||= s.includes('data-invite-link') } probe('L4 invoice-ui:bundle (issuer step and 経理担当 label in the client bundle)', issuer && role); probe('L7 invite-ui:bundle (the settings page shows an invite link)', link) }
      { const r = await api('/api/company-mail/gmail', T.ownerA); console.log('PROBE-INFO L5 GET /api/company-mail/gmail answers ' + r.status + (r.data ? ' JSON' : ' non-JSON (' + r.raw.slice(0, 40).replace(/\s+/g, ' ') + ')')); probe('L5 gmail:status (the Gmail status route answers its JSON status)', r.status === 200 && typeof r.data?.configured === 'boolean' && typeof r.data?.canSend === 'boolean') }
      { const r = await api('/api/organizations/' + A + '/members', T.ownerA, 'PUT', { userId: String(users.memberA.id), role: 'accountant' }); probe('L6 roles:accountant (an owner can give 経理担当)', r.status === 200); if (r.status === 200) await orgs.updateOne({ _id: A, 'members.userId': users.memberA.id }, { $set: { 'members.$.role': 'member' } }) }
      { const r = await api('/api/organizations/' + A + '/invite', T.ownerA, 'POST', { email: 'probe-owner@example.invalid', role: 'owner' }); probe('L6 roles:invite-owner (an owner invite is refused 400)', r.status === 400) }
      { const r = await api('/api/organizations/' + A + '/invite', T.ownerA, 'POST', { email: 'probe-jwt@example.invalid', role: 'member' }); const token = r.data?.inviteUrl ? new URL(r.data.inviteUrl).searchParams.get('token') : null; const g = token ? await api('/api/invites/' + encodeURIComponent(token), null) : null; console.log('PROBE-INFO L7 the JWT /invite link on the invite page answers ' + (g ? g.status + ' ' + (g.data?.statusMessage || g.data?.message || '') : 'no link')) }
    }

    // ---- L1. Settings: 登録番号 saved normalized only when changed; a changed invalid value is refused; an unchanged 法人番号 passes.
    if (has('L1')) {
      let r = await putSettings(T.ownerA, A, 'T5555555555555'); assert.equal(r.status, 200, 'invoice:settings-valid ' + r.raw.slice(0, 300)); assert.equal((await orgs.findOne({ _id: A })).taxId, 'T5555555555555', 'invoice:settings-valid')
      for (const bad of ['T555555555555', '5555555555555', 'X5555555555555', 'T55555555555555', 'T5555-55555555']) {
        r = await putSettings(T.ownerA, A, bad); assert.equal(r.status, 400, 'invoice:settings-invalid ' + bad + ' answered ' + r.status + ' ' + r.raw.slice(0, 200)); assert.ok(said(r).includes(FORMAT_MESSAGE), 'invoice:settings-invalid-message ' + said(r).slice(0, 300))
        assert.equal((await orgs.findOne({ _id: A })).taxId, 'T5555555555555', 'invoice:settings-invalid-unsaved ' + bad)
      }
      r = await putSettings(T.ownerA, A, 'Ｔ１２３４５６７８９０１２３'); assert.equal(r.status, 200, 'invoice:settings-full-width'); assert.equal((await orgs.findOne({ _id: A })).taxId, VALID, 'invoice:settings-full-width')
      r = await putSettings(T.adminA, A, ' t1234567890123 '); assert.equal(r.status, 200, 'invoice:settings-padded'); assert.equal((await orgs.findOne({ _id: A })).taxId, VALID, 'invoice:settings-padded')
      r = await putSettings(T.ownerA, A, ''); assert.equal(r.status, 200, 'invoice:settings-empty'); assert.equal((await orgs.findOne({ _id: A })).taxId, '', 'invoice:settings-empty')
      await orgs.updateOne({ _id: A }, { $set: { taxId: '3120003020732' } })
      r = await putSettings(T.ownerA, A, '3120003020732', 'Synthetic invoice A renamed'); assert.equal(r.status, 200, 'invoice:settings-unchanged-corporate-number ' + r.raw.slice(0, 200)); let row = await orgs.findOne({ _id: A }); assert.equal(row.taxId, '3120003020732', 'invoice:settings-unchanged-corporate-number'); assert.equal(row.name, 'Synthetic invoice A renamed')
      r = await putSettings(T.ownerA, A, '3120003020733'); assert.equal(r.status, 400, 'invoice:settings-invalid changed corporate number'); assert.equal((await orgs.findOne({ _id: A })).taxId, '3120003020732')
      r = await putSettings(T.ownerA, A, VALID, companyA.name); assert.equal(r.status, 200); row = await orgs.findOne({ _id: A }); assert.equal(row.taxId, VALID); assert.equal(row.name, companyA.name)
      assert.equal((await putSettings(T.memberA, A, 'T7777777777777')).status, 403, 'invoice:settings-member-403')
      pass('settings: a changed valid 登録番号 is saved; 12/13-digit/X/14/dashed changes answer 400 with the format message and save nothing; full-width and padded input are stored normalized; empty saves; an unchanged 13-digit 法人番号 passes while other fields save, a changed one is refused; members still 403')
    }

    // ---- L2. Copy: every written issuer block takes the company 登録番号; a body value is ignored; Navi create too; totals unchanged.
    if (has('L2')) {
      const created = async (token, body) => { const d = await ok('/api/invoices', token, 'POST', body, 'invoice-create'); return invoices.findOne({ _id: new ObjectId(String(d.invoice._id)) }) }
      let row = await created(T.ownerA, { from: { name: companyA.name, email: companyA.email }, to: { name: 'Client P6' }, items: [{ description: 'Work', quantity: 2, unitPrice: 5000 }], taxRate: 10 })
      assert.equal(row.from.taxId, VALID, 'invoice:copy create'); assert.deepEqual([row.subtotal, row.taxAmount, row.total], [10000, 1000, 11000], 'invoice:copy totals')
      const p6 = row
      row = await created(T.ownerA, { from: { name: companyA.name, taxId: 'T9999999999999' }, to: { name: 'Client body' }, items: [{ description: 'Work', quantity: 3, unitPrice: 1234 }], taxRate: 8 })
      assert.equal(row.from.taxId, VALID, 'invoice:copy body-ignored'); assert.deepEqual([row.subtotal, row.taxAmount, row.total], [3702, 296, 3998], 'invoice:copy totals 8')
      row = await created(T.ownerB, { from: { name: 'B issuer', taxId: 'T9999999999999' }, to: { name: 'Client B' }, items: [{ description: 'Work', quantity: 1, unitPrice: 100 }] })
      assert.equal(row.from.taxId, undefined, 'invoice:copy no-number removed')
      await orgs.updateOne({ _id: B }, { $set: { taxId: '3120003020732' } })
      row = await created(T.ownerB, { from: { name: 'B issuer', taxId: '3120003020732' }, to: { name: 'Client B' }, items: [{ description: 'Work', quantity: 1, unitPrice: 100 }] })
      assert.equal(row.from.taxId, undefined, 'invoice:copy invalid-saved removed'); await orgs.updateOne({ _id: B }, { $unset: { taxId: '' } })
      // Update: an edit without `from` keeps the issuer block; an edit with `from` takes the company's current number.
      await orgs.updateOne({ _id: A }, { $set: { taxId: 'T2222222222222' } })
      await ok('/api/invoices/' + p6._id, T.ownerA, 'PUT', { items: [{ description: 'Work', quantity: 3, unitPrice: 5000 }] }, 'invoice-update')
      row = await invoices.findOne({ _id: p6._id }); assert.equal(row.from.taxId, VALID, 'invoice:copy update-without-from'); assert.equal(row.total, 16500)
      await ok('/api/invoices/' + p6._id, T.ownerA, 'PUT', { from: { name: 'Renamed issuer', taxId: 'T0000000000000' } }, 'invoice-update')
      row = await invoices.findOne({ _id: p6._id }); assert.equal(row.from.taxId, 'T2222222222222', 'invoice:copy update-rewrites'); assert.equal(row.from.name, 'Renamed issuer')
      await orgs.updateOne({ _id: A }, { $set: { taxId: VALID } })
      // One Navi create through the owned worker (simulated worker replies only).
      const account = (await ok('/api/finance/accounts', users.ownerA.plain, 'POST', { name: 'Synthetic invoice card', primaryCard: '54321', cardIdentifiers: ['54321'], otpRecipient: 'test@example.invalid', otpMailbox: 'test@example.invalid' }, 'account')).account
      const agent = await ok('/api/finance-chat/agents', users.ownerA.plain, 'POST', { accountIds: [account._id], workspaceEnabled: true }, 'agent'), worker = (route, body = {}) => api('/api/finance-chat/worker/' + route, agent.token, 'POST', body)
      assert.equal((await worker('heartbeat')).status, 200)
      const endpoint = '/api/finance-chat/company-workspace', view = await ok(endpoint, T.ownerA, 'GET', undefined, 'navi-view')
      assert.equal((await worker('heartbeat')).status, 200)
      await ok(endpoint, T.ownerA, 'POST', { requestId: crypto.randomBytes(16).toString('hex'), chatRevision: view.conversation?.revision || 0, text: 'Create the invoice as written.', context: { page: 'invoices' } }, 'navi-ask')
      assert.equal((await worker('heartbeat')).status, 200); const claimed = await worker('workspace-claim'); assert.equal(claimed.status, 200, 'invoice:navi-claim ' + claimed.raw.slice(0, 300)); const job = claimed.data.job
      const act = await worker('workspace/' + job.id + '/actions', { lease: job.lease, name: 'create_company_invoice', args: { from: { name: 'NAVI_ISSUER', taxId: 'T9999999999999' }, to: { name: 'NAVI_CLIENT' }, items: [{ description: 'Navi work', quantity: 2, unitPrice: 50000 }], taxRate: 10, currency: 'JPY', issueDate: '2026-10-20', dueDate: '2026-11-30' }, slot: 1 })
      assert.equal(act.status, 200, 'invoice:copy navi ' + act.raw.slice(0, 300)); row = await invoices.findOne({ _id: new ObjectId(act.data.receipt.nativeResourceIds.invoiceId) })
      assert.equal(row.from.taxId, VALID, 'invoice:copy navi'); assert.equal(row.from.name, 'NAVI_ISSUER'); assert.deepEqual([row.subtotal, row.taxAmount, row.total], [100000, 10000, 110000])
      assert.equal(act.data.result.invoice.delivery, 'not_sent_saved_record_only', 'invoice:navi-delivery-unsent')
      assert.equal((await worker('workspace/' + job.id + '/result', { lease: job.lease, proposal: { kind: 'unclear', summary: 'Synthetic invoice reply', patch: {}, quotes: {} } })).status, 200)
      pass('copy: page create and update with `from`, and Navi create, store the company 登録番号 in from.taxId whatever the body says; an edit without `from` keeps the block; no or invalid saved number removes it; totals are the old arithmetic')
    }

    // ---- L3. Print: 登録番号 when valid, "Tax ID" for other values, ※軽減 on 8% from 2019-10-01 (JST) only.
    if (has('L3')) {
      const print = async o => { const doc = invoiceDoc(A, o); await invoices.insertOne(doc); const r = await api('/api/invoices/' + doc._id + '/pdf', T.ownerA); assert.equal(r.status, 200, 'invoice:print ' + r.raw.slice(0, 200)); return r.raw }
      const marks = html => html.split(MARK).length - 1
      let html = await print({ from: { name: 'Print issuer', taxId: VALID }, taxRate: 8, items: [{ description: 'Food A', quantity: 1, unitPrice: 1000, amount: 1000 }, { description: 'Food B', quantity: 2, unitPrice: 500, amount: 1000 }], subtotal: 2000, taxAmount: 160, total: 2160 })
      assert.ok(html.includes('登録番号 ' + VALID), 'invoice:print registration'); assert.ok(!html.includes('Tax ID'), 'invoice:print registration not Tax ID')
      assert.equal(marks(html), 3, 'invoice:print reduced-mark count'); assert.ok(html.includes('Food A ' + MARK) && html.includes('Food B ' + MARK), 'invoice:print reduced-mark items'); assert.match(html, /Tax \(8%\) ※軽減/, 'invoice:print reduced-mark tax line')
      html = await print({ from: { name: 'Print issuer', taxId: '3120003020732' }, taxRate: 10 }); assert.ok(html.includes('Tax ID: 3120003020732'), 'invoice:print other-value'); assert.ok(!html.includes('登録番号'), 'invoice:print other-value'); assert.equal(marks(html), 0, 'invoice:print reduced-mark 10%')
      html = await print({ from: { name: 'Print issuer' }, taxRate: 0, taxAmount: 0, total: 1000 }); assert.ok(!html.includes('登録番号') && !html.includes('Tax ID'), 'invoice:print none'); assert.equal(marks(html), 0, 'invoice:print reduced-mark 0%')
      html = await print({ from: { name: 'Print issuer', taxId: VALID }, taxRate: 8, issueDate: new Date('2019-09-30T12:00:00Z') }); assert.equal(marks(html), 0, 'invoice:print reduced-mark before 2019-10-01')
      html = await print({ from: { name: 'Print issuer', taxId: VALID }, taxRate: 8, issueDate: new Date('2019-09-30T15:00:00Z') }); assert.equal(marks(html), 2, 'invoice:print reduced-mark from 2019-10-01 JST')
      pass('print: 登録番号 T… for a valid number, "Tax ID" for other saved values, nothing without one; ※軽減 on every line and the tax line at 8% from 2019-10-01 JST, none at 10%, 0% or 8% before')
    }

    // ---- L6. Roles: 経理担当 given like the other roles; invites carry it; no route invites an owner; pre-fix owner JWTs refused.
    if (has('L6') || has('L7') || has('L5') || has('L4') || has('M21')) {
      await orgs.updateOne({ _id: A }, { $push: { members: m('accA', 'accountant') } }); await orgs.updateOne({ _id: B }, { $push: { members: m('accB', 'accountant') } })
      T.accA = await tokenOf('accA', A); T.accB = await tokenOf('accB', B)
    }
    const roleIn = async (company, u) => (await orgs.findOne({ _id: company })).members.find(x => String(x.userId) === String(users[u].id))?.role
    const setRole = (token, u, role) => api('/api/organizations/' + A + '/members', token, 'PUT', { userId: String(users[u].id), role })
    if (has('L6')) {
      assert.equal((await setRole(T.ownerA, 'memberA', 'accountant')).status, 200, 'roles:owner-gives-accountant'); assert.equal(await roleIn(A, 'memberA'), 'accountant')
      assert.equal((await setRole(T.ownerA, 'memberA', 'member')).status, 200); assert.equal(await roleIn(A, 'memberA'), 'member')
      assert.equal((await setRole(T.adminA, 'viewerA', 'accountant')).status, 200, 'roles:admin-gives-accountant'); assert.equal(await roleIn(A, 'viewerA'), 'accountant')
      assert.equal((await setRole(T.adminA, 'viewerA', 'viewer')).status, 200); assert.equal(await roleIn(A, 'viewerA'), 'viewer')
      assert.equal((await setRole(T.adminA, 'adminA2', 'accountant')).status, 403, 'roles:admin-row-protected'); assert.equal((await setRole(T.adminA, 'ownerA', 'accountant')).status, 403, 'roles:owner-row-protected')
      for (const u of ['memberA', 'viewerA', 'accA']) assert.equal((await setRole(T[u], 'viewerA', 'accountant')).status, 403, 'roles:' + u + '-cannot-give')
      assert.equal((await setRole(T.ownerA, 'memberA', 'owner')).status, 400, 'roles:owner-not-assignable')
      // Q4: both invite routes carry 経理担当 into the membership.
      const inv = await ok('/api/organizations/' + A + '/invites', T.adminA, 'POST', { email: 'q4-row@example.invalid', role: 'accountant', sendEmailNotification: false }, 'invite-row')
      assert.equal(inv.invite.role, 'accountant'); const joined = await ok('/api/invites/accept', null, 'POST', { token: new URL(inv.inviteUrl).searchParams.get('token'), name: 'Q4 row', password: PASSWORD }, 'invite-row-accept')
      assert.equal(joined.organization.role, 'accountant', 'roles:invite-row-accountant'); const q4row = await db.collection('users').findOne({ email: 'q4-row@example.invalid' }); assert.equal((await orgs.findOne({ _id: A })).members.find(x => String(x.userId) === String(q4row._id)).role, 'accountant', 'roles:invite-row-accountant')
      const jwtInvite = await ok('/api/organizations/' + A + '/invite', T.adminA, 'POST', { email: 'q4-jwt@example.invalid', role: 'accountant' }, 'invite-jwt')
      assert.ok(jwtInvite.inviteToken, 'roles:invite-jwt-accountant'); const jwtJoined = await ok('/api/auth/accept-invite', null, 'POST', { inviteToken: jwtInvite.inviteToken, name: 'Q4 jwt', password: PASSWORD }, 'invite-jwt-accept')
      assert.equal((await orgs.findOne({ _id: A })).members.find(x => String(x.userId) === String(jwtJoined.user.id || jwtJoined.user._id)).role, 'accountant', 'roles:invite-jwt-accountant')
      // Q9: the JWT route refuses an owner or unknown role before minting anything.
      for (const role of ['owner', 'superuser', 'OWNER']) { const r = await api('/api/organizations/' + A + '/invite', T.ownerA, 'POST', { email: 'q9-' + role.toLowerCase() + '@example.invalid', role }); assert.equal(r.status, 400, 'roles:invite-owner ' + role + ' answered ' + r.status + ' ' + r.raw.slice(0, 200)); assert.ok(!r.data?.inviteToken && !r.raw.includes('accept-invite?token='), 'roles:invite-owner nothing minted') }
      assert.equal((await api('/api/organizations/' + A + '/invites', T.ownerA, 'POST', { email: 'q9-row@example.invalid', role: 'owner', sendEmailNotification: false })).status, 400, 'roles:invite-row-owner')
      // Q10: a pre-fix invite JWT carrying owner is refused at accept; nothing changes.
      const before = (await orgs.findOne({ _id: A })).members.length
      const forged = jwt.sign({ type: 'invite', organizationId: String(A), email: 'q10-owner@example.invalid', role: 'owner', invitedBy: String(users.adminA.id) }, secret, { expiresIn: '7d' })
      const r10 = await api('/api/auth/accept-invite', null, 'POST', { inviteToken: forged, name: 'Q10', password: PASSWORD }); assert.equal(r10.status, 400, 'roles:prefix-owner-jwt answered ' + r10.status + ' ' + r10.raw.slice(0, 200))
      assert.equal((await orgs.findOne({ _id: A })).members.length, before, 'roles:prefix-owner-jwt members unchanged'); assert.equal(await db.collection('users').findOne({ email: 'q10-owner@example.invalid' }), null, 'roles:prefix-owner-jwt no user')
      // Q7: an accountant keeps every member right (create, print) and is refused company settings.
      const accInvoice = await ok('/api/invoices', T.accA, 'POST', { from: { name: 'Acc issuer' }, to: { name: 'Acc client' }, items: [{ description: 'Acc work', quantity: 1, unitPrice: 100 }] }, 'accountant-create')
      assert.equal((await api('/api/invoices/' + accInvoice.invoice._id + '/pdf', T.accA)).status, 200, 'roles:accountant-print'); assert.equal((await putSettings(T.accA, A, VALID)).status, 403, 'roles:accountant-no-settings')
      assert.equal((await api('/api/organizations/' + A + '/invites', T.accA)).status, 403, 'roles:accountant-no-invites')
      pass('roles: owner and admin give and take 経理担当 (admin and owner rows protected, owner never assignable); member/viewer/accountant cannot; both invite routes join as accountant; owner/unknown roles refused 400 with nothing minted; a pre-fix owner JWT is refused and changes nothing; an accountant creates and prints, settings and invites stay 403')
    }

    // ---- L7. Installed Chrome: the settings invite makes an Invite row whose link opens on the invite page (Q11-Q14), labels (Q8).
    const openBrowser = async () => { if (browser) return browser; const puppeteer = puppeteerLib(); assert.ok(chrome, 'Installed Chrome required'); const profile = path.join(directory, 'profile-' + crypto.randomBytes(4).toString('hex')); await fsp.mkdir(profile, { recursive: true }); browser = await puppeteer.launch({ executablePath: chrome, userDataDir: profile, pipe: true, headless: true, args: ['--lang=ja-JP,ja', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync'] }); return browser }
    const pageErrors = []
    const newPage = async (fresh = true) => { const b = await openBrowser(); const context = fresh ? await b.createBrowserContext() : b.defaultBrowserContext(); const page = await context.newPage(); await page.setViewport({ width: 390, height: 844 }); page.on('pageerror', e => pageErrors.push(String(e))); page.on('dialog', d => { if (d.type() === 'confirm') d.accept().catch(() => {}); else { pageErrors.push('dialog: ' + d.message()); d.dismiss().catch(() => {}) } }); page.context_ = context; return page }
    const wait = async (page, fn, args = [], label = 'condition', tries = 1200) => { for (let i = 0; i < tries; i++) { try { if (await page.evaluate(fn, ...args)) return } catch {} await pause(100) } throw Error('invoice-ui:' + label + ' url=' + page.url() + ' text=' + (await page.evaluate(() => document.body?.innerText || '').catch(() => '')).slice(0, 600)) }
    const login = async (page, u) => { await page.goto(origin + '/login', { waitUntil: 'networkidle2' }); await wait(page, () => !!document.querySelector('#email'), [], 'login-form'); await page.type('#email', users[u].email); await page.type('#password', PASSWORD); await page.evaluate(() => document.querySelector('button[type=submit]').click()); await wait(page, () => location.pathname === '/', [], 'login ' + u) }
    const nativeSwitch = (page, organizationId) => page.evaluate(async organizationId => { const user = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user'); const r = await fetch('/api/auth/switch-organization', { method: 'POST', headers: { ...user.authHeader, 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId }) }), s = await r.json(); if (!r.ok) throw Error('Synthetic switch failed'); const p = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + s.tokens.accessToken } }); user.acceptSession({ ...await p.json(), tokens: s.tokens }, false) }, String(organizationId))
    const clickText = (page, selector, text) => page.evaluate((selector, text) => { const el = [...document.querySelectorAll(selector)].find(e => e.textContent.includes(text)); if (!el) return false; el.click(); return true }, selector, text)
    const setValue = (page, selector, value) => page.$eval(selector, (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })) }, value)
    const closeContext = async page => { try { if (page.context_ && page.context_ !== browser.defaultBrowserContext()) await page.context_.close(); else await page.close() } catch {} }
    if (has('L7') && BROWSER) {
      const logsBefore = app.logs.length
      const owner = await newPage(false)
      await login(owner, 'ownerA'); await nativeSwitch(owner, A)
      await owner.goto(origin + '/settings/organization', { waitUntil: 'networkidle2' })
      await wait(owner, () => document.querySelectorAll('[data-member-role]').length >= 6, [], 'members-table')
      const labels = await owner.$$eval('[data-member-role]', els => els.map(e => e.textContent.trim()))
      assert.ok(labels.includes('経理担当') && labels.includes('オーナー') && labels.includes('管理者') && labels.includes('一般') && labels.includes('閲覧のみ'), 'invite-ui:role-badges ' + JSON.stringify(labels))
      const options = await owner.$eval('[data-member-role-select]', s => [...s.options].map(o => [o.value, o.textContent.trim()]))
      assert.deepEqual(options, [['admin', '管理者'], ['accountant', '経理担当'], ['member', '一般'], ['viewer', '閲覧のみ']], 'invite-ui:role-select')
      assert.ok(await owner.$eval('[data-roles-help]', e => e.textContent.includes('経理担当')), 'invite-ui:roles-help')
      // The invite modal is found by its own form (the fixed overlay holding the email field); its lines carry no test hooks.
      const MODAL = "[...document.querySelectorAll('div.fixed')].find(d => d.querySelector('form input[type=email]'))"
      const inModal = (selector, fn) => owner.evaluate(new Function('selector', 'return (' + fn + ')((' + MODAL + ')?.querySelector(selector))'), selector)
      const invite = async (email, role) => {
        assert.ok(await clickText(owner, 'button', 'メンバーを招待'), 'invite-ui:open-modal'); await wait(owner, new Function('return !!(' + MODAL + ')'), [], 'invite-modal')
        const roleOptions = await inModal('form select', 's => [...s.options].map(o => o.value)'); assert.deepEqual(roleOptions, ['member', 'accountant', 'admin', 'viewer'], 'invite-ui:invite-roles')
        assert.deepEqual(await inModal('form select', 's => [...s.options].map(o => o.textContent.trim())'), ['一般', '経理担当', '管理者', '閲覧のみ'], 'invite-ui:invite-role-labels')
        await owner.evaluate(new Function('email', 'role', 'const m = ' + MODAL + '; const set = (e, v) => { e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })) }; set(m.querySelector("form input[type=email]"), email); set(m.querySelector("form select"), role); m.querySelector("form button[type=submit]").click()'), email, role)
        await wait(owner, () => !!document.querySelector('[data-invite-link]')?.textContent.trim(), [], 'invite-link')
        const shown = await owner.evaluate(new Function('return (() => { const m = ' + MODAL + '; return { link: document.querySelector("[data-invite-link]").textContent.trim(), result: document.querySelector("[data-invite-result]").textContent, copy: !!document.querySelector("[data-invite-copy]"), modal: m.textContent } })()'))
        assert.ok(shown.link.startsWith(origin + '/auth/accept-invite?token='), 'invite-ui:link-on-page-origin ' + shown.link); assert.match(new URL(shown.link).searchParams.get('token') || '', /^[0-9a-f]{64}$/, 'invite-ui:link-token')
        assert.ok(shown.result.includes('招待リンクを作成しました。相手に送ってください'), 'invite-ui:link-text'); assert.ok(shown.copy, 'invite-ui:copy-button')
        assert.ok(!/送信しました|送りました|Invitation sent|メールを送信/.test(shown.modal), 'invite-ui:never-says-sent ' + shown.modal)
        const row = await db.collection('invites').findOne({ email, status: 'pending' }); assert.ok(row, 'invite-ui:invite-row'); assert.equal(row.role, role, 'invite-ui:invite-row-role'); assert.equal(row.token, new URL(shown.link).searchParams.get('token'), 'invite-ui:invite-row-token')
        await owner.evaluate(new Function('const m = ' + MODAL + '; [...m.querySelectorAll("form button[type=button]")].find(b => b.textContent.includes("キャンセル")).click()'))
        await wait(owner, new Function('return !(' + MODAL + ')'), [], 'invite-modal-closed')
        return shown.link
      }
      // Q11: a new person opens the link in a fresh browser, registers and joins as 経理担当.
      const link1 = await invite('q11-new@example.invalid', 'accountant')
      let guest = await newPage(true); await guest.goto(link1, { waitUntil: 'networkidle2' })
      await wait(guest, () => !!document.querySelector('#name'), [], 'invite-registration-form')
      assert.ok(await guest.evaluate(() => document.body.innerText.includes('経理担当')), 'invite-ui:accept-page-role-label')
      await guest.type('#name', 'Q11 person'); await guest.type('#password', PASSWORD); await guest.type('#confirmPassword', PASSWORD); await guest.evaluate(() => document.querySelector('form button[type=submit]').click())
      let joinedUser = null; for (let i = 0; i < 150 && !joinedUser; i++) { joinedUser = await db.collection('users').findOne({ email: 'q11-new@example.invalid' }); if (!joinedUser) await pause(100) }
      for (let i = 0; i < 100; i++) { if ((await orgs.findOne({ _id: A })).members.some(x => String(x.userId) === String(joinedUser._id))) break; await pause(100) }
      assert.equal((await orgs.findOne({ _id: A })).members.find(x => String(x.userId) === String(joinedUser._id))?.role, 'accountant', 'invite-ui:joined-as-accountant'); await closeContext(guest)
      // Q12: an existing account logs in from the link and joins with the invited role.
      const link2 = await invite(users.q12existing.email, 'viewer')
      guest = await newPage(true); await guest.goto(link2, { waitUntil: 'networkidle2' })
      await wait(guest, () => location.pathname === '/login' && !!document.querySelector('#email'), [], 'invite-requires-login')
      await guest.type('#email', users.q12existing.email); await guest.type('#password', PASSWORD); await guest.evaluate(() => document.querySelector('button[type=submit]').click())
      await wait(guest, () => location.pathname === '/auth/accept-invite' && [...document.querySelectorAll('button')].some(b => !b.disabled && b.textContent.includes('承認して参加')), [], 'invite-accept-button')
      await guest.evaluate(() => [...document.querySelectorAll('button')].find(b => !b.disabled && b.textContent.includes('承認して参加')).click())
      for (let i = 0; i < 150; i++) { if (await roleIn(A, 'q12existing')) break; await pause(100) }
      assert.equal(await roleIn(A, 'q12existing'), 'viewer', 'invite-ui:existing-user-joined-with-role'); await closeContext(guest)
      // Q13: a lost link is cancelled from the pending list; the old link shows cancelled; a new invite works.
      const link3 = await invite('q13-lost@example.invalid', 'member')
      await wait(owner, () => [...document.querySelectorAll('[data-pending-invite]')].some(r => r.textContent.includes('q13-lost@example.invalid')), [], 'pending-list')
      const pendingRow = await owner.evaluate(() => [...document.querySelectorAll('[data-pending-invite]')].find(r => r.textContent.includes('q13-lost@example.invalid')).textContent)
      assert.ok(pendingRow.includes('一般'), 'invite-ui:pending-role-label ' + pendingRow)
      await owner.evaluate(() => [...document.querySelectorAll('[data-pending-invite]')].find(r => r.textContent.includes('q13-lost@example.invalid')).querySelector('[data-invite-cancel]').click())
      await wait(owner, () => ![...document.querySelectorAll('[data-pending-invite]')].some(r => r.textContent.includes('q13-lost@example.invalid')), [], 'pending-cancelled')
      assert.equal((await db.collection('invites').findOne({ token: new URL(link3).searchParams.get('token') })).status, 'cancelled', 'invite-ui:cancelled-row')
      guest = await newPage(true); await guest.goto(link3, { waitUntil: 'networkidle2' }); await wait(guest, () => document.body.innerText.includes('cancelled'), [], 'old-link-cancelled')
      const link4 = await invite('q13-lost@example.invalid', 'member'); assert.notEqual(link4, link3)
      await guest.goto(link4, { waitUntil: 'networkidle2' }); await wait(guest, () => !!document.querySelector('#name'), [], 'new-link-works'); await closeContext(guest)
      // Q14: nothing in OMF claimed or attempted a mail.
      assert.ok(!app.logs.slice(logsBefore).includes('[Email]'), 'invite-ui:no-email-log')
      // Q8: profile page of an accountant.
      const acc = await newPage(true); await login(acc, 'accA'); await nativeSwitch(acc, A); await acc.goto(origin + '/profile', { waitUntil: 'networkidle2' }); await wait(acc, () => document.body.innerText.includes('Synthetic invoice A'), [], 'profile'); assert.ok(await acc.evaluate(() => document.body.innerText.includes('経理担当')), 'invite-ui:profile-role-label'); await closeContext(acc)
      assert.deepEqual(pageErrors, [], 'invite-ui:page-errors')
      await owner.close()
      pass('Chrome 390px: role badges/select/help/profile show 経理担当; the settings invite makes an Invite row and shows its link on the page origin with a copy button and a link-created text (never "sent"); a new person registers from it and joins as 経理担当; an existing account logs in and joins as 閲覧のみ; a lost link is cancelled from 保留中の招待, shows cancelled, and a new invite works; no [Email] log line')
    } else if (has('L7')) console.log('Browser leg L7 not requested (OMF_INVOICE_BROWSER unset)')

    // ---- M1 on the app without Gmail settings.
    if (has('L5')) {
      const s = await ok('/api/company-mail/gmail', T.ownerA, 'GET', undefined, 'gmail-status')
      assert.equal(s.configured, false, 'gmail:not-configured'); assert.equal(s.canSend, true); const r = await api('/api/company-mail/gmail', T.accA, 'POST', { action: 'start' }); assert.ok(r.status >= 400 && r.status < 500, 'gmail:not-configured-start ' + r.status)
      assert.equal(fake.calls.length, 0, 'gmail:not-configured-no-google-call')
      pass('M1: without the Gmail settings the status says configured:false and start is refused; no Google call')
    }

    // ---- Boot 2: the Gmail settings present.
    const needGmail = has('L5') || has('L4') || has('M21')
    if (needGmail) { await stop(); await boot('gmail', true) }
    const status = token => ok('/api/company-mail/gmail', token, 'GET', undefined, 'gmail-status')
    const connect = async (token, address, { scopes = ['openid', 'email', SEND_SCOPE, LABELS_SCOPE], emailVerified = true, refresh = true, expect = 200 } = {}) => {
      const start = await ok('/api/company-mail/gmail', token, 'POST', { action: 'start' }, 'gmail-start'), url = new URL(start.url)
      const code = fake.issueCode({ challenge: url.searchParams.get('code_challenge'), scopes, email: address, emailVerified, refresh })
      const r = await api('/api/company-mail/gmail', token, 'POST', { action: 'finish', code, state: url.searchParams.get('state') })
      assert.equal(r.status, expect, 'gmail:finish ' + address + ' ' + r.raw.slice(0, 300)); return { r, url }
    }
    const SA = 'sender-a@example.invalid', SB = 'sender-b@example.invalid'
    const sendFor = (token, invoiceId, body = {}, timeout = 300000) => api('/api/invoices/' + invoiceId + '/send', token, 'POST', { to: 'client@example.invalid', subject: '請求書 テスト', message: 'Synthetic message', ...body }, timeout)
    const deliveryOf = async id => { const row = await invoices.findOne({ _id: new ObjectId(String(id)) }); return { row, list: row.deliveries || [], last: (row.deliveries || []).at(-1) } }
    const freshInvoice = async (company, o) => { const doc = invoiceDoc(company, o); await invoices.insertOne(doc); return doc }
    const mailsFor = (address, doc) => fake.mailbox(address).mails.filter(x => x.filename === 'invoice_' + doc.invoiceNumber + '.pdf')
    const postsFor = (address, doc) => fake.mailbox(address).posts.filter(x => x.filename === 'invoice_' + doc.invoiceNumber + '.pdf')
    if (has('L5')) {
      // M2/M3: start carries both scopes, offline access, consent and PKCE; finish seals the refresh token; labels granted or not.
      const start = await ok('/api/company-mail/gmail', T.accA, 'POST', { action: 'start' }, 'gmail-start'), url = new URL(start.url)
      assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth', 'gmail:start-url')
      const scope = (url.searchParams.get('scope') || '').split(' ')
      for (const s of ['openid', 'email', SEND_SCOPE, LABELS_SCOPE]) assert.ok(scope.includes(s), 'gmail:start-scope ' + s)
      assert.deepEqual([url.searchParams.get('client_id'), url.searchParams.get('redirect_uri'), url.searchParams.get('response_type'), url.searchParams.get('access_type'), url.searchParams.get('prompt'), url.searchParams.get('code_challenge_method')], [CLIENT_ID, REDIRECT_URI, 'code', 'offline', 'consent', 'S256'], 'gmail:start-params')
      assert.ok(url.searchParams.get('state')?.length >= 32 && url.searchParams.get('code_challenge')?.length >= 43, 'gmail:start-state-pkce')
      // M4: the state belongs to this user and company, is single-use and expires.
      const codeFor = (u, address = SA) => fake.issueCode({ challenge: u.searchParams.get('code_challenge'), scopes: ['openid', 'email', SEND_SCOPE, LABELS_SCOPE], email: address })
      if (wantM('M4')) {
        let r = await api('/api/company-mail/gmail', T.adminA, 'POST', { action: 'finish', code: codeFor(url), state: url.searchParams.get('state') }); assert.equal(r.status, 400, 'gmail:state-other-user ' + r.status)
        r = await api('/api/company-mail/gmail', T.accB, 'POST', { action: 'finish', code: codeFor(url), state: url.searchParams.get('state') }); assert.equal(r.status, 400, 'gmail:state-other-company')
        r = await api('/api/company-mail/gmail', T.accA, 'POST', { action: 'finish', code: codeFor(url), state: crypto.randomBytes(32).toString('base64url') }); assert.equal(r.status, 400, 'gmail:state-unknown')
        const expiring = new URL((await ok('/api/company-mail/gmail', T.accA, 'POST', { action: 'start' }, 'gmail-start')).url)
        await db.collection('gmailconnectrequests').updateMany({ usedAt: null }, { $set: { expiresAt: new Date(Date.now() - 1000) } })
        r = await api('/api/company-mail/gmail', T.accA, 'POST', { action: 'finish', code: codeFor(expiring), state: expiring.searchParams.get('state') }); assert.equal(r.status, 400, 'gmail:state-expired')
        assert.equal(await db.collection('companymailconnections').countDocuments(), 0, 'gmail:state-refusals-store-nothing')
      }
      // M5: a consent without gmail.send, an unverified address or no refresh token never connects.
      if (wantM('M5')) {
        await connect(T.accA, SA, { scopes: ['openid', 'email', LABELS_SCOPE], expect: 400 }); await connect(T.accA, SA, { emailVerified: false, expect: 400 }); await connect(T.accA, SA, { refresh: false, expect: 400 })
        assert.equal(await db.collection('companymailconnections').countDocuments(), 0, 'gmail:missing-grant-stores-nothing')
      }
      const first = await connect(T.accA, SA)
      let st = await status(T.accA); assert.deepEqual([st.configured, st.connected, st.address, st.labelsGranted, st.state, st.canSend], [true, true, SA, true, 'ok', true], 'gmail:connected ' + JSON.stringify(st))
      const conn = await db.collection('companymailconnections').findOne({ organizationId: A }); assert.ok(conn.sealedRefreshToken?.iv && conn.sealedRefreshToken?.tag && conn.sealedRefreshToken?.data, 'gmail:sealed'); assert.ok(!JSON.stringify(conn).includes(fake.refreshTokenOf(SA)), 'gmail:sealed-not-plain')
      await connect(T.ownerB, SB, { scopes: ['openid', 'email', SEND_SCOPE] }); st = await status(T.memberB); assert.deepEqual([st.connected, st.labelsGranted], [true, false], 'gmail:labels-not-granted ' + JSON.stringify(st)); assert.equal(st.canSend, false, 'gmail:role-send-refused member status canSend')
      assert.equal(first.url.searchParams.get('state') !== url.searchParams.get('state'), true)
      { const reused = await api('/api/company-mail/gmail', T.accA, 'POST', { action: 'finish', code: codeFor(first.url), state: first.url.searchParams.get('state') }); assert.equal(reused.status, 400, 'gmail:state-reused') }
      pass('M2-M5: start asks openid/email/gmail.send/gmail.labels, offline, consent, PKCE S256; finish refuses another user, another company, an unknown, expired or reused state and a consent without send, a verified address or a refresh token; a connection seals the refresh token (no plain copy) and records labelsGranted true or false')

      // M19 runs on company B in parallel (its own queue): an answer after 90 s is still Gmail's answer.
      let m19 = null
      if (wantM('M19')) { const doc = await freshInvoice(B); fake.send(SB, { status: 200, delayMs: 90000 }); const t0 = Date.now(); m19 = sendFor(T.ownerB, doc._id).then(r => ({ r, doc, ms: Date.now() - t0 })) }

      if (wantM('M6')) {
        const doc = await freshInvoice(A, { to: { name: 'Client M6', email: 'm6@example.invalid' } })
        const r = await sendFor(T.accA, doc._id, { to: 'm6@example.invalid', subject: '請求書 ' + doc.invoiceNumber + '（Synthetic invoice A）', message: 'Client M6 様\n\n請求書をお送りします。' })
        assert.equal(r.status, 200, 'gmail:sent ' + r.raw.slice(0, 300)); const { row, last } = await deliveryOf(doc._id)
        assert.deepEqual([last.state, last.confirmedBy, !!last.gmailMessageId, last.attempts, last.to, last.from], ['sent', 'gmail_id', true, 1, 'm6@example.invalid', SA], 'gmail:sent ' + JSON.stringify(last)); assert.equal(row.status, 'sent', 'gmail:draft-to-sent')
        const [mail] = mailsFor(SA, doc); assert.ok(mail, 'gmail:sent-mail'); assert.equal(mail.to, 'm6@example.invalid'); assert.equal(mail.subject, '請求書 ' + doc.invoiceNumber + '（Synthetic invoice A）'); assert.ok(mail.pdfOk, 'gmail:sent-pdf'); assert.ok(mail.text.includes('請求書をお送りします。'), 'gmail:sent-text'); assert.ok(mail.from.includes(SA), 'gmail:sent-from')
        assert.equal(await db.collection('invoicemailoutbox').countDocuments({ _id: last.sendId }), 0, 'gmail:outbox-cleared')
      }
      if (wantM('M7')) { const doc = await freshInvoice(A, { status: 'paid', paidDate: new Date() }); assert.equal((await sendFor(T.accA, doc._id)).status, 200); const { row, last } = await deliveryOf(doc._id); assert.equal(last.state, 'sent'); assert.equal(row.status, 'paid', 'gmail:paid-stays') }
      if (wantM('M8')) {
        const doc = await freshInvoice(A); fake.send(SA, { status: 200, delayMs: 1500 })
        const both = await Promise.all([sendFor(T.accA, doc._id), pause(200).then(() => sendFor(T.ownerA, doc._id))])
        assert.deepEqual(both.map(r => r.status).sort(), [200, 409], 'gmail:send-once ' + both.map(r => r.status + ' ' + r.raw.slice(0, 120)).join(' | '))
        assert.ok(said(both.find(r => r.status === 409)).includes('この請求書は送信中です'), 'gmail:send-once-message'); assert.equal(mailsFor(SA, doc).length, 1, 'gmail:send-once one mail'); assert.equal(postsFor(SA, doc).length, 1, 'gmail:send-once one call')
        assert.equal((await deliveryOf(doc._id)).list.length, 1, 'gmail:send-once one delivery')
      }
      if (wantM('M8b')) {
        const x = await freshInvoice(A), y = await freshInvoice(A); fake.send(SA, { status: 200, delayMs: 1500 }, { status: 200, delayMs: 1500 })
        const both = await Promise.all([sendFor(T.accA, x._id), sendFor(T.ownerA, y._id)]); assert.deepEqual(both.map(r => r.status), [200, 200], 'gmail:company-queue both sent')
        const [px] = postsFor(SA, x), [py] = postsFor(SA, y); assert.ok(px && py, 'gmail:company-queue posts'); assert.ok(px.endedAt <= py.at || py.endedAt <= px.at, 'gmail:company-queue no overlap ' + JSON.stringify([px.at, px.endedAt, py.at, py.endedAt]))
        assert.deepEqual([(await deliveryOf(x._id)).last.state, (await deliveryOf(y._id)).last.state], ['sent', 'sent'])
      }
      if (wantM('M9')) { const doc = await freshInvoice(A); fake.send(SA, { status: 400, reason: 'invalidArgument', message: 'Invalid To header' }); assert.equal((await sendFor(T.accA, doc._id)).status, 200); const { last, row } = await deliveryOf(doc._id); assert.equal(last.state, 'failed', 'gmail:400-failed'); assert.ok(last.error.includes('Invalid To header'), 'gmail:400-reason ' + last.error); assert.equal(postsFor(SA, doc).length, 1, 'gmail:400-no-resend'); assert.equal(row.status, 'draft') }
      if (wantM('M10')) { const doc = await freshInvoice(A), refreshes = fake.mailbox(SA).refreshes; fake.send(SA, { status: 401, reason: 'authError', message: 'Invalid Credentials' }, { status: 200 }); assert.equal((await sendFor(T.accA, doc._id)).status, 200); const { last } = await deliveryOf(doc._id); assert.deepEqual([last.state, last.attempts], ['sent', 2], 'gmail:401-refresh-resend ' + JSON.stringify(last)); assert.equal(fake.mailbox(SA).refreshes - refreshes, 2, 'gmail:401-refreshed'); assert.equal(mailsFor(SA, doc).length, 1) }
      if (wantM('M11')) {
        let doc = await freshInvoice(A); fake.send(SA, { status: 403, reason: 'rateLimitExceeded', message: 'Rate Limit Exceeded' }, { status: 429, reason: 'rateLimitExceeded', message: 'Too many concurrent requests for user' }, { status: 200 })
        assert.equal((await sendFor(T.accA, doc._id)).status, 200); let { last } = await deliveryOf(doc._id); assert.deepEqual([last.state, last.attempts], ['sent', 3], 'gmail:rate-limit-backoff ' + JSON.stringify(last))
        const p = postsFor(SA, doc); assert.ok(p[1].at - p[0].endedAt >= 950 && p[2].at - p[1].endedAt >= 1950, 'gmail:rate-limit-waits ' + JSON.stringify(p.map(x => [x.at, x.endedAt])))
        doc = await freshInvoice(A); fake.send(SA, ...Array.from({ length: 4 }, () => ({ status: 403, reason: 'userRateLimitExceeded', message: 'User Rate Limit Exceeded' })))
        assert.equal((await sendFor(T.accA, doc._id)).status, 200); ({ last } = await deliveryOf(doc._id)); assert.deepEqual([last.state, last.attempts], ['failed', 4], 'gmail:rate-limit-budget ' + JSON.stringify(last)); assert.ok(last.error.includes('Gmail が混み合っています'), 'gmail:rate-limit-message'); assert.equal(mailsFor(SA, doc).length, 0)
      }
      if (wantM('M12')) {
        let doc = await freshInvoice(A); fake.send(SA, { status: 429, reason: 'rateLimitExceeded', message: 'User-rate limit exceeded (Mail sending)', headers: { 'Retry-After': '3600' } }); const t0 = Date.now()
        assert.equal((await sendFor(T.accA, doc._id)).status, 200); let { last } = await deliveryOf(doc._id); assert.equal(last.state, 'failed', 'gmail:daily-limit'); assert.ok(Math.abs(new Date(last.retryAfter).getTime() - (t0 + 3600000)) < 120000, 'gmail:daily-limit-header-time ' + last.retryAfter); assert.ok(last.error.includes('以降に送れます'), 'gmail:daily-limit-text ' + last.error); assert.equal(postsFor(SA, doc).length, 1, 'gmail:daily-limit-no-resend')
        doc = await freshInvoice(A); fake.send(SA, { status: 429, reason: 'rateLimitExceeded', message: 'User-rate limit exceeded.  Retry after 2026-11-01T03:04:05.000Z (Mail sending)' })
        assert.equal((await sendFor(T.accA, doc._id)).status, 200); ({ last } = await deliveryOf(doc._id)); assert.equal(last.state, 'failed'); assert.equal(new Date(last.retryAfter).toISOString(), '2026-11-01T03:04:05.000Z', 'gmail:daily-limit-message-time'); assert.ok(last.error.includes('以降に送れます'))
      }
      if (wantM('M13')) {
        for (const refusal of ['invalid_grant', 'admin_policy_enforced']) {
          const doc = await freshInvoice(A); fake.refreshRefusal(SA, refusal)
          assert.equal((await sendFor(T.accA, doc._id)).status, 200); const { last } = await deliveryOf(doc._id); assert.equal(last.state, 'failed', 'gmail:reconnect ' + refusal); assert.ok(last.error.includes('Gmail と再接続してください'), 'gmail:reconnect-text'); assert.equal(postsFor(SA, doc).length, 0)
          assert.equal((await status(T.accA)).state, 'reconnect_required', 'gmail:reconnect-state'); const refused = await sendFor(T.accA, (await freshInvoice(A))._id); assert.ok(refused.status === 409 && said(refused).includes('再接続'), 'gmail:reconnect-refuses ' + refused.status)
          await connect(T.accA, SA); assert.equal((await status(T.accA)).state, 'ok')
        }
        const doc = await freshInvoice(A); fake.send(SA, { status: 401, reason: 'authError', message: 'Invalid Credentials' }, { status: 401, reason: 'authError', message: 'Invalid Credentials' })
        assert.equal((await sendFor(T.accA, doc._id)).status, 200); const { last } = await deliveryOf(doc._id); assert.deepEqual([last.state, last.attempts], ['failed', 2], 'gmail:401-after-fresh-token'); assert.equal((await status(T.accA)).state, 'reconnect_required'); await connect(T.accA, SA)
      }
      if (wantM('M14')) { const doc = await freshInvoice(A); fake.send(SA, { status: 403, reason: 'domainPolicy', message: 'The domain administrators have disabled Gmail apps.' }); assert.equal((await sendFor(T.accA, doc._id)).status, 200); const { last } = await deliveryOf(doc._id); assert.equal(last.state, 'failed'); assert.ok(last.error.includes('会社の Google 管理者に OMF の Gmail 利用を許可してもらってください'), 'gmail:domain-policy ' + last.error) }
      if (wantM('M15')) { const doc = await freshInvoice(A); fake.send(SA, { status: 503, accept: false }, { status: 200 }); const t0 = Date.now(); assert.equal((await sendFor(T.accA, doc._id)).status, 200); const { last } = await deliveryOf(doc._id); assert.deepEqual([last.state, last.confirmedBy, last.attempts], ['sent', 'gmail_id', 2], 'gmail:5xx-not-accepted-resent ' + JSON.stringify(last)); assert.equal(mailsFor(SA, doc).length, 1, 'gmail:5xx-not-accepted exactly one mail'); assert.ok(Date.now() - t0 >= 29000, 'gmail:5xx-not-accepted waited for the second count') }
      if (wantM('M16')) { const doc = await freshInvoice(A); fake.send(SA, { status: 500, accept: true }); assert.equal((await sendFor(T.accA, doc._id)).status, 200); const { last, row } = await deliveryOf(doc._id); assert.deepEqual([last.state, last.confirmedBy, last.attempts, last.sentCountAfter - last.sentCountBefore], ['sent', 'sent_count', 1, 1], 'gmail:5xx-accepted ' + JSON.stringify(last)); assert.equal(mailsFor(SA, doc).length, 1, 'gmail:5xx-accepted one mail'); assert.equal(postsFor(SA, doc).length, 1, 'gmail:5xx-accepted no resend'); assert.equal(row.status, 'sent') }
      if (wantM('M17')) {
        let doc = await freshInvoice(A); fake.send(SA, { reset: 'after' }); assert.equal((await sendFor(T.accA, doc._id)).status, 200); let { last } = await deliveryOf(doc._id); assert.deepEqual([last.state, last.confirmedBy], ['sent', 'sent_count'], 'gmail:reset-after-accept ' + JSON.stringify(last)); assert.equal(mailsFor(SA, doc).length, 1)
        doc = await freshInvoice(A); fake.send(SA, { reset: 'before' }, { status: 200 }); assert.equal((await sendFor(T.accA, doc._id)).status, 200); ({ last } = await deliveryOf(doc._id)); assert.deepEqual([last.state, last.confirmedBy, last.attempts], ['sent', 'gmail_id', 2], 'gmail:reset-before-accept ' + JSON.stringify(last)); assert.equal(mailsFor(SA, doc).length, 1, 'gmail:reset-before-accept one mail')
      }
      if (wantM('M18')) {
        let doc = await freshInvoice(A); fake.send(SA, { status: 502, accept: true, extra: 1 }); assert.equal((await sendFor(T.accA, doc._id)).status, 200); let { last } = await deliveryOf(doc._id); assert.equal(last.state, 'unknown', 'gmail:count-plus-two ' + JSON.stringify(last)); assert.equal(postsFor(SA, doc).length, 1)
        doc = await freshInvoice(A); fake.send(SA, { status: 504, accept: false }); fake.labels(SA, {}, { fail: true }); assert.equal((await sendFor(T.accA, doc._id)).status, 200); ({ last } = await deliveryOf(doc._id)); assert.equal(last.state, 'unknown', 'gmail:count-read-failed ' + JSON.stringify(last)); assert.equal(postsFor(SA, doc).length, 1)
      }
      if (wantM('M20')) { const doc = await freshInvoice(A); fake.send(SA, { refuse: true }); assert.equal((await sendFor(T.accA, doc._id)).status, 200); const { last } = await deliveryOf(doc._id); assert.equal(last.state, 'failed', 'gmail:connection-refused ' + JSON.stringify(last)); assert.ok(last.error.includes('ECONNREFUSED'), 'gmail:connection-refused-reason ' + last.error); assert.equal(mailsFor(SA, doc).length, 0) }
      if (wantM('M22')) {
        const doc = await freshInvoice(A)
        for (const to of ['a@x.example,b@y.example', 'not-an-address', 'a@x.example\r\nBcc: c@z.example', 'a@x.example; b@y.example', '']) { const r = await sendFor(T.accA, doc._id, { to }); assert.equal(r.status, 400, 'gmail:bad-to ' + JSON.stringify(to) + ' ' + r.status) }
        assert.equal((await sendFor(T.accA, doc._id, { subject: '請求書\r\nBcc: c@z.example' })).status, 400, 'gmail:crlf-subject'); assert.equal((await deliveryOf(doc._id)).list.length, 0, 'gmail:bad-input-no-delivery')
      }
      if (wantM('M23')) { const doc = await freshInvoice(B); const r = await sendFor(T.accA, doc._id); assert.equal(r.status, 404, 'gmail:other-company ' + r.status); assert.equal((await deliveryOf(doc._id)).list.length, 0) }
      if (wantM('Q5')) {
        for (const u of ['ownerA', 'adminA', 'accA']) { assert.equal((await api('/api/company-mail/gmail', T[u], 'POST', { action: 'start' })).status, 200, 'gmail:role-start ' + u); const doc = await freshInvoice(A); const r = await sendFor(T[u], doc._id); assert.equal(r.status, 200, 'gmail:role-send ' + u); assert.equal((await deliveryOf(doc._id)).last.state, 'sent'); assert.equal((await status(T[u])).canSend, true) }
        for (const u of ['memberA', 'viewerA']) {
          // A 閲覧のみ member meets the viewerReadOnly middleware first (plan omf-role-writes-20261101 C2): same 403, the viewer message; a 一般 member keeps the sender message.
          const doc = await freshInvoice(A); const r = await sendFor(T[u], doc._id); assert.equal(r.status, 403, 'gmail:role-send-refused ' + u + ' answered ' + r.status); assert.ok(said(r).includes(u === 'viewerA' ? '閲覧のみのメンバーは変更できません' : '請求書の送信は経理担当以上のメンバーだけができます'), 'gmail:role-message ' + u + ' ' + said(r).slice(0, 200))
          for (const body of [{ action: 'start' }, { action: 'finish', code: 'x', state: 'y' }]) assert.equal((await api('/api/company-mail/gmail', T[u], 'POST', body)).status, 403, 'gmail:role-connect-refused ' + u)
          assert.equal((await api('/api/company-mail/gmail', T[u], 'DELETE')).status, 403, 'gmail:role-disconnect-refused ' + u); assert.equal((await status(T[u])).canSend, false); assert.equal((await deliveryOf(doc._id)).list.length, 0)
        }
      }
      if (wantM('Q6')) {
        await orgs.updateOne({ _id: A, 'members.userId': users.accA.id }, { $set: { 'members.$.role': 'member' } })
        let doc = await freshInvoice(A); assert.equal((await sendFor(T.accA, doc._id)).status, 403, 'gmail:demoted-refused'); assert.equal((await status(T.accA)).canSend, false, 'gmail:demoted-status')
        await orgs.updateOne({ _id: A }, { $pull: { members: { userId: users.accA.id } } }); assert.equal((await sendFor(T.accA, doc._id)).status, 403, 'gmail:removed-refused')
        await orgs.updateOne({ _id: A }, { $push: { members: m('accA', 'accountant') } }); assert.equal((await sendFor(T.accA, doc._id)).status, 200, 'gmail:restored')
      }
      if (m19) { const { r, doc, ms } = await m19; assert.equal(r.status, 200, 'gmail:slow-answer ' + r.raw.slice(0, 200)); const { last } = await deliveryOf(doc._id); assert.deepEqual([last.state, last.confirmedBy, last.attempts], ['sent', 'gmail_id', 1], 'gmail:slow-answer ' + JSON.stringify(last)); assert.ok(ms >= 89000, 'gmail:slow-answer waited ' + ms); assert.equal(mailsFor(SB, doc).length, 1, 'gmail:slow-answer one mail') }
      if (wantM('M18')) { const doc = await freshInvoice(B); fake.send(SB, { status: 503, accept: true }); const t0 = Date.now(); assert.equal((await sendFor(T.ownerB, doc._id)).status, 200); const { last } = await deliveryOf(doc._id); assert.equal(last.state, 'unknown', 'gmail:no-labels-unknown ' + JSON.stringify(last)); assert.ok(Date.now() - t0 < 20000, 'gmail:no-labels-no-count-wait'); assert.equal(postsFor(SB, doc).length, 1) }
      if (wantM('M24')) {
        const refresh = fake.refreshTokenOf(SB); const r = await api('/api/company-mail/gmail', T.ownerB, 'DELETE'); assert.equal(r.status, 200, 'gmail:disconnect ' + r.raw.slice(0, 200)); assert.ok(fake.revoked.includes(refresh), 'gmail:disconnect-revoked')
        assert.equal(await db.collection('companymailconnections').countDocuments({ organizationId: B }), 0, 'gmail:disconnect-deleted'); const st2 = await status(T.ownerB); assert.equal(st2.connected, false)
        const doc = await freshInvoice(B); const refused = await sendFor(T.ownerB, doc._id); assert.ok(refused.status >= 400 && refused.status < 500, 'gmail:disconnected-send-refused ' + refused.status); assert.equal((await deliveryOf(doc._id)).list.length, 0)
      }
      assert.equal(await invoices.countDocuments({ 'deliveries.state': 'sending' }), 0, 'gmail:no-delivery-left-sending'); assert.equal(await db.collection('invoicemailoutbox').countDocuments(), 0, 'gmail:outbox-empty')
      pass('M6-M24: sent with Gmail id and draft→sent (paid stays); one send per invoice (409, one call) and one Gmail send at a time per company; 400 failed without resend; 401 refresh and one resend; rate limits wait 1, 2 s then sent, budget spent failed; daily limit failed with the retry time (header and message forms); invalid_grant/admin_policy_enforced/401 after a fresh token → 再接続が必要; domainPolicy text; 5xx not accepted → count unchanged twice → resent, exactly one mail; 5xx accepted and reset after accept → sent by the count; reset before accept → resent once; +2, failed read, no labels permission → unknown; a 90 s answer is sent; ECONNREFUSED failed; bad To/CRLF and another company refused; owner/admin/accountant send, member/viewer 403, demoted/removed 403; disconnect revokes and deletes')
    }

    // ---- L4. Installed Chrome 390px on the Gmail-configured app: the invoice screen (S1-S7), row lines and send dialog, Gmail card.
    if (has('L4') && BROWSER) {
      await orgs.updateOne({ _id: A, 'members.userId': users.accA.id }, { $set: { 'members.$.role': 'accountant' } })
      await ok('/api/customers', T.ownerA, 'POST', { name: 'Synthetic customer K', email: 'k@example.invalid', address: { postalCode: '150-0001', state: 'Tokyo', city: 'Shibuya', line1: '2-2 Synthetic' } }, 'customer')
      if (!(await status(T.accA)).connected) await connect(T.accA, SA)
      // Rows whose last delivery failed, is unknown, or was confirmed by the count (newest, so on the first page).
      const seeded = {}
      for (const [k, d] of Object.entries({ failed: { state: 'failed', error: 'Gmail が混み合っています。少し待ってから送ってください' }, limited: { state: 'failed', error: '2026/11/01 12:04以降に送れます', retryAfter: new Date('2026-11-01T03:04:05Z') }, unknown: { state: 'unknown', error: 'Gmail が 503 を返し、送信済みフォルダの件数を確認できませんでした' }, counted: { state: 'sent', confirmedBy: 'sent_count' } })) {
        seeded[k] = await freshInvoice(A, { status: d.state === 'sent' ? 'sent' : 'draft', deliveries: [{ sendId: crypto.randomUUID(), bootId: 'seed', from: SA, to: 'seed@example.invalid', subject: 'Seed', attempts: 1, startedAt: new Date(), finishedAt: new Date(), ...d }] })
      }
      const owner = await newPage(true); await login(owner, 'ownerA'); await nativeSwitch(owner, A)
      await owner.goto(origin + '/invoices', { waitUntil: 'networkidle2' }); await wait(owner, () => document.querySelectorAll('tbody tr').length > 0, [], 'invoice-list')
      const rowText = (page, number) => page.evaluate(n => [...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes(n))?.querySelector('[data-invoice-delivery]')?.textContent || null, number)
      assert.ok((await rowText(owner, seeded.failed.invoiceNumber)).includes('Gmail が混み合っています'), 'invoice-ui:row-failed'); assert.ok((await rowText(owner, seeded.limited.invoiceNumber)).includes('以降に送れます'), 'invoice-ui:row-limited')
      const unknownLine = await rowText(owner, seeded.unknown.invoiceNumber); assert.ok(unknownLine.includes('送信できたか確認できません') && unknownLine.includes('送信済みフォルダを確認'), 'invoice-ui:row-unknown ' + unknownLine)
      assert.ok((await rowText(owner, seeded.counted.invoiceNumber)).includes('送信済み（送信済みフォルダで確認）'), 'invoice-ui:row-counted')
      assert.equal(await owner.evaluate(n => [...document.querySelectorAll('tbody tr')].filter(tr => tr.textContent.includes(n[0]) || tr.textContent.includes(n[1])).map(tr => !!tr.querySelector('[data-invoice-resend]')).join(','), [seeded.failed.invoiceNumber, seeded.unknown.invoiceNumber]), 'true,true', 'invoice-ui:resend-buttons')
      assert.equal(await owner.evaluate(() => getComputedStyle(document.querySelector('tbody tr [data-invoice-print]').parentElement).opacity), '1', 'invoice-ui:row-actions-visible-on-touch')
      // S1, S6, S3, S5, S4: the new invoice screen.
      assert.ok(await clickText(owner, 'button', '新規請求書'), 'invoice-ui:new'); await wait(owner, () => !!document.querySelector('[data-invoice-form]'), [], 'invoice-form')
      await wait(owner, () => document.querySelector('#invoice-from-name')?.value === 'Synthetic invoice A', [], 'S1 issuer filled')
      const issuer = await owner.evaluate(() => ({ email: document.querySelector('#invoice-from-email').value, phone: document.querySelector('#invoice-from-phone').value, address: document.querySelector('#invoice-from-address').value, registration: document.querySelector('[data-invoice-registration]')?.textContent.trim(), missing: !!document.querySelector('[data-invoice-registration-missing]'), width: document.querySelector('[data-invoice-panel]').getBoundingClientRect().width, steps: [...document.querySelectorAll('[data-invoice-step]')].map(s => s.getAttribute('data-invoice-step')) }))
      assert.deepEqual([issuer.email, issuer.phone, issuer.registration, issuer.missing], [companyA.email, companyA.phone, VALID, false], 'invoice-ui:S1 ' + JSON.stringify(issuer)); assert.ok(issuer.address.includes('Chiyoda'), 'invoice-ui:S1 address'); assert.ok(issuer.width >= 380, 'invoice-ui:full-screen ' + issuer.width); assert.deepEqual(issuer.steps, ['issuer', 'client', 'items', 'review'], 'invoice-ui:steps')
      const disabled = () => owner.$eval('[data-invoice-save]', b => b.disabled)
      assert.equal(await disabled(), true, 'invoice-ui:S6 save disabled empty')
      await wait(owner, () => [...document.querySelectorAll('#invoice-customer option')].some(o => o.textContent.includes('Synthetic customer K')), [], 'S3 customers')
      await owner.evaluate(() => { const s = document.querySelector('#invoice-customer'); s.value = [...s.options].find(o => o.textContent.includes('Synthetic customer K')).value; s.dispatchEvent(new Event('change', { bubbles: true })) })
      await wait(owner, () => document.querySelector('#invoice-to-name').value === 'Synthetic customer K', [], 'S3 customer picked')
      const client = await owner.evaluate(() => ({ email: document.querySelector('#invoice-to-email').value, address: document.querySelector('#invoice-to-address').value })); assert.equal(client.email, 'k@example.invalid', 'invoice-ui:S3'); assert.ok(client.address.includes('Shibuya'), 'invoice-ui:S3 address')
      assert.equal(await disabled(), true, 'invoice-ui:S6 save disabled without a described line')
      await setValue(owner, '[data-invoice-item] [data-item-description]', 'UI work'); await setValue(owner, '[data-invoice-item] [data-item-quantity]', '3'); await setValue(owner, '[data-invoice-item] [data-item-unit-price]', '1234')
      assert.equal(await disabled(), false, 'invoice-ui:S6 save enabled')
      assert.deepEqual(await owner.$eval('#invoice-tax-rate', s => [...s.options].map(o => o.value)), ['10', '8', '0'], 'invoice-ui:S5 rates')
      await setValue(owner, '#invoice-tax-rate', '8'); await wait(owner, () => document.querySelector('[data-invoice-tax-label]').textContent.includes('※軽減'), [], 'S5 reduced label')
      const shown = await owner.evaluate(() => ({ sub: document.querySelector('[data-invoice-subtotal]').textContent, tax: document.querySelector('[data-invoice-tax]').textContent, total: document.querySelector('[data-invoice-total]').textContent, label: document.querySelector('[data-invoice-tax-label]').textContent }))
      assert.deepEqual([digits(shown.sub), digits(shown.tax), digits(shown.total)], ['3702', '296', '3998'], 'invoice-ui:S4 shown ' + JSON.stringify(shown)); assert.ok(shown.label.includes('8%'), 'invoice-ui:S5 label rate')
      const countBefore = await invoices.countDocuments({ organizationId: A })
      await owner.evaluate(() => document.querySelector('[data-invoice-save]').click()); await wait(owner, () => !document.querySelector('[data-invoice-form]'), [], 'saved-closed')
      for (let i = 0; i < 50 && await invoices.countDocuments({ organizationId: A }) === countBefore; i++) await pause(100)
      const saved = await invoices.find({ organizationId: A }).sort({ createdAt: -1 }).limit(1).next()
      assert.deepEqual([saved.subtotal, saved.taxAmount, saved.total, saved.taxRate, saved.from.taxId, saved.to.name, saved.from.name], [3702, 296, 3998, 8, VALID, 'Synthetic customer K', 'Synthetic invoice A'], 'invoice-ui:S4 stored equals shown')
      // C6: the send dialog from the row, 送信中… until the delivery ends, then the row line.
      await wait(owner, n => [...document.querySelectorAll('tbody tr')].some(tr => tr.textContent.includes(n)), [saved.invoiceNumber], 'saved-row')
      fake.send(SA, { status: 200, delayMs: 2500 })
      await owner.evaluate(n => [...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes(n)).querySelector('[data-invoice-send]').click(), saved.invoiceNumber)
      await wait(owner, () => !!document.querySelector('[data-invoice-send-dialog]'), [], 'send-dialog')
      const dialog = await owner.evaluate(() => ({ to: document.querySelector('#invoice-send-to').value, subject: document.querySelector('#invoice-send-subject').value, from: document.querySelector('[data-invoice-send-from]').textContent }))
      assert.deepEqual([dialog.to, dialog.subject], ['k@example.invalid', '請求書 ' + saved.invoiceNumber + '（Synthetic invoice A）'], 'invoice-ui:send-dialog ' + JSON.stringify(dialog)); assert.ok(dialog.from.includes(SA), 'invoice-ui:send-from')
      await owner.evaluate(() => document.querySelector('[data-invoice-send-submit]').click())
      await wait(owner, () => document.querySelector('[data-invoice-send-state]')?.textContent.includes('送信中…'), [], 'sending-state', 25)
      await wait(owner, () => !document.querySelector('[data-invoice-send-dialog]'), [], 'send-ended')
      await wait(owner, n => ([...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes(n))?.querySelector('[data-invoice-delivery]')?.textContent || '').includes('送信済み（Gmail が受け付けました'), [saved.invoiceNumber], 'row-sent')
      assert.equal(mailsFor(SA, saved).length, 1, 'invoice-ui:sent-once'); assert.equal((await invoices.findOne({ _id: saved._id })).status, 'sent')
      // S7: a refused save shows the server's message and keeps the screen.
      assert.ok(await clickText(owner, 'button', '新規請求書')); await wait(owner, () => document.querySelector('#invoice-from-name')?.value === 'Synthetic invoice A', [], 'S7 form')
      await setValue(owner, '#invoice-to-name', 'S7 client'); await setValue(owner, '[data-invoice-item] [data-item-description]', 'S7 work'); await setValue(owner, '[data-invoice-item] [data-item-unit-price]', '100')
      await orgs.updateOne({ _id: A }, { $pull: { members: { userId: users.ownerA.id } } })
      await owner.evaluate(() => document.querySelector('[data-invoice-save]').click()); await wait(owner, () => !!document.querySelector('[data-invoice-save-error]')?.textContent.trim(), [], 'S7 error')
      assert.ok((await owner.$eval('[data-invoice-save-error]', e => e.textContent)).includes('Access denied'), 'invoice-ui:S7 server message'); assert.ok(await owner.$('[data-invoice-form]'), 'invoice-ui:S7 form kept')
      await orgs.updateOne({ _id: A }, { $push: { members: m('ownerA', 'owner') } })
      // The Gmail card: connected for A.
      await owner.goto(origin + '/settings/organization', { waitUntil: 'networkidle2' }); await wait(owner, () => !!document.querySelector('[data-gmail-state]')?.textContent.trim(), [], 'gmail-card')
      const card = await owner.evaluate(() => ({ state: document.querySelector('[data-gmail-state]').textContent, address: document.querySelector('[data-gmail-address]')?.textContent || '', disconnect: !!document.querySelector('[data-gmail-disconnect]') }))
      assert.ok(card.state.includes('接続済み') && card.address.includes(SA) && card.disconnect, 'invoice-ui:gmail-card-connected ' + JSON.stringify(card))
      await closeContext(owner)
      // S2 and the consent round trip on company B (disconnected in M24): no 登録番号 note; connect without the labels permission.
      const ownerB = await newPage(true); await login(ownerB, 'ownerB'); await nativeSwitch(ownerB, B)
      await ownerB.goto(origin + '/invoices', { waitUntil: 'networkidle2' }); assert.ok(await clickText(ownerB, 'button', '新規請求書')); await wait(ownerB, () => !!document.querySelector('[data-invoice-registration-missing]'), [], 'S2 missing note')
      const note = await ownerB.$eval('[data-invoice-registration-missing]', e => ({ text: e.textContent, href: e.querySelector('a')?.getAttribute('href') })); assert.ok(note.text.includes('会社設定に登録番号がありません。適格請求書になりません。') && note.href === '/settings/organization', 'invoice-ui:S2 ' + JSON.stringify(note))
      if ((await status(T.ownerB)).connected) assert.equal((await api('/api/company-mail/gmail', T.ownerB, 'DELETE')).status, 200)
      await ownerB.goto(origin + '/settings/organization', { waitUntil: 'networkidle2' }); await wait(ownerB, () => document.querySelector('[data-gmail-state]')?.textContent.includes('未設定'), [], 'gmail-card-unset')
      await ownerB.setRequestInterception(true)
      ownerB.on('request', req => { const u = new URL(req.url()); if (u.hostname === 'accounts.google.com') { const code = fake.issueCode({ challenge: u.searchParams.get('code_challenge'), scopes: ['openid', 'email', SEND_SCOPE], email: SB }); req.respond({ status: 302, headers: { location: origin + '/settings/gmail-callback?code=' + encodeURIComponent(code) + '&state=' + encodeURIComponent(u.searchParams.get('state')) + '&scope=' + encodeURIComponent('openid email ' + SEND_SCOPE) } }) } else req.continue() })
      await ownerB.evaluate(() => document.querySelector('[data-gmail-connect]').click())
      await wait(ownerB, () => location.pathname === '/settings/organization' && document.querySelector('[data-gmail-state]')?.textContent.includes('送信済みフォルダの許可なし'), [], 'gmail-callback-connected')
      assert.equal((await status(T.ownerB)).labelsGranted, false); await closeContext(ownerB)
      // A member sees the send button disabled with the reason.
      const member = await newPage(true); await login(member, 'memberA'); await nativeSwitch(member, A); await member.goto(origin + '/invoices', { waitUntil: 'networkidle2' }); await wait(member, () => document.querySelectorAll('tbody tr [data-invoice-send]').length > 0, [], 'member-list')
      assert.deepEqual(await member.$eval('tbody tr [data-invoice-send]', b => [b.disabled, b.getAttribute('title')]), [true, '経理担当以上が送信できます'], 'invoice-ui:member-send-disabled'); await closeContext(member)
      assert.deepEqual(pageErrors, [], 'invoice-ui:page-errors')
      pass('Chrome 390px: the full-screen invoice screen ①-④ fills the issuer and its 登録番号 (read-only), picks a customer, offers 10/8（※軽減）/0, keeps 保存 disabled until required, shows live totals equal to the stored ones and a refused save\'s message; B shows the missing-number note; rows show sent/counted/failed (+time)/unknown lines with もう一度送る and visible actions; the send dialog shows 送信中… until Gmail answers; the Gmail card shows 接続済み and, after the consent round trip through gmail-callback without labels, 送信済みフォルダの許可なし; a member\'s send button is disabled with the reason')
    } else if (has('L4')) console.log('Browser leg L4 not requested (OMF_INVOICE_BROWSER unset)')

    // ---- M21. Restart: each sending delivery of the earlier process goes through the company queue after the app starts again.
    if (has('M21')) {
      const company = async (key, address) => { const id = new ObjectId(); await orgs.insertOne({ _id: id, name: 'Synthetic restart ' + key, slug: 'invoice-restart-' + key.toLowerCase(), type: 'business', isActive: true, members: [m('ownerA', 'owner')], settings: { defaultCurrency: 'JPY', fiscalYearStart: 4, timezone: 'Asia/Tokyo' }, createdAt: now, updatedAt: now }); const token = await tokenOf('ownerA', id); if (address) await connect(token, address); return { id, token, address } }
      const C = await company('C', 'restart-c@example.invalid'), D = await company('D', 'restart-d@example.invalid'), E = await company('E', 'restart-e@example.invalid'), F = await company('F', 'restart-f@example.invalid'), G = await company('G', 'restart-g@example.invalid'), H = await company('H', null)
      const mime = subject => Buffer.from(['From: x@example.invalid', 'To: restart@example.invalid', 'Subject: ' + subject, 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b"', '', '--b', 'Content-Type: text/plain; charset=UTF-8', '', 'restart', '--b', 'Content-Type: application/pdf; name="x.pdf"', 'Content-Disposition: attachment; filename="invoice_' + subject + '.pdf"', 'Content-Transfer-Encoding: base64', '', Buffer.from('%PDF-1.4 synthetic').toString('base64'), '--b--', ''].join('\r\n'))
      const interrupted = async (co, o, withBytes = true) => { const doc = await freshInvoice(co.id); const sendId = crypto.randomUUID(), bytes = mime(doc.invoiceNumber); await invoices.updateOne({ _id: doc._id }, { $set: { deliveries: [{ sendId, bootId: 'earlier-process', from: co.address, to: 'restart@example.invalid', subject: doc.invoiceNumber, state: 'sending', attempts: o.postStartedAt ? 1 : 0, startedAt: new Date(Date.now() - 120000), ...o }] } }); if (withBytes) await db.collection('invoicemailoutbox').insertOne({ _id: sendId, organizationId: co.id, invoiceId: doc._id, mime: bytes, createdAt: new Date() }); return { doc, sha: crypto.createHash('sha256').update(bytes).digest('hex') } }
      const longAgo = new Date(Date.now() - 60000)
      const rc = await interrupted(C, {}); fake.send(C.address, { status: 200, delayMs: 15000 })
      fake.mailbox(D.address).sentTotal = 7; const rd = await interrupted(D, { postStartedAt: longAgo, sentCountBefore: 7 })
      fake.mailbox(E.address).sentTotal = 5; const re = await interrupted(E, { postStartedAt: longAgo, sentCountBefore: 4 })
      const rf = await interrupted(F, { postStartedAt: longAgo })
      const rh = await interrupted(H, { postStartedAt: longAgo, sentCountBefore: 3 })
      // G: a real stop mid-send. The fake accepts 8 s after the POST began; the app is killed while it waits.
      const g = await freshInvoice(G.id); fake.send(G.address, { status: 200, delayMs: 8000 }); const gSend = sendFor(G.token, g._id).catch(() => null)
      for (let i = 0; i < 200 && !postsFor(G.address, g).length; i++) await pause(100); assert.equal(postsFor(G.address, g).length, 1, 'restart:G post began')
      await stop(true); await gSend
      assert.equal((await deliveryOf(g._id)).last.state, 'sending', 'restart:G left sending by the stop')
      await boot('restart', true)
      // While C's resend waits in Gmail, a click on the same invoice is refused.
      for (let i = 0; i < 200 && !postsFor(C.address, rc.doc).length; i++) await pause(100); assert.equal(postsFor(C.address, rc.doc).length, 1, 'restart:C resend began')
      const meanwhile = await sendFor(C.token, rc.doc._id); assert.equal(meanwhile.status, 409, 'restart:click-meanwhile ' + meanwhile.status)
      for (let i = 0; i < 1200 && await invoices.countDocuments({ 'deliveries.state': 'sending' }); i++) await pause(100)
      assert.equal(await invoices.countDocuments({ 'deliveries.state': 'sending' }), 0, 'restart:no-row-left-sending')
      let x = await deliveryOf(rc.doc._id); assert.deepEqual([x.last.state, x.last.confirmedBy], ['sent', 'gmail_id'], 'restart:no-post-resent ' + JSON.stringify(x.last)); assert.deepEqual(fake.mailbox(C.address).mails.map(y => y.sha), [rc.sha], 'restart:no-post-same-bytes')
      x = await deliveryOf(rd.doc._id); assert.deepEqual([x.last.state, x.last.confirmedBy], ['sent', 'gmail_id'], 'restart:unchanged-resent ' + JSON.stringify(x.last)); assert.deepEqual(fake.mailbox(D.address).mails.map(y => y.sha), [rd.sha], 'restart:unchanged-same-bytes')
      x = await deliveryOf(re.doc._id); assert.deepEqual([x.last.state, x.last.confirmedBy], ['sent', 'sent_count'], 'restart:plus-one-sent ' + JSON.stringify(x.last)); assert.equal(fake.mailbox(E.address).posts.length, 0, 'restart:plus-one-no-post')
      x = await deliveryOf(rf.doc._id); assert.equal(x.last.state, 'unknown', 'restart:no-before-count-unknown'); assert.equal(fake.mailbox(F.address).posts.length, 0)
      x = await deliveryOf(rh.doc._id); assert.equal(x.last.state, 'unknown', 'restart:no-connection-unknown ' + JSON.stringify(x.last))
      x = await deliveryOf(g._id); assert.deepEqual([x.last.state, x.last.confirmedBy], ['sent', 'sent_count'], 'restart:stopped-mid-send ' + JSON.stringify(x.last)); assert.equal(mailsFor(G.address, g).length, 1, 'restart:stopped-mid-send one mail'); assert.equal(postsFor(G.address, g).length, 1)
      for (let i = 0; i < 300 && await db.collection('invoicemailoutbox').countDocuments(); i++) await pause(100)
      assert.equal(await db.collection('invoicemailoutbox').countDocuments(), 0, 'restart:outbox-empty')
      pass('M21 restart: no postStartedAt → resent with the stored bytes; postStartedAt and an unchanged count → resent with the same bytes; +1 → sent by the count without a post; no before-count or no connection → unknown; a stop mid-send that Gmail accepted → sent by the count, one mail; a click during the recovery → 409; no row left sending')
    }

    // ---- Secrets: no stored row and no log line holds a plain Google token, the client secret or the sealing key.
    if (needGmail) {
      const dump = []; for (const c of await db.listCollections().toArray()) dump.push(JSON.stringify(await db.collection(c.name).find().toArray()))
      const all = dump.join('\n')
      for (const s of fake.allSecrets()) { assert.ok(!all.includes(s), 'gmail:secret-in-database'); assert.ok(!allLogs.includes(s), 'gmail:secret-in-logs') }
      assert.ok(!allLogs.includes(TOKEN_KEY), 'gmail:key-in-logs')
      pass('no database row and no app log line holds a plain refresh/access token, the client secret or the sealing key')
    }
    console.log(checks + ' Invoice registration and Gmail groups passed')
  } finally {
    if (browser) await browser.close().catch(() => {})
    if (app) { const c = app; app = null; c.kill(); await c.closed }
    if (client) await client.close().catch(() => {})
    if (fake) await fake.close().catch(() => {})
    if (mongo) { try { await mongo.stop() } catch (e) { console.error('CLEANUP mongod stop slow: ' + String(e?.message || e).slice(0, 200)) } }
    if (directory) await fsp.rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1 })
