import mongoose, { Schema } from 'mongoose'

const oid = Schema.Types.ObjectId
const draftSchema = new Schema({
  ownerId: { type: oid, required: true, index: true },
  accountId: { type: oid, required: true, index: true },
  importId: { type: oid, required: true }, line: { type: Number, required: true },
  key: { type: String, required: true }, sourceHash: { type: String, required: true },
  revision: { type: Number, required: true },
  values: { type: Schema.Types.Mixed, required: true },
  evidence: { type: Schema.Types.Mixed, required: true },
  history: { type: [Schema.Types.Mixed], default: [] },
  approvedAt: Date,
  // Only explicitly approved, reusable decisions are candidates for another draft.
  memory: Schema.Types.Mixed,
  teachingMemory: Schema.Types.Mixed
}, { timestamps: true })
draftSchema.index({ ownerId: 1, importId: 1, line: 1 }, { unique: true })
draftSchema.index({ ownerId: 1, accountId: 1, 'memory.merchant': 1 })

draftSchema.index({ ownerId: 1, accountId: 1, 'teachingMemory.merchant': 1 })

const documentSchema = new Schema({
  ownerId: { type: oid, required: true, index: true },
  accountId: { type: oid, required: true }, importId: { type: oid, required: true },
  line: { type: Number, required: true },
  name: { type: String, required: true }, mimeType: { type: String, required: true },
  size: { type: Number, required: true }, hash: { type: String, required: true },
  kind: { type: String, required: true, enum: ['receipt', 'invoice', 'shipping', 'other'] }
}, { timestamps: true })
documentSchema.index({ ownerId: 1, importId: 1, line: 1 })

export const FinanceDraft: mongoose.Model<mongoose.InferSchemaType<typeof draftSchema>> = (mongoose.models.FinanceDraft as any) || mongoose.model('FinanceDraft', draftSchema)
export const FinanceDocument: mongoose.Model<mongoose.InferSchemaType<typeof documentSchema>> = (mongoose.models.FinanceDocument as any) || mongoose.model('FinanceDocument', documentSchema)
