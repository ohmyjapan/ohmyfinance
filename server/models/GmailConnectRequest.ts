// server/models/GmailConnectRequest.ts — one Gmail consent in progress (plan omf-invoice-tnumber-20261030 C1): the sha256 of the OAuth
// state, the user and company who started it, the PKCE verifier (never selected unless asked for), single use, gone after 10 minutes.
import mongoose, { Schema, Document } from 'mongoose'

export interface IGmailConnectRequest extends Document<string> {
  _id: string
  organizationId: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  codeVerifier: string
  expiresAt: Date
  usedAt?: Date | null
  createdAt: Date
}

const GmailConnectRequestSchema = new Schema<IGmailConnectRequest>({
  _id: { type: String, required: true },
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  codeVerifier: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null }
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'gmailconnectrequests' })

GmailConnectRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export default mongoose.models.GmailConnectRequest as mongoose.Model<IGmailConnectRequest> | undefined || mongoose.model<IGmailConnectRequest>('GmailConnectRequest', GmailConnectRequestSchema)
