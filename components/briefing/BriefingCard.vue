<template>
  <div
    class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-md transition-shadow"
  >
    <!-- Header: Ticker + Price -->
    <div class="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
      <div class="flex items-start justify-between">
        <div class="flex items-center gap-3">
          <!-- Ticker badge -->
          <div class="flex items-center gap-2">
            <span class="text-lg font-bold text-gray-900 dark:text-gray-100">{{ briefing.ticker }}</span>
            <span
              class="px-2 py-0.5 rounded text-xs font-medium"
              :class="sentimentBadgeClass"
            >
              {{ t(`briefing.sentiment.${briefing.overallSentiment}`) }}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <!-- Bookmark -->
          <button
            @click.stop="$emit('bookmark', briefing.id)"
            class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            :class="briefing.isBookmarked ? 'text-yellow-500' : 'text-gray-400 dark:text-gray-500'"
          >
            <Bookmark class="h-4 w-4" :fill="briefing.isBookmarked ? 'currentColor' : 'none'" />
          </button>
          <!-- Confidence score -->
          <div
            class="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
            :class="confidenceClass"
          >
            <Shield class="h-3 w-3" />
            {{ briefing.confidenceScore }}%
          </div>
        </div>
      </div>

      <!-- Company name + sector -->
      <div class="mt-1 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <span>{{ briefing.companyName }}</span>
        <span v-if="briefing.sector" class="text-gray-300 dark:text-gray-600">|</span>
        <span v-if="briefing.sector">{{ briefing.sector }}</span>
      </div>

      <!-- Price bar -->
      <div class="mt-3 flex items-end justify-between">
        <div class="flex items-baseline gap-2">
          <span class="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {{ formatPrice(briefing.priceData.current, briefing.priceData.currency) }}
          </span>
          <span
            class="text-sm font-semibold"
            :class="briefing.priceData.change >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
          >
            {{ briefing.priceData.change >= 0 ? '+' : '' }}{{ briefing.priceData.change.toFixed(2) }}
            ({{ formatPercent(briefing.priceData.changePercent) }})
          </span>
        </div>
        <div class="text-xs text-gray-400 dark:text-gray-500">
          Vol: {{ formatVolume(briefing.priceData.volume) }}
        </div>
      </div>

      <!-- Price range bar -->
      <div class="mt-2">
        <div class="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500 mb-1">
          <span>L: {{ briefing.priceData.dayLow.toFixed(2) }}</span>
          <span>{{ t('briefing.dayRange') }}</span>
          <span>H: {{ briefing.priceData.dayHigh.toFixed(2) }}</span>
        </div>
        <div class="relative h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            class="absolute h-full rounded-full"
            :class="briefing.priceData.change >= 0 ? 'bg-green-500' : 'bg-red-500'"
            :style="{ width: priceRangePercent + '%', left: '0' }"
          ></div>
          <div
            class="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-gray-800 dark:bg-gray-200 border border-white dark:border-gray-600"
            :style="{ left: currentPricePosition + '%' }"
          ></div>
        </div>
      </div>
    </div>

    <!-- Executive Summary -->
    <div v-if="briefing.executiveSummary" class="px-5 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
      <p class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
        {{ briefing.executiveSummary }}
      </p>
    </div>

    <!-- Primary Movers -->
    <div v-if="briefing.primaryMovers && briefing.primaryMovers.length > 0" class="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
      <h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
        {{ t('briefing.whyItMoved') }}
      </h4>
      <div class="space-y-1">
        <div
          v-for="(mover, index) in briefing.primaryMovers"
          :key="index"
          class="flex items-start gap-2"
        >
          <span class="flex-shrink-0 w-5 h-5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 text-xs font-bold flex items-center justify-center mt-0.5">
            {{ index + 1 }}
          </span>
          <p class="text-sm text-gray-700 dark:text-gray-300">{{ mover }}</p>
        </div>
      </div>
    </div>

    <!-- Events preview (top 3) -->
    <div v-if="briefing.events && briefing.events.length > 0" class="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
      <div class="flex items-center justify-between mb-2">
        <h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
          {{ t('briefing.keyEvents') }}
        </h4>
        <span class="text-xs text-gray-400">{{ briefing.events.length }} {{ t('briefing.eventsCount') }}</span>
      </div>
      <div class="space-y-2">
        <div
          v-for="(event, index) in briefing.events.slice(0, 3)"
          :key="index"
          class="flex items-center gap-2 text-sm"
        >
          <span
            class="w-2 h-2 rounded-full flex-shrink-0"
            :class="{
              'bg-green-500': event.impact === 'positive',
              'bg-red-500': event.impact === 'negative',
              'bg-yellow-500': event.impact === 'mixed',
              'bg-gray-400': event.impact === 'neutral'
            }"
          ></span>
          <span class="text-gray-700 dark:text-gray-300 truncate">{{ event.title }}</span>
          <span
            class="ml-auto flex-shrink-0 text-xs font-medium"
            :class="event.impactScore >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
          >
            {{ event.impactScore > 0 ? '+' : '' }}{{ event.impactScore }}
          </span>
        </div>
      </div>
    </div>

    <!-- Financial Highlights preview (top 3) -->
    <div v-if="briefing.financialHighlights && briefing.financialHighlights.length > 0" class="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
      <h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
        {{ t('briefing.financials') }}
      </h4>
      <div class="grid grid-cols-3 gap-2">
        <div
          v-for="(fh, index) in briefing.financialHighlights.slice(0, 3)"
          :key="index"
          class="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50"
        >
          <div class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ fh.metric }}</div>
          <div v-if="fh.actual != null" class="text-sm font-bold text-gray-900 dark:text-gray-100 mt-0.5">
            {{ formatCompactValue(fh.actual, fh.metric) }}
          </div>
          <div
            v-if="fh.beat !== null"
            class="text-xs font-medium mt-0.5"
            :class="fh.beat ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
          >
            {{ fh.beat ? 'Beat' : 'Miss' }}
          </div>
        </div>
      </div>
    </div>

    <!-- Footer: date + action -->
    <div class="px-5 py-3 flex items-center justify-between">
      <div class="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
        <Clock class="h-3.5 w-3.5" />
        {{ formatDateTime(briefing.generatedAt) }}
      </div>
      <NuxtLink
        :to="`/briefing/${briefing.id}`"
        class="inline-flex items-center gap-1 text-sm font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300"
        @click.stop
      >
        {{ t('briefing.viewDetail') }}
        <ArrowRight class="h-4 w-4" />
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Bookmark, Shield, Clock, ArrowRight } from 'lucide-vue-next'
import type { StockBriefing } from '~/composables/useBriefing'

const props = defineProps<{
  briefing: StockBriefing
}>()

defineEmits<{
  bookmark: [id: string]
}>()

const { t } = useI18n()
const {
  formatPrice,
  formatPercent,
  formatVolume,
  formatDateTime,
  getSentimentColor,
  getSentimentBg
} = useBriefing()

const sentimentBadgeClass = computed(() => {
  const s = props.briefing.overallSentiment
  return `${getSentimentBg(s)} ${getSentimentColor(s)}`
})

const confidenceClass = computed(() => {
  const c = props.briefing.confidenceScore
  if (c >= 70) return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
  if (c >= 40) return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
  return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
})

// Price range visualization
const priceRangePercent = computed(() => {
  const { dayLow, dayHigh, current } = props.briefing.priceData
  if (dayHigh === dayLow) return 50
  return Math.min(100, Math.max(0, ((current - dayLow) / (dayHigh - dayLow)) * 100))
})

const currentPricePosition = computed(() => {
  return Math.min(98, Math.max(2, priceRangePercent.value))
})

const formatCompactValue = (value: number, metric: string) => {
  const m = metric.toLowerCase()
  if (m.includes('eps') || m.includes('per share')) return '$' + value.toFixed(2)
  if (Math.abs(value) >= 1_000_000_000) return '$' + (value / 1_000_000_000).toFixed(1) + 'B'
  if (Math.abs(value) >= 1_000_000) return '$' + (value / 1_000_000).toFixed(1) + 'M'
  if (m.includes('margin') || m.includes('rate')) return value.toFixed(1) + '%'
  return '$' + value.toLocaleString()
}
</script>
