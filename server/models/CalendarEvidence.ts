// Calendar supplier originals (plan omf-calendar-evidence-20261029 §2): three company-scoped records. An invoice identity (supplier,
// number, service period, currency) owns versions (sources: one registered email with its files, active or superseded) and is linked to
// saved calendar entries through link rows. Links never create or edit a Payment; the money fields stay where the owner wrote them.
// Written only by companyCalendarEvidenceService (the routes, company Navi and the backfill script all go through it).
import mongoose, { Schema } from 'mongoose'
const oid = Schema.Types.ObjectId
const dayKey = /^\d{4}-\d{2}-\d{2}$/, hex64 = /^[a-f0-9]{64}$/

const invoiceSchema = new Schema({
  organizationId: { type: oid, required: true, index: true },
  supplier: { type: String, required: true, trim: true, maxlength: 200 },
  invoiceNumber: { type: String, required: true, trim: true, maxlength: 100 },
  servicePeriod: { from: { type: String, required: true, match: dayKey }, to: { type: String, required: true, match: dayKey } },
  currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
  // The version the calendar shows: set by an explicit 'active' registration, never inferred from dates.
  activeSourceId: { type: oid, default: null }
}, { timestamps: true })
invoiceSchema.index({ organizationId: 1, supplier: 1, invoiceNumber: 1, 'servicePeriod.from': 1, 'servicePeriod.to': 1 }, { unique: true })

const fileSchema = new Schema({
  fileId: { type: String, required: true, match: hex64 },
  name: { type: String, required: true, maxlength: 200 },
  mimeType: { type: String, required: true, maxlength: 100 },
  size: { type: Number, required: true, min: 1 },
  kind: { type: String, required: true, enum: ['invoice-pdf', 'companion', 'email'] }
}, { _id: false })
const sourceSchema = new Schema({
  organizationId: { type: oid, required: true, index: true },
  invoiceId: { type: oid, required: true, index: true },
  provider: { type: String, required: true, maxlength: 40 },
  messageId: { type: String, required: true, maxlength: 200 },
  receivedAt: { type: Date, required: true },
  issuedOn: { type: String, match: dayKey },
  totalAmount: { type: Number },
  email: { sha256: { type: String, required: true, match: hex64 }, name: { type: String, required: true, maxlength: 200 }, size: { type: Number, required: true, min: 1 }, text: { type: String, maxlength: 20000, default: '' } },
  files: { type: [fileSchema], default: [] },
  status: { type: String, required: true, enum: ['active', 'superseded'] },
  supersededReason: { type: String, maxlength: 500 }
}, { timestamps: true })
// One registration per email within an invoice identity (a repeat returns the existing version). Per identity, not per company: one
// supplier email can carry two invoices (the 2026-05 split), each its own identity with the same original message.
sourceSchema.index({ organizationId: 1, invoiceId: 1, 'email.sha256': 1 }, { unique: true, partialFilterExpression: { 'email.sha256': { $exists: true } } })

const historySchema = new Schema({ action: { type: String, required: true, enum: ['linked', 'unlinked'] }, at: { type: Date, required: true }, by: { type: oid }, operationId: { type: String } }, { _id: false })
const linkSchema = new Schema({
  organizationId: { type: oid, required: true, index: true },
  invoiceId: { type: oid, required: true },
  paymentId: { type: oid, required: true, index: true },
  linkedAt: { type: Date, required: true },
  linkedBy: { type: oid },
  unlinkedAt: { type: Date, default: null },
  unlinkedBy: { type: oid },
  // The company Navi marker of the last link/unlink, written in that same update (proof after a lost reply).
  naviOperation: { type: Schema.Types.Mixed },
  history: { type: [historySchema], default: [] }
}, { timestamps: true })
linkSchema.index({ organizationId: 1, invoiceId: 1, paymentId: 1 }, { unique: true })

export const CalendarEvidenceInvoice: mongoose.Model<any> = (mongoose.models.CalendarEvidenceInvoice as any) || mongoose.model('CalendarEvidenceInvoice', invoiceSchema, 'calendarevidenceinvoices')
export const CalendarEvidenceSource: mongoose.Model<any> = (mongoose.models.CalendarEvidenceSource as any) || mongoose.model('CalendarEvidenceSource', sourceSchema, 'calendarevidencesources')
export const CalendarEvidenceLink: mongoose.Model<any> = (mongoose.models.CalendarEvidenceLink as any) || mongoose.model('CalendarEvidenceLink', linkSchema, 'calendarevidencelinks')
export async function initializeCalendarEvidence() { await Promise.all([CalendarEvidenceInvoice.init(), CalendarEvidenceSource.init(), CalendarEvidenceLink.init()]) }
