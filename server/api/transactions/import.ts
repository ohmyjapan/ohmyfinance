import { defineEventHandler, readMultipartFormData, createError } from 'h3'
import { v4 as uuidv4 } from 'uuid'
import * as Papa from 'papaparse'
import { writeFile, mkdir, unlink, readFile } from 'fs/promises'
import { join, basename, extname } from 'path'
import { spawn } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { createTransaction } from '../../services/transactionService'
import AccountCategory from '../../models/AccountCategory'
import TaxCategory from '../../models/TaxCategory'
import Supplier from '../../models/Supplier'
import TransactionCategory from '../../models/TransactionCategory'
import Customer from '../../models/Customer'
import { ensureConnection } from '../../config/database'
import { requireAuth } from '../../middleware/auth'

/**
 * Process Excel file using a child process to avoid ESM issues
 */
async function processExcelFile(filePath: string, outputDir: string): Promise<string> {
    await mkdir(outputDir, { recursive: true })

    const fileName = basename(filePath)
    const scriptPath = join(process.cwd(), `temp-excel-import-${Date.now()}.cjs`)
    const outputPath = join(outputDir, `${basename(fileName, extname(fileName))}.json`)

    // Escape paths for Windows compatibility
    const escapedFilePath = filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const escapedOutputPath = outputPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

    const scriptContent = `
const XLSX = require('xlsx');
const fs = require('fs');

try {
    const workbook = XLSX.readFile('${escapedFilePath}', {
        cellStyles: true,
        cellDates: true,
        cellNF: true
    });

    // Get first sheet and convert to JSON with headers
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    fs.writeFileSync('${escapedOutputPath}', JSON.stringify({ data, sheetName: firstSheetName }, null, 2));
    console.log('SUCCESS');
    process.exit(0);
} catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
}
`

    writeFileSync(scriptPath, scriptContent, 'utf8')

    return new Promise((resolve, reject) => {
        const child = spawn('node', [scriptPath])
        let stderr = ''

        child.stderr.on('data', (data) => {
            stderr += data.toString()
        })

        child.on('close', (code) => {
            try { unlinkSync(scriptPath) } catch (e) {}

            if (code === 0) {
                resolve(outputPath)
            } else {
                reject(new Error(`Excel processing failed: ${stderr}`))
            }
        })
    })
}

/**
 * POST /api/transactions/import
 * Import transactions from CSV or Excel files
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
    if (event.method !== 'POST') {
        throw createError({
            statusCode: 405,
            statusMessage: 'Method Not Allowed',
            message: `Method ${event.method} not allowed for this endpoint`
        })
    }

    // Parse multipart form data (file upload)
    const formData = await readMultipartFormData(event)

    if (!formData || formData.length === 0) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Bad Request',
            message: 'No file uploaded'
        })
    }

    // Get the file and options data
    const file = formData.find(part => part.name === 'file')
    const optionsParam = formData.find(part => part.name === 'options')
    const mappingsParam = formData.find(part => part.name === 'mappings')

    if (!file || !file.data) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Bad Request',
            message: 'Invalid file upload'
        })
    }

    // Parse options and mappings
    const options = optionsParam ? JSON.parse(optionsParam.data.toString()) : {}
    const mappings = mappingsParam ? JSON.parse(mappingsParam.data.toString()) : {}

    // Determine file type
    const fileName = file.filename || ''
    const isCSV = fileName.toLowerCase().endsWith('.csv')
    const isExcel = fileName.toLowerCase().endsWith('.xlsx') || fileName.toLowerCase().endsWith('.xls')

    if (!isCSV && !isExcel) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Bad Request',
            message: 'Unsupported file format. Please upload a CSV or Excel file.'
        })
    }

    try {
        // Parse the file based on type
        let parsedData = []

        if (isCSV) {
            // Parse CSV
            const csvString = file.data.toString()
            const parseResult = Papa.parse(csvString, {
                header: true,
                skipEmptyLines: true,
                dynamicTyping: true
            })

            parsedData = parseResult.data
        } else if (isExcel) {
            // Process Excel file using child process to avoid ESM issues
            const uploadDir = join(process.cwd(), 'server/data/download')
            const processedDir = join(process.cwd(), 'server/data/processed')

            await mkdir(uploadDir, { recursive: true })

            // Save uploaded file temporarily
            const timestamp = Date.now()
            const safeFileName = `${timestamp}-${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`
            const tempFilePath = join(uploadDir, safeFileName)

            await writeFile(tempFilePath, file.data)

            try {
                // Process Excel file
                const jsonPath = await processExcelFile(tempFilePath, processedDir)
                const jsonContent = await readFile(jsonPath, 'utf8')
                const result = JSON.parse(jsonContent)

                parsedData = result.data || []

                // Clean up processed JSON
                try { await unlink(jsonPath) } catch (e) {}
            } finally {
                // Clean up temp file
                try { await unlink(tempFilePath) } catch (e) {}
            }
        }

        // Apply field mappings if provided
        if (mappings && Object.keys(mappings).length > 0) {
            parsedData = parsedData.map(row => {
                const mappedRow = {}

                Object.keys(mappings).forEach(sourceField => {
                    const targetField = mappings[sourceField].field

                    if (targetField && row[sourceField] !== undefined) {
                        mappedRow[targetField] = row[sourceField]
                    }
                })

                return mappedRow
            })
        }

        // Ensure MongoDB connection
        await ensureConnection()

        // Track import results
        const importResults = {
            total: parsedData.length,
            imported: 0,
            skipped: 0,
            updated: 0,
            errors: [] as any[]
        }

        // Process each record
        const importedTransactions: any[] = []

        // Helper function to find or create related records by name
        const findAccountCategory = async (name: string) => {
            if (!name) return null
            const cat = await AccountCategory.findOne({ name })
            return cat?._id || null
        }

        const findTaxCategory = async (name: string) => {
            if (!name) return null
            const cat = await TaxCategory.findOne({ name })
            return cat?._id || null
        }

        const findSupplier = async (name: string) => {
            if (!name) return null
            let supplier = await Supplier.findOne({ name })
            if (!supplier) {
                supplier = await Supplier.create({ name, isActive: true })
            }
            return supplier._id
        }

        const findCustomer = async (name: string) => {
            if (!name) return null
            let customer = await Customer.findOne({ name })
            if (!customer) {
                customer = await Customer.create({ name, isActive: true })
            }
            return customer._id
        }

        const findTransactionCategory = async (name: string) => {
            if (!name) return null
            const cat = await TransactionCategory.findOne({ name })
            return cat?._id || null
        }

        for (const record of parsedData) {
            try {
                // Validate required fields (OMF style)
                if (!record.amount && record.amount !== 0) {
                    importResults.errors.push({
                        record,
                        error: '金額は必須です (Missing required field: amount)'
                    })
                    continue
                }

                // Parse date
                let transactionDate = new Date()
                if (record.date) {
                    transactionDate = new Date(record.date)
                }

                // Parse type (支出/入金)
                let transactionType = record.type || '支出'
                if (transactionType !== '支出' && transactionType !== '入金') {
                    // Try to infer from amount sign or default
                    const amount = parseFloat(record.amount)
                    transactionType = amount < 0 ? '支出' : '入金'
                }

                // Resolve related IDs by name
                const accountCategoryId = await findAccountCategory(record.accountCategoryName)
                const subAccountCategoryId = await findAccountCategory(record.subAccountCategoryName)
                const taxCategoryId = await findTaxCategory(record.taxCategoryName)
                const supplierId = await findSupplier(record.supplierName)
                const customerId = await findCustomer(record.customerName)
                const transactionCategoryId = await findTransactionCategory(record.transactionCategoryName)

                // Create a new transaction (OMF style)
                const transactionData = {
                    referenceNumber: record.referenceNumber || `IMP-${Date.now()}-${importResults.imported}`,
                    date: transactionDate,
                    amount: Math.abs(parseFloat(record.amount)),
                    type: transactionType,
                    status: 'completed',
                    accountCategoryId,
                    subAccountCategoryId,
                    taxCategoryId,
                    taxRate: record.taxRate ? parseFloat(record.taxRate) : undefined,
                    supplierId,
                    customerId,
                    transactionCategoryId,
                    companyInfo: record.companyInfo || '',
                    invoiceNumber: record.invoiceNumber || '',
                    receiptNumber: record.receiptNumber || '',
                    productName: record.productName || '',
                    productPrice: record.productPrice ? parseFloat(record.productPrice) : undefined,
                    janCode: record.janCode || '',
                    notes: record.notes || '',
                    hasReceipt: false,
                    tags: ['imported'],
                    timeline: [
                        {
                            type: 'imported',
                            title: 'インポート完了',
                            timestamp: new Date(),
                            description: `${fileName}からインポート`
                        }
                    ]
                }

                const newTransaction = await createTransaction(transactionData)
                importedTransactions.push(newTransaction)
                importResults.imported++

            } catch (error: any) {
                importResults.errors.push({
                    record,
                    error: error.message
                })
            }
        }

        return {
            success: true,
            results: importResults,
            transactions: importedTransactions
        }

    } catch (error) {
        console.error('Transaction import error:', error)
        throw createError({
            statusCode: 500,
            statusMessage: 'Internal Server Error',
            message: `Failed to process file: ${error.message}`
        })
    }
})