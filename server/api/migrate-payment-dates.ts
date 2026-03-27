// server/api/payments/migrate-dates.ts
// Migration script to fix existing payment dates to noon UTC
// Run once via: GET /api/payments/migrate-dates

import { defineEventHandler, createError } from 'h3'
import { ensureConnection } from '../config/database'
import { Payment } from '../models/Payment'
import { requireAuth } from '../middleware/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  // Only allow GET method
  if (event.method !== 'GET') {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method not allowed. Use GET to run migration.'
    })
  }

  // Ensure MongoDB connection
  try {
    await ensureConnection()
  } catch (error) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Database connection failed'
    })
  }

  try {
    // Get all payments
    const payments = await Payment.find({})

    let migratedCount = 0
    let skippedCount = 0
    const errors: string[] = []

    for (const payment of payments) {
      try {
        const currentDate = payment.dueDate

        if (!currentDate) {
          skippedCount++
          continue
        }

        // Check if already at noon UTC (hour === 12)
        if (currentDate.getUTCHours() === 12 && currentDate.getUTCMinutes() === 0) {
          skippedCount++
          continue
        }

        // Extract the date parts from the current stored date
        // If stored as midnight UTC, the date might be off by one day depending on original timezone
        // We'll use the UTC date parts to preserve what was intended
        const year = currentDate.getUTCFullYear()
        const month = currentDate.getUTCMonth()
        const day = currentDate.getUTCDate()

        // Create new date at noon UTC
        const newDate = new Date(Date.UTC(year, month, day, 12, 0, 0, 0))

        // Update the payment
        await Payment.findByIdAndUpdate(payment._id, {
          $set: { dueDate: newDate }
        })

        migratedCount++
      } catch (err: any) {
        errors.push(`Payment ${payment._id}: ${err.message}`)
      }
    }

    return {
      success: true,
      message: 'Migration completed',
      stats: {
        total: payments.length,
        migrated: migratedCount,
        skipped: skippedCount,
        errors: errors.length
      },
      errors: errors.length > 0 ? errors : undefined
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Migration failed',
      message: error.message
    })
  }
})
