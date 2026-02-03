// server/models/Invite.ts
import mongoose, { Schema, Document } from 'mongoose'
import crypto from 'crypto'

export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'cancelled'
export type InviteRole = 'admin' | 'member' | 'viewer'

export interface IInvite extends Document {
  email: string
  organizationId: mongoose.Types.ObjectId
  role: InviteRole
  token: string
  expiresAt: Date
  createdBy: mongoose.Types.ObjectId
  status: InviteStatus
  acceptedAt?: Date
  acceptedBy?: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const InviteSchema = new Schema<IInvite>({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  role: {
    type: String,
    enum: ['admin', 'member', 'viewer'],
    default: 'member'
  },
  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'expired', 'cancelled'],
    default: 'pending',
    index: true
  },
  acceptedAt: Date,
  acceptedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
})

// Compound index for finding pending invites for an organization
InviteSchema.index({ organizationId: 1, status: 1 })

// Compound index for finding invites by email and organization
InviteSchema.index({ email: 1, organizationId: 1 })

// Virtual for id
InviteSchema.virtual('id').get(function() {
  return this._id.toHexString()
})

InviteSchema.set('toJSON', { virtuals: true })
InviteSchema.set('toObject', { virtuals: true })

// Static method to generate a secure token
InviteSchema.statics.generateToken = function(): string {
  return crypto.randomBytes(32).toString('hex')
}

// Static method to check if invite is expired
InviteSchema.methods.isExpired = function(): boolean {
  return new Date() > this.expiresAt
}

// Static method to find valid invite by token
InviteSchema.statics.findValidByToken = async function(token: string) {
  const invite = await this.findOne({
    token,
    status: 'pending',
    expiresAt: { $gt: new Date() }
  }).populate('organizationId', 'name slug type')
    .populate('createdBy', 'name email')

  return invite
}

// Pre-save hook to auto-expire old pending invites
InviteSchema.pre('save', function(next) {
  if (this.status === 'pending' && this.expiresAt < new Date()) {
    this.status = 'expired'
  }
  next()
})

export default mongoose.models.Invite || mongoose.model<IInvite>('Invite', InviteSchema)
