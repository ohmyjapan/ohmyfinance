import mongoose, { Schema } from 'mongoose'
// Native bank classification drafts (plan omf-rakuten-native-shiwake-20261020 §6). One draft per owner bank row, bound to the
// one company that generated it (unique owner+bankRow: a source row is never classified or registered for two companies).
// `source` is the row snapshot the draft was reviewed against (revision, fingerprint, date, amount, direction, currency,
// description); `proposed` the latest generated proposal (evidence, calendar candidates, unresolved reasons); `values` the
// current classification (owner corrections are `manual` and never overwritten by a refresh); `revision` guards every write and
// `history` keeps each before/after. `reservedTransactionId` is the durable native Transaction ID reserved at creation: an
// explicit registration creates exactly that Transaction (crash/retry/concurrency resume the same effect). `registration`
// is {state reserved|registered|linked, kind create|link, transactionId, values, payload, source, at, by}; a link points to an
// existing company Transaction without rewriting it (one Transaction links to one source only, per company).
const oid = Schema.Types.ObjectId, mixed = Schema.Types.Mixed, options = { timestamps: true, minimize: false }
const draft = new Schema({ ownerId: { type: oid, required: true }, organizationId: { type: oid, required: true }, bankAccountId: { type: oid, required: true }, bankRowId: { type: oid, required: true }, bankRowKey: { type: String, required: true }, payeeKey: { type: String, default: '' }, direction: { type: String, enum: ['in', 'out'], required: true }, source: { type: mixed, required: true }, proposed: { type: mixed, default: null }, proposalHash: { type: String, default: '' }, values: { type: mixed, required: true }, manual: { type: Boolean, default: false }, revision: { type: Number, default: 1 }, history: { type: [mixed], default: [] }, reservedTransactionId: { type: oid, required: true }, registration: { type: mixed, default: null }, version: String }, options)
draft.index({ ownerId: 1, bankRowId: 1 }, { unique: true })
draft.index({ reservedTransactionId: 1 }, { unique: true })
draft.index({ organizationId: 1, bankAccountId: 1 })
draft.index({ organizationId: 1, 'registration.transactionId': 1 }, { unique: true, partialFilterExpression: { 'registration.transactionId': { $exists: true } } })
draft.index({ organizationId: 1, payeeKey: 1, 'registration.state': 1 })
// Explicit reusable teaching: an approved exact payee decision of one company ({purpose, accountCategoryId, supplierId…} or the
// own-company transfer marker), revisioned with history. Proposals use it only for the exact normalized payee and direction.
const teaching = new Schema({ ownerId: { type: oid, required: true }, organizationId: { type: oid, required: true }, payeeKey: { type: String, required: true }, direction: { type: String, enum: ['in', 'out'], required: true }, values: { type: mixed, required: true }, sourceDraftId: oid, revision: { type: Number, default: 0 }, history: { type: [mixed], default: [] } }, options)
teaching.index({ organizationId: 1, payeeKey: 1, direction: 1 }, { unique: true })
export const BankClassification: mongoose.Model<any> = mongoose.models.FinanceBankClassification || mongoose.model('FinanceBankClassification', draft, 'financebankclassifications')
export const BankTeaching: mongoose.Model<any> = mongoose.models.FinanceBankTeaching || mongoose.model('FinanceBankTeaching', teaching, 'financebankteachings')
export async function initializeBankClassification() { await Promise.all([BankClassification.init(), BankTeaching.init()]) }
