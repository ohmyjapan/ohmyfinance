// server/api/briefing/index.ts
// GET /api/briefing - List briefings with filtering and pagination

import { defineEventHandler, getQuery, getMethod, createError } from 'h3'
import { listBriefings, markStaleBriefings } from '../../services/briefingService'

export default defineEventHandler(async (event) => {
  const method = getMethod(event)

  if (method !== 'GET') {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method Not Allowed',
      message: 'Only GET is allowed on this endpoint. Use POST /api/briefing/generate to create a briefing.'
    })
  }

  const query = getQuery(event)

  try {
    // Optional: Mark stale briefings if requested
    if (query.markStale === 'true') {
      const staleResult = await markStaleBriefings()
      // Continue to list after marking stale
    }

    const filters = {
      ticker: query.ticker as string | undefined,
      userId: query.userId as string | undefined,
      status: query.status as string | undefined,
      dateFrom: query.dateFrom as string | undefined,
      dateTo: query.dateTo as string | undefined,
      language: query.language as string | undefined,
      isBookmarked: query.isBookmarked === 'true' ? true : query.isBookmarked === 'false' ? false : undefined,
      search: query.search as string | undefined,
      limit: query.limit ? Number(query.limit) : 20,
      offset: query.offset ? Number(query.offset) : 0
    }

    // Remove undefined values
    Object.keys(filters).forEach(key => {
      if ((filters as any)[key] === undefined) {
        delete (filters as any)[key]
      }
    })

    const result = await listBriefings(filters)

    return {
      success: true,
      ...result
    }
  } catch (error: any) {
    console.error('[API] Failed to list briefings:', error.message)

    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: `Failed to list briefings: ${error.message}`
    })
  }
})
