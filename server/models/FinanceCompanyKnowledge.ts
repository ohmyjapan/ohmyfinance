import mongoose, { Schema } from 'mongoose'
// Company-owned Navi teaching. Separate from the legacy owner learning/memory collections: nothing is adopted from them, and a
// teaching never changes a ledger row by itself. Each row keeps who taught it, where (conversation, segment, turn, exact quote of
// the server-stored user message) and an audit of every correction or pause. `operations` holds the durable markers of the
// company conversation journal (operationId + payloadHash) so a lost reply is reconciled, never repeated.
const schema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  createdBy: { type: Schema.Types.ObjectId, required: true, immutable: true },
  status: { type: String, enum: ['active', 'paused'], default: 'active' },
  revision: { type: Number, default: 1 },
  instruction: { type: String, required: true, maxlength: 1000 },
  conditions: { merchant: String, cardLast4: String, effectiveFrom: Date },
  suggested: { accountCategoryId: Schema.Types.ObjectId, subAccountCategoryId: Schema.Types.ObjectId, taxCategoryId: Schema.Types.ObjectId, transactionCategoryId: Schema.Types.ObjectId, customerId: Schema.Types.ObjectId, supplierId: Schema.Types.ObjectId },
  source: { type: Schema.Types.Mixed, required: true, immutable: true },
  history: { type: [Schema.Types.Mixed], default: [] },
  operations: { type: [Schema.Types.Mixed], default: [] },
  updatedBy: Schema.Types.ObjectId
}, { timestamps: true })
schema.index({ organizationId: 1, status: 1, updatedAt: -1 })
schema.index({ organizationId: 1, 'operations.operationId': 1 })
export const FinanceCompanyKnowledge: mongoose.Model<any> = (mongoose.models.FinanceCompanyKnowledge as any) || mongoose.model('FinanceCompanyKnowledge', schema)
