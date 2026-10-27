// Company Navi business adapters: each finite named tool runs exactly one registered native operation (the same service the page
// uses, with its whitelist and Mongoose validation) for the frozen company of the claimed job. There is no generic endpoint, query,
// collection or URL. The journal (financeCompanyActionService) claims the slot/intent first; this module performs the native effect,
// writes the durable marker in that same native write where the operation allows it, and later proves (or cannot prove) the outcome.
import mongoose from 'mongoose'
import { createHash } from 'node:crypto'
import { createError } from 'h3'
import Transaction from '../models/Transaction'
import Invoice from '../models/Invoice'
import Budget from '../models/Budget'
import RecurringPayment from '../models/RecurringPayment'
import { Payment } from '../models/Payment'
import Receipt from '../models/Receipt'
import { matchReceiptWithTransaction, unmatchReceipt } from './receiptService'
import { createCompanyTransaction, deleteTransaction, transactionReferenceModels, referenceScope } from './transactionService'
import { createCompanyInvoice, deleteCompanyInvoice, invoiceWriteError } from './companyInvoiceWriteService'
import { createCompanyCalendarEntry, deleteCompanyCalendarEntry } from './companyPaymentWriteService'
import { listCompanyBudgets, getCompanyBudget, createCompanyBudget, updateCompanyBudget, deleteCompanyBudget } from './companyBudgetService'
import { getRecurringPayments, getRecurringPaymentById, createRecurringPayment, updateRecurringPayment, deleteRecurringPayment, generateTransaction } from './recurringPaymentService'
import { getCompanyNaviTransaction, transactionNaviView } from './companyTransactionAssistantService'
import { companyProfile, companyFinanceSummary, listCompanyReceipts, getCompanyReceipt, findCompanyReceiptMatches } from './companyNaviSummaryService'
import { readInvoiceCalendar, scheduleInvoicePayment, invoicePaymentId, invoiceLinkSummary } from './companyInvoiceCalendarService'
import { exportTransactionRows } from './transactionExportService'
import { businessToolMeta, businessFields } from '../../shared/finance-navi-business.mjs'
import { exportCriteriaKeys } from '../../shared/finance-transaction-export.mjs'

const bad = (statusCode: number, statusMessage: string): never => { throw createError({ statusCode, statusMessage }) }
// The C2 schedule services require a trusted company of this process's own ObjectId class (instanceof); the frozen job holds the
// same id as a driver value, so it is re-created from its hex form (never from any argument).
const companyOf = (c: any) => new mongoose.Types.ObjectId(String(c.organizationId))
const pick = (args: any, keys: string[]) => Object.fromEntries(keys.filter(k => args[k] !== undefined).map(k => [k, args[k]]))
// A created record's id is fixed by the frozen operation, so a lost reply, a retry or a crash can only ever meet the same row.
export const createdId = (operationId: string) => new mongoose.Types.ObjectId(createHash("sha256").update("omf-navi-create|" + operationId).digest('hex').slice(0, 24))
const exactSnapshot = (value: unknown) => { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) bad(400, 'Read the current record and use its exact updatedAt'); return value as string }
const sameMarker = (marker: any, op: any) => marker?.operationId === op.operationId && marker?.payloadHash === op.payloadHash
// A hard delete leaves no row to carry a marker: its lost outcome cannot be proven and stays unresolved (never repeated).
const unprovableDelete = async () => null
const markerOf = async (model: any, organizationId: any, _id: any) => { if (!mongoose.isValidObjectId(_id)) return null; const row: any = await model.findOne({ _id, organizationId }).select('naviOperation').lean(); return row?.naviOperation || null }
const asCreate = async (op: any, organizationId: any, model: any, write: () => Promise<any>) => {
  try { return await write() } catch (error: any) {
    if (error?.code !== 11000) throw error
    // The same frozen id already exists: it is this operation only if it carries this operation's marker.
    if (sameMarker(await markerOf(model, organizationId, op.resourceId), op)) return model.findOne({ _id: op.resourceId, organizationId }).lean()
    throw error
  }
}
const validation = (error: any): never => { if (error?.name === 'ValidationError' || error?.name === 'CastError') bad(400, 'Invalid fields for this record'); throw error }

// ---- Safe projections (no creator/company/marker, contacts, bank text or private metadata)
export const invoiceResultValues = (values: any) => ({ ...Object.fromEntries(Object.entries(values || {}).filter(([k]) => !['bankDetails', 'from', 'to', 'items', 'naviOperation'].includes(k))), ...(values?.from ? { from: { name: values.from.name, taxId: values.from.taxId || '' } } : {}), ...(values?.to ? { to: { name: values.to.name } } : {}), ...(values?.items ? { itemCount: values.items.length } : {}), ...(values?.bankDetails !== undefined ? { bankDetails: values.bankDetails ? 'saved_not_shown' : 'cleared' } : {}) })
const invoiceSummary = (v: any) => ({ id: String(v._id), invoiceNumber: v.invoiceNumber, status: v.status, issueDate: v.issueDate, dueDate: v.dueDate, currency: v.currency, subtotal: v.subtotal, taxRate: v.taxRate, taxAmount: v.taxAmount, total: v.total, from: { name: v.from?.name, taxId: v.from?.taxId || '' }, to: { name: v.to?.name }, itemCount: v.items?.length || 0, hasBankDetails: !!v.bankDetails, transactionId: v.transactionId ? String(v.transactionId) : null, updatedAt: v.updatedAt, delivery: 'not_sent_saved_record_only' })
const entryView = (v: any) => ({ id: String(v._id), title: v.title, amount: v.amount, currency: v.currency, dueDate: v.dueDate, type: v.type, status: v.status, category: v.category, recurring: v.recurring === true, recurringFrequency: v.recurringFrequency || null, notes: v.notes || '', source: v.source ? { kind: v.source.kind, adopted: v.source.adopted === true } : null, invoiceLink: invoiceLinkSummary(v.invoiceLink), updatedAt: v.updatedAt, moneyMovement: 'none_internal_plan_only' })
const budgetView = (v: any) => { if (!v) return v; const { organizationId: _o, createdBy: _c, naviOperation: _m, __v: _v, _id, ...rest } = v; return { ...rest, id: String(_id || v.id) } }
const recurringView = (v: any) => v ? { id: String(v._id || v.id), name: v.name, description: v.description || '', amount: v.amount, currency: v.currency || null, transactionType: v.transactionType || null, frequency: v.frequency, dayOfMonth: v.dayOfMonth ?? null, dayOfWeek: v.dayOfWeek ?? null, startDate: v.startDate, endDate: v.endDate || null, nextDueDate: v.nextDueDate, lastGeneratedDate: v.lastGeneratedDate || null, status: v.status, payeeName: v.customer?.name || '', category: v.category || '', notes: v.notes || '', autoGenerate: v.autoGenerate !== false, generatedCount: (v.generatedTransactionIds || []).length, updatedAt: v.updatedAt } : v
const recurringBody = (args: any) => { const body: any = pick(args, businessFields.recurring.filter(k => k !== 'payeeName')); if (args.status !== undefined) body.status = args.status; if (args.payeeName !== undefined) body.customer = { name: args.payeeName }; return body }
async function assertCurrent(model: any, organizationId: any, id: string, expected: string, missing: string) {
  if (!mongoose.isValidObjectId(id)) bad(404, missing)
  const row: any = await model.findOne({ _id: new mongoose.Types.ObjectId(id), organizationId }).select('updatedAt').lean()
  if (!row) bad(404, missing)
  if (new Date(row.updatedAt).toISOString() !== expected) bad(409, 'The record changed; read it again')
}

type Run = { c: any, args: any, op: any, marker: Record<string, unknown> }
type Adapter = { resource?: (args: any, operationId: string) => string, detail?: (args: any) => any, precheck?: (c: any, args: any) => Promise<void>, run: (x: Run) => Promise<{ resourceIds: Record<string, string>, result: any, pending?: 'system' | 'user' | null }>, recover: (c: any, op: any) => Promise<any> }
const created = (model: any) => async (c: any, op: any) => { const m = await markerOf(model, c.organizationId, op.resourceId); return sameMarker(m, op) ? m : null }
const markedOn = (model: any) => created(model)
const id = (key: string) => (args: any) => String(args[key])
// Preparing an export changes no record: the journal entry (the frozen criteria and format) is the whole outcome, so a lost reply
// settles done from it, provided the frozen range is one the run accepts; an inverted range is the run's own failed receipt.
const exportCriteria = (args: any) => pick(args, [...exportCriteriaKeys])
const exportRangeOk = (criteria: any) => !(criteria.dateFrom && criteria.dateTo && criteria.dateFrom > criteria.dateTo)
const exportRecover = async (_c: any, op: any) => op.detail?.format && op.detail?.criteria && exportRangeOk(op.detail.criteria) ? { operationId: op.operationId, payloadHash: op.payloadHash, appliedAt: op.claimedAt, requestedFields: op.requestedFields, nativeResourceIds: { exportId: String(op.operationId) } } : null
// Saved receipt link/unlink through the same company-scoped writer as the receipt page. The marker is written in the canonical receipt
// write itself. Done only when the marker is on the receipt AND its badge work is complete; a saved link whose badge is still owed is
// reported unresolved (system: automatic recovery; user: named manual review) and later becomes done from that same proof, never by
// running it again.
export const receiptLinkActions = ['link_company_receipt', 'unlink_company_receipt']
const receiptMarker = async (c: any, op: any) => {
  if (!mongoose.isValidObjectId(op.resourceId)) return null
  const row: any = await Receipt.findOne({ _id: op.resourceId, organizationId: c.organizationId }).select('naviOperations linkSync.pending linkSync.state').lean()
  const marker = (row?.naviOperations || []).find((m: any) => sameMarker(m, op))
  return marker ? { marker, pending: row.linkSync?.pending === true, manual: row.linkSync?.state === 'manual_review' } : null
}
// Public ids of a receipt link result: the receipt, the primary transaction of THIS company and, when the completion also repaired other
// owed transactions of this company, all of them (the chat refreshes each open transaction).
const receiptLinkIds = (receiptId: string, transactionId: any, transactionIds: any[] = []) => { const all = [...new Set((transactionIds || []).map(String))]; return { receiptId: String(receiptId), ...(transactionId ? { transactionId: String(transactionId) } : {}), ...(all.some(t => t !== String(transactionId || '')) ? { affectedTransactionIds: all } : {}) } }
const receiptLinkRecover = async (c: any, op: any) => {
  const found = await receiptMarker(c, op)
  if (!found || found.pending) return null
  const m = found.marker
  return { operationId: m.operationId, payloadHash: m.payloadHash, appliedAt: m.appliedAt, requestedFields: m.requestedFields, nativeResourceIds: receiptLinkIds(op.resourceId, m.transactionId, m.transactionIds) }
}
// Who owns a saved receipt link whose badge is still owed: the automatic recovery (system) or the person (manual review). Null: no proof.
export async function receiptLinkPendingOwner(c: any, op: any): Promise<'system' | 'user' | null> { const found = await receiptMarker(c, op); return found?.pending ? (found.manual ? 'user' : 'system') : null }
const receiptSyncOwner = (synchronization: string) => synchronization === 'synced' ? null : synchronization === 'manual_review' ? 'user' : 'system'
const receiptLinkResult = async (c: any, out: any, meaning: string) => ({ outcome: out.outcome, synchronization: out.synchronization, receipt: (await getCompanyReceipt(c.organizationId, out.receiptId)).receipt, transaction: out.transactionId ? await getCompanyNaviTransaction(c.organizationId, out.transactionId).catch(() => null) : null, meaning })
const receiptLinkMeaning = 'saved link between this receipt and this transaction; it proves nothing about the purchase or its tax treatment and moves no money. synchronization synced means the transaction receipt badge is updated; pending means it is being updated automatically; manual_review means it needs the person'
const adapters: Record<string, Adapter> = {
  link_company_receipt: {
    resource: id('receiptId'),
    detail: args => ({ transactionId: String(args.transactionId) }),
    precheck: async (_c, args) => { exactSnapshot(args.expectedUpdatedAt) },
    run: async ({ c, args, marker }) => {
      const out: any = await matchReceiptWithTransaction(String(args.receiptId), String(args.transactionId), companyOf(c), { expectedUpdatedAt: args.expectedUpdatedAt, naviOperation: { ...marker, values: { transactionId: String(args.transactionId) } } })
      return { resourceIds: receiptLinkIds(out.receiptId, out.transactionId, out.transactionIds) as any, result: await receiptLinkResult(c, out, receiptLinkMeaning), pending: receiptSyncOwner(out.synchronization) }
    },
    recover: receiptLinkRecover
  },
  unlink_company_receipt: {
    resource: id('receiptId'),
    precheck: async (_c, args) => { exactSnapshot(args.expectedUpdatedAt) },
    run: async ({ c, args, marker }) => {
      const out: any = await unmatchReceipt(String(args.receiptId), companyOf(c), { expectedUpdatedAt: args.expectedUpdatedAt, naviOperation: { ...marker, values: {} } })
      return { resourceIds: receiptLinkIds(out.receiptId, out.transactionId, out.transactionIds) as any, result: await receiptLinkResult(c, out, receiptLinkMeaning), pending: receiptSyncOwner(out.synchronization) }
    },
    recover: receiptLinkRecover
  },
  create_company_transaction: {
    resource: (_args, operationId) => String(createdId(operationId)),
    precheck: async (c, args) => { for (const [key, model] of Object.entries(transactionReferenceModels)) if (args[key] !== undefined && !await model.exists(referenceScope(key, args[key], companyOf(c)))) bad(400, 'Choose an existing transaction reference') },
    run: async ({ c, args, op, marker }) => {
      const data: any = pick(args, businessFields.transaction)
      data.date = new Date(args.date)
      await asCreate(op, c.organizationId, Transaction, () => createCompanyTransaction(data, c.organizationId, { id: new mongoose.Types.ObjectId(op.resourceId), naviOperation: marker })).catch(validation)
      return { resourceIds: { transactionId: op.resourceId }, result: { transaction: await getCompanyNaviTransaction(c.organizationId, op.resourceId) } }
    },
    recover: created(Transaction)
  },
  delete_company_transaction: {
    resource: id('transactionId'),
    precheck: async (_c, args) => { exactSnapshot(args.expectedUpdatedAt) },
    run: async ({ c, args }) => {
      const current: any = await Transaction.findOne({ _id: args.transactionId, organizationId: c.organizationId }).select('cardAccounting metadata.financeEntryId').lean()
      if (!current) bad(404, 'Transaction not found')
      if (current.cardAccounting || current.metadata?.financeEntryId) bad(409, 'Imported card and posted ledger transactions are removed through their import, not by Navi')
      const deleted: any = await deleteTransaction(args.transactionId, c.organizationId, { expectedUpdatedAt: args.expectedUpdatedAt })
      const v = transactionNaviView(deleted)
      return { resourceIds: { transactionId: String(args.transactionId) }, result: { deleted: { id: v.id, date: v.date, amount: v.amount, currency: v.currency, type: v.type, status: v.status, productName: v.productName } } }
    },
    recover: unprovableDelete
  },
  create_company_invoice: {
    resource: (_args, operationId) => String(createdId(operationId)),
    run: async ({ c, args, op, marker }) => {
      const doc: any = await asCreate(op, c.organizationId, Invoice, () => createCompanyInvoice(c.organizationId, String(c.ownerId), pick(args, businessFields.invoice), { id: new mongoose.Types.ObjectId(op.resourceId), naviOperation: marker })).catch(invoiceWriteError)
      return { resourceIds: { invoiceId: op.resourceId }, result: { invoice: invoiceSummary(doc), values: invoiceResultValues(args) } }
    },
    recover: created(Invoice)
  },
  delete_company_invoice: {
    resource: id('invoiceId'),
    precheck: async (_c, args) => { exactSnapshot(args.expectedUpdatedAt) },
    run: async ({ c, args }) => { const v: any = await deleteCompanyInvoice(c.organizationId, args.invoiceId, { expectedUpdatedAt: args.expectedUpdatedAt }); return { resourceIds: { invoiceId: String(args.invoiceId) }, result: { deleted: { id: String(v._id), invoiceNumber: v.invoiceNumber, total: v.total, currency: v.currency, status: v.status } } } },
    recover: unprovableDelete
  },
  create_company_calendar_entry: {
    resource: (_args, operationId) => String(createdId(operationId)),
    run: async ({ c, args, op, marker }) => {
      const doc: any = await asCreate(op, c.organizationId, Payment, () => createCompanyCalendarEntry(c.organizationId, pick(args, businessFields.calendar), { id: new mongoose.Types.ObjectId(op.resourceId), naviOperation: marker })).catch(validation)
      return { resourceIds: { paymentId: op.resourceId }, result: { entry: entryView(doc.toObject ? doc.toObject() : doc) } }
    },
    recover: created(Payment)
  },
  delete_company_calendar_entry: {
    resource: id('paymentId'),
    precheck: async (_c, args) => { exactSnapshot(args.expectedUpdatedAt) },
    run: async ({ c, args, marker }) => { const r: any = await deleteCompanyCalendarEntry(c.organizationId, args.paymentId, String(c.ownerId), { expectedUpdatedAt: args.expectedUpdatedAt, naviOperation: marker }); return { resourceIds: { paymentId: String(args.paymentId) }, result: { suppressed: r.suppressed, meaning: r.suppressed ? 'issuer bill hidden from the calendar; its saved facts are kept and it cannot be recreated' : 'manual calendar entry deleted', entry: { id: String(r.payment._id), title: r.payment.title, amount: r.payment.amount, currency: r.payment.currency, dueDate: r.payment.dueDate } } } },
    // Only a suppression keeps its row (with this operation's marker); a hard-deleted manual entry cannot prove itself.
    recover: markedOn(Payment)
  },
  // The invoice's one income entry, through the same service as the native route. The entry id is fixed by the invoice, so a repeat
  // in a later turn, a concurrent native request or a retry meets the same row and gets it back unchanged. Only the row this
  // operation inserted carries its marker; returning an existing entry writes nothing, so its lost reply stays unresolved.
  schedule_company_invoice_payment: {
    resource: (args) => String(invoicePaymentId(String(args.invoiceId))),
    detail: args => ({ invoiceId: String(args.invoiceId) }),
    precheck: async (_c, args) => { exactSnapshot(args.expectedUpdatedAt) },
    run: async ({ c, args, marker }) => {
      const r: any = await scheduleInvoicePayment(companyOf(c), String(args.invoiceId), { expectedUpdatedAt: args.expectedUpdatedAt, actorId: String(c.ownerId), naviOperation: marker })
      return { resourceIds: { paymentId: r.entry.id, invoiceId: String(args.invoiceId) }, result: r }
    },
    recover: async (c: any, op: any) => {
      const m = await markerOf(Payment, c.organizationId, op.resourceId)
      return sameMarker(m, op) ? { ...m, nativeResourceIds: { paymentId: String(op.resourceId), invoiceId: String(op.detail?.invoiceId) } } : null
    }
  },
  create_company_budget: {
    resource: (_args, operationId) => String(createdId(operationId)),
    run: async ({ c, args, op, marker }) => {
      const doc = await createCompanyBudget(companyOf(c), String(c.ownerId), pick(args, businessFields.budget), { id: new mongoose.Types.ObjectId(op.resourceId), naviOperation: marker })
      if (!sameMarker(await markerOf(Budget, c.organizationId, op.resourceId), op)) bad(409, 'A different budget holds this id')
      return { resourceIds: { budgetId: op.resourceId }, result: { budget: budgetView(doc) } }
    },
    recover: created(Budget)
  },
  update_company_budget: {
    resource: id('budgetId'),
    precheck: async (_c, args) => { exactSnapshot(args.expectedUpdatedAt) },
    run: async ({ c, args, marker }) => { const doc = await updateCompanyBudget(companyOf(c), args.budgetId, pick(args, businessFields.budget), { naviOperation: { ...marker, values: pick(args, businessFields.budget) }, expectedUpdatedAt: args.expectedUpdatedAt }); return { resourceIds: { budgetId: String(args.budgetId) }, result: { budget: budgetView(doc) } } },
    recover: markedOn(Budget)
  },
  delete_company_budget: {
    resource: id('budgetId'),
    precheck: async (_c, args) => { exactSnapshot(args.expectedUpdatedAt) },
    run: async ({ c, args }) => { await assertCurrent(Budget, c.organizationId, args.budgetId, args.expectedUpdatedAt, 'Budget not found'); const doc = await deleteCompanyBudget(companyOf(c), args.budgetId, { expectedUpdatedAt: args.expectedUpdatedAt }); return { resourceIds: { budgetId: String(args.budgetId) }, result: { deleted: { id: doc.id, name: doc.name, amount: doc.amount, currency: doc.currency } } } },
    recover: unprovableDelete
  },
  create_company_recurring_payment: {
    resource: (_args, operationId) => String(createdId(operationId)),
    run: async ({ c, args, op, marker }) => {
      const doc = await createRecurringPayment(companyOf(c), String(c.ownerId), recurringBody(args), { id: new mongoose.Types.ObjectId(op.resourceId), naviOperation: marker })
      if (!sameMarker(await markerOf(RecurringPayment, c.organizationId, op.resourceId), op)) bad(409, 'A different recurring payment holds this id')
      return { resourceIds: { recurringPaymentId: op.resourceId }, result: { recurringPayment: recurringView(doc) } }
    },
    recover: created(RecurringPayment)
  },
  update_company_recurring_payment: {
    resource: id('recurringPaymentId'),
    precheck: async (_c, args) => { exactSnapshot(args.expectedUpdatedAt) },
    run: async ({ c, args, marker }) => { const body = recurringBody(args); const doc = await updateRecurringPayment(companyOf(c), args.recurringPaymentId, body, { naviOperation: { ...marker, values: body }, expectedUpdatedAt: args.expectedUpdatedAt }); return { resourceIds: { recurringPaymentId: String(args.recurringPaymentId) }, result: { recurringPayment: recurringView(doc) } } },
    recover: markedOn(RecurringPayment)
  },
  delete_company_recurring_payment: {
    resource: id('recurringPaymentId'),
    precheck: async (_c, args) => { exactSnapshot(args.expectedUpdatedAt) },
    run: async ({ c, args }) => { await assertCurrent(RecurringPayment, c.organizationId, args.recurringPaymentId, args.expectedUpdatedAt, 'Recurring payment not found'); const doc = await deleteRecurringPayment(companyOf(c), args.recurringPaymentId, { expectedUpdatedAt: args.expectedUpdatedAt }); return { resourceIds: { recurringPaymentId: String(args.recurringPaymentId) }, result: { deleted: { id: doc.id, name: doc.name }, forecasts: 'already saved forecasts stay as pending transactions' } } },
    recover: unprovableDelete
  },
  generate_company_recurring_forecast: {
    resource: id('recurringPaymentId'),
    detail: args => ({ cycle: args.expectedNextDueDate }),
    run: async ({ c, args }) => {
      const r: any = await generateTransaction(companyOf(c), args.recurringPaymentId, { expectedNextDueDate: args.expectedNextDueDate })
      return { resourceIds: { recurringPaymentId: String(args.recurringPaymentId), transactionId: String(r.transaction._id) }, result: { forecast: transactionNaviView(r.transaction), cycle: r.cycle, nextDueDate: r.nextDueDate, status: r.status, alreadyExisted: r.existing === true, meaning: 'pending forecast for the read cycle; not a payment' } }
    },
    // Proof: this payment's forecast for exactly this cycle exists and the payment advanced with it.
    recover: async (c: any, op: any) => {
      const cycle = op.detail?.cycle, recurringPaymentId = String(op.resourceId)
      if (!cycle || !mongoose.isValidObjectId(recurringPaymentId)) return null
      const forecast: any = await Transaction.findOne({ organizationId: c.organizationId, 'metadata.recurringPaymentId': recurringPaymentId, 'metadata.recurringCycle': cycle }).select('_id createdAt').lean()
      const payment: any = forecast ? await RecurringPayment.findOne({ _id: recurringPaymentId, organizationId: c.organizationId }).select('generatedTransactionIds').lean() : null
      if (!forecast || !(payment?.generatedTransactionIds || []).some((v: any) => String(v) === String(forecast._id))) return null
      return { operationId: op.operationId, payloadHash: op.payloadHash, appliedAt: forecast.createdAt, requestedFields: op.requestedFields, nativeResourceIds: { recurringPaymentId, transactionId: String(forecast._id) } }
    }
  },
  // The export recipe of the transactions page, prepared from the conversation: the frozen criteria and format are the journal
  // entry's detail; the result holds the resolved window and the count of currently matching records, never a row. The browser
  // downloads it from the conversation card through the existing export route; nothing is saved and no record changes.
  prepare_company_transaction_export: {
    resource: (_args, operationId) => operationId,
    detail: args => ({ format: args.format, criteria: exportCriteria(args) }),
    run: async ({ c, args, op }) => {
      const criteria = exportCriteria(args)
      if (!exportRangeOk(criteria)) bad(400, 'Choose a valid date range')
      const { transactions, window } = await exportTransactionRows(c.organizationId, criteria)
      return { resourceIds: { exportId: op.operationId }, result: { export: { exportId: op.operationId, format: args.format, criteria, window, matchedCount: transactions.length, delivery: 'browser_download_from_the_conversation_card', snapshot: 'none_recipe_for_current_matching_records' } } }
    },
    recover: exportRecover
  }
}
export const businessAdapter = (name: string) => Object.hasOwn(adapters, name) ? adapters[name] : null
export async function recoverBusinessOperation(c: any, op: any) { const a = businessAdapter(op.name); return a ? a.recover(c, op) : null }
export const businessIdKey = (name: string) => businessToolMeta[name]?.idKey || null

// ---- Reads of the frozen company (profile, summary, receipts, budgets, recurring payments)
export async function businessRead(c: any, name: string, args: any) {
  const organizationId = c.organizationId
  if (name === 'get_company_profile') return companyProfile(organizationId)
  if (name === 'get_company_finance_summary') return companyFinanceSummary(organizationId, args)
  if (name === 'list_company_receipts') return listCompanyReceipts(organizationId, args)
  if (name === 'get_company_receipt') return getCompanyReceipt(organizationId, args.receiptId)
  if (name === 'find_company_receipt_matches') return findCompanyReceiptMatches(organizationId, args.receiptId)
  if (name === 'get_company_invoice_calendar') return readInvoiceCalendar(companyOf(c), String(args.invoiceId))
  if (name === 'list_company_budgets') { const rows = await listCompanyBudgets(companyOf(c), { active: args.active === true ? 'true' : undefined, period: args.period }); return { budgets: rows.slice(0, 100).map(budgetView), truncated: rows.length > 100 } }
  if (name === 'get_company_budget') { const v = await getCompanyBudget(companyOf(c), args.budgetId); if (!v) bad(404, 'Budget not found'); return { budget: budgetView(v) } }
  if (name === 'list_company_recurring_payments') { const rows = await getRecurringPayments(companyOf(c), pick(args, ['status', 'frequency', 'search'])); return { recurringPayments: rows.slice(0, 100).map(recurringView), truncated: rows.length > 100 } }
  if (name === 'get_company_recurring_payment') { const v = await getRecurringPaymentById(companyOf(c), args.recurringPaymentId); if (!v) bad(404, 'Recurring payment not found'); return { recurringPayment: recurringView(v) } }
  return bad(400, 'Unknown company read tool')
}
