<template>
  <div>
    <header class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-800">Receipt Management</h1>
        <p class="text-gray-600">View, search, and manage receipt documents</p>
      </div>

      <div class="mt-4 md:mt-0 flex space-x-3">
        <button class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500">
          <FileText class="mr-2 h-4 w-4 text-gray-500" />
          Export CSV
        </button>
        <button
            class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            @click="router.push('/receipts/upload')"
        >
          <Upload class="mr-2 h-4 w-4" />
          Upload Receipt
        </button>
      </div>
    </header>

    <!-- Stats Cards -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
      <StatCard
          title="Total Receipts"
          value="247"
          change="+5.8%"
          trend="up"
          icon="FileText"
          color="purple"
      />

      <StatCard
          title="Matched Receipts"
          value="189"
          change="+8.2%"
          trend="up"
          icon="CheckCircle"
          color="green"
      />

      <StatCard
          title="Unmatched Receipts"
          value="58"
          change="-12.5%"
          trend="down"
          icon="AlertTriangle"
          color="amber"
      />

      <StatCard
          title="Match Rate"
          value="76.5%"
          change="+2.3%"
          trend="up"
          icon="BarChart2"
          color="blue"
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
                placeholder="Search by filename, amount, or merchant..."
            />
          </div>

          <div class="flex space-x-3">
            <div class="relative">
              <select
                  v-model="filters.status"
                  class="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm rounded-md"
              >
                <option value="">All Statuses</option>
                <option value="matched">Matched</option>
                <option value="unmatched">Unmatched</option>
              </select>
            </div>

            <div class="relative">
              <select
                  v-model="filters.type"
                  class="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm rounded-md"
              >
                <option value="">All Types</option>
                <option value="pdf">PDF</option>
                <option value="jpg">JPG/JPEG</option>
                <option value="png">PNG</option>
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
            <label class="block text-sm font-medium text-gray-700 mb-1">Upload Date Range</label>
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
            <label class="block text-sm font-medium text-gray-700 mb-1">Merchant</label>
            <input
                v-model="filters.merchant"
                type="text"
                placeholder="Merchant name"
                class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Receipts Table -->
    <div class="bg-white rounded-lg shadow-sm overflow-hidden">
      <div v-if="isLoading" class="flex justify-center items-center p-12">
        <Loader class="h-8 w-8 text-purple-600 animate-spin" />
        <span class="ml-2 text-gray-600">Loading receipts...</span>
      </div>

      <div v-else-if="filteredReceipts.length === 0" class="text-center py-16">
        <FileText class="mx-auto h-12 w-12 text-gray-300" />
        <h3 class="mt-2 text-sm font-medium text-gray-900">No receipts found</h3>
        <p class="mt-1 text-sm text-gray-500">
          {{ isFiltered ? 'Try adjusting your filters or search query.' : 'Get started by uploading a receipt.' }}
        </p>
        <div class="mt-6">
          <button
              class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
              @click="router.push('/receipts/upload')"
          >
            <Upload class="mr-2 h-4 w-4" />
            Upload Receipt
          </button>
        </div>
      </div>

      <table v-else class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
        <tr>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Receipt</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date Uploaded</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Merchant</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
        </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
        <tr
            v-for="receipt in paginatedReceipts"
            :key="receipt.id"
            class="hover:bg-gray-50"
        >
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="flex items-center">
              <div class="h-10 w-10 flex-shrink-0 bg-gray-100 rounded">
                <div class="h-10 w-10 flex items-center justify-center text-gray-500">
                  <FileIcon :filename="receipt.filename" />
                </div>
              </div>
              <div class="ml-4">
                <div class="text-sm font-medium text-gray-900">{{ receipt.filename }}</div>
                <div class="text-sm text-gray-500">{{ formatFileSize(receipt.size) }}</div>
              </div>
            </div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="text-sm text-gray-900">{{ formatDate(receipt.uploadDate) }}</div>
            <div class="text-sm text-gray-500">{{ formatTime(receipt.uploadDate) }}</div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="text-sm text-gray-900" v-if="receipt.amount">
              {{ formatCurrency(receipt.amount) }}
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
                Matched
              </span>
            <span v-else
                  class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">
                <AlertTriangle size="14" class="mr-1" />
                Unmatched
              </span>
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
            <button
                @click="viewReceiptDetails(receipt.id)"
                class="text-purple-600 hover:text-purple-900 mr-3"
            >
              View
            </button>
            <button
                v-if="receipt.status === 'unmatched'"
                @click="matchReceipt(receipt.id)"
                class="text-purple-600 hover:text-purple-900 mr-3"
            >
              Match
            </button>
            <button
                @click="confirmDelete(receipt.id)"
                class="text-red-600 hover:text-red-900"
            >
              Delete
            </button>
          </td>
        </tr>
        </tbody>
      </table>

      <!-- Pagination -->
      <div v-if="filteredReceipts.length > 0" class="bg-white px-4 py-3 border-t border-gray-200 sm:px-6">
        <div class="flex items-center justify-between">
          <div class="hidden sm:block">
            <p class="text-sm text-gray-700">
              Showing <span class="font-medium">{{ paginationStart }}</span> to <span class="font-medium">{{ paginationEnd }}</span> of <span class="font-medium">{{ filteredReceipts.length }}</span> receipts
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

    <!-- Confirm Delete Modal -->
    <div
        v-if="showDeleteConfirm"
        class="fixed inset-0 z-10 overflow-y-auto"
        aria-labelledby="modal-title"
        role="dialog"
        aria-modal="true"
    >
      <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div
            class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
            aria-hidden="true"
        ></div>

        <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

        <div class="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div class="sm:flex sm:items-start">
              <div class="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                <Trash2 class="h-6 w-6 text-red-600" />
              </div>
              <div class="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                <h3 class="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                  Delete Receipt
                </h3>
                <div class="mt-2">
                  <p class="text-sm text-gray-500">
                    Are you sure you want to delete this receipt? This action cannot be undone.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div class="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
                type="button"
                class="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm"
                @click="deleteReceipt"
            >
              Delete
            </button>
            <button
                type="button"
                class="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                @click="showDeleteConfirm = false"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, defineComponent, h } from 'vue'
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

// State
const receipts = ref([])
const searchQuery = ref('')
const isLoading = ref(true)
const currentPage = ref(1)
const itemsPerPage = ref(10)
const showAdvancedFilters = ref(false)
const showDeleteConfirm = ref(false)
const receiptToDelete = ref(null)
const filters = ref({
  status: '',
  type: '',
  dateFrom: '',
  dateTo: '',
  minAmount: '',
  maxAmount: '',
  merchant: ''
})

const router = useRouter()

// Load receipts data
onMounted(async () => {
  try {
    // In a real app, this would be an API call
    // await fetchReceipts()

    // For demo purposes, we'll use mock data
    await new Promise(resolve => setTimeout(resolve, 1000))
    receipts.value = generateMockReceipts(50)
  } finally {
    isLoading.value = false
  }
})

// Check if filters are applied
const isFiltered = computed(() => {
  return (
      searchQuery.value !== '' ||
      filters.value.status !== '' ||
      filters.value.type !== '' ||
      filters.value.dateFrom !== '' ||
      filters.value.dateTo !== '' ||
      filters.value.minAmount !== '' ||
      filters.value.maxAmount !== '' ||
      filters.value.merchant !== ''
  )
})

// Filter receipts based on search and filters
const filteredReceipts = computed(() => {
  let result = [...receipts.value]

  // Apply search filter
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(receipt =>
        receipt.filename.toLowerCase().includes(query) ||
        (receipt.merchant && receipt.merchant.toLowerCase().includes(query)) ||
        (receipt.amount && receipt.amount.toString().includes(query))
    )
  }

  // Apply status filter
  if (filters.value.status) {
    result = result.filter(receipt => receipt.status === filters.value.status)
  }

  // Apply file type filter
  if (filters.value.type) {
    result = result.filter(receipt => {
      const extension = receipt.filename.split('.').pop().toLowerCase()
      return extension === filters.value.type ||
          (filters.value.type === 'jpg' && (extension === 'jpeg' || extension === 'jpg'))
    })
  }

  // Apply date range filter
  if (filters.value.dateFrom) {
    const fromDate = new Date(filters.value.dateFrom)
    result = result.filter(receipt => new Date(receipt.uploadDate) >= fromDate)
  }

  if (filters.value.dateTo) {
    const toDate = new Date(filters.value.dateTo)
    toDate.setHours(23, 59, 59, 999) // End of the day
    result = result.filter(receipt => new Date(receipt.uploadDate) <= toDate)
  }

  // Apply amount filter
  if (filters.value.minAmount !== '') {
    const min = parseFloat(filters.value.minAmount)
    result = result.filter(receipt => receipt.amount && receipt.amount >= min)
  }

  if (filters.value.maxAmount !== '') {
    const max = parseFloat(filters.value.maxAmount)
    result = result.filter(receipt => receipt.amount && receipt.amount <= max)
  }

  // Apply merchant filter
  if (filters.value.merchant) {
    const merchant = filters.value.merchant.toLowerCase()
    result = result.filter(receipt =>
        receipt.merchant && receipt.merchant.toLowerCase().includes(merchant)
    )
  }

  return result
})

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

// Reset filters
const resetFilters = () => {
  searchQuery.value = ''
  filters.value = {
    status: '',
    type: '',
    dateFrom: '',
    dateTo: '',
    minAmount: '',
    maxAmount: '',
    merchant: ''
  }
  currentPage.value = 1
}

// Format helpers
const formatDate = (isoDate: string) => {
  return new Date(isoDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

const formatTime = (isoDate: string) => {
  return new Date(isoDate).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
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

// Action handlers
const viewReceiptDetails = (id: string) => {
  // Navigate to receipt details
  console.log('View receipt:', id)
  // router.push(`/receipts/${id}`)
}

const matchReceipt = (id: string) => {
  // Navigate to receipt matching screen
  console.log('Match receipt:', id)
  router.push({
    path: '/receipts/upload',
    query: { action: 'match', id }
  })
}

const confirmDelete = (id: string) => {
  receiptToDelete.value = id
  showDeleteConfirm.value = true
}

const deleteReceipt = () => {
  if (!receiptToDelete.value) return

  // Delete receipt (in a real app, this would be an API call)
  console.log('Deleting receipt:', receiptToDelete.value)

  // Remove from local state
  const index = receipts.value.findIndex(r => r.id === receiptToDelete.value)
  if (index !== -1) {
    receipts.value.splice(index, 1)
  }

  // Close modal
  showDeleteConfirm.value = false
  receiptToDelete.value = null
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

// Generate mock receipts for demo
const generateMockReceipts = (count: number) => {
  const merchants = [
    'Tech Gadgets Inc.',
    'Office Supplies Co.',
    'Global Imports Ltd.',
    'ElectroMart',
    'FoodMart',
    'Travel Agency',
    'Auto Parts Store',
    'Hardware Depot'
  ]

  const fileTypes = [
    'pdf',
    'jpg',
    'png',
    'pdf'  // PDF more common
  ]

  const receipts = []

  // Current date for reference
  const now = new Date()

  for (let i = 0; i < count; i++) {
    // Create random dates within last 60 days
    const uploadDate = new Date(now.getTime())
    uploadDate.setDate(now.getDate() - Math.floor(Math.random() * 60))

    // Random amount (sometimes null to simulate unprocessed receipts)
    const hasAmount = Math.random() > 0.2
    const amount = hasAmount ? Math.round(Math.random() * 1000 * 100) / 100 : null

    // Random merchant (sometimes null)
    const hasMerchant = Math.random() > 0.3
    const merchant = hasMerchant ? merchants[Math.floor(Math.random() * merchants.length)] : null

    // Random file type
    const fileType = fileTypes[Math.floor(Math.random() * fileTypes.length)]

    // Random status (more matched than unmatched)
    const status = Math.random() > 0.3 ? 'matched' : 'unmatched'

    // Random file size between 100KB and 5MB
    const size = Math.floor(Math.random() * 5000000) + 100000

    // Create receipt
    receipts.push({
      id: `receipt_${4000 + i}`,
      filename: `receipt_${4000 + i}.${fileType}`,
      size,
      uploadDate: uploadDate.toISOString(),
      amount,
      merchant,
      status,
      transactionId: status === 'matched' ? `TRX-${7000 + i}` : null
    })
  }

  return receipts
}
</script>