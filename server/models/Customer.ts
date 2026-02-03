import mongoose, { Document, Schema } from 'mongoose'

export interface ICustomer extends Document {
  name: string
  email?: string
  phone?: string
  company?: string
  invoiceNumber?: string  // T invoice number (適格請求書発行事業者登録番号)
  isForeign?: boolean     // 海外企業
  address?: {
    line1?: string
    line2?: string
    city?: string
    state?: string
    postalCode?: string
    country?: string
  }
  notes?: string
  tags?: string[]
  metadata?: Record<string, any>
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

const AddressSchema = new Schema({
  line1: String,
  line2: String,
  city: String,
  state: String,
  postalCode: String,
  country: String
}, { _id: false })

const CustomerSchema = new Schema<ICustomer>({
  name: { type: String, required: true },
  email: { type: String, index: true },
  phone: String,
  company: String,
  invoiceNumber: String,  // T invoice number (適格請求書発行事業者登録番号) e.g. T1234567890123
  isForeign: { type: Boolean, default: false },  // 海外企業
  address: AddressSchema,
  notes: String,
  tags: [String],
  metadata: Schema.Types.Mixed,
  isActive: { type: Boolean, default: true }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

CustomerSchema.virtual('id').get(function() {
  return this._id.toHexString()
})

CustomerSchema.index({ name: 'text', email: 'text', company: 'text' })

export default mongoose.models.Customer || mongoose.model<ICustomer>('Customer', CustomerSchema)
