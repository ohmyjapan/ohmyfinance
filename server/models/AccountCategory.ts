import mongoose, { Document, Schema } from 'mongoose'

export interface IAccountCategory extends Document {
  name: string
  code?: string
  description?: string
  parentId?: mongoose.Types.ObjectId
  type?: 'income' | 'expense' | 'asset' | 'liability'
  isActive: boolean
  order?: number
  metadata?: Record<string, any>
  companyRegistrations?: { organizationId: mongoose.Types.ObjectId, registeredBy: mongoose.Types.ObjectId, registeredAt: Date, via: 'created' | 'registered' }[]
  createdAt: Date
  updatedAt: Date
}

// A company made this shared account available to its Navi (native create with a selected company, or explicit registration).
// Availability and provenance only: it is not company ownership of the shared chart, and legacy records are never adopted.
// Hidden from ordinary reads (select: false); only the server's registration filters and writes use it.
const CompanyRegistrationSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  registeredBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  registeredAt: { type: Date, required: true },
  via: { type: String, enum: ['created', 'registered'], required: true }
}, { _id: false })

const AccountCategorySchema = new Schema<IAccountCategory>({
  name: { type: String, required: true },
  code: { type: String, index: true },
  description: String,
  parentId: { type: Schema.Types.ObjectId, ref: 'AccountCategory' },
  type: {
    type: String,
    enum: ['income', 'expense', 'asset', 'liability']
  },
  isActive: { type: Boolean, default: true },
  order: { type: Number, default: 0 },
  metadata: Schema.Types.Mixed,
  companyRegistrations: { type: [CompanyRegistrationSchema], select: false, default: undefined }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

AccountCategorySchema.virtual('id').get(function() {
  return this._id.toHexString()
})

// Virtual for getting children
AccountCategorySchema.virtual('children', {
  ref: 'AccountCategory',
  localField: '_id',
  foreignField: 'parentId'
})

export default mongoose.models.AccountCategory || mongoose.model<IAccountCategory>('AccountCategory', AccountCategorySchema)
