import mongoose, { Schema } from 'mongoose'
const oid = Schema.Types.ObjectId, mixed = Schema.Types.Mixed
const workflow = new Schema({
  ownerId: { type: oid, required: true }, accountId: { type: oid, required: true },
  importId: { type: oid, required: true }, line: { type: Number, required: true },
  key: { type: String, required: true }, sourceHash: { type: String, required: true },
  payment: { type: mixed, required: true }, purchaseId: oid,
  version: { type: Number, default: 1 }, revision: { type: Number, default: 0 },
  steps: { type: mixed, default: {} }, summary: mixed,
  events: { type: [mixed], default: [] }, lastAssessedAt: Date
}, { timestamps: true })
workflow.index({ ownerId: 1, accountId: 1, key: 1 }, { unique: true })
workflow.index({ ownerId: 1, importId: 1, line: 1 }, { unique: true })
workflow.index({ ownerId: 1, 'summary.state': 1, 'payment.date': 1 })

const config = new Schema({
  ownerId: { type: oid, required: true, unique: true },
  revision: { type: Number, default: 0 }, enabled: { type: Boolean, default: false },
  accountIds: [oid], workerId: oid, from: String, through: String,
  firstRunAt: Date, workerSeenAt: Date, workerCapabilities: mixed,
  lease: String, leaseUntil: Date
}, { timestamps: true })

const run = new Schema({
  ownerId: { type: oid, required: true }, day: { type: String, required: true },
  status: { type: String, default: 'queued' }, policy: mixed,
  agentId: oid, lease: String, leaseUntil: Date, startedAt: Date, deadline: Date,
  completedAt: Date, summary: mixed, sourceStatus: { type: mixed, default: {} },
  sourceIds: [oid], processed: { type: [String], default: [] }
}, { timestamps: true })
run.index({ ownerId: 1, day: 1 }, { unique: true })
run.index({ ownerId: 1, status: 1, day: 1 })

const source = new Schema({
  ownerId: { type: oid, required: true }, runId: { type: oid, required: true },
  accountIds: [oid], kind: { type: String, required: true }, name: String,
  hash: { type: String, required: true }, size: Number, capturedAt: Date,
  scope: mixed, complete: { type: Boolean, required: true }
}, { timestamps: true })
source.index({ ownerId: 1, runId: 1, kind: 1 }, { unique: true })

export const FinanceWorkflow: mongoose.Model<any> = mongoose.models.FinanceWorkflow || mongoose.model('FinanceWorkflow', workflow)
export const FinanceWorkflowConfig: mongoose.Model<any> = mongoose.models.FinanceWorkflowConfig || mongoose.model('FinanceWorkflowConfig', config)
export const FinanceWorkflowRun: mongoose.Model<any> = mongoose.models.FinanceWorkflowRun || mongoose.model('FinanceWorkflowRun', run)
export const FinanceWorkflowSource: mongoose.Model<any> = mongoose.models.FinanceWorkflowSource || mongoose.model('FinanceWorkflowSource', source)

const receipt = new Schema({ ownerId: { type: oid, required: true }, documentId: { type: oid, required: true }, hash: { type: String, required: true }, reading: mixed, models: [String] }, { timestamps: true })
receipt.index({ ownerId: 1, documentId: 1, hash: 1 }, { unique: true })
const investigation = new Schema({ ownerId: { type: oid, required: true }, workflowId: { type: oid, required: true }, revision: { type: Number, default: 0 }, fingerprint: String, context: mixed, report: mixed, models: [String], artifacts: { type: [mixed], default: [] }, status: { type: String, default: 'pending' }, decisions: { type: [mixed], default: [] } }, { timestamps: true })
investigation.index({ ownerId: 1, workflowId: 1 }, { unique: true })
export const FinanceWorkflowReceipt: mongoose.Model<any> = mongoose.models.FinanceWorkflowReceipt || mongoose.model('FinanceWorkflowReceipt', receipt)
export const FinanceWorkflowInvestigation: mongoose.Model<any> = mongoose.models.FinanceWorkflowInvestigation || mongoose.model('FinanceWorkflowInvestigation', investigation)
