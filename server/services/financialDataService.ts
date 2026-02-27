// server/services/financialDataService.ts
// Unified financial data collection service
// Sources: Yahoo Finance (direct HTTP API), SEC EDGAR (free API), FMP (free tier)

import type {
  IPriceData,
  IEvent,
  IFinancialHighlight,
  IGuidance,
  IAnalystInfo,
  IDataSourceMeta
} from '../models/StockBriefing'

// ─── Types ─────────────────────────────────────────────────────────

export interface CollectedFinancialData {
  ticker: string
  companyName: string
  sector?: string
  industry?: string
  exchange?: string
  priceData: IPriceData
  events: IEvent[]
  financialHighlights: IFinancialHighlight[]
  guidance: IGuidance[]
  analystInfo: IAnalystInfo
  dataSources: IDataSourceMeta[]
  rawNewsItems: IRawNewsItem[]
  secFilings: ISECFiling[]
}

export interface IRawNewsItem {
  title: string
  summary?: string
  url?: string
  source: string
  publishedAt: Date
}

export interface ISECFiling {
  formType: string       // '8-K', '10-K', '10-Q', etc.
  filedAt: Date
  description: string
  url: string
  accessionNumber: string
}

// ─── Configuration ─────────────────────────────────────────────────

const FMP_BASE = 'https://financialmodelingprep.com/api/v3'
const FINNHUB_BASE = 'https://finnhub.io/api/v1'

// SEC EDGAR requires a User-Agent with contact info
const SEC_USER_AGENT = 'OhMyFinance/1.0 (contact@ohmyfinance.dev)'

// Request timeout
const FETCH_TIMEOUT = 15000

// Yahoo Finance query API base
const YAHOO_QUERY_BASE = 'https://query1.finance.yahoo.com/v10/finance'
const YAHOO_QUERY2_BASE = 'https://query2.finance.yahoo.com'

// ─── Helper: fetch with timeout ────────────────────────────────────

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

// ─── Yahoo Finance via yahoo-finance2 (v2 — quote only) ───────────

async function fetchYahooQuote(ticker: string): Promise<{
  priceData: IPriceData
  companyName: string
  sector?: string
  industry?: string
  exchange?: string
  meta: IDataSourceMeta
}> {
  try {
    const YahooFinance = (await import('yahoo-finance2')).default
    const yf = new (YahooFinance as any)()

    const quote = await yf.quote(ticker)

    if (!quote || !quote.regularMarketPrice) {
      throw new Error(`No quote data returned for ${ticker}`)
    }

    const priceData: IPriceData = {
      current: quote.regularMarketPrice || 0,
      previousClose: quote.regularMarketPreviousClose || 0,
      change: quote.regularMarketChange || 0,
      changePercent: quote.regularMarketChangePercent || 0,
      open: quote.regularMarketOpen || 0,
      dayHigh: quote.regularMarketDayHigh || 0,
      dayLow: quote.regularMarketDayLow || 0,
      volume: quote.regularMarketVolume || 0,
      avgVolume: quote.averageDailyVolume10Day || 0,
      marketCap: quote.marketCap,
      fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
      currency: quote.currency || 'USD'
    }

    return {
      priceData,
      companyName: quote.longName || quote.shortName || ticker,
      sector: quote.sector,
      industry: quote.industry,
      exchange: quote.fullExchangeName,
      meta: {
        name: 'yahoo_finance',
        fetchedAt: new Date(),
        success: true,
        dataPoints: 1
      }
    }
  } catch (error: any) {
    console.error(`[Yahoo Finance] Failed to fetch quote for ${ticker}:`, error.message)
    return {
      priceData: {
        current: 0, previousClose: 0, change: 0, changePercent: 0,
        open: 0, dayHigh: 0, dayLow: 0, volume: 0, avgVolume: 0, currency: 'USD'
      },
      companyName: ticker,
      meta: {
        name: 'yahoo_finance',
        fetchedAt: new Date(),
        success: false,
        error: error.message,
        dataPoints: 0
      }
    }
  }
}

// ─── Yahoo Finance via direct HTTP (quoteSummary) ──────────────────

async function fetchYahooQuoteSummary(ticker: string, modules: string[]): Promise<any> {
  const modulesStr = modules.join(',')
  // Try multiple Yahoo Finance query endpoints
  const urls = [
    `${YAHOO_QUERY2_BASE}/v10/finance/quoteSummary/${ticker}?modules=${modulesStr}`,
    `${YAHOO_QUERY_BASE}/quoteSummary/${ticker}?modules=${modulesStr}`
  ]

  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      })

      if (response.ok) {
        const data = await response.json()
        return data?.quoteSummary?.result?.[0] || null
      }
    } catch {
      continue
    }
  }
  return null
}

async function fetchYahooFinancials(ticker: string): Promise<{
  highlights: IFinancialHighlight[]
  meta: IDataSourceMeta
}> {
  try {
    const summary = await fetchYahooQuoteSummary(ticker, [
      'earnings', 'financialData', 'defaultKeyStatistics', 'earningsHistory'
    ])

    const highlights: IFinancialHighlight[] = []

    if (!summary) {
      throw new Error('No quoteSummary data returned')
    }

    // Extract earnings history (actual vs expected)
    const earningsHistory = summary?.earningsHistory?.history
    if (earningsHistory && Array.isArray(earningsHistory)) {
      for (const entry of earningsHistory.slice(0, 4)) {
        const epsActual = entry?.epsActual?.raw ?? entry?.epsActual
        const epsEstimate = entry?.epsEstimate?.raw ?? entry?.epsEstimate
        const surprise = entry?.surprisePercent?.raw ?? entry?.surprisePercent

        if (epsActual != null) {
          highlights.push({
            metric: 'EPS',
            actual: epsActual,
            expected: epsEstimate ?? undefined,
            changePercent: surprise ?? undefined,
            beat: epsEstimate != null ? epsActual > epsEstimate : null,
            period: entry.quarter?.fmt || entry.quarter || undefined,
            notes: surprise != null
              ? `서프라이즈: ${surprise > 0 ? '+' : ''}${(surprise * 100).toFixed(1)}%`
              : undefined
          })
        }
      }
    }

    // Extract financial data highlights
    const financialData = summary?.financialData
    if (financialData) {
      const totalRevenue = financialData.totalRevenue?.raw ?? financialData.totalRevenue
      const revenueGrowth = financialData.revenueGrowth?.raw ?? financialData.revenueGrowth
      const operatingMargins = financialData.operatingMargins?.raw ?? financialData.operatingMargins
      const roe = financialData.returnOnEquity?.raw ?? financialData.returnOnEquity
      const fcf = financialData.freeCashflow?.raw ?? financialData.freeCashflow

      if (totalRevenue) {
        highlights.push({
          metric: 'Revenue',
          actual: totalRevenue,
          changePercent: revenueGrowth ?? undefined,
          beat: null,
          notes: revenueGrowth
            ? `YoY 성장률: ${(revenueGrowth * 100).toFixed(1)}%`
            : undefined
        })
      }
      if (operatingMargins) {
        highlights.push({
          metric: 'Operating Margin',
          actual: operatingMargins,
          beat: null,
          notes: `영업이익률: ${(operatingMargins * 100).toFixed(1)}%`
        })
      }
      if (roe) {
        highlights.push({
          metric: 'ROE',
          actual: roe,
          beat: null,
          notes: `자기자본이익률: ${(roe * 100).toFixed(1)}%`
        })
      }
      if (fcf) {
        highlights.push({
          metric: 'Free Cash Flow',
          actual: fcf,
          beat: null
        })
      }
    }

    // Key statistics
    const keyStats = summary?.defaultKeyStatistics
    if (keyStats) {
      const trailingEps = keyStats.trailingEps?.raw ?? keyStats.trailingEps
      const forwardEps = keyStats.forwardEps?.raw ?? keyStats.forwardEps
      const pegRatio = keyStats.pegRatio?.raw ?? keyStats.pegRatio

      if (trailingEps) {
        highlights.push({
          metric: 'EPS (TTM)',
          actual: trailingEps,
          previous: forwardEps || undefined,
          beat: null,
          notes: forwardEps
            ? `Forward EPS: $${forwardEps.toFixed(2)}`
            : undefined
        })
      }
      if (pegRatio && pegRatio > 0) {
        highlights.push({
          metric: 'PEG Ratio',
          actual: pegRatio,
          beat: null,
          notes: pegRatio < 1 ? '저평가 구간' : pegRatio > 2 ? '고평가 구간' : '적정 구간'
        })
      }
    }

    return {
      highlights,
      meta: {
        name: 'yahoo_finance_financials',
        fetchedAt: new Date(),
        success: true,
        dataPoints: highlights.length
      }
    }
  } catch (error: any) {
    console.error(`[Yahoo Finance] Failed to fetch financials for ${ticker}:`, error.message)
    return {
      highlights: [],
      meta: {
        name: 'yahoo_finance_financials',
        fetchedAt: new Date(),
        success: false,
        error: error.message,
        dataPoints: 0
      }
    }
  }
}

async function fetchYahooAnalystInfo(ticker: string): Promise<{
  analystInfo: IAnalystInfo
  meta: IDataSourceMeta
}> {
  try {
    const summary = await fetchYahooQuoteSummary(ticker, [
      'recommendationTrend', 'financialData'
    ])

    const analystInfo: IAnalystInfo = {}

    if (!summary) {
      throw new Error('No quoteSummary data returned')
    }

    // Recommendation trend
    const recTrend = summary?.recommendationTrend?.trend
    if (recTrend && Array.isArray(recTrend) && recTrend.length > 0) {
      const latest = recTrend[0]
      const total = (latest.strongBuy || 0) + (latest.buy || 0) + (latest.hold || 0) +
                    (latest.sell || 0) + (latest.strongSell || 0)

      analystInfo.numberOfAnalysts = total

      if (total > 0) {
        const score = (
          (latest.strongBuy || 0) * 5 +
          (latest.buy || 0) * 4 +
          (latest.hold || 0) * 3 +
          (latest.sell || 0) * 2 +
          (latest.strongSell || 0) * 1
        ) / total

        if (score >= 4.5) analystInfo.consensusRating = 'Strong Buy'
        else if (score >= 3.5) analystInfo.consensusRating = 'Buy'
        else if (score >= 2.5) analystInfo.consensusRating = 'Hold'
        else if (score >= 1.5) analystInfo.consensusRating = 'Sell'
        else analystInfo.consensusRating = 'Strong Sell'
      }

      if (recTrend.length > 1) {
        const prev = recTrend[1]
        analystInfo.recentUpgrades = Math.max(0,
          ((latest.strongBuy || 0) - (prev.strongBuy || 0)) +
          ((latest.buy || 0) - (prev.buy || 0))
        )
        analystInfo.recentDowngrades = Math.max(0,
          ((latest.sell || 0) - (prev.sell || 0)) +
          ((latest.strongSell || 0) - (prev.strongSell || 0))
        )
      }
    }

    // Target price from financialData
    const finData = summary?.financialData
    if (finData) {
      analystInfo.targetPriceAvg = finData.targetMeanPrice?.raw ?? finData.targetMeanPrice
      analystInfo.targetPriceHigh = finData.targetHighPrice?.raw ?? finData.targetHighPrice
      analystInfo.targetPriceLow = finData.targetLowPrice?.raw ?? finData.targetLowPrice
    }

    return {
      analystInfo,
      meta: {
        name: 'yahoo_finance_analyst',
        fetchedAt: new Date(),
        success: true,
        dataPoints: Object.keys(analystInfo).filter(k => (analystInfo as any)[k] != null).length
      }
    }
  } catch (error: any) {
    console.error(`[Yahoo Finance] Failed to fetch analyst info for ${ticker}:`, error.message)
    return {
      analystInfo: {},
      meta: {
        name: 'yahoo_finance_analyst',
        fetchedAt: new Date(),
        success: false,
        error: error.message,
        dataPoints: 0
      }
    }
  }
}

// ─── Yahoo Finance News via RSS/search ─────────────────────────────

async function fetchYahooNews(ticker: string): Promise<{
  news: IRawNewsItem[]
  meta: IDataSourceMeta
}> {
  try {
    // Use Yahoo Finance RSS feed or search endpoint
    const url = `${YAHOO_QUERY2_BASE}/v1/finance/search?q=${ticker}&newsCount=10&quotesCount=0`
    const response = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    })

    const newsItems: IRawNewsItem[] = []

    if (response.ok) {
      const data = await response.json()

      if (data?.news && Array.isArray(data.news)) {
        for (const item of data.news) {
          newsItems.push({
            title: item.title || '',
            summary: item.summary || undefined,
            url: item.link || item.url || undefined,
            source: item.publisher || 'Yahoo Finance',
            publishedAt: item.providerPublishTime
              ? new Date(item.providerPublishTime * 1000)
              : new Date()
          })
        }
      }
    }

    return {
      news: newsItems,
      meta: {
        name: 'yahoo_finance_news',
        fetchedAt: new Date(),
        success: true,
        dataPoints: newsItems.length
      }
    }
  } catch (error: any) {
    console.error(`[Yahoo Finance] Failed to fetch news for ${ticker}:`, error.message)
    return {
      news: [],
      meta: {
        name: 'yahoo_finance_news',
        fetchedAt: new Date(),
        success: false,
        error: error.message,
        dataPoints: 0
      }
    }
  }
}

// ─── SEC EDGAR Data ────────────────────────────────────────────────

/**
 * Fetch recent SEC filings via company_tickers.json → submissions endpoint
 */
async function fetchSECFilings(ticker: string): Promise<{
  filings: ISECFiling[]
  meta: IDataSourceMeta
}> {
  try {
    // Step 1: Resolve ticker to CIK using company_tickers.json
    const tickersResponse = await fetchWithTimeout(
      'https://www.sec.gov/files/company_tickers.json',
      { headers: { 'User-Agent': SEC_USER_AGENT } }
    )

    if (!tickersResponse.ok) {
      throw new Error(`SEC company_tickers.json returned ${tickersResponse.status}`)
    }

    const tickersData = await tickersResponse.json()
    let cik: string | null = null
    let companyTitle = ''

    for (const key of Object.keys(tickersData)) {
      if (tickersData[key].ticker?.toUpperCase() === ticker.toUpperCase()) {
        cik = String(tickersData[key].cik_str).padStart(10, '0')
        companyTitle = tickersData[key].title || ''
        break
      }
    }

    if (!cik) {
      return {
        filings: [],
        meta: {
          name: 'sec_edgar',
          fetchedAt: new Date(),
          success: false,
          error: `CIK not found for ticker ${ticker}`,
          dataPoints: 0
        }
      }
    }

    // Step 2: Fetch recent submissions
    const submissionsResponse = await fetchWithTimeout(
      `https://data.sec.gov/submissions/CIK${cik}.json`,
      {
        headers: {
          'User-Agent': SEC_USER_AGENT,
          'Accept': 'application/json'
        }
      }
    )

    if (!submissionsResponse.ok) {
      throw new Error(`SEC submissions returned ${submissionsResponse.status}`)
    }

    const submissions = await submissionsResponse.json()
    const recent = submissions?.filings?.recent
    const filings: ISECFiling[] = []

    if (recent && recent.form) {
      const importantForms = ['8-K', '10-K', '10-Q', '6-K', 'SC 13D', 'SC 13G', '4', 'DEF 14A']
      const maxItems = Math.min(recent.form.length, 30)

      for (let i = 0; i < maxItems; i++) {
        if (importantForms.includes(recent.form[i])) {
          const rawCik = cik.replace(/^0+/, '')
          const accession = recent.accessionNumber?.[i] || ''
          const accessionPath = accession.replace(/-/g, '')
          const primaryDoc = recent.primaryDocument?.[i] || ''

          filings.push({
            formType: recent.form[i],
            filedAt: new Date(recent.filingDate?.[i] || Date.now()),
            description: recent.primaryDocDescription?.[i] || `${recent.form[i]} Filing`,
            url: primaryDoc
              ? `https://www.sec.gov/Archives/edgar/data/${rawCik}/${accessionPath}/${primaryDoc}`
              : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${rawCik}&type=${recent.form[i]}&dateb=&owner=include&count=10`,
            accessionNumber: accession
          })

          // Limit to 10 important filings
          if (filings.length >= 10) break
        }
      }
    }

    return {
      filings,
      meta: {
        name: 'sec_edgar',
        fetchedAt: new Date(),
        success: true,
        dataPoints: filings.length
      }
    }
  } catch (error: any) {
    console.error(`[SEC EDGAR] Failed to fetch filings for ${ticker}:`, error.message)
    return {
      filings: [],
      meta: {
        name: 'sec_edgar',
        fetchedAt: new Date(),
        success: false,
        error: error.message,
        dataPoints: 0
      }
    }
  }
}

// ─── FMP (Financial Modeling Prep) ─────────────────────────────────

async function fetchFMPEarnings(ticker: string): Promise<{
  highlights: IFinancialHighlight[]
  guidance: IGuidance[]
  meta: IDataSourceMeta
}> {
  const apiKey = process.env.FMP_API_KEY
  if (!apiKey) {
    return {
      highlights: [],
      guidance: [],
      meta: {
        name: 'fmp',
        fetchedAt: new Date(),
        success: false,
        error: 'FMP_API_KEY not configured',
        dataPoints: 0
      }
    }
  }

  try {
    const highlights: IFinancialHighlight[] = []
    const guidance: IGuidance[] = []

    // Fetch earnings surprises
    const earningsUrl = `${FMP_BASE}/earnings-surprises/${ticker}?apikey=${apiKey}`
    const response = await fetchWithTimeout(earningsUrl)

    if (response.ok) {
      const earningsData = await response.json()

      if (Array.isArray(earningsData)) {
        for (const earning of earningsData.slice(0, 4)) {
          highlights.push({
            metric: 'EPS (FMP)',
            actual: earning.actualEarningResult,
            expected: earning.estimatedEarning,
            beat: earning.actualEarningResult > earning.estimatedEarning,
            period: earning.date,
            notes: `서프라이즈: ${earning.actualEarningResult > earning.estimatedEarning ? '상회' : '하회'}`
          })
        }
      }
    }

    // Fetch earnings calendar for upcoming guidance
    const calendarUrl = `${FMP_BASE}/earning_calendar?symbol=${ticker}&apikey=${apiKey}`
    const calResponse = await fetchWithTimeout(calendarUrl)

    if (calResponse.ok) {
      const calData = await calResponse.json()

      if (Array.isArray(calData)) {
        for (const cal of calData.slice(0, 2)) {
          if (cal.revenueEstimated) {
            guidance.push({
              metric: 'Revenue Estimate',
              rangeLow: cal.revenueEstimated * 0.97,
              rangeHigh: cal.revenueEstimated * 1.03,
              direction: 'maintained',
              notes: `컨센서스 매출 추정: $${formatNumber(cal.revenueEstimated)}`
            })
          }
          if (cal.epsEstimated) {
            guidance.push({
              metric: 'EPS Estimate',
              rangeLow: cal.epsEstimated * 0.95,
              rangeHigh: cal.epsEstimated * 1.05,
              direction: 'maintained',
              notes: `컨센서스 EPS 추정: $${cal.epsEstimated?.toFixed(2)}`
            })
          }
        }
      }
    }

    return {
      highlights,
      guidance,
      meta: {
        name: 'fmp',
        fetchedAt: new Date(),
        success: true,
        dataPoints: highlights.length + guidance.length
      }
    }
  } catch (error: any) {
    console.error(`[FMP] Failed to fetch data for ${ticker}:`, error.message)
    return {
      highlights: [],
      guidance: [],
      meta: {
        name: 'fmp',
        fetchedAt: new Date(),
        success: false,
        error: error.message,
        dataPoints: 0
      }
    }
  }
}

// ─── Finnhub (Free tier) ──────────────────────────────────────────

async function fetchFinnhubNews(ticker: string): Promise<{
  news: IRawNewsItem[]
  meta: IDataSourceMeta
}> {
  const apiKey = process.env.FINNHUB_API_KEY
  if (!apiKey) {
    return {
      news: [],
      meta: {
        name: 'finnhub',
        fetchedAt: new Date(),
        success: false,
        error: 'FINNHUB_API_KEY not configured',
        dataPoints: 0
      }
    }
  }

  try {
    const from = getDateDaysAgo(7)
    const to = getTodayDate()
    const url = `${FINNHUB_BASE}/company-news?symbol=${ticker}&from=${from}&to=${to}&token=${apiKey}`
    const response = await fetchWithTimeout(url)

    const newsItems: IRawNewsItem[] = []

    if (response.ok) {
      const data = await response.json()

      if (Array.isArray(data)) {
        for (const item of data.slice(0, 15)) {
          newsItems.push({
            title: item.headline || '',
            summary: item.summary || undefined,
            url: item.url || undefined,
            source: item.source || 'Finnhub',
            publishedAt: new Date((item.datetime || 0) * 1000)
          })
        }
      }
    }

    return {
      news: newsItems,
      meta: {
        name: 'finnhub',
        fetchedAt: new Date(),
        success: true,
        dataPoints: newsItems.length
      }
    }
  } catch (error: any) {
    console.error(`[Finnhub] Failed to fetch news for ${ticker}:`, error.message)
    return {
      news: [],
      meta: {
        name: 'finnhub',
        fetchedAt: new Date(),
        success: false,
        error: error.message,
        dataPoints: 0
      }
    }
  }
}

// ─── Utility Functions ─────────────────────────────────────────────

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0]
}

function getDateDaysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().split('T')[0]
}

function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`
  return num.toFixed(2)
}

/**
 * Convert SEC filings to events
 */
function filingsToEvents(filings: ISECFiling[]): IEvent[] {
  return filings.map(filing => {
    let type: IEvent['type'] = 'sec_filing'
    let impact: IEvent['impact'] = 'neutral'
    let impactScore = 0

    switch (filing.formType) {
      case '8-K':
        type = 'other'
        impact = 'neutral'
        impactScore = 1
        break
      case '10-K':
      case '10-Q':
        type = 'earnings'
        impact = 'neutral'
        impactScore = 2
        break
      case 'SC 13D':
      case 'SC 13G':
        type = 'insider'
        impact = 'neutral'
        impactScore = 2
        break
      case '4':
        type = 'insider'
        impact = 'neutral'
        impactScore = 1
        break
      default:
        type = 'sec_filing'
        impactScore = 0
    }

    return {
      type,
      title: `SEC ${filing.formType} Filing`,
      description: filing.description,
      impact,
      impactScore,
      source: 'SEC EDGAR',
      sourceUrl: filing.url,
      date: filing.filedAt
    }
  })
}

// ─── Main Collection Function ──────────────────────────────────────

/**
 * Collect all financial data for a given ticker.
 * Fetches from multiple sources in parallel for speed.
 */
export async function collectFinancialData(ticker: string): Promise<CollectedFinancialData> {
  const normalizedTicker = ticker.toUpperCase().trim()

  console.log(`[FinancialDataService] Collecting data for ${normalizedTicker}...`)

  // Fetch all data sources in parallel
  const [
    yahooQuote,
    yahooFinancials,
    yahooAnalyst,
    yahooNews,
    secFilings,
    fmpData,
    finnhubNews
  ] = await Promise.all([
    fetchYahooQuote(normalizedTicker),
    fetchYahooFinancials(normalizedTicker),
    fetchYahooAnalystInfo(normalizedTicker),
    fetchYahooNews(normalizedTicker),
    fetchSECFilings(normalizedTicker),
    fetchFMPEarnings(normalizedTicker),
    fetchFinnhubNews(normalizedTicker)
  ])

  // Merge financial highlights (deduplicate by metric)
  const allHighlights = [...yahooFinancials.highlights, ...fmpData.highlights]
  const seenMetrics = new Set<string>()
  const dedupedHighlights = allHighlights.filter(h => {
    if (seenMetrics.has(h.metric)) return false
    seenMetrics.add(h.metric)
    return true
  })

  // Convert SEC filings to events
  const secEvents = filingsToEvents(secFilings.filings)

  // Merge news from all sources
  const allNews = [...yahooNews.news, ...finnhubNews.news]

  // Collect all data source metadata
  const dataSources: IDataSourceMeta[] = [
    yahooQuote.meta,
    yahooFinancials.meta,
    yahooAnalyst.meta,
    yahooNews.meta,
    secFilings.meta,
    fmpData.meta,
    finnhubNews.meta
  ]

  const successCount = dataSources.filter(ds => ds.success).length
  console.log(`[FinancialDataService] Completed for ${normalizedTicker}: ${successCount}/${dataSources.length} sources successful`)

  return {
    ticker: normalizedTicker,
    companyName: yahooQuote.companyName,
    sector: yahooQuote.sector,
    industry: yahooQuote.industry,
    exchange: yahooQuote.exchange,
    priceData: yahooQuote.priceData,
    events: secEvents,
    financialHighlights: dedupedHighlights,
    guidance: fmpData.guidance,
    analystInfo: yahooAnalyst.analystInfo,
    dataSources,
    rawNewsItems: allNews,
    secFilings: secFilings.filings
  }
}

/**
 * Validate that a ticker symbol is valid by checking Yahoo Finance
 */
export async function validateTicker(ticker: string): Promise<{
  valid: boolean
  companyName?: string
  exchange?: string
}> {
  try {
    // Try quote first — if it returns data, ticker is valid
    const YahooFinance = (await import('yahoo-finance2')).default
    const yf = new (YahooFinance as any)()
    const quote = await yf.quote(ticker)

    if (quote && quote.regularMarketPrice) {
      return {
        valid: true,
        companyName: quote.longName || quote.shortName || ticker,
        exchange: quote.fullExchangeName || quote.exchange
      }
    }

    return { valid: false }
  } catch {
    // Fallback: try Yahoo search API
    try {
      const url = `${YAHOO_QUERY2_BASE}/v1/finance/search?q=${ticker}&quotesCount=1&newsCount=0`
      const response = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      })

      if (response.ok) {
        const data = await response.json()
        if (data?.quotes?.length > 0) {
          const match = data.quotes[0]
          return {
            valid: true,
            companyName: match.longname || match.shortname || ticker,
            exchange: match.exchange || match.exchDisp
          }
        }
      }
    } catch { /* ignore */ }

    return { valid: false }
  }
}
