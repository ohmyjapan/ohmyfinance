import mongoose, { Schema } from 'mongoose'
const schema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, required: true }, accountId: { type: Schema.Types.ObjectId, required: true },
  merchant: { type: String, required: true }, descriptor: { type: String, required: true },
  supplierId: { type: Schema.Types.ObjectId, required: true }, supplierKey: { type: String, required: true },
  revision: { type: Number, required: true }, enabled: { type: Boolean, required: true },
  reason: String, sourceUrl: String, confirmedAt: Date, source: Schema.Types.Mixed,
  history: { type: [Schema.Types.Mixed], default: [] }
}, { timestamps: true })
schema.index({ ownerId: 1, accountId: 1, merchant: 1 }, { unique: true })
export const FinanceMerchantLink = mongoose.models.FinanceMerchantLink || mongoose.model('FinanceMerchantLink', schema)
