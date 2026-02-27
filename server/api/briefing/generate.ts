// server/api/briefing/generate.ts
// POST /api/briefing/generate
// Generate a new stock briefing for a given ticker

import { defineEventHandler, readBody, createError, getMethod } from 'h3'
import { generateBriefing } from '../../services/briefingService'
import { validateTicker } from '../../services/financialDataService'

export default defineEventHandler(async (event) => {
  const method = getMethod(event)

  if (method !== 'POST') {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method Not Allowed',
      message: 'Only POST is allowed'
    })
  }

  const body = await readBody(event)

  // Validate required fields
  if (!body?.ticker || typeof body.ticker !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'ticker is required and must be a string (e.g., "AAPL", "TSLA")'
    })
  }

  const ticker = body.ticker.toUpperCase().trim()

  // Basic ticker format validation
  if (!/^[A-Z]{1,5}$/.test(ticker) && !/^[A-Z]{1,5}\.[A-Z]{1,2}$/.test(ticker)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `Invalid ticker format: "${ticker}". Expected 1-5 uppercase letters (e.g., AAPL, MSFT, BRK.B)`
    })
  }

  // Validate language
  const language = body.language || 'ko'
  if (!['ko', 'ja', 'en'].includes(language)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'language must be one of: ko, ja, en'
    })
  }

  try {
    // Validate that the ticker exists
    const tickerCheck = await validateTicker(ticker)
    if (!tickerCheck.valid) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: `Ticker "${ticker}" not found. Please check the symbol and try again.`
      })
    }

    // Generate briefing
    const briefing = await generateBriefing({
      ticker,
      language,
      userId: event.context.auth?.userId || undefined,
      forceRefresh: body.forceRefresh === true
    })

    return {
      success: true,
      briefing
    }
  } catch (error: any) {
    // If it's already an H3 error, re-throw
    if (error.statusCode) throw error

    console.error(`[API] Briefing generation failed for ${ticker}:`, error.message)

    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: `Failed to generate briefing for ${ticker}: ${error.message}`
    })
  }
})
