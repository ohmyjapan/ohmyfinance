// server/api/attachments/[id].ts
import { defineEventHandler, createError, sendStream } from 'h3'
import { createReadStream, existsSync, statSync } from 'fs'
import { join } from 'path'
import { unlink } from 'fs/promises'
import { ensureConnection } from '../../config/database'
import Transaction from '../../models/Transaction'
import { requireAuth } from '../../middleware/auth'

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'attachments')

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const filename = event.context.params?.id
  if (!filename) {
    throw createError({ statusCode: 400, statusMessage: 'Filename required' })
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
    await ensureConnection()

    // Remove from any transactions that reference this file
    await Transaction.updateMany(
      { 'attachments.filename': filename },
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
