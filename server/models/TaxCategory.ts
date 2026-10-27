// server/models/TaxCategory.ts
import mongoose, { Document, Schema } from 'mongoose'

export interface ITaxCategory extends Document {
    organizationId: mongoose.Types.ObjectId
    name: string
    rate?: number
    description?: string
    createdAt: Date
    updatedAt: Date
}

const TaxCategorySchema = new Schema<ITaxCategory>({
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true },
    rate: { type: Number },
    description: { type: String }
}, { timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } })

TaxCategorySchema.index({ organizationId: 1, name: 1 })

// Virtual for id
TaxCategorySchema.virtual('id').get(function() {
    return this._id.toHexString()
})

TaxCategorySchema.set('toJSON', { virtuals: true })
TaxCategorySchema.set('toObject', { virtuals: true })

export default mongoose.models.TaxCategory || mongoose.model<ITaxCategory>('TaxCategory', TaxCategorySchema)
