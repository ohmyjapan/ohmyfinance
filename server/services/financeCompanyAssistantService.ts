import { createHash, randomUUID } from 'node:crypto'
import { FinanceCompanyAssistant as Conversation } from '../models/FinanceCompanyAssistant'
import { FinanceChatAgent as Agent } from '../models/FinanceChat'
import Organization from '../models/Organization'
import { companyMembership } from '../utils/calendarAccess'
import { ready, fail, id } from './financeService'
import { validateAssistantReply } from '../../shared/finance-assistant.mjs'
import { listCompanyInvoices, getCompanyInvoice, listCompanyCalendarEntries, getCompanyCalendarEntry } from './companyFinanceReadService'

const init = async () => { await ready(); await Conversation.init() }
const available = (ownerId: string) => Agent.findOne({ ownerId, enabled: true, revokedAt: null, workspaceEnabled: true, chatLastSeenAt: { $gt: new Date(Date.now() - 65000) } }).sort({ chatLastSeenAt: -1 }).lean()
const scopeOf = (ownerId: any, organizationId: any) => ({ actorId: String(ownerId), organizationId: String(organizationId) })
const visible = (c: any) => c ? { id: String(c._id), scope: scopeOf(c.ownerId, c.organizationId), revision: c.revision, state: c.state, currentId: c.currentId, turns: c.turns } : null
const identity = (ownerId: string, organizationId: any) => ({ ownerId, organizationId })
async function company(ownerId: string, organizationId: any) {
  const trusted = await companyMembership(ownerId, String(organizationId))
  const row: any = await Organization.findOne({ _id: trusted, isActive: true }).select('name').lean()
  if (!row) fail(403, 'Access denied to this organization')
  return { id: String(trusted), name: row.name }
}
export async function getCompanyAssistant(ownerId: string, organizationId: any) {
  await init(); const selected = await company(ownerId, organizationId)
  const c: any = await Conversation.findOne(identity(ownerId, organizationId)).lean()
  return { company: selected, conversation: visible(c), connected: !!await available(ownerId) }
}
function selection(input: any) {
  if (!input || !['invoices', 'calendar'].includes(input.page)) fail(400, 'Choose invoices or calendar')
  const selected: any = { page: input.page }
  if (input.invoiceId !== undefined) { if (input.page !== 'invoices') fail(400, 'Choose an invoice'); selected.invoiceId = id(input.invoiceId) }
  if (input.paymentId !== undefined) { if (input.page !== 'calendar') fail(400, 'Choose a calendar entry'); selected.paymentId = id(input.paymentId) }
  return selected
}
export async function sendCompanyAssistant(ownerId: string, organizationId: any, body: any) {
  await init(); const selectedCompany = await company(ownerId, organizationId)
  if (typeof body?.text !== 'string' || !body.text.trim() || body.text.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body.text) || !/^[-a-zA-Z0-9]{16,64}$/.test(body.requestId || '')) fail(400, 'Enter a message of at most 2000 characters')
  const target = selection(body.context), text = body.text.trim(), requestHash = createHash('sha256').update(JSON.stringify({ text, target })).digest('hex')
  let c: any = await Conversation.findOne(identity(ownerId, organizationId)).lean()
  const previous = c?.turns.find((t: any) => t.id === body.requestId)
  if (previous) { if (previous.requestHash !== requestHash) fail(409, 'Request id has another meaning'); return getCompanyAssistant(ownerId, organizationId) }
  if (c && ['queued', 'working'].includes(c.state)) fail(409, 'Wait for the previous answer')
  if (body.chatRevision !== (c?.revision || 0)) fail(409, 'Conversation changed; reload')
  if ((c?.turns.length || 0) >= 200) fail(409, 'Conversation has reached 200 messages')
  const agent: any = await available(ownerId); if (!agent) fail(409, 'AI is unavailable; retry later')
  if (target.invoiceId) await getCompanyInvoice(organizationId, target.invoiceId)
  if (target.paymentId) await getCompanyCalendarEntry(organizationId, target.paymentId)
  const scope = scopeOf(ownerId, organizationId)
  const context = { mode: 'workspace', scope, page: target.page, pageName: target.page === 'invoices' ? 'Invoices' : 'Payment calendar', facts: { company: selectedCompany, selection: target },
    capabilities: ['Act as a Japanese accountant and answer naturally in Korean or Japanese.', 'Read only this company invoice/calendar facts with the supplied tools. State sources and uncertainties.', 'INV document numbers and printed issuer T numbers have different meanings. Printed T is not fresh NTA verification.', 'Saved sent/paid status is not proof of email delivery, bank settlement or a current bank balance.', 'Invoice and calendar linkage is not established. No create/edit/send/post/settle/restore or legacy card/reference tools are available in this company conversation.'],
    messages: (c?.turns || []).slice(-8).map((t: any) => ({ text: t.text, response: t.proposal?.summary || '', submittedAt: t.at || null, replyRecordedAt: t.answeredAt || null })) }
  if (!c) { try { c = (await Conversation.create({ ownerId, organizationId })).toObject() } catch (e: any) { if (e.code === 11000) fail(409, 'Conversation changed; reload'); throw e } }
  await companyMembership(ownerId, String(organizationId))
  const changed = await Conversation.updateOne({ ...identity(ownerId, organizationId), _id: c._id, revision: body.chatRevision, state: { $nin: ['queued', 'working'] } }, { $set: { state: 'queued', currentId: body.requestId, context, agentId: agent._id, attempts: 0 }, $inc: { revision: 1 }, $unset: { lease: '', leaseUntil: '' }, $push: { turns: { id: body.requestId, text, at: new Date(), scope, target, requestHash } } })
  if (!changed.matchedCount) fail(409, 'Conversation changed; reload')
  return getCompanyAssistant(ownerId, organizationId)
}
async function assertCompanyJob(agent: any, c: any) {
  const turn = c?.turns?.find((t: any) => t.id === c.currentId), expected = scopeOf(c?.ownerId, c?.organizationId)
  if (!c || String(c.ownerId) !== String(agent.ownerId) || c.organizationId?._bsontype !== 'ObjectId' || !turn || [turn.scope, c.context?.scope].some(s => !s || s.actorId !== expected.actorId || s.organizationId !== expected.organizationId)) fail(409, 'Company conversation scope changed')
  await companyMembership(String(c.ownerId), String(c.organizationId))
  return c.organizationId
}
export async function retryCompanyAssistant(ownerId: string, organizationId: any, body: any) {
  await init(); await company(ownerId, organizationId)
  if (!Number.isSafeInteger(body?.chatRevision)) fail(400, 'Invalid conversation revision')
  const agent: any = await available(ownerId); if (!agent) fail(409, 'AI is unavailable')
  const c: any = await Conversation.findOne({ ...identity(ownerId, organizationId), state: 'failed', revision: body.chatRevision }).lean()
  if (!c) fail(409, 'Conversation changed; reload')
  await assertCompanyJob(agent, c)
  const changed = await Conversation.updateOne({ _id: c._id, ownerId, organizationId, state: 'failed', revision: body.chatRevision }, { $set: { state: 'queued', agentId: agent._id, attempts: 0 }, $inc: { revision: 1 }, $unset: { lease: '', leaseUntil: '' } })
  if (!changed.matchedCount) fail(409, 'Conversation changed; reload')
  return getCompanyAssistant(ownerId, organizationId)
}
export async function claimCompanyAssistant(agent: any) {
  await init(); if (!agent.workspaceEnabled) return { job: null }
  const allowed = await Organization.find({ 'members.userId': agent.ownerId, isActive: true }).select('_id').lean(), organizationIds = allowed.map(o => o._id)
  await Conversation.updateMany({ ownerId: agent.ownerId, agentId: agent._id, state: { $in: ['queued', 'working'] }, $or: [{ organizationId: { $nin: organizationIds } }, { state: 'working', leaseUntil: { $lte: new Date() }, attempts: { $gte: 2 } }] }, { $set: { state: 'failed' }, $inc: { revision: 1 }, $unset: { lease: '', leaseUntil: '' } })
  const lease = randomUUID(), c: any = await Conversation.findOneAndUpdate({ ownerId: agent.ownerId, organizationId: { $in: organizationIds }, agentId: agent._id, $or: [{ state: 'queued' }, { state: 'working', leaseUntil: { $lte: new Date() }, attempts: { $lt: 2 } }] }, { $set: { state: 'working', lease, leaseUntil: new Date(Date.now() + 120000) }, $inc: { attempts: 1, revision: 1 } }, { new: true, sort: { createdAt: 1 } }).lean()
  if (!c) return { job: null }
  try { await assertCompanyJob(agent, c) } catch (e) { await Conversation.updateOne({ _id: c._id, lease }, { $set: { state: 'failed' }, $inc: { revision: 1 }, $unset: { lease: '', leaseUntil: '' } }); throw e }
  const turn = c.turns.find((t: any) => t.id === c.currentId)
  return { job: { id: String(c._id), mode: 'workspace', companyScoped: true, lease, text: turn.text, context: c.context, tools: companyTools, actions: [], nextSlot: 1, target: turn.target } }
}
const jobFilter = (agent: any, chatId: string, lease: string) => ({ _id: id(chatId), ownerId: agent.ownerId, agentId: agent._id, state: 'working', lease, leaseUntil: { $gt: new Date() } })
export async function isCompanyAssistantJob(agent: any, chatId: string) { return !!await Conversation.exists({ _id: id(chatId), ownerId: agent.ownerId }) }
async function working(agent: any, chatId: string, lease: string) {
  if (!agent.workspaceEnabled || typeof lease !== 'string' || !lease) fail(409, 'Company conversation job changed')
  const c: any = await Conversation.findOne(jobFilter(agent, chatId, lease)).lean()
  if (!c) fail(409, 'Company conversation job changed')
  await assertCompanyJob(agent, c); return c
}
export async function renewCompanyAssistant(agent: any, job: any) {
  const c = await working(agent, job.id, job.lease)
  const changed = await Conversation.updateOne(jobFilter(agent, job.id, job.lease), { $max: { leaseUntil: new Date(Date.now() + 120000) } })
  if (!changed.matchedCount) fail(409, 'Company conversation job changed')
  return !!c
}
export async function finishCompanyAssistant(agent: any, chatId: string, body: any) {
  const c = await working(agent, chatId, body?.lease)
  let proposal: any
  if (body.failed !== true) { try { proposal = validateAssistantReply(body.proposal) } catch { fail(400, 'Invalid company assistant reply') } }
  const changed = await Conversation.updateOne(jobFilter(agent, chatId, body.lease), { $set: { state: proposal ? 'ready' : 'failed', 'turns.$[turn].answeredAt': new Date(), ...(proposal ? { 'turns.$[turn].proposal': proposal } : {}) }, $inc: { revision: 1 }, $unset: { lease: '', leaseUntil: '' } }, { arrayFilters: [{ 'turn.id': c.currentId }] })
  if (!changed.matchedCount) fail(409, 'Company conversation job changed')
  return { success: true }
}
const objectId = { type: 'string', pattern: '^[a-fA-F0-9]{24}$' }, textFilter = { type: 'string', maxLength: 100 }
const tool = (name: string, description: string, properties: any, required: string[] = []) => ({ name, description, inputSchema: { type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) } })
const companyTools = [
  tool('list_company_invoices', 'Read this company saved invoices with actual currency, totals and pagination. Saved status is not bank settlement; INV is not a T number.', { status: textFilter, page: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }),
  tool('get_company_invoice', 'Read a saved company invoice by id, including printed issuer T and item details. No fresh NTA verification, email delivery or calendar link is implied.', { invoiceId: objectId }, ['invoiceId']),
  tool('list_company_calendar_entries', 'Read this company visible calendar entries, preserving sourced/adopted bill facts and currency. At most100 entries; suppressed bills stay hidden. Not live bank balances or verified settlement.', { type: textFilter, status: textFilter, category: textFilter, startDate: { type: 'string', format: 'date' }, endDate: { type: 'string', format: 'date' } }),
  tool('get_company_calendar_entry', 'Read one visible saved calendar entry and source/adoption facts. Saved paid status is not bank confirmation.', { paymentId: objectId }, ['paymentId'])
]
const invoiceView = (v: any) => ({ id: String(v._id), invoiceNumber: v.invoiceNumber, status: v.status, issueDate: v.issueDate, dueDate: v.dueDate, paidDate: v.paidDate || null, from: { name: v.from?.name, taxId: v.from?.taxId || '' }, to: { name: v.to?.name }, subtotal: v.subtotal, taxRate: v.taxRate, taxAmount: v.taxAmount, total: v.total, currency: v.currency, items: (v.items || []).slice(0, 50), itemsTruncated: (v.items?.length || 0) > 50, updatedAt: v.updatedAt || null })
const paymentView = (v: any) => ({ id: String(v._id), title: v.title, amount: v.amount, currency: v.currency, dueDate: v.dueDate, type: v.type, status: v.status, category: v.category, settledAt: v.settledAt || null, source: v.source ? { kind: v.source.kind, provider: v.source.provider, periodKey: v.source.periodKey, statementMonth: v.source.statementMonth, adopted: v.source.adopted === true, dueDateEvidence: v.source.dueDateEvidence, importId: v.source.importId ? String(v.source.importId) : null, noticeId: v.source.noticeId ? String(v.source.noticeId) : null } : null, updatedAt: v.updatedAt || null })
export async function actionCompanyAssistant(agent: any, chatId: string, body: any) {
  const c = await working(agent, chatId, body?.lease), organizationId = c.organizationId
  const definition = companyTools.find(t => t.name === body?.name), args = body?.args === undefined ? {} : body.args
  if (!definition || !args || typeof args !== 'object' || Array.isArray(args)) fail(400, 'Unknown company read tool or arguments')
  const schema: any = definition.inputSchema
  if (Object.keys(args).some(k => !Object.hasOwn(schema.properties, k)) || (schema.required || []).some((k: string) => args[k] === undefined)) fail(400, 'Invalid company read arguments')
  for (const [key, value] of Object.entries(args)) {
    const rule = schema.properties[key]
    if (rule.type === 'integer' ? !Number.isSafeInteger(value) || Number(value) < rule.minimum || (rule.maximum && Number(value) > rule.maximum) : typeof value !== 'string' || (rule.maxLength && value.length > rule.maxLength) || (rule.pattern && !new RegExp(rule.pattern).test(value)) || (rule.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value))) fail(400, 'Invalid company read argument')
  }
  let result: any
  if (body.name === 'list_company_invoices') { const v = await listCompanyInvoices(organizationId, args); result = { invoices: v.invoices.map(invoiceView), pagination: v.pagination, truncated: v.pagination.page < v.pagination.totalPages } }
  if (body.name === 'get_company_invoice') result = { invoice: invoiceView((await getCompanyInvoice(organizationId, args.invoiceId)).invoice) }
  if (body.name === 'list_company_calendar_entries') { const rows = await listCompanyCalendarEntries(organizationId, args, 101); result = { entries: rows.slice(0, 100).map(paymentView), truncated: rows.length > 100, limit: 100 } }
  if (body.name === 'get_company_calendar_entry') result = { entry: paymentView(await getCompanyCalendarEntry(organizationId, args.paymentId)) }
  await working(agent, chatId, body.lease)
  return { name: body.name, effect: 'read', result: { ...result, scope: scopeOf(c.ownerId, organizationId), readAt: new Date(), source: 'saved-company-records', calendarInvoiceLink: 'not_established', liveBankBalance: 'unavailable', settlement: 'saved_status_only', tNumber: 'printed_issuer_data_not_fresh_NTA_verification' } }
}
