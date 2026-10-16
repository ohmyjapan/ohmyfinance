// Intake (購入受付) collections, all owner-scoped (plan omf-intake-feature-20261016 §2). Nothing here is read by the ledger,
// the card imports, drafts or entries; the service calls init() on all four before the first write (as initializeFinance does).
import mongoose, { Schema } from 'mongoose'
const oid = Schema.Types.ObjectId
const recordSchema = new Schema({
  ownerId: { type: oid, required: true, index: true },
  key: { type: String, required: true },
  values: { type: Schema.Types.Mixed, required: true },
  provenance: { type: [Schema.Types.Mixed], default: [] },
  history: { type: [Schema.Types.Mixed], default: [] },
  revision: { type: Number, required: true },
  identityReview: { type: Boolean, default: false },
  archived: { type: Boolean, default: false }, archivedAt: Date
}, { timestamps: true })
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
  mapping: { type: Schema.Types.Mixed, required: true }, defaults: { type: Schema.Types.Mixed, required: true },
  counts: { type: Schema.Types.Mixed, required: true }, recordIds: { type: [oid], default: [] }
}, { timestamps: true })
const templateSchema = new Schema({
  ownerId: { type: oid, required: true, index: true }, name: { type: String, required: true },
  service: { type: String, default: '' }, account: { type: String, default: '' }, currency: { type: String, default: '' },
  headers: { type: [String], default: [] }, mapping: { type: Schema.Types.Mixed, required: true }, revision: { type: Number, required: true }
}, { timestamps: true })
templateSchema.index({ ownerId: 1, name: 1 }, { unique: true })
export const IntakeRecord: mongoose.Model<any> = (mongoose.models.FinanceIntakeRecord as any) || mongoose.model('FinanceIntakeRecord', recordSchema, 'financeintakerecords')
export const IntakeDocument: mongoose.Model<any> = (mongoose.models.FinanceIntakeDocument as any) || mongoose.model('FinanceIntakeDocument', documentSchema, 'financeintakedocuments')
export const IntakeBatch: mongoose.Model<any> = (mongoose.models.FinanceIntakeBatch as any) || mongoose.model('FinanceIntakeBatch', batchSchema, 'financeintakebatches')
export const IntakeTemplate: mongoose.Model<any> = (mongoose.models.FinanceIntakeTemplate as any) || mongoose.model('FinanceIntakeTemplate', templateSchema, 'financeintaketemplates')
export async function initializeIntake() { await Promise.all([IntakeRecord.init(), IntakeDocument.init(), IntakeBatch.init(), IntakeTemplate.init()]) }
