// server/models/Payment.ts
import mongoose, { Schema, Document } from 'mongoose'

export interface IBankTransferInfo {
  bankName: string           // 銀行名
  branchName: string         // 支店名
  accountType: 'ordinary' | 'current' | 'savings'  // 口座種別
  accountNumber: string      // 口座番号
  accountHolder: string      // 口座名義
}

// A bill the issuer's evidence produced or adopted (plan omf-calendar-gmail-build-20261015 §2 S1): one per card account and
// statement cycle whichever company holds it. `adopted` marks a hand-entered row the evidence was associated with (its
// financial fields stay as the owner wrote them); `linkedBy` the member whose explicit review action did the association.
export interface IPaymentSource {
  kind: 'card-statement'
  provider: 'aplus'
  accountId: mongoose.Types.ObjectId
  periodKey: string
  statementMonth: string
  importId?: mongoose.Types.ObjectId
  noticeId?: mongoose.Types.ObjectId
  sourceHash?: string
  statementTotal?: number
  dueDateEvidence?: 'issuer-page' | 'user-entered' | 'issuer-mail'
  adopted?: boolean
  adoptedAt?: Date
  linkedBy?: mongoose.Types.ObjectId
  linkedAt?: Date
  updatedAt?: Date
}

// The one income entry an explicit schedule made from a saved invoice (plan omf-navi-invoice-calendar-20261020): written only by
// companyInvoiceCalendarService in the original insert, never by a request body, an update or a later sync. `snapshot` is the
// invoice as saved at that moment; later invoice or calendar changes are reported as differences, never applied.
export interface IPaymentInvoiceLink {
  invoiceId: mongoose.Types.ObjectId
  invoiceNumber: string
  invoiceUpdatedAt: Date
  snapshot: { total: number, currency: string, dueDate: Date, status: string }
  linkedAt: Date
  linkedBy?: mongoose.Types.ObjectId
}

// The owner's explicit statement about a saved payment's bank settlement (plan omf-calendar-evidence-20261029 §2): written only by
// companyCalendarEvidenceService, never by a request body or a calendar edit (not in calendarUpdateFields), and never the lifecycle
// status. 'unconfirmed' is 銀行照合待ち (a historical payment nobody has matched to a bank line yet); 'owner_confirmed' is the owner's own
// word, not a bank match. No bank_matched/conflict until a bank unit exists, so Mongoose is the only validator of a state.
export interface IPaymentVerification {
  state: 'unconfirmed' | 'owner_confirmed'
  reason?: string
  basis?: string
  updatedAt: Date
  updatedBy?: mongoose.Types.ObjectId
  operationId?: string
}

export const calendarCurrencies = ['JPY', 'USD', 'EUR', 'GBP', 'KRW', 'CNY']

export interface IPayment extends Document {
  title: string
  amount: number
  currency: string
  dueDate: Date
  type: 'expense' | 'income'
  status: 'pending' | 'paid' | 'overdue' | 'cancelled' | 'completed'
  category: string
  recurring: boolean
  recurringFrequency?: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  bankTransfer?: IBankTransferInfo
  notes?: string
  organizationId?: mongoose.Types.ObjectId
  source?: IPaymentSource
  invoiceLink?: IPaymentInvoiceLink
  naviOperation?: any
  paymentVerification?: IPaymentVerification
  settledAt?: Date
  // A sourced bill the owner removed from the calendar keeps its row (B3): hidden from every calendar reader, never
  // recreated by a later notice or statement; only an explicit, freshly authorized action restores it.
  suppressedAt?: Date
  suppressedBy?: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const BankTransferInfoSchema = new Schema({
  bankName: { type: String, required: true },
  branchName: { type: String, required: true },
  accountType: { type: String, enum: ['ordinary', 'current', 'savings'], default: 'ordinary' },
  accountNumber: { type: String, required: true },
  accountHolder: { type: String, required: true }
}, { _id: false })

const PaymentSourceSchema = new Schema({
  kind: { type: String, enum: ['card-statement'], required: true },
  provider: { type: String, enum: ['aplus'], required: true },
  accountId: { type: Schema.Types.ObjectId, required: true },
  periodKey: { type: String, required: true },
  statementMonth: { type: String, required: true },
  importId: { type: Schema.Types.ObjectId },
  noticeId: { type: Schema.Types.ObjectId },
  sourceHash: { type: String },
  statementTotal: { type: Number },
  dueDateEvidence: { type: String, enum: ['issuer-page', 'user-entered', 'issuer-mail'] },
  adopted: { type: Boolean },
  adoptedAt: { type: Date },
  linkedBy: { type: Schema.Types.ObjectId },
  linkedAt: { type: Date },
  updatedAt: { type: Date }
}, { _id: false })

const PaymentInvoiceLinkSchema = new Schema({
  invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
  invoiceNumber: { type: String, required: true },
  invoiceUpdatedAt: { type: Date, required: true },
  snapshot: {
    total: { type: Number, required: true },
    currency: { type: String, required: true },
    dueDate: { type: Date, required: true },
    status: { type: String, required: true }
  },
  linkedAt: { type: Date, required: true },
  linkedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { _id: false })

const PaymentVerificationSchema = new Schema({
  state: { type: String, enum: ['unconfirmed', 'owner_confirmed'], required: true },
  reason: { type: String, maxlength: 300 },
  basis: { type: String, maxlength: 120 },
  updatedAt: { type: Date, required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  operationId: { type: String }
}, { _id: false })

const PaymentSchema = new Schema<IPayment>({
  title: {
    type: String,
    required: true,
    trim: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    required: true,
    default: 'JPY',
    enum: calendarCurrencies
  },
  dueDate: {
    type: Date,
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: ['expense', 'income']
  },
  status: {
    type: String,
    required: true,
    default: 'pending',
    enum: ['pending', 'paid', 'overdue', 'cancelled', 'completed']
  },
  category: {
    type: String,
    required: true
  },
  recurring: {
    type: Boolean,
    default: false
  },
  recurringFrequency: {
    type: String,
    enum: ['weekly', 'monthly', 'quarterly', 'yearly']
  },
  bankTransfer: {
    type: BankTransferInfoSchema
  },
  notes: {
    type: String
  },
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    index: true
  },
  source: {
    type: PaymentSourceSchema
  },
  invoiceLink: {
    type: PaymentInvoiceLinkSchema
  },
  naviOperation: { type: Schema.Types.Mixed },
  paymentVerification: {
    type: PaymentVerificationSchema
  },
  settledAt: {
    type: Date
  },
  suppressedAt: {
    type: Date
  },
  suppressedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_, ret) => {
      ret.id = ret._id.toString()
      delete (ret as Partial<Pick<typeof ret, '_id'>>)._id
      delete (ret as Partial<Pick<typeof ret, '__v'>>).__v
      return ret
    }
  }
})

// Indexes
PaymentSchema.index({ dueDate: 1 })
PaymentSchema.index({ type: 1 })
PaymentSchema.index({ status: 1 })
PaymentSchema.index({ category: 1 })
// One sourced bill per card account and statement cycle, whichever company holds it (company-agnostic by design: a bill
// stays in the company it was created in when the account is later bound elsewhere).
PaymentSchema.index({ 'source.accountId': 1, 'source.periodKey': 1 }, { unique: true, partialFilterExpression: { 'source.kind': 'card-statement' } })
// One entry per invoice in its company, hidden (suppressed) rows included, so a link is never made twice or silently revived. Only
// rows that carry a link are indexed: no existing row is touched or backfilled.
PaymentSchema.index({ organizationId: 1, 'invoiceLink.invoiceId': 1 }, { unique: true, partialFilterExpression: { 'invoiceLink.invoiceId': { $exists: true } } })

export const Payment = mongoose.models.Payment || mongoose.model<IPayment>('Payment', PaymentSchema)
