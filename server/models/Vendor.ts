// server/models/Vendor.ts
import mongoose, { Schema, Document } from 'mongoose'

export interface IVendor extends Document {
  organizationId: mongoose.Types.ObjectId
  name: string
  email?: string
  phone?: string
  address?: string
  website?: string
  category?: string
  taxId?: string
  notes?: string
  isActive: boolean
  totalSpent: number
  transactionCount: number
  lastTransactionDate?: Date
  createdBy?: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const VendorSchema = new Schema<IVendor>({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  name: { type: String, required: true },
  email: String,
  phone: String,
  address: String,
  website: String,
  category: String,
  taxId: String,
  notes: String,
  isActive: { type: Boolean, default: true },
  totalSpent: { type: Number, default: 0 },
  transactionCount: { type: Number, default: 0 },
  lastTransactionDate: Date,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true
})

VendorSchema.index({ organizationId: 1, name: 1 }, { unique: true })
VendorSchema.index({ name: 'text' })
VendorSchema.index({ organizationId: 1, category: 1 })

export default mongoose.models.Vendor || mongoose.model<IVendor>('Vendor', VendorSchema)
