// server/api/backup/schedule.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Transaction from '../../models/Transaction'
import Receipt from '../../models/Receipt'
import RecurringPayment from '../../models/RecurringPayment'
import Invoice from '../../models/Invoice'
import Budget from '../../models/Budget'
import Vendor from '../../models/Vendor'
import { writeFile, mkdir, readdir, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

const BACKUP_DIR = join(process.cwd(), 'backups')
const MAX_BACKUPS = 7 // Keep last 7 backups

async function createBackup(): Promise<{ filename: string; size: number }> {
  await ensureConnection()

  // Ensure backup directory exists
  if (!existsSync(BACKUP_DIR)) {
    await mkdir(BACKUP_DIR, { recursive: true })
  }

  // Gather all data
  const [transactions, receipts, recurring, invoices, budgets, vendors] = await Promise.all([
    Transaction.find({}).lean(),
    Receipt.find({}).lean(),
    RecurringPayment.find({}).lean(),
    Invoice.find({}).lean(),
    Budget.find({}).lean(),
    Vendor.find({}).lean()
  ])

  const backup = {
    version: '1.0',
    createdAt: new Date().toISOString(),
    data: {
      transactions,
      receipts,
      recurringPayments: recurring,
      invoices,
      budgets,
      vendors
    },
    stats: {
      transactions: transactions.length,
      receipts: receipts.length,
      recurringPayments: recurring.length,
      invoices: invoices.length,
      budgets: budgets.length,
      vendors: vendors.length
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `backup-${timestamp}.json`
  const filepath = join(BACKUP_DIR, filename)

  const content = JSON.stringify(backup, null, 2)
  await writeFile(filepath, content, 'utf-8')

  // Clean up old backups
  await cleanupOldBackups()

  return { filename, size: content.length }
}

async function cleanupOldBackups(): Promise<void> {
  try {
    const files = await readdir(BACKUP_DIR)
    const backupFiles = files
      .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
      .sort()
      .reverse()

    // Delete old backups beyond MAX_BACKUPS
    for (let i = MAX_BACKUPS; i < backupFiles.length; i++) {
      await unlink(join(BACKUP_DIR, backupFiles[i]))
    }
  } catch (error) {
    console.error('[Backup] Cleanup error:', error)
  }
}

async function listBackups(): Promise<any[]> {
  if (!existsSync(BACKUP_DIR)) {
    return []
  }

  const files = await readdir(BACKUP_DIR)
  const backups = files
    .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
    .map(f => {
      const match = f.match(/backup-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/)
      return {
        filename: f,
        createdAt: match ? match[1].replace(/-/g, ':').replace('T', ' ') : null
      }
    })
    .sort((a, b) => b.filename.localeCompare(a.filename))

  return backups
}

export default defineEventHandler(async (event) => {
  const method = event.method

  if (method === 'GET') {
    // List available backups
    const backups = await listBackups()
    return { backups }
  }

  if (method === 'POST') {
    const body = await readBody(event)
    const { action } = body

    if (action === 'create') {
      const result = await createBackup()
      return {
        success: true,
        message: 'Backup created',
        ...result
      }
    }

    throw createError({ statusCode: 400, statusMessage: 'Invalid action' })
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
