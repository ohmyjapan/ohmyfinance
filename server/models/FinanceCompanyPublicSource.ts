import mongoose, { Schema } from 'mongoose'
// One public research capture of a company conversation turn: literal text, hash, final URL and capture time (or a failed or
// unavailable read, kept as activity without text). Separate from the conversation so 200-turn chats and their archives stay
// small; bound to the owner/company/conversation/segment/turn the server derived from the frozen job. Immutable once written.
// captureId is the worker's idempotent capture identity within the turn: a repeated delivery returns the same row.
const oid = Schema.Types.ObjectId
const schema = new Schema({
  ownerId: { type: oid, required: true, immutable: true },
  organizationId: { type: oid, required: true, immutable: true },
  conversationId: { type: oid, required: true, immutable: true },
  segment: { type: Number, required: true, immutable: true },
  turnId: { type: String, required: true, immutable: true },
  agentId: { type: oid, immutable: true },
  captureId: { type: String, required: true, immutable: true },
  kind: { type: String, enum: ['web', 'chrome', 'registry'], required: true, immutable: true },
  status: { type: String, enum: ['captured', 'failed', 'unavailable'], required: true, immutable: true },
  requestedUrl: { type: String, immutable: true },
  url: { type: String, immutable: true },
  title: { type: String, immutable: true },
  text: { type: String, immutable: true },
  hash: { type: String, immutable: true },
  chars: { type: Number, immutable: true },
  truncated: { type: Boolean, immutable: true },
  capturedAt: { type: Date, immutable: true },
  safeError: { type: String, immutable: true },
  // Registry kind only: the literal number, the server-set date and its authority, and the official observation at that date.
  target: { type: Schema.Types.Mixed, immutable: true },
  registry: { type: Schema.Types.Mixed, immutable: true }
}, { timestamps: true })
schema.index({ conversationId: 1, turnId: 1, captureId: 1 }, { unique: true })
schema.index({ ownerId: 1, organizationId: 1, conversationId: 1, segment: 1, createdAt: 1 })
export const FinanceCompanyPublicSource: mongoose.Model<any> = (mongoose.models.FinanceCompanyPublicSource as any) || mongoose.model('FinanceCompanyPublicSource', schema)
