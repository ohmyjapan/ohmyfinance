import mongoose, { Schema } from 'mongoose'

// No OTP, pending token, email, or password is retained in this counter.
interface VerificationAttempt { _id: string; count: number; expiresAt: Date }
const schema = new Schema<VerificationAttempt>({
  _id: { type: String, required: true },
  count: { type: Number, required: true },
  expiresAt: { type: Date, required: true, expires: 0 }
})
const AuthVerificationAttempt: mongoose.Model<VerificationAttempt> = mongoose.models.AuthVerificationAttempt || mongoose.model<VerificationAttempt>('AuthVerificationAttempt', schema)
export default AuthVerificationAttempt
