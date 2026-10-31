// Replay of the real company rows (plan omf-invoice-tnumber-20261030 §4 replay) on an owned throwaway database through the hub verifier:
//   REPLAY_INPUT=<export> REPLAY_OUT=<result> node scripts/zoomer-verify.mjs --run-fixture omf-invoice-registration-gmail-replay.mjs --cwd <tree>
// The export (read by path at run time, never copied into this repository) carries organizations with their users, invoices and
// invites. Each build gets an empty memory MongoDB loaded with the rows as exported (ids and dates restored to ObjectId/Date where the
// schema has them, the export being plain JSON). The entry, on the origin build (the unchanged revision, REPLAY_ORIGIN_APP or
// <tree>/.zoomer/replay-origin: production's outcome) and then on the candidate (<tree>/.output), as each company's saved owner (an
// access token signed with this run's own secret): the settings PUT with the company's saved fields exactly as the settings page
// sends them, GET members, the print route for every exported invoice, and on the candidate GET /api/company-mail/gmail as every saved
// member (canSend must be role ∈ owner/admin). Both apps run with scripts/fake-google-fetch.mjs preloaded: every Google call (send,
// SENT count, token, revoke) reaches only the fake and is recorded; every other non-loopback host is refused; the invite mail
// placeholder is watched in the app log. Values are recorded as hash prefixes. With REPLAY_INPUT unset this fixture exports
// `covers: []`, passes with the note "no replay input" and grants NO coverage.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), input = process.env.REPLAY_INPUT || '', out = process.env.REPLAY_OUT || ''
const originRoot = path.resolve(process.env.REPLAY_ORIGIN_APP || path.join(root, '.zoomer', 'replay-origin'))
const require = createRequire(import.meta.url)
let data = null, rowCount = 0
if (input) { const { EJSON } = require('bson'); data = EJSON.parse(readFileSync(input, 'utf8'), { relaxed: true }); rowCount = Array.isArray(data?.collections?.organizations) ? data.collections.organizations.length : 0 }
const covers = rowCount ? ['server/api/organizations/[id].ts', 'server/api/organizations/[id]/members.ts', 'server/api/company-mail/gmail.ts', 'server/api/invoices/[id]/pdf.ts', 'server/utils/invoiceHtml.ts', 'server/utils/invoiceSenderAccess.ts', 'shared/finance-invoice.mjs'] : []
export const timeoutMs = 900000
const pause = ms => new Promise(r => setTimeout(r, ms))
const hash = v => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex').slice(0, 12)
const HEX = /^[a-f0-9]{24}$/i, ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
export default { name: 'omf-invoice-registration-gmail-replay', covers, async run() {
  if (!input) return { pass: true, message: 'no replay input: REPLAY NOT RUN (REPLAY_INPUT unset); this fixture exports covers: [] and grants no coverage' }
  if (!rowCount) return { pass: false, message: 'REPLAY NOT RUN: zero exported organization rows' }
  if (!out) return { pass: false, message: 'REPLAY_OUT required' }
  for (const [label, appRoot] of [['candidate', root], ['origin', originRoot]]) if (!existsSync(path.join(appRoot, '.output', 'server', 'index.mjs'))) return { pass: false, message: 'REPLAY NOT RUN: the ' + label + ' build is missing at ' + appRoot + ' (run nuxt build first)' }
  const originRevision = existsSync(path.join(originRoot, 'revision.txt')) ? readFileSync(path.join(originRoot, 'revision.txt'), 'utf8').trim() : null
  const { MongoMemoryServer } = require('mongodb-memory-server'), { MongoClient, ObjectId } = require('mongodb'), jwt = require('jsonwebtoken')
  const { startFakeGoogle } = await import(pathToFileURL(path.join(root, 'scripts', 'fake-google-fetch.mjs')).href)
  const C = data.collections, organizations = C.organizations, users = C.users || [], invoices = C.invoices || [], invites = C.invites || []
  // The export is plain JSON: restore the schema's ObjectId and Date fields, nothing else.
  const restored = { ids: 0, dates: 0 }
  const id = v => { if (typeof v === 'string' && HEX.test(v)) { restored.ids++; return new ObjectId(v) } return v }
  const date = v => { if (typeof v === 'string' && ISO.test(v)) { restored.dates++; return new Date(v) } return v }
  const typed = {
    organizations: o => ({ ...o, _id: id(o._id), members: (o.members || []).map(x => ({ ...x, userId: id(x.userId), ...(x.invitedBy ? { invitedBy: id(x.invitedBy) } : {}), ...(x.joinedAt ? { joinedAt: date(x.joinedAt) } : {}) })), ...(o.createdAt ? { createdAt: date(o.createdAt) } : {}), ...(o.updatedAt ? { updatedAt: date(o.updatedAt) } : {}), ...(o.subscriptionExpiresAt ? { subscriptionExpiresAt: date(o.subscriptionExpiresAt) } : {}) }),
    users: u => ({ ...u, _id: id(u._id), ...(u.createdAt ? { createdAt: date(u.createdAt) } : {}), ...(u.updatedAt ? { updatedAt: date(u.updatedAt) } : {}), ...(u.lastLoginAt ? { lastLoginAt: date(u.lastLoginAt) } : {}) }),
    invoices: v => { const r = { ...v }; for (const k of ['_id', 'organizationId', 'createdBy', 'transactionId']) if (r[k]) r[k] = id(r[k]); for (const k of ['issueDate', 'dueDate', 'paidDate', 'createdAt', 'updatedAt']) if (r[k]) r[k] = date(r[k]); return r },
    invites: v => { const r = { ...v }; for (const k of ['_id', 'organizationId', 'createdBy', 'acceptedBy']) if (r[k]) r[k] = id(r[k]); for (const k of ['expiresAt', 'acceptedAt', 'createdAt', 'updatedAt']) if (r[k]) r[k] = date(r[k]); return r }
  }
  const binary = path.resolve(root, '../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe')
  let mongo, client, fake, directory, child = null
  const rows = [], harness = [], fileChecks = {}
  try {
    directory = await mkdtemp(path.join(os.tmpdir(), 'omf-invoice-replay-'))
    mongo = await MongoMemoryServer.create({ binary: existsSync(binary) ? { systemBinary: binary, version: '8.2.1' } : undefined, instance: { launchTimeout: 120000 } })
    const dbName = 'invoice_registration_replay_owned', uri = mongo.getUri(dbName), secret = randomBytes(32).toString('hex')
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) throw Error('the owned database is not the local memory server')
    client = await MongoClient.connect(uri); const db = client.db(dbName)
    fake = await startFakeGoogle({ clientId: 'replay-client', clientSecret: 'replay-secret-' + randomUUID(), redirectUri: 'https://omf.example.invalid/settings/gmail-callback' })
    const load = async () => { await db.dropDatabase(); for (const [name, list] of [['organizations', organizations], ['users', users], ['invoices', invoices], ['invites', invites]]) if (list.length) await db.collection(name).insertMany(list.map(typed[name])) }
    const boot = async appRoot => {
      const listener = net.createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r)); const port = listener.address().port; await new Promise(r => listener.close(r)); const origin = 'http://127.0.0.1:' + port
      let logs = ''
      child = spawn(process.execPath, ['--import', pathToFileURL(path.join(root, 'scripts', 'fake-google-fetch.mjs')).href, '.output/server/index.mjs'], { cwd: appRoot, windowsHide: true, env: { ...process.env, MONGO_URI: uri, MONGODB_URI: uri, NUXT_MONGO_URI: uri, OMF_DATA_DIR: directory, JWT_SECRET: secret, NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port), OMF_FAKE_GOOGLE_URL: fake.url, OMF_GMAIL_CLIENT_ID: '', OMF_GMAIL_CLIENT_SECRET: '', OMF_GMAIL_REDIRECT_URI: '', OMF_MAIL_TOKEN_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
      child.closed = new Promise(r => child.once('close', r)); for (const s of [child.stdout, child.stderr]) s.on('data', v => { logs += v; child.logs = logs })
      let healthy = false; for (let i = 0; i < 1500; i++) { try { const r = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) }), d = await r.json(); if (d.database?.connected && d.database.name === dbName) { healthy = true; break } } catch {} await pause(200) }
      if (!healthy) throw Error('owned app did not become healthy at ' + appRoot + ': exit=' + child.exitCode)
      return origin
    }
    const stop = async () => { if (child) { child.kill(); await child.closed; child = null } }
    const call = async (origin, route, token, method = 'GET', body) => { const r = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) }), raw = await r.text(); let json; try { json = JSON.parse(raw) } catch {} return { status: r.status, data: json, raw, type: r.headers.get('content-type') || '' } }
    const userOf = new Map(users.map(u => [String(u._id), u]))
    const tokenFor = (userId, organizationId, role) => jwt.sign({ userId: String(userId), email: userOf.get(String(userId))?.email || 'replay@example.invalid', organizationId: String(organizationId), role, jti: randomUUID() }, secret, { expiresIn: '30m' })
    // The settings page's body: orgForm (missing values sent as '') plus the three settings it edits.
    const pageBody = o => ({ name: o.name || '', type: o.type || 'personal', email: o.email || '', phone: o.phone || '', website: o.website || '', taxId: o.taxId || '', description: o.description || '', settings: { defaultCurrency: o.settings?.defaultCurrency || 'JPY', timezone: o.settings?.timezone || 'Asia/Tokyo', fiscalYearStart: o.settings?.fiscalYearStart || 4 } })
    const masked = v => JSON.parse(JSON.stringify(v ?? null, (k, x) => k === 'updatedAt' ? 'MASKED' : x))
    const drive = async (appRoot, label) => {
      await load(); const callsBefore = fake.calls.length, origin = await boot(appRoot), got = {}
      try {
        for (const o of organizations) {
          const owner = (o.members || []).find(x => x.role === 'owner') || (o.members || [])[0], token = tokenFor(owner.userId, o._id, owner.role), callsAt = fake.calls.length
          const put = await call(origin, '/api/organizations/' + o._id, token, 'PUT', pageBody(o))
          const members = await call(origin, '/api/organizations/' + o._id + '/members', token)
          const stored = await db.collection('organizations').findOne({ _id: new ObjectId(String(o._id)) })
          const prints = []; for (const v of invoices.filter(v => String(v.organizationId) === String(o._id))) { const p = await call(origin, '/api/invoices/' + v._id + '/pdf', token); prints.push({ id: String(v._id), status: p.status, hash: hash(p.raw.replace(/Generated by OhMyFinance · [^<]*/, '')) }) }
          const gmail = []; for (const x of o.members || []) { const g = await call(origin, '/api/company-mail/gmail', tokenFor(x.userId, o._id, x.role)); gmail.push({ member: hash(String(x.userId)), role: x.role, status: g.status, json: !!g.data, canSend: g.data ? g.data.canSend : null, configured: g.data ? g.data.configured : null }) }
          const org = put.data?.organization
          got[String(o._id)] = { put: { status: put.status, hash: hash(masked(org)), withoutTaxId: hash(masked(org ? { ...org, taxId: undefined } : null)), taxId: org ? (Object.prototype.hasOwnProperty.call(org, 'taxId') ? hash(String(org.taxId)) : 'absent') : null }, members: { status: members.status, hash: hash(members.data) }, stored: { hash: hash(masked({ ...stored, __v: undefined })), withoutTaxId: hash(masked({ ...stored, __v: undefined, taxId: undefined })), taxId: Object.prototype.hasOwnProperty.call(stored, 'taxId') ? hash(String(stored.taxId)) : 'absent' }, prints, gmail, sends: fake.calls.slice(callsAt).map(c => c.method + ' ' + c.host + c.path) }
        }
        fileChecks[label] = { googleCalls: fake.calls.length - callsBefore, emailLogLines: (child.logs || '').split('\n').filter(l => l.includes('[Email]')).length }
      } finally { await stop() }
      return got
    }
    const production = await drive(originRoot, 'origin'), candidate = await drive(root, 'candidate')
    for (const o of organizations) {
      const key = String(o._id), p = production[key], n = candidate[key]
      try {
        const putSame = p.put.status === n.put.status && p.put.hash === n.put.hash, membersSame = p.members.status === n.members.status && p.members.hash === n.members.hash, storedSame = p.stored.hash === n.stored.hash
        const printsSame = JSON.stringify(p.prints) === JSON.stringify(n.prints), sends = [...p.sends, ...n.sends]
        const canSendAsPlanned = n.gmail.every(g => g.status === 200 && g.json && g.canSend === ['owner', 'admin'].includes(g.role))
        const originHadNoRoute = p.gmail.every(g => !g.json)
        const same = putSame && membersSame && storedSame && printsSame
        const productionOutcome = `PUT ${p.put.status} (org ${p.put.hash}, taxId ${p.put.taxId}); stored ${p.stored.hash} taxId ${p.stored.taxId}; members ${p.members.status} ${p.members.hash}; prints ${p.prints.length}; gmail status route ${originHadNoRoute ? 'absent (the SPA page answers)' : 'present'}`
        const newOutcome = `PUT ${n.put.status} (org ${n.put.hash}, taxId ${n.put.taxId}); stored ${n.stored.hash} taxId ${n.stored.taxId}; members ${n.members.status} ${n.members.hash}; prints ${n.prints.length}; gmail status canSend ${n.gmail.map(g => g.role + '=' + g.canSend).join(',')} configured ${n.gmail[0]?.configured}`
        let label
        if (sends.length) label = 'UNEXPLAINED: a Google call was made: ' + sends.join(', ')
        else if (!canSendAsPlanned) label = 'UNEXPLAINED: canSend differs from role ∈ owner/admin'
        else if (same) label = 'SAME: settings PUT, stored row, members and prints identical; the new status route answers canSend = role ∈ owner/admin (plan C5, R3, §4 replay)'
        // The one explainable difference: an empty 登録番号 the page sends for a company that never saved one is not written (plan A3
        // "taxId stored normalized, only when it changed"); everything else in the reply and the stored row must be identical.
        else if (membersSame && printsSame && p.put.status === 200 && n.put.status === 200 && p.put.withoutTaxId === n.put.withoutTaxId && p.stored.withoutTaxId === n.stored.withoutTaxId && p.stored.taxId === hash('') && n.stored.taxId === 'absent' && p.put.taxId === hash('') && n.put.taxId === 'absent') label = 'INTENDED: plan A3 "taxId stored normalized, only when it changed": the page sends taxId "" for a company with no saved number; the origin wrote "", the candidate leaves the field absent (both empty); every other field of the reply and the stored row identical'
        else label = 'UNEXPLAINED: ' + [!putSame && 'settings PUT differs', !membersSame && 'members differ', !storedSame && 'stored row differs', !printsSame && 'prints differ'].filter(Boolean).join(', ')
        rows.push({ id: key, productionOutcome, newOutcome, sends, same, canSendAsPlanned, label })
      } catch (e) { rows.push({ id: key, productionOutcome: null, newOutcome: 'harness error: ' + String(e?.message || e).slice(0, 300), sends: [], same: false, label: 'UNEXPLAINED: the harness could not run this row' }) }
    }
  } catch (error) {
    harness.push(String(error?.message || error).slice(0, 600))
  } finally { if (child) { child.kill(); await child.closed } if (client) await client.close(); if (fake) await fake.close().catch(() => {}); if (mongo) await mongo.stop({ doCleanup: true, force: true }).catch(() => {}); if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {}) }
  const unexplained = rows.filter(r => r.label.startsWith('UNEXPLAINED')).length, intended = rows.filter(r => r.label.startsWith('INTENDED')).length, same = rows.filter(r => r.same === true).length
  await writeFile(out, JSON.stringify({ source: data.source, readAt: data.readAt, originBuild: { root: 'tree/.zoomer/replay-origin', revision: originRevision }, candidateBuild: 'tree/.output', exported: rowCount, replayed: rows.length, same, intended, unexplained, harness, fileChecks, companions: { users: users.length, invoices: invoices.length, invites: invites.length }, inputShape: 'plain JSON; 24-hex id fields and ISO date fields of the schema restored to ObjectId/Date (' + JSON.stringify(restored) + '); every other value loaded as exported', rows }, null, 2))
  const pass = harness.length === 0 && rows.length === rowCount && unexplained === 0
  return { pass, databaseCoverage: { executed: harness.length === 0, ownedProcess: true }, message: `replayed ${rows.length}/${rowCount} company rows (with ${users.length} users, ${invoices.length} invoices, ${invites.length} invites) on the origin build (${originRevision || 'revision unrecorded'}) and the candidate — ${same} same, ${intended} INTENDED different, ${unexplained} UNEXPLAINED; Google calls ${JSON.stringify(Object.fromEntries(Object.entries(fileChecks).map(([k, v]) => [k, v.googleCalls])))}; [Email] log lines ${JSON.stringify(Object.fromEntries(Object.entries(fileChecks).map(([k, v]) => [k, v.emailLogLines])))}${harness.length ? '; HARNESS: ' + harness.join(' | ') : ''} (listed in ${out}; the owner decides)` }
} }
