<template>
  <div>
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-gray-800">Receipt Management</h1>
      <p class="text-gray-600">Upload and match receipt documents with transactions</p>
    </header>

    <!-- Upload Section -->
    <div class="bg-white rounded-lg shadow-sm mb-6">
      <div class="p-6">
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Left: Upload Zone -->
          <div class="lg:col-span-1">
            <FileUploader @files-selected="handleFilesSelected" />
          </div>

          <!-- Right: Instructions -->
          <div class="lg:col-span-2">
            <h3 class="text-lg font-medium text-gray-900 mb-4">Receipt Processing</h3>
            <p class="text-sm text-gray-600 mb-4">
              Upload physical or digital receipts to match with your transaction records. Our system will automatically
              extract relevant information and match receipts with corresponding transactions.
            </p>

            <div class="bg-blue-50 border border-blue-100 rounded-md p-4 mb-4">
              <h4 class="text-sm font-medium text-blue-800 mb-2">Tips for better matching</h4>
              <ul class="text-sm text-blue-700 space-y-2">
                <li class="flex items-start">
                  <CheckCircle size="16" class="text-blue-600 mr-2 mt-0.5 flex-shrink-0" />
                  <span>Ensure receipt images are clear and well-lit</span>
                </li>
                <li class="flex items-start">
                  <CheckCircle size="16" class="text-blue-600 mr-2 mt-0.5 flex-shrink-0" />
                  <span>Make sure transaction amount is clearly visible</span>
                </li>
                <li class="flex items-start">
                  <CheckCircle size="16" class="text-blue-600 mr-2 mt-0.5 flex-shrink-0" />
                  <span>Include transaction date and merchant information where possible</span>
                </li>
              </ul>
            </div>

            <div class="grid grid-cols-3 gap-4 text-center">
              <div class="bg-gray-50 p-4 rounded-md">
                <div class="text-purple-600 font-semibold text-2xl mb-1">{{ receiptStats.total }}</div>
                <div class="text-xs text-gray-500">Total Receipts</div>
              </div>
              <div class="bg-gray-50 p-4 rounded-md">
                <div class="text-green-600 font-semibold text-2xl mb-1">{{ receiptStats.matched }}</div>
                <div class="text-xs text-gray-500">Matched</div>
              </div>
              <div class="bg-gray-50 p-4 rounded-md">
                <div class="text-yellow-600 font-semibold text-2xl mb-1">{{ receiptStats.unmatched }}</div>
                <div class="text-xs text-gray-500">Unmatched</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Recent Uploads Table -->
    <div class="bg-white rounded-lg shadow-sm mb-6">
      <div class="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 class="text-lg font-medium text-gray-800">Recently Uploaded Receipts</h2>
        <div class="flex space-x-3">
          <div class="relative">
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search size="16" class="text-gray-400" />
            </div>
            <input
                v-model="searchQuery"
                type="text"
                class="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                placeholder="Search receipts..."
            />
          </div>
          <button
              class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
              @click="isFilterOpen = !isFilterOpen"
          >
            <Filter size="16" class="mr-2 text-gray-500" />
            Filters
          </button>
        </div>
      </div>

      <!-- Filters (conditionally displayed) -->
      <div v-if="isFilterOpen" class="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label for="status-filter" class="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
                id="status-filter"
                v-model="filters.status"
                class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
            >
              <option value="">All Statuses</option>
              <option value="matched">Matched</option>
              <option value="unmatched">Unmatched</option>
            </select>
          </div>
          <div>
            <label for="date-filter" class="block text-sm font-medium text-gray-700 mb-1">Date Range</label>
            <select
                id="date-filter"
                v-model="filters.dateRange"
                class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
            >
              <option value="">All Time</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
            </select>
          </div>
          <div class="flex items-end">
            <button
                class="inline-flex items-center px-4 py-2 border border-gray-300 bg-white rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                @click="resetFilters"
            >
              Reset Filters
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
          Showing <span class="font-medium">{{ paginationStart }}</span> to <span class="font-medium">{{ paginationEnd }}</span> of <span class="font-medium">{{ receiptStats.total }}</span> receipts
        </div>
        <div class="flex space-x-1">
          <button
              class="inline-flex items-center px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="currentPage === 1"
              @click="currentPage--"
          >
            <ArrowLeft size="16" class="mr-1" />
            Previous
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
            Next
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

// State
const receipts = ref([])
const searchQuery = ref('')
const isFilterOpen = ref(false)
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
  total: 247,
  matched: 189,
  unmatched: 58
})

// Load receipts (mock data for now)
onMounted(async () => {
  // In a real app, this would be an API call
  // await loadReceipts()

  // Mock data
  receipts.value = [
    {
      id: 'receipt_4392',
      filename: 'receipt_4392.pdf',
      size: 438272, // 428 KB
      uploadDate: '2025-04-14T10:32:00Z',
      amount: 189.99,
      merchant: 'Tech Gadgets Inc.',
      status: 'matched',
      transactionId: 'TRX-7843'
    },
    {
      id: 'receipt_4391',
      filename: 'receipt_4391.jpg',
      size: 1258291, // 1.2 MB
      uploadDate: '2025-04-14T09:45:00Z',
      amount: 1299.00,
      merchant: 'ElectroMart',
      status: 'unmatched',
      transactionId: null
    },
    {
      id: 'receipt_4390',
      filename: 'receipt_4390.pdf',
      size: 357376, // 349 KB
      uploadDate: '2025-04-13T17:18:00Z',
      amount: 74.50,
      merchant: 'Office Supplies Co.',
      status: 'matched',
      transactionId: 'TRX-7830'
    },
    {
      id: 'receipt_4389',
      filename: 'receipt_4389.png',
      size: 865280, // 845 KB
      uploadDate: '2025-04-13T14:30:00Z',
      amount: 429.99,
      merchant: 'Global Imports Ltd.',
      status: 'unmatched',
      transactionId: null
    }
  ]
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

// File selection handler
const handleFilesSelected = (files) => {
  // Here you would upload the files to your server
  console.log('Files selected:', files)

  // Mock successful upload
  const newReceipt = {
    id: `receipt_${Date.now()}`,
    filename: files[0].name,
    size: files[0].size,
    uploadDate: new Date().toISOString(),
    amount: null, // Would be extracted from receipt
    merchant: null, // Would be extracted from receipt
    status: 'unmatched',
    transactionId: null
  }

  // Add to beginning of list
  receipts.value.unshift(newReceipt)

  // Update stats
  receiptStats.value.total++
  receiptStats.value.unmatched++
}

// View receipt details
const viewReceipt = (receiptId) => {
  // Navigate to receipt details page
  console.log('View receipt:', receiptId)
}

// Open match dialog
const openMatchDialog = (receiptId) => {
  const receipt = receipts.value.find(r => r.id === receiptId)
  if (receipt) {
    selectedReceipt.value = receipt
    showMatchDialog.value = true
  }
}

// Match receipt with transaction
const matchReceipt = (receiptId, transactionId) => {
  // In a real app, this would be an API call
  console.log('Matching receipt', receiptId, 'with transaction', transactionId)

  // Update receipt status
  const receipt = receipts.value.find(r => r.id === receiptId)
  if (receipt) {
    receipt.status = 'matched'
    receipt.transactionId = transactionId

    // Update stats
    receiptStats.value.matched++
    receiptStats.value.unmatched--
  }

  // Close dialog
  showMatchDialog.value = false
}

// Delete receipt
const deleteReceipt = (receiptId) => {
  // In a real app, this would be an API call with confirmation

  const receiptIndex = receipts.value.findIndex(r => r.id === receiptId)
  if (receiptIndex !== -1) {
    const receipt = receipts.value[receiptIndex]

    // Update stats
    receiptStats.value.total--
    if (receipt.status === 'matched') {
      receiptStats.value.matched--
    } else {
      receiptStats.value.unmatched--
    }

    // Remove from array
    receipts.value.splice(receiptIndex, 1)
  }
}
</script>