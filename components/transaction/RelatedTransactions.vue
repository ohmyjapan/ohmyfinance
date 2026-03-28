<template>
  <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-hidden">
    <div class="px-6 py-4 border-b dark:border-white/10">
      <h3 class="text-lg font-medium text-gray-800 dark:text-gray-100">{{ t('transactions.relatedTransactions') }}</h3>
    </div>
    <div class="p-6">
      <div class="space-y-4">
        <div
            v-for="transaction in transactions"
            :key="transaction.id"
            class="flex items-center justify-between hover:bg-gray-50 dark:hover:bg-white/[0.07] p-2 rounded cursor-pointer"
            @click="navigateToTransaction(transaction.id)"
        >
          <div>
            <p class="text-sm font-medium text-gray-900 dark:text-gray-100">#{{ transaction.id }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ transaction.date }}</p>
          </div>
          <div class="text-right">
            <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ formatCurrency(transaction.amount) }}</p>
            <StatusBadge :status="transaction.status" />
          </div>
        </div>
      </div>

      <div v-if="transactions.length > 3" class="mt-4 flex justify-center">
        <button class="text-sm text-primary-main dark:text-primary-light hover:text-primary-dark dark:hover:text-primary-light">
          {{ t('relatedTransactions.viewAll') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineProps } from 'vue'

const { t, locale } = useI18n()

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

// Format currency (locale-aware)
const formatCurrency = (amount: number, currency = 'JPY') => {
  const currencyLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  const currencyCode = currency || (locale.value === 'ko' ? 'KRW' : 'JPY')
  return new Intl.NumberFormat(currencyLocale, {
    style: 'currency',
    currency: currencyCode,
    maximumFractionDigits: 0
  }).format(amount)
}
</script>