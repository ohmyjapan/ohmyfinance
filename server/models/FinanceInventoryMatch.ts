import mongoose, { Schema } from 'mongoose'
const schema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, required: true },
  accountId: { type: Schema.Types.ObjectId, required: true },
  importId: { type: Schema.Types.ObjectId, required: true },
  line: { type: Number, required: true }, key: { type: String, required: true },
  sourceHash: { type: String, required: true }, merchant: { type: String, required: true },
  packet: { type: Schema.Types.Mixed, required: true }, packetHash: { type: String, required: true },
  revision: { type: Number, default: 0 }, decision: Schema.Types.Mixed,
  history: { type: [Schema.Types.Mixed], default: [] }
}, { timestamps: true })
schema.index({ ownerId: 1, importId: 1, line: 1 }, { unique: true })
schema.index({ ownerId: 1, accountId: 1, merchant: 1, updatedAt: -1 })
export const FinanceInventoryMatch = (mongoose.models.FinanceInventoryMatch as mongoose.Model<any>) || mongoose.model('FinanceInventoryMatch', schema)
