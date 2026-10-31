// server/models/CompanyMailConnection.ts — one Gmail connection per company for sending invoices (plan omf-invoice-tnumber-20261030
// C1). The refresh token is stored only sealed (AES-256-GCM with OMF_MAIL_TOKEN_KEY, bound to company and address) and is never
// selected unless asked for. Not in the backup list (server/api/backup/schedule.ts).
import mongoose, { Schema, Document } from 'mongoose'

export interface ISealedToken { v: number, iv: string, tag: string, data: string }
export interface ICompanyMailConnection extends Document<mongoose.Types.ObjectId> {
  organizationId: mongoose.Types.ObjectId
  provider: 'gmail'
  address: string
  scopes: string[]
  labelsGranted: boolean
  sealedRefreshToken: ISealedToken
  state: 'ok' | 'reconnect_required'
  connectedBy?: mongoose.Types.ObjectId
  connectedAt?: Date
  lastSentAt?: Date
  lastError?: string | null
  lastErrorAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

const SealedTokenSchema = new Schema<ISealedToken>({ v: Number, iv: String, tag: String, data: String }, { _id: false })

const CompanyMailConnectionSchema = new Schema<ICompanyMailConnection>({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
  provider: { type: String, enum: ['gmail'], default: 'gmail' },
  address: { type: String, required: true },
  scopes: [String],
  labelsGranted: { type: Boolean, default: false },
  sealedRefreshToken: { type: SealedTokenSchema, required: true, select: false },
  state: { type: String, enum: ['ok', 'reconnect_required'], default: 'ok' },
  connectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  connectedAt: Date,
  lastSentAt: Date,
  lastError: String,
  lastErrorAt: Date
}, { timestamps: true, collection: 'companymailconnections' })

export default mongoose.models.CompanyMailConnection as mongoose.Model<ICompanyMailConnection> | undefined || mongoose.model<ICompanyMailConnection>('CompanyMailConnection', CompanyMailConnectionSchema)
