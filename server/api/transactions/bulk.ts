// server/api/transactions/bulk.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Transaction from '../../models/Transaction'
import { requireAuth } from '../../middleware/auth'

/**
 * POST /api/transactions/bulk
 * Perform bulk operations on transactions
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  try {
    await ensureConnection()

    const body = await readBody(event)
    const { action, ids, data } = body

    if (!action) {
      throw createError({ statusCode: 400, statusMessage: 'Action is required' })
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'Transaction IDs are required' })
    }

    const results = {
      action,
      requested: ids.length,
      succeeded: 0,
      failed: 0,
      errors: [] as string[]
    }

    switch (action) {
      case 'delete':
        const deleteResult = await Transaction.deleteMany({ _id: { $in: ids } })
        results.succeeded = deleteResult.deletedCount
        results.failed = ids.length - deleteResult.deletedCount
        break

      case 'update_status':
        if (!data?.status) {
          throw createError({ statusCode: 400, statusMessage: 'Status is required for update_status action' })
        }
        const validStatuses = ['completed', 'pending', 'processing', 'failed', 'refunded', 'cancelled']
        if (!validStatuses.includes(data.status)) {
          throw createError({ statusCode: 400, statusMessage: 'Invalid status' })
        }

        const statusResult = await Transaction.updateMany(
          { _id: { $in: ids } },
          {
            $set: { status: data.status },
            $push: {
              timeline: {
                type: data.status,
                title: `Status changed to ${data.status}`,
                timestamp: new Date(),
                description: 'Bulk status update'
              }
            }
          }
        )
        results.succeeded = statusResult.modifiedCount
        results.failed = ids.length - statusResult.modifiedCount
        break

      case 'add_tag':
        if (!data?.tag) {
          throw createError({ statusCode: 400, statusMessage: 'Tag is required for add_tag action' })
        }
        const tagResult = await Transaction.updateMany(
          { _id: { $in: ids } },
          { $addToSet: { tags: data.tag } }
        )
        results.succeeded = tagResult.modifiedCount
        results.failed = ids.length - tagResult.modifiedCount
        break

      case 'remove_tag':
        if (!data?.tag) {
          throw createError({ statusCode: 400, statusMessage: 'Tag is required for remove_tag action' })
        }
        const removeTagResult = await Transaction.updateMany(
          { _id: { $in: ids } },
          { $pull: { tags: data.tag } }
        )
        results.succeeded = removeTagResult.modifiedCount
        results.failed = ids.length - removeTagResult.modifiedCount
        break

      case 'update_source':
        if (!data?.source) {
          throw createError({ statusCode: 400, statusMessage: 'Source is required for update_source action' })
        }
        const sourceResult = await Transaction.updateMany(
          { _id: { $in: ids } },
          { $set: { source: data.source } }
        )
        results.succeeded = sourceResult.modifiedCount
        results.failed = ids.length - sourceResult.modifiedCount
        break

      case 'add_note':
        if (!data?.note) {
          throw createError({ statusCode: 400, statusMessage: 'Note is required for add_note action' })
        }
        // For notes, we need to update each individually to append
        for (const id of ids) {
          try {
            await Transaction.findByIdAndUpdate(id, {
              $set: {
                notes: data.appendNote
                  ? { $concat: ['$notes', '\n', data.note] }
                  : data.note
              }
            })
            results.succeeded++
          } catch {
            results.failed++
          }
        }
        break

      case 'export':
        // Return the transactions for export
        const transactions = await Transaction.find({ _id: { $in: ids } }).lean()
        return {
          success: true,
          action: 'export',
          count: transactions.length,
          transactions
        }

      default:
        throw createError({ statusCode: 400, statusMessage: `Unknown action: ${action}` })
    }

    return {
      success: true,
      message: `Bulk ${action} completed`,
      ...results
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    console.error('Bulk operation error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Bulk operation failed'
    })
  }
})
