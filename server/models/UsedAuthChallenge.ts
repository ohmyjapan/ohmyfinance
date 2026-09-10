import mongoose, { Schema } from 'mongoose'

// A verified password challenge can issue a session only once, including across restarts.
const schema = new Schema({
  jti: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, expires: 0 }
})
export default mongoose.models.UsedAuthChallenge || mongoose.model('UsedAuthChallenge', schema)
