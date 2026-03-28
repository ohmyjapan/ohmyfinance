<template>
  <div>
    <!-- Header -->
    <header class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-800 dark:text-gray-100">{{ t('briefing.title') }}</h1>
        <p class="text-gray-600 dark:text-gray-400">{{ t('briefing.subtitle') }}</p>
      </div>

      <div class="mt-4 md:mt-0 flex flex-wrap gap-3">
        <!-- Generate new briefing -->
        <div class="flex">
          <input
            v-model="tickerInput"
            type="text"
            :placeholder="t('briefing.tickerPlaceholder')"
            class="block w-32 pl-3 pr-2 py-2 border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-l-md focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm uppercase"
            @keyup.enter="handleGenerate"
            :disabled="isGenerating"
          />
          <button
            @click="handleGenerate"
            :disabled="!tickerInput.trim() || isGenerating"
            class="inline-flex items-center px-4 py-2 border border-transparent rounded-r-md shadow-sm text-sm font-medium text-white bg-primary-main hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Loader v-if="isGenerating" class="h-4 w-4 mr-2 animate-spin" />
            <Zap v-else class="h-4 w-4 mr-2" />
            {{ isGenerating ? t('briefing.generating') : t('briefing.generate') }}
          </button>
        </div>

        <!-- Filter controls -->
        <div class="relative">
          <select
            v-model="statusFilter"
            class="block w-full pl-3 pr-10 py-2 border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm"
          >
            <option value="">{{ t('briefing.allStatuses') }}</option>
            <option value="completed">{{ t('briefing.statusCompleted') }}</option>
            <option value="generating">{{ t('briefing.statusGenerating') }}</option>
            <option value="failed">{{ t('briefing.statusFailed') }}</option>
          </select>
        </div>

        <button
          @click="handleRefresh"
          :disabled="isLoading"
          class="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-white/10 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.07] disabled:opacity-50"
        >
          <RefreshCw class="h-4 w-4" :class="isLoading ? 'animate-spin' : ''" />
        </button>
      </div>
    </header>

    <!-- Error alert -->
    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <div class="flex items-center gap-2">
        <AlertCircle class="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0" />
        <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
        <button @click="error = null" class="ml-auto text-red-500 hover:text-red-700">
          <X class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading && briefings.length === 0" class="flex justify-center items-center py-20">
      <Loader class="h-8 w-8 text-primary-main animate-spin" />
      <span class="ml-3 text-gray-600 dark:text-gray-400">{{ t('common.loading') }}</span>
    </div>

    <!-- Empty state -->
    <div v-else-if="!isLoading && displayBriefings.length === 0" class="text-center py-20">
      <Newspaper class="mx-auto h-16 w-16 text-gray-300 dark:text-gray-600" />
      <h3 class="mt-4 text-lg font-medium text-gray-900 dark:text-gray-100">{{ t('briefing.noBriefings') }}</h3>
      <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">{{ t('briefing.noBriefingsDesc') }}</p>
      <div class="mt-6">
        <div class="flex items-center justify-center gap-2">
          <input
            v-model="tickerInput"
            type="text"
            :placeholder="t('briefing.tickerPlaceholder')"
            class="block w-36 pl-3 pr-2 py-2 border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm uppercase"
            @keyup.enter="handleGenerate"
          />
          <button
            @click="handleGenerate"
            :disabled="!tickerInput.trim() || isGenerating"
            class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-main hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Zap class="h-4 w-4 mr-2" />
            {{ t('briefing.generateFirst') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Briefing list grouped by date -->
    <div v-else class="space-y-8">
      <div v-for="group in groupedBriefings" :key="group.date">
        <!-- Date header -->
        <div class="flex items-center gap-3 mb-4">
          <Calendar class="h-5 w-5 text-primary-main dark:text-primary-light" />
          <h2 class="text-lg font-semibold text-gray-800 dark:text-gray-100">
            {{ formatGroupDate(group.date) }}
          </h2>
          <span class="text-sm text-gray-400 dark:text-gray-500">
            ({{ group.briefings.length }} {{ t('briefing.stocksCount') }})
          </span>
          <NuxtLink
            :to="`/briefing/${group.date}`"
            class="ml-auto text-sm text-primary-main dark:text-primary-light hover:text-primary-dark dark:hover:text-primary-light flex items-center gap-1"
          >
            {{ t('briefing.viewAll') }}
            <ArrowRight class="h-4 w-4" />
          </NuxtLink>
        </div>

        <!-- Cards grid -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <BriefingCard
            v-for="briefing in group.briefings"
            :key="briefing.id"
            :briefing="briefing"
            @bookmark="handleBookmark"
          />
        </div>
      </div>
    </div>

    <!-- Load more -->
    <div v-if="briefings.length < totalCount" class="mt-8 text-center">
      <button
        @click="loadMore"
        :disabled="isLoading"
        class="inline-flex items-center px-6 py-2 border border-gray-300 dark:border-white/10 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.07] disabled:opacity-50"
      >
        <Loader v-if="isLoading" class="h-4 w-4 mr-2 animate-spin" />
        {{ t('briefing.loadMore') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  Zap,
  RefreshCw,
  Loader,
  Newspaper,
  Calendar,
  ArrowRight,
  AlertCircle,
  X
} from 'lucide-vue-next'

const { t } = useI18n()
const {
  briefings,
  isLoading,
  isGenerating,
  error,
  totalCount,
  fetchBriefings,
  generateBriefing,
  toggleBookmark,
  formatDate,
  briefingsByDate
} = useBriefing()

const tickerInput = ref('')
const statusFilter = ref('')

// Display briefings (filtered)
const displayBriefings = computed(() => {
  if (!statusFilter.value) return briefings.value
  return briefings.value.filter(b => b.status === statusFilter.value)
})

// Group by date
const groupedBriefings = computed(() => {
  const groups: Record<string, any[]> = {}
  for (const b of displayBriefings.value) {
    const dateKey = new Date(b.briefingDate).toISOString().split('T')[0]
    if (!groups[dateKey]) groups[dateKey] = []
    groups[dateKey].push(b)
  }
  return Object.entries(groups)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, briefings]) => ({ date, briefings }))
})

const formatGroupDate = (dateStr: string) => {
  const date = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return t('briefing.today')
  if (date.toDateString() === yesterday.toDateString()) return t('briefing.yesterday')

  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  })
}

// Actions
const handleGenerate = async () => {
  const ticker = tickerInput.value.trim().toUpperCase()
  if (!ticker) return

  await generateBriefing(ticker)
  if (!error.value) {
    tickerInput.value = ''
  }
}

const handleBookmark = async (id: string) => {
  await toggleBookmark(id)
}

const handleRefresh = async () => {
  await fetchBriefings({ limit: 20, offset: 0 })
}

const loadMore = async () => {
  await fetchBriefings({
    limit: 20,
    offset: briefings.value.length,
    filters: statusFilter.value ? { status: statusFilter.value } : undefined
  })
}

// Watch status filter
watch(statusFilter, () => {
  fetchBriefings({
    limit: 20,
    offset: 0,
    filters: statusFilter.value ? { status: statusFilter.value } : undefined
  })
})

// Load on mount
onMounted(() => {
  fetchBriefings({ limit: 20, offset: 0 })
})
</script>
