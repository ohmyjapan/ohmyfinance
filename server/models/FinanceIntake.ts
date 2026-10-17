// Intake (購入受付) collections, all owner-scoped (plan omf-intake-feature-20261016 §2; research row: plan
// omf-intake-mapping-research-amended-20261017 §2 B). Nothing here is read by the ledger, the card imports, drafts or entries;
// the service calls init() on all five before the first write (as initializeFinance does).
import mongoose, { Schema } from 'mongoose'
const oid = Schema.Types.ObjectId
const recordSchema = new Schema({
  ownerId: { type: oid, required: true, index: true },
  key: { type: String, required: true },
  values: { type: Schema.Types.Mixed, required: true },
  extra: { type: Schema.Types.Mixed, default: {} },
  provenance: { type: [Schema.Types.Mixed], default: [] },
  history: { type: [Schema.Types.Mixed], default: [] },
  revision: { type: Number, required: true },
  identityReview: { type: Boolean, default: false },
  archived: { type: Boolean, default: false }, archivedAt: Date
}, { timestamps: true, minimize: false })
recordSchema.index({ ownerId: 1, key: 1 }, { unique: true })
const documentSchema = new Schema({
  ownerId: { type: oid, required: true, index: true }, recordId: oid,
  hash: { type: String, required: true }, name: { type: String, required: true }, mimeType: { type: String, required: true }, size: { type: Number, required: true },
  kind: { type: String, required: true, enum: ['source', 'attachment'] }, sheetNames: { type: [String], default: [] }
}, { timestamps: true })
documentSchema.index({ ownerId: 1, hash: 1 }, { unique: true })
const batchSchema = new Schema({
  ownerId: { type: oid, required: true, index: true }, documentId: { type: oid, required: true }, hash: { type: String, required: true },
  sheet: { type: String, required: true }, headerRow: { type: Number, required: true },
  mapping: { type: Schema.Types.Mixed, required: true }, defaults: { type: Schema.Types.Mixed, required: true }, extras: { type: [Schema.Types.Mixed], default: [] },
  counts: { type: Schema.Types.Mixed, required: true }, recordIds: { type: [oid], default: [] }, operation: Schema.Types.Mixed
}, { timestamps: true })
const templateSchema = new Schema({
  ownerId: { type: oid, required: true, index: true }, name: { type: String, required: true },
  service: { type: String, default: '' }, account: { type: String, default: '' }, currency: { type: String, default: '' },
  headers: { type: [String], default: [] }, mapping: { type: Schema.Types.Mixed, required: true }, extras: { type: [Schema.Types.Mixed], default: [] }, revision: { type: Number, required: true }, operations: { type: [Schema.Types.Mixed], default: [] }
}, { timestamps: true })
templateSchema.index({ ownerId: 1, name: 1 }, { unique: true })
// One research row per record: the URL → company + T number lookup through the research worker. state idle | queued | working |
// ready | failed | confirmed; failure '' | not_claimed | worker_lost | research_failed (why a row is failed).
const researchSchema = new Schema({
  ownerId: { type: oid, required: true }, recordId: { type: oid, required: true },
  revision: { type: Number, default: 0 }, state: { type: String, default: 'idle' }, requestId: String, instruction: String, operation: Schema.Types.Mixed,
  context: Schema.Types.Mixed, sources: { type: [Schema.Types.Mixed], default: [] }, report: Schema.Types.Mixed, registry: Schema.Types.Mixed,
  events: { type: [Schema.Types.Mixed], default: [] }, history: { type: [Schema.Types.Mixed], default: [] },
  agentId: oid, lease: String, leaseUntil: Date, attempts: { type: Number, default: 0 },
  failure: { type: String, default: '' }, confirmed: Schema.Types.Mixed
}, { timestamps: true })
researchSchema.index({ ownerId: 1, recordId: 1 }, { unique: true })
researchSchema.index({ ownerId: 1, state: 1, updatedAt: 1 })
export const IntakeRecord: mongoose.Model<any> = (mongoose.models.FinanceIntakeRecord as any) || mongoose.model('FinanceIntakeRecord', recordSchema, 'financeintakerecords')
export const IntakeDocument: mongoose.Model<any> = (mongoose.models.FinanceIntakeDocument as any) || mongoose.model('FinanceIntakeDocument', documentSchema, 'financeintakedocuments')
export const IntakeBatch: mongoose.Model<any> = (mongoose.models.FinanceIntakeBatch as any) || mongoose.model('FinanceIntakeBatch', batchSchema, 'financeintakebatches')
export const IntakeTemplate: mongoose.Model<any> = (mongoose.models.FinanceIntakeTemplate as any) || mongoose.model('FinanceIntakeTemplate', templateSchema, 'financeintaketemplates')
export const IntakeResearch: mongoose.Model<any> = (mongoose.models.FinanceIntakeResearch as any) || mongoose.model('FinanceIntakeResearch', researchSchema, 'financeintakeresearch')
export async function initializeIntake() { await Promise.all([IntakeRecord.init(), IntakeDocument.init(), IntakeBatch.init(), IntakeTemplate.init(), IntakeResearch.init()]) }
