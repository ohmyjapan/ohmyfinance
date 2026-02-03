// server/models/AuditLog.ts
import mongoose, { Schema, Document } from 'mongoose'

export interface IAuditLog extends Document {
  action: string
  entityType: 'transaction' | 'receipt' | 'recurring' | 'category' | 'template' | 'settings' | 'auth'
  entityId?: string
  entityName?: string
  changes?: {
    field: string
    oldValue: any
    newValue: any
  }[]
  metadata?: Record<string, any>
  userId?: string
  userAgent?: string
  ipAddress?: string
  timestamp: Date
}

const AuditLogSchema = new Schema<IAuditLog>({
  action: {
    type: String,
    required: true,
    enum: [
      'create', 'update', 'delete', 'import', 'export', 'match', 'unmatch', 'backup', 'restore',
      'login', 'logout', 'login_failed', '2fa_enabled', '2fa_disabled', 'password_changed',
      'lockout', 'unlock', 'pin_set', 'pin_failed', 'pin_disabled'
    ]
  },
  entityType: {
    type: String,
    required: true,
    enum: ['transaction', 'receipt', 'recurring', 'category', 'template', 'settings', 'auth']
  },
  entityId: String,
  entityName: String,
  changes: [{
    field: String,
    oldValue: Schema.Types.Mixed,
    newValue: Schema.Types.Mixed
  }],
  metadata: {
    type: Map,
    of: Schema.Types.Mixed
  },
  userId: String,
  userAgent: String,
  ipAddress: String,
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false,
  toJSON: {
    virtuals: true,
    transform: (_, ret) => {
      ret.id = ret._id.toString()
      delete ret._id
      delete ret.__v
      return ret
    }
  }
})

// Indexes
AuditLogSchema.index({ timestamp: -1 })
AuditLogSchema.index({ entityType: 1, timestamp: -1 })
AuditLogSchema.index({ action: 1, timestamp: -1 })
AuditLogSchema.index({ entityId: 1 })

export default mongoose.models.AuditLog || mongoose.model<IAuditLog>('AuditLog', AuditLogSchema)
