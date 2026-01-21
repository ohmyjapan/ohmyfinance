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
export interface IReceipt extends Document {
  filename: string
  originalFilename: string
  size: number
  mimeType?: string
  uploadDate: Date
  amount?: number
  currency?: string
  merchant?: string
  status: 'matched' | 'unmatched' | 'processing' | 'error'
  transactionId?: mongoose.Types.ObjectId
  fileUrl?: string
  filePath?: string
  thumbnailUrl?: string
  receiptDate?: Date
  category?: 'business' | 'personal' | 'travel' | 'entertainment' | 'office' | 'other'
  notes?: string
  tags?: string[]
  uploadedBy?: string
  taxAmount?: number
  taxRate?: number
  extractedData?: IReceiptExtractedData
  errorMessage?: string
  confidenceScore?: number
  metadata?: Record<string, any>
  createdAt: Date
  updatedAt: Date
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
  filename: { type: String, required: true, unique: true },
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
  uploadedBy: String,
  taxAmount: Number,
  taxRate: Number,
  extractedData: ExtractedDataSchema,
  errorMessage: String,
  confidenceScore: Number,
  metadata: Schema.Types.Mixed
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

// Virtual for id
ReceiptSchema.virtual('id').get(function() {
  return this._id.toHexString()
})

// Text search index
ReceiptSchema.index({ merchant: 'text', notes: 'text', 'extractedData.merchant': 'text' })

export default mongoose.models.Receipt || mongoose.model<IReceipt>('Receipt', ReceiptSchema)
