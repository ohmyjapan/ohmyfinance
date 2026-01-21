import mongoose, { Document, Schema } from 'mongoose'

export interface ICustomer extends Document {
  name: string
  email?: string
  phone?: string
  company?: string
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
  address: AddressSchema,
  notes: String,
  tags: [String],
  metadata: Schema.Types.Mixed
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
