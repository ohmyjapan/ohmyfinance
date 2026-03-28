<template>
  <div class="relative" ref="searchContainer">
    <div class="relative">
      <Search class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
      <input
        v-model="searchQuery"
        @focus="showResults = true"
        @keydown.escape="closeSearch"
        @keydown.enter="goToFirstResult"
        type="text"
        :placeholder="t('search.placeholder')"
        class="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-white/10 rounded-xl text-sm bg-white dark:bg-white/5 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-main focus:border-transparent"
      />
      <div v-if="isLoading" class="absolute right-3 top-1/2 transform -translate-y-1/2">
        <Loader2 class="h-4 w-4 text-gray-400 animate-spin" />
      </div>
    </div>

    <!-- Results Dropdown -->
    <div
      v-if="showResults && (results.length > 0 || searchQuery.length >= 2)"
      class="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-white/5 rounded-xl shadow-lg border border-gray-200 dark:border-white/10 max-h-96 overflow-y-auto z-50"
    >
      <div v-if="results.length === 0 && searchQuery.length >= 2 && !isLoading" class="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
        {{ t('search.noResults', { query: searchQuery }) }}
      </div>

      <div v-else class="divide-y divide-gray-100 dark:divide-white/10">
        <NuxtLink
          v-for="result in results"
          :key="`${result.type}-${result.id}`"
          :to="result.url"
          @click="closeSearch"
          class="flex items-center px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/[0.07] cursor-pointer"
        >
          <div class="flex-shrink-0 mr-3">
            <component :is="getIcon(result.type)" class="h-5 w-5 text-gray-400 dark:text-gray-500" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{{ result.title }}</span>
              <span v-if="result.amount" class="text-sm font-medium font-mono text-gray-700 dark:text-gray-300 ml-2">
                {{ formatCurrency(result.amount) }}
              </span>
            </div>
            <div class="flex items-center justify-between mt-0.5">
              <span class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ result.subtitle }}</span>
              <span :class="getStatusClass(result.status)" class="text-xs px-1.5 py-0.5 rounded">
                {{ t(`status.${result.status}`) }}
              </span>
            </div>
          </div>
        </NuxtLink>
      </div>

      <div v-if="hasMore" class="px-4 py-2 text-center border-t border-gray-100 dark:border-white/10">
        <span class="text-xs text-gray-500 dark:text-gray-400">{{ t('search.showingResults', { shown: results.length, total }) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { Search, Loader2, CreditCard, FileText, RefreshCw } from 'lucide-vue-next'

const { t, locale } = useI18n()

const searchContainer = ref<HTMLElement | null>(null)
const searchQuery = ref('')
const results = ref<any[]>([])
const isLoading = ref(false)
const showResults = ref(false)
const total = ref(0)
const hasMore = ref(false)

let searchTimeout: ReturnType<typeof setTimeout> | null = null

const search = async () => {
  if (searchQuery.value.length < 2) {
    results.value = []
    return
  }

  isLoading.value = true
  try {
    const data = await $fetch(`/api/search?q=${encodeURIComponent(searchQuery.value)}&limit=10`)
    results.value = data.results
    total.value = data.total
    hasMore.value = data.hasMore
  } catch (error) {
    console.error('Search failed:', error)
    results.value = []
  } finally {
    isLoading.value = false
  }
}

watch(searchQuery, () => {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(search, 300)
})

const closeSearch = () => {
  showResults.value = false
  searchQuery.value = ''
  results.value = []
}

const goToFirstResult = () => {
  if (results.value.length > 0) {
    navigateTo(results.value[0].url)
    closeSearch()
  }
}

const getIcon = (type: string) => {
  switch (type) {
    case 'transaction': return CreditCard
    case 'receipt': return FileText
    case 'recurring': return RefreshCw
    default: return CreditCard
  }
}

const formatCurrency = (amount: number) => {
  const currencyLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  const currency = locale.value === 'ko' ? 'KRW' : 'JPY'
  return new Intl.NumberFormat(currencyLocale, { style: 'currency', currency, minimumFractionDigits: 0 }).format(amount)
}

const getStatusClass = (status: string) => {
  const classes: Record<string, string> = {
    completed: 'bg-green-500/20 text-green-700 dark:text-green-400',
    pending: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400',
    processing: 'bg-blue-500/20 text-blue-700 dark:text-blue-400',
    failed: 'bg-red-500/20 text-red-700 dark:text-red-400',
    active: 'bg-green-500/20 text-green-700 dark:text-green-400',
    matched: 'bg-green-500/20 text-green-700 dark:text-green-400',
    unmatched: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400'
  }
  return classes[status] || 'bg-gray-500/20 text-gray-700 dark:text-gray-400'
}

const handleClickOutside = (event: MouseEvent) => {
  if (searchContainer.value && !searchContainer.value.contains(event.target as Node)) {
    showResults.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>
