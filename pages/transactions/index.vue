<template>
  <div>
    <header class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-800">Transactions</h1>
        <p class="text-gray-600">View and manage transaction records</p>
      </div>

      <div class="mt-4 md:mt-0 flex space-x-3">
        <button class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500">
          <FileText class="mr-2 h-4 w-4 text-gray-500" />
          Export CSV
        </button>
        <button
            class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            @click="router.push('/transactions/upload')"
        >
          <Upload class="mr-2 h-4 w-4" />
          Import Transactions
        </button>
      </div>
    </header>

    <!-- Stats Cards -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
      <StatCard
          title="Total Transactions"
          :value="formatCurrency(transactionStats.total.amount)"
          :change="+8.2"
          trend="up"
          icon="CreditCard"
          color="purple"
      />

      <StatCard
          title="Avg Order Value"
          :value="formatCurrency(transactionStats.avgOrderValue)"
          :change="+3.4"
          trend="up"
          icon="DollarSign"
          color="blue"
      />

      <StatCard
          title="Pending Transactions"
          :value="transactionStats.pending.count.toString()"
          :change="+12.3"
          trend="up"
          icon="Clock"
          color="amber"
      />

      <StatCard
          title="Failed Transactions"
          :value="transactionStats.failed.count.toString()"
          :change="-5.2"
          trend="down"
          icon="AlertCircle"
          color="red"
      />
    </div>

    <!-- Filter & Search Bar -->
    <div class="bg-white rounded-lg shadow-sm mb-6">
      <div class="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div class="flex flex-1 flex-col sm:flex-row gap-3">
          <div class="relative flex-1">
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search class="h-5 w-5 text-gray-400" />
            </div>
            <input
                v-model="searchQuery"
                type="text"
                class="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                placeholder="Search by ID, reference, or customer..."
            />
          </div>

          <div class="flex space-x-3">
            <div class="relative">
              <select
                  v-model="filters.status"
                  class="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm rounded-md"
              >
                <option value="">All Statuses</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="failed">Failed</option>
                <option value="refunded">Refunded</option>
              </select>
            </div>

            <div class="relative">
              <select
                  v-model="filters.source"
                  class="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm rounded-md"
              >
                <option value="">All Sources</option>
                <option value="credit_card">Credit Card</option>
                <option value="payment_gateway">Payment Gateway</option>
                <option value="overseas">Overseas</option>
                <option value="manual">Manual</option>
              </select>
            </div>
          </div>
        </div>

        <div class="flex items-center">
          <button
              class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
              @click="showAdvancedFilters = !showAdvancedFilters"
          >
            <Filter class="mr-2 h-4 w-4 text-gray-500" />
            {{ showAdvancedFilters ? 'Hide Filters' : 'Advanced Filters' }}
          </button>

          <button
              v-if="isFiltered"
              class="ml-3 text-sm text-purple-600 hover:text-purple-500"
              @click="resetFilters"
          >
            Clear Filters
          </button>
        </div>
      </div>

      <!-- Advanced Filters (conditional) -->
      <div v-if="showAdvancedFilters" class="px-4 py-3 border-t border-gray-200 bg-gray-50">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Date Range</label>
            <div class="flex space-x-2">
              <input
                  v-model="filters.dateFrom"
                  type="date"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
              />
              <input
                  v-model="filters.dateTo"
                  type="date"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Amount Range</label>
            <div class="flex space-x-2">
              <input
                  v-model="filters.minAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Min"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
              />
              <input
                  v-model="filters.maxAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Max"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Additional Filters</label>
            <div class="flex space-x-4">
              <label class="inline-flex items-center">
                <input
                    v-model="filters.hasReceipt"
                    type="checkbox"
                    class="rounded border-gray-300 text-purple-600 shadow-sm focus:border-purple-300 focus:ring focus:ring-purple-200 focus:ring-opacity-50"
                />
                <span class="ml-2 text-sm text-gray-700">Has Receipt</span>
              </label>
              <label class="inline-flex items-center">
                <input
                    v-model="filters.hasShipment"
                    type="checkbox"
                    class="rounded border-gray-300 text-purple-600 shadow-sm focus:border-purple-300 focus:ring focus:ring-purple-200 focus:ring-opacity-50"
                />
                <span class="ml-2 text-sm text-gray-700">Has Shipment</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Transactions Table -->
    <div class="bg-white rounded-lg shadow-sm overflow-hidden">
      <div v-if="isLoading" class="flex justify-center items-center p-12">
        <Loader class="h-8 w-8 text-purple-600 animate-spin" />
        <span class="ml-2 text-gray-600">Loading transactions...</span>
      </div>

      <div v-else-if="filteredTransactions.length === 0" class="text-center py-16">
        <CreditCard class="mx-auto h-12 w-12 text-gray-300" />
        <h3 class="mt-2 text-sm font-medium text-gray-900">No transactions found</h3>
        <p class="mt-1 text-sm text-gray-500">
          {{ isFiltered ? 'Try adjusting your filters or search query.' : 'Get started by adding a transaction.' }}
        </p>
        <div class="mt-6">
          <button
              class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
              @click="router.push('/transactions/upload')"
          >
            <Upload class="mr-2 h-4 w-4" />
            Import Transactions
          </button>
        </div>
      </div>

      <table v-else class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
        <tr>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID/Date</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Receipt</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
        </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
        <tr
            v-for="transaction in paginatedTransactions"
            :key="transaction.id"
            class="hover:bg-gray-50"
        >
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="text-sm font-medium text-gray-900">{{ transaction.id }}</div>
            <div class="text-xs text-gray-500">{{ formatDate(transaction.createdAt) }}</div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="text-sm text-gray-900">{{ transaction.customer.name }}</div>
            <div class="text-xs text-gray-500">{{ transaction.customer.email }}</div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="text-sm text-gray-900">{{ formatSource(transaction.source) }}</div>
            <div class="text-xs text-gray-500">{{ transaction.reference }}</div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="text-sm font-medium text-gray-900">
              {{ formatCurrency(transaction.amount, transaction.currency) }}
            </div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <StatusBadge :status="transaction.status" />
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <div v-if="transaction.receipt" class="text-sm">
              <button
                  @click="viewReceipt(transaction.receipt)"
                  class="text-purple-600 hover:text-purple-900 inline-flex items-center"
              >
                <FileText class="h-4 w-4 mr-1" />
                View
              </button>
            </div>
            <div v-else>
              <button
                  @click="attachReceipt(transaction.id)"
                  class="text-gray-500 hover:text-gray-700 text-xs inline-flex items-center"
              >
                <Plus class="h-3 w-3 mr-1" />
                Add
              </button>
            </div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm">
            <button
                @click="viewTransactionDetails(transaction.id)"
                class="text-purple-600 hover:text-purple-900 mr-3"
            >
              View
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
                  class="origin-top-right absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-10"
              >
                <div class="py-1">
                  <button
                      @click="updateTransactionStatus(transaction.id, 'completed')"
                      class="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      v-if="transaction.status !== 'completed'"
                  >
                    Mark as Completed
                  </button>
                  <button
                      @click="updateTransactionStatus(transaction.id, 'failed')"
                      class="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      v-if="transaction.status !== 'failed'"
                  >
                    Mark as Failed
                  </button>
                  <button
                      @click="updateTransactionStatus(transaction.id, 'refunded')"
                      class="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      v-if="transaction.status === 'completed'"
                  >
                    Mark as Refunded
                  </button>
                  <button
                      @click="addShipment(transaction.id)"
                      class="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    {{ transaction.shipment ? 'Update Shipment' : 'Add Shipment' }}
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>
        </tbody>
      </table>

      <!-- Pagination -->
      <div v-if="filteredTransactions.length > 0" class="bg-white px-4 py-3 border-t border-gray-200 sm:px-6">
        <div class="flex items-center justify-between">
          <div class="hidden sm:block">
            <p class="text-sm text-gray-700">
              Showing <span class="font-medium">{{ paginationStart }}</span> to <span class="font-medium">{{ paginationEnd }}</span> of <span class="font-medium">{{ filteredTransactions.length }}</span> transactions
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
                      ? 'z-10 bg-purple-50 border-purple-500 text-purple-600'
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
  DollarSign
} from 'lucide-vue-next'

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
  updateTransactionStatus: updateStatus,
  formatDate,
  formatCurrency
} = useTransactions()

// Local state
const showAdvancedFilters = ref(false)
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
      filters.value.status !== '' ||
      filters.value.source !== '' ||
      filters.value.dateFrom !== '' ||
      filters.value.dateTo !== '' ||
      filters.value.minAmount !== '' ||
      filters.value.maxAmount !== '' ||
      filters.value.hasReceipt !== undefined ||
      filters.value.hasShipment !== undefined
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

// Format transaction source
const formatSource = (source: string) => {
  const mapping = {
    credit_card: 'Credit Card',
    payment_gateway: 'Payment Gateway',
    overseas: 'Overseas',
    manual: 'Manual Entry',
    other: 'Other'
  }

  return mapping[source] || source
}

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

const addShipment = (id: string) => {
  closeActionsMenu(id)
  router.push({
    path: '/shipments',
    query: { transactionId: id }
  })
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