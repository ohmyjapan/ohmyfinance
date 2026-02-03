import mongoose, { Document, Schema } from 'mongoose'

// Transaction item interface (OMF style)
export interface ITransactionItem {
  productName?: string
  janCode?: string
  productUrl?: string
  quantity: number
  unitPrice: number
  taxCategoryId?: mongoose.Types.ObjectId
  taxRate?: number
}

// Timeline event interface
export interface ITimelineEvent {
  type: string
  title: string
  timestamp: Date
  description?: string
}

// Attachment interface
export interface IAttachment {
  originalName: string
  filename: string
  path: string
  size: number
  mimeType: string
  uploadedAt: Date
}

// Main transaction interface (OMF style - Japanese accounting)
export interface ITransaction extends Document {
  referenceNumber?: string
  date: Date
  amount: number
  type: string // 支出 or 入金
  status: string
  // Japanese accounting fields
  customerId?: mongoose.Types.ObjectId
  accountCategoryId?: mongoose.Types.ObjectId // 勘定科目
  subAccountCategoryId?: mongoose.Types.ObjectId // 補助科目
  taxCategoryId?: mongoose.Types.ObjectId // 税区分
  taxRate?: number // 税率
  supplierId?: mongoose.Types.ObjectId // 仕入れ先
  transactionCategoryId?: mongoose.Types.ObjectId // 区分
  companyInfo?: string // 法人情報
  invoiceNumber?: string // インボイス番号
  receiptNumber?: string // レシート/注文番号
  trackingNumber?: string // 追跡番号/運送状番号
  paymentMethod?: string // 支払方法 (現金, クレジットカード, etc.)
  cardNumber?: string // カード番号 (下4桁)
  productName?: string // 商品コード/商品名
  productPrice?: number // 商品価格
  janCode?: string // JAN CODE
  // Receipt fields
  hasReceipt: boolean
  receiptFilePath?: string
  receiptUploadedAt?: Date
  // Data source
  sourceId?: mongoose.Types.ObjectId
  // Items and timeline
  items: ITransactionItem[]
  timeline: ITimelineEvent[]
  attachments?: IAttachment[]
  notes?: string
  tags?: string[]
  metadata?: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

// Subdocument schemas (OMF style)
const TransactionItemSchema = new Schema<ITransactionItem>({
  productName: { type: String },
  janCode: { type: String },
  productUrl: { type: String },
  quantity: { type: Number, required: true, default: 1 },
  unitPrice: { type: Number, required: true },
  taxCategoryId: { type: Schema.Types.ObjectId, ref: 'TaxCategory' },
  taxRate: { type: Number }
}, { _id: false })

const TimelineEventSchema = new Schema<ITimelineEvent>({
  type: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String },
  timestamp: { type: Date, default: Date.now }
}, { _id: false })

const AttachmentSchema = new Schema<IAttachment>({
  originalName: String,
  filename: { type: String, required: true },
  path: { type: String, required: true },
  size: Number,
  mimeType: String,
  uploadedAt: { type: Date, default: Date.now }
}, { _id: false })

// Main transaction schema (OMF style - Japanese accounting)
const TransactionSchema = new Schema<ITransaction>({
  referenceNumber: { type: String, index: true },
  date: { type: Date, required: true, index: true },
  amount: { type: Number, required: true },
  type: { type: String, required: true, index: true }, // 支出 or 入金
  status: {
    type: String,
    required: true,
    default: 'pending',
    index: true,
    enum: ['completed', 'pending', 'processing', 'failed', 'cancelled']
  },
  // Japanese accounting fields
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', index: true },
  accountCategoryId: { type: Schema.Types.ObjectId, ref: 'AccountCategory' }, // 勘定科目
  subAccountCategoryId: { type: Schema.Types.ObjectId, ref: 'AccountCategory' }, // 補助科目
  taxCategoryId: { type: Schema.Types.ObjectId, ref: 'TaxCategory' }, // 税区分
  taxRate: { type: Number }, // 税率
  supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', index: true }, // 仕入れ先
  transactionCategoryId: { type: Schema.Types.ObjectId, ref: 'TransactionCategory' }, // 区分
  companyInfo: { type: String }, // 法人情報
  invoiceNumber: { type: String }, // インボイス番号
  receiptNumber: { type: String }, // レシート/注文番号
  trackingNumber: { type: String }, // 追跡番号/運送状番号
  paymentMethod: { type: String }, // 支払方法 (現金, クレジットカード, etc.)
  cardNumber: { type: String }, // カード番号 (下4桁)
  productName: { type: String }, // 商品コード/商品名
  productPrice: { type: Number }, // 商品価格
  janCode: { type: String }, // JAN CODE
  // Receipt fields
  hasReceipt: { type: Boolean, default: false },
  receiptFilePath: { type: String },
  receiptUploadedAt: { type: Date },
  // Data source
  sourceId: { type: Schema.Types.ObjectId, ref: 'DataSource', index: true },
  // Items and timeline
  items: [TransactionItemSchema],
  timeline: [TimelineEventSchema],
  attachments: [AttachmentSchema],
  notes: String,
  tags: [String],
  metadata: Schema.Types.Mixed
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

// Virtual for id (string version of _id)
TransactionSchema.virtual('id').get(function() {
  return this._id.toHexString()
})

// Pre-save middleware to generate reference number if not provided
TransactionSchema.pre('save', function(next) {
  if (!this.referenceNumber) {
    this.referenceNumber = `REF${Math.floor(Math.random() * 100000).toString().padStart(6, '0')}`
  }
  next()
})

// Text search index (only indexes not already declared inline)
TransactionSchema.index({ accountCategoryId: 1 })
TransactionSchema.index({ createdAt: -1 })
TransactionSchema.index({ referenceNumber: 'text', productName: 'text', notes: 'text' })

export default mongoose.models.Transaction || mongoose.model<ITransaction>('Transaction', TransactionSchema)
