<template>
  <div class="space-y-4">
    <!-- Financial Highlights Table -->
    <div v-if="highlights && highlights.length > 0" class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead class="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              {{ t('briefing.metric') }}
            </th>
            <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              {{ t('briefing.actual') }}
            </th>
            <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              {{ t('briefing.expected') }}
            </th>
            <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              {{ t('briefing.previous') }}
            </th>
            <th class="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              {{ t('briefing.result') }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
          <tr
            v-for="(h, index) in highlights"
            :key="index"
            class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
          >
            <td class="px-4 py-3">
              <div class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ h.metric }}</div>
              <div v-if="h.period" class="text-xs text-gray-500 dark:text-gray-400">{{ h.period }}</div>
            </td>
            <td class="px-4 py-3 text-right">
              <span v-if="h.actual != null" class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {{ formatMetricValue(h.actual, h.metric) }}
              </span>
              <span v-else class="text-sm text-gray-400">-</span>
            </td>
            <td class="px-4 py-3 text-right">
              <span v-if="h.expected != null" class="text-sm text-gray-600 dark:text-gray-300">
                {{ formatMetricValue(h.expected, h.metric) }}
              </span>
              <span v-else class="text-sm text-gray-400">-</span>
            </td>
            <td class="px-4 py-3 text-right">
              <div v-if="h.previous != null" class="text-sm text-gray-600 dark:text-gray-300">
                {{ formatMetricValue(h.previous, h.metric) }}
              </div>
              <div v-if="h.changePercent != null" class="text-xs" :class="h.changePercent >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
                {{ h.changePercent >= 0 ? '+' : '' }}{{ h.changePercent.toFixed(1) }}%
              </div>
              <span v-if="h.previous == null && h.changePercent == null" class="text-sm text-gray-400">-</span>
            </td>
            <td class="px-4 py-3 text-center">
              <span
                v-if="h.beat === true"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
              >
                <TrendingUp class="h-3 w-3" />
                Beat
              </span>
              <span
                v-else-if="h.beat === false"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
              >
                <TrendingDown class="h-3 w-3" />
                Miss
              </span>
              <span v-else class="text-xs text-gray-400">-</span>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Notes -->
      <div v-for="(h, index) in highlights.filter(h => h.notes)" :key="'note-' + index" class="mt-2 px-4">
        <p class="text-xs text-gray-500 dark:text-gray-400 italic">
          <span class="font-medium">{{ h.metric }}:</span> {{ h.notes }}
        </p>
      </div>
    </div>

    <!-- Guidance Section -->
    <div v-if="guidance && guidance.length > 0" class="mt-4">
      <h4 class="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
        <Target class="h-4 w-4 text-orange-500" />
        {{ t('briefing.guidanceTitle') }}
      </h4>
      <div class="space-y-2">
        <div
          v-for="(g, index) in guidance"
          :key="index"
          class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700"
        >
          <div class="flex-1">
            <div class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ g.metric }}</div>
            <div v-if="g.notes" class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ g.notes }}</div>
          </div>
          <div class="flex items-center gap-3">
            <!-- Range -->
            <div v-if="g.rangeLow != null || g.rangeHigh != null" class="text-right">
              <div class="text-sm text-gray-700 dark:text-gray-300">
                {{ g.rangeLow != null ? formatCompactNumber(g.rangeLow) : '?' }}
                -
                {{ g.rangeHigh != null ? formatCompactNumber(g.rangeHigh) : '?' }}
              </div>
              <div v-if="g.previous != null" class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('briefing.previous') }}: {{ formatCompactNumber(g.previous) }}
              </div>
            </div>
            <!-- Direction badge -->
            <span
              class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold"
              :class="directionBadgeClass(g.direction)"
            >
              <component :is="directionIcon(g.direction)" class="h-3 w-3 mr-0.5" />
              {{ t(`briefing.direction.${g.direction}`) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Analyst Info -->
    <div v-if="analystInfo && (analystInfo.consensusRating || analystInfo.targetPriceAvg)" class="mt-4">
      <h4 class="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
        <Users class="h-4 w-4 text-blue-500" />
        {{ t('briefing.analystConsensus') }}
      </h4>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <!-- Consensus Rating -->
        <div v-if="analystInfo.consensusRating" class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
          <div class="text-xs text-gray-500 dark:text-gray-400 mb-1">{{ t('briefing.rating') }}</div>
          <div class="text-sm font-bold" :class="ratingColor(analystInfo.consensusRating)">
            {{ analystInfo.consensusRating }}
          </div>
        </div>
        <!-- Target Price -->
        <div v-if="analystInfo.targetPriceAvg" class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
          <div class="text-xs text-gray-500 dark:text-gray-400 mb-1">{{ t('briefing.targetPrice') }}</div>
          <div class="text-sm font-bold text-gray-900 dark:text-gray-100">
            ${{ analystInfo.targetPriceAvg.toFixed(2) }}
          </div>
          <div v-if="analystInfo.targetPriceLow && analystInfo.targetPriceHigh" class="text-xs text-gray-400 mt-0.5">
            ${{ analystInfo.targetPriceLow.toFixed(0) }} - ${{ analystInfo.targetPriceHigh.toFixed(0) }}
          </div>
        </div>
        <!-- Analysts Count -->
        <div v-if="analystInfo.numberOfAnalysts" class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
          <div class="text-xs text-gray-500 dark:text-gray-400 mb-1">{{ t('briefing.analysts') }}</div>
          <div class="text-sm font-bold text-gray-900 dark:text-gray-100">{{ analystInfo.numberOfAnalysts }}</div>
        </div>
        <!-- Up/Downgrade -->
        <div v-if="analystInfo.recentUpgrades || analystInfo.recentDowngrades" class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
          <div class="text-xs text-gray-500 dark:text-gray-400 mb-1">{{ t('briefing.recentChanges') }}</div>
          <div class="flex justify-center gap-2">
            <span v-if="analystInfo.recentUpgrades" class="text-xs font-bold text-green-600 dark:text-green-400">
              +{{ analystInfo.recentUpgrades }}
            </span>
            <span v-if="analystInfo.recentDowngrades" class="text-xs font-bold text-red-600 dark:text-red-400">
              -{{ analystInfo.recentDowngrades }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="(!highlights || highlights.length === 0) && (!guidance || guidance.length === 0)" class="text-center py-6">
      <BarChart3 class="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
      <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">{{ t('briefing.noFinancials') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  TrendingUp,
  TrendingDown,
  ArrowUp,
  ArrowDown,
  Minus,
  Target,
  Users,
  BarChart3,
  ChevronUp,
  ChevronDown
} from 'lucide-vue-next'
import type { FinancialHighlight, Guidance, AnalystInfo } from '~/composables/useBriefing'

defineProps<{
  highlights: FinancialHighlight[]
  guidance?: Guidance[]
  analystInfo?: AnalystInfo
}>()

const { t } = useI18n()

const formatMetricValue = (value: number, metric: string) => {
  const metricLower = metric.toLowerCase()
  // EPS-like metrics: show decimals
  if (metricLower.includes('eps') || metricLower.includes('per share')) {
    return '$' + value.toFixed(2)
  }
  // Large numbers: compact format
  if (Math.abs(value) >= 1_000_000_000) {
    return '$' + (value / 1_000_000_000).toFixed(2) + 'B'
  }
  if (Math.abs(value) >= 1_000_000) {
    return '$' + (value / 1_000_000).toFixed(2) + 'M'
  }
  // Percentage metrics
  if (metricLower.includes('margin') || metricLower.includes('rate') || metricLower.includes('ratio')) {
    return value.toFixed(1) + '%'
  }
  return '$' + value.toLocaleString()
}

const formatCompactNumber = (value: number) => {
  if (Math.abs(value) >= 1_000_000_000) return (value / 1_000_000_000).toFixed(1) + 'B'
  if (Math.abs(value) >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M'
  if (Math.abs(value) >= 1_000) return (value / 1_000).toFixed(1) + 'K'
  return value.toFixed(2)
}

const directionBadgeClass = (direction: string) => {
  switch (direction) {
    case 'raised': return 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
    case 'lowered': return 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
    case 'withdrawn': return 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
    case 'initiated': return 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
    default: return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  }
}

const directionIcon = (direction: string) => {
  switch (direction) {
    case 'raised': return ChevronUp
    case 'lowered': return ChevronDown
    case 'withdrawn': return Minus
    default: return Minus
  }
}

const ratingColor = (rating?: string) => {
  if (!rating) return 'text-gray-700 dark:text-gray-300'
  const r = rating.toLowerCase()
  if (r.includes('strong buy') || r.includes('buy')) return 'text-green-600 dark:text-green-400'
  if (r.includes('sell')) return 'text-red-600 dark:text-red-400'
  return 'text-yellow-600 dark:text-yellow-400'
}
</script>
