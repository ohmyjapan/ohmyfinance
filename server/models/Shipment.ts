import mongoose, { Document, Schema } from 'mongoose'

// Address interface
export interface IShipmentAddress {
  name?: string
  line1?: string
  line2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  phone?: string
}

// Shipment event interface
export interface IShipmentEvent {
  type: string
  title: string
  description?: string
  timestamp: Date
  location?: string
  data?: Record<string, any>
}

// Main shipment interface
export interface IShipment extends Document {
  trackingNumber?: string
  status: string
  carrier?: string
  shippingDate?: Date
  estimatedDelivery?: Date
  deliveryDate?: Date
  shippingAddress?: IShipmentAddress
  shippingCost?: number
  shippingMethod?: {
    name: string
    estimatedDelivery?: string
    carrier: string
    cost?: number
  }
  weight?: {
    value: number
    unit: string
  }
  dimensions?: {
    length: number
    width: number
    height: number
    unit: string
  }
  transactionIds: mongoose.Types.ObjectId[]
  events: IShipmentEvent[]
  notes?: string
  metadata?: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

// Subdocument schemas
const ShipmentAddressSchema = new Schema<IShipmentAddress>({
  name: String,
  line1: String,
  line2: String,
  city: String,
  state: String,
  postalCode: String,
  country: String,
  phone: String
}, { _id: false })

const ShipmentEventSchema = new Schema<IShipmentEvent>({
  type: { type: String, required: true },
  title: { type: String, required: true },
  description: String,
  timestamp: { type: Date, default: Date.now },
  location: String,
  data: Schema.Types.Mixed
}, { _id: false })

const ShippingMethodSchema = new Schema({
  name: String,
  estimatedDelivery: String,
  carrier: String,
  cost: Number
}, { _id: false })

const WeightSchema = new Schema({
  value: Number,
  unit: String
}, { _id: false })

const DimensionsSchema = new Schema({
  length: Number,
  width: Number,
  height: Number,
  unit: String
}, { _id: false })

// Main shipment schema
const ShipmentSchema = new Schema<IShipment>({
  trackingNumber: { type: String, index: true },
  status: {
    type: String,
    required: true,
    default: 'pending',
    enum: ['pending', 'processing', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned', 'cancelled'],
    index: true
  },
  carrier: String,
  shippingDate: Date,
  estimatedDelivery: Date,
  deliveryDate: Date,
  shippingAddress: ShipmentAddressSchema,
  shippingCost: Number,
  shippingMethod: ShippingMethodSchema,
  weight: WeightSchema,
  dimensions: DimensionsSchema,
  transactionIds: [{ type: Schema.Types.ObjectId, ref: 'Transaction', index: true }],
  events: [ShipmentEventSchema],
  notes: String,
  metadata: Schema.Types.Mixed
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

// Virtual for id
ShipmentSchema.virtual('id').get(function() {
  return this._id.toHexString()
})

// Index for tracking
ShipmentSchema.index({ trackingNumber: 1, carrier: 1 })

export default mongoose.models.Shipment || mongoose.model<IShipment>('Shipment', ShipmentSchema)
