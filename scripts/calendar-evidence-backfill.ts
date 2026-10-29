// scripts/calendar-evidence-backfill.ts (plan omf-calendar-evidence-20261029 §2): register the private supplier originals named by a
// manifest, link them to the saved calendar entries and adopt the one legacy verification marker, through the same service the routes
// and company Navi use, in-process. Run with tsx; needs MONGO_URI and OMF_DATA_DIR:
//   npx tsx scripts/calendar-evidence-backfill.ts --manifest <private path> --organization <id> --actor <id> --receipt <private path> [--apply]
// Dry run (default): reads every original, verifies each sha256 against its bytes, reads the payments the manifest names (read-only)
// and writes the planned identities/sources/links/adoption to the receipt; nothing is written to the database or the data directory.
// --apply runs that plan through retainCalendarOriginal, registerCalendarEvidence, linkCalendarEvidence and
// adoptLegacyVerificationMarker (the plan is refused when it has problems). Public code carries no real data: the manifest, the
// archive and the receipt are private. Links never write a Payment; the adoption writes only paymentVerification.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import mongoose from 'mongoose'
import { Payment } from '../server/models/Payment'
import * as service from '../server/services/companyCalendarEvidenceService'
import { verificationOf } from '../shared/finance-calendar-verification.mjs'

export type Manifest = { __file?: string, organizationId?: string, selectedInvoiceDocuments?: any[], previousVersions?: any[], revisionChains?: any[], calendarAssociations?: any[], explicitUnconfirmedPayment?: any }
export type PlannedFile = { fileId: string, name: string, mimeType: string, size: number, kind: 'invoice-pdf' | 'companion' | 'email', path: string }
export type PlannedSource = { sha256: string, status: 'active' | 'superseded', provider: 'gmail', messageId: string, receivedAt: string, issuedOn?: string, totalAmount?: number, email: { sha256: string, name: string, size: number, text: string, path: string }, files: PlannedFile[], supersededReason?: string }
export type PlannedIdentity = { key: string, supplier: string, invoiceNumber: string, servicePeriod: { from: string, to: string }, currency: string, sources: PlannedSource[] }
export type Plan = { manifest: string, archiveRoot: string, organizationId: string, identities: PlannedIdentity[], links: Array<{ identityKey: string, invoiceNumber: string, paymentId: string }>, adoption: { paymentId: string, invoiceSourceSha256: string } | null, skipped: Array<{ sha256Prefix: string, invoiceNumber: string, status: string, why: string }>, warnings: string[], problems: string[] }
export type Writers = Pick<typeof service, 'retainCalendarOriginal' | 'registerCalendarEvidence' | 'linkCalendarEvidence' | 'adoptLegacyVerificationMarker'>

const HEX24 = /^[a-f0-9]{24}$/i, HEX64 = /^[a-f0-9]{64}$/, MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/
const MIME: Record<string, string> = { '.pdf': 'application/pdf', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel', '.csv': 'text/csv', '.eml': 'message/rfc822', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }
const mimeOf = (name: string) => MIME[path.extname(name).toLowerCase()] || 'application/octet-stream'
const identityKeyOf = (d: any) => [d.supplier, d.invoiceNumber, d.periodStart, d.periodEnd].map(v => String(v ?? '')).join('|')
const prefix = (v: unknown) => String(v || '').slice(0, 8)

export function loadManifest(file: string): Manifest {
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Invalid manifest')
  manifest.__file = path.resolve(file)
  return manifest
}

// The plan: pure reads of the manifest and the archive (bytes hashed and compared to the manifest), no database.
export async function planCalendarEvidenceBackfill(manifest: Manifest, options: { organizationId: string, archiveRoot?: string }): Promise<Plan> {
  const file = manifest.__file || '', archiveRoot = options.archiveRoot || (file ? path.dirname(file) : process.cwd())
  const problems: string[] = [], warnings: string[] = [], skipped: Plan['skipped'] = []
  if (!HEX24.test(options.organizationId)) problems.push('--organization must be a 24-hex id')
  if (manifest.organizationId && String(manifest.organizationId) !== String(options.organizationId)) problems.push('manifest organizationId ' + manifest.organizationId + ' differs from --organization ' + options.organizationId)
  const active: any[] = Array.isArray(manifest.selectedInvoiceDocuments) ? manifest.selectedInvoiceDocuments : [], previous: any[] = Array.isArray(manifest.previousVersions) ? manifest.previousVersions : [], chains: any[] = Array.isArray(manifest.revisionChains) ? manifest.revisionChains : []
  const identities = new Map<string, PlannedIdentity>()
  const identityFor = (d: any) => { const key = identityKeyOf(d); if (!identities.has(key)) identities.set(key, { key, supplier: String(d.supplier || ''), invoiceNumber: String(d.invoiceNumber || ''), servicePeriod: { from: String(d.periodStart || ''), to: String(d.periodEnd || '') }, currency: 'JPY', sources: [] }); return identities.get(key)! }
  const hashed = async (p: string) => { const bytes = await readFile(p); return { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length } }
  const messageOf = async (id: string, label: string) => {
    if (!MESSAGE_ID.test(id)) { problems.push(label + ': invalid message id'); return null }
    try { const m = JSON.parse(await readFile(path.join(archiveRoot, 'messages', id + '.json'), 'utf8')); const receivedAt = m.receivedAt || (m.internalDate ? new Date(Number(m.internalDate)).toISOString() : ''); if (!receivedAt || !Number.isFinite(Date.parse(receivedAt))) { problems.push(label + ': message ' + id + ' has no receivedAt'); return null } const plain = (Array.isArray(m.bodies) ? m.bodies : []).find((b: any) => b?.mimeType === 'text/plain' && typeof b.text === 'string'); return { receivedAt: new Date(receivedAt).toISOString(), text: plain ? String(plain.text).slice(0, 20000) : '' } }
    catch { problems.push(label + ': message metadata ' + id + '.json is missing or unreadable'); return null }
  }
  const sourceFor = async (d: any, status: 'active' | 'superseded'): Promise<PlannedSource | null> => {
    const label = String(d.invoiceNumber || '?') + ' ' + prefix(d.sha256)
    if (!HEX64.test(String(d.sha256))) { problems.push(label + ': invalid document sha256'); return null }
    const messageId = String(d.latestAttachmentMessageId || ''), message = await messageOf(messageId, label)
    if (!message) return null
    const files: PlannedFile[] = []
    const copies: any[] = Array.isArray(d.copies) && d.copies.length ? d.copies : [{ path: path.join(archiveRoot, 'blobs', d.sha256 + '.pdf'), sha256: d.sha256, originalFilename: String(d.invoiceNumber || d.sha256) + '.pdf' }]
    for (const c of copies) {
      const p = String(c.path || ''), name = String(c.originalFilename || path.basename(p))
      try { const h = await hashed(p); if (c.sha256 && h.sha256 !== c.sha256) { problems.push(label + ': ' + name + ' bytes do not match the manifest sha256'); continue } if (h.size > service.CALENDAR_ORIGINAL_MAX_BYTES) warnings.push(label + ': ' + name + ' is over the 25MB limit; apply will refuse it'); files.push({ fileId: h.sha256, name, mimeType: mimeOf(name), size: h.size, kind: h.sha256 === d.sha256 ? 'invoice-pdf' : 'companion', path: p }) }
      catch { problems.push(label + ': ' + name + ' is missing or unreadable') }
    }
    if (!files.some(f => f.kind === 'invoice-pdf')) { problems.push(label + ': no file carries the document sha256'); return null }
    const emailPath = d.originalEmail?.path ? String(d.originalEmail.path) : path.join(archiveRoot, 'messages', messageId + '.eml')
    let email: PlannedSource['email']
    try { const h = await hashed(emailPath); if (d.originalEmail?.sha256 && h.sha256 !== d.originalEmail.sha256) { problems.push(label + ': the original email bytes do not match the manifest sha256'); return null } if (h.size > service.CALENDAR_ORIGINAL_MAX_BYTES) warnings.push(label + ': the original email is over the 25MB limit; apply will refuse it'); email = { sha256: h.sha256, name: path.basename(emailPath), size: h.size, text: message.text, path: emailPath } }
    catch { problems.push(label + ': the original email is missing or unreadable'); return null }
    const issuedOn = typeof d.issuedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.issuedOn) ? d.issuedOn : undefined
    const totalAmount = Number.isFinite(Number(d.totalJPY)) ? Number(d.totalJPY) : undefined
    return { sha256: d.sha256, status, provider: 'gmail', messageId, receivedAt: message.receivedAt, issuedOn, totalAmount, email, files }
  }
  for (const d of active) {
    if (d.status !== 'active') { skipped.push({ sha256Prefix: prefix(d.sha256), invoiceNumber: String(d.invoiceNumber || ''), status: String(d.status), why: 'selected document whose status is not active' }); continue }
    const source = await sourceFor(d, 'active'); if (source) identityFor(d).sources.push(source)
  }
  for (const d of previous) {
    if (d.status !== 'superseded') { skipped.push({ sha256Prefix: prefix(d.sha256), invoiceNumber: String(d.invoiceNumber || ''), status: String(d.status), why: 'status is neither active nor superseded' }); continue }
    const chain = chains.find(c => (c.obsoleteDocuments || []).includes(d.sha256)), replacement = chain && active.find(a => a.status === 'active' && (chain.activeDocuments || []).includes(a.sha256))
    if (!replacement) { problems.push('superseded document ' + String(d.invoiceNumber || '?') + ' ' + prefix(d.sha256) + ' has no active replacement in revisionChains'); continue }
    const source = await sourceFor(d, 'superseded')
    if (source) { source.supersededReason = String(d.reason || '').slice(0, 500) || ('superseded by ' + replacement.invoiceNumber); identityFor(replacement).sources.push(source) }
  }
  const links: Plan['links'] = []
  for (const a of Array.isArray(manifest.calendarAssociations) ? manifest.calendarAssociations : []) {
    const d = active.find(x => x.status === 'active' && x.sha256 === a.invoiceSha256)
    if (!d) { problems.push('association ' + String(a.invoiceNumber || '?') + ' names no active document ' + prefix(a.invoiceSha256)); continue }
    for (const e of Array.isArray(a.existingCalendarEntries) ? a.existingCalendarEntries : []) {
      if (!HEX24.test(String(e.paymentId))) { problems.push('association ' + d.invoiceNumber + ': invalid paymentId'); continue }
      if (e.organizationId && String(e.organizationId) !== String(options.organizationId)) { problems.push('association ' + d.invoiceNumber + ': entry ' + e.paymentId + ' belongs to another company'); continue }
      links.push({ identityKey: identityKeyOf(d), invoiceNumber: String(d.invoiceNumber), paymentId: String(e.paymentId).toLowerCase() })
    }
  }
  const u = manifest.explicitUnconfirmedPayment
  const adoption = u && HEX24.test(String(u._id)) && HEX64.test(String(u.naviOperation?.invoiceSourceSha256)) ? { paymentId: String(u._id).toLowerCase(), invoiceSourceSha256: String(u.naviOperation.invoiceSourceSha256) } : null
  if (u && !adoption) problems.push('explicitUnconfirmedPayment lacks a 24-hex _id or a naviOperation.invoiceSourceSha256')
  return { manifest: file, archiveRoot, organizationId: options.organizationId, identities: [...identities.values()], links, adoption, skipped, warnings, problems }
}

// Read-only checks of the payments the plan names, in the company: found, status, verification, and whether the legacy fingerprint matches.
export async function checkCalendarEvidencePayments(plan: Plan, organizationId: string) {
  const problems: string[] = []
  const ids = [...new Set([...plan.links.map(l => l.paymentId), ...(plan.adoption ? [plan.adoption.paymentId] : [])])]
  const rows: any[] = ids.length && HEX24.test(organizationId) ? await Payment.find({ _id: { $in: ids.map(id => new mongoose.Types.ObjectId(id)) }, organizationId: new mongoose.Types.ObjectId(organizationId) }).lean() : []
  const byId = new Map(rows.map(r => [String(r._id), r]))
  const payments = ids.map(id => {
    const row = byId.get(id)
    const view: any = { paymentId: id, found: !!row, status: row?.status ?? null, suppressed: !!row?.suppressedAt, hasVerification: !!(row && verificationOf(row)) }
    if (plan.adoption && id === plan.adoption.paymentId) view.fingerprintMatches = !!row && row.naviOperation?.invoiceSourceSha256 === plan.adoption.invoiceSourceSha256 && row.naviOperation?.paymentVerification?.state === 'unverified' && !verificationOf(row)
    return view
  })
  for (const p of payments) { if (!p.found) problems.push('payment ' + p.paymentId + ' is not in company ' + organizationId); else if (p.suppressed && plan.links.some(l => l.paymentId === p.paymentId)) problems.push('payment ' + p.paymentId + ' is hidden from the calendar') }
  return { payments, problems }
}

// Apply: retain, register, link, adopt through the given writers (the real service by default; a replay passes recorders).
export async function applyCalendarEvidenceBackfill(plan: Plan, options: { organizationId: string, actorId: string, writers?: Writers }) {
  const writers: Writers = options.writers || service, organizationId = new mongoose.Types.ObjectId(options.organizationId)
  const applied = { identities: [] as Array<{ invoiceNumber: string, evidenceId: string | null, sources: Array<{ sourceId: string, status: string, outcome: string }> }>, links: [] as Array<{ invoiceNumber: string, evidenceId: string, paymentId: string, outcome: string }>, adoption: null as null | { paymentId: string, outcome: string }, failures: [] as Array<{ invoiceNumber?: string, step: string, paymentId?: string, sha256Prefix?: string, statusCode: number | null, message: string }>, writes: { retained: 0, registered: 0, existingSources: 0, linked: 0, alreadyLinked: 0 } }
  const failure = (step: string, error: any, extra: Record<string, any> = {}) => { applied.failures.push({ step, statusCode: error?.statusCode || null, message: String(error?.statusMessage || error?.message || error).slice(0, 300), ...extra }) }
  const evidenceIds = new Map<string, string>()
  for (const identity of plan.identities) {
    const out = { invoiceNumber: identity.invoiceNumber, evidenceId: null as string | null, sources: [] as Array<{ sourceId: string, status: string, outcome: string }> }
    for (const source of identity.sources) {
      try {
        for (const f of [...source.files, { ...source.email, fileId: source.email.sha256 }]) { await writers.retainCalendarOriginal(organizationId, await readFile(f.path), f.fileId); applied.writes.retained++ }
        const r = await writers.registerCalendarEvidence(organizationId, { identity: { supplier: identity.supplier, invoiceNumber: identity.invoiceNumber, servicePeriod: identity.servicePeriod, currency: identity.currency }, source: { provider: source.provider, messageId: source.messageId, receivedAt: source.receivedAt, issuedOn: source.issuedOn, totalAmount: source.totalAmount, email: { sha256: source.email.sha256, name: source.email.name, size: source.email.size, text: source.email.text }, files: source.files.map(({ path: _p, ...f }) => f), status: source.status, supersededReason: source.supersededReason } })
        out.evidenceId = r.evidence.id; out.sources.push({ sourceId: r.source.id, status: r.source.status, outcome: r.outcome })
        if (r.outcome === 'registered') applied.writes.registered++; else applied.writes.existingSources++
      } catch (error: any) { failure('register', error, { invoiceNumber: identity.invoiceNumber, sha256Prefix: prefix(source.sha256) }) }
    }
    if (out.evidenceId) evidenceIds.set(identity.key, out.evidenceId)
    applied.identities.push(out)
  }
  for (const l of plan.links) {
    const evidenceId = evidenceIds.get(l.identityKey)
    if (!evidenceId) { applied.failures.push({ step: 'link', invoiceNumber: l.invoiceNumber, paymentId: l.paymentId, statusCode: null, message: 'identity not registered' }); continue }
    try { const r = await writers.linkCalendarEvidence(organizationId, evidenceId, l.paymentId, { actorId: options.actorId }); applied.links.push({ invoiceNumber: l.invoiceNumber, evidenceId, paymentId: l.paymentId, outcome: r.outcome }); if (r.outcome === 'linked') applied.writes.linked++; else applied.writes.alreadyLinked++ }
    catch (error: any) { failure('link', error, { invoiceNumber: l.invoiceNumber, paymentId: l.paymentId }) }
  }
  if (plan.adoption) {
    try { const r = await writers.adoptLegacyVerificationMarker(organizationId, plan.adoption.paymentId, plan.adoption.invoiceSourceSha256); applied.adoption = { paymentId: plan.adoption.paymentId, outcome: r.outcome } }
    catch (error: any) { failure('adopt', error, { paymentId: plan.adoption.paymentId }); applied.adoption = { paymentId: plan.adoption.paymentId, outcome: 'failed' } }
  }
  return applied
}

// The receipt's view of the plan: names, kinds, sizes, hash prefixes and counts; never a path, never the mail text.
const planView = (plan: Plan) => ({
  identities: plan.identities.map(i => ({ invoiceNumber: i.invoiceNumber, supplier: i.supplier, servicePeriod: i.servicePeriod, currency: i.currency, sources: i.sources.map(s => ({ sha256Prefix: prefix(s.sha256), status: s.status, messageId: s.messageId, receivedAt: s.receivedAt, issuedOn: s.issuedOn || null, totalAmount: s.totalAmount ?? null, files: s.files.map(f => ({ name: f.name, kind: f.kind, size: f.size, sha256Prefix: prefix(f.fileId) })), emailSha256Prefix: prefix(s.email.sha256), emailBytes: s.email.size, emailTextChars: s.email.text.length, supersededReason: s.supersededReason || null })) })),
  links: plan.links.map(l => ({ invoiceNumber: l.invoiceNumber, paymentId: l.paymentId })),
  adoption: plan.adoption ? { paymentId: plan.adoption.paymentId, invoiceSourceSha256Prefix: prefix(plan.adoption.invoiceSourceSha256) } : null,
  skipped: plan.skipped, warnings: plan.warnings
})
const USAGE = 'usage: npx tsx scripts/calendar-evidence-backfill.ts --manifest <private path> --organization <24-hex id> --actor <24-hex id> --receipt <private path> [--apply]\n  env: MONGO_URI, OMF_DATA_DIR. Dry run by default (verifies bytes, reads payments, writes the plan to the receipt); --apply writes through the calendar evidence service.'

export async function runBackfillCli(argv: string[]): Promise<number> {
  const opt = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }, has = (n: string) => argv.includes(n)
  if (has('--help') || !argv.length) { console.log(USAGE); return 0 }
  const manifestPath = opt('--manifest'), organizationId = opt('--organization'), actorId = opt('--actor'), receiptPath = opt('--receipt'), apply = has('--apply')
  if (!manifestPath || !organizationId || !actorId || !receiptPath) { console.error(USAGE); return 2 }
  if (!HEX24.test(organizationId) || !HEX24.test(actorId)) { console.error('--organization and --actor must be 24-hex ids'); return 2 }
  if (!process.env.MONGO_URI) { console.error('MONGO_URI is required'); return 2 }
  if (!process.env.OMF_DATA_DIR) { console.error('OMF_DATA_DIR is required'); return 2 }
  const plan = await planCalendarEvidenceBackfill(loadManifest(manifestPath), { organizationId })
  await mongoose.connect(process.env.MONGO_URI)
  try {
    const checks = await checkCalendarEvidencePayments(plan, organizationId)
    const problems = [...plan.problems, ...checks.problems]
    const receipt: any = { mode: apply ? 'apply' : 'dry-run', at: new Date().toISOString(), manifest: path.resolve(manifestPath), organizationId, actorId, limitBytes: service.CALENDAR_ORIGINAL_MAX_BYTES, plan: planView(plan), checks, counts: { identities: plan.identities.length, sources: plan.identities.reduce((n, i) => n + i.sources.length, 0), activeSources: plan.identities.reduce((n, i) => n + i.sources.filter(s => s.status === 'active').length, 0), supersededSources: plan.identities.reduce((n, i) => n + i.sources.filter(s => s.status === 'superseded').length, 0), links: plan.links.length, adoption: plan.adoption ? 1 : 0, skipped: plan.skipped.length, warnings: plan.warnings.length, problems: problems.length }, problems, ok: false }
    if (apply && !problems.length) receipt.applied = await applyCalendarEvidenceBackfill(plan, { organizationId, actorId })
    receipt.ok = !problems.length && (!apply || receipt.applied.failures.length === 0)
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n')
    console.log((apply ? 'APPLY ' : 'DRY RUN ') + JSON.stringify({ ...receipt.counts, ...(receipt.applied ? { applied: { ...receipt.applied.writes, adoption: receipt.applied.adoption?.outcome || null, failures: receipt.applied.failures.length } } : {}), ok: receipt.ok, receipt: path.resolve(receiptPath) }))
    for (const p of problems) console.error('PROBLEM ' + p)
    for (const f of receipt.applied?.failures || []) console.error('FAILURE ' + JSON.stringify(f))
    return receipt.ok ? 0 : 1
  } finally { await mongoose.disconnect() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runBackfillCli(process.argv.slice(2)).then(code => { process.exitCode = code }, error => { console.error(error); process.exitCode = 1 })
