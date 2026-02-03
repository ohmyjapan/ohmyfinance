// server/api/currency/rates.ts
import { defineEventHandler, createError } from 'h3'

// Fallback rates with JPY as base
const FALLBACK_RATES: Record<string, { rate: number; name: string; symbol: string }> = {
  JPY: { rate: 1, name: 'Japanese Yen', symbol: '¥' },
  USD: { rate: 0.0067, name: 'US Dollar', symbol: '$' },
  EUR: { rate: 0.0062, name: 'Euro', symbol: '€' },
  GBP: { rate: 0.0053, name: 'British Pound', symbol: '£' },
  CNY: { rate: 0.048, name: 'Chinese Yuan', symbol: '¥' },
  KRW: { rate: 8.9, name: 'South Korean Won', symbol: '₩' },
  AUD: { rate: 0.0103, name: 'Australian Dollar', symbol: 'A$' },
  CAD: { rate: 0.0091, name: 'Canadian Dollar', symbol: 'C$' },
  CHF: { rate: 0.006, name: 'Swiss Franc', symbol: 'CHF' },
  HKD: { rate: 0.052, name: 'Hong Kong Dollar', symbol: 'HK$' },
  SGD: { rate: 0.009, name: 'Singapore Dollar', symbol: 'S$' },
  TWD: { rate: 0.21, name: 'Taiwan Dollar', symbol: 'NT$' },
  THB: { rate: 0.24, name: 'Thai Baht', symbol: '฿' }
}

/**
 * GET /api/currency/rates
 * Get all supported currencies and their rates
 */
export default defineEventHandler(async () => {
  try {
    // Try to fetch live rates
    let rates = FALLBACK_RATES
    let isLive = false

    try {
      const response = await fetch('https://api.exchangerate-api.com/v4/latest/JPY')
      if (response.ok) {
        const data = await response.json()
        // Merge with our metadata
        rates = Object.fromEntries(
          Object.entries(FALLBACK_RATES).map(([code, info]) => [
            code,
            {
              ...info,
              rate: data.rates[code] || info.rate
            }
          ])
        )
        isLive = true
      }
    } catch {
      // Use fallback
    }

    return {
      success: true,
      base: 'JPY',
      currencies: rates,
      isLive,
      lastUpdated: new Date().toISOString()
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to fetch rates'
    })
  }
})
