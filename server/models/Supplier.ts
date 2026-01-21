import mongoose, { Document, Schema } from 'mongoose'

export interface ISupplier extends Document {
  name: string
  companyInfo?: string
  address?: string
  contactPerson?: string
  email?: string
  phone?: string
  website?: string
  notes?: string
  tags?: string[]
  metadata?: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

const SupplierSchema = new Schema<ISupplier>({
  name: { type: String, required: true },
  companyInfo: String,
  address: String,
  contactPerson: String,
  email: String,
  phone: String,
  website: String,
  notes: String,
  tags: [String],
  metadata: Schema.Types.Mixed
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

SupplierSchema.virtual('id').get(function() {
  return this._id.toHexString()
})

SupplierSchema.index({ name: 'text', companyInfo: 'text' })

export default mongoose.models.Supplier || mongoose.model<ISupplier>('Supplier', SupplierSchema)
