// server/models/Category.ts
import mongoose, { Schema, Document } from 'mongoose'

export interface ICategory extends Document {
  name: string
  type: 'income' | 'expense' | 'both'
  color: string
  icon?: string
  parentId?: mongoose.Types.ObjectId
  isDefault: boolean
  order: number
  createdAt: Date
  updatedAt: Date
}

const CategorySchema = new Schema<ICategory>({
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['income', 'expense', 'both'],
    default: 'both'
  },
  color: {
    type: String,
    default: '#7c3aed'
  },
  icon: String,
  parentId: {
    type: Schema.Types.ObjectId,
    ref: 'Category'
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  order: {
    type: Number,
    default: 0
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

CategorySchema.index({ name: 1 })
CategorySchema.index({ type: 1 })
CategorySchema.index({ order: 1 })

export default mongoose.models.Category || mongoose.model<ICategory>('Category', CategorySchema)
