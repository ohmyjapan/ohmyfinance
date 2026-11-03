// server/api/attachments/[id].ts
import { defineEventHandler, createError, sendStream } from 'h3'
import { createReadStream, existsSync, statSync } from 'fs'
import { join } from 'path'
import { unlink } from 'fs/promises'
import { ensureConnection } from '../../config/database'
import Transaction from '../../models/Transaction'
import { requireAuth } from '../../middleware/auth'
import { calendarCompany } from '../../utils/calendarAccess'

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'attachments')
// GUARD (S2): the only name shape server/api/attachments/upload.ts writes — <organizationId>-<timestamp>-<random>.<ext>: no path
// separator, no percent, no backslash, one segment. A reference planted on a transaction or restored from a backup confers nothing;
// the 24-hex prefix must be the token's company, checked before any filesystem access.
const ATTACHMENT_NAME = /^[0-9a-f]{24}-[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/

export default defineEventHandler(async (event) => {
  requireAuth(event)
  await ensureConnection()
  const { organizationId } = await calendarCompany(event)
  const filename = String(event.context.params?.id || '')
  if (!ATTACHMENT_NAME.test(filename)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid attachment name' })
  }
  if (filename.slice(0, 24) !== String(organizationId)) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' })
  }

  const filepath = join(UPLOAD_DIR, filename)

  if (event.method === 'GET') {
    // Serve the file
    if (!existsSync(filepath)) {
      throw createError({ statusCode: 404, statusMessage: 'File not found' })
    }

    const stat = statSync(filepath)
    const ext = filename.split('.').pop()?.toLowerCase()

    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      pdf: 'application/pdf',
      webp: 'image/webp'
    }

    event.node.res.setHeader('Content-Type', mimeTypes[ext || ''] || 'application/octet-stream')
    event.node.res.setHeader('Content-Length', stat.size)

    return sendStream(event, createReadStream(filepath))
  }

  if (event.method === 'DELETE') {
    // Remove the reference from this company's transactions only; another company's reference to the same name stays.
    await Transaction.updateMany(
      { organizationId, 'attachments.filename': filename },
      { $pull: { attachments: { filename } } }
    )

    // Delete the file
    if (existsSync(filepath)) {
      await unlink(filepath)
    }

    return { success: true, message: 'Attachment deleted' }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
