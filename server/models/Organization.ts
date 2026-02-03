// server/models/Organization.ts
import mongoose, { Schema, Document } from 'mongoose'

export type OrganizationType = 'personal' | 'business' | 'enterprise'
export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface IOrgMember {
  userId: mongoose.Types.ObjectId
  role: MemberRole
  joinedAt: Date
  invitedBy?: mongoose.Types.ObjectId
}

export interface IOrganization extends Document {
  name: string
  slug: string
  type: OrganizationType
  description?: string
  logo?: string
  website?: string
  email?: string
  phone?: string
  address?: {
    line1?: string
    line2?: string
    city?: string
    state?: string
    postalCode?: string
    country?: string
  }
  taxId?: string
  settings: {
    defaultCurrency: string
    fiscalYearStart: number // Month (1-12)
    timezone: string
    invoicePrefix: string
    invoiceNextNumber: number
  }
  members: IOrgMember[]
  isActive: boolean
  subscriptionPlan?: 'free' | 'starter' | 'professional' | 'enterprise'
  subscriptionExpiresAt?: Date
  createdAt: Date
  updatedAt: Date
}

const OrgMemberSchema = new Schema<IOrgMember>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: {
    type: String,
    enum: ['owner', 'admin', 'member', 'viewer'],
    default: 'member'
  },
  joinedAt: { type: Date, default: Date.now },
  invitedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { _id: false })

const OrganizationSchema = new Schema<IOrganization>({
  name: { type: String, required: true, trim: true },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  type: {
    type: String,
    enum: ['personal', 'business', 'enterprise'],
    default: 'personal'
  },
  description: String,
  logo: String,
  website: String,
  email: String,
  phone: String,
  address: {
    line1: String,
    line2: String,
    city: String,
    state: String,
    postalCode: String,
    country: { type: String, default: 'JP' }
  },
  taxId: String,
  settings: {
    defaultCurrency: { type: String, default: 'JPY' },
    fiscalYearStart: { type: Number, default: 4 }, // April in Japan
    timezone: { type: String, default: 'Asia/Tokyo' },
    invoicePrefix: { type: String, default: 'INV' },
    invoiceNextNumber: { type: Number, default: 1 }
  },
  members: [OrgMemberSchema],
  isActive: { type: Boolean, default: true },
  subscriptionPlan: {
    type: String,
    enum: ['free', 'starter', 'professional', 'enterprise'],
    default: 'free'
  },
  subscriptionExpiresAt: Date
}, {
  timestamps: true
})

// Index for member lookups
OrganizationSchema.index({ 'members.userId': 1 })

// Virtual for id
OrganizationSchema.virtual('id').get(function() {
  return this._id.toHexString()
})

OrganizationSchema.set('toJSON', { virtuals: true })
OrganizationSchema.set('toObject', { virtuals: true })

// Static method to generate unique slug
OrganizationSchema.statics.generateSlug = async function(name: string): Promise<string> {
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  // Check if slug exists
  let count = 0
  let uniqueSlug = slug
  while (await this.findOne({ slug: uniqueSlug })) {
    count++
    uniqueSlug = `${slug}-${count}`
  }

  return uniqueSlug
}

export default mongoose.models.Organization || mongoose.model<IOrganization>('Organization', OrganizationSchema)
