import mongoose, { Schema } from 'mongoose'

const oid = Schema.Types.ObjectId
const common = { timestamps: true, toJSON: { virtuals: true } }
const account = new Schema({
  ownerId: { type: oid, required: true, index: true },
  name: { type: String, required: true }, provider: { type: String, default: 'amex', enum: ['amex'] },
  cardIdentifiers: { type: [String], required: true }, primaryCard: { type: String, required: true },
  otpRecipient: { type: String, required: true }, otpMailbox: { type: String, required: true },
  forwarded: { type: Boolean, default: false }, active: { type: Boolean, default: true },
  jobId: String, jobState: { type: String, default: 'idle' }, jobRequestedAt: Date,
  jobDeviceId: oid, jobLeaseUntil: Date, lastAttemptAt: Date, lastSuccessAt: Date, lastMessage: String,
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
  encoding: String, parserVersion: String, period: { type: Schema.Types.Mixed, required: true },
  rows: { type: [Schema.Types.Mixed], required: true }, rowCount: Number,
  state: { type: String, default: 'review' }, downloadedAt: Date, collectorId: oid,
  decisions: { type: Schema.Types.Mixed, default: {} },
  mappingPreview: { type: Schema.Types.Mixed }
}, common)
batch.index({ accountId: 1, hash: 1 }, { unique: true })

const entry = new Schema({
  ownerId: { type: oid, required: true, index: true }, accountId: { type: oid, required: true, index: true },
  key: { type: String, required: true }, fingerprint: { type: String, required: true, index: true },
  occurrence: Number, coverage: { type: String, required: true },
  importId: { type: oid, required: true }, line: Number,
  transactionId: { type: oid, required: true }, state: { type: String, default: 'reserved' },
  row: { type: Schema.Types.Mixed, required: true }, linkedExisting: { type: Boolean, default: false }
}, common)
entry.index({ accountId: 1, key: 1 }, { unique: true })
entry.index({ transactionId: 1 }, { unique: true })

export const FinancialAccount = (mongoose.models.FinancialAccount as mongoose.Model<mongoose.InferSchemaType<typeof account>>) || mongoose.model('FinancialAccount', account)
export const FinanceCollector = (mongoose.models.FinanceCollector as mongoose.Model<mongoose.InferSchemaType<typeof collector>>) || mongoose.model('FinanceCollector', collector)
export const FinanceImport = (mongoose.models.FinanceImport as mongoose.Model<mongoose.InferSchemaType<typeof batch>>) || mongoose.model('FinanceImport', batch)
export const FinanceEntry = (mongoose.models.FinanceEntry as mongoose.Model<mongoose.InferSchemaType<typeof entry>>) || mongoose.model('FinanceEntry', entry)

export async function initializeFinance() {
  await Promise.all([FinancialAccount.init(), FinanceCollector.init(), FinanceImport.init(), FinanceEntry.init()])
}
