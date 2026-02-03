<template>
  <div class="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
    <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
      <!-- Background overlay -->
      <div class="fixed inset-0 bg-gray-500 dark:bg-gray-900 bg-opacity-75 dark:bg-opacity-80 transition-opacity" @click="$emit('close')"></div>

      <!-- Modal panel -->
      <div class="inline-block align-bottom bg-white dark:bg-gray-800 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-5xl sm:w-full">
        <div class="bg-white dark:bg-gray-800 px-4 pt-5 pb-4 sm:p-6">
          <div class="sm:flex sm:items-start">
            <div class="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-purple-100 dark:bg-purple-900/30 sm:mx-0 sm:h-10 sm:w-10">
              <LinkIcon class="h-6 w-6 text-purple-600 dark:text-purple-400" />
            </div>
            <div class="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
              <h3 class="text-lg leading-6 font-medium text-gray-900 dark:text-gray-100" id="modal-title">
                {{ t('receiptMatchDialog.title') }}
              </h3>
              <div class="mt-2">
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  {{ t('receiptMatchDialog.description') }}
                </p>
              </div>
            </div>
          </div>

          <div class="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Left column - Receipt Details -->
            <div>
              <h4 class="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">{{ t('receiptMatchDialog.selectedReceipt') }}</h4>
              <div class="border border-gray-300 dark:border-gray-600 rounded-md mb-3">
                <div class="px-4 py-3 bg-gray-50 dark:bg-gray-700 border-b border-gray-300 dark:border-gray-600 flex items-center">
                  <div class="h-10 w-10 flex-shrink-0 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600">
                    <div class="h-10 w-10 flex items-center justify-center text-gray-500 dark:text-gray-400">
                      <FileText size="20" />
                    </div>
                  </div>
                  <div class="ml-3 flex-1">
                    <div class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ receipt.filename }}</div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">
                      {{ t('receiptMatchDialog.uploaded', { date: formatDate(receipt.uploadDate) }) }}
                    </div>
                  </div>
                </div>

                <div class="p-4">
                  <div class="bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md p-4">
                    <h4 class="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">{{ t('receiptMatchDialog.receiptDetails') }}</h4>
                    <div class="grid grid-cols-2 gap-4">
                      <div>
                        <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">{{ t('receiptMatchDialog.merchant') }}</p>
                        <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {{ receipt.merchant || t('receiptMatchDialog.notDetected') }}
                        </p>
                      </div>
                      <div>
                        <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">{{ t('common.date') }}</p>
                        <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {{ receipt.date ? formatDate(receipt.date) : t('receiptMatchDialog.notDetected') }}
                        </p>
                      </div>
                      <div>
                        <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">{{ t('common.amount') }}</p>
                        <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {{ receipt.amount ? formatCurrency(receipt.amount) : t('receiptMatchDialog.notDetected') }}
                        </p>
                      </div>
                      <div>
                        <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">{{ t('common.status') }}</p>
                        <p class="text-sm font-medium text-yellow-600">{{ t('receiptMatchDialog.unmatched') }}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Receipt preview placeholder -->
              <div class="border border-gray-300 dark:border-gray-600 rounded-md p-4 flex items-center justify-center bg-gray-50 dark:bg-gray-700 h-64">
                <div class="text-center">
                  <FileText size="40" class="mx-auto text-gray-400 dark:text-gray-500 mb-2" />
                  <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('receiptMatchDialog.receiptPreview') }}</p>
                  <button class="mt-2 text-sm text-purple-600 dark:text-purple-400">{{ t('receiptMatchDialog.viewFullSize') }}</button>
                </div>
              </div>
            </div>

            <!-- Right column - Transaction Selection -->
            <div>
              <div class="flex items-center justify-between mb-3">
                <h4 class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ t('receiptMatchDialog.selectTransaction') }}</h4>
                <div class="relative">
                  <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search size="14" class="text-gray-400" />
                  </div>
                  <input
                      v-model="searchQuery"
                      type="text"
                      class="block w-full pl-10 pr-3 py-1 border border-gray-300 dark:border-gray-600 rounded-md leading-5 bg-white dark:bg-gray-700 dark:text-gray-200 placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-purple-500 focus:border-purple-500 sm:text-xs"
                      :placeholder="t('receiptMatchDialog.searchTransactions')"
                  />
                </div>
              </div>

              <div class="border border-gray-300 dark:border-gray-600 rounded-md h-96 overflow-y-auto">
                <div class="divide-y divide-gray-200 dark:divide-gray-700">
                  <div
                      v-for="transaction in filteredTransactions"
                      :key="transaction.id"
                      class="p-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                      :class="{ 'bg-purple-50 dark:bg-purple-900/20 border-l-4 border-purple-500': selectedTransactionId === transaction.id }"
                      @click="selectedTransactionId = transaction.id"
                  >
                    <div class="flex items-center">
                      <div class="h-10 w-10 flex-shrink-0 rounded-full"
                           :class="getTransactionIconBg(transaction.type)">
                        <div class="h-10 w-10 flex items-center justify-center"
                             :class="getTransactionIconColor(transaction.type)">
                          <component :is="getTransactionIcon(transaction.type)" size="20" />
                        </div>
                      </div>
                      <div class="ml-3 flex-1">
                        <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
                          #{{ transaction.id }}
                        </div>
                        <div class="text-xs text-gray-500 dark:text-gray-400">
                          {{ transaction.type }} - {{ formatCurrency(transaction.amount) }}
                        </div>
                        <div class="text-xs text-gray-500 dark:text-gray-400">
                          {{ formatDate(transaction.date) }}
                        </div>
                      </div>
                      <div class="flex-shrink-0">
                        <StatusBadge :status="transaction.status" />
                      </div>
                    </div>

                    <!-- Matching confidence indicator (if amount matches) -->
                    <div v-if="receipt.amount && transaction.amount === receipt.amount"
                         class="mt-2 bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800 rounded p-2">
                      <div class="flex items-center">
                        <CheckCircle size="16" class="text-green-500 mr-1" />
                        <span class="text-xs text-green-700 dark:text-green-400">
                          {{ t('receiptMatchDialog.highMatchConfidence') }}
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- Empty state -->
                  <div v-if="filteredTransactions.length === 0" class="p-6 text-center">
                    <p class="text-gray-500 dark:text-gray-400 text-sm">{{ t('receiptMatchDialog.noMatchingTransactions') }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="bg-gray-50 dark:bg-gray-700 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
          <button
              type="button"
              class="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-purple-600 text-base font-medium text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 sm:ml-3 sm:w-auto sm:text-sm"
              :disabled="!selectedTransactionId"
              @click="matchReceipt"
          >
            {{ t('receiptMatchDialog.confirmMatch') }}
          </button>
          <button
              type="button"
              class="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 dark:border-gray-600 shadow-sm px-4 py-2 bg-white dark:bg-gray-800 text-base font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
              @click="$emit('close')"
          >
            {{ t('common.cancel') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  FileText,
  Link as LinkIcon,
  Search,
  CheckCircle,
  CreditCard,
  Globe,
  ShoppingCart
} from 'lucide-vue-next'

const { t, locale } = useI18n()

const props = defineProps({
  receipt: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['close', 'match'])

// State
const searchQuery = ref('')
const selectedTransactionId = ref<string | null>(null)
const transactions = ref<any[]>([])
const isLoading = ref(false)

// Fetch transactions from API
onMounted(async () => {
  isLoading.value = true
  try {
    // First try to get suggested matches for this receipt
    let suggestedMatches: any[] = []
    try {
      const matchesResult = await $fetch<any>(`/api/receipts/${props.receipt.id || props.receipt._id}/matches`)
      suggestedMatches = matchesResult?.matches || []
    } catch (e) {
      // Ignore if matches endpoint fails
    }

    // Fetch unmatched transactions (without receipts)
    const transactionsData = await $fetch<any[]>('/api/transactions')

    // Filter to transactions without receipts and format for display
    transactions.value = (transactionsData || [])
      .filter((t: any) => !t.hasReceipt)
      .map((t: any) => ({
        id: t._id || t.id,
        type: t.type || '支出',
        amount: t.amount,
        date: t.date,
        status: t.status,
        accountCategory: t.accountCategoryId?.name || '-',
        supplier: t.supplierId?.name || t.customerId?.name || '-',
        // Check if this is a suggested match
        isMatch: suggestedMatches.some((m: any) => m.transactionId === (t._id || t.id))
      }))
      .sort((a: any, b: any) => {
        // Sort suggested matches first
        if (a.isMatch && !b.isMatch) return -1
        if (!a.isMatch && b.isMatch) return 1
        // Then by date descending
        return new Date(b.date).getTime() - new Date(a.date).getTime()
      })

    // Try to auto-select a transaction with matching amount
    if (props.receipt.amount) {
      const matchingTransaction = transactions.value.find((t: any) => t.amount === props.receipt.amount)
      if (matchingTransaction) {
        selectedTransactionId.value = matchingTransaction.id
      }
    }
  } catch (error) {
    console.error('Failed to load transactions:', error)
  } finally {
    isLoading.value = false
  }
})

// Filtered transactions based on search
const filteredTransactions = computed(() => {
  if (!searchQuery.value) {
    return transactions.value
  }

  const query = searchQuery.value.toLowerCase()
  return transactions.value.filter(transaction =>
      transaction.id.toLowerCase().includes(query) ||
      transaction.type.toLowerCase().includes(query) ||
      transaction.amount.toString().includes(query) ||
      transaction.status.toLowerCase().includes(query)
  )
})

// Format date (locale-aware)
const formatDate = (isoDate: string) => {
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(isoDate).toLocaleDateString(dateLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

// Format currency (locale-aware)
const formatCurrency = (amount: number) => {
  const currencyLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  const currency = locale.value === 'ko' ? 'KRW' : 'JPY'
  return new Intl.NumberFormat(currencyLocale, {
    style: 'currency',
    currency: currency,
    maximumFractionDigits: 0
  }).format(amount)
}

// Get transaction icon based on type (OMF style)
const getTransactionIcon = (type: string) => {
  switch (type) {
    case '入金':
      return CreditCard
    case '支出':
    default:
      return ShoppingCart
  }
}

// Get transaction icon background color (OMF style)
const getTransactionIconBg = (type: string) => {
  switch (type) {
    case '入金':
      return 'bg-green-100 dark:bg-green-900/30'
    case '支出':
    default:
      return 'bg-red-100 dark:bg-red-900/30'
  }
}

// Get transaction icon color (OMF style)
const getTransactionIconColor = (type: string) => {
  switch (type) {
    case '入金':
      return 'text-green-600 dark:text-green-400'
    case '支出':
    default:
      return 'text-red-600 dark:text-red-400'
  }
}

// Match receipt with selected transaction
const matchReceipt = () => {
  if (selectedTransactionId.value) {
    emit('match', props.receipt.id, selectedTransactionId.value)
  }
}
</script>