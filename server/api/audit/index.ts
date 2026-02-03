// server/api/audit/index.ts
import { defineEventHandler, getQuery, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import AuditLog from '../../models/AuditLog'

/**
 * GET /api/audit
 * Get audit log entries
 */
export default defineEventHandler(async (event) => {
  try {
    await ensureConnection()

    const query = getQuery(event)
    const page = parseInt(String(query.page || '1'))
    const limit = Math.min(parseInt(String(query.limit || '50')), 100)
    const skip = (page - 1) * limit

    const filter: Record<string, any> = {}

    if (query.entityType) {
      filter.entityType = query.entityType
    }

    if (query.action) {
      filter.action = query.action
    }

    if (query.entityId) {
      filter.entityId = query.entityId
    }

    if (query.dateFrom || query.dateTo) {
      filter.timestamp = {}
      if (query.dateFrom) {
        filter.timestamp.$gte = new Date(String(query.dateFrom))
      }
      if (query.dateTo) {
        filter.timestamp.$lte = new Date(String(query.dateTo))
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
  } catch (error: any) {
    console.error('Audit log error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to fetch audit logs'
    })
  }
})
