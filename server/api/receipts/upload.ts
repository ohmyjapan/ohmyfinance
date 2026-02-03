// server/api/receipts/upload.ts
import { defineEventHandler, readMultipartFormData, createError } from 'h3'
import { writeFile, mkdir } from 'fs/promises'
import { join, extname } from 'path'
import { createReceipt } from '../../services/receiptService'
import { ensureConnection } from '../../config/database'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method Not Allowed'
    })
  }

  await ensureConnection()

  const formData = await readMultipartFormData(event)

  if (!formData || formData.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'No file uploaded'
    })
  }

  const file = formData.find(part => part.name === 'file')

  if (!file || !file.data) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Invalid file upload'
    })
  }

  try {
    // Create upload directory if it doesn't exist
    const uploadDir = join(process.cwd(), 'server/data/receipts')
    await mkdir(uploadDir, { recursive: true })

    // Generate unique filename
    const timestamp = Date.now()
    const ext = extname(file.filename || '.jpg')
    const filename = `receipt_${timestamp}${ext}`
    const filePath = join(uploadDir, filename)

    // Save file
    await writeFile(filePath, file.data)

    // Get file info
    const mimeType = file.type || 'application/octet-stream'
    const size = file.data.length

    // Create receipt record in database
    const receipt = await createReceipt({
      filename,
      originalFilename: file.filename || filename,
      size,
      mimeType,
      filePath,
      fileUrl: `/api/receipts/file/${filename}`
    }, {
      // These would normally be extracted via OCR
      amount: null,
      currency: 'JPY',
      merchant: null,
      receiptDate: new Date(),
      notes: '',
      tags: ['uploaded']
    })

    return {
      success: true,
      receipt: {
        id: receipt._id,
        _id: receipt._id,
        filename: receipt.filename,
        originalFilename: receipt.originalFilename,
        size: receipt.size,
        uploadDate: receipt.createdAt,
        status: receipt.status || 'unmatched',
        transactionId: receipt.transactionId || null,
        amount: receipt.amount,
        merchant: receipt.merchant
      }
    }
  } catch (error: any) {
    console.error('Receipt upload error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error.message || 'Failed to upload receipt'
    })
  }
})
