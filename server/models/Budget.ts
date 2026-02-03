// server/models/Budget.ts
import mongoose, { Schema, Document } from 'mongoose'

export interface IBudget extends Document {
  organizationId: mongoose.Types.ObjectId
  name: string
  category?: string
  amount: number
  period: 'monthly' | 'quarterly' | 'yearly'
  startDate: Date
  endDate?: Date
  alertThreshold: number // percentage (e.g., 80 means alert at 80% spent)
  isActive: boolean
  createdBy?: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const BudgetSchema = new Schema<IBudget>({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  name: { type: String, required: true },
  category: { type: String },
  amount: { type: Number, required: true },
  period: { type: String, enum: ['monthly', 'quarterly', 'yearly'], default: 'monthly' },
  startDate: { type: Date, required: true },
  endDate: { type: Date },
  alertThreshold: { type: Number, default: 80 },
  isActive: { type: Boolean, default: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true
})

BudgetSchema.index({ organizationId: 1, category: 1 })
BudgetSchema.index({ organizationId: 1, isActive: 1 })

export default mongoose.models.Budget || mongoose.model<IBudget>('Budget', BudgetSchema)
