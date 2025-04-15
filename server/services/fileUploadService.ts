// server/services/fileUploadService.ts
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'
import * as Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { create as createInDb } from '../utils/database'

const writeFileAsync = promisify(fs.writeFile)
const readFileAsync = promisify(fs.readFile)
const mkdirAsync = promisify(fs.mkdir)

// Ensure upload directories exist
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads')
const RECEIPTS_DIR = path.join(UPLOAD_DIR, 'receipts')
const TRANSACTIONS_DIR = path.join(UPLOAD_DIR, 'transactions')

async function ensureDirectoriesExist() {
    try {
        if (!fs.existsSync(UPLOAD_DIR)) {
            await mkdirAsync(UPLOAD_DIR, { recursive: true })
        }
        if (!fs.existsSync(RECEIPTS_DIR)) {
            await mkdirAsync(RECEIPTS_DIR, { recursive: true })
        }
        if (!fs.existsSync(TRANSACTIONS_DIR)) {
            await mkdirAsync(TRANSACTIONS_DIR, { recursive: true })
        }
    } catch (error) {
        console.error('Failed to create upload directories:', error)
    }
}

// Call on startup
ensureDirectoriesExist()

/**
 * Save a file to the filesystem and record in database
 */
export async function saveFile(file: any, type: 'receipt' | 'transaction') {
    try {
        const fileId = randomUUID()
        const fileName = `${fileId}-${file.name}`
        const uploadDir = type === 'receipt' ? RECEIPTS_DIR : TRANSACTIONS_DIR
        const filePath = path.join(uploadDir, fileName)

        // Convert buffer to Uint8Array
        const buffer = file.data
        await writeFileAsync(filePath, buffer)

        // Create a record in the database
        const fileRecord = {
            id: fileId,
            originalName: file.name,
            fileName,
            mimeType: file.type,
            size: file.size,
            path: filePath,
            uploadDate: new Date().toISOString(),
            type
        }

        if (type === 'receipt') {
            await createInDb('receiptFiles', fileRecord)
        } else {
            await createInDb('transactionFiles', fileRecord)
        }

        return fileRecord
    } catch (error) {
        console.error(`Failed to save ${type} file:`, error)
        throw error
    }
}

/**
 * Process a transaction file (CSV or Excel)
 */
export async function processTransactionFile(fileRecord: any, sourceType: string) {
    try {
        // Read the file
        const fileData = await readFileAsync(fileRecord.path)

        // Parse based on file type
        let parsedData
        if (fileRecord.mimeType === 'text/csv' || fileRecord.originalName.endsWith('.csv')) {
            // Parse CSV
            const csvText = fileData.toString('utf-8')
            const result = Papa.parse(csvText, {
                header: true,
                skipEmptyLines: true,
                dynamicTyping: true
            })
            parsedData = result.data
        } else if (
            fileRecord.mimeType === 'application/vnd.ms-excel' ||
            fileRecord.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            fileRecord.originalName.endsWith('.xls') ||
            fileRecord.originalName.endsWith('.xlsx')
        ) {
            // Parse Excel
            const workbook = XLSX.read(fileData, { type: 'buffer' })
            const sheetName = workbook.SheetNames[0]
            const worksheet = workbook.Sheets[sheetName]
            parsedData = XLSX.utils.sheet_to_json(worksheet)
        } else {
            throw new Error(`Unsupported file type: ${fileRecord.mimeType}`)
        }

        // Add metadata about source
        parsedData = parsedData.map(item => ({
            ...item,
            _sourceType: sourceType,
            _sourceFile: fileRecord.id,
            _importDate: new Date().toISOString()
        }))

        return parsedData
    } catch (error) {
        console.error('Failed to process transaction file:', error)
        throw error
    }
}

/**
 * Extract data from a receipt image/document
 * In a real app, this would use OCR or a receipt parsing service
 * This is a simplified mock implementation
 */
export async function extractReceiptData(fileRecord: any) {
    // In a real app, you'd use OCR or a receipt parsing service
    // For this demo, we'll just return mock data
    return {
        merchantName: 'Sample Merchant',
        date: new Date().toISOString().split('T')[0],
        amount: 123.45,
        currency: 'USD',
        items: [
            { name: 'Item 1', quantity: 1, price: 99.99 },
            { name: 'Item 2', quantity: 2, price: 11.73 }
        ],
        confidence: 0.85 // Confidence score of extraction
    }
}

/**
 * Find potential transaction matches for a receipt
 */
export async function findReceiptMatches(receiptData: any) {
    // In a real app, you'd query your database for transactions that match
    // the receipt date, amount, merchant, etc.

    // For now, we'll return mock matches
    return [
        {
            transactionId: 'txn_123456',
            date: receiptData.date,
            amount: receiptData.amount,
            confidence: 0.95,
            source: 'credit_card'
        },
        {
            transactionId: 'txn_789012',
            date: receiptData.date,
            amount: receiptData.amount - 0.01, // Slight difference
            confidence: 0.85,
            source: 'payment_gateway'
        }
    ]
}