import mongoose, { Schema } from 'mongoose'
// Durable journal of one Navi action: identity = owner + conversation kind + conversation + turn + slot (stable across an HTTP
// retry and a worker reclaim); the canonical payload hash detects a slot reused with a different meaning. The journal records
// the claim, the domain outcome and the receipt; the domain write itself carries its own marker (draft history operation,
// memory event operationId, research request, ledger entry), so a crash is reconciled from that record, never repeated blindly.
// No credential or token is stored here. A ledger posting operation also keeps, from its claim on, the company frozen on its turn
// (actor/company/name, or null when none was selected) and the requested lines: recovery verifies the ledger against that company,
// never against the current UI selection. Operations claimed before this field existed carry none and are never given one.
const oid = Schema.Types.ObjectId, mixed = Schema.Types.Mixed
const schema = new Schema({
 ownerId: { type: oid, required: true }, conversationKind: { type: String, required: true, enum: ['workspace', 'purchase'] }, conversationId: { type: oid, required: true },
 turnId: { type: String, required: true }, slot: { type: Number, required: true }, operationId: { type: String, required: true },
 name: { type: String, required: true }, payloadHash: { type: String, required: true }, target: mixed, intakeArgs: mixed,
 postingCompany: { type: mixed, immutable: true }, postingLines: { type: [Number], default: undefined, immutable: true },
 state: { type: String, required: true, enum: ['claimed', 'done', 'failed', 'unresolved'], default: 'claimed' },
 agentId: oid, lease: String, leaseUntil: Date, claimedAt: Date, attempts: { type: Number, default: 1 },
 receipt: mixed, completedAt: Date, recoveryOwner: String, safeError: String
}, { timestamps: true })
schema.index({ ownerId: 1, conversationKind: 1, conversationId: 1, turnId: 1, slot: 1 }, { unique: true })
schema.index({ operationId: 1 }, { unique: true })
schema.index({ conversationKind: 1, conversationId: 1, turnId: 1 })
export const FinanceActionOperation: mongoose.Model<any> = (mongoose.models.FinanceActionOperation as any) || mongoose.model('FinanceActionOperation', schema)
