<template>
  <div>
    <header class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-800 dark:text-gray-100">{{ t('transactions.title') }}</h1>
        <p class="text-gray-600 dark:text-gray-400">{{ t('transactions.transactionDetails') }}</p>
      </div>

      <div class="mt-4 md:mt-0 flex space-x-3">
        <button class="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-white/10 rounded-xl shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main">
          <FileText class="mr-2 h-4 w-4 text-gray-500" />
          {{ t('common.export') }} CSV
        </button>
        <button
            class="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-white/10 rounded-xl shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
            @click="router.push('/transactions/upload')"
        >
          <Upload class="mr-2 h-4 w-4 text-gray-500" />
          {{ t('common.import') }}
        </button>
        <button
            class="inline-flex items-center px-4 py-2 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-primary-main hover:bg-primary-dark touch-manipulation focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
            @click="showCreateModal = true"
        >
          <Plus class="mr-2 h-4 w-4" />
          {{ t('transactionForm.createTitle') }}
        </button>
      </div>
    </header>

    <!-- Stats Cards -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
      <StatCard
          :title="t('transactions.expenseTotal')"
          :value="formatCurrency(transactionStats.expense?.amount || 0)"
          icon="CreditCard"
          color="red"
      />

      <StatCard
          :title="t('transactions.incomeTotal')"
          :value="formatCurrency(transactionStats.income?.amount || 0)"
          icon="DollarSign"
          color="green"
      />

      <StatCard
          :title="t('transactions.transactionCount')"
          :value="transactionStats.total.count.toString()"
          icon="Clock"
          color="primary"
      />

      <StatCard
          :title="t('transactions.hasReceipt')"
          :value="Math.round((transactionStats.receiptMatchRate || 0) * 100) + '%'"
          icon="FileText"
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
                class="block w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl leading-5 bg-white dark:bg-white/5 placeholder-gray-500 dark:text-white focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm"
                :placeholder="t('transactionsList.searchPlaceholder')"
            />
          </div>

          <div class="flex space-x-3">
            <div class="relative">
              <select
                  v-model="filters.status"
                  class="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm rounded-xl dark:bg-white/5 dark:border-white/10 dark:text-white"
              >
                <option value="">{{ t('transactionsList.allStatuses') }}</option>
                <option value="completed">{{ t('transactions.statuses.completed') }}</option>
                <option value="pending">{{ t('transactions.statuses.pending') }}</option>
                <option value="processing">{{ t('transactions.statuses.processing') }}</option>
                <option value="failed">{{ t('transactions.statuses.failed') }}</option>
                <option value="refunded">{{ t('transactions.statuses.refunded') }}</option>
              </select>
            </div>

            <div class="relative">
              <select
                  v-model="filters.type"
                  class="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm rounded-xl dark:bg-white/5 dark:border-white/10 dark:text-white"
              >
                <option value="">{{ t('transactions.allTypes') }}</option>
                <option value="支出">{{ t('transactions.expense') }}</option>
                <option value="入金">{{ t('transactions.income') }}</option>
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
              class="ml-3 text-sm text-primary-main hover:text-primary-dark"
              @click="resetFilters"
          >
            {{ t('transactionsList.clearFilters') }}
          </button>
        </div>
      </div>

      <!-- Advanced Filters (conditional) -->
      <div v-if="showAdvancedFilters" class="px-4 py-3 border-t border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('transactionsList.dateRange') }}</label>
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
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('transactions.otherFilters') }}</label>
            <div class="flex space-x-4">
              <label class="inline-flex items-center">
                <input
                    v-model="filters.hasReceipt"
                    type="checkbox"
                    class="rounded border-gray-300 text-primary-main shadow-sm focus:border-primary-light focus:ring focus:ring-primary-light focus:ring-opacity-50"
                />
                <span class="ml-2 text-sm text-gray-700">{{ t('transactions.hasReceipt') }}</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Transactions Table -->
    <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-hidden">
      <div v-if="isLoading" class="flex justify-center items-center p-12">
        <Loader class="h-8 w-8 text-primary-main animate-spin" />
        <span class="ml-2 text-gray-600">{{ t('transactionsList.loading') }}</span>
      </div>

      <div v-else-if="filteredTransactions.length === 0" class="text-center py-16">
        <CreditCard class="mx-auto h-12 w-12 text-gray-300" />
        <h3 class="mt-2 text-sm font-medium text-gray-900">{{ t('transactionsList.noTransactions') }}</h3>
        <p class="mt-1 text-sm text-gray-500">
          {{ isFiltered ? t('transactionsList.adjustFilters') : t('transactionsList.getStarted') }}
        </p>
        <div class="mt-6">
          <button
              class="inline-flex items-center px-4 py-2 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-primary-main hover:bg-primary-dark touch-manipulation focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
              @click="router.push('/transactions/upload')"
          >
            <Upload class="mr-2 h-4 w-4" />
            {{ t('transactionsList.importTransactions') }}
          </button>
        </div>
      </div>

      <table v-else class="min-w-full divide-y divide-gray-200 dark:divide-white/10">
        <thead class="bg-gray-50 dark:bg-white/5">
        <tr>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('transactions.date') }}</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('transactions.type') }}</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('transactions.category') }}</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('transactions.amount') }}</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('transactions.vendor') }}</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('transactions.receipt') }}</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('common.actions') }}</th>
        </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 dark:divide-white/10">
        <tr
            v-for="transaction in paginatedTransactions"
            :key="transaction.id"
            class="hover:bg-gray-50 dark:hover:bg-white/[0.07]"
        >
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ formatDate(transaction.date) }}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">{{ transaction.referenceNumber || transaction.id }}</div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <span :class="[
              'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
              transaction.type === '入金' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            ]">
              {{ transaction.type || t('transactions.expense') }}
            </span>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="text-sm text-gray-900 dark:text-gray-100">{{ transaction.accountCategoryId?.name || transaction.accountCategoryName || '-' }}</div>
            <div class="text-xs text-gray-500">{{ transaction.subAccountCategoryId?.name || transaction.subAccountCategoryName || '' }}</div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <div :class="[
              'text-sm font-medium font-mono',
              transaction.type === '入金' ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-gray-100'
            ]">
              {{ formatCurrency(transaction.amount) }}
            </div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="text-sm text-gray-900">
              {{ transaction.supplierId?.name || transaction.supplierName || transaction.customerId?.name || transaction.customerName || '-' }}
            </div>
            <div class="text-xs text-gray-500">{{ transaction.productName || '' }}</div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <div v-if="transaction.hasReceipt" class="text-sm">
              <span class="text-green-600 inline-flex items-center">
                <FileText class="h-4 w-4 mr-1" />
                {{ t('transactions.receiptExists') }}
              </span>
            </div>
            <div v-else>
              <button
                  @click="attachReceipt(transaction.id)"
                  class="text-gray-500 hover:text-gray-700 text-xs inline-flex items-center"
              >
                <Plus class="h-3 w-3 mr-1" />
                {{ t('transactions.add') }}
              </button>
            </div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm">
            <button
                @click="viewTransactionDetails(transaction.id)"
                class="text-primary-main hover:text-primary-dark mr-3"
            >
              {{ t('transactions.details') }}
            </button>
            <div class="relative inline-block text-left" v-click-outside="() => closeActionsMenu(transaction.id)">
              <button
                  @click="toggleActionsMenu(transaction.id)"
                  class="text-gray-500 hover:text-gray-700"
              >
                <MoreVertical class="h-5 w-5" />
              </button>

              <div
                  v-if="openMenuId === transaction.id"
                  class="origin-top-right absolute right-0 mt-2 w-48 rounded-xl shadow-lg bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 focus:outline-none z-10"
              >
                <div class="py-1">
                  <button
                      @click="openEditModal(transaction)"
                      class="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"
                  >
                    {{ t('transactions.edit') }}
                  </button>
                  <button
                      @click="updateTransactionStatus(transaction.id, 'completed')"
                      class="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"
                      v-if="transaction.status !== 'completed'"
                  >
                    {{ t('transactions.markCompleted') }}
                  </button>
                  <button
                      @click="updateTransactionStatus(transaction.id, 'cancelled')"
                      class="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"
                      v-if="transaction.status !== 'cancelled'"
                  >
                    {{ t('transactions.markCancelled') }}
                  </button>
                  <button
                      @click="deleteTransactionConfirm(transaction.id)"
                      class="block w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-white/10"
                  >
                    {{ t('transactions.confirmDelete') }}
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>
        </tbody>
      </table>

      <!-- Pagination -->
      <div v-if="filteredTransactions.length > 0" class="bg-white dark:bg-white/5 px-4 py-3 border-t border-gray-200 dark:border-white/10 sm:px-6">
        <div class="flex items-center justify-between">
          <div class="hidden sm:block">
            <p class="text-sm text-gray-700">
              {{ t('common.showing') }} <span class="font-medium">{{ paginationStart }}</span> {{ t('common.to') }} <span class="font-medium">{{ paginationEnd }}</span> {{ t('common.of') }} <span class="font-medium">{{ filteredTransactions.length }}</span> {{ t('transactionsList.transactions') }}
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
                      ? 'z-10 bg-primary-light border-primary-main text-primary-main'
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

    <!-- Create Transaction Modal -->
    <TransactionFormModal
      v-model="showCreateModal"
      @submit="handleCreateTransaction"
    />

    <!-- Edit Transaction Modal -->
    <TransactionFormModal
      v-model="showEditModal"
      :initialData="editingTransaction"
      :isEditing="true"
      @submit="handleEditTransaction"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useTransactions } from '~/composables/useTransactions'
import {
  Search,
  Filter,
  FileText,
  Upload,
  Plus,
  MoreVertical,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  Loader,
  Clock,
  AlertCircle,
  DollarSign,
  X
} from 'lucide-vue-next'

const { t } = useI18n()

// Use the transactions composable
const {
  transactions,
  isLoading,
  error,
  filteredTransactions,
  transactionStats,
  searchQuery,
  filters,
  fetchTransactions,
  createTransaction,
  deleteTransaction,
  updateTransactionStatus: updateStatus,
  formatDate,
  formatCurrency
} = useTransactions()

// Local state
const showAdvancedFilters = ref(false)
const showCreateModal = ref(false)
const showEditModal = ref(false)
const editingTransaction = ref<any>(null)
const currentPage = ref(1)
const itemsPerPage = ref(10)
const openMenuId = ref<string | null>(null)

// Router
const router = useRouter()

// Initialize data
onMounted(async () => {
  await fetchTransactions()
})

// Computed properties
const isFiltered = computed(() => {
  return (
      searchQuery.value !== '' ||
      filters.value.status ||
      filters.value.type ||
      filters.value.dateFrom ||
      filters.value.dateTo ||
      filters.value.minAmount ||
      filters.value.maxAmount ||
      filters.value.hasReceipt !== undefined
  )
})

// Paginated transactions
const paginatedTransactions = computed(() => {
  const startIdx = (currentPage.value - 1) * itemsPerPage.value
  const endIdx = startIdx + itemsPerPage.value
  return filteredTransactions.value.slice(startIdx, endIdx)
})

// Pagination calculations
const totalPages = computed(() => {
  return Math.ceil(filteredTransactions.value.length / itemsPerPage.value) || 1
})

const paginationStart = computed(() => {
  return (currentPage.value - 1) * itemsPerPage.value + 1
})

const paginationEnd = computed(() => {
  return Math.min(currentPage.value * itemsPerPage.value, filteredTransactions.value.length)
})

// Reset filters
const resetFilters = () => {
  filters.value = {}
  searchQuery.value = ''
  currentPage.value = 1
}

// Toggle actions menu
const toggleActionsMenu = (id: string) => {
  if (openMenuId.value === id) {
    openMenuId.value = null
  } else {
    openMenuId.value = id
  }
}

// Close actions menu
const closeActionsMenu = (id?: string) => {
  if (!id || openMenuId.value === id) {
    openMenuId.value = null
  }
}

// Action methods
const viewTransactionDetails = (id: string) => {
  router.push(`/transactions/${id}`)
}

const updateTransactionStatus = async (id: string, status: string) => {
  closeActionsMenu(id)
  await updateStatus(id, status)
}

const attachReceipt = (id: string) => {
  router.push({
    path: '/receipts/upload',
    query: { transactionId: id }
  })
}

const viewReceipt = (receipt: any) => {
  // In a real app, this would open a receipt viewer or download
  console.log('View receipt:', receipt)

  // Mock viewer
  if (receipt.url) {
    window.open(receipt.url, '_blank')
  } else {
    alert(`Receipt: ${receipt.filename} (${formatCurrency(receipt.amount)})`)
  }
}

const deleteTransactionConfirm = async (id: string) => {
  closeActionsMenu(id)
  if (confirm(t('transactions.deleteConfirm'))) {
    const success = await deleteTransaction(id)
    if (success) {
      await fetchTransactions()
    }
  }
}

// Handle create transaction
const handleCreateTransaction = async (formData: any) => {
  try {
    const result = await createTransaction(formData)
    if (result) {
      showCreateModal.value = false
      await fetchTransactions()
    }
  } catch (err) {
    console.error('Error in handleCreateTransaction:', err)
  }
}

// Open edit modal
const openEditModal = (transaction: any) => {
  closeActionsMenu(transaction.id)
  editingTransaction.value = {
    id: transaction._id || transaction.id,
    date: transaction.date ? new Date(transaction.date).toISOString().split('T')[0] : '',
    amount: transaction.amount,
    type: transaction.type || '支出',
    status: transaction.status || 'pending',
    accountCategoryId: transaction.accountCategoryId?._id || transaction.accountCategoryId || '',
    subAccountCategoryId: transaction.subAccountCategoryId?._id || transaction.subAccountCategoryId || '',
    taxCategoryId: transaction.taxCategoryId?._id || transaction.taxCategoryId || '',
    taxRate: transaction.taxRate,
    supplierId: transaction.supplierId?._id || transaction.supplierId || '',
    customerId: transaction.customerId?._id || transaction.customerId || '',
    transactionCategoryId: transaction.transactionCategoryId?._id || transaction.transactionCategoryId || '',
    companyInfo: transaction.companyInfo || '',
    invoiceNumber: transaction.invoiceNumber || '',
    receiptNumber: transaction.receiptNumber || '',
    productName: transaction.productName || '',
    productPrice: transaction.productPrice,
    janCode: transaction.janCode || '',
    notes: transaction.notes || '',
    referenceNumber: transaction.referenceNumber || ''
  }
  showEditModal.value = true
}

// Close edit modal
const closeEditModal = () => {
  showEditModal.value = false
  editingTransaction.value = null
}

// Handle edit transaction
const handleEditTransaction = async (formData: any) => {
  if (!editingTransaction.value?.id) return

  try {
    const response = await $fetch(`/api/transactions/${editingTransaction.value.id}`, {
      method: 'PUT',
      body: formData
    })
    if (response) {
      closeEditModal()
      await fetchTransactions()
    }
  } catch (err) {
    console.error('Failed to update transaction:', err)
    alert(t('transactions.updateFailed'))
  }
}

// Click outside directive
const vClickOutside = {
  mounted(el, binding) {
    el.clickOutsideEvent = (event) => {
      if (!(el === event.target || el.contains(event.target))) {
        binding.value(event)
      }
    }
    document.addEventListener('click', el.clickOutsideEvent)
  },
  unmounted(el) {
    document.removeEventListener('click', el.clickOutsideEvent)
  }
}
</script>