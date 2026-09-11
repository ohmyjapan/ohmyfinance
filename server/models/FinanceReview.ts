import mongoose, { Schema } from 'mongoose'
const oid = Schema.Types.ObjectId
const agentSchema = new Schema({
  ownerId: { type: oid, required: true, index: true }, accountIds: [oid],
  tokenHash: { type: String, required: true, unique: true, select: false },
  teamId: { type: String, required: true }, userId: { type: String, required: true }, channelId: String,
  enabled: { type: Boolean, default: false }, revokedAt: Date, lastSeenAt: Date, queueLock: String, queueLockUntil: Date
}, { timestamps: true })
const reviewSchema = new Schema({
  ownerId: { type: oid, required: true }, accountId: { type: oid, required: true },
  importId: { type: oid, required: true }, line: { type: Number, required: true },
  key: { type: String, required: true }, sourceHash: { type: String, required: true }, revision: { type: Number, required: true },
  agentId: { type: oid, required: true }, context: { type: Schema.Types.Mixed, required: true },
  status: { type: String, required: true, default: 'queued', enum: ['queued', 'sending', 'awaiting_reply', 'proposed', 'resolved', 'deferred', 'conflict', 'delivery_unknown'] },
  sendId: String, channelId: String, threadTs: String, sentAt: Date,
  proposal: Schema.Types.Mixed, replies: { type: [Schema.Types.Mixed], default: [] },
  memory: Schema.Types.Mixed, resolvedAt: Date, appliedRevision: Number, lock: String, lockUntil: Date
}, { timestamps: true })
reviewSchema.index({ ownerId: 1, importId: 1, line: 1 }, { unique: true })
reviewSchema.index({ agentId: 1, status: 1 })
const historySchema = new Schema({
  ownerId: { type: oid, required: true }, accountId: { type: oid, required: true },
  dataset: { type: String, required: true }, sheet: String, row: Number,
  merchant: String, date: String, amount: Number, purpose: String, customerId: String, customerLabel: String, category: String
}, { timestamps: true })
historySchema.index({ ownerId: 1, accountId: 1, dataset: 1, sheet: 1, row: 1 }, { unique: true })
historySchema.index({ ownerId: 1, accountId: 1, merchant: 1, date: 1 })
export const FinanceReviewAgent = (mongoose.models.FinanceReviewAgent as mongoose.Model<mongoose.InferSchemaType<typeof agentSchema>>) || mongoose.model('FinanceReviewAgent', agentSchema)
export const FinanceReview = (mongoose.models.FinanceReview as mongoose.Model<mongoose.InferSchemaType<typeof reviewSchema>>) || mongoose.model('FinanceReview', reviewSchema)
export const FinanceHistory = (mongoose.models.FinanceHistory as mongoose.Model<mongoose.InferSchemaType<typeof historySchema>>) || mongoose.model('FinanceHistory', historySchema)
