// server/api/validate/transactions.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Transaction from '../../models/Transaction'

interface ValidationIssue {
  id: string
  reference: string
  field: string
  issue: string
  severity: 'error' | 'warning' | 'info'
  suggestion?: string
}

export default defineEventHandler(async (event) => {
  await ensureConnection()

  if (event.method === 'GET') {
    // Validate all transactions
    const transactions = await Transaction.find({}).lean()
    const issues: ValidationIssue[] = []

    for (const tx of transactions as any[]) {
      // Check for missing required fields
      if (!tx.reference) {
        issues.push({
          id: tx._id.toString(),
          reference: tx._id.toString(),
          field: 'reference',
          issue: 'Missing reference number',
          severity: 'error'
        })
      }

      if (!tx.amount || tx.amount <= 0) {
        issues.push({
          id: tx._id.toString(),
          reference: tx.reference || tx._id.toString(),
          field: 'amount',
          issue: 'Invalid or missing amount',
          severity: 'error'
        })
      }

      if (!tx.date) {
        issues.push({
          id: tx._id.toString(),
          reference: tx.reference,
          field: 'date',
          issue: 'Missing transaction date',
          severity: 'error'
        })
      } else {
        const txDate = new Date(tx.date)
        if (txDate > new Date()) {
          issues.push({
            id: tx._id.toString(),
            reference: tx.reference,
            field: 'date',
            issue: 'Transaction date is in the future',
            severity: 'warning'
          })
        }
      }

      if (!tx.customer?.name) {
        issues.push({
          id: tx._id.toString(),
          reference: tx.reference,
          field: 'customer.name',
          issue: 'Missing customer name',
          severity: 'warning',
          suggestion: 'Add customer information for better tracking'
        })
      }

      if (!tx.customer?.email || !isValidEmail(tx.customer.email)) {
        issues.push({
          id: tx._id.toString(),
          reference: tx.reference,
          field: 'customer.email',
          issue: 'Missing or invalid customer email',
          severity: 'info'
        })
      }

      // Check for unusually large amounts
      if (tx.amount > 10000000) { // 10 million yen
        issues.push({
          id: tx._id.toString(),
          reference: tx.reference,
          field: 'amount',
          issue: 'Unusually large transaction amount',
          severity: 'warning',
          suggestion: 'Verify this amount is correct'
        })
      }

      // Check for duplicate references
      const duplicateCount = transactions.filter((t: any) =>
        t.reference === tx.reference && t._id.toString() !== tx._id.toString()
      ).length
      if (duplicateCount > 0) {
        issues.push({
          id: tx._id.toString(),
          reference: tx.reference,
          field: 'reference',
          issue: `Duplicate reference found (${duplicateCount} other transaction(s))`,
          severity: 'warning',
          suggestion: 'Use unique reference numbers'
        })
      }

      // Check status consistency
      if (tx.status === 'completed' && !tx.receipt && !tx.metadata?.noReceiptRequired) {
        issues.push({
          id: tx._id.toString(),
          reference: tx.reference,
          field: 'receipt',
          issue: 'Completed transaction without receipt',
          severity: 'info',
          suggestion: 'Attach a receipt for record keeping'
        })
      }
    }

    // Group by severity
    const summary = {
      errors: issues.filter(i => i.severity === 'error').length,
      warnings: issues.filter(i => i.severity === 'warning').length,
      info: issues.filter(i => i.severity === 'info').length,
      total: issues.length,
      transactionsChecked: transactions.length
    }

    return { issues, summary }
  }

  if (event.method === 'POST') {
    // Validate specific data before import
    const body = await readBody(event)
    const { transactions: txData } = body

    if (!Array.isArray(txData)) {
      throw createError({ statusCode: 400, statusMessage: 'transactions array required' })
    }

    const validationResults = txData.map((tx: any, idx: number) => {
      const errors: string[] = []
      const warnings: string[] = []

      if (!tx.amount || isNaN(parseFloat(tx.amount))) {
        errors.push('Invalid amount')
      }
      if (!tx.date || isNaN(Date.parse(tx.date))) {
        errors.push('Invalid date')
      }
      if (!tx.customerName && !tx.customer?.name) {
        warnings.push('Missing customer name')
      }

      return {
        row: idx + 1,
        valid: errors.length === 0,
        errors,
        warnings,
        data: tx
      }
    })

    const valid = validationResults.filter((r: any) => r.valid).length
    const invalid = validationResults.filter((r: any) => !r.valid).length

    return {
      valid,
      invalid,
      total: txData.length,
      results: validationResults
    }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}
