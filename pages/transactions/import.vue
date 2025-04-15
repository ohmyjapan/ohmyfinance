<!-- pages/transactions/import.vue -->
<template>
  <div>
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-gray-800">Transaction Data Import</h1>
      <p class="text-gray-600">Import transaction data from various sources</p>
    </header>

    <!-- Info Cards -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <div class="bg-white rounded-lg shadow-sm p-5 border-l-4 border-purple-500">
        <h3 class="font-medium text-gray-900 mb-2 flex items-center">
          <CreditCard class="h-5 w-5 text-purple-500 mr-2" />
          Credit Card Files
        </h3>
        <p class="text-sm text-gray-600">
          Import transaction data from credit card providers. Supports standard formats from major providers.
        </p>
        <div class="mt-3">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
            CSV
          </span>
          <span class="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
            Excel
          </span>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow-sm p-5 border-l-4 border-blue-500">
        <h3 class="font-medium text-gray-900 mb-2 flex items-center">
          <ShoppingCart class="h-5 w-5 text-blue-500 mr-2" />
          Payment Gateway
        </h3>
        <p class="text-sm text-gray-600">
          Import data from payment gateway systems such as Stripe, PayPal, and Square.
        </p>
        <div class="mt-3">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            CSV
          </span>
          <span class="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            Excel
          </span>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow-sm p-5 border-l-4 border-green-500">
        <h3 class="font-medium text-gray-900 mb-2 flex items-center">
          <Globe class="h-5 w-5 text-green-500 mr-2" />
          Overseas Orders
        </h3>
        <p class="text-sm text-gray-600">
          Import transaction data from international markets and overseas operations.
        </p>
        <div class="mt-3">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            CSV
          </span>
          <span class="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            Excel
          </span>
        </div>
      </div>
    </div>

    <!-- Recent Imports Table -->
    <div class="bg-white rounded-lg shadow-sm mb-8">
      <div class="px-6 py-4 border-b flex items-center justify-between">
        <h2 class="text-lg font-medium text-gray-800">Recent Imports</h2>
        <div class="text-sm text-gray-500">Showing last 5 imports</div>
      </div>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
          <tr>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Date
            </th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Source
            </th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Files
            </th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Records
            </th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              User
            </th>
          </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
          <tr v-for="(import_, index) in recentImports" :key="index" class="hover:bg-gray-50">
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm font-medium text-gray-900">{{ formatDate(import_.date) }}</div>
              <div class="text-xs text-gray-500">{{ formatTime(import_.date) }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="flex items-center">
                <div
                    class="flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center"
                    :class="getSourceClass(import_.source)"
                >
                  <component :is="getSourceIcon(import_.source)" class="h-4 w-4" />
                </div>
                <div class="ml-3">
                  <div class="text-sm font-medium text-gray-900">{{ getSourceName(import_.source) }}</div>
                </div>
              </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm text-gray-900">{{ import_.files }} files</div>
              <div class="text-xs text-gray-500">{{ getFileTypes(import_) }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm text-gray-900">{{ import_.records }} records</div>
              <div class="text-xs text-gray-500">
                {{ import_.imported }} imported, {{ import_.skipped }} skipped
              </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span
                    class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full"
                    :class="getStatusClass(import_.status)"
                >
                  {{ import_.status }}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
              {{ import_.user }}
            </td>
          </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- File Uploader Component -->
    <TransactionFileUploader />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { CreditCard, ShoppingCart, Globe, Check, Clock, AlertCircle } from 'lucide-vue-next'

// Import our custom component
import TransactionFileUploader from '~/components/transaction/TransactionFileUploader.vue'

// Mock data for recent imports
const recentImports = ref([
  {
    date: '2025-04-15T09:30:00Z',
    source: 'credit_card',
    files: 2,
    fileTypes: ['csv', 'xlsx'],
    records: 156,
    imported: 152,
    skipped: 4,
    status: 'Completed',
    user: 'Admin'
  },
  {
    date: '2025-04-14T16:45:00Z',
    source: 'payment_gateway',
    files: 1,
    fileTypes: ['csv'],
    records: 89,
    imported: 89,
    skipped: 0,
    status: 'Completed',
    user: 'Admin'
  },
  {
    date: '2025-04-12T11:20:00Z',
    source: 'overseas',
    files: 3,
    fileTypes: ['xlsx'],
    records: 246,
    imported: 240,
    skipped: 6,
    status: 'Completed',
    user: 'Admin'
  },
  {
    date: '2025-04-10T14:15:00Z',
    source: 'credit_card',
    files: 1,
    fileTypes: ['csv'],
    records: 78,
    imported: 73,
    skipped: 5,
    status: 'Completed',
    user: 'Admin'
  },
  {
    date: '2025-04-09T10:45:00Z',
    source: 'payment_gateway',
    files: 1,
    fileTypes: ['xlsx'],
    records: 112,
    imported: 107,
    skipped: 5,
    status: 'Completed',
    user: 'Admin'
  }
])

// Helper functions
const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

const formatTime = (dateStr: string) => {
  const date = new Date(dateStr)
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

const getFileTypes = (import_: any) => {
  return import_.fileTypes.map((type: string) => type.toUpperCase()).join(', ')
}

const getSourceName = (source: string) => {
  switch (source) {
    case 'credit_card':
      return 'Credit Card'
    case 'payment_gateway':
      return 'Payment Gateway'
    case 'overseas':
      return 'Overseas Orders'
    default:
      return source
  }
}

const getSourceIcon = (source: string) => {
  switch (source) {
    case 'credit_card':
      return CreditCard
    case 'payment_gateway':
      return ShoppingCart
    case 'overseas':
      return Globe
    default:
      return CreditCard
  }
}

const getSourceClass = (source: string) => {
  switch (source) {
    case 'credit_card':
      return 'bg-purple-100 text-purple-600'
    case 'payment_gateway':
      return 'bg-blue-100 text-blue-600'
    case 'overseas':
      return 'bg-green-100 text-green-600'
    default:
      return 'bg-gray-100 text-gray-600'
  }
}

const getStatusClass = (status: string) => {
  switch (status.toLowerCase()) {
    case 'completed':
      return 'bg-green-100 text-green-800'
    case 'in_progress':
    case 'processing':
      return 'bg-blue-100 text-blue-800'
    case 'failed':
      return 'bg-red-100 text-red-800'
    case 'pending':
      return 'bg-yellow-100 text-yellow-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}
</script>