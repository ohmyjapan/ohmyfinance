import { defineEventHandler, getRouterParam, setHeader, createError } from 'h3'
import { requireLedgerAccess } from '../../../services/ledgerAccessService'
import { downloadReceiptFile } from '../../../services/receiptFileService'

export default defineEventHandler(async event => {
  const access = await requireLedgerAccess(event)
  if (event.method !== 'GET') throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  const original = await downloadReceiptFile(access, getRouterParam(event, 'id')!)
  setHeader(event, 'Content-Type', original.mimeType)
  setHeader(event, 'Content-Disposition', "attachment; filename=\"receipt\"; filename*=UTF-8''" + encodeURIComponent(original.name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16)))
  setHeader(event, 'Content-Length', original.bytes.length)
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return original.bytes
})
