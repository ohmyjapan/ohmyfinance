import mongoose, { Schema } from 'mongoose'
// Separate from the legacy owner-only assistant: no adoption of old conversations or index migration.
const schema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  organizationId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  agentId: Schema.Types.ObjectId, revision: { type: Number, default: 0 }, state: { type: String, default: 'idle' },
  currentId: String, turns: { type: [Schema.Types.Mixed], default: [] }, context: Schema.Types.Mixed,
  lease: String, leaseUntil: Date, attempts: { type: Number, default: 0 }
}, { timestamps: true })
schema.index({ ownerId: 1, organizationId: 1 }, { unique: true })
export const FinanceCompanyAssistant: mongoose.Model<any> = (mongoose.models.FinanceCompanyAssistant as any) || mongoose.model('FinanceCompanyAssistant', schema)
