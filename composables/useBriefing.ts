import { ref, computed } from 'vue'
import { useUserStore } from '~/stores/user'

// ─── Types ──────────────────────────────────────────────────────────

export interface PriceData {
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

export interface BriefingEvent {
  type: 'earnings' | 'fda' | 'merger' | 'contract' | 'guidance' | 'regulatory' | 'insider' | 'analyst' | 'dividend' | 'sec_filing' | 'other'
  title: string
  description: string
  impact: 'positive' | 'negative' | 'neutral' | 'mixed'
  impactScore: number
  source: string
  sourceUrl?: string
  date: string
}

export interface FinancialHighlight {
  metric: string
  actual?: number
  expected?: number
  previous?: number
  changePercent?: number
  beat: boolean | null
  period?: string
  notes?: string
}

export interface Guidance {
  metric: string
  rangeLow?: number
  rangeHigh?: number
  previous?: number
  direction: 'raised' | 'lowered' | 'maintained' | 'initiated' | 'withdrawn'
  notes?: string
}

export interface AnalystInfo {
  consensusRating?: string
  targetPriceAvg?: number
  targetPriceHigh?: number
  targetPriceLow?: number
  numberOfAnalysts?: number
  recentUpgrades?: number
  recentDowngrades?: number
}

export interface BriefingSection {
  title: string
  content: string
  importance: 'critical' | 'high' | 'medium' | 'low'
}

export interface DataSourceMeta {
  name: string
  fetchedAt: string
  success: boolean
  error?: string
  dataPoints: number
}

export interface StockBriefing {
  id: string
  _id?: string
  ticker: string
  companyName: string
  sector?: string
  industry?: string
  exchange?: string
  briefingDate: string
  generatedAt: string
  status: 'generating' | 'completed' | 'failed' | 'stale'
  language: 'ko' | 'ja' | 'en'
  priceData: PriceData
  events: BriefingEvent[]
  primaryMovers: string[]
  financialHighlights: FinancialHighlight[]
  guidance: Guidance[]
  analystInfo: AnalystInfo
  executiveSummary: string
  sections: BriefingSection[]
  dataSources: DataSourceMeta[]
  overallSentiment: 'bullish' | 'bearish' | 'neutral' | 'mixed'
  confidenceScore: number
  tags: string[]
  userId?: string
  isBookmarked: boolean
  userNotes?: string
  createdAt: string
  updatedAt: string
}

export interface BriefingFilters {
  ticker?: string
  status?: string
  dateFrom?: string
  dateTo?: string
  language?: string
  isBookmarked?: boolean
  search?: string
}

// ─── Composable ─────────────────────────────────────────────────────

export function useBriefing() {
  const userStore = useUserStore()

  // State
  const briefings = ref<StockBriefing[]>([])
  const currentBriefing = ref<StockBriefing | null>(null)
  const isLoading = ref(false)
  const isGenerating = ref(false)
  const error = ref<string | null>(null)
  const totalCount = ref(0)
  const filters = ref<BriefingFilters>({})

  // ─── API Calls ──────────────────────────────────────────────────

  /**
   * Fetch briefing list with optional filters and pagination
   */
  const fetchBriefings = async (options?: {
    limit?: number
    offset?: number
    filters?: BriefingFilters
  }) => {
    isLoading.value = true
    error.value = null

    try {
      const query: Record<string, string> = {}

      const f = options?.filters || filters.value
      if (f.ticker) query.ticker = f.ticker
      if (f.status) query.status = f.status
      if (f.dateFrom) query.dateFrom = f.dateFrom
      if (f.dateTo) query.dateTo = f.dateTo
      if (f.language) query.language = f.language
      if (f.isBookmarked !== undefined) query.isBookmarked = String(f.isBookmarked)
      if (f.search) query.search = f.search
      if (options?.limit) query.limit = String(options.limit)
      if (options?.offset) query.offset = String(options.offset)

      const queryString = new URLSearchParams(query).toString()
      const url = `/api/briefing${queryString ? '?' + queryString : ''}`

      const response = await $fetch<any>(url, {
        headers: userStore.authHeader
      })

      briefings.value = (response.briefings || []).map(normalizeBriefing)
      totalCount.value = response.total || briefings.value.length

      return briefings.value
    } catch (err: any) {
      error.value = err.data?.message || err.message || 'Failed to fetch briefings'
      console.error('Error fetching briefings:', err)
      return []
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Fetch a single briefing by ID
   */
  const fetchBriefingById = async (id: string) => {
    isLoading.value = true
    error.value = null

    try {
      const response = await $fetch<any>(`/api/briefing/${id}`, {
        headers: userStore.authHeader
      })

      currentBriefing.value = normalizeBriefing(response.briefing)
      return currentBriefing.value
    } catch (err: any) {
      error.value = err.data?.message || err.message || `Failed to fetch briefing ${id}`
      console.error(`Error fetching briefing ${id}:`, err)
      return null
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Generate a new briefing for a ticker
   */
  const generateBriefing = async (ticker: string, options?: {
    language?: string
    forceRefresh?: boolean
  }) => {
    isGenerating.value = true
    error.value = null

    try {
      const response = await $fetch<any>('/api/briefing/generate', {
        method: 'POST',
        headers: userStore.authHeader,
        body: {
          ticker: ticker.toUpperCase().trim(),
          language: options?.language || 'ko',
          forceRefresh: options?.forceRefresh || false
        }
      })

      const newBriefing = normalizeBriefing(response.briefing)

      // Prepend to local list
      const existIdx = briefings.value.findIndex(b => b.id === newBriefing.id)
      if (existIdx >= 0) {
        briefings.value[existIdx] = newBriefing
      } else {
        briefings.value.unshift(newBriefing)
      }

      currentBriefing.value = newBriefing
      return newBriefing
    } catch (err: any) {
      error.value = err.data?.message || err.message || `Failed to generate briefing for ${ticker}`
      console.error(`Error generating briefing for ${ticker}:`, err)
      return null
    } finally {
      isGenerating.value = false
    }
  }

  /**
   * Toggle bookmark on a briefing
   */
  const toggleBookmark = async (id: string) => {
    const briefing = briefings.value.find(b => b.id === id)
    const newVal = briefing ? !briefing.isBookmarked : true

    try {
      const response = await $fetch<any>(`/api/briefing/${id}`, {
        method: 'PATCH',
        headers: userStore.authHeader,
        body: { isBookmarked: newVal }
      })

      const updated = normalizeBriefing(response.briefing)

      // Update local state
      const idx = briefings.value.findIndex(b => b.id === id)
      if (idx >= 0) briefings.value[idx] = updated
      if (currentBriefing.value?.id === id) currentBriefing.value = updated

      return updated
    } catch (err: any) {
      error.value = err.data?.message || err.message || 'Failed to toggle bookmark'
      console.error('Error toggling bookmark:', err)
      return null
    }
  }

  /**
   * Update user notes on a briefing
   */
  const updateNotes = async (id: string, notes: string) => {
    try {
      const response = await $fetch<any>(`/api/briefing/${id}`, {
        method: 'PATCH',
        headers: userStore.authHeader,
        body: { userNotes: notes }
      })

      const updated = normalizeBriefing(response.briefing)

      const idx = briefings.value.findIndex(b => b.id === id)
      if (idx >= 0) briefings.value[idx] = updated
      if (currentBriefing.value?.id === id) currentBriefing.value = updated

      return updated
    } catch (err: any) {
      error.value = err.data?.message || err.message || 'Failed to update notes'
      console.error('Error updating notes:', err)
      return null
    }
  }

  /**
   * Delete a briefing
   */
  const deleteBriefing = async (id: string) => {
    try {
      await $fetch(`/api/briefing/${id}`, {
        method: 'DELETE',
        headers: userStore.authHeader
      })

      briefings.value = briefings.value.filter(b => b.id !== id)
      if (currentBriefing.value?.id === id) currentBriefing.value = null

      return true
    } catch (err: any) {
      error.value = err.data?.message || err.message || 'Failed to delete briefing'
      console.error('Error deleting briefing:', err)
      return false
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────

  const normalizeBriefing = (raw: any): StockBriefing => ({
    ...raw,
    id: raw.id || raw._id?.toString() || '',
    events: raw.events || [],
    primaryMovers: raw.primaryMovers || [],
    financialHighlights: raw.financialHighlights || [],
    guidance: raw.guidance || [],
    analystInfo: raw.analystInfo || {},
    sections: raw.sections || [],
    dataSources: raw.dataSources || [],
    tags: raw.tags || [],
    isBookmarked: raw.isBookmarked || false
  })

  // Group briefings by date
  const briefingsByDate = computed(() => {
    const groups: Record<string, StockBriefing[]> = {}
    for (const b of briefings.value) {
      const dateKey = new Date(b.briefingDate).toISOString().split('T')[0]
      if (!groups[dateKey]) groups[dateKey] = []
      groups[dateKey].push(b)
    }
    // Sort dates descending
    return Object.entries(groups)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, items]) => ({ date, briefings: items }))
  })

  // Filter computed
  const filteredBriefings = computed(() => {
    let result = [...briefings.value]

    if (filters.value.ticker) {
      const q = filters.value.ticker.toUpperCase()
      result = result.filter(b => b.ticker.includes(q) || b.companyName.toLowerCase().includes(q.toLowerCase()))
    }

    if (filters.value.status) {
      result = result.filter(b => b.status === filters.value.status)
    }

    return result
  })

  // Format helpers
  const formatPrice = (value: number, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value)
  }

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? '+' : ''
    return `${sign}${value.toFixed(2)}%`
  }

  const formatVolume = (volume: number) => {
    if (volume >= 1_000_000_000) return (volume / 1_000_000_000).toFixed(1) + 'B'
    if (volume >= 1_000_000) return (volume / 1_000_000).toFixed(1) + 'M'
    if (volume >= 1_000) return (volume / 1_000).toFixed(1) + 'K'
    return volume.toString()
  }

  const formatMarketCap = (cap?: number) => {
    if (!cap) return 'N/A'
    if (cap >= 1_000_000_000_000) return '$' + (cap / 1_000_000_000_000).toFixed(2) + 'T'
    if (cap >= 1_000_000_000) return '$' + (cap / 1_000_000_000).toFixed(2) + 'B'
    if (cap >= 1_000_000) return '$' + (cap / 1_000_000).toFixed(2) + 'M'
    return '$' + cap.toLocaleString()
  }

  const formatDate = (isoDate: string) => {
    return new Date(isoDate).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const formatDateTime = (isoDate: string) => {
    return new Date(isoDate).toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'bullish': return 'text-green-600 dark:text-green-400'
      case 'bearish': return 'text-red-600 dark:text-red-400'
      case 'mixed': return 'text-yellow-600 dark:text-yellow-400'
      default: return 'text-gray-600 dark:text-gray-400'
    }
  }

  const getSentimentBg = (sentiment: string) => {
    switch (sentiment) {
      case 'bullish': return 'bg-green-100 dark:bg-green-900/30'
      case 'bearish': return 'bg-red-100 dark:bg-red-900/30'
      case 'mixed': return 'bg-yellow-100 dark:bg-yellow-900/30'
      default: return 'bg-gray-100 dark:bg-gray-700'
    }
  }

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'positive': return 'text-green-600 dark:text-green-400'
      case 'negative': return 'text-red-600 dark:text-red-400'
      case 'mixed': return 'text-yellow-600 dark:text-yellow-400'
      default: return 'text-gray-500 dark:text-gray-400'
    }
  }

  const getImpactBg = (impact: string) => {
    switch (impact) {
      case 'positive': return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
      case 'negative': return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
      case 'mixed': return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
      default: return 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
    }
  }

  const getEventTypeIcon = (type: string) => {
    const map: Record<string, string> = {
      earnings: 'BarChart3',
      fda: 'Shield',
      merger: 'GitMerge',
      contract: 'FileText',
      guidance: 'Target',
      regulatory: 'Scale',
      insider: 'UserCheck',
      analyst: 'TrendingUp',
      dividend: 'DollarSign',
      sec_filing: 'FileCheck',
      other: 'Info'
    }
    return map[type] || 'Info'
  }

  const getDirectionLabel = (direction: string) => {
    const map: Record<string, string> = {
      raised: 'Raised',
      lowered: 'Lowered',
      maintained: 'Maintained',
      initiated: 'Initiated',
      withdrawn: 'Withdrawn'
    }
    return map[direction] || direction
  }

  const getDirectionColor = (direction: string) => {
    switch (direction) {
      case 'raised': return 'text-green-600 dark:text-green-400'
      case 'lowered': return 'text-red-600 dark:text-red-400'
      case 'withdrawn': return 'text-red-600 dark:text-red-400'
      default: return 'text-gray-600 dark:text-gray-400'
    }
  }

  const resetFilters = () => {
    filters.value = {}
  }

  return {
    // State
    briefings,
    currentBriefing,
    isLoading,
    isGenerating,
    error,
    totalCount,
    filters,

    // Computed
    briefingsByDate,
    filteredBriefings,

    // API methods
    fetchBriefings,
    fetchBriefingById,
    generateBriefing,
    toggleBookmark,
    updateNotes,
    deleteBriefing,

    // Helpers
    formatPrice,
    formatPercent,
    formatVolume,
    formatMarketCap,
    formatDate,
    formatDateTime,
    getSentimentColor,
    getSentimentBg,
    getImpactColor,
    getImpactBg,
    getEventTypeIcon,
    getDirectionLabel,
    getDirectionColor,
    resetFilters
  }
}
