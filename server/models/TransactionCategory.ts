// server/models/TransactionCategory.ts
import mongoose, { Document, Schema } from 'mongoose'

export interface ITransactionCategory extends Document {
    name: string
    description?: string
    createdAt: Date
    updatedAt: Date
}

const TransactionCategorySchema = new Schema<ITransactionCategory>({
    name: { type: String, required: true },
    description: { type: String }
}, { timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } })

// Virtual for id
TransactionCategorySchema.virtual('id').get(function() {
    return this._id.toHexString()
})

TransactionCategorySchema.set('toJSON', { virtuals: true })
TransactionCategorySchema.set('toObject', { virtuals: true })

export default mongoose.models.TransactionCategory || mongoose.model<ITransactionCategory>('TransactionCategory', TransactionCategorySchema)
