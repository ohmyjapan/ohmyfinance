import mongoose, { Schema } from 'mongoose'

// A refresh token revoked by logout (S16) stays refused across restarts until its own expiry: the in-memory blacklist alone
// forgot it at the next start. TTL 0 on expiresAt removes the row once the token could no longer be presented anyway.
const schema = new Schema({
  jti: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, expires: 0 }
})
export default mongoose.models.RevokedToken || mongoose.model('RevokedToken', schema)
