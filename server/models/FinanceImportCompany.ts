import mongoose, { Schema } from 'mongoose'

// Explicit posting intent, separate from the account's payment-calendar binding.
// No public update/restore route writes this collection.
const schema = new Schema({
  importId: { type: Schema.Types.ObjectId, required: true, unique: true, immutable: true },
  ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  accountId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  organizationId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  sourceHash: { type: String, required: true, immutable: true },
  createdAt: { type: Date, default: Date.now, immutable: true }
})

export const FinanceImportCompany = mongoose.models.FinanceImportCompany || mongoose.model('FinanceImportCompany', schema)
