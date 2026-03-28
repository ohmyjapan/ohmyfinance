<template>
  <div>
    <header class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-800 dark:text-gray-100">{{ t('duplicates.title') }}</h1>
        <p class="text-gray-600 dark:text-gray-400">{{ t('duplicates.description') }}</p>
      </div>
      <div class="mt-4 md:mt-0 flex space-x-3">
        <select
            v-model="threshold"
            @change="loadDuplicates"
            class="border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2"
        >
          <option value="90">{{ t('duplicates.highConfidence') }}</option>
          <option value="80">{{ t('duplicates.mediumConfidence') }}</option>
          <option value="70">{{ t('duplicates.lowConfidence') }}</option>
        </select>
        <button
            @click="loadDuplicates"
            class="inline-flex items-center px-4 py-2 bg-primary-main text-white rounded-xl hover:bg-primary-dark touch-manipulation"
        >
          <RefreshCw class="h-4 w-4 mr-2" :class="isLoading ? 'animate-spin' : ''" />
          {{ t('duplicates.scan') }}
        </button>
      </div>
    </header>

    <!-- Summary -->
    <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4 mb-6">
      <div class="flex items-center justify-between">
        <div>
          <span class="text-2xl font-bold text-gray-900 dark:text-gray-100">{{ groups.length }}</span>
          <span class="text-gray-500 dark:text-gray-400 ml-2">{{ t('duplicates.groupsFound') }}</span>
        </div>
        <div class="text-gray-500 dark:text-gray-400">
          {{ t('duplicates.potentialDuplicates', { count: totalDuplicates }) }}
        </div>
      </div>
    </div>

    <div v-if="isLoading" class="text-center py-8 text-gray-500">{{ t('duplicates.scanning') }}</div>

    <div v-else-if="groups.length === 0" class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-8 text-center text-gray-500">
      <Check class="h-12 w-12 mx-auto text-green-500 mb-4" />
      <p>{{ t('duplicates.noDuplicates') }}</p>
    </div>

    <div v-else class="space-y-4">
      <div v-for="group in groups" :key="group.key" class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-hidden">
        <div class="px-4 py-3 bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10 flex items-center justify-between">
          <div class="flex items-center space-x-3">
            <div
                class="px-2 py-1 rounded text-xs font-medium"
                :class="getConfidenceClass(group.confidence)"
            >
              {{ group.confidence }}% match
            </div>
            <span class="text-sm text-gray-500 dark:text-gray-400">{{ group.reason }}</span>
          </div>
          <div class="flex space-x-2">
            <button
                @click="ignoreGroup(group)"
                class="px-3 py-1 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 border border-gray-300 dark:border-white/10 rounded-xl touch-manipulation"
            >
              {{ t('duplicates.notDuplicate') }}
            </button>
            <button
                @click="openMergeModal(group)"
                class="px-3 py-1 text-sm text-white bg-primary-main hover:bg-primary-dark rounded-xl touch-manipulation"
            >
              {{ t('duplicates.merge') }}
            </button>
          </div>
        </div>

        <div class="divide-y divide-gray-200 dark:divide-white/10">
          <div
              v-for="(tx, idx) in group.transactions"
              :key="tx.id"
              class="px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-white/10"
          >
            <div class="flex items-center space-x-4">
              <div class="text-xs text-gray-400">#{{ idx + 1 }}</div>
              <div>
                <div class="font-medium text-gray-900 dark:text-gray-100">{{ tx.reference }}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">{{ tx.customer }}</div>
              </div>
            </div>
            <div class="flex items-center space-x-6">
              <div class="text-right">
                <div class="font-medium text-gray-900 dark:text-gray-100">{{ formatCurrency(tx.amount) }}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">{{ formatDate(tx.date) }}</div>
              </div>
              <span
                  class="px-2 py-1 text-xs rounded-full"
                  :class="getStatusClass(tx.status)"
              >
                {{ tx.status }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Merge Modal -->
    <div v-if="showMergeModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" @click="showMergeModal = false"></div>
        <div class="relative bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl max-w-lg w-full p-6">
          <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">{{ t('duplicates.mergeTitle') }}</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {{ t('duplicates.selectToKeep') }}
          </p>

          <div class="space-y-2 mb-6">
            <label
                v-for="tx in selectedGroup?.transactions"
                :key="tx.id"
                class="flex items-center p-3 rounded border cursor-pointer"
                :class="keepId === tx.id ? 'border-primary-main bg-primary-main/10 dark:bg-primary-main/20' : 'border-gray-200 dark:border-white/10'"
            >
              <input
                  type="radio"
                  v-model="keepId"
                  :value="tx.id"
                  class="h-4 w-4 text-primary-main"
              />
              <div class="ml-3">
                <div class="font-medium text-gray-900 dark:text-gray-100">{{ tx.reference }}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">
                  {{ tx.customer }} · {{ formatCurrency(tx.amount) }} · {{ formatDate(tx.date) }}
                </div>
              </div>
            </label>
          </div>

          <div class="flex justify-end space-x-3">
            <button
                @click="showMergeModal = false"
                class="px-4 py-2 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10"
            >
              {{ t('common.cancel') }}
            </button>
            <button
                @click="mergeDuplicates"
                :disabled="!keepId"
                class="px-4 py-2 bg-primary-main text-white rounded-xl hover:bg-primary-dark disabled:opacity-50 touch-manipulation"
            >
              {{ t('duplicates.mergeAndDelete') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { RefreshCw, Check } from 'lucide-vue-next'

const { t, locale } = useI18n()
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
    const data = await $fetch(`/api/transactions/duplicates?threshold=${threshold.value}`)
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
  if (confidence >= 90) return 'bg-red-100 text-red-700'
  if (confidence >= 80) return 'bg-yellow-100 text-yellow-700'
  return 'bg-gray-100 text-gray-700'
}

const getStatusClass = (status: string) => {
  const classes: Record<string, string> = {
    completed: 'bg-green-100 text-green-700',
    pending: 'bg-yellow-100 text-yellow-700',
    failed: 'bg-red-100 text-red-700'
  }
  return classes[status] || 'bg-gray-100 text-gray-700'
}

onMounted(() => loadDuplicates())
</script>
