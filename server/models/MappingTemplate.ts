// server/models/MappingTemplate.ts
import mongoose, { Schema, Document } from 'mongoose'

export interface IFieldMapping {
  sourceField: string
  targetField: string
  format: string
}

export interface IMappingTemplate extends Document {
  name: string
  description?: string
  sourceType: string // 'credit_card', 'payment_gateway', 'overseas', 'custom'
  mappings: IFieldMapping[]
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}

const FieldMappingSchema = new Schema<IFieldMapping>({
  sourceField: { type: String, required: true },
  targetField: { type: String, required: true },
  format: { type: String, default: 'text' }
}, { _id: false })

const MappingTemplateSchema = new Schema<IMappingTemplate>({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String
  },
  sourceType: {
    type: String,
    required: true,
    enum: ['credit_card', 'payment_gateway', 'overseas', 'custom'],
    default: 'custom'
  },
  mappings: [FieldMappingSchema],
  isDefault: {
    type: Boolean,
    default: false
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
MappingTemplateSchema.index({ name: 1 })
MappingTemplateSchema.index({ sourceType: 1 })

export const MappingTemplate = mongoose.models.MappingTemplate || mongoose.model<IMappingTemplate>('MappingTemplate', MappingTemplateSchema)
