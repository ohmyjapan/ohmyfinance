// Company Navi public research evidence: prepare (registry date authority), capture, list and read sources of a frozen company
// job, resolve reply citations and project source cards for the page. Every function takes the server's frozen conversation `c`
// (owner, company, conversation, segment, current turn): a worker or model never supplies them. Nothing here writes a supplier,
// transaction, invoice, ledger or teaching: research is evidence for the answer only.
import { createHash } from 'node:crypto'
import { FinanceCompanyPublicSource as Source } from '../models/FinanceCompanyPublicSource'
import { getCompanyNaviTransaction } from './companyTransactionAssistantService'
import { getCompanyInvoice } from './companyFinanceReadService'
import { fail, id } from './financeService'
import { parseRegistry } from '../../shared/finance-research.mjs'
import { validatePublicCapability, validatePublicCapture, validateRegistryTarget, literalQuoteIn, registryUrl, evidenceOf, publicResearchLimits as limits } from '../../shared/finance-company-public-research.mjs'

const init = () => Source.init()
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
export const todayJst = (at: Date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
const jstDate = (value: any) => { const d = value ? new Date(value) : null; return d && Number.isFinite(d.getTime()) ? todayJst(d) : null }
// Query scopes (named so a scope defect is one visible change).
const conversationSources = (c: any) => ({ ownerId: c.ownerId, organizationId: c.organizationId, conversationId: c._id })
const readableSource = (c: any, sourceId: any) => ({ _id: sourceId, ownerId: c.ownerId, organizationId: c.organizationId, conversationId: c._id })
const citableSource = (c: any, sourceId: any) => ({ _id: sourceId, ...conversationSources(c), status: 'captured' })
const ownedSource = (ownerId: any, organizationId: any, sourceId: any) => ({ _id: sourceId, ownerId, organizationId })
const currentTurn = (c: any) => c.turns?.find((t: any) => t.id === c.currentId)

// The worker's capability report, validated at the heartbeat; usable only while fresh (the chat freshness window).
export function checkedCapabilityReport(input: any) {
  if (input === null || input === undefined) return null
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => k !== 'publicResearch')) fail(400, 'Invalid worker capability report')
  if (input.publicResearch === undefined || input.publicResearch === null) return null
  try { return { ...validatePublicCapability(input.publicResearch), reportedAt: new Date() } } catch { return fail(400, 'Invalid worker capability report') }
}
export function publicResearchCapabilityOf(agent: any) {
  const p = agent?.publicResearch
  if (!p?.reportedAt || Date.now() - new Date(p.reportedAt).getTime() > 65000) return null
  try { return validatePublicCapability({ version: p.version, webSearch: p.webSearch, publicPage: p.publicPage, chrome: p.chrome, registry: p.registry }) } catch { return null }
}

// A user-stated date counts only when the current message literally contains it.
const statedDate = (turnText: string, date: string) => { const [y, m, d] = date.split('-'); return [date, `${y}/${m}/${d}`, `${y}/${Number(m)}/${Number(d)}`, `${y}年${m}月${d}日`, `${y}年${Number(m)}月${Number(d)}日`].some(form => turnText.includes(form)) }
// Official verification date authority: the frozen company's transaction or invoice date, a date the user wrote in the current
// message, or today in Japan. Never a model-chosen date.
export async function prepareRegistry(c: any, input: any) {
  let target: any
  try { target = validateRegistryTarget(input) } catch { fail(400, 'Use one literal T number and at most one of transactionId, invoiceId or date') }
  const turnText = String(currentTurn(c)?.text || ''), today = todayJst()
  let date: string | null = null, dateAuthority = 'today_jst'
  if (target.transactionId) { const v: any = await getCompanyNaviTransaction(c.organizationId, target.transactionId); date = jstDate(v.date); dateAuthority = 'transaction_date' }
  else if (target.invoiceId) { const v: any = (await getCompanyInvoice(c.organizationId, target.invoiceId)).invoice; date = jstDate(v.issueDate); dateAuthority = 'invoice_issue_date' }
  else if (target.date) {
    if (!statedDate(turnText, target.date)) fail(400, 'Use the transaction or invoice date, or a date the user wrote in the current message')
    date = target.date; dateAuthority = 'user_stated_date'
  } else date = today
  if (!date) fail(409, 'The selected record has no usable date')
  if (date > today) fail(400, 'A registry date cannot be in the future')
  return { target, number: target.number as string, date: date as string, dateAuthority, canonicalUrl: registryUrl(target.number, date as string) }
}
const checkedRegistry = (raw: any, number: string, date: string) => { try { return parseRegistry(raw, number, date) } catch { return fail(400, 'Registry evidence does not match the requested number and date') } }

export const sourceView = (s: any) => ({ id: String(s._id), kind: s.kind, status: s.status, evidence: s.status === 'captured' ? evidenceOf(s.kind) : null, title: s.title || '', url: s.url || null, requestedUrl: s.requestedUrl || null, capturedAt: s.capturedAt || s.createdAt || null, truncated: s.truncated === true, chars: s.chars || 0, hash: s.hash || null, registry: s.registry || null, safeError: s.safeError || null, turnId: s.turnId, segment: s.segment ?? 0 })
const sameCapture = (existing: any, doc: any) => { if (existing.kind !== doc.kind || existing.status !== doc.status || (existing.hash || '') !== (doc.hash || '') || (existing.requestedUrl || '') !== (doc.requestedUrl || '')) fail(409, 'Capture id has another meaning'); return { source: sourceView(existing), duplicate: true } }

// Stores one capture of the frozen job's current turn. Literal text must match its hash; a web or Chrome page must be a public
// HTTPS address that is not a registry API host (the registry's public website is an ordinary published page and never carries a
// registry observation); registry evidence must be the canonical API URL of the prepared number/date (never an application id)
// and parse as that number at that date. A repeated or concurrent delivery of the same capture returns one row.
export async function capturePublicSource(c: any, input: any, agentId: any) {
  await init()
  let capture: any
  try { capture = validatePublicCapture(input) } catch { fail(400, 'Invalid public source capture') }
  const doc: any = { ownerId: c.ownerId, organizationId: c.organizationId, conversationId: c._id, segment: c.segment || 0, turnId: c.currentId, agentId, captureId: capture.captureId, kind: capture.kind, requestedUrl: capture.requestedUrl }
  if (capture.failed) {
    doc.status = capture.reason === 'connection_required' ? 'unavailable' : 'failed'
    doc.safeError = capture.reason === 'connection_required' ? 'NTA registry API connection is not configured: no API check was made at this date; published evidence is not officially rechecked' : String(capture.safeError).slice(0, limits.safeErrorChars)
    if (capture.target) { const prepared = await prepareRegistry(c, capture.target); doc.target = prepared.target; doc.registry = { number: prepared.number, asOf: prepared.date, dateAuthority: prepared.dateAuthority, status: doc.status === 'unavailable' ? 'connection_required' : 'not_checked' } }
  } else {
    if (sha256(capture.text) !== capture.hash) fail(400, 'Captured text does not match its hash')
    if (capture.kind === 'registry') {
      const prepared = await prepareRegistry(c, capture.target), target = prepared.target
      if (capture.url !== prepared.canonicalUrl || capture.requestedUrl !== prepared.canonicalUrl) fail(400, 'Registry evidence must use the canonical registry URL of the prepared number and date')
      let parsedRegistry: any
      try { parsedRegistry = JSON.parse(capture.text) } catch { fail(400, 'Registry evidence is not a registry response') }
      const observation = checkedRegistry(parsedRegistry, target.number, prepared.date)
      doc.target = target
      doc.registry = { number: observation.number, asOf: observation.asOf, dateAuthority: prepared.dateAuthority, legalName: observation.legalName, registeredAddress: observation.registeredAddress, registeredFrom: observation.registeredFrom, active: observation.active === true, disposalDate: observation.disposalDate, expireDate: observation.expireDate, status: observation.active ? 'registered_on_date' : 'not_registered_on_date' }
    }
    Object.assign(doc, { status: 'captured', url: capture.url, title: capture.title.slice(0, limits.titleChars), text: capture.text, hash: capture.hash, chars: capture.text.length, truncated: capture.truncated, capturedAt: new Date(capture.capturedAt) })
  }
  const identity = { conversationId: c._id, turnId: c.currentId, captureId: capture.captureId }
  const existing: any = await Source.findOne(identity).lean()
  if (existing) return sameCapture(existing, doc)
  if (await Source.countDocuments({ conversationId: c._id, turnId: c.currentId }) >= limits.sourcesPerTurn) fail(409, 'Public research budget reached for this message')
  try { return { source: sourceView((await Source.create(doc)).toObject()), duplicate: false } } catch (e: any) {
    if (e?.code !== 11000) throw e
    const raced: any = await Source.findOne(identity).lean()
    if (!raced) throw e
    return sameCapture(raced, doc)
  }
}
// Sources of this company conversation's current chat segment, without their text.
export async function listPublicSources(c: any) {
  await init()
  const rows: any[] = await Source.find({ ...conversationSources(c), segment: c.segment || 0 }).select('-text').sort({ createdAt: 1, _id: 1 }).limit(100).lean()
  return { sources: rows.map(r => ({ ...sourceView(r), observation: r.turnId === c.currentId ? 'this_turn' : 'retained_earlier' })), scope: 'this_company_conversation_current_chat', meaning: 'captured published pages and dated registry observations; failed or unavailable reads are activity, not findings' }
}
export async function readPublicSource(c: any, sourceId: any, offset: any) {
  await init()
  const start = offset === undefined ? 0 : offset
  if (!Number.isSafeInteger(start) || start < 0 || start > limits.textChars) fail(400, 'Invalid source offset')
  const s: any = await Source.findOne(readableSource(c, id(sourceId))).lean()
  if (!s) fail(404, 'Public source not found in this conversation')
  if (s.status !== 'captured') fail(409, 'This read did not capture any text')
  const end = start + limits.readWindow
  return { source: sourceView(s), text: s.text.slice(start, end), offset: start, nextOffset: end < s.text.length ? end : null }
}
// A reply citation is kept only when it quotes, literally, a captured source of the same owner/company conversation. The stored
// citation carries the server's own kind/URL/date/evidence; an earlier turn's source is a retained observation, not a fresh check.
export async function resolveCompanyCitations(c: any, citations: any[]) {
  await init()
  const out: any[] = [], seen = new Set<string>()
  for (const citation of citations) {
    const source: any = await Source.findOne(citableSource(c, id(citation.sourceId))).lean()
    if (!source) fail(400, 'Invalid company assistant reply')
    if (!literalQuoteIn(source.text, citation.quote)) fail(400, 'Invalid company assistant reply')
    const key = String(source._id) + '\n' + citation.quote
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ sourceId: String(source._id), quote: citation.quote, claim: citation.claim, kind: source.kind, title: source.title || '', url: source.url, capturedAt: source.capturedAt, evidence: evidenceOf(source.kind), observation: source.turnId === c.currentId && (source.segment ?? 0) === (c.segment || 0) ? 'this_turn' : 'retained_earlier', ...(source.kind === 'registry' && source.registry ? { registry: { number: source.registry.number, asOf: source.registry.asOf, dateAuthority: source.registry.dateAuthority, active: source.registry.active, legalName: source.registry.legalName, status: source.registry.status } } : {}) })
  }
  return out
}
// Source cards (metadata, no text) of one conversation segment, grouped by turn, for the live view and archived history.
export async function turnPublicSources(ownerId: any, organizationId: any, conversationId: any, segment: number) {
  await init()
  const rows: any[] = await Source.find({ ownerId, organizationId, conversationId, segment }).select('-text').sort({ createdAt: 1, _id: 1 }).limit(4000).lean()
  const byTurn = new Map<string, any[]>()
  for (const r of rows) { const list = byTurn.get(r.turnId) || []; list.push(sourceView(r)); byTurn.set(r.turnId, list) }
  return byTurn
}
// A member's read of one source of their company, current or archived, with bounded text.
export async function companyPublicSourceDetail(ownerId: string, organizationId: any, sourceId: string) {
  await init()
  if (typeof sourceId !== 'string' || !/^[a-f0-9]{24}$/i.test(sourceId)) fail(404, 'Public source not found')
  const s: any = await Source.findOne(ownedSource(ownerId, organizationId, sourceId)).lean()
  if (!s) fail(404, 'Public source not found')
  const text = s.status === 'captured' ? String(s.text || '') : ''
  return { source: { ...sourceView(s), text: text.slice(0, limits.detailChars), textTruncated: text.length > limits.detailChars } }
}
