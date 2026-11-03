// server/api/attachments/upload.ts
import { defineEventHandler, readMultipartFormData, createError } from 'h3'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { isValidObjectId } from 'mongoose'
import { ensureConnection } from '../../config/database'
import Transaction from '../../models/Transaction'
import Receipt from '../../models/Receipt'
import { requireAuth } from '../../middleware/auth'
import { calendarCompany } from '../../utils/calendarAccess'

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'attachments')

export default defineEventHandler(async (event) => {
  requireAuth(event)
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  try {
    await ensureConnection()
    const { organizationId } = await calendarCompany(event)

    // Ensure upload directory exists
    if (!existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true })
    }

    const formData = await readMultipartFormData(event)
    if (!formData || formData.length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'No file uploaded' })
    }

    const uploadedFiles: any[] = []
    const files: typeof formData = []
    let entityType = ''
    let entityId = ''

    for (const field of formData) {
      if (field.name === 'entityType') {
        entityType = field.data.toString()
      } else if (field.name === 'entityId') {
        entityId = field.data.toString()
      } else if (field.name === 'file' || field.name === 'files') {
        files.push(field)
      }
    }

    // GUARD (S3): the entity is resolved in the token's company BEFORE any byte is written; a foreign or unknown entity leaves nothing on disk.
    if (entityType && entityId) {
      const exists = isValidObjectId(entityId) && (entityType === 'transaction'
        ? await Transaction.exists({ _id: entityId, organizationId })
        : entityType === 'receipt' ? await Receipt.exists({ _id: entityId, organizationId }) : null)
      if (!exists) throw createError({ statusCode: 404, statusMessage: 'Entity not found' })
    }

    for (const file of files) {
      // The server writes the name: the company prefix server/api/attachments/[id].ts checks, and an extension of letters and digits only.
      const rawExt = file.filename?.split('.').pop() || ''
      const ext = /^[A-Za-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'bin'
      const timestamp = Date.now()
      const randomStr = Math.random().toString(36).substring(7)
      const filename = `${organizationId}-${timestamp}-${randomStr}.${ext}`
      const filepath = join(UPLOAD_DIR, filename)

      await writeFile(filepath, file.data)

      uploadedFiles.push({
        originalName: file.filename,
        filename,
        path: `/uploads/attachments/${filename}`,
        size: file.data.length,
        mimeType: file.type || 'application/octet-stream',
        uploadedAt: new Date()
      })
    }

    // Link to entity if provided
    if (entityType && entityId && uploadedFiles.length > 0) {
      if (entityType === 'transaction') {
        await Transaction.updateOne({ _id: entityId, organizationId }, {
          $push: { attachments: { $each: uploadedFiles } }
        })
      } else if (entityType === 'receipt') {
        await Receipt.updateOne({ _id: entityId, organizationId }, {
          $set: { imagePath: uploadedFiles[0].path }
        })
      }
    }

    return {
      success: true,
      files: uploadedFiles,
      message: `${uploadedFiles.length} file(s) uploaded successfully`
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    console.error('Upload error:', error)
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
