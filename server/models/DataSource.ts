import mongoose, { Document, Schema } from 'mongoose'

export interface IDataSource extends Document {
  name: string
  type: string
  description?: string
  config?: Record<string, any>
  isActive: boolean
  lastSyncAt?: Date
  metadata?: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

const DataSourceSchema = new Schema<IDataSource>({
  name: { type: String, required: true },
  type: { type: String, required: true, unique: true, index: true },
  description: String,
  config: Schema.Types.Mixed,
  isActive: { type: Boolean, default: true },
  lastSyncAt: Date,
  metadata: Schema.Types.Mixed
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

DataSourceSchema.virtual('id').get(function() {
  return this._id.toHexString()
})

export default mongoose.models.DataSource || mongoose.model<IDataSource>('DataSource', DataSourceSchema)
