import { defineEventHandler, createError } from 'h3'
import { requireLedgerAccess } from '../../services/ledgerAccessService'
import { readReceiptUpload, uploadReceiptFile } from '../../services/receiptFileService'

export default defineEventHandler(async event => {
  const access = await requireLedgerAccess(event, 'write')
  if (event.method !== 'POST') throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  const file = await readReceiptUpload(event)
  return { success: true, receipt: await uploadReceiptFile(access, file.bytes, file.name) }
})
