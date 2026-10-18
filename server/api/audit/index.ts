// server/api/audit/index.ts
import { defineEventHandler, getQuery, setHeader, setResponseStatus } from 'h3'
import mongoose from 'mongoose'
import { ensureConnection } from '../../config/database'
import AuditLog from '../../models/AuditLog'
import User from '../../models/User'
import { requireAuth } from '../../middleware/auth'

/**
 * GET /api/audit
 * Get the signed-in user's own audit entries. This is not a company/support audit view.
 */
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const failure = (status: number, code: string) => {
    setResponseStatus(event, status)
    return { success: false, error: { code }, logs: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } }
  }
  let auth
  try { auth = requireAuth(event) }
  catch { return failure(401, 'AUTH_REQUIRED') }
  if (event.method !== 'GET') return failure(405, 'METHOD_NOT_ALLOWED')
  if (!mongoose.isValidObjectId(auth.userId)) return failure(401, 'AUTH_REQUIRED')
  try {
    await ensureConnection()
    if (!await User.exists({ _id: auth.userId })) return failure(401, 'AUTH_REQUIRED')

    const query = getQuery(event)
    const positive = (value: unknown, fallback: number) => {
      const n = parseInt(String(value))
      return Number.isSafeInteger(n) && n > 0 ? n : fallback
    }
    const page = positive(query.page, 1)
    const limit = Math.min(positive(query.limit, 50), 100)
    const skip = (page - 1) * limit

    const filter: Record<string, any> = { userId: auth.userId }

    if (typeof query.entityType === 'string' && query.entityType) {
      filter.entityType = query.entityType
    }

    if (typeof query.action === 'string' && query.action) {
      filter.action = query.action
    }

    if (typeof query.entityId === 'string' && query.entityId) {
      filter.entityId = query.entityId
    }

    if (query.dateFrom || query.dateTo) {
      filter.timestamp = {}
      if (query.dateFrom) {
        const from = new Date(String(query.dateFrom))
        if (!Number.isFinite(from.getTime())) return failure(400, 'INVALID_DATE_FILTER')
        filter.timestamp.$gte = from
      }
      if (query.dateTo) {
        const to = new Date(String(query.dateTo))
        if (!Number.isFinite(to.getTime())) return failure(400, 'INVALID_DATE_FILTER')
        filter.timestamp.$lte = to
      }
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter)
    ])

    return {
      success: true,
      scope: 'signed_in_user',
      logs: logs.map((log: any) => ({
        ...log,
        id: log._id.toString()
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    }
  } catch {
    console.error('Audit log query failed')
    return failure(500, 'AUDIT_UNAVAILABLE')
  }
})
