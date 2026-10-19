// server/models/Budget.ts
import mongoose, { Schema, Document } from 'mongoose'

export interface IBudget extends Document<mongoose.Types.ObjectId> {
  organizationId: mongoose.Types.ObjectId
  name: string
  category?: string
  amount: number
  currency?: string // ISO 4217 code saved with the budget; never inferred from the viewer's locale
  period: 'monthly' | 'quarterly' | 'yearly'
  startDate: Date
  endDate?: Date
  alertThreshold: number // percentage (e.g., 80 means alert at 80% spent)
  isActive: boolean
  createdBy?: mongoose.Types.ObjectId
  naviOperation?: Record<string, unknown> // internal durable marker; only trusted server operations set it
  createdAt: Date
  updatedAt: Date
}

const BudgetSchema = new Schema<IBudget>({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  name: { type: String, required: true },
  category: { type: String },
  amount: { type: Number, required: true },
  currency: { type: String, match: /^[A-Z]{3}$/ },
  period: { type: String, enum: ['monthly', 'quarterly', 'yearly'], default: 'monthly' },
  startDate: { type: Date, required: true },
  endDate: { type: Date },
  alertThreshold: { type: Number, default: 80 },
  isActive: { type: Boolean, default: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  naviOperation: Schema.Types.Mixed
}, {
  timestamps: true
})

BudgetSchema.index({ organizationId: 1, category: 1 })
BudgetSchema.index({ organizationId: 1, isActive: 1 })

export default mongoose.models.Budget as mongoose.Model<IBudget> | undefined || mongoose.model<IBudget>('Budget', BudgetSchema)
