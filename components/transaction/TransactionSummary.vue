<template>
  <div class="bg-white rounded-lg shadow overflow-hidden">
    <div class="p-6">
      <div class="flex flex-col md:flex-row md:justify-between md:items-center mb-4">
        <div>
          <h2 class="text-xl font-semibold text-gray-800">#{{ transaction.id }}</h2>
          <p class="text-sm text-gray-500">
            Created on {{ formatDate(transaction.createdAt) }} at {{ formatTime(transaction.createdAt) }}
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
            <p class="text-base font-medium text-gray-800">{{ transaction.source }}</p>
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
        <div>
          <p class="text-sm font-medium text-gray-500 mb-1">Payment Method</p>
          <p class="text-base font-medium text-gray-800">
            {{ transaction.paymentMethod.type }} ending in {{ transaction.paymentMethod.last4 }}
          </p>
          <p class="text-sm text-gray-600">Expires {{ transaction.paymentMethod.expiryDate }}</p>
        </div>
        <div>
          <p class="text-sm font-medium text-gray-500 mb-1">Processed By</p>
          <p class="text-base font-medium text-gray-800">{{ transaction.processor.name }}</p>
          <p class="text-sm text-gray-600">Gateway ID: {{ transaction.processor.gatewayId }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CreditCard, Clipboard } from 'lucide-vue-next'

const props = defineProps({
  transaction: {
    type: Object,
    required: true
  }
})

// Format date from ISO string to readable format
const formatDate = (isoDate: string) => {
  const date = new Date(isoDate)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

// Format time from ISO string
const formatTime = (isoDate: string) => {
  const date = new Date(isoDate)
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })
}

// Format currency with proper symbol and decimals
const formatCurrency = (amount: number, currency: string) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency
  }).format(amount)
}

// Copy text to clipboard
const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text)
  // Could add a toast notification here
}
</script>