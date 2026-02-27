// server/services/briefingService.ts
// Briefing generation service using collected financial data + Gemini AI analysis
// Core logic: Collect → Analyze → Structure → Store

import { GoogleGenerativeAI } from '@google/generative-ai'
import { ensureConnection } from '../config/database'
import StockBriefing from '../models/StockBriefing'
import type {
  IStockBriefing,
  IEvent,
  IBriefingSection,
  IPriceData,
  IFinancialHighlight,
  IGuidance,
  IAnalystInfo
} from '../models/StockBriefing'
import {
  collectFinancialData,
  validateTicker,
  type CollectedFinancialData,
  type IRawNewsItem,
  type ISECFiling
} from './financialDataService'

// ─── Types ─────────────────────────────────────────────────────────

export interface GenerateBriefingOptions {
  ticker: string
  language?: 'ko' | 'ja' | 'en'
  userId?: string
  forceRefresh?: boolean  // Generate even if a recent briefing exists
}

export interface BriefingListFilters {
  ticker?: string
  userId?: string
  status?: string
  dateFrom?: string
  dateTo?: string
  language?: string
  isBookmarked?: boolean
  search?: string
  limit?: number
  offset?: number
}

interface GeminiAnalysisResult {
  executiveSummary: string
  primaryMovers: string[]
  events: IEvent[]
  sections: IBriefingSection[]
  overallSentiment: 'bullish' | 'bearish' | 'neutral' | 'mixed'
  confidenceScore: number
  tags: string[]
}

// ─── Gemini AI Configuration ───────────────────────────────────────

function getGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Set it in your .env file.')
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  return genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      temperature: 0.3,      // Low temperature for factual analysis
      topP: 0.8,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json'
    }
  })
}

// ─── Prompt Construction ───────────────────────────────────────────

function buildAnalysisPrompt(
  data: CollectedFinancialData,
  language: 'ko' | 'ja' | 'en'
): string {
  const langInstruction = {
    ko: '모든 응답을 한국어로 작성하세요. 투자 전문가가 읽기 쉬운 간결한 한국어를 사용하세요.',
    ja: 'すべての回答を日本語で記述してください。投資専門家が読みやすい簡潔な日本語を使用してください。',
    en: 'Write all responses in English. Use concise professional language suitable for investors.'
  }

  const priceStr = data.priceData.current > 0
    ? `현재가: $${data.priceData.current.toFixed(2)} | 변동: ${data.priceData.change >= 0 ? '+' : ''}${data.priceData.change.toFixed(2)} (${data.priceData.changePercent >= 0 ? '+' : ''}${data.priceData.changePercent.toFixed(2)}%) | 거래량: ${formatVolume(data.priceData.volume)} (평균: ${formatVolume(data.priceData.avgVolume)})`
    : '가격 데이터 없음'

  const financialsStr = data.financialHighlights.length > 0
    ? data.financialHighlights.map(h => {
        let line = `- ${h.metric}: `
        if (h.actual != null) line += `실적 ${formatLargeNumber(h.actual)}`
        if (h.expected != null) line += ` vs 예상 ${formatLargeNumber(h.expected)}`
        if (h.beat !== null) line += ` (${h.beat ? '상회 ✓' : '하회 ✗'})`
        if (h.changePercent != null) line += ` | 변동: ${(h.changePercent * 100).toFixed(1)}%`
        if (h.notes) line += ` | ${h.notes}`
        return line
      }).join('\n')
    : '재무 데이터 없음'

  const newsStr = data.rawNewsItems.length > 0
    ? data.rawNewsItems.slice(0, 10).map(n =>
        `- [${n.source}] ${n.title} (${n.publishedAt.toISOString().split('T')[0]})`
      ).join('\n')
    : '관련 뉴스 없음'

  const filingsStr = data.secFilings.length > 0
    ? data.secFilings.map(f =>
        `- ${f.formType}: ${f.description} (${f.filedAt.toISOString().split('T')[0]})`
      ).join('\n')
    : 'SEC 공시 없음'

  const analystStr = data.analystInfo.consensusRating
    ? `컨센서스: ${data.analystInfo.consensusRating} | 목표가 평균: $${data.analystInfo.targetPriceAvg?.toFixed(2) || 'N/A'} (범위: $${data.analystInfo.targetPriceLow?.toFixed(2) || 'N/A'} ~ $${data.analystInfo.targetPriceHigh?.toFixed(2) || 'N/A'}) | 애널리스트 수: ${data.analystInfo.numberOfAnalysts || 'N/A'}`
    : '애널리스트 데이터 없음'

  const guidanceStr = data.guidance.length > 0
    ? data.guidance.map(g =>
        `- ${g.metric}: ${g.direction} | 범위: ${g.rangeLow?.toFixed(2) || 'N/A'} ~ ${g.rangeHigh?.toFixed(2) || 'N/A'}${g.notes ? ` | ${g.notes}` : ''}`
      ).join('\n')
    : '가이던스 데이터 없음'

  return `${langInstruction[language]}

당신은 전문 주식 애널리스트입니다. 아래의 수집된 데이터를 분석하여 **"왜 이 종목이 움직였는가?"**에 초점을 맞춘 실전 투자 브리핑을 작성하세요.

## 분석 대상
- 종목: ${data.ticker} (${data.companyName})
- 섹터: ${data.sector || '불명'} | 산업: ${data.industry || '불명'}
- 거래소: ${data.exchange || '불명'}

## 시장 데이터
${priceStr}

## 재무 하이라이트
${financialsStr}

## 가이던스
${guidanceStr}

## 애널리스트 정보
${analystStr}

## 최근 뉴스
${newsStr}

## SEC 공시
${filingsStr}

## 분석 요구사항

다음 JSON 형식으로 정확하게 응답하세요:

{
  "executiveSummary": "2-3문장의 핵심 요약. '오늘 AAPL은 X% 상승했다. 주요 원인은 Y이며, Z가 우려사항이다.' 형식",
  "primaryMovers": ["가격 변동의 주요 원인 1", "주요 원인 2", "주요 원인 3"],
  "events": [
    {
      "type": "earnings|fda|merger|contract|guidance|regulatory|insider|analyst|dividend|sec_filing|other",
      "title": "이벤트 제목",
      "description": "이벤트 상세 설명 (2-3문장)",
      "impact": "positive|negative|neutral|mixed",
      "impactScore": -5에서 +5 사이의 정수,
      "source": "출처명",
      "date": "${new Date().toISOString().split('T')[0]}"
    }
  ],
  "sections": [
    {
      "title": "섹션 제목",
      "content": "섹션 내용 (마크다운 가능)",
      "importance": "critical|high|medium|low"
    }
  ],
  "overallSentiment": "bullish|bearish|neutral|mixed",
  "confidenceScore": 0에서 100 사이의 숫자,
  "tags": ["관련 태그들"]
}

## 섹션 가이드라인 (순서대로 포함):
1. **가격 변동 원인 분석** (critical/high) - 왜 움직였는지 구체적 이벤트 기반 분석
2. **재무제표 하이라이트** (high) - 최근 실적 beat/miss, 주요 지표 변화
3. **애널리스트 동향** (medium) - 목표가, 컨센서스, 최근 변경
4. **주요 리스크/기회** (medium) - 향후 주목할 포인트
5. **투자 판단 요약** (high) - 간결한 불/베어 케이스 요약

## 중요 규칙:
- 감성 분석(sentiment)보다 **사실 기반 이벤트 분석**에 집중
- 수치는 원본 데이터를 정확하게 인용
- 추측은 최소화하고, 확인된 사실 위주로 작성
- 데이터가 부족한 부분은 솔직하게 "데이터 부족"으로 표시
- 모든 이벤트에 출처(source) 명시
- executiveSummary는 반드시 주가 변동 방향과 %를 포함`
}

// ─── Gemini Analysis ───────────────────────────────────────────────

async function analyzeWithGemini(
  data: CollectedFinancialData,
  language: 'ko' | 'ja' | 'en'
): Promise<GeminiAnalysisResult> {
  const prompt = buildAnalysisPrompt(data, language)

  try {
    const model = getGeminiModel()
    const result = await model.generateContent(prompt)
    const responseText = result.response.text()

    // Parse JSON response
    const parsed = JSON.parse(responseText)

    // Validate and normalize the response
    return {
      executiveSummary: parsed.executiveSummary || `${data.ticker} 분석 데이터가 수집되었으나 AI 요약 생성에 실패했습니다.`,
      primaryMovers: Array.isArray(parsed.primaryMovers) ? parsed.primaryMovers.slice(0, 5) : [],
      events: normalizeEvents(parsed.events || []),
      sections: normalizeSections(parsed.sections || []),
      overallSentiment: validateSentiment(parsed.overallSentiment),
      confidenceScore: Math.max(0, Math.min(100, Number(parsed.confidenceScore) || 50)),
      tags: Array.isArray(parsed.tags) ? parsed.tags : []
    }
  } catch (error: any) {
    console.error(`[BriefingService] Gemini analysis failed:`, error.message)

    // Return a basic fallback analysis
    return buildFallbackAnalysis(data, language)
  }
}

/**
 * Build a basic analysis without AI when Gemini fails
 */
function buildFallbackAnalysis(
  data: CollectedFinancialData,
  language: 'ko' | 'ja' | 'en'
): GeminiAnalysisResult {
  const { priceData, ticker, companyName } = data
  const direction = priceData.changePercent >= 0 ? '상승' : '하락'
  const pct = Math.abs(priceData.changePercent).toFixed(2)

  const executiveSummary = language === 'ko'
    ? `${companyName} (${ticker})은(는) 전일 대비 ${pct}% ${direction}한 $${priceData.current.toFixed(2)}에 거래되고 있습니다. 상세 AI 분석은 일시적으로 이용 불가합니다.`
    : language === 'ja'
    ? `${companyName} (${ticker})は前日比${pct}%${direction === '상승' ? '上昇' : '下落'}し$${priceData.current.toFixed(2)}で取引されています。`
    : `${companyName} (${ticker}) is trading at $${priceData.current.toFixed(2)}, ${direction === '상승' ? 'up' : 'down'} ${pct}% from previous close.`

  const sections: IBriefingSection[] = []

  // Price section
  sections.push({
    title: '가격 현황',
    content: `현재가: $${priceData.current.toFixed(2)} | 변동: ${priceData.change >= 0 ? '+' : ''}${priceData.change.toFixed(2)} (${priceData.changePercent >= 0 ? '+' : ''}${priceData.changePercent.toFixed(2)}%)\n거래량: ${formatVolume(priceData.volume)} (평균: ${formatVolume(priceData.avgVolume)})`,
    importance: 'high'
  })

  // Financials section
  if (data.financialHighlights.length > 0) {
    const lines = data.financialHighlights.map(h => {
      let line = `**${h.metric}**: `
      if (h.actual != null) line += `${formatLargeNumber(h.actual)}`
      if (h.beat !== null) line += ` ${h.beat ? '(상회 ✓)' : '(하회 ✗)'}`
      if (h.notes) line += ` — ${h.notes}`
      return line
    })
    sections.push({
      title: '재무 지표',
      content: lines.join('\n'),
      importance: 'high'
    })
  }

  // Analyst section
  if (data.analystInfo.consensusRating) {
    sections.push({
      title: '애널리스트 동향',
      content: `컨센서스: **${data.analystInfo.consensusRating}** | 목표가: $${data.analystInfo.targetPriceLow?.toFixed(2) || '?'} ~ $${data.analystInfo.targetPriceHigh?.toFixed(2) || '?'} (평균: $${data.analystInfo.targetPriceAvg?.toFixed(2) || '?'})`,
      importance: 'medium'
    })
  }

  return {
    executiveSummary,
    primaryMovers: data.events.slice(0, 3).map(e => e.title),
    events: data.events,
    sections,
    overallSentiment: priceData.changePercent > 2 ? 'bullish'
      : priceData.changePercent < -2 ? 'bearish'
      : 'neutral',
    confidenceScore: 30, // Low confidence for fallback
    tags: [ticker, data.sector || '', data.industry || ''].filter(Boolean)
  }
}

// ─── Validation Helpers ────────────────────────────────────────────

function normalizeEvents(events: any[]): IEvent[] {
  const validTypes = ['earnings', 'fda', 'merger', 'contract', 'guidance', 'regulatory', 'insider', 'analyst', 'dividend', 'sec_filing', 'other']
  const validImpacts = ['positive', 'negative', 'neutral', 'mixed']

  return events.map(e => ({
    type: validTypes.includes(e.type) ? e.type : 'other',
    title: String(e.title || 'Unknown Event'),
    description: String(e.description || ''),
    impact: validImpacts.includes(e.impact) ? e.impact : 'neutral',
    impactScore: Math.max(-5, Math.min(5, Number(e.impactScore) || 0)),
    source: String(e.source || 'AI Analysis'),
    sourceUrl: e.sourceUrl || undefined,
    date: e.date ? new Date(e.date) : new Date()
  }))
}

function normalizeSections(sections: any[]): IBriefingSection[] {
  const validImportance = ['critical', 'high', 'medium', 'low']

  return sections.map(s => ({
    title: String(s.title || 'Section'),
    content: String(s.content || ''),
    importance: validImportance.includes(s.importance) ? s.importance : 'medium'
  }))
}

function validateSentiment(sentiment: any): 'bullish' | 'bearish' | 'neutral' | 'mixed' {
  const valid = ['bullish', 'bearish', 'neutral', 'mixed']
  return valid.includes(sentiment) ? sentiment : 'neutral'
}

// ─── Number Formatting ─────────────────────────────────────────────

function formatVolume(volume: number): string {
  if (volume >= 1_000_000_000) return `${(volume / 1_000_000_000).toFixed(1)}B`
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(1)}M`
  if (volume >= 1_000) return `${(volume / 1_000).toFixed(1)}K`
  return volume.toString()
}

function formatLargeNumber(num: number): string {
  const abs = Math.abs(num)
  const sign = num < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`
  return `${sign}${abs.toFixed(4)}`
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Generate a stock briefing for the given ticker.
 * Main entry point for the briefing generation pipeline.
 */
export async function generateBriefing(options: GenerateBriefingOptions): Promise<IStockBriefing> {
  await ensureConnection()

  const { ticker, language = 'ko', userId, forceRefresh = false } = options
  const normalizedTicker = ticker.toUpperCase().trim()

  // Check for existing recent briefing (within last 4 hours)
  if (!forceRefresh) {
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000)
    const existing = await StockBriefing.findOne({
      ticker: normalizedTicker,
      status: 'completed',
      generatedAt: { $gte: fourHoursAgo }
    }).lean()

    if (existing) {
      console.log(`[BriefingService] Using cached briefing for ${normalizedTicker} (${(existing as any)._id})`)
      return existing as unknown as IStockBriefing
    }
  }

  // Validate ticker
  const validation = await validateTicker(normalizedTicker)
  if (!validation.valid) {
    throw new Error(`Invalid ticker symbol: ${normalizedTicker}`)
  }

  // Create a placeholder briefing document
  const briefing = new StockBriefing({
    ticker: normalizedTicker,
    companyName: validation.companyName || normalizedTicker,
    briefingDate: new Date(),
    generatedAt: new Date(),
    status: 'generating',
    language,
    userId,
    priceData: {
      current: 0, previousClose: 0, change: 0, changePercent: 0,
      open: 0, dayHigh: 0, dayLow: 0, volume: 0, avgVolume: 0, currency: 'USD'
    },
    events: [],
    primaryMovers: [],
    financialHighlights: [],
    guidance: [],
    analystInfo: {},
    executiveSummary: '',
    sections: [],
    dataSources: [],
    overallSentiment: 'neutral',
    confidenceScore: 0,
    tags: []
  })
  await briefing.save()

  try {
    // Step 1: Collect financial data from all sources
    console.log(`[BriefingService] Step 1: Collecting data for ${normalizedTicker}`)
    const collectedData = await collectFinancialData(normalizedTicker)

    // Step 2: Analyze with Gemini AI
    console.log(`[BriefingService] Step 2: AI analysis for ${normalizedTicker}`)
    const analysis = await analyzeWithGemini(collectedData, language)

    // Step 3: Merge collected data events with AI-generated events
    const allEvents = mergeEvents(collectedData.events, analysis.events)

    // Step 4: Update the briefing document
    console.log(`[BriefingService] Step 3: Saving briefing for ${normalizedTicker}`)

    const updatedBriefing = await StockBriefing.findByIdAndUpdate(
      briefing._id,
      {
        companyName: collectedData.companyName,
        sector: collectedData.sector,
        industry: collectedData.industry,
        exchange: collectedData.exchange,
        status: 'completed',
        priceData: collectedData.priceData,
        events: allEvents,
        primaryMovers: analysis.primaryMovers,
        financialHighlights: collectedData.financialHighlights,
        guidance: collectedData.guidance,
        analystInfo: collectedData.analystInfo,
        executiveSummary: analysis.executiveSummary,
        sections: analysis.sections,
        dataSources: collectedData.dataSources,
        overallSentiment: analysis.overallSentiment,
        confidenceScore: analysis.confidenceScore,
        tags: analysis.tags
      },
      { new: true }
    ).lean() as unknown as IStockBriefing

    console.log(`[BriefingService] Briefing completed for ${normalizedTicker} (${briefing._id})`)
    return updatedBriefing
  } catch (error: any) {
    // Mark briefing as failed
    await StockBriefing.findByIdAndUpdate(briefing._id, {
      status: 'failed',
      executiveSummary: `브리핑 생성 실패: ${error.message}`
    })

    console.error(`[BriefingService] Failed to generate briefing for ${normalizedTicker}:`, error.message)
    throw error
  }
}

/**
 * Merge events from data collection and AI analysis, removing duplicates
 */
function mergeEvents(dataEvents: IEvent[], aiEvents: IEvent[]): IEvent[] {
  const merged = [...dataEvents]
  const existingTitles = new Set(dataEvents.map(e => e.title.toLowerCase()))

  for (const event of aiEvents) {
    if (!existingTitles.has(event.title.toLowerCase())) {
      merged.push(event)
      existingTitles.add(event.title.toLowerCase())
    }
  }

  // Sort by impact score (highest absolute value first)
  return merged.sort((a, b) => Math.abs(b.impactScore) - Math.abs(a.impactScore))
}

/**
 * Get a list of briefings with filtering and pagination
 */
export async function listBriefings(filters: BriefingListFilters = {}) {
  await ensureConnection()

  const query: any = {}

  if (filters.ticker) {
    query.ticker = filters.ticker.toUpperCase()
  }
  if (filters.userId) {
    query.userId = filters.userId
  }
  if (filters.status) {
    query.status = filters.status
  }
  if (filters.language) {
    query.language = filters.language
  }
  if (filters.isBookmarked !== undefined) {
    query.isBookmarked = filters.isBookmarked
  }
  if (filters.dateFrom || filters.dateTo) {
    query.briefingDate = {}
    if (filters.dateFrom) query.briefingDate.$gte = new Date(filters.dateFrom)
    if (filters.dateTo) query.briefingDate.$lte = new Date(filters.dateTo)
  }
  if (filters.search) {
    query.$or = [
      { ticker: { $regex: filters.search, $options: 'i' } },
      { companyName: { $regex: filters.search, $options: 'i' } },
      { executiveSummary: { $regex: filters.search, $options: 'i' } }
    ]
  }

  const limit = Math.min(filters.limit || 20, 100)
  const offset = filters.offset || 0

  const [briefings, total] = await Promise.all([
    StockBriefing.find(query)
      .sort({ generatedAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean(),
    StockBriefing.countDocuments(query)
  ])

  return {
    briefings,
    total,
    limit,
    offset,
    hasMore: offset + limit < total
  }
}

/**
 * Get a single briefing by ID
 */
export async function getBriefingById(id: string) {
  await ensureConnection()

  const briefing = await StockBriefing.findById(id).lean()
  if (!briefing) {
    throw new Error(`Briefing ${id} not found`)
  }

  return briefing
}

/**
 * Delete a briefing
 */
export async function deleteBriefing(id: string) {
  await ensureConnection()

  const result = await StockBriefing.findByIdAndDelete(id).lean()
  if (!result) {
    throw new Error(`Briefing ${id} not found`)
  }

  return result
}

/**
 * Update briefing user fields (bookmark, notes)
 */
export async function updateBriefingUserFields(id: string, updates: {
  isBookmarked?: boolean
  userNotes?: string
}) {
  await ensureConnection()

  const briefing = await StockBriefing.findByIdAndUpdate(
    id,
    { $set: updates },
    { new: true }
  ).lean()

  if (!briefing) {
    throw new Error(`Briefing ${id} not found`)
  }

  return briefing
}

/**
 * Get the latest briefing for a ticker
 */
export async function getLatestBriefing(ticker: string) {
  await ensureConnection()

  const briefing = await StockBriefing.findOne({
    ticker: ticker.toUpperCase(),
    status: 'completed'
  })
    .sort({ generatedAt: -1 })
    .lean()

  return briefing
}

/**
 * Mark stale briefings (older than 24 hours)
 */
export async function markStaleBriefings() {
  await ensureConnection()

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const result = await StockBriefing.updateMany(
    {
      status: 'completed',
      generatedAt: { $lt: cutoff }
    },
    { $set: { status: 'stale' } }
  )

  return { modifiedCount: result.modifiedCount }
}
