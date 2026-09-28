<template>
  <div>
    <header class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-800">{{ t('nav.receiptManagement') }}</h1>
        <p class="text-gray-600">{{ t('receipts.description') }}</p>
      </div>

      <div class="mt-4 md:mt-0 flex space-x-3">
        <button
            v-if="canEdit"
            class="inline-flex items-center px-4 py-2 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-primary-main hover:bg-primary-dark touch-manipulation focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
            @click="router.push('/receipts/upload')"
        >
          <Upload class="mr-2 h-4 w-4" />
          {{ t('receipts.upload') }}
        </button>
      </div>
    </header>

    <!-- Stats Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-6">
      <StatCard
          :title="t('receipts.title')"
          :value="!hasLoaded ? '—' : String(receiptStats.total)"
          icon="FileText"
          color="primary"
      />

      <StatCard
          :title="t('receipts.matched')"
          :value="!hasLoaded ? '—' : String(receiptStats.matched)"
          icon="CheckCircle"
          color="green"
      />

      <StatCard
          :title="t('receipts.unmatched')"
          :value="!hasLoaded ? '—' : String(receiptStats.unmatched)"
          icon="AlertTriangle"
          color="amber"
      />

      <StatCard
          :title="t('receipts.matchRate')"
          :value="!hasLoaded ? '—' : String(receiptStats.matchRate) + '%'"
          icon="BarChart2"
          color="blue"
      />
    </div>

    <!-- Filter & Search Bar -->
    <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm mb-6">
      <div class="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div class="flex flex-1 flex-col sm:flex-row gap-3">
          <div class="relative flex-1">
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search class="h-5 w-5 text-gray-400" />
            </div>
            <input
                v-model="searchQuery"
                type="text"
                class="block w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl leading-5 bg-white dark:bg-white/5 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm"
                :placeholder="t('receiptsList.searchPlaceholder')"
            />
          </div>

          <div class="flex space-x-3">
            <div class="relative">
              <select
                  v-model="filters.status"
                  class="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm rounded-xl dark:bg-white/5 dark:border-white/10 dark:text-white"
              >
                <option :value="undefined">{{ t('receiptsList.allStatuses') }}</option>
                <option value="matched">{{ t('receipts.matched') }}</option>
                <option value="unmatched">{{ t('receipts.unmatched') }}</option>
              </select>
            </div>

            <div class="relative">
              <select
                  v-model="filters.type"
                  class="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm rounded-xl dark:bg-white/5 dark:border-white/10 dark:text-white"
              >
                <option :value="undefined">{{ t('receiptsList.allTypes') }}</option>
                <option value="pdf">PDF</option>
                <option value="jpg">JPG/JPEG</option>
                <option value="png">PNG</option>
              </select>
            </div>
          </div>
        </div>

        <div class="flex items-center">
          <button
              class="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-white/10 rounded-xl shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
              @click="showAdvancedFilters = !showAdvancedFilters"
          >
            <Filter class="mr-2 h-4 w-4 text-gray-500" />
            {{ showAdvancedFilters ? t('transactionsList.hideFilters') : t('transactionsList.advancedFilters') }}
          </button>

          <button
              v-if="isFiltered"
              class="ml-3 text-sm text-primary-main hover:text-primary-main"
              @click="resetFilters"
          >
            {{ t('transactionsList.clearFilters') }}
          </button>
        </div>
      </div>

      <!-- Advanced Filters (conditional) -->
      <div v-if="showAdvancedFilters" class="px-4 py-3 border-t border-gray-200 bg-gray-50">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('receiptsList.uploadDateRange') }}</label>
            <div class="flex space-x-2">
              <input
                  v-model="filters.dateFrom"
                  type="date"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main sm:text-sm"
              />
              <input
                  v-model="filters.dateTo"
                  type="date"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main sm:text-sm"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('transactionsList.amountRange') }}</label>
            <div class="flex space-x-2">
              <input
                  v-model="filters.minAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  :placeholder="t('transactionsList.min')"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main sm:text-sm"
              />
              <input
                  v-model="filters.maxAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  :placeholder="t('transactionsList.max')"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main sm:text-sm"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('receipts.merchant') }}</label>
            <input
                v-model="filters.merchant"
                type="text"
                :placeholder="t('receiptsList.merchantPlaceholder')"
                class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main sm:text-sm"
            />
          </div>
        </div>
      </div>
    </div>

    <div v-if="error || downloadError" role="alert" class="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">
      {{ error || downloadError }}
      <button :disabled="isSaving" class="ml-3 underline" @click="fetchReceipts">{{ t('receiptWorkspace.reload') }}</button>
    </div>
    <ReceiptMatchDialog v-if="receiptToMatch && canEdit" :receipt="receiptToMatch" :busy="isSaving" :save-error="error || ''" @close="receiptToMatch = null" @match="saveMatch" />

    <!-- Receipts Table -->
    <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-x-auto">
      <div v-if="isLoading" class="flex justify-center items-center p-12">
        <Loader class="h-8 w-8 text-primary-main animate-spin" />
        <span class="ml-2 text-gray-600">{{ t('receiptsList.loading') }}</span>
      </div>

      <div v-else-if="!error && filteredReceipts.length === 0" class="text-center py-16">
        <FileText class="mx-auto h-12 w-12 text-gray-300" />
        <h3 class="mt-2 text-sm font-medium text-gray-900">{{ t('receiptsList.noReceipts') }}</h3>
        <p class="mt-1 text-sm text-gray-500">
          {{ isFiltered ? t('receiptsList.adjustFilters') : t('receiptsList.getStarted') }}
        </p>
        <div class="mt-6">
          <button
              v-if="canEdit"
              class="inline-flex items-center px-4 py-2 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-primary-main hover:bg-primary-dark touch-manipulation focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
              @click="router.push('/receipts/upload')"
          >
            <Upload class="mr-2 h-4 w-4" />
            {{ t('receipts.upload') }}
          </button>
        </div>
      </div>

      <table v-else-if="filteredReceipts.length" class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50 dark:bg-white/5">
        <tr>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{{ t('receiptTable.receipt') }}</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{{ t('receiptTable.dateUploaded') }}</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{{ t('common.amount') }}</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{{ t('receipts.merchant') }}</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{{ t('common.status') }}</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{{ t('common.actions') }}</th>
        </tr>
        </thead>
        <tbody class="bg-white dark:bg-white/5 divide-y divide-gray-200 dark:divide-white/5">
        <tr
            v-for="receipt in paginatedReceipts"
            :key="receipt.id"
            class="hover:bg-gray-50 dark:hover:bg-white/[0.07]"
        >
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="flex items-center">
              <div class="h-10 w-10 flex-shrink-0 bg-gray-100 rounded">
                <div class="h-10 w-10 flex items-center justify-center text-gray-500">
                  <FileIcon :filename="(receipt.originalFilename || receipt.filename)" />
                </div>
              </div>
              <div class="ml-4">
                <div class="text-sm font-medium text-gray-900">{{ (receipt.originalFilename || receipt.filename) }}</div>
                <div class="text-sm text-gray-500">{{ formatFileSize(receipt.size) }}</div>
              </div>
            </div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="text-sm text-gray-900">{{ formatDate(receipt.uploadDate) }}</div>
            <div class="text-sm text-gray-500">{{ formatTime(receipt.uploadDate) }}</div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="text-sm text-gray-900" v-if="receipt.amount != null">
              {{ formatCurrency(receipt.amount, receipt.currency) }}
            </div>
            <div class="text-sm text-gray-500" v-else>--</div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="text-sm text-gray-900" v-if="receipt.merchant">
              {{ receipt.merchant }}
            </div>
            <div class="text-sm text-gray-500" v-else>--</div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
              <span v-if="receipt.status === 'matched'"
                    class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                <CheckCircle size="14" class="mr-1" />
                {{ t('receipts.matched') }}
              </span>
            <span v-else-if="receipt.status === 'unmatched'"
                  class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">
                <AlertTriangle size="14" class="mr-1" />
                {{ t('receipts.unmatched') }}
              </span>
            <span v-else class="text-sm text-gray-600">{{ t('common.' + receipt.status) }}</span>
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
            <NuxtLink v-if="receipt.transactionId" :to="'/transactions/' + receipt.transactionId" class="text-primary-main mr-3">{{ t('receiptWorkspace.transaction') }}</NuxtLink>
            <button
                @click="viewReceiptDetails(receipt)"
                :disabled="!receipt.fileUrl || isDownloading"
                class="text-primary-main hover:text-primary-dark mr-3"
            >
              {{ t('common.download') }}
            </button>
            <button
                v-if="canEdit && receipt.status === 'unmatched'"
                :disabled="isSaving"
                @click="matchReceipt(receipt.id)"
                class="text-primary-main hover:text-primary-dark mr-3"
            >
              {{ t('receipts.match') }}
            </button>
            <button
                v-if="canEdit"
                :disabled="isSaving"
                @click="confirmDelete(receipt.id)"
                class="text-red-600 hover:text-red-900"
            >
              {{ t('common.delete') }}
            </button>
          </td>
        </tr>
        </tbody>
      </table>

      <!-- Pagination -->
      <div v-if="filteredReceipts.length > 0" class="bg-white dark:bg-white/5 px-4 py-3 border-t border-gray-200 dark:border-white/10 sm:px-6">
        <div class="flex items-center justify-between">
          <div class="hidden sm:block">
            <p class="text-sm text-gray-700">
              {{ t('common.showing') }} <span class="font-medium">{{ paginationStart }}</span> {{ t('common.to') }} <span class="font-medium">{{ paginationEnd }}</span> {{ t('common.of') }} <span class="font-medium">{{ filteredReceipts.length }}</span> {{ t('receiptsList.receipts') }}
            </p>
          </div>
          <div class="flex-1 flex justify-center sm:justify-end">
            <nav class="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
              <button
                  @click="currentPage--"
                  :disabled="currentPage === 1"
                  class="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span class="sr-only">Previous</span>
                <ChevronLeft class="h-5 w-5" />
              </button>

              <template v-for="page in totalPages" :key="page">
                <button
                    v-if="totalPages <= 7 || page === 1 || page === totalPages || (page >= currentPage - 1 && page <= currentPage + 1)"
                    @click="currentPage = page"
                    :class="[
                    currentPage === page
                      ? 'z-10 bg-primary-main/10 border-primary-main text-primary-main'
                      : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50',
                    'relative inline-flex items-center px-4 py-2 border text-sm font-medium'
                  ]"
                >
                  {{ page }}
                </button>
                <span
                    v-else-if="(page === 2 && currentPage > 3) || (page === totalPages - 1 && currentPage < totalPages - 2)"
                    class="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700"
                >
                  ...
                </span>
              </template>

              <button
                  @click="currentPage++"
                  :disabled="currentPage === totalPages"
                  class="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span class="sr-only">Next</span>
                <ChevronRight class="h-5 w-5" />
              </button>
            </nav>
          </div>
        </div>
      </div>
    </div>

    <!-- Confirm Delete Modal -->
    <div
        v-if="showDeleteConfirm && canEdit"
        class="fixed inset-0 z-10 overflow-y-auto"
        aria-labelledby="modal-title"
        role="dialog"
        aria-modal="true"
    >
      <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div
            class="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            aria-hidden="true"
        ></div>

        <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

        <div class="inline-block align-bottom bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div class="sm:flex sm:items-start">
              <div class="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                <Trash2 class="h-6 w-6 text-red-600" />
              </div>
              <div class="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                <h3 class="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                  {{ t('receiptsList.deleteReceipt') }}
                </h3>
                <div class="mt-2">
                  <p class="text-sm text-gray-500">
                    {{ t('receiptsList.deleteConfirm') }}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <p v-if="error" role="alert" class="px-6 py-3 text-sm text-red-600">{{ error }}</p>
          <div class="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
                type="button"
                class="w-full inline-flex justify-center rounded-xl border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm"
                @click="deleteReceipt"
                :disabled="isSaving"
            >
              {{ t('common.delete') }}
            </button>
            <button
                type="button"
                class="mt-3 w-full inline-flex justify-center rounded-xl border border-gray-300 dark:border-white/10 shadow-sm px-4 py-2 bg-white dark:bg-white/5 text-base font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                @click="showDeleteConfirm = false"
            >
              {{ t('common.cancel') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, defineComponent, h } from 'vue'
import { useReceipts } from '~/composables/useReceipts'
import { useReceiptFiles } from '~/composables/useReceiptFiles'
import { useUserStore } from '~/stores/user'
import type { Receipt } from '~/types/receipt'
import {
  FileText,
  Upload,
  Search,
  Filter,
  CheckCircle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader,
  Trash2,
  Image
} from 'lucide-vue-next'

const { t, locale } = useI18n()

const user = useUserStore()
const { receipts, isLoading, isSaving, hasLoaded, error, filters, searchQuery, filteredReceipts, receiptStats,
  fetchReceipts, deleteReceipt: removeReceipt, matchWithTransaction, resetFilters } = useReceipts()
const { downloadReceipt, downloadError, isDownloading } = useReceiptFiles()
const canEdit = computed(() => ['owner', 'admin', 'member'].includes(user.currentOrganization?.role))
const currentPage = ref(1), itemsPerPage = ref(10), showAdvancedFilters = ref(false)
const showDeleteConfirm = ref(false), receiptToDelete = ref<string | null>(null), receiptToMatch = ref<Receipt | null>(null)
const router = useRouter()
let mounted = false
onMounted(async () => { mounted = true; await fetchReceipts() })
onBeforeUnmount(() => { mounted = false })
watch(() => user.authHeader.Authorization, () => {
  receiptToDelete.value = null; receiptToMatch.value = null; showDeleteConfirm.value = false; currentPage.value = 1
}, { flush: 'sync' })
// The session store sets token, session ID and company in one synchronous update.
// Clear immediately above; reload after that update has finished.
watch(() => user.authHeader.Authorization, () => {
  if (mounted) void fetchReceipts()
}, { flush: 'post' })
watch([searchQuery, filters], () => { currentPage.value = 1 }, { deep: true, flush: 'sync' })
watch(() => filteredReceipts.value.length, () => { currentPage.value = Math.min(currentPage.value, totalPages.value) }, { flush: 'sync' })
const isFiltered = computed(() => !!searchQuery.value || Object.values(filters.value).some(v => v !== '' && v != null))

// Paginated receipts
const paginatedReceipts = computed(() => {
  const startIdx = (currentPage.value - 1) * itemsPerPage.value
  const endIdx = startIdx + itemsPerPage.value
  return filteredReceipts.value.slice(startIdx, endIdx)
})

// Pagination calculations
const totalPages = computed(() => {
  return Math.ceil(filteredReceipts.value.length / itemsPerPage.value) || 1
})

const paginationStart = computed(() => {
  return (currentPage.value - 1) * itemsPerPage.value + 1
})

const paginationEnd = computed(() => {
  return Math.min(currentPage.value * itemsPerPage.value, filteredReceipts.value.length)
})

// Format helpers
const formatDate = (isoDate: string) => {
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(isoDate).toLocaleDateString(dateLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

const formatTime = (isoDate: string) => {
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(isoDate).toLocaleTimeString(dateLocale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

const formatCurrency = (amount: number, currency = 'JPY') => {
  const currencyLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Intl.NumberFormat(currencyLocale, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount)
}

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) {
    return bytes + ' B'
  } else if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + ' KB'
  } else {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }
}

// Only confirmed server results change the displayed records or close a dialog.
const viewReceiptDetails = (receipt: Receipt) => downloadReceipt(receipt.id, receipt.originalFilename || receipt.filename)
const matchReceipt = (id: string) => { if (canEdit.value) receiptToMatch.value = receipts.value.find(r => r.id === id) || null }
const saveMatch = async (id: string, transactionId: string) => {
  if (!canEdit.value || receiptToMatch.value?.id !== id) return
  const selected = receiptToMatch.value
  if (await matchWithTransaction(id, transactionId, selected.linkVersion ?? 0) && receiptToMatch.value === selected) receiptToMatch.value = null
}
const confirmDelete = (id: string) => { if (canEdit.value) { receiptToDelete.value = id; showDeleteConfirm.value = true; error.value = null } }
const deleteReceipt = async () => {
  const id = receiptToDelete.value
  if (!id || !canEdit.value) return
  if (await removeReceipt(id) && receiptToDelete.value === id) { showDeleteConfirm.value = false; receiptToDelete.value = null }
}

// Component to display appropriate icon based on file type
const FileIcon = defineComponent({
  props: {
    filename: {
      type: String,
      required: true
    }
  },
  setup(props) {
    const extension = computed(() => {
      const parts = props.filename.split('.')
      return parts[parts.length - 1].toLowerCase()
    })

    return () => {
      // Choose icon based on file extension
      switch (extension.value) {
        case 'pdf':
          return h(FileText, { size: 20 })
        case 'jpg':
        case 'jpeg':
        case 'png':
          return h(Image, { size: 20 })
        default:
          return h(FileText, { size: 20 })
      }
    }
  }
})

</script>
