// server/utils/audit.ts
import AuditLog from '../models/AuditLog'
import { ensureConnection } from '../config/database'

export interface AuditEntry {
  action: 'create' | 'update' | 'delete' | 'import' | 'export' | 'match' | 'unmatch' | 'backup' | 'restore' |
    'login' | 'logout' | 'login_failed' | '2fa_enabled' | '2fa_disabled' | 'password_changed' |
    'lockout' | 'unlock' | 'pin_set' | 'pin_failed' | 'pin_disabled'
  entityType: 'transaction' | 'receipt' | 'recurring' | 'category' | 'template' | 'settings' | 'auth'
  entityId?: string
  entityName?: string
  changes?: { field: string; oldValue: any; newValue: any }[]
  metadata?: Record<string, any>
  userId?: string
  userAgent?: string
  ipAddress?: string
}

/**
 * Log an audit entry
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await ensureConnection()
    await AuditLog.create({
      ...entry,
      timestamp: new Date()
    })
  } catch (error) {
    // Don't throw - audit logging shouldn't break main operations
    console.error('Failed to log audit entry:', error)
  }
}

/**
 * Calculate changes between old and new object
 */
export function calculateChanges(
  oldObj: Record<string, any>,
  newObj: Record<string, any>,
  fields?: string[]
): { field: string; oldValue: any; newValue: any }[] {
  const changes: { field: string; oldValue: any; newValue: any }[] = []
  const fieldsToCheck = fields || Object.keys(newObj)

  for (const field of fieldsToCheck) {
    const oldVal = oldObj[field]
    const newVal = newObj[field]

    // Skip if same
    if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue

    // Skip undefined to undefined
    if (oldVal === undefined && newVal === undefined) continue

    changes.push({
      field,
      oldValue: oldVal,
      newValue: newVal
    })
  }

  return changes
}
