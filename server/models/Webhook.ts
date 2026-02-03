// server/models/Webhook.ts
import mongoose, { Schema, Document } from 'mongoose'

export interface IWebhook extends Document {
  organizationId: mongoose.Types.ObjectId
  name: string
  url: string
  events: string[]
  secret?: string
  isActive: boolean
  headers?: Record<string, string>
  lastTriggered?: Date
  lastStatus?: number
  failCount: number
  createdBy?: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const WebhookSchema = new Schema<IWebhook>({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  name: { type: String, required: true },
  url: { type: String, required: true },
  events: [{ type: String, enum: [
    'transaction.created',
    'transaction.updated',
    'transaction.deleted',
    'receipt.created',
    'receipt.matched',
    'invoice.created',
    'invoice.paid',
    'payment.due',
    'payment.overdue',
    'budget.exceeded'
  ]}],
  secret: String,
  isActive: { type: Boolean, default: true },
  headers: { type: Map, of: String },
  lastTriggered: Date,
  lastStatus: Number,
  failCount: { type: Number, default: 0 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true
})

WebhookSchema.index({ organizationId: 1, isActive: 1 })

export default mongoose.models.Webhook || mongoose.model<IWebhook>('Webhook', WebhookSchema)
