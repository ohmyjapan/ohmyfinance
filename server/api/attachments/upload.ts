// server/api/attachments/upload.ts
import { defineEventHandler, readMultipartFormData, createError } from 'h3'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { ensureConnection } from '../../config/database'
import Transaction from '../../models/Transaction'
import Receipt from '../../models/Receipt'
import { requireAuth } from '../../middleware/auth'

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'attachments')

export default defineEventHandler(async (event) => {
  requireAuth(event)
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  try {
    // Ensure upload directory exists
    if (!existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true })
    }

    const formData = await readMultipartFormData(event)
    if (!formData || formData.length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'No file uploaded' })
    }

    const uploadedFiles: any[] = []
    let entityType = ''
    let entityId = ''

    for (const field of formData) {
      if (field.name === 'entityType') {
        entityType = field.data.toString()
      } else if (field.name === 'entityId') {
        entityId = field.data.toString()
      } else if (field.name === 'file' || field.name === 'files') {
        const file = field
        const ext = file.filename?.split('.').pop() || 'jpg'
        const timestamp = Date.now()
        const randomStr = Math.random().toString(36).substring(7)
        const filename = `${timestamp}-${randomStr}.${ext}`
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
    }

    // Link to entity if provided
    if (entityType && entityId && uploadedFiles.length > 0) {
      await ensureConnection()

      if (entityType === 'transaction') {
        await Transaction.findByIdAndUpdate(entityId, {
          $push: { attachments: { $each: uploadedFiles } }
        })
      } else if (entityType === 'receipt') {
        await Receipt.findByIdAndUpdate(entityId, {
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
    console.error('Upload error:', error)
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
