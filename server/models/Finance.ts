import mongoose, { Schema } from 'mongoose'
import { FinanceInventoryMatch } from './FinanceInventoryMatch'
import { FinanceMerchantLink } from './FinanceMerchantLink'
import { FinanceDraft, FinanceDocument } from './FinanceDraft'
import { FinanceReview, FinanceReviewAgent, FinanceHistory } from './FinanceReview'

const oid = Schema.Types.ObjectId
const common = { timestamps: true, toJSON: { virtuals: true } }
const account = new Schema({
  ownerId: { type: oid, required: true, index: true },
  name: { type: String, required: true }, provider: { type: String, default: 'amex', enum: ['amex', 'aplus'] },
  cardIdentifiers: { type: [String], required: true }, primaryCard: { type: String, required: true },
  otpRecipient: { type: String, required: function (this: any) { return this.provider !== 'aplus' } }, otpMailbox: { type: String, required: function (this: any) { return this.provider !== 'aplus' } },
  forwarded: { type: Boolean, default: false }, active: { type: Boolean, default: true },
  jobId: String, jobState: { type: String, default: 'idle' }, jobRequestedAt: Date,
  jobDeviceId: oid, jobLeaseUntil: Date, lastAttemptAt: Date, lastSuccessAt: Date, lastMessage: String,
  // Automatic Aplus collection (plan omf-auto-sync-build-20261014 §2 A1): on/off per account, the JST hour after which one
  // job per day is queued, and the JST day (YYYY-MM-DD) last queued by the schedule.
  autoSync: { enabled: { type: Boolean, default: false }, hour: { type: Number, min: 0, max: 23, default: 9 }, lastQueuedDay: String },
  // Internal markers of an owner Navi action, written in the SAME atomic write as the job enqueue / schedule change it records
  // (operationId of the journal row, and the queued jobId or saved values), so a lost reply is reconciled, never repeated. Never
  // supplied by a request; the native buttons leave them untouched.
  jobOperation: Schema.Types.Mixed, autoSyncOperation: Schema.Types.Mixed,
  // Payment-calendar binding (plan omf-calendar-gmail-build-20261015 §2 S8): the company new bills land in, when it was
  // bound and the company bound before it (an older cycle delivered after a change is offered to both for review).
  organizationId: { type: oid, index: true }, organizationBoundAt: Date, previousOrganizationId: oid,
  // Issuer billing mail read inside the Aplus collector job (B5): the setting and its durable read/error status, written
  // by the collector's receipt so a successful bank run can never mask a failed mail read.
  billingMail: { enabled: { type: Boolean, default: false }, mailbox: String, lastAttemptAt: Date, lastReadAt: Date, lastError: String, lastErrorAt: Date, lastCount: Number },
  accounting: Schema.Types.Mixed,
  commitLease: String, commitLeaseUntil: Date
}, common)
account.index({ ownerId: 1, provider: 1, cardIdentifiers: 1 }, { unique: true })

const collector = new Schema({
  ownerId: { type: oid, required: true, index: true }, name: { type: String, required: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  accountIds: [{ type: oid, required: true }], revokedAt: Date, lastSeenAt: Date
}, common)

const batch = new Schema({
  ownerId: { type: oid, required: true, index: true }, accountId: { type: oid, required: true, index: true },
  hash: { type: String, required: true }, originalName: String, bytes: Number,
  provider: { type: String, enum: ['amex', 'aplus'] }, reconciliation: Schema.Types.Mixed,
  encoding: String, parserVersion: String, period: { type: Schema.Types.Mixed, required: true },
  rows: { type: [Schema.Types.Mixed], required: true }, rowCount: Number,
  state: { type: String, default: 'review' }, downloadedAt: Date, collectorId: oid,
  decisions: { type: Schema.Types.Mixed, default: {} },
  mappingPreview: { type: Schema.Types.Mixed },
  sourceReferences: Schema.Types.Mixed,
  sourceStatus: { type: String, enum: ['pending'] }, sourceFormat: { type: String, enum: ['csv', 'json'] }, sourceCapturedAt: Date,
  finalization: Schema.Types.Mixed,
  // The statement's calendar link state (financeBillService reconcileBill): pending before the first reconciliation,
  // then linked / unbound / due-date-unresolved / review / unauthorized / suppressed with the ids and observations.
  calendar: Schema.Types.Mixed
}, common)
batch.index({ accountId: 1, hash: 1 }, { unique: true })

// One issuer billing notice per reading account and Gmail message id (plan omf-calendar-gmail-build-20261015 §2 S8 NEW
// FinanceNotice): the parsed claims and the body hash only — no raw mail body is stored anywhere. `calendar` is the
// durable work state (pending before reconciliation; a stored id is not completion), `versions` every body hash seen for
// the id, `action` the member's explicit review action.
const notice = new Schema({
  ownerId: { type: oid, required: true, index: true }, accountId: { type: oid, required: true }, targetAccountId: oid, organizationId: oid,
  mailId: { type: String, required: true }, threadId: String, mailbox: String,
  issuer: { type: String, enum: ['aplus', 'amex'], required: true }, kind: { type: String, enum: ['bill-confirmed', 'bill-ready'], required: true },
  subject: String, from: String, internalDate: Date, bodySha256: { type: String, required: true },
  authentication: { dkim: String, dmarc: String }, parserVersion: String,
  claims: Schema.Types.Mixed, versions: { type: [new Schema({ bodySha256: String, receivedAt: Date }, { _id: false })], default: [] },
  collectorId: oid, calendar: Schema.Types.Mixed, action: Schema.Types.Mixed, attempts: { type: Number, default: 0 }, lastAttemptAt: Date
}, common)
notice.index({ accountId: 1, mailId: 1 }, { unique: true })

const entry = new Schema({
  ownerId: { type: oid, required: true, index: true }, accountId: { type: oid, required: true, index: true },
  key: { type: String, required: true }, fingerprint: { type: String, required: true, index: true },
  occurrence: Number, coverage: { type: String, required: true },
  importId: { type: oid, required: true }, line: Number,
  transactionId: { type: oid, required: true }, state: { type: String, default: 'reserved' },
  postingOrganizationId: { type: oid }, // server-captured ledger company; unrelated to calendar bills
  draftSnapshot: Schema.Types.Mixed,
  row: { type: Schema.Types.Mixed, required: true }, linkedExisting: { type: Boolean, default: false }
}, common)
entry.index({ accountId: 1, key: 1 }, { unique: true })
entry.index({ transactionId: 1 }, { unique: true })

export const FinancialAccount = (mongoose.models.FinancialAccount as mongoose.Model<mongoose.InferSchemaType<typeof account>>) || mongoose.model('FinancialAccount', account)
export const FinanceCollector = (mongoose.models.FinanceCollector as mongoose.Model<mongoose.InferSchemaType<typeof collector>>) || mongoose.model('FinanceCollector', collector)
export const FinanceImport = (mongoose.models.FinanceImport as mongoose.Model<mongoose.InferSchemaType<typeof batch>>) || mongoose.model('FinanceImport', batch)
export const FinanceEntry = (mongoose.models.FinanceEntry as mongoose.Model<mongoose.InferSchemaType<typeof entry>>) || mongoose.model('FinanceEntry', entry)
export const FinanceNotice = (mongoose.models.FinanceNotice as mongoose.Model<mongoose.InferSchemaType<typeof notice>>) || mongoose.model('FinanceNotice', notice)

export async function initializeFinance() {
  await Promise.all([FinanceInventoryMatch.init(), FinanceMerchantLink.init(), FinancialAccount.init(), FinanceCollector.init(), FinanceImport.init(), FinanceEntry.init(), FinanceNotice.init(), FinanceDraft.init(), FinanceDocument.init(), FinanceReview.init(), FinanceReviewAgent.init(), FinanceHistory.init()])
}
