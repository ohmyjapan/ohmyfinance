// Invoice -> income calendar entry (plan omf-navi-invoice-calendar-20261020). The native route and company Navi call this one
// service; their caller owns fresh authorization and passes only the selected company, the invoice id, the exact invoice updatedAt it
// read and the actor. An explicit schedule creates at most ONE entry per invoice, from the invoice as saved at that moment (initial
// copy of total, currency, due day and status). An existing entry is returned exactly as it is: never resynced, overwritten, revived
// or adopted from a lookalike row. Reads report the saved snapshot, the invoice now and the entry now with the fields that differ.
// No transaction, ledger posting, invoice change, sending or bank settlement happens here.
import mongoose from 'mongoose'
import { createHash } from 'node:crypto'
import { createError } from 'h3'
import Invoice from '../models/Invoice'
import { Payment, calendarCurrencies } from '../models/Payment'

const fail = (statusCode: number, statusMessage: string): never => { throw createError({ statusCode, statusMessage }) }
// The entry id is derived from the invoice id: every writer (native, Navi, a retry, a concurrent request) can only meet the same row.
export const invoicePaymentId = (invoiceId: string) => new mongoose.Types.ObjectId(createHash('sha256').update('omf-invoice-calendar|' + invoiceId.toLowerCase()).digest('hex').slice(0, 24))
// Saved invoice status -> internal calendar status. A saved 'paid' is bookkeeping only: no settledAt is stamped.
const STATUS: Record<string, string> = { draft: 'pending', sent: 'pending', overdue: 'overdue', paid: 'paid', cancelled: 'cancelled' }
const INCOME_CATEGORY = '売上'
const MEANING = 'One calendar entry created once from the saved invoice: an initial copy of its total, currency, due day and status. It is not kept in sync with the invoice, moves no money and is not bank settlement or proof of payment; later differences are listed here, never applied. Invoice issue dates, calendar due days and the planning category do not establish performance, the revenue recognition period, qualified-invoice status or tax treatment.'
const iso = (v: any) => v ? new Date(v).toISOString() : null
const dayKey = (v: any) => v ? new Date(v).toISOString().slice(0, 10) : null
// Calendar entries keep their day at noon UTC (the page and every native writer use the same convention).
const calendarDay = (v: any) => new Date(dayKey(v) + 'T12:00:00.000Z')

const invoiceView = (v: any) => v ? { id: String(v._id), invoiceNumber: v.invoiceNumber, status: v.status, issueDate: iso(v.issueDate), dueDate: iso(v.dueDate), total: v.total, currency: v.currency ?? null, toName: v.to?.name || '', updatedAt: iso(v.updatedAt), deliveryEvidence: 'not_verified_by_calendar_link' } : null
const entryView = (v: any) => v ? { id: String(v._id), title: v.title, amount: v.amount, currency: v.currency, dueDate: iso(v.dueDate), type: v.type, status: v.status, category: v.category, settledAt: iso(v.settledAt), hiddenFromCalendar: !!v.suppressedAt, updatedAt: iso(v.updatedAt), moneyMovement: 'none_internal_plan_only' } : null
// Provenance summary for calendar readers (native list keeps the raw field; Navi gets this projection).
export const invoiceLinkSummary = (link: any) => link?.invoiceId ? { invoiceId: String(link.invoiceId), invoiceNumber: link.invoiceNumber, invoiceUpdatedAt: iso(link.invoiceUpdatedAt), snapshot: { total: link.snapshot?.total, currency: link.snapshot?.currency, dueDate: iso(link.snapshot?.dueDate), status: link.snapshot?.status }, linkedAt: iso(link.linkedAt), meaning: 'initial_saved_invoice_snapshot_not_synced_not_settlement' } : null
const snapshotView = (link: any) => { const s = invoiceLinkSummary(link); return s ? { invoiceNumber: s.invoiceNumber, invoiceUpdatedAt: s.invoiceUpdatedAt, ...s.snapshot, linkedAt: s.linkedAt } : null }
// Fields of the invoice that changed since the entry was made from it.
function invoiceDrift(link: any, invoice: any) {
  const out: string[] = []
  if (!link || !invoice) return out
  if (link.invoiceNumber !== invoice.invoiceNumber) out.push('invoiceNumber')
  if (link.snapshot.total !== invoice.total) out.push('total')
  if (link.snapshot.currency !== invoice.currency) out.push('currency')
  if (iso(link.snapshot.dueDate) !== iso(invoice.dueDate)) out.push('dueDate')
  if (link.snapshot.status !== invoice.status) out.push('status')
  return out
}
// Fields of the entry that differ from what was copied (an explicit calendar edit since then, kept as the user made it).
function entryDrift(link: any, entry: any) {
  const out: string[] = []
  if (!link || !entry) return out
  if (entry.amount !== link.snapshot.total) out.push('amount')
  if (entry.currency !== link.snapshot.currency) out.push('currency')
  if (dayKey(entry.dueDate) !== dayKey(link.snapshot.dueDate)) out.push('dueDate')
  if (entry.status !== STATUS[link.snapshot.status]) out.push('status')
  if (entry.type !== 'income') out.push('type')
  return out
}
function view(invoice: any, entry: any) {
  const link = entry?.invoiceLink || null
  return { invoice: invoiceView(invoice), state: entry ? 'linked' : 'not_linked', entry: entryView(entry), linkedSnapshot: snapshotView(link), invoiceChangedSinceLink: invoiceDrift(link, invoice), entryDiffersFromLinkedSnapshot: entryDrift(link, entry), meaning: MEANING }
}
const invoiceObjectId = (invoiceId: unknown) => { if (typeof invoiceId !== 'string' || !/^[a-fA-F0-9]{24}$/.test(invoiceId)) fail(404, 'Invoice not found'); return new mongoose.Types.ObjectId(invoiceId as string) }
// Only the trusted link counts, never an amount, title or date that happens to match. Hidden (suppressed) entries are included.
const linkedEntry = (organizationId: mongoose.Types.ObjectId, invoiceId: mongoose.Types.ObjectId) => Payment.findOne({ organizationId, 'invoiceLink.invoiceId': invoiceId }).lean()

export async function readInvoiceCalendar(organizationId: mongoose.Types.ObjectId, invoiceId: string) {
  const _id = invoiceObjectId(invoiceId)
  const [invoice, entry] = await Promise.all([Invoice.findOne({ _id, organizationId }).lean(), linkedEntry(organizationId, _id)])
  // A deleted invoice keeps its entry (no delete cascade); the read still shows it with the saved snapshot.
  if (!invoice && !entry) fail(404, 'Invoice not found')
  return view(invoice, entry)
}

export type InvoiceScheduleOperation = { expectedUpdatedAt: unknown, actorId: string, naviOperation?: Record<string, unknown> }
export async function scheduleInvoicePayment(organizationId: mongoose.Types.ObjectId, invoiceId: string, operation: InvoiceScheduleOperation) {
  const expected = operation.expectedUpdatedAt
  if (typeof expected !== 'string' || !Number.isFinite(Date.parse(expected)) || new Date(expected).toISOString() !== expected) fail(400, 'Read the invoice and use its exact updatedAt')
  const _id = invoiceObjectId(invoiceId)
  const invoice: any = await Invoice.findOne({ _id, organizationId }).lean()
  if (!invoice) fail(404, 'Invoice not found')
  const existing: any = await linkedEntry(organizationId, _id)
  if (existing) return { outcome: 'existing', ...view(invoice, existing) }
  if (iso(invoice.updatedAt) !== expected) fail(409, 'Invoice changed; read it again')
  if (!calendarCurrencies.includes(invoice.currency)) fail(422, `The payment calendar cannot hold invoice currency ${String(invoice.currency)}; nothing was converted or saved`)
  if (!Object.hasOwn(STATUS, invoice.status)) fail(422, 'This invoice status has no calendar meaning; nothing was saved')
  if (typeof invoice.total !== 'number' || !Number.isFinite(invoice.total) || invoice.total < 0) fail(422, 'This invoice total cannot be a calendar amount; nothing was saved')
  const snapshot = { total: invoice.total, currency: invoice.currency, dueDate: invoice.dueDate, status: invoice.status }
  const party = invoice.to?.name ? `（${invoice.to.name}）` : ''
  const entry = {
    _id: invoicePaymentId(String(_id)),
    title: `請求書 ${invoice.invoiceNumber}${party}`,
    amount: invoice.total,
    currency: invoice.currency,
    dueDate: calendarDay(invoice.dueDate),
    type: 'income',
    status: STATUS[invoice.status],
    category: INCOME_CATEGORY,
    recurring: false,
    notes: `請求書 ${invoice.invoiceNumber} から作成した入金予定（作成時の保存内容の控え。請求書とは同期せず、入金の確認ではありません）`,
    organizationId,
    invoiceLink: { invoiceId: _id, invoiceNumber: invoice.invoiceNumber, invoiceUpdatedAt: invoice.updatedAt, snapshot, linkedAt: new Date(), linkedBy: operation.actorId },
    ...operation.naviOperation ? { naviOperation: operation.naviOperation } : {}
  }
  try {
    await Payment.create(entry)
  } catch (error: any) {
    if (error?.code !== 11000) throw error
    // A concurrent or earlier writer already holds this invoice's one entry: return it as it is, never overwrite it.
    const raced: any = await linkedEntry(organizationId, _id)
    if (!raced) throw error
    return { outcome: 'existing', ...view(invoice, raced) }
  }
  return { outcome: 'created', ...view(invoice, await linkedEntry(organizationId, _id)) }
}
