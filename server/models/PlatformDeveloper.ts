// server/models/PlatformDeveloper.ts — the developer list (plan omf-order-mapping piece 5). A developer is an ordinary OMF user whose id
// is in this collection. It is written only by the operator command scripts/manage-developers.ts on the server: no route, role, token
// claim, environment variable or first-user rule adds anyone. Read at every developer request (server/utils/developerAccess.ts).
import mongoose, { Schema } from 'mongoose'

export interface IPlatformDeveloper {
  userId: mongoose.Types.ObjectId
  addedAt: Date
  note: string
}

const schema = new Schema<IPlatformDeveloper>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  addedAt: { type: Date, required: true, default: Date.now },
  note: { type: String, default: '' }
}, { collection: 'platformdevelopers', versionKey: false })

export default (mongoose.models.PlatformDeveloper as mongoose.Model<IPlatformDeveloper>) || mongoose.model<IPlatformDeveloper>('PlatformDeveloper', schema)
