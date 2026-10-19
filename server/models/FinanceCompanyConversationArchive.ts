import mongoose, { Schema } from 'mongoose'
// One archived segment of a company conversation, written when the user starts a new chat. Immutable copy of the segment's turns,
// including every action receipt (done, failed and unresolved), keyed by owner/company. A segment counts as archived only when the
// live conversation's segment number has moved past it; an un-adopted copy (crash between the two writes) is never listed.
const schema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  organizationId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  conversationId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  segment: { type: Number, required: true, immutable: true },
  resetId: { type: String, required: true, immutable: true },
  fromRevision: { type: Number, required: true, immutable: true },
  turns: { type: [Schema.Types.Mixed], default: [], immutable: true },
  turnCount: { type: Number, immutable: true },
  firstAt: { type: Date, immutable: true },
  lastAt: { type: Date, immutable: true },
  archivedBy: { type: Schema.Types.ObjectId, immutable: true }
}, { timestamps: true })
schema.index({ conversationId: 1, segment: 1 }, { unique: true })
schema.index({ ownerId: 1, organizationId: 1, segment: -1 })
export const FinanceCompanyConversationArchive: mongoose.Model<any> = (mongoose.models.FinanceCompanyConversationArchive as any) || mongoose.model('FinanceCompanyConversationArchive', schema)
