import { defineEventHandler, setHeader, setResponseStatus } from 'h3'
import mongoose from 'mongoose'
import { requireAuth } from '../../middleware/auth'
import { ensureConnection } from '../../config/database'
import User from '../../models/User'
import { supportReport } from '../../services/supportReportService'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'no-store')
  const failure = (status: number, code: string) => {
    setResponseStatus(event, status)
    return { error: { code } }
  }
  if (event.method !== 'GET') return failure(405, 'METHOD_NOT_ALLOWED')
  let ownerId: string
  try { ownerId = requireAuth(event).userId }
  catch { return failure(401, 'AUTH_REQUIRED') }
  if (!mongoose.isValidObjectId(ownerId)) return failure(401, 'AUTH_REQUIRED')
  try {
    await ensureConnection()
    if (!await User.exists({ _id: ownerId })) return failure(401, 'AUTH_REQUIRED')
    return await supportReport(ownerId)
  } catch {
    // Never echo exception messages, request URLs, settings or database values into a shareable report.
    return failure(503, 'SUPPORT_UNAVAILABLE')
  }
})
