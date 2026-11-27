// server/models/DeveloperEntry.ts — the record of developer entries (plan omf-order-mapping §4.5).
//   developerentries         one row per entry: developer, target user, company, reason, start, planned end, actual end, how it
//                            ended, and the developer's address and browser. The row is what an entry token stands for: it is read at
//                            every request inside (server/middleware/developerEntry.ts), so an ended row stays ended after a restart.
//   developerentryrequests   one line per request inside an entry: entry id, time, method, path (query removed), status code (added
//                            when the response is sent) and whether the entry refused it. Values and request bodies are not kept.
import mongoose, { Schema } from 'mongoose'

export const ENTRY_END_REASONS = [
  'developer',              // 終了 (POST /api/auth/logout inside the entry), also the browser leaving at the lock or its own time limit
  'expired',                // the planned end passed
  'removed',                // the developer was taken off the list
  'password_changed',       // the developer's session version moved (password change)
  'target_deactivated',     // the entered account was deactivated
  'replaced',               // the same developer started another entry
  'developer_deactivated',  // the developer's own account was deactivated
  'target_is_developer',    // the entered account was put on the developer list
  'token_mismatch',         // a correctly signed token for this row with another token id
  'entered_line_failed'     // the customer's "developer entered" line could not be written: the entry never started (no token given)
] as const
export type EntryEndReason = typeof ENTRY_END_REASONS[number]

export interface IDeveloperEntry {
  _id: mongoose.Types.ObjectId
  developerId: mongoose.Types.ObjectId
  targetUserId: mongoose.Types.ObjectId
  organizationId: mongoose.Types.ObjectId | null
  reason: string
  jti: string
  developerSessionVersion: number
  startedAt: Date
  endsAt: Date
  endedAt: Date | null
  endedHow: EntryEndReason | null
  ipAddress: string
  userAgent: string
}

export interface IDeveloperEntryRequest {
  _id: mongoose.Types.ObjectId
  entryId: mongoose.Types.ObjectId
  at: Date
  method: string
  path: string
  status: number | null
  refused: boolean
}

const entrySchema = new Schema<IDeveloperEntry>({
  developerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  targetUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null },
  reason: { type: String, default: '' },
  jti: { type: String, required: true },
  developerSessionVersion: { type: Number, required: true },
  startedAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  endedAt: { type: Date, default: null },
  endedHow: { type: String, enum: [...ENTRY_END_REASONS, null], default: null },
  ipAddress: { type: String, default: '' },
  userAgent: { type: String, default: '' }
}, { collection: 'developerentries', versionKey: false })
entrySchema.index({ developerId: 1, endedAt: 1 })
entrySchema.index({ startedAt: -1 })

const requestSchema = new Schema<IDeveloperEntryRequest>({
  entryId: { type: Schema.Types.ObjectId, ref: 'DeveloperEntry', required: true, index: true },
  at: { type: Date, required: true },
  method: { type: String, required: true },
  path: { type: String, required: true },
  status: { type: Number, default: null },
  refused: { type: Boolean, required: true }
}, { collection: 'developerentryrequests', versionKey: false })

export const DeveloperEntry = (mongoose.models.DeveloperEntry as mongoose.Model<IDeveloperEntry>) || mongoose.model<IDeveloperEntry>('DeveloperEntry', entrySchema)
export const DeveloperEntryRequest = (mongoose.models.DeveloperEntryRequest as mongoose.Model<IDeveloperEntryRequest>) || mongoose.model<IDeveloperEntryRequest>('DeveloperEntryRequest', requestSchema)
