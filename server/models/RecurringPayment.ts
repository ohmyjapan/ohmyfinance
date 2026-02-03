// server/models/RecurringPayment.ts
import mongoose, { Schema, Document } from 'mongoose'

export interface IRecurringPayment extends Document {
  name: string
  description?: string
  amount: number
  currency: string
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'
  dayOfMonth?: number  // For monthly/quarterly/yearly
  dayOfWeek?: number   // For weekly/biweekly (0-6, Sunday-Saturday)
  startDate: Date
  endDate?: Date
  nextDueDate: Date
  lastGeneratedDate?: Date
  status: 'active' | 'paused' | 'completed' | 'cancelled'
  source: string
  customer: {
    name: string
    email?: string
    id?: string
  }
  category?: string
  tags?: string[]
  notes?: string
  autoGenerate: boolean  // Whether to auto-create transactions
  generatedTransactionIds?: mongoose.Types.ObjectId[]
  metadata?: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

const RecurringPaymentSchema = new Schema<IRecurringPayment>({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'JPY'
  },
  frequency: {
    type: String,
    required: true,
    enum: ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']
  },
  dayOfMonth: {
    type: Number,
    min: 1,
    max: 31
  },
  dayOfWeek: {
    type: Number,
    min: 0,
    max: 6
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: Date,
  nextDueDate: {
    type: Date,
    required: true
  },
  lastGeneratedDate: Date,
  status: {
    type: String,
    enum: ['active', 'paused', 'completed', 'cancelled'],
    default: 'active'
  },
  source: {
    type: String,
    default: 'manual'
  },
  customer: {
    name: { type: String, required: true },
    email: String,
    id: String
  },
  category: String,
  tags: [String],
  notes: String,
  autoGenerate: {
    type: Boolean,
    default: true
  },
  generatedTransactionIds: [{
    type: Schema.Types.ObjectId,
    ref: 'Transaction'
  }],
  metadata: {
    type: Map,
    of: Schema.Types.Mixed
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_, ret) => {
      ret.id = ret._id.toString()
      delete ret._id
      delete ret.__v
      return ret
    }
  }
})

// Indexes
RecurringPaymentSchema.index({ status: 1, nextDueDate: 1 })
RecurringPaymentSchema.index({ 'customer.name': 1 })

export default mongoose.models.RecurringPayment ||
  mongoose.model<IRecurringPayment>('RecurringPayment', RecurringPaymentSchema)
