import mongoose, { Document, Schema } from 'mongoose'

// Receipt item interface
export interface IReceiptItem {
  description: string
  quantity?: number
  unitPrice?: number
  totalPrice: number
  sku?: string
  category?: string
  tax?: number
  discount?: number
}

// Extracted data interface
export interface IReceiptExtractedData {
  merchant?: string
  amount?: number
  currency?: string
  date?: Date
  tax?: number
  taxRate?: number
  items?: IReceiptItem[]
  merchantAddress?: string
  merchantPhone?: string
  paymentMethod?: string
  receiptNumber?: string
  subtotal?: number
  tip?: number
  discount?: number
  rawText?: string
}

// Main receipt interface
export interface IReceipt extends Document<mongoose.Types.ObjectId> {
  organizationId: mongoose.Types.ObjectId
  filename: string
  originalFilename: string
  size: number
  mimeType?: string
  uploadDate: Date
  amount?: number | null
  currency?: string
  merchant?: string | null
  status: 'matched' | 'unmatched' | 'processing' | 'error'
  transactionId?: mongoose.Types.ObjectId
  fileUrl?: string
  filePath?: string
  thumbnailUrl?: string
  receiptDate?: Date
  category?: 'business' | 'personal' | 'travel' | 'entertainment' | 'office' | 'other'
  notes?: string
  tags?: string[]
  uploadedBy?: mongoose.Types.ObjectId
  taxAmount?: number
  taxRate?: number
  extractedData?: IReceiptExtractedData
  errorMessage?: string
  confidenceScore?: number
  metadata?: Record<string, any>
  // Durable owed badge work of this receipt's link changes (see receiptLinkSyncService): every canonical link write sets it atomically.
  linkSync?: IReceiptLinkSync
  // Bounded Navi operation markers written in the same canonical write (proof for a lost reply).
  naviOperations?: Record<string, any>[]
  createdAt: Date
  updatedAt: Date
}
export interface IReceiptLinkSync {
  rev: string
  pending: boolean
  state: 'pending' | 'synced' | 'manual_review'
  reason?: 'transaction_missing' | 'retries_exhausted' | null
  work: { transactionId: mongoose.Types.ObjectId, event?: 'receipt_matched' | 'receipt_unmatched' | null, key: string }[]
  at: Date
  attempts: number
  nextAttemptAt: Date
  claimToken?: string | null
  claimUntil?: Date | null
  syncedAt?: Date | null
}

// Subdocument schemas
const ReceiptItemSchema = new Schema<IReceiptItem>({
  description: { type: String, required: true },
  quantity: Number,
  unitPrice: Number,
  totalPrice: { type: Number, required: true },
  sku: String,
  category: String,
  tax: Number,
  discount: Number
}, { _id: false })

const ExtractedDataSchema = new Schema<IReceiptExtractedData>({
  merchant: String,
  amount: Number,
  currency: String,
  date: Date,
  tax: Number,
  taxRate: Number,
  items: [ReceiptItemSchema],
  merchantAddress: String,
  merchantPhone: String,
  paymentMethod: String,
  receiptNumber: String,
  subtotal: Number,
  tip: Number,
  discount: Number,
  rawText: String
}, { _id: false })

// Main receipt schema
const ReceiptSchema = new Schema<IReceipt>({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  filename: { type: String, required: true },
  originalFilename: { type: String, required: true },
  size: { type: Number, required: true },
  mimeType: String,
  uploadDate: { type: Date, default: Date.now, index: true },
  amount: Number,
  currency: { type: String, default: 'JPY' },
  merchant: String,
  status: {
    type: String,
    required: true,
    enum: ['matched', 'unmatched', 'processing', 'error'],
    default: 'unmatched',
    index: true
  },
  transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', index: true },
  fileUrl: String,
  filePath: String,
  thumbnailUrl: String,
  receiptDate: Date,
  category: {
    type: String,
    enum: ['business', 'personal', 'travel', 'entertainment', 'office', 'other']
  },
  notes: String,
  tags: [String],
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  taxAmount: Number,
  taxRate: Number,
  extractedData: ExtractedDataSchema,
  errorMessage: String,
  confidenceScore: Number,
  metadata: Schema.Types.Mixed,
  linkSync: new Schema<IReceiptLinkSync>({
    rev: { type: String, required: true },
    pending: { type: Boolean, required: true },
    state: { type: String, enum: ['pending', 'synced', 'manual_review'], required: true },
    reason: { type: String, enum: ['transaction_missing', 'retries_exhausted', null], default: null },
    work: [new Schema({ transactionId: { type: Schema.Types.ObjectId, required: true }, event: { type: String, enum: ['receipt_matched', 'receipt_unmatched', null], default: null }, key: { type: String, required: true } }, { _id: false })],
    at: Date,
    attempts: { type: Number, default: 0 },
    nextAttemptAt: Date,
    claimToken: { type: String, default: null },
    claimUntil: { type: Date, default: null },
    syncedAt: { type: Date, default: null }
  }, { _id: false }),
  naviOperations: [Schema.Types.Mixed]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

// Virtual for id
ReceiptSchema.virtual('id').get(function() {
  return this._id.toHexString()
})

// Indexes for multi-tenancy
ReceiptSchema.index({ organizationId: 1, filename: 1 }, { unique: true })
ReceiptSchema.index({ organizationId: 1, status: 1 })
ReceiptSchema.index({ organizationId: 1, uploadDate: -1 })
// Recovery discovery reads only receipts that owe badge work (a small partial index, never a collection scan per tick).
ReceiptSchema.index({ 'linkSync.state': 1, 'linkSync.nextAttemptAt': 1 }, { partialFilterExpression: { 'linkSync.pending': true } })
// Text search index
ReceiptSchema.index({ merchant: 'text', notes: 'text', 'extractedData.merchant': 'text' })

export default mongoose.models.Receipt as mongoose.Model<IReceipt> | undefined || mongoose.model<IReceipt>('Receipt', ReceiptSchema)
