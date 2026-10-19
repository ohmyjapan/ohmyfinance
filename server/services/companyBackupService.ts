// server/services/companyBackupService.ts — the selected-company backup scope shared by GET /api/backup and POST /api/backup/restore
// (plan omf-navi-import-restore-20261020, final review F2). A backup row belongs to the company only by the organizationId it
// recorded; an absent or other company is never reinterpreted as the selected one. Company, creator and internal write proofs are set
// only by trusted server code. Mapping templates are shared (no company field): a company backup neither exports, restores nor clears them.
import mongoose from 'mongoose'

export type BackupSkipReason = 'other_company' | 'unassigned' | 'malformed' | 'invalid' | 'duplicate' | 'shared_template'

export function backupScope(organizationId: mongoose.Types.ObjectId) {
  return { type: 'company', organizationId: String(organizationId) }
}

export const backupExclusions = {
  unassigned: 'Rows without a recorded company are held unassigned and are not part of a company backup.',
  mappingTemplates: 'Mapping templates are shared, not company records; a company backup does not export, restore or clear them.'
}

/** The recorded owner of one backup row relative to the selected company. */
export function recordedCompany(item: unknown, organizationId: mongoose.Types.ObjectId): 'selected' | 'other_company' | 'unassigned' | 'malformed' {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return 'malformed'
  const recorded = (item as any).organizationId
  if (recorded === undefined || recorded === null || recorded === '') return 'unassigned'
  return String(recorded) === String(organizationId) ? 'selected' : 'other_company'
}

/** An empty section clears only when the file itself is an export of exactly this company. */
export function provesCompanySnapshot(backup: any, organizationId: mongoose.Types.ObjectId) {
  return backup?.scope?.type === 'company' && backup.scope.organizationId === String(organizationId)
}

// Identity, ownership, creator and Navi/card write proofs never come from a file.
const UNTRUSTED_FIELDS = ['id', '_id', '__v', 'organizationId', 'createdBy', 'uploadedBy', 'ownerId', 'naviOperation', 'cardAccounting']
export const WITHHELD_FIELDS = ['naviOperation', 'cardAccounting'] as const
const DATE_FIELDS = ['date', 'createdAt', 'updatedAt', 'uploadDate', 'receiptDate', 'startDate', 'endDate', 'nextDueDate', 'lastGeneratedDate']

/** Values of one selected-company row that a restore may write (dates revived as before). */
export function restorableValues(item: Record<string, any>) {
  const prepared: Record<string, any> = {}
  for (const [key, value] of Object.entries(item)) if (!UNTRUSTED_FIELDS.includes(key) && !key.startsWith('$') && !key.includes('.')) prepared[key] = value
  for (const field of DATE_FIELDS) if (prepared[field] && typeof prepared[field] === 'string') prepared[field] = new Date(prepared[field])
  if (Array.isArray(prepared.timeline)) prepared.timeline = prepared.timeline.map((entry: any) => ({ ...entry, timestamp: entry?.timestamp ? new Date(entry.timestamp) : new Date() }))
  return prepared
}
