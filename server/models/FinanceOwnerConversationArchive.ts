import mongoose, { Schema } from 'mongoose'
// One archived segment of the legacy owner workspace conversation (conversationKind workspace) or of one purchase conversation
// (conversationKind purchase, with its owned account/import/line), written when the owner starts a new chat. Immutable copy of the
// segment's turns with every journal receipt (done, failed, unresolved), the frozen posting company and the company-teaching tag a
// turn carried; nothing is inferred about a company from it. Separate from the company conversation archive: never adopted into it
// or from it. A segment counts as archived only when the live conversation's segment number has moved past it; an un-adopted copy
// (crash between the two writes) is never listed.
const oid = Schema.Types.ObjectId
const schema = new Schema({
  ownerId: { type: oid, required: true, immutable: true },
  conversationKind: { type: String, required: true, enum: ['workspace', 'purchase'], immutable: true },
  conversationId: { type: oid, required: true, immutable: true },
  accountId: { type: oid, immutable: true }, importId: { type: oid, immutable: true }, line: { type: Number, immutable: true },
  segment: { type: Number, required: true, immutable: true },
  resetId: { type: String, required: true, immutable: true },
  fromRevision: { type: Number, required: true, immutable: true },
  turns: { type: [Schema.Types.Mixed], default: [], immutable: true },
  turnCount: { type: Number, immutable: true },
  firstAt: { type: Date, immutable: true },
  lastAt: { type: Date, immutable: true },
  archivedBy: { type: oid, immutable: true }
}, { timestamps: true })
schema.index({ conversationKind: 1, conversationId: 1, segment: 1 }, { unique: true })
schema.index({ ownerId: 1, conversationKind: 1, conversationId: 1, segment: -1 })
export const FinanceOwnerConversationArchive: mongoose.Model<any> = (mongoose.models.FinanceOwnerConversationArchive as any) || mongoose.model('FinanceOwnerConversationArchive', schema)
