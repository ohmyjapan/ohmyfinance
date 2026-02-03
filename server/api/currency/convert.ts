// server/api/currency/convert.ts
import { defineEventHandler, getQuery, createError } from 'h3'

// Exchange rates cache
let ratesCache: { rates: Record<string, number>; timestamp: number } | null = null
const CACHE_DURATION = 60 * 60 * 1000 // 1 hour

// Fallback rates (updated periodically)
const FALLBACK_RATES: Record<string, number> = {
  JPY: 1,
  USD: 0.0067,
  EUR: 0.0062,
  GBP: 0.0053,
  CNY: 0.048,
  KRW: 8.9,
  AUD: 0.0103,
  CAD: 0.0091,
  CHF: 0.006,
  HKD: 0.052
}

/**
 * GET /api/currency/convert
 * Convert between currencies
 */
export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const amount = parseFloat(String(query.amount || '0'))
    const from = String(query.from || 'JPY').toUpperCase()
    const to = String(query.to || 'USD').toUpperCase()

    if (isNaN(amount)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid amount' })
    }

    // Get exchange rates
    const rates = await getExchangeRates()

    // Convert through JPY as base
    const fromRate = rates[from]
    const toRate = rates[to]

    if (!fromRate || !toRate) {
      throw createError({
        statusCode: 400,
        statusMessage: `Unsupported currency: ${!fromRate ? from : to}`
      })
    }

    // Convert: amount in FROM -> JPY -> TO
    const jpyAmount = from === 'JPY' ? amount : amount / fromRate
    const convertedAmount = to === 'JPY' ? jpyAmount : jpyAmount * toRate

    return {
      success: true,
      from: {
        currency: from,
        amount: amount
      },
      to: {
        currency: to,
        amount: Math.round(convertedAmount * 100) / 100
      },
      rate: toRate / fromRate,
      ratesUpdated: ratesCache?.timestamp ? new Date(ratesCache.timestamp).toISOString() : null
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    console.error('Currency conversion error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Conversion failed'
    })
  }
})

/**
 * Get exchange rates (with caching)
 */
async function getExchangeRates(): Promise<Record<string, number>> {
  // Check cache
  if (ratesCache && Date.now() - ratesCache.timestamp < CACHE_DURATION) {
    return ratesCache.rates
  }

  // Try to fetch fresh rates from a free API
  try {
    // Using exchangerate-api.com free tier (or similar)
    // In production, use a paid API for reliability
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/JPY')

    if (response.ok) {
      const data = await response.json()
      ratesCache = {
        rates: data.rates,
        timestamp: Date.now()
      }
      return data.rates
    }
  } catch (error) {
    console.warn('Failed to fetch live exchange rates, using fallback')
  }

  // Use fallback rates
  return FALLBACK_RATES
}
