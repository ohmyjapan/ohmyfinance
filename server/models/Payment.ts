// server/models/Payment.ts
import mongoose, { Schema, Document } from 'mongoose'

export interface IBankTransferInfo {
  bankName: string           // 銀行名
  branchName: string         // 支店名
  accountType: 'ordinary' | 'current' | 'savings'  // 口座種別
  accountNumber: string      // 口座番号
  accountHolder: string      // 口座名義
}

export interface IPayment extends Document {
  organizationId?: mongoose.Types.ObjectId
  createdBy?: mongoose.Types.ObjectId
  deletedAt?: Date
  posting?: { key: string; payload: Record<string, any>; state: 'pending' | 'posted' | 'deleted'; transactionId?: string }
  title: string
  amount: number
  currency: string
  dueDate: Date
  type: 'expense' | 'income'
  status: 'pending' | 'paid' | 'overdue' | 'cancelled' | 'completed'
  category: string
  recurring: boolean
  recurringFrequency?: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  bankTransfer?: IBankTransferInfo
  notes?: string
  createdAt: Date
  updatedAt: Date
}

const BankTransferInfoSchema = new Schema({
  bankName: { type: String, required: true },
  branchName: { type: String, required: true },
  accountType: { type: String, enum: ['ordinary', 'current', 'savings'], default: 'ordinary' },
  accountNumber: { type: String, required: true },
  accountHolder: { type: String, required: true }
}, { _id: false })

const PaymentSchema = new Schema<IPayment>({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', immutable: true, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', immutable: true },
  deletedAt: Date,
  posting: { type: Schema.Types.Mixed, select: false },
  title: {
    type: String,
    required: true,
    trim: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    required: true,
    default: 'JPY',
    enum: ['JPY', 'USD', 'EUR', 'GBP', 'KRW', 'CNY']
  },
  dueDate: {
    type: Date,
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: ['expense', 'income']
  },
  status: {
    type: String,
    required: true,
    default: 'pending',
    enum: ['pending', 'paid', 'overdue', 'cancelled', 'completed']
  },
  category: {
    type: String,
    required: true
  },
  recurring: {
    type: Boolean,
    default: false
  },
  recurringFrequency: {
    type: String,
    enum: ['weekly', 'monthly', 'quarterly', 'yearly']
  },
  bankTransfer: {
    type: BankTransferInfoSchema
  },
  notes: {
    type: String
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_, ret) => {
      ret.id = ret._id.toString()
      delete (ret as Partial<Pick<typeof ret, '_id'>>)._id
      delete (ret as Partial<Pick<typeof ret, '__v'>>).__v
      return ret
    }
  }
})

// Indexes
PaymentSchema.index({ dueDate: 1 })
PaymentSchema.index({ type: 1 })
PaymentSchema.index({ status: 1 })
PaymentSchema.index({ category: 1 })

export const Payment = mongoose.models.Payment || mongoose.model<IPayment>('Payment', PaymentSchema)
