// server/models/Payment.ts
import mongoose, { Schema, Document } from 'mongoose'

export interface IBankTransferInfo {
  bankName: string
  accountNumber: string
  accountHolder: string
  routingNumber?: string
  swiftCode?: string
  iban?: string
  notes?: string
}

export interface IPayment extends Document {
  title: string
  amount: number
  currency: string
  dueDate: Date
  type: 'expense' | 'income'
  status: 'pending' | 'paid' | 'overdue' | 'cancelled'
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
  accountNumber: { type: String, required: true },
  accountHolder: { type: String, required: true },
  routingNumber: { type: String },
  swiftCode: { type: String },
  iban: { type: String },
  notes: { type: String }
}, { _id: false })

const PaymentSchema = new Schema<IPayment>({
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
    default: 'USD',
    enum: ['USD', 'EUR', 'GBP', 'JPY', 'KRW', 'CNY']
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
    enum: ['pending', 'paid', 'overdue', 'cancelled']
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
      delete ret._id
      delete ret.__v
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
