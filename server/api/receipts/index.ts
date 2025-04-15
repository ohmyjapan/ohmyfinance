import { defineEventHandler, readMultipartFormData, getQuery, createError } from 'h3'
import { v4 as uuidv4 } from 'uuid'

// In a real app, you would use a database
// This is a simple in-memory store for demo purposes
let receipts = []

/**
 * Handles receipt operations
 * GET, POST /api/receipts
 */
export default defineEventHandler(async (event) => {
    const method = event.method

    // GET - List receipts
    if (method === 'GET') {
        const query = getQuery(event)

        // Apply filters if provided
        let filteredReceipts = [...receipts]

        if (query.status) {
            filteredReceipts = filteredReceipts.filter(r =>
                r.status === query.status
            )
        }

        if (query.dateFrom) {
            const fromDate = new Date(query.dateFrom as string)
            filteredReceipts = filteredReceipts.filter(r =>
                new Date(r.uploadDate) >= fromDate
            )
        }

        if (query.dateTo) {
            const toDate = new Date(query.dateTo as string)
            toDate.setHours(23, 59, 59, 999) // End of day
            filteredReceipts = filteredReceipts.filter(r =>
                new Date(r.uploadDate) <= toDate
            )
        }

        if (query.minAmount && query.minAmount !== '') {
            const min = parseFloat(query.minAmount as string)
            filteredReceipts = filteredReceipts.filter(r =>
                r.amount && r.amount >= min
            )
        }

        if (query.maxAmount && query.maxAmount !== '') {
            const max = parseFloat(query.maxAmount as string)
            filteredReceipts = filteredReceipts.filter(r =>
                r.amount && r.amount <= max
            )
        }

        if (query.merchant) {
            const merchant = (query.merchant as string).toLowerCase()
            filteredReceipts = filteredReceipts.filter(r =>
                r.merchant && r.merchant.toLowerCase().includes(merchant)
            )
        }

        if (query.search) {
            const search = (query.search as string).toLowerCase()
            filteredReceipts = filteredReceipts.filter(r =>
                r.filename.toLowerCase().includes(search) ||
                (r.merchant && r.merchant.toLowerCase().includes(search)) ||
                (r.transactionId && r.transactionId.toLowerCase().includes(search))
            )
        }

        // Pagination
        const page = parseInt(query.page as string) || 1
        const limit = parseInt(query.limit as string) || 10
        const startIndex = (page - 1) * limit
        const endIndex = page * limit

        // Calculate stats
        const total = filteredReceipts.length
        const matched = filteredReceipts.filter(r => r.status === 'matched').length
        const unmatched = total - matched

        // Return paginated results with metadata
        return {
            receipts: filteredReceipts.slice(startIndex, endIndex),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            },
            stats: {
                total,
                matched,
                unmatched,
                matchRate: total > 0 ? matched / total : 0
            }
        }
    }

    // POST - Upload a new receipt
    if (method === 'POST') {
        // Parse multipart form data (file upload)
        const formData = await readMultipartFormData(event)

        if (!formData || formData.length === 0) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Bad Request',
                message: 'No file uploaded'
            })
        }

        // Get the file and metadata
        const file = formData.find(part => part.name === 'file')
        const metadataParam = formData.find(part => part.name === 'metadata')

        if (!file || !file.data) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Bad Request',
                message: 'Invalid file upload'
            })
        }

        // Parse metadata if provided
        const metadata = metadataParam ? JSON.parse(metadataParam.data.toString()) : {}

        // Get file info
        const fileName = file.filename || `receipt_${Date.now()}.${file.type?.split('/')[1] || 'pdf'}`
        const fileSize = file.data.length

        // Validate file size (max 10MB)
        const maxSize = 10 * 1024 * 1024 // 10MB
        if (fileSize > maxSize) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Bad Request',
                message: 'File is too large. Maximum size is 10MB.'
            })
        }

        // Validate file type
        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg']
        if (!allowedTypes.includes(file.type)) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Bad Request',
                message: 'Invalid file type. Supported formats: PDF, JPG, PNG.'
            })
        }

        // In a real app, you would:
        // 1. Save the file to storage (e.g., S3, local filesystem)
        // 2. Process the file with OCR to extract data
        // 3. Store the receipt metadata in a database

        // For this example, we'll just create a receipt object
        const newReceipt = {
            id: `receipt_${uuidv4().substring(0, 8)}`,
            filename: fileName,
            size: fileSize,
            uploadDate: new Date().toISOString(),
            amount: metadata.amount || null,
            merchant: metadata.merchant || null,
            status: 'unmatched', // Initial status
            transactionId: metadata.transactionId || null,
            notes: metadata.notes || '',
            tags: metadata.tags || [],
            // In a real app, this would be a URL to the stored file
            url: `/api/receipts/${uuidv4().substring(0, 8)}/file`,
            createdBy: 'current-user', // In a real app, from auth context
            updatedAt: new Date().toISOString()
        }

        // Add to the collection
        receipts.push(newReceipt)

        // If this receipt is being matched directly to a transaction
        if (newReceipt.transactionId) {
            newReceipt.status = 'matched'

            // In a real app, you would update the transaction with the receipt reference
            // For now, we'll assume this happens elsewhere
        }

        return {
            receipt: newReceipt,
            message: 'Receipt uploaded successfully'
        }
    }

    // Method not allowed
    throw createError({
        statusCode: 405,
        statusMessage: 'Method Not Allowed',
        message: `Method ${method} not allowed for this endpoint`
    })
})