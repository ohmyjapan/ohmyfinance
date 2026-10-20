import { defineEventHandler, getRouterParam, createError, setHeader } from 'h3'
import mongoose from 'mongoose'
import { calendarCompany } from '../../../utils/calendarAccess'
import { findCompanyReceiptMatches } from '../../../services/companyNaviSummaryService'
import { ensureConnection } from '../../../config/database'

// Read the same bounded, whitelisted evidence Navi uses. No raw receipt file/metadata response and no receipt mutation.
export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'no-store')
  await ensureConnection()
  const { organizationId } = await calendarCompany(event)
  const receiptId = getRouterParam(event, 'id') || ''
  if (!mongoose.isValidObjectId(receiptId)) throw createError({ statusCode: 400, statusMessage: 'Invalid receipt identifier' })
  try { return await findCompanyReceiptMatches(organizationId, receiptId) }
  catch (error: any) {
    if ([400, 403, 404].includes(error.statusCode)) throw error
    throw createError({ statusCode: 500, statusMessage: 'Failed to read company receipt evidence' })
  }
})
