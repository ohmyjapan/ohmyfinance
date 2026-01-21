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
  createdAt: Date
  updatedAt: Date
}

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
  metadata: Schema.Types.Mixed
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
