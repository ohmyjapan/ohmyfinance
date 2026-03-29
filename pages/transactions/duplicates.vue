<template>
  <div>
    <!-- Header -->
    <header class="mb-8">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('duplicates.title') }}</h1>
          <p class="mt-1 text-gray-500 dark:text-gray-400">{{ t('duplicates.description') }}</p>
        </div>
        <div class="flex items-center gap-3">
          <select
            v-model="threshold"
            @change="loadDuplicates"
            class="border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 dark:text-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary-main/30 focus:border-primary-main outline-none transition-all touch-manipulation"
          >
            <option value="90">{{ t('duplicates.highConfidence') }}</option>
            <option value="80">{{ t('duplicates.mediumConfidence') }}</option>
            <option value="70">{{ t('duplicates.lowConfidence') }}</option>
          </select>
          <button
            @click="loadDuplicates"
            class="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 transition-all duration-300 touch-manipulation"
          >
            <RefreshCw class="h-4 w-4" :class="isLoading ? 'animate-spin' : ''" />
            {{ t('duplicates.rescan') }}
          </button>
        </div>
      </div>
    </header>

    <!-- Stats Cards -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      <!-- Total Groups -->
      <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 flex items-center justify-center">
            <Copy class="w-6 h-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('duplicates.totalGroups') }}</p>
            <p class="text-2xl font-bold font-mono text-gray-900 dark:text-white">{{ groups.length }}</p>
          </div>
        </div>
      </div>

      <!-- Total Pairs -->
      <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl bg-red-500/10 dark:bg-red-500/20 flex items-center justify-center">
            <AlertTriangle class="w-6 h-6 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('duplicates.totalPairs') }}</p>
            <p class="text-2xl font-bold font-mono text-gray-900 dark:text-white">{{ totalDuplicates }}</p>
          </div>
        </div>
      </div>

      <!-- Threshold -->
      <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center">
            <SlidersHorizontal class="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('duplicates.threshold') }}</p>
            <p class="text-2xl font-bold font-mono text-gray-900 dark:text-white">{{ threshold }}%</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm p-12 text-center">
      <div class="flex flex-col items-center gap-3">
        <Loader2 class="w-8 h-8 text-primary-main animate-spin" />
        <p class="text-gray-500 dark:text-gray-400">{{ t('duplicates.scanning') }}</p>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else-if="groups.length === 0" class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm p-12 text-center">
      <div class="w-16 h-16 rounded-2xl bg-green-500/10 dark:bg-green-500/20 flex items-center justify-center mx-auto mb-4">
        <CheckCircle class="h-8 w-8 text-green-500" />
      </div>
      <p class="text-lg font-medium text-gray-900 dark:text-white mb-1">{{ t('duplicates.noDuplicates') }}</p>
    </div>

    <!-- Duplicate Groups -->
    <div v-else class="space-y-5">
      <div
        v-for="group in groups"
        :key="group.key"
        class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
      >
        <!-- Group Header -->
        <div class="px-5 py-4 bg-gray-50 dark:bg-white/[0.03] border-b border-gray-200 dark:border-white/10 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span :class="[
              'inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold',
              getConfidenceClass(group.confidence)
            ]">
              {{ group.confidence }}% {{ t('duplicates.match') }}
            </span>
            <span class="text-sm text-gray-500 dark:text-gray-400">{{ group.reason }}</span>
          </div>
          <div class="flex gap-2">
            <button
              @click="ignoreGroup(group)"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-white/10 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-all duration-300 touch-manipulation"
            >
              <X class="w-3.5 h-3.5" />
              {{ t('duplicates.notDuplicate') }}
            </button>
            <button
              @click="openMergeModal(group)"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main rounded-xl shadow-md shadow-primary-main/20 transition-all duration-300 touch-manipulation"
            >
              <Merge class="w-3.5 h-3.5" />
              {{ t('duplicates.merge') }}
            </button>
          </div>
        </div>

        <!-- Transaction Comparison -->
        <div class="divide-y divide-gray-200 dark:divide-white/10">
          <div
            v-for="(tx, idx) in group.transactions"
            :key="tx.id"
            class="px-5 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors"
          >
            <div class="flex items-center gap-4">
              <div class="w-8 h-8 rounded-lg bg-gray-100 dark:bg-white/5 flex items-center justify-center text-xs font-bold text-gray-500 dark:text-gray-400">
                #{{ idx + 1 }}
              </div>
              <div>
                <div class="font-medium text-gray-900 dark:text-white">{{ tx.reference }}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">{{ tx.customer }}</div>
              </div>
            </div>
            <div class="flex items-center gap-6">
              <div class="text-right">
                <div class="font-bold font-mono text-gray-900 dark:text-white">{{ formatCurrency(tx.amount) }}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">{{ formatDate(tx.date) }}</div>
              </div>
              <span :class="[
                'inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium',
                getStatusClass(tx.status)
              ]">
                {{ tx.status }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Merge Modal -->
    <Teleport to="body">
      <div v-if="showMergeModal" class="fixed inset-0 z-50 overflow-y-auto">
        <div class="flex items-center justify-center min-h-screen px-4">
          <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" @click="showMergeModal = false"></div>
          <div class="relative rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-gray-900 shadow-2xl max-w-lg w-full p-6">
            <div class="flex items-center gap-3 mb-5">
              <div class="w-10 h-10 rounded-xl bg-primary-main/10 dark:bg-primary-main/20 flex items-center justify-center">
                <Merge class="w-5 h-5 text-primary-main dark:text-primary-light" />
              </div>
              <div>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('duplicates.mergeTitle') }}</h3>
                <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('duplicates.selectToKeep') }}</p>
              </div>
            </div>

            <div class="space-y-2 mb-6">
              <label
                v-for="tx in selectedGroup?.transactions"
                :key="tx.id"
                class="flex items-center p-4 rounded-xl border cursor-pointer transition-all duration-200"
                :class="keepId === tx.id
                  ? 'border-primary-main bg-primary-main/5 dark:bg-primary-main/10 shadow-sm'
                  : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'"
              >
                <input
                  type="radio"
                  v-model="keepId"
                  :value="tx.id"
                  class="h-4 w-4 text-primary-main focus:ring-primary-main/30"
                />
                <div class="ml-3 flex-1">
                  <div class="font-medium text-gray-900 dark:text-white">{{ tx.reference }}</div>
                  <div class="text-sm text-gray-500 dark:text-gray-400">
                    {{ tx.customer }} · <span class="font-mono">{{ formatCurrency(tx.amount) }}</span> · {{ formatDate(tx.date) }}
                  </div>
                </div>
              </label>
            </div>

            <div class="flex justify-end gap-3">
              <button
                @click="showMergeModal = false"
                class="px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-xl border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5 transition-all touch-manipulation"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                @click="mergeDuplicates"
                :disabled="!keepId"
                class="px-4 py-2.5 text-sm font-medium bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 disabled:opacity-50 disabled:shadow-none transition-all duration-300 touch-manipulation"
              >
                {{ t('duplicates.mergeAndDelete') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  RefreshCw, CheckCircle, Copy, AlertTriangle, SlidersHorizontal,
  X, Merge, Loader2
} from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

const { t, locale } = useI18n()
const userStore = useUserStore()
const getAuthHeaders = () => userStore.authHeader

const isLoading = ref(false)
const threshold = ref('80')
const groups = ref<any[]>([])
const totalDuplicates = ref(0)
const showMergeModal = ref(false)
const selectedGroup = ref<any>(null)
const keepId = ref('')

const loadDuplicates = async () => {
  isLoading.value = true
  try {
    const data = await $fetch<any>(`/api/transactions/duplicates?threshold=${threshold.value}`, {
      headers: getAuthHeaders()
    })
    groups.value = data.groups
    totalDuplicates.value = data.totalDuplicates
  } catch (error) {
    console.error('Failed to load duplicates:', error)
  } finally {
    isLoading.value = false
  }
}

const openMergeModal = (group: any) => {
  selectedGroup.value = group
  keepId.value = group.transactions[0]?.id || ''
  showMergeModal.value = true
}

const mergeDuplicates = async () => {
  if (!keepId.value || !selectedGroup.value) return

  const deleteIds = selectedGroup.value.transactions
    .filter((tx: any) => tx.id !== keepId.value)
    .map((tx: any) => tx.id)

  try {
    await $fetch('/api/transactions/duplicates', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: {
        action: 'merge',
        keepId: keepId.value,
        deleteIds
      }
    })
    showMergeModal.value = false
    loadDuplicates()
  } catch (error) {
    console.error('Failed to merge:', error)
  }
}

const ignoreGroup = async (group: any) => {
  try {
    await $fetch('/api/transactions/duplicates', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: {
        action: 'ignore',
        transactionIds: group.transactions.map((tx: any) => tx.id)
      }
    })
    loadDuplicates()
  } catch (error) {
    console.error('Failed to ignore:', error)
  }
}

const formatCurrency = (value: number) => {
  const currencyLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  const currency = locale.value === 'ko' ? 'KRW' : 'JPY'
  return new Intl.NumberFormat(currencyLocale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
}

const formatDate = (date: string) => {
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(date).toLocaleDateString(dateLocale)
}

const getConfidenceClass = (confidence: number) => {
  if (confidence >= 90) return 'bg-red-500/10 text-red-600 dark:text-red-400'
  if (confidence >= 80) return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
  return 'bg-gray-500/10 text-gray-600 dark:text-gray-400'
}

const getStatusClass = (status: string) => {
  const classes: Record<string, string> = {
    completed: 'bg-green-500/10 text-green-600 dark:text-green-400',
    pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    failed: 'bg-red-500/10 text-red-600 dark:text-red-400'
  }
  return classes[status] || 'bg-gray-500/10 text-gray-600 dark:text-gray-400'
}

onMounted(() => {
  userStore.initAuth()
  loadDuplicates()
})
</script>
