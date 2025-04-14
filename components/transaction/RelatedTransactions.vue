<template>
  <div class="bg-white rounded-lg shadow overflow-hidden">
    <div class="px-6 py-4 border-b">
      <h3 class="text-lg font-medium text-gray-800">Related Transactions</h3>
    </div>
    <div class="p-6">
      <div class="space-y-4">
        <div
            v-for="transaction in transactions"
            :key="transaction.id"
            class="flex items-center justify-between hover:bg-gray-50 p-2 rounded cursor-pointer"
            @click="navigateToTransaction(transaction.id)"
        >
          <div>
            <p class="text-sm font-medium text-gray-900">#{{ transaction.id }}</p>
            <p class="text-xs text-gray-500">{{ transaction.date }}</p>
          </div>
          <div class="text-right">
            <p class="text-sm font-medium text-gray-900">{{ formatCurrency(transaction.amount) }}</p>
            <StatusBadge :status="transaction.status" />
          </div>
        </div>
      </div>

      <div v-if="transactions.length > 3" class="mt-4 flex justify-center">
        <button class="text-sm text-purple-600 hover:text-purple-700">
          View All Related Transactions
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineProps } from 'vue'

const props = defineProps({
  transactions: {
    type: Array,
    required: true
  }
})

const router = useRouter()

// Navigate to transaction details
const navigateToTransaction = (id: string) => {
  router.push(`/transactions/${id}`)
}

// Format currency
const formatCurrency = (amount: number, currency = 'USD') => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency
  }).format(amount)
}
</script>