<template>
  <div class="bg-white rounded-lg shadow overflow-hidden">
    <div class="p-6">
      <div class="flex flex-col md:flex-row md:justify-between md:items-center mb-6">
        <div>
          <h2 class="text-xl font-semibold text-gray-800">{{ transaction.id }}</h2>
          <p class="text-sm text-gray-500">
            Created on {{ formatDate(transaction.createdAt) }}
          </p>
        </div>
        <div class="mt-4 md:mt-0">
          <StatusBadge :status="transaction.status" />
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-b py-6 my-6">
        <div>
          <p class="text-sm font-medium text-gray-500 mb-1">Transaction Source</p>
          <div class="flex items-center">
            <CreditCard size="18" class="text-purple-600 mr-2" />
            <p class="text-base font-medium text-gray-800">{{ formatSource(transaction.source) }}</p>
          </div>
        </div>
        <div>
          <p class="text-sm font-medium text-gray-500 mb-1">Amount</p>
          <p class="text-base font-medium text-gray-800">
            {{ formatCurrency(transaction.amount, transaction.currency) }}
          </p>
        </div>
        <div>
          <p class="text-sm font-medium text-gray-500 mb-1">Transaction ID</p>
          <div class="flex items-center">
            <p class="text-base font-medium text-gray-800 mr-2">{{ transaction.reference }}</p>
            <button
                class="text-gray-400 hover:text-gray-600"
                @click="copyToClipboard(transaction.reference)"
            >
              <Clipboard size="14" />
            </button>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <p class="text-sm font-medium text-gray-500 mb-1">Customer</p>
          <p class="text-base font-medium text-gray-800">{{ transaction.customer.name }}</p>
          <p class="text-sm text-gray-600">{{ transaction.customer.email }}</p>
        </div>
        <div v-if="transaction.paymentMethod">
          <p class="text-sm font-medium text-gray-500 mb-1">Payment Method</p>
          <p class="text-base font-medium text-gray-800">
            {{ transaction.paymentMethod.type }} ending in {{ transaction.paymentMethod.last4 }}
          </p>
          <p class="text-sm text-gray-600">Expires {{ transaction.paymentMethod.expiryDate }}</p>
        </div>
        <div v-if="transaction.processor">
          <p class="text-sm font-medium text-gray-500 mb-1">Processed By</p>
          <p class="text-base font-medium text-gray-800">{{ transaction.processor.name }}</p>
          <p class="text-sm text-gray-600">Gateway ID: {{ transaction.processor.gatewayId }}</p>
        </div>
      </div>

      <!-- Optional Notes -->
      <div v-if="transaction.notes" class="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <p class="text-sm font-medium text-gray-500 mb-1">Notes</p>
        <p class="text-sm text-gray-800">{{ transaction.notes }}</p>
      </div>

      <!-- Edit / Action Buttons -->
      <div class="mt-6 flex flex-wrap gap-3 justify-end">
        <button
            @click="$emit('edit')"
            class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
        >
          <Edit2 size="16" class="mr-2" />
          Edit Transaction
        </button>
        <button
            @click="$emit('download-receipt')"
            class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            :disabled="!transaction.receipt"
        >
          <Download size="16" class="mr-2" />
          Download Receipt
        </button>
        <button
            @click="$emit('update-status')"
            class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
        >
          <RefreshCw size="16" class="mr-2" />
          Update Status
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineProps, defineEmits } from 'vue'
import {
  CreditCard,
  Clipboard,
  Edit2,
  Download,
  RefreshCw
} from 'lucide-vue-next'

const props = defineProps({
  transaction: {
    type: Object,
    required: true
  }
})

defineEmits(['edit', 'download-receipt', 'update-status'])

// Format date from ISO string
const formatDate = (isoDate: string) => {
  if (!isoDate) return ''

  const date = new Date(isoDate)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

// Format source type to be more readable
const formatSource = (source: string) => {
  if (!source) return ''

  const sources = {
    'credit_card': 'Credit Card',
    'payment_gateway': 'Payment Gateway',
    'overseas': 'Overseas Transaction',
    'manual': 'Manual Entry'
  }

  return sources[source] || source
}

// Format currency with proper symbol and decimals
const formatCurrency = (amount: number, currency = 'USD') => {
  if (!amount && amount !== 0) return ''

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency
  }).format(amount)
}

// Copy text to clipboard
const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text)
  // Could add a toast notification here
  alert(`Copied to clipboard: ${text}`)
}
</script>