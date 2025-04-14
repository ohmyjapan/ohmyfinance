<template>
  <div class="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
    <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
      <!-- Background overlay -->
      <div class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" @click="$emit('close')"></div>

      <!-- Modal panel -->
      <div class="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-5xl sm:w-full">
        <div class="bg-white px-4 pt-5 pb-4 sm:p-6">
          <div class="sm:flex sm:items-start">
            <div class="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-purple-100 sm:mx-0 sm:h-10 sm:w-10">
              <LinkIcon class="h-6 w-6 text-purple-600" />
            </div>
            <div class="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
              <h3 class="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                Match Receipt with Transaction
              </h3>
              <div class="mt-2">
                <p class="text-sm text-gray-500">
                  Select a transaction to match with this receipt. The system will link the receipt to the transaction for future reference.
                </p>
              </div>
            </div>
          </div>

          <div class="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Left column - Receipt Details -->
            <div>
              <h4 class="text-sm font-medium text-gray-900 mb-3">Selected Receipt</h4>
              <div class="border border-gray-300 rounded-md mb-3">
                <div class="px-4 py-3 bg-gray-50 border-b border-gray-300 flex items-center">
                  <div class="h-10 w-10 flex-shrink-0 bg-white rounded border border-gray-200">
                    <div class="h-10 w-10 flex items-center justify-center text-gray-500">
                      <FileText size="20" />
                    </div>
                  </div>
                  <div class="ml-3 flex-1">
                    <div class="text-sm font-medium text-gray-900">{{ receipt.filename }}</div>
                    <div class="text-xs text-gray-500">
                      Uploaded {{ formatDate(receipt.uploadDate) }}
                    </div>
                  </div>
                </div>

                <div class="p-4">
                  <div class="bg-gray-50 border border-gray-200 rounded-md p-4">
                    <h4 class="text-sm font-medium text-gray-900 mb-3">Receipt Details</h4>
                    <div class="grid grid-cols-2 gap-4">
                      <div>
                        <p class="text-xs text-gray-500 mb-1">Merchant</p>
                        <p class="text-sm font-medium text-gray-900">
                          {{ receipt.merchant || 'Not detected' }}
                        </p>
                      </div>
                      <div>
                        <p class="text-xs text-gray-500 mb-1">Date</p>
                        <p class="text-sm font-medium text-gray-900">
                          {{ receipt.date ? formatDate(receipt.date) : 'Not detected' }}
                        </p>
                      </div>
                      <div>
                        <p class="text-xs text-gray-500 mb-1">Amount</p>
                        <p class="text-sm font-medium text-gray-900">
                          {{ receipt.amount ? formatCurrency(receipt.amount) : 'Not detected' }}
                        </p>
                      </div>
                      <div>
                        <p class="text-xs text-gray-500 mb-1">Status</p>
                        <p class="text-sm font-medium text-yellow-600">Unmatched</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Receipt preview placeholder -->
              <div class="border border-gray-300 rounded-md p-4 flex items-center justify-center bg-gray-50 h-64">
                <div class="text-center">
                  <FileText size="40" class="mx-auto text-gray-400 mb-2" />
                  <p class="text-sm text-gray-500">Receipt Preview</p>
                  <button class="mt-2 text-sm text-purple-600">View Full Size</button>
                </div>
              </div>
            </div>

            <!-- Right column - Transaction Selection -->
            <div>
              <div class="flex items-center justify-between mb-3">
                <h4 class="text-sm font-medium text-gray-900">Select Transaction</h4>
                <div class="relative">
                  <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search size="14" class="text-gray-400" />
                  </div>
                  <input
                      v-model="searchQuery"
                      type="text"
                      class="block w-full pl-10 pr-3 py-1 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-purple-500 focus:border-purple-500 sm:text-xs"
                      placeholder="Search transactions..."
                  />
                </div>
              </div>

              <div class="border border-gray-300 rounded-md h-96 overflow-y-auto">
                <div class="divide-y divide-gray-200">
                  <div
                      v-for="transaction in filteredTransactions"
                      :key="transaction.id"
                      class="p-3 hover:bg-gray-50 cursor-pointer"
                      :class="{ 'bg-purple-50 border-l-4 border-purple-500': selectedTransactionId === transaction.id }"
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
                        <div class="text-sm font-medium text-gray-900">
                          #{{ transaction.id }}
                        </div>
                        <div class="text-xs text-gray-500">
                          {{ transaction.type }} - {{ formatCurrency(transaction.amount) }}
                        </div>
                        <div class="text-xs text-gray-500">
                          {{ formatDate(transaction.date) }}
                        </div>
                      </div>
                      <div class="flex-shrink-0">
                        <StatusBadge :status="transaction.status" />
                      </div>
                    </div>

                    <!-- Matching confidence indicator (if amount matches) -->
                    <div v-if="receipt.amount && transaction.amount === receipt.amount"
                         class="mt-2 bg-green-50 border border-green-100 rounded p-2">
                      <div class="flex items-center">
                        <CheckCircle size="16" class="text-green-500 mr-1" />
                        <span class="text-xs text-green-700">
                          High match confidence - Amount matches
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- Empty state -->
                  <div v-if="filteredTransactions.length === 0" class="p-6 text-center">
                    <p class="text-gray-500 text-sm">No matching transactions found</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
          <button
              type="button"
              class="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-purple-600 text-base font-medium text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 sm:ml-3 sm:w-auto sm:text-sm"
              :disabled="!selectedTransactionId"
              @click="matchReceipt"
          >
            Confirm Match
          </button>
          <button
              type="button"
              class="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
              @click="$emit('close')"
          >
            Cancel
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

const props = defineProps({
  receipt: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['close', 'match'])

// State
const searchQuery = ref('')
const selectedTransactionId = ref(null)
const transactions = ref([])

// Fetch transactions
onMounted(async () => {
  // In a real app, you would fetch transactions from your API
  // For now, we'll use mock data

  // Mock data with some potentially matching transactions
  transactions.value = [
    {
      id: 'TRX-7845',
      type: 'Credit Card',
      amount: 1299.00, // Matches the receipt amount
      date: '2025-04-14T12:30:00Z',
      status: 'completed'
    },
    {
      id: 'TRX-7844',
      type: 'Payment Gateway',
      amount: 1350.00,
      date: '2025-04-14T10:15:00Z',
      status: 'pending'
    },
    {
      id: 'TRX-7843',
      type: 'Credit Card',
      amount: 189.99,
      date: '2025-04-14T09:45:00Z',
      status: 'completed'
    },
    {
      id: 'TRX-7842',
      type: 'Overseas Order',
      amount: 429.99, // Matches another receipt amount
      date: '2025-04-13T16:20:00Z',
      status: 'processing'
    },
    {
      id: 'TRX-7841',
      type: 'Credit Card',
      amount: 74.50,
      date: '2025-04-13T14:10:00Z',
      status: 'completed'
    }
  ]

  // Try to auto-select a transaction with matching amount
  if (props.receipt.amount) {
    const matchingTransaction = transactions.value.find(t => t.amount === props.receipt.amount)
    if (matchingTransaction) {
      selectedTransactionId.value = matchingTransaction.id
    }
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

// Format date
const formatDate = (isoDate: string) => {
  return new Date(isoDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

// Format currency
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount)
}

// Get transaction icon based on type
const getTransactionIcon = (type: string) => {
  switch (type.toLowerCase()) {
    case 'credit card':
      return CreditCard
    case 'overseas order':
      return Globe
    case 'payment gateway':
    default:
      return ShoppingCart
  }
}

// Get transaction icon background color
const getTransactionIconBg = (type: string) => {
  switch (type.toLowerCase()) {
    case 'credit card':
      return 'bg-purple-100'
    case 'overseas order':
      return 'bg-green-100'
    case 'payment gateway':
    default:
      return 'bg-blue-100'
  }
}

// Get transaction icon color
const getTransactionIconColor = (type: string) => {
  switch (type.toLowerCase()) {
    case 'credit card':
      return 'text-purple-600'
    case 'overseas order':
      return 'text-green-600'
    case 'payment gateway':
    default:
      return 'text-blue-600'
  }
}

// Match receipt with selected transaction
const matchReceipt = () => {
  if (selectedTransactionId.value) {
    emit('match', props.receipt.id, selectedTransactionId.value)
  }
}
</script>