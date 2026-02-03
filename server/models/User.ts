// server/models/User.ts
import mongoose, { Schema, Document } from 'mongoose'
import bcrypt from 'bcryptjs'

export interface IUser extends Document {
  email: string
  password: string
  name: string
  avatar?: string
  phone?: string
  isActive: boolean
  isEmailVerified: boolean
  lastLoginAt?: Date
  preferences: {
    language: string
    currency: string
    timezone: string
    darkMode: boolean
  }
  // Security preferences
  securityPreferences: {
    pinHash?: string
    pinEnabled: boolean
    screenLockTimeout: number  // minutes, default 15
    forceLogoutTimeout: number // hours, default 8
  }
  // Failed login tracking
  loginAttempts: number
  lockoutUntil?: Date
  // 2FA fields
  twoFactorEnabled: boolean
  twoFactorSecret?: string
  twoFactorBackupCodes?: string[]
  trustedDevices?: Array<{
    deviceId: string
    userAgent: string
    expiresAt: Date
  }>
  createdAt: Date
  updatedAt: Date

  // Methods
  comparePassword(candidatePassword: string): Promise<boolean>
  comparePin(candidatePin: string): Promise<boolean>
}

const UserSchema = new Schema<IUser>({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  password: {
    type: String,
    required: true,
    minlength: 8,
    select: false // Don't include password by default
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  avatar: String,
  phone: String,
  isActive: { type: Boolean, default: true },
  isEmailVerified: { type: Boolean, default: false },
  lastLoginAt: Date,
  preferences: {
    language: { type: String, default: 'ja' },
    currency: { type: String, default: 'JPY' },
    timezone: { type: String, default: 'Asia/Tokyo' },
    darkMode: { type: Boolean, default: false }
  },
  // Security preferences
  securityPreferences: {
    pinHash: { type: String },
    pinEnabled: { type: Boolean, default: false },
    screenLockTimeout: { type: Number, default: 15 },  // minutes
    forceLogoutTimeout: { type: Number, default: 8 }   // hours
  },
  // Failed login tracking
  loginAttempts: { type: Number, default: 0 },
  lockoutUntil: { type: Date },
  // 2FA fields
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecret: { type: String, select: false },
  twoFactorBackupCodes: { type: [String], select: false },
  trustedDevices: [{
    deviceId: { type: String, required: true },
    userAgent: { type: String },
    expiresAt: { type: Date, required: true }
  }]
}, {
  timestamps: true
})

// Hash password before saving
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next()

  try {
    const salt = await bcrypt.genSalt(12)
    this.password = await bcrypt.hash(this.password, salt)
    next()
  } catch (error: any) {
    next(error)
  }
})

// Compare password method
UserSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password)
}

// Compare PIN method
UserSchema.methods.comparePin = async function(candidatePin: string): Promise<boolean> {
  if (!this.securityPreferences?.pinHash) return false
  return bcrypt.compare(candidatePin, this.securityPreferences.pinHash)
}

// Virtual for id
UserSchema.virtual('id').get(function() {
  return this._id.toHexString()
})

UserSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.password
    delete ret.__v
    return ret
  }
})

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema)
