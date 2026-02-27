import mongoose, { Document, Schema } from 'mongoose'

// ─── Sub-document interfaces ───────────────────────────────────────

export interface IPriceData {
  current: number
  previousClose: number
  change: number
  changePercent: number
  open: number
  dayHigh: number
  dayLow: number
  volume: number
  avgVolume: number
  marketCap?: number
  fiftyTwoWeekHigh?: number
  fiftyTwoWeekLow?: number
  currency: string
}

export interface IEvent {
  type: 'earnings' | 'fda' | 'merger' | 'contract' | 'guidance' | 'regulatory' | 'insider' | 'analyst' | 'dividend' | 'sec_filing' | 'other'
  title: string
  description: string
  impact: 'positive' | 'negative' | 'neutral' | 'mixed'
  impactScore: number  // -5 to +5
  source: string
  sourceUrl?: string
  date: Date
}

export interface IFinancialHighlight {
  metric: string         // e.g., 'Revenue', 'EPS', 'Net Income'
  actual?: number
  expected?: number      // Consensus estimate
  previous?: number      // Previous period
  changePercent?: number
  beat: boolean | null   // true = beat, false = miss, null = N/A
  period?: string        // e.g., 'Q3 2025', 'FY2025'
  notes?: string
}

export interface IGuidance {
  metric: string
  rangeLow?: number
  rangeHigh?: number
  previous?: number
  direction: 'raised' | 'lowered' | 'maintained' | 'initiated' | 'withdrawn'
  notes?: string
}

export interface IAnalystInfo {
  consensusRating?: string   // 'Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell'
  targetPriceAvg?: number
  targetPriceHigh?: number
  targetPriceLow?: number
  numberOfAnalysts?: number
  recentUpgrades?: number
  recentDowngrades?: number
}

export interface IBriefingSection {
  title: string
  content: string
  importance: 'critical' | 'high' | 'medium' | 'low'
}

export interface IDataSourceMeta {
  name: string       // 'yahoo_finance', 'sec_edgar', 'fmp', 'finnhub'
  fetchedAt: Date
  success: boolean
  error?: string
  dataPoints: number // Number of data items fetched
}

// ─── Main document interface ───────────────────────────────────────

export interface IStockBriefing extends Document {
  ticker: string
  companyName: string
  sector?: string
  industry?: string
  exchange?: string
  briefingDate: Date        // The date this briefing covers
  generatedAt: Date         // When the briefing was generated
  status: 'generating' | 'completed' | 'failed' | 'stale'
  language: 'ko' | 'ja' | 'en'

  // Market data snapshot
  priceData: IPriceData

  // Event-driven analysis (WHY did it move?)
  events: IEvent[]
  primaryMovers: string[]   // Top 1-3 reasons for price movement

  // Fundamental data
  financialHighlights: IFinancialHighlight[]
  guidance: IGuidance[]
  analystInfo: IAnalystInfo

  // AI-generated briefing sections
  executiveSummary: string  // 2-3 sentence TL;DR
  sections: IBriefingSection[]

  // Metadata
  dataSources: IDataSourceMeta[]
  overallSentiment: 'bullish' | 'bearish' | 'neutral' | 'mixed'
  confidenceScore: number   // 0-100, how confident we are in the analysis
  tags: string[]

  // User interaction
  userId?: string
  isBookmarked: boolean
  userNotes?: string

  createdAt: Date
  updatedAt: Date
}

// ─── Sub-document schemas ──────────────────────────────────────────

const PriceDataSchema = new Schema<IPriceData>({
  current: { type: Number, required: true },
  previousClose: { type: Number, required: true },
  change: { type: Number, required: true },
  changePercent: { type: Number, required: true },
  open: { type: Number, required: true },
  dayHigh: { type: Number, required: true },
  dayLow: { type: Number, required: true },
  volume: { type: Number, required: true },
  avgVolume: { type: Number, default: 0 },
  marketCap: { type: Number },
  fiftyTwoWeekHigh: { type: Number },
  fiftyTwoWeekLow: { type: Number },
  currency: { type: String, default: 'USD' }
}, { _id: false })

const EventSchema = new Schema<IEvent>({
  type: {
    type: String,
    required: true,
    enum: ['earnings', 'fda', 'merger', 'contract', 'guidance', 'regulatory', 'insider', 'analyst', 'dividend', 'sec_filing', 'other']
  },
  title: { type: String, required: true },
  description: { type: String, required: true },
  impact: {
    type: String,
    required: true,
    enum: ['positive', 'negative', 'neutral', 'mixed']
  },
  impactScore: { type: Number, required: true, min: -5, max: 5 },
  source: { type: String, required: true },
  sourceUrl: { type: String },
  date: { type: Date, required: true }
}, { _id: false })

const FinancialHighlightSchema = new Schema<IFinancialHighlight>({
  metric: { type: String, required: true },
  actual: { type: Number },
  expected: { type: Number },
  previous: { type: Number },
  changePercent: { type: Number },
  beat: { type: Boolean, default: null },
  period: { type: String },
  notes: { type: String }
}, { _id: false })

const GuidanceSchema = new Schema<IGuidance>({
  metric: { type: String, required: true },
  rangeLow: { type: Number },
  rangeHigh: { type: Number },
  previous: { type: Number },
  direction: {
    type: String,
    required: true,
    enum: ['raised', 'lowered', 'maintained', 'initiated', 'withdrawn']
  },
  notes: { type: String }
}, { _id: false })

const AnalystInfoSchema = new Schema<IAnalystInfo>({
  consensusRating: { type: String },
  targetPriceAvg: { type: Number },
  targetPriceHigh: { type: Number },
  targetPriceLow: { type: Number },
  numberOfAnalysts: { type: Number },
  recentUpgrades: { type: Number },
  recentDowngrades: { type: Number }
}, { _id: false })

const BriefingSectionSchema = new Schema<IBriefingSection>({
  title: { type: String, required: true },
  content: { type: String, required: true },
  importance: {
    type: String,
    required: true,
    enum: ['critical', 'high', 'medium', 'low']
  }
}, { _id: false })

const DataSourceMetaSchema = new Schema<IDataSourceMeta>({
  name: { type: String, required: true },
  fetchedAt: { type: Date, required: true },
  success: { type: Boolean, required: true },
  error: { type: String },
  dataPoints: { type: Number, default: 0 }
}, { _id: false })

// ─── Main schema ───────────────────────────────────────────────────

const StockBriefingSchema = new Schema<IStockBriefing>({
  ticker: { type: String, required: true, uppercase: true, index: true },
  companyName: { type: String, required: true },
  sector: { type: String },
  industry: { type: String },
  exchange: { type: String },
  briefingDate: { type: Date, required: true, index: true },
  generatedAt: { type: Date, default: Date.now },
  status: {
    type: String,
    required: true,
    default: 'generating',
    enum: ['generating', 'completed', 'failed', 'stale']
  },
  language: {
    type: String,
    default: 'ko',
    enum: ['ko', 'ja', 'en']
  },

  // Market data
  priceData: { type: PriceDataSchema, required: true },

  // Events
  events: [EventSchema],
  primaryMovers: [{ type: String }],

  // Fundamentals
  financialHighlights: [FinancialHighlightSchema],
  guidance: [GuidanceSchema],
  analystInfo: { type: AnalystInfoSchema, default: {} },

  // AI briefing
  executiveSummary: { type: String, default: '' },
  sections: [BriefingSectionSchema],

  // Metadata
  dataSources: [DataSourceMetaSchema],
  overallSentiment: {
    type: String,
    enum: ['bullish', 'bearish', 'neutral', 'mixed'],
    default: 'neutral'
  },
  confidenceScore: { type: Number, default: 0, min: 0, max: 100 },
  tags: [{ type: String }],

  // User
  userId: { type: String, index: true },
  isBookmarked: { type: Boolean, default: false },
  userNotes: { type: String }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

// Virtual for id
StockBriefingSchema.virtual('id').get(function () {
  return this._id.toHexString()
})

// Compound indexes for common queries
StockBriefingSchema.index({ ticker: 1, briefingDate: -1 })
StockBriefingSchema.index({ userId: 1, briefingDate: -1 })
StockBriefingSchema.index({ status: 1, briefingDate: -1 })
StockBriefingSchema.index({ ticker: 1, status: 1 })

// Text search index
StockBriefingSchema.index({
  ticker: 'text',
  companyName: 'text',
  executiveSummary: 'text',
  'events.title': 'text'
})

export default mongoose.models.StockBriefing || mongoose.model<IStockBriefing>('StockBriefing', StockBriefingSchema)
