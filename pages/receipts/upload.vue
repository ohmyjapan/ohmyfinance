<template>
  <div>
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-gray-800">{{ t('receiptUpload.title') }}</h1>
      <p class="text-gray-600">{{ t('receiptUpload.description') }}</p>
    </header>

    <!-- Upload Section -->
    <div class="bg-white rounded-lg shadow-sm mb-6">
      <div class="p-6">
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Left: Upload Zone -->
          <div class="lg:col-span-1">
            <ReceiptFileUploader @files-selected="handleFilesSelected" />
          </div>

          <!-- Right: Instructions -->
          <div class="lg:col-span-2">
            <h3 class="text-lg font-medium text-gray-900 mb-4">{{ t('receiptUpload.processing') }}</h3>
            <p class="text-sm text-gray-600 mb-4">
              {{ t('receiptUpload.processingDescription') }}
            </p>

            <div class="bg-blue-50 border border-blue-100 rounded-md p-4 mb-4">
              <h4 class="text-sm font-medium text-blue-800 mb-2">{{ t('receiptUpload.tips') }}</h4>
              <ul class="text-sm text-blue-700 space-y-2">
                <li class="flex items-start">
                  <CheckCircle size="16" class="text-blue-600 mr-2 mt-0.5 flex-shrink-0" />
                  <span>{{ t('receiptUpload.tip1') }}</span>
                </li>
                <li class="flex items-start">
                  <CheckCircle size="16" class="text-blue-600 mr-2 mt-0.5 flex-shrink-0" />
                  <span>{{ t('receiptUpload.tip2') }}</span>
                </li>
                <li class="flex items-start">
                  <CheckCircle size="16" class="text-blue-600 mr-2 mt-0.5 flex-shrink-0" />
                  <span>{{ t('receiptUpload.tip3') }}</span>
                </li>
              </ul>
            </div>

            <div class="grid grid-cols-3 gap-4 text-center">
              <div class="bg-gray-50 p-4 rounded-md">
                <div class="text-purple-600 font-semibold text-2xl mb-1">{{ receiptStats.total }}</div>
                <div class="text-xs text-gray-500">{{ t('receiptUpload.totalReceipts') }}</div>
              </div>
              <div class="bg-gray-50 p-4 rounded-md">
                <div class="text-green-600 font-semibold text-2xl mb-1">{{ receiptStats.matched }}</div>
                <div class="text-xs text-gray-500">{{ t('receiptUpload.matched') }}</div>
              </div>
              <div class="bg-gray-50 p-4 rounded-md">
                <div class="text-yellow-600 font-semibold text-2xl mb-1">{{ receiptStats.unmatched }}</div>
                <div class="text-xs text-gray-500">{{ t('receiptUpload.unmatched') }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Recent Uploads Table -->
    <div class="bg-white rounded-lg shadow-sm mb-6">
      <div class="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 class="text-lg font-medium text-gray-800">{{ t('receiptUpload.recentUploads') }}</h2>
        <div class="flex space-x-3">
          <div class="relative">
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search size="16" class="text-gray-400" />
            </div>
            <input
                v-model="searchQuery"
                type="text"
                class="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                :placeholder="t('receiptUpload.searchReceipts')"
            />
          </div>
          <button
              class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
              @click="isFilterOpen = !isFilterOpen"
          >
            <Filter size="16" class="mr-2 text-gray-500" />
            {{ t('common.filters') }}
          </button>
        </div>
      </div>

      <!-- Filters (conditionally displayed) -->
      <div v-if="isFilterOpen" class="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label for="status-filter" class="block text-sm font-medium text-gray-700 mb-1">{{ t('common.status') }}</label>
            <select
                id="status-filter"
                v-model="filters.status"
                class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
            >
              <option value="">{{ t('receiptUpload.allStatuses') }}</option>
              <option value="matched">{{ t('receiptUpload.matched') }}</option>
              <option value="unmatched">{{ t('receiptUpload.unmatched') }}</option>
            </select>
          </div>
          <div>
            <label for="date-filter" class="block text-sm font-medium text-gray-700 mb-1">{{ t('common.dateRange') }}</label>
            <select
                id="date-filter"
                v-model="filters.dateRange"
                class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
            >
              <option value="">{{ t('common.allTime') }}</option>
              <option value="today">{{ t('common.today') }}</option>
              <option value="week">{{ t('common.thisWeek') }}</option>
              <option value="month">{{ t('common.thisMonth') }}</option>
            </select>
          </div>
          <div class="flex items-end">
            <button
                class="inline-flex items-center px-4 py-2 border border-gray-300 bg-white rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                @click="resetFilters"
            >
              {{ t('common.resetFilters') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Table -->
      <ReceiptTable
          :receipts="filteredReceipts"
          @view="viewReceipt"
          @match="openMatchDialog"
          @delete="deleteReceipt"
      />

      <!-- Pagination -->
      <div class="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
        <div class="text-sm text-gray-700">
          {{ t('common.showingRange', { start: paginationStart, end: paginationEnd, total: receiptStats.total }) }}
        </div>
        <div class="flex space-x-1">
          <button
              class="inline-flex items-center px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="currentPage === 1"
              @click="currentPage--"
          >
            <ArrowLeft size="16" class="mr-1" />
            {{ t('common.previous') }}
          </button>
          <template v-for="page in totalPages" :key="page">
            <button
                class="inline-flex items-center px-3 py-1 rounded-md text-sm font-medium"
                :class="page === currentPage
                ? 'border border-transparent text-white bg-purple-600 hover:bg-purple-700'
                : 'border border-gray-300 text-gray-700 bg-white hover:bg-gray-50'"
                @click="currentPage = page"
            >
              {{ page }}
            </button>
          </template>
          <button
              class="inline-flex items-center px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="currentPage === totalPages"
              @click="currentPage++"
          >
            {{ t('common.next') }}
            <ArrowRight size="16" class="ml-1" />
          </button>
        </div>
      </div>
    </div>

    <!-- Receipt Matching Dialog -->
    <ReceiptMatchDialog
        v-if="showMatchDialog"
        :receipt="selectedReceipt"
        @close="showMatchDialog = false"
        @match="matchReceipt"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { CheckCircle, Search, Filter, ArrowLeft, ArrowRight } from 'lucide-vue-next'

const { t, locale } = useI18n()

// State
const receipts = ref<any[]>([])
const searchQuery = ref('')
const isFilterOpen = ref(false)
const isLoading = ref(false)
const isUploading = ref(false)
const filters = ref({
  status: '',
  dateRange: ''
})
const currentPage = ref(1)
const itemsPerPage = ref(10)
const showMatchDialog = ref(false)
const selectedReceipt = ref(null)

// Receipt stats
const receiptStats = ref({
  total: 0,
  matched: 0,
  unmatched: 0
})

// Load receipts from API
const loadReceipts = async () => {
  isLoading.value = true
  try {
    const response = await $fetch<any>('/api/receipts')
    // Handle both array and object responses
    const data = Array.isArray(response) ? response : (response?.receipts || [])
    receipts.value = data

    // Calculate stats
    receiptStats.value = {
      total: receipts.value.length,
      matched: receipts.value.filter((r: any) => r.status === 'matched' || r.transactionId).length,
      unmatched: receipts.value.filter((r: any) => r.status !== 'matched' && !r.transactionId).length
    }
  } catch (error) {
    console.error('Failed to load receipts:', error)
    receipts.value = []
  } finally {
    isLoading.value = false
  }
}

// Load receipts on mount
onMounted(async () => {
  await loadReceipts()
})

// Filtered receipts based on search and filters
const filteredReceipts = computed(() => {
  let result = [...receipts.value]

  // Apply search filter
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(receipt =>
        receipt.filename.toLowerCase().includes(query) ||
        receipt.merchant.toLowerCase().includes(query) ||
        receipt.amount.toString().includes(query)
    )
  }

  // Apply status filter
  if (filters.value.status) {
    result = result.filter(receipt => receipt.status === filters.value.status)
  }

  // Apply date filter
  if (filters.value.dateRange) {
    const now = new Date()
    let cutoffDate = new Date()

    if (filters.value.dateRange === 'today') {
      cutoffDate.setHours(0, 0, 0, 0)
    } else if (filters.value.dateRange === 'week') {
      cutoffDate.setDate(now.getDate() - 7)
    } else if (filters.value.dateRange === 'month') {
      cutoffDate.setMonth(now.getMonth() - 1)
    }

    result = result.filter(receipt => new Date(receipt.uploadDate) >= cutoffDate)
  }

  return result
})

// Pagination calculations
const paginationStart = computed(() => {
  return (currentPage.value - 1) * itemsPerPage.value + 1
})

const paginationEnd = computed(() => {
  return Math.min(currentPage.value * itemsPerPage.value, filteredReceipts.value.length)
})

const totalPages = computed(() => {
  return Math.ceil(filteredReceipts.value.length / itemsPerPage.value) || 1
})

// Reset filters
const resetFilters = () => {
  filters.value = {
    status: '',
    dateRange: ''
  }
  searchQuery.value = ''
}

// File selection handler - Upload to API
const handleFilesSelected = async (files: File[]) => {
  if (!files || files.length === 0) return

  isUploading.value = true
  try {
    for (const file of files) {
      const formData = new FormData()
      formData.append('file', file)

      const result = await $fetch<any>('/api/receipts/upload', {
        method: 'POST',
        body: formData
      })

      if (result && result.receipt) {
        // Add to beginning of list
        receipts.value.unshift(result.receipt)

        // Update stats
        receiptStats.value.total++
        receiptStats.value.unmatched++
      }
    }
  } catch (error) {
    console.error('Failed to upload receipt:', error)
    alert('領収書のアップロードに失敗しました')
  } finally {
    isUploading.value = false
  }
}

// View receipt details
const viewReceipt = (receiptId: string) => {
  // Navigate to receipt details page
  navigateTo(`/receipts/${receiptId}`)
}

// Open match dialog
const openMatchDialog = (receiptId) => {
  const receipt = receipts.value.find(r => r.id === receiptId)
  if (receipt) {
    selectedReceipt.value = receipt
    showMatchDialog.value = true
  }
}

// Match receipt with transaction - Call API
const matchReceipt = async (receiptId: string, transactionId: string) => {
  try {
    const result = await $fetch(`/api/receipts/${receiptId}/match`, {
      method: 'POST',
      body: { transactionId }
    })

    if (result) {
      // Update receipt in local state
      const receipt = receipts.value.find(r => r.id === receiptId || r._id === receiptId)
      if (receipt) {
        receipt.status = 'matched'
        receipt.transactionId = transactionId

        // Update stats
        receiptStats.value.matched++
        receiptStats.value.unmatched--
      }
    }
  } catch (error) {
    console.error('Failed to match receipt:', error)
    alert('領収書のマッチングに失敗しました')
  }

  // Close dialog
  showMatchDialog.value = false
}

// Delete receipt - Call API
const deleteReceipt = async (receiptId: string) => {
  if (!confirm('この領収書を削除しますか？')) return

  try {
    await $fetch(`/api/receipts/${receiptId}`, {
      method: 'DELETE'
    })

    const receiptIndex = receipts.value.findIndex(r => r.id === receiptId || r._id === receiptId)
    if (receiptIndex !== -1) {
      const receipt = receipts.value[receiptIndex]

      // Update stats
      receiptStats.value.total--
      if (receipt.status === 'matched' || receipt.transactionId) {
        receiptStats.value.matched--
      } else {
        receiptStats.value.unmatched--
      }

      // Remove from array
      receipts.value.splice(receiptIndex, 1)
    }
  } catch (error) {
    console.error('Failed to delete receipt:', error)
    alert('領収書の削除に失敗しました')
  }
}
</script>