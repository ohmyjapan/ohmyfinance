import { getCompanyNaviTransaction, listCompanyNaviTransactions, companyTransactionChoices, companyTransactionPatterns } from './companyTransactionAssistantService'
import { companyActionReceipt, companyActionReceipts, reconcileCompanyActions, updateCompanyCalendarAction, updateCompanyInvoiceAction, updateCompanyTransactionAction, companyKnowledgeAction, companyKnowledgeActions } from './financeCompanyActionService'
import { listCompanyKnowledge, relevantCompanyKnowledge } from './companyKnowledgeService'
import { startNewCompanyConversation, listCompanyConversationArchives, getCompanyConversationArchive } from './companyConversationHistoryService'
import { validateCompanyAssistantReply, findNaviFeatures, naviFeature } from '../../shared/finance-navi-features.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { FinanceCompanyAssistant as Conversation } from '../models/FinanceCompanyAssistant'
import { FinanceChatAgent as Agent } from '../models/FinanceChat'
import Organization from '../models/Organization'
import { companyMembership } from '../utils/calendarAccess'
import { ready, fail, id } from './financeService'
import { listCompanyInvoices, getCompanyInvoice, listCompanyCalendarEntries, getCompanyCalendarEntry } from './companyFinanceReadService'

const init = async () => { await ready(); await Conversation.init() }
const available = (ownerId: string) => Agent.findOne({ ownerId, enabled: true, revokedAt: null, workspaceEnabled: true, chatLastSeenAt: { $gt: new Date(Date.now() - 65000) } }).sort({ chatLastSeenAt: -1 }).lean()
const scopeOf = (ownerId: any, organizationId: any) => ({ actorId: String(ownerId), organizationId: String(organizationId) })
const turnLimit = 200
const visible = (c: any) => c ? { id: String(c._id), scope: scopeOf(c.ownerId, c.organizationId), revision: c.revision, state: c.state, currentId: c.currentId, segment: c.segment || 0, turnLimit, turns: c.turns.map((t: any) => ({ ...t, ...(t.actions ? { actions: t.actions.map(companyActionReceipt) } : {}) })) } : null
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
  return { company: selected, conversation: visible(await reconcileCompanyActions(c)), connected: !!await available(ownerId) }
}
function selection(input: any) {
  if (!input || !['invoices', 'calendar', 'transactions'].includes(input.page)) fail(400, 'Choose invoices, calendar or transactions')
  const selected: any = { page: input.page }
  if (input.invoiceId !== undefined) { if (input.page !== 'invoices') fail(400, 'Choose an invoice'); selected.invoiceId = id(input.invoiceId) }
  if (input.paymentId !== undefined) { if (input.page !== 'calendar') fail(400, 'Choose a calendar entry'); selected.paymentId = id(input.paymentId) }
  if (input.transactionId !== undefined) { if (input.page !== 'transactions') fail(400, 'Choose a transaction'); selected.transactionId = id(input.transactionId) }
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
  if ((c?.turns.length || 0) >= turnLimit) fail(409, 'この会話は200件に達しました。「新しい会話」で続けてください。これまでの会話と保存の記録は履歴に残ります。')
  const agent: any = await available(ownerId); if (!agent) fail(409, 'AI is unavailable; retry later')
  if (target.transactionId) await getCompanyNaviTransaction(organizationId, target.transactionId)
  if (target.invoiceId) await getCompanyInvoice(organizationId, target.invoiceId)
  if (target.paymentId) await getCompanyCalendarEntry(organizationId, target.paymentId)
  const scope = scopeOf(ownerId, organizationId)
  const feature: any = naviFeature(target.page)
  const context = { mode: 'workspace', companyScoped: true, scope, page: target.page, pageName: target.page === 'invoices' ? 'Invoices' : target.page === 'transactions' ? 'Transactions' : 'Payment calendar', facts: { company: selectedCompany, selection: target, feature: feature ? { id: feature.id, label: feature.label, disposition: feature.disposition, reason: feature.reason } : null },
    capabilities: ['Act as a Japanese accountant and answer naturally in Korean or Japanese.', 'Use this company transaction/invoice/calendar tools. Read before a requested edit, update only explicitly named transaction/invoice/calendar fields and verify its receipt. State sources and uncertainties.', 'INV document numbers and printed issuer T numbers have different meanings. Printed T is not fresh NTA verification.', 'Saved sent/paid status is not proof of email delivery, bank settlement or a current bank balance.', 'Invoice and calendar linkage is not established. Calendar edits save internal records only, never move money or change issuer due dates. Invoice edits save internal records only, never send invoices or confirm settlement. Transaction edits use existing record references and preserve imported card source values. No ledger reposting, global party search or receipt/NTA verification is implied. Creation, send/post/restore and legacy card/reference tools remain unavailable.', 'Company teachings: search, remember (only the exact words of the current message when the user asks to remember), correct with the expected revision, or pause. A teaching is evidence for later answers, never an automatic ledger change. Pattern recall compares this company history by merchant; history is evidence, not legal truth.', 'Feature guide: list_navi_features names every OMF page group as a Navi tool, a page the user opens, or unsupported with a reason; a reply may carry one catalogue page link.'],
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
// User-controlled new chat, archived history and teaching inspection. Each call rechecks live membership of the session company.
export async function newCompanyConversation(ownerId: string, organizationId: any, body: any) {
  await init(); await company(ownerId, organizationId)
  await startNewCompanyConversation(ownerId, organizationId, body)
  return getCompanyAssistant(ownerId, organizationId)
}
export async function companyConversationHistory(ownerId: string, organizationId: any, query: any) { await init(); await company(ownerId, organizationId); return listCompanyConversationArchives(ownerId, organizationId, query) }
export async function companyConversationArchive(ownerId: string, organizationId: any, archiveId: string) { await init(); await company(ownerId, organizationId); return getCompanyConversationArchive(ownerId, organizationId, archiveId) }
export async function companyKnowledgeInspection(ownerId: string, organizationId: any, query: any) {
  await init(); const selected = await company(ownerId, organizationId)
  const status = ['active', 'paused', 'all'].includes(query?.status) ? query.status : 'all'
  return { company: selected, ...await listCompanyKnowledge(organizationId, { status, page: query?.page, query: typeof query?.query === 'string' ? query.query.slice(0, 100) : undefined }) }
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
  const actions = await companyActionReceipts(c, c.currentId)
  // Confirmed teachings of this frozen company only, read fresh at claim (a pause or correction since the message applies now).
  let related: string[] = []
  if (turn.target?.transactionId) { try { const v: any = await getCompanyNaviTransaction(c.organizationId, turn.target.transactionId); related = [v.productName, v.companyInfo].filter(Boolean) } catch {} }
  const recall = await relevantCompanyKnowledge(c.organizationId, turn.text, related)
  return { job: { id: String(c._id), mode: 'workspace', companyScoped: true, lease, text: turn.text, context: c.context, tools: companyTools, actions, nextSlot: actions.reduce((n: number, a: any) => Math.max(n, a.slot), 0) + 1, target: turn.target, knowledge: recall.items, knowledgeActiveTotal: recall.activeTotal } }
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
// A reply's record pointer must name a record of the frozen company, checked now rather than trusted from the model.
const recordPointer = async (organizationId: any, navigation: any) => { if (!navigation?.transactionId) return true; try { await getCompanyNaviTransaction(organizationId, navigation.transactionId); return true } catch { return false } }
export async function finishCompanyAssistant(agent: any, chatId: string, body: any) {
  const c = await working(agent, chatId, body?.lease)
  let proposal: any
  if (body.failed !== true) { try { proposal = validateCompanyAssistantReply(body.proposal) } catch { fail(400, 'Invalid company assistant reply') } }
  if (proposal && !await recordPointer(c.organizationId, proposal.navigation)) fail(400, 'Invalid company assistant reply')
  const changed = await Conversation.updateOne(jobFilter(agent, chatId, body.lease), { $set: { state: proposal ? 'ready' : 'failed', 'turns.$[turn].answeredAt': new Date(), ...(proposal ? { 'turns.$[turn].proposal': proposal } : {}) }, $inc: { revision: 1 }, $unset: { lease: '', leaseUntil: '' } }, { arrayFilters: [{ 'turn.id': c.currentId }] })
  if (!changed.matchedCount) fail(409, 'Company conversation job changed')
  return { success: true }
}
const objectId = { type: 'string', pattern: '^[a-fA-F0-9]{24}$' }, textFilter = { type: 'string', maxLength: 100 }
const tool = (name: string, description: string, properties: any, required: string[] = []) => ({ name, description, inputSchema: { type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) } })
const companyTools = [
  tool('list_company_transactions', 'Read saved company transactions and accounting references, preserving original amounts and source protection. Follow hasMore with the next page; no bank/receipt/NTA verification or currency assumption.', { page: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 50 }, search: textFilter, status: textFilter, type: textFilter, dateFrom: { type: 'string', format: 'date' }, dateTo: { type: 'string', format: 'date' }, minAmount: { type: 'number' }, maxAmount: { type: 'number' }, customerId: objectId, supplierId: objectId, accountCategoryId: objectId, transactionCategoryId: objectId }),
  tool('get_company_transaction', 'Read a company transaction, its saved accounting references, notes and protected credit-card accounting. Missing currency stays unknown. Printed T and hasReceipt are unverified saved data.', { transactionId: objectId }, ['transactionId']),
  tool('list_company_transaction_choices', 'Read actual reference ids/names observed in this company transaction history, not all global parties. Use them for requested accounting edits; never invent ids or assign motives from a name. This bounded history view excludes new unused references and reports truncation.', {}),
  tool('update_company_transaction', 'Save only explicitly requested transaction fields after a fresh read. Use exact updatedAt, empty string only for null. Resolve reference ids with company history choices; empty reference string explicitly clears it. Imported card source amount/type/payment/card and credit accounting remain protected. No repost, learning, bank/receipt/T verification.', { transactionId: objectId, expectedUpdatedAt: { type: 'string', maxLength: 40 }, notes: { type: 'string', maxLength: 2000 }, productName: { type: 'string', maxLength: 500 }, companyInfo: { type: 'string', maxLength: 500 }, invoiceNumber: { type: 'string', maxLength: 100 }, receiptNumber: { type: 'string', maxLength: 100 }, trackingNumber: { type: 'string', maxLength: 100 }, janCode: { type: 'string', maxLength: 100 }, paymentMethod: { type: 'string', maxLength: 100 }, cardNumber: { type: 'string', maxLength: 4 }, referenceNumber: { type: 'string', maxLength: 100 }, date: { type: 'string', format: 'date' }, status: { type: 'string', enum: ['completed','pending','processing','failed','cancelled'] }, type: { type: 'string', enum: ["\u652f\u51fa", "\u5165\u91d1"] }, amount: { type: 'number' }, productPrice: { type: 'number' }, taxRate: { type: 'number', minimum: 0, maximum: 100 }, ...Object.fromEntries(['customerId','supplierId','accountCategoryId','subAccountCategoryId','taxCategoryId','transactionCategoryId'].map(k => [k, { type: 'string', pattern: '^([a-fA-F0-9]{24})?$' }])) }, ['transactionId','expectedUpdatedAt']),
  tool('update_company_invoice', 'Save explicitly requested scalar invoice fields after reading it. Supply the exact updatedAt, empty string only for a null timestamp. Tax-rate changes recalculate existing item totals; zero is valid. No items/party/bank edits, create/delete/send or bank confirmation. Exact same-turn intent returns its original receipt.', { invoiceId: objectId, expectedUpdatedAt: { type: 'string', maxLength: 40 }, status: { type: 'string', enum: ['draft','sent','paid','overdue','cancelled'] }, issueDate: { type: 'string', format: 'date' }, dueDate: { type: 'string', format: 'date' }, paidDate: { type: 'string', format: 'date' }, taxRate: { type: 'number', minimum: 0, maximum: 100 }, currency: { type: 'string', minLength: 1, maxLength: 10 }, notes: { type: 'string', maxLength: 2000 }, terms: { type: 'string', maxLength: 2000 } }, ['invoiceId','expectedUpdatedAt']),
  tool('update_company_calendar_entry', 'Save only explicitly requested calendar fields after reading this company entry. Supply its exact updatedAt; empty string only when the read returned null. A saved paid/completed status is internal bookkeeping, not bank confirmation. Repeated exact intent in one turn returns its original receipt. No create/delete/send or money movement.', { paymentId: objectId, expectedUpdatedAt: { type: 'string', maxLength: 40 }, title: { type: 'string', minLength: 1, maxLength: 300 }, amount: { type: 'number' }, currency: { type: 'string', enum: ['JPY','USD','EUR','GBP','KRW','CNY'] }, dueDate: { type: 'string', format: 'date' }, type: { type: 'string', enum: ['expense','income'] }, status: { type: 'string', enum: ['pending','paid','overdue','cancelled','completed'] }, category: { type: 'string', minLength: 1, maxLength: 100 }, recurring: { type: 'boolean' }, recurringFrequency: { type: 'string', enum: ['weekly','monthly','quarterly','yearly'] }, notes: { type: 'string', maxLength: 2000 } }, ['paymentId','expectedUpdatedAt']),
  tool('get_company_action_status', 'Read this turn company action receipts and reconcile a lost result from its native record marker. Unknown is not failure and must never be repeated automatically.', { operationId: { type: 'string', pattern: '^[a-f0-9]{32}$' } }),
  tool('list_company_invoices', 'Read this company saved invoices with actual currency, totals and pagination. Saved status is not bank settlement; INV is not a T number.', { status: textFilter, page: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }),
  tool('get_company_invoice', 'Read a saved company invoice by id, including printed issuer T and item details. No fresh NTA verification, email delivery or calendar link is implied.', { invoiceId: objectId }, ['invoiceId']),
  tool('list_company_calendar_entries', 'Read this company visible calendar entries, preserving sourced/adopted bill facts and currency. At most100 entries; suppressed bills stay hidden. Not live bank balances or verified settlement.', { type: textFilter, status: textFilter, category: textFilter, startDate: { type: 'string', format: 'date' }, endDate: { type: 'string', format: 'date' } }),
  tool('get_company_calendar_entry', 'Read one visible saved calendar entry and source/adoption facts. Saved paid status is not bank confirmation.', { paymentId: objectId }, ['paymentId']),
  tool('find_company_transaction_patterns', 'Compare how this company classified one merchant before: literal merchant text, counts per classification, dated examples of consistent and conflicting choices, exact protected card credit account/subaccount names and the saved receipt-flag meaning. History is evidence, not legal or tax truth; not_recorded_in_OMF never means no receipt exists.', { merchant: { type: 'string', minLength: 1, maxLength: 100 }, cardLast4: { type: 'string', pattern: '^[0-9]{4}$' }, dateFrom: { type: 'string', format: 'date' }, dateTo: { type: 'string', format: 'date' }, exampleLimit: { type: 'integer', minimum: 1, maximum: 20 } }, ['merchant']),
  tool('search_company_knowledge', 'Read teachings members of this company explicitly asked Navi to remember, with who/when/which conversation turn and correction history. Default active only; status paused or all is for inspection. Paused or replaced wording must not guide answers.', { query: textFilter, merchant: textFilter, status: { type: 'string', enum: ['active', 'paused', 'all'] }, page: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }),
  tool('remember_company_knowledge', 'Only when the CURRENT message asks to remember something: save the user\'s exact words (instruction must be a verbatim substring of the current message, never your wording) with optional merchant/card/effective-date conditions and suggested references observed in company history. Saving never edits or posts any record. Discussion or a hypothesis is not a teaching.', { instruction: { type: 'string', minLength: 2, maxLength: 1000 }, merchant: { type: 'string', minLength: 1, maxLength: 100 }, cardLast4: { type: 'string', pattern: '^[0-9]{4}$' }, effectiveFrom: { type: 'string', format: 'date' }, transactionId: objectId, ...Object.fromEntries(['accountCategoryId', 'subAccountCategoryId', 'taxCategoryId', 'transactionCategoryId', 'customerId', 'supplierId'].map(k => [k, objectId])) }, ['instruction']),
  tool('correct_company_knowledge', 'On an explicit correction in the CURRENT message: replace parts of one teaching using its current revision. New instruction wording must be a verbatim substring of the current message. Empty merchant/cardLast4/reference clears it. The previous wording stays in the audit history. Never edits ledger records.', { knowledgeId: objectId, expectedRevision: { type: 'integer', minimum: 1 }, instruction: { type: 'string', minLength: 2, maxLength: 1000 }, merchant: { type: 'string', maxLength: 100 }, cardLast4: { type: 'string', pattern: '^([0-9]{4})?$' }, effectiveFrom: { type: 'string', format: 'date' }, ...Object.fromEntries(['accountCategoryId', 'subAccountCategoryId', 'taxCategoryId', 'transactionCategoryId', 'customerId', 'supplierId'].map(k => [k, { type: 'string', pattern: '^([a-fA-F0-9]{24})?$' }])) }, ['knowledgeId', 'expectedRevision']),
  tool('set_company_knowledge_status', 'On an explicit request in the CURRENT message: pause a teaching so it stops guiding answers, or make a paused one active again, using its current revision.', { knowledgeId: objectId, expectedRevision: { type: 'integer', minimum: 1 }, status: { type: 'string', enum: ['active', 'paused'] } }, ['knowledgeId', 'expectedRevision', 'status']),
  tool('list_navi_features', 'Read the OMF feature guide: every page group with its local page, whether Navi has tools for it, the user opens the page, or it is unsupported and why. Use it to explain where and how to do something; a reply may link one listed page.', { query: textFilter })
]
const featureView = (f: any) => ({ id: f.id, group: f.group, label: f.label, labelKo: f.labelKo, route: f.route, disposition: f.disposition, reason: f.reason, tools: f.tools || [], recordPage: f.recordRoute ? 'transaction detail by id' : null, sensitive: f.sensitive === true, source: f.source })
const invoiceView = (v: any) => ({ id: String(v._id), invoiceNumber: v.invoiceNumber, status: v.status, issueDate: v.issueDate, dueDate: v.dueDate, paidDate: v.paidDate || null, notes: String(v.notes || '').slice(0,2000), notesTruncated: String(v.notes || '').length > 2000, terms: String(v.terms || '').slice(0,2000), termsTruncated: String(v.terms || '').length > 2000, from: { name: v.from?.name, taxId: v.from?.taxId || '' }, to: { name: v.to?.name }, subtotal: v.subtotal, taxRate: v.taxRate, taxAmount: v.taxAmount, total: v.total, currency: v.currency, items: (v.items || []).slice(0, 50), itemsTruncated: (v.items?.length || 0) > 50, updatedAt: v.updatedAt || null })
const paymentView = (v: any) => ({ id: String(v._id), title: v.title, notes: String(v.notes || '').slice(0, 2000), notesTruncated: String(v.notes || '').length > 2000, amount: v.amount, currency: v.currency, dueDate: v.dueDate, type: v.type, status: v.status, category: v.category, settledAt: v.settledAt || null, source: v.source ? { kind: v.source.kind, provider: v.source.provider, periodKey: v.source.periodKey, statementMonth: v.source.statementMonth, adopted: v.source.adopted === true, dueDateEvidence: v.source.dueDateEvidence, importId: v.source.importId ? String(v.source.importId) : null, noticeId: v.source.noticeId ? String(v.source.noticeId) : null } : null, updatedAt: v.updatedAt || null })
export async function actionCompanyAssistant(agent: any, chatId: string, body: any) {
  const c = await working(agent, chatId, body?.lease), organizationId = c.organizationId
  const definition = companyTools.find(t => t.name === body?.name), args = body?.args === undefined ? {} : body.args
  if (!definition || !args || typeof args !== 'object' || Array.isArray(args)) fail(400, 'Unknown company read tool or arguments')
  const schema: any = definition.inputSchema
  if (Object.keys(args).some(k => !Object.hasOwn(schema.properties, k)) || (schema.required || []).some((k: string) => args[k] === undefined)) fail(400, 'Invalid company read arguments')
  for (const [key, value] of Object.entries(args)) {
    const rule = schema.properties[key]
    if (rule.type === 'number' ? typeof value !== 'number' || !Number.isFinite(value) || (rule.minimum !== undefined && value < rule.minimum) || (rule.maximum !== undefined && value > rule.maximum) : rule.type === 'boolean' ? typeof value !== 'boolean' : rule.type === 'integer' ? !Number.isSafeInteger(value) || Number(value) < rule.minimum || (rule.maximum && Number(value) > rule.maximum) : typeof value !== 'string' || (rule.minLength && value.length < rule.minLength) || (rule.maxLength && value.length > rule.maxLength) || (rule.enum && !rule.enum.includes(value)) || (rule.pattern && !new RegExp(rule.pattern).test(value)) || (rule.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value))) fail(400, 'Invalid company read argument')
  }
  if (body.name === 'update_company_transaction') return updateCompanyTransactionAction(c, body, args, () => working(agent, chatId, body.lease))
  if (body.name === 'update_company_invoice') return updateCompanyInvoiceAction(c, body, args, () => working(agent, chatId, body.lease))
  if (body.name === 'update_company_calendar_entry') return updateCompanyCalendarAction(c, body, args, () => working(agent, chatId, body.lease))
  if (companyKnowledgeActions.includes(body.name)) return companyKnowledgeAction(c, body, args, () => working(agent, chatId, body.lease))
  if (body.name === 'get_company_action_status') { const receipts = await companyActionReceipts(c, c.currentId, args.operationId); await working(agent, chatId, body.lease); return { name: body.name, effect: 'read', result: { receipts, scope: scopeOf(c.ownerId, organizationId) } } }
  let result: any
  if (body.name === 'list_company_transactions') result = await listCompanyNaviTransactions(organizationId, args)
  if (body.name === 'get_company_transaction') result = { transaction: await getCompanyNaviTransaction(organizationId, args.transactionId) }
  if (body.name === 'list_company_transaction_choices') result = await companyTransactionChoices(organizationId)
  if (body.name === 'list_company_invoices') { const v = await listCompanyInvoices(organizationId, args); result = { invoices: v.invoices.map(invoiceView), pagination: v.pagination, truncated: v.pagination.page < v.pagination.totalPages } }
  if (body.name === 'get_company_invoice') result = { invoice: invoiceView((await getCompanyInvoice(organizationId, args.invoiceId)).invoice) }
  if (body.name === 'list_company_calendar_entries') { const rows = await listCompanyCalendarEntries(organizationId, args, 101); result = { entries: rows.slice(0, 100).map(paymentView), truncated: rows.length > 100, limit: 100 } }
  if (body.name === 'get_company_calendar_entry') result = { entry: paymentView(await getCompanyCalendarEntry(organizationId, args.paymentId)) }
  if (body.name === 'find_company_transaction_patterns') result = await companyTransactionPatterns(organizationId, args)
  if (body.name === 'search_company_knowledge') result = await listCompanyKnowledge(organizationId, args)
  if (body.name === 'list_navi_features') result = { features: findNaviFeatures(args.query).map(featureView), dispositions: { navi_tool: 'Navi has named tools here', page_handoff: 'the page provides it; Navi can link the page', unsupported: 'Navi never links or acts here' } }
  await working(agent, chatId, body.lease)
  return { name: body.name, effect: 'read', result: { ...result, scope: scopeOf(c.ownerId, organizationId), readAt: new Date(), source: 'saved-company-records', calendarInvoiceLink: 'not_established', liveBankBalance: 'unavailable', settlement: 'saved_status_only', tNumber: 'printed_issuer_data_not_fresh_NTA_verification' } }
}
