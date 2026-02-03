// server/models/Invoice.ts
import mongoose, { Schema, Document } from 'mongoose'

export interface IInvoiceItem {
  description: string
  quantity: number
  unitPrice: number
  amount: number
  tax?: number
}

export interface IInvoice extends Document {
  organizationId: mongoose.Types.ObjectId
  invoiceNumber: string
  transactionId?: mongoose.Types.ObjectId
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'
  issueDate: Date
  dueDate: Date
  paidDate?: Date

  // From
  from: {
    name: string
    address?: string
    email?: string
    phone?: string
    taxId?: string
  }

  // To
  to: {
    name: string
    address?: string
    email?: string
    phone?: string
  }

  // Items
  items: IInvoiceItem[]

  // Totals
  subtotal: number
  taxRate: number
  taxAmount: number
  total: number
  currency: string

  // Additional
  notes?: string
  terms?: string
  bankDetails?: string

  createdBy?: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const InvoiceItemSchema = new Schema<IInvoiceItem>({
  description: { type: String, required: true },
  quantity: { type: Number, required: true, default: 1 },
  unitPrice: { type: Number, required: true },
  amount: { type: Number, required: true },
  tax: Number
}, { _id: false })

const InvoiceSchema = new Schema<IInvoice>({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  invoiceNumber: { type: String, required: true },
  transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction' },
  status: {
    type: String,
    enum: ['draft', 'sent', 'paid', 'overdue', 'cancelled'],
    default: 'draft'
  },
  issueDate: { type: Date, required: true, default: Date.now },
  dueDate: { type: Date, required: true },
  paidDate: Date,

  from: {
    name: { type: String, required: true },
    address: String,
    email: String,
    phone: String,
    taxId: String
  },

  to: {
    name: { type: String, required: true },
    address: String,
    email: String,
    phone: String
  },

  items: [InvoiceItemSchema],

  subtotal: { type: Number, required: true },
  taxRate: { type: Number, default: 10 },
  taxAmount: { type: Number, default: 0 },
  total: { type: Number, required: true },
  currency: { type: String, default: 'JPY' },

  notes: String,
  terms: String,
  bankDetails: String,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true
})

InvoiceSchema.index({ organizationId: 1, invoiceNumber: 1 }, { unique: true })
InvoiceSchema.index({ organizationId: 1, status: 1 })
InvoiceSchema.index({ organizationId: 1, dueDate: 1 })

export default mongoose.models.Invoice || mongoose.model<IInvoice>('Invoice', InvoiceSchema)
