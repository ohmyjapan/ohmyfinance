import { defineEventHandler, getRouterParam, createError, setHeader } from 'h3'
import mongoose from 'mongoose'
import Receipt from '../../models/Receipt'
import { ensureConnection } from '../../config/database'
import { calendarCompany } from '../../utils/calendarAccess'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  requireAuth(event)
  await ensureConnection()
  const { organizationId } = await calendarCompany(event)
    const id = getRouterParam(event, 'id')!
    if (!mongoose.isValidObjectId(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid receipt identifier' })

    // Find receipt by ID
    let receipt
    try { receipt = await Receipt.findOne({ _id: id, organizationId }).lean() }
    catch { throw createError({ statusCode: 500, statusMessage: 'Failed to read company receipt' }) }

    // Return 404 if not found
    if (!receipt) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Receipt not found'
        })
    }

    return receipt
})
