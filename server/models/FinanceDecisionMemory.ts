import mongoose, { Schema } from 'mongoose'
// An independent, explicit memory event: "remember these accounting fields" (kind accounting, exact field values including a
// deliberately empty subsidiary) or "remember this customer/purpose" (kind classification) for the exact owner, account and
// merchant, from the purchase date on. It is written by a Navi command on its own, never through a whole-draft approval, and
// changes no draft value, approval, card accounting or ledger row. Its operationId is unique so a retried command inserts once.
const oid = Schema.Types.ObjectId, mixed = Schema.Types.Mixed
const schema = new Schema({
 ownerId: { type: oid, required: true }, accountId: { type: oid, required: true }, kind: { type: String, required: true, enum: ['accounting', 'classification'] },
 merchant: { type: String, required: true }, merchantLabel: String, accountName: String, purpose: String, customerId: String, effectiveFrom: String,
 fields: [String], values: mixed, decision: mixed,
 status: { type: String, required: true, enum: ['active', 'paused'], default: 'active' }, revision: { type: Number, default: 1 },
 operationId: { type: String, required: true }, source: mixed, provenance: mixed, audit: { type: [mixed], default: [] }, at: { type: Date, required: true }
}, { timestamps: true })
schema.index({ operationId: 1 }, { unique: true })
schema.index({ ownerId: 1, accountId: 1, kind: 1, merchant: 1, status: 1 })
export const FinanceDecisionMemory: mongoose.Model<any> = (mongoose.models.FinanceDecisionMemory as any) || mongoose.model('FinanceDecisionMemory', schema)
