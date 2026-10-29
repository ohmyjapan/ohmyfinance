// server/models/TaxCategory.ts
import mongoose, { Document, Schema } from 'mongoose'

export interface ITaxCategory extends Document {
    name: string
    rate?: number
    description?: string
    createdAt: Date
    updatedAt: Date
}

const TaxCategorySchema = new Schema<ITaxCategory>({
    name: { type: String, required: true },
    rate: { type: Number },
    description: { type: String }
}, { timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } })

// Virtual for id
TaxCategorySchema.virtual('id').get(function() {
    return this._id.toHexString()
})

TaxCategorySchema.set('toJSON', { virtuals: true })
TaxCategorySchema.set('toObject', { virtuals: true })

export default mongoose.models.TaxCategory || mongoose.model<ITaxCategory>('TaxCategory', TaxCategorySchema)
