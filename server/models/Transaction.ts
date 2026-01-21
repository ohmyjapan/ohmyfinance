import mongoose, { Document, Schema } from 'mongoose'

// Address subdocument interface
export interface IAddress {
  name?: string
  line1?: string
  line2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  phone?: string
}

// Transaction item interface
export interface ITransactionItem {
  name: string
  description?: string
  quantity: number
  price: number
  total: number
  sku?: string
  tax?: number
  category?: string
  imageUrl?: string
  weight?: {
    value: number
    unit: string
  }
  metadata?: Record<string, any>
}

// Timeline event interface
export interface ITimelineEvent {
  type: string
  title: string
  timestamp: Date
  description?: string
  location?: string
  actor?: string
  data?: Record<string, any>
}

// Payment method interface
export interface IPaymentMethod {
  type: string
  last4?: string
  brand?: string
  expiryDate?: string
  holderName?: string
  token?: string
}

// Processor interface
export interface IProcessor {
  name: string
  gatewayId: string
  responseCode?: string
  authCode?: string
  batchId?: string
}

// Fees interface
export interface IFees {
  processor: number
  platform?: number
  other?: number
  total: number
}

// Tax interface
export interface ITax {
  amount: number
  rate: number
  reference?: string
}

// Risk assessment interface
export interface IRiskAssessment {
  score: number
  level: 'low' | 'medium' | 'high'
  factors?: string[]
  triggeredRules?: string[]
}

// Related transaction interface
export interface IRelatedTransaction {
  transactionId: mongoose.Types.ObjectId
  date: Date
  amount: number
  status: string
  type?: string
}

// Embedded receipt interface
export interface IEmbeddedReceipt {
  receiptId?: mongoose.Types.ObjectId
  filename: string
  size: number
  date?: Date
  amount?: number
  merchant?: string
  url?: string
}

// Embedded shipment interface
export interface IEmbeddedShipment {
  shipmentId?: mongoose.Types.ObjectId
  trackingNumber: string
  carrier: string
  status: string
  estimatedDelivery?: Date
  address?: IAddress
  shippingMethod?: {
    name: string
    estimatedDelivery?: string
    carrier: string
    cost?: number
  }
}

// Customer interface
export interface ICustomer {
  customerId?: mongoose.Types.ObjectId
  name: string
  email: string
  phone?: string
  address?: IAddress
}

// Main transaction interface
export interface ITransaction extends Document {
  reference: string
  date: Date
  amount: number
  currency: string
  status: string
  source: string
  type?: string
  customer: ICustomer
  paymentMethod?: IPaymentMethod
  processor?: IProcessor
  items?: ITransactionItem[]
  shipment?: IEmbeddedShipment
  timeline?: ITimelineEvent[]
  receipt?: IEmbeddedReceipt | null
  relatedTransactions?: IRelatedTransaction[]
  notes?: string
  tags?: string[]
  metadata?: Record<string, any>
  tax?: ITax
  fees?: IFees
  riskAssessment?: IRiskAssessment
  createdBy?: string
  createdAt: Date
  updatedAt: Date
}

// Subdocument schemas
const AddressSchema = new Schema<IAddress>({
  name: String,
  line1: String,
  line2: String,
  city: String,
  state: String,
  postalCode: String,
  country: String,
  phone: String
}, { _id: false })

const TransactionItemSchema = new Schema<ITransactionItem>({
  name: { type: String, required: true },
  description: String,
  quantity: { type: Number, required: true, default: 1 },
  price: { type: Number, required: true },
  total: { type: Number, required: true },
  sku: String,
  tax: Number,
  category: String,
  imageUrl: String,
  weight: {
    value: Number,
    unit: String
  },
  metadata: Schema.Types.Mixed
}, { _id: false })

const TimelineEventSchema = new Schema<ITimelineEvent>({
  type: { type: String, required: true },
  title: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  description: String,
  location: String,
  actor: String,
  data: Schema.Types.Mixed
}, { _id: false })

const PaymentMethodSchema = new Schema<IPaymentMethod>({
  type: { type: String, required: true },
  last4: String,
  brand: String,
  expiryDate: String,
  holderName: String,
  token: String
}, { _id: false })

const ProcessorSchema = new Schema<IProcessor>({
  name: { type: String, required: true },
  gatewayId: { type: String, required: true },
  responseCode: String,
  authCode: String,
  batchId: String
}, { _id: false })

const FeesSchema = new Schema<IFees>({
  processor: { type: Number, required: true },
  platform: Number,
  other: Number,
  total: { type: Number, required: true }
}, { _id: false })

const TaxSchema = new Schema<ITax>({
  amount: { type: Number, required: true },
  rate: { type: Number, required: true },
  reference: String
}, { _id: false })

const RiskAssessmentSchema = new Schema<IRiskAssessment>({
  score: { type: Number, required: true },
  level: { type: String, enum: ['low', 'medium', 'high'], required: true },
  factors: [String],
  triggeredRules: [String]
}, { _id: false })

const RelatedTransactionSchema = new Schema<IRelatedTransaction>({
  transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction' },
  date: Date,
  amount: Number,
  status: String,
  type: String
}, { _id: false })

const EmbeddedReceiptSchema = new Schema<IEmbeddedReceipt>({
  receiptId: { type: Schema.Types.ObjectId, ref: 'Receipt' },
  filename: String,
  size: Number,
  date: Date,
  amount: Number,
  merchant: String,
  url: String
}, { _id: false })

const ShippingMethodSchema = new Schema({
  name: String,
  estimatedDelivery: String,
  carrier: String,
  cost: Number
}, { _id: false })

const EmbeddedShipmentSchema = new Schema<IEmbeddedShipment>({
  shipmentId: { type: Schema.Types.ObjectId, ref: 'Shipment' },
  trackingNumber: String,
  carrier: String,
  status: String,
  estimatedDelivery: Date,
  address: AddressSchema,
  shippingMethod: ShippingMethodSchema
}, { _id: false })

const CustomerSchema = new Schema<ICustomer>({
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: String,
  address: AddressSchema
}, { _id: false })

// Main transaction schema
const TransactionSchema = new Schema<ITransaction>({
  reference: { type: String, required: true, unique: true, index: true },
  date: { type: Date, required: true, index: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'JPY' },
  status: {
    type: String,
    required: true,
    default: 'pending',
    enum: ['completed', 'pending', 'processing', 'failed', 'refunded', 'cancelled', 'disputed', 'on_hold'],
    index: true
  },
  source: {
    type: String,
    required: true,
    enum: ['credit_card', 'payment_gateway', 'overseas', 'manual', 'other'],
    index: true
  },
  type: String,
  customer: { type: CustomerSchema, required: true },
  paymentMethod: PaymentMethodSchema,
  processor: ProcessorSchema,
  items: [TransactionItemSchema],
  shipment: EmbeddedShipmentSchema,
  timeline: [TimelineEventSchema],
  receipt: EmbeddedReceiptSchema,
  relatedTransactions: [RelatedTransactionSchema],
  notes: String,
  tags: [String],
  metadata: Schema.Types.Mixed,
  tax: TaxSchema,
  fees: FeesSchema,
  riskAssessment: RiskAssessmentSchema,
  createdBy: String
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

// Virtual for id (string version of _id)
TransactionSchema.virtual('id').get(function() {
  return this._id.toHexString()
})

// Pre-save middleware to generate reference if not provided
TransactionSchema.pre('save', function(next) {
  if (!this.reference) {
    this.reference = `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`
  }
  next()
})

// Indexes for common queries
TransactionSchema.index({ 'customer.email': 1 })
TransactionSchema.index({ 'customer.name': 'text', reference: 'text', notes: 'text' })
TransactionSchema.index({ createdAt: -1 })

export default mongoose.models.Transaction || mongoose.model<ITransaction>('Transaction', TransactionSchema)
