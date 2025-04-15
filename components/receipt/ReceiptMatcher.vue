<template>
  <div class="bg-white rounded-lg shadow-sm">
    <div class="p-6">
      <div class="mb-6">
        <h2 class="text-lg font-medium text-gray-900 mb-2">Match Receipt with Transaction</h2>
        <p class="text-sm text-gray-600">
          Find and link transactions that correspond to this receipt. The system will suggest matches
          based on amount, date, and merchant information.
        </p>
      </div>

      <!-- Receipt Details Card -->
      <div class="mb-6 border border-gray-200 rounded-lg overflow-hidden">
        <div class="p-4 bg-gray-50 border-b border-gray-200">
          <div class="flex items-center">
            <div class="h-10 w-10 flex-shrink-0 bg-purple-100 rounded-full flex items-center justify-center">
              <FileText class="h-5 w-5 text-purple-600" />
            </div>
            <div class="ml-3">
              <h3 class="text-sm font-medium text-gray-900">Receipt Information</h3>
              <p class="text-xs text-gray-500">Uploaded {{ formatDate(receipt.uploadDate) }}</p>
            </div>
          </div>
        </div>

        <div class="p-4">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p class="text-xs text-gray-500 mb-1">Merchant</p>
              <p class="text-sm font-medium text-gray-900">{{ receipt.merchant || 'Not detected' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500 mb-1">Date</p>
              <p class="text-sm font-medium text-gray-900">{{ receipt.date ? formatDate(receipt.date) : 'Not detected' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500 mb-1">Amount</p>
              <p class="text-sm font-medium text-gray-900">{{ receipt.amount ? formatCurrency(receipt.amount) : 'Not detected' }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Search and Filter -->
      <div class="mb-6">
        <div class="flex flex-col sm:flex-row gap-3">
          <div class="relative flex-1">
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search class="h-4 w-4 text-gray-400" />
            </div>
            <input
                v-model="searchQuery"
                type="text"
                class="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                placeholder="Search by transaction ID, reference, or customer..."
            />
          </div>

          <div class="flex space-x-3">
            <div class="relative">
              <select
                  v-model="filters.dateRange"
                  class="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm rounded-md"
              >
                <option value="">All Dates</option>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
              </select>
            </div>

            <div class="relative">
              <select
                  v-model="filters.amountRange"
                  class="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm rounded-md"
              >
                <option value="">Any Amount</option>
                <option value="exact">Exact Match (±1%)</option>
                <option value="close">Close Match (±10%)</option>
                <option value="lower">Lower Than Receipt</option>
                <option value="higher">Higher Than Receipt</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Matching Transactions -->
      <div v-if="isLoading" class="flex justify-center items-center p-12">
        <Loader class="h-8 w-8 text-purple-600 animate-spin" />
        <span class="ml-2 text-gray-600">Finding matching transactions...</span>
      </div>

      <div v-else>
        <!-- Suggested Matches -->
        <div v-if="suggestedMatches.length > 0" class="mb-6">
          <h3 class="text-sm font-medium text-gray-700 mb-3">Suggested Matches</h3>

          <div class="border border-gray-200 rounded-lg overflow-hidden mb-6">
            <div class="divide-y divide-gray-200">
              <div
                  v-for="transaction in suggestedMatches"
                  :key="transaction.id"
                  class="p-4 hover:bg-gray-50"
                  :class="{'bg-purple-50 border-l-4 border-purple-500': selectedTransactionId === transaction.id}"
              >
                <div class="flex items-center justify-between cursor-pointer" @click="selectTransaction(transaction.id)">
                  <div class="flex items-center">
                    <div class="h-10 w-10 flex-shrink-0 rounded-full"
                         :class="getTransactionSourceClass(transaction.source)">
                      <div class="h-10 w-10 flex items-center justify-center"
                           :class="getTransactionSourceIconClass(transaction.source)">
                        <component :is="getTransactionSourceIcon(transaction.source)" size="20" />
                      </div>
                    </div>
                    <div class="ml-3">
                      <div class="text-sm font-medium text-gray-900">#{{ transaction.id }}</div>
                      <div class="text-xs text-gray-500">{{ formatDate(transaction.createdAt) }}</div>
                      <div class="text-xs text-gray-500">{{ transaction.reference }}</div>
                    </div>
                  </div>

                  <div class="flex flex-col items-end">
                    <div class="text-sm font-medium text-gray-900">{{ formatCurrency(transaction.amount) }}</div>
                    <StatusBadge :status="transaction.status" />
                    <div class="text-xs text-gray-500 mt-1">{{ transaction.customer?.name }}</div>
                  </div>
                </div>

                <!-- Match confidence indicator -->
                <div v-if="getMatchConfidence(transaction)" class="mt-2 bg-green-50 border border-green-100 rounded p-2">
                  <div class="flex items-center">
                    <CheckCircle size="16" class="text-green-500 mr-1" />
                    <span class="text-xs text-green-700">
                      {{ getMatchConfidence(transaction) }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Other Transactions -->
        <div v-if="filteredTransactions.length > 0">
          <h3 class="text-sm font-medium text-gray-700 mb-3">Other Transactions</h3>

          <div class="border border-gray-200 rounded-lg overflow-hidden">
            <div class="divide-y divide-gray-200">
              <div
                  v-for="transaction in paginatedTransactions"
                  :key="transaction.id"
                  class="p-4 hover:bg-gray-50"
                  :class="{'bg-purple-50 border-l-4 border-purple-500': selectedTransactionId === transaction.id}"
              >
                <div class="flex items-center justify-between cursor-pointer" @click="selectTransaction(transaction.id)">
                  <div class="flex items-center">
                    <div class="h-10 w-10 flex-shrink-0 rounded-full"
                         :class="getTransactionSourceClass(transaction.source)">
                      <div class="h-10 w-10 flex items-center justify-center"
                           :class="getTransactionSourceIconClass(transaction.source)">
                        <component :is="getTransactionSourceIcon(transaction.source)" size="20" />
                      </div>
                    </div>
                    <div class="ml-3">
                      <div class="text-sm font-medium text-gray-900">#{{ transaction.id }}</div>
                      <div class="text-xs text-gray-500">{{ formatDate(transaction.createdAt) }}</div>
                      <div class="text-xs text-gray-500">{{ transaction.reference }}</div>
                    </div>
                  </div>

                  <div class="flex flex-col items-end">
                    <div class="text-sm font-medium text-gray-900">{{ formatCurrency(transaction.amount) }}</div>
                    <StatusBadge :status="transaction.status" />
                    <div class="text-xs text-gray-500 mt-1">{{ transaction.customer?.name }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Pagination -->
          <div class="flex items-center justify-between mt-4">
            <div class="text-sm text-gray-700">
              Showing <span class="font-medium">{{ paginationStart }}</span> to
              <span class="font-medium">{{ paginationEnd }}</span> of
              <span class="font-medium">{{ filteredTransactions.length }}</span> transactions
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

        <!-- No Transactions Found -->
        <div v-if="suggestedMatches.length === 0 && filteredTransactions.length === 0" class="text-center py-12">
          <SearchX class="mx-auto h-12 w-12 text-gray-300" />
          <h3 class="mt-2 text-sm font-medium text-gray-900">No transactions found</h3>
          <p class="mt-1 text-sm text-gray-500">
            Try adjusting your filters or search query to find a matching transaction.
          </p>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="mt-8 flex justify-between">
        <button
            class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            @click="$emit('cancel')"
        >
          Cancel
        </button>
        <button
            class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            :disabled="!selectedTransactionId"
            @click="confirmMatch"
        >
          Link with Selected Transaction
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import {
  FileText,
  Search,
  CreditCard,
  Globe,
  ShoppingCart,
  CheckCircle,
  SearchX,
  ArrowLeft,
  ArrowRight,
  Loader
} from 'lucide-vue-next';
import { useTransactions } from '~/composables/useTransactions';

const props = defineProps({
  receipt: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['cancel', 'match']);

// State
const searchQuery = ref('');
const selectedTransactionId = ref<string | null>(null);
const isLoading = ref(false);
const currentPage = ref(1);
const itemsPerPage = ref(5);
const filters = ref({
  dateRange: '',
  amountRange: 'exact' // Default to exact match
});

// Get transactions from composable
const {
  transactions,
  fetchTransactions,
  formatDate,
  formatCurrency
} = useTransactions();

// Load transactions on mount
onMounted(async () => {
  isLoading.value = true;
  await fetchTransactions();
  isLoading.value = false;

  // Auto-select transaction with matching amount if available
  findExactMatch();
});

// Watch for filter changes to reset pagination
watch([searchQuery, filters], () => {
  currentPage.value = 1;
});

// Find an exact match based on amount
const findExactMatch = () => {
  if (!props.receipt.amount) return;

  const match = transactions.value.find(t => {
    return Math.abs(t.amount - props.receipt.amount) < 0.01 && !t.receipt;
  });

  if (match) {
    selectedTransactionId.value = match.id;
  }
};

// Calculate match confidence
const getMatchConfidence = (transaction) => {
  if (!props.receipt.amount) return null;

  // Check exact amount match
  const amountDiff = Math.abs(transaction.amount - props.receipt.amount);
  const percentDiff = amountDiff / props.receipt.amount * 100;

  if (percentDiff < 1) {
    return 'High match confidence - Amount matches exactly';
  } else if (percentDiff < 5) {
    return 'Good match confidence - Amount within 5%';
  } else if (percentDiff < 10) {
    return 'Possible match - Amount within 10%';
  }

  // Check date match if available
  if (props.receipt.date && transaction.createdAt) {
    const receiptDate = new Date(props.receipt.date).setHours(0, 0, 0, 0);
    const transactionDate = new Date(transaction.createdAt).setHours(0, 0, 0, 0);

    if (receiptDate === transactionDate) {
      return 'Possible match - Date matches';
    }
  }

  return null;
};

// Filter suggested matches
const suggestedMatches = computed(() => {
  if (!props.receipt.amount) return [];

  return transactions.value.filter(t => {
    // Skip transactions that already have receipts
    if (t.receipt) return false;

    // Check amount match within 5%
    const amountDiff = Math.abs(t.amount - props.receipt.amount);
    const percentDiff = amountDiff / props.receipt.amount * 100;

    return percentDiff < 5;
  });
});

// Filter transactions based on search and filters
const filteredTransactions = computed(() => {
  // Start with all transactions that don't have receipts
  let result = transactions.value.filter(t => !t.receipt);

  // Remove suggested matches
  result = result.filter(t => !suggestedMatches.value.some(s => s.id === t.id));

  // Apply search filter
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter(transaction =>
        transaction.id.toLowerCase().includes(query) ||
        transaction.reference.toLowerCase().includes(query) ||
        (transaction.customer?.name.toLowerCase().includes(query)) ||
        (transaction.customer?.email.toLowerCase().includes(query))
    );
  }

  // Apply date range filter
  if (filters.value.dateRange) {
    const today = new Date();
    let cutoffDate = new Date();

    if (filters.value.dateRange === 'today') {
      cutoffDate.setHours(0, 0, 0, 0);
    } else if (filters.value.dateRange === 'yesterday') {
      cutoffDate.setDate(today.getDate() - 1);
      cutoffDate.setHours(0, 0, 0, 0);
    } else if (filters.value.dateRange === 'week') {
      cutoffDate.setDate(today.getDate() - 7);
    } else if (filters.value.dateRange === 'month') {
      cutoffDate.setMonth(today.getMonth() - 1);
    }

    result = result.filter(transaction => new Date(transaction.createdAt) >= cutoffDate);
  }

  // Apply amount range filter
  if (filters.value.amountRange && props.receipt.amount) {
    const receiptAmount = props.receipt.amount;

    if (filters.value.amountRange === 'exact') {
      result = result.filter(t => Math.abs(t.amount - receiptAmount) / receiptAmount <= 0.01);
    } else if (filters.value.amountRange === 'close') {
      result = result.filter(t => Math.abs(t.amount - receiptAmount) / receiptAmount <= 0.1);
    } else if (filters.value.amountRange === 'lower') {
      result = result.filter(t => t.amount < receiptAmount);
    } else if (filters.value.amountRange === 'higher') {
      result = result.filter(t => t.amount > receiptAmount);
    }
  }

  return result;
});

// Paginated transactions
const paginatedTransactions = computed(() => {
  const startIdx = (currentPage.value - 1) * itemsPerPage.value;
  const endIdx = startIdx + itemsPerPage.value;
  return filteredTransactions.value.slice(startIdx, endIdx);
});

// Pagination calculations
const totalPages = computed(() => {
  return Math.ceil(filteredTransactions.value.length / itemsPerPage.value) || 1;
});

const paginationStart = computed(() => {
  return (currentPage.value - 1) * itemsPerPage.value + 1;
});

const paginationEnd = computed(() => {
  return Math.min(currentPage.value * itemsPerPage.value, filteredTransactions.value.length);
});

// Select a transaction
const selectTransaction = (id: string) => {
  selectedTransactionId.value = id;
};

// Confirm the match
const confirmMatch = () => {
  if (selectedTransactionId.value) {
    emit('match', props.receipt.id, selectedTransactionId.value);
  }
};

// Get transaction source icon
const getTransactionSourceIcon = (source: string) => {
  switch (source) {
    case 'credit_card':
      return CreditCard;
    case 'overseas':
      return Globe;
    case 'payment_gateway':
    default:
      return ShoppingCart;
  }
};

// Get transaction source background class
const getTransactionSourceClass = (source: string) => {
  switch (source) {
    case 'credit_card':
      return 'bg-purple-100';
    case 'overseas':
      return 'bg-green-100';
    case 'payment_gateway':
    default:
      return 'bg-blue-100';
  }
};

// Get transaction source icon color
const getTransactionSourceIconClass = (source: string) => {
  switch (source) {
    case 'credit_card':
      return 'text-purple-600';
    case 'overseas':
      return 'text-green-600';
    case 'payment_gateway':
    default:
      return 'text-blue-600';
  }
};
</script>