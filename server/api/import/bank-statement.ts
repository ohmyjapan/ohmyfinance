// server/api/import/bank-statement.ts
import { defineEventHandler, readMultipartFormData, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Transaction from '../../models/Transaction'

interface ParsedTransaction {
  date: Date
  amount: number
  description: string
  reference: string
  type: 'debit' | 'credit'
  memo?: string
  checkNumber?: string
}

// Parse OFX/QFX format (XML-like)
function parseOFX(content: string): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = []

  // Extract STMTTRN blocks
  const stmttrnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi
  let match

  while ((match = stmttrnRegex.exec(content)) !== null) {
    const block = match[1]

    const getValue = (tag: string): string => {
      const tagRegex = new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i')
      const tagMatch = block.match(tagRegex)
      return tagMatch ? tagMatch[1].trim() : ''
    }

    const trntype = getValue('TRNTYPE')
    const dtposted = getValue('DTPOSTED')
    const trnamt = getValue('TRNAMT')
    const fitid = getValue('FITID')
    const name = getValue('NAME')
    const memo = getValue('MEMO')
    const checknum = getValue('CHECKNUM')

    if (dtposted && trnamt) {
      // Parse date (YYYYMMDD or YYYYMMDDHHMMSS format)
      const year = parseInt(dtposted.substring(0, 4))
      const month = parseInt(dtposted.substring(4, 6)) - 1
      const day = parseInt(dtposted.substring(6, 8))

      const amount = parseFloat(trnamt)

      transactions.push({
        date: new Date(year, month, day),
        amount: Math.abs(amount),
        description: name || memo || 'Bank Transaction',
        reference: fitid || `OFX-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        type: amount < 0 ? 'debit' : 'credit',
        memo: memo,
        checkNumber: checknum
      })
    }
  }

  return transactions
}

// Parse QIF format (text-based)
function parseQIF(content: string): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = []
  const lines = content.split('\n')

  let currentTx: Partial<ParsedTransaction> = {}

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const code = trimmed[0]
    const value = trimmed.substring(1).trim()

    switch (code) {
      case 'D': // Date (MM/DD/YYYY or MM/DD/YY or DD/MM/YYYY)
        const parts = value.split(/[\/\-]/)
        if (parts.length === 3) {
          let year = parseInt(parts[2])
          if (year < 100) year += 2000
          const month = parseInt(parts[0]) - 1
          const day = parseInt(parts[1])
          currentTx.date = new Date(year, month, day)
        }
        break

      case 'T': // Amount
      case 'U': // Amount (alternate)
        const amount = parseFloat(value.replace(/[,\s]/g, ''))
        currentTx.amount = Math.abs(amount)
        currentTx.type = amount < 0 ? 'debit' : 'credit'
        break

      case 'P': // Payee/Description
        currentTx.description = value
        break

      case 'M': // Memo
        currentTx.memo = value
        break

      case 'N': // Check number or reference
        currentTx.checkNumber = value
        break

      case '^': // End of transaction
        if (currentTx.date && currentTx.amount !== undefined) {
          transactions.push({
            date: currentTx.date,
            amount: currentTx.amount,
            description: currentTx.description || 'Bank Transaction',
            reference: currentTx.checkNumber || `QIF-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            type: currentTx.type || 'debit',
            memo: currentTx.memo,
            checkNumber: currentTx.checkNumber
          })
        }
        currentTx = {}
        break
    }
  }

  return transactions
}

// Parse CSV bank statement
function parseCSV(content: string): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = []
  const lines = content.split('\n').filter(l => l.trim())

  if (lines.length < 2) return transactions

  // Try to detect header row and column mapping
  const header = lines[0].toLowerCase()
  const columns = lines[0].split(',').map(c => c.trim().toLowerCase().replace(/['"]/g, ''))

  const dateIdx = columns.findIndex(c => c.includes('date') || c === '日付')
  const amountIdx = columns.findIndex(c => c.includes('amount') || c.includes('金額') || c === 'debit' || c === 'credit')
  const descIdx = columns.findIndex(c => c.includes('description') || c.includes('memo') || c.includes('摘要') || c.includes('payee'))

  if (dateIdx === -1 || amountIdx === -1) {
    // Try common patterns
    return transactions
  }

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/['"]/g, ''))

    if (values.length < Math.max(dateIdx, amountIdx, descIdx) + 1) continue

    const dateStr = values[dateIdx]
    const amountStr = values[amountIdx]
    const description = values[descIdx] || 'Bank Transaction'

    // Parse date
    let date: Date | null = null
    const dateFormats = [
      /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/, // YYYY/MM/DD or YYYY-MM-DD
      /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/, // MM/DD/YYYY or DD/MM/YYYY
      /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})/  // MM/DD/YY
    ]

    for (const fmt of dateFormats) {
      const match = dateStr.match(fmt)
      if (match) {
        if (match[1].length === 4) {
          date = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]))
        } else {
          let year = parseInt(match[3])
          if (year < 100) year += 2000
          date = new Date(year, parseInt(match[1]) - 1, parseInt(match[2]))
        }
        break
      }
    }

    if (!date) continue

    const amount = parseFloat(amountStr.replace(/[,\s¥$€]/g, ''))
    if (isNaN(amount)) continue

    transactions.push({
      date,
      amount: Math.abs(amount),
      description,
      reference: `CSV-${Date.now()}-${i}`,
      type: amount < 0 ? 'debit' : 'credit'
    })
  }

  return transactions
}

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const formData = await readMultipartFormData(event)
  if (!formData) {
    throw createError({ statusCode: 400, statusMessage: 'No file uploaded' })
  }

  let fileContent = ''
  let filename = ''
  let saveToDb = false

  for (const field of formData) {
    if (field.name === 'file') {
      fileContent = field.data.toString('utf-8')
      filename = field.filename || ''
    } else if (field.name === 'save') {
      saveToDb = field.data.toString() === 'true'
    }
  }

  if (!fileContent) {
    throw createError({ statusCode: 400, statusMessage: 'Empty file' })
  }

  // Detect format and parse
  let parsedTransactions: ParsedTransaction[] = []
  let format = 'unknown'

  const ext = filename.split('.').pop()?.toLowerCase()

  if (ext === 'ofx' || ext === 'qfx' || fileContent.includes('<OFX>') || fileContent.includes('OFXHEADER')) {
    format = 'OFX'
    parsedTransactions = parseOFX(fileContent)
  } else if (ext === 'qif' || fileContent.startsWith('!Type:')) {
    format = 'QIF'
    parsedTransactions = parseQIF(fileContent)
  } else if (ext === 'csv' || fileContent.includes(',')) {
    format = 'CSV'
    parsedTransactions = parseCSV(fileContent)
  }

  if (parsedTransactions.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No transactions found in file. Unsupported format.' })
  }

  // Save to database if requested
  let savedCount = 0
  if (saveToDb) {
    await ensureConnection()

    for (const tx of parsedTransactions) {
      try {
        // Check for duplicates by reference
        const existing = await Transaction.findOne({ reference: tx.reference })
        if (!existing) {
          await Transaction.create({
            reference: tx.reference,
            date: tx.date,
            amount: tx.amount,
            currency: 'JPY',
            status: 'completed',
            source: 'manual',
            type: tx.type,
            customer: {
              name: tx.description,
              email: 'imported@bank.statement'
            },
            notes: tx.memo,
            metadata: {
              importedFrom: 'bank_statement',
              format,
              checkNumber: tx.checkNumber
            }
          })
          savedCount++
        }
      } catch (error) {
        console.error('Failed to save transaction:', error)
      }
    }
  }

  return {
    success: true,
    format,
    parsed: parsedTransactions.length,
    saved: savedCount,
    transactions: parsedTransactions.map(tx => ({
      ...tx,
      date: tx.date.toISOString().split('T')[0]
    }))
  }
})
