<template>
  <div class="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
    <div class="p-6">
      <div class="flex flex-col md:flex-row md:justify-between md:items-center mb-6">
        <div>
          <h2 class="text-xl font-semibold text-gray-800 dark:text-gray-100">{{ transaction.id }}</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400">
            {{ t('transactionSummary.createdOn', { date: formatDate(transaction.createdAt), time: '' }) }}
          </p>
        </div>
        <div class="mt-4 md:mt-0">
          <StatusBadge :status="transaction.status" />
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-b dark:border-gray-700 py-6 my-6">
        <div>
          <p class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{{ t('transactionSummary.source') }}</p>
          <div class="flex items-center">
            <CreditCard size="18" class="text-purple-600 dark:text-purple-400 mr-2" />
            <p class="text-base font-medium text-gray-800 dark:text-gray-100">{{ formatSource(transaction.source) }}</p>
          </div>
        </div>
        <div>
          <p class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{{ t('transactionSummary.amount') }}</p>
          <p class="text-base font-medium text-gray-800 dark:text-gray-100">
            {{ formatCurrency(transaction.amount, transaction.currency) }}
          </p>
        </div>
        <div>
          <p class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{{ t('transactionSummary.transactionId') }}</p>
          <div class="flex items-center">
            <p class="text-base font-medium text-gray-800 dark:text-gray-100 mr-2">{{ transaction.reference }}</p>
            <button
                class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                @click="copyToClipboard(transaction.reference)"
            >
              <Clipboard size="14" />
            </button>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <p class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{{ t('transactionSummary.customer') }}</p>
          <p class="text-base font-medium text-gray-800 dark:text-gray-100">{{ transaction.customer.name }}</p>
          <p class="text-sm text-gray-600 dark:text-gray-400">{{ transaction.customer.email }}</p>
        </div>
        <div v-if="transaction.paymentMethod">
          <p class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{{ t('transactionSummary.paymentMethod') }}</p>
          <p class="text-base font-medium text-gray-800 dark:text-gray-100">
            {{ t('transactionSummary.cardEndingIn', { type: transaction.paymentMethod.type, last4: transaction.paymentMethod.last4 }) }}
          </p>
          <p class="text-sm text-gray-600 dark:text-gray-400">{{ t('transactionSummary.expires', { date: transaction.paymentMethod.expiryDate }) }}</p>
        </div>
        <div v-if="transaction.processor">
          <p class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{{ t('transactionSummary.processedBy') }}</p>
          <p class="text-base font-medium text-gray-800 dark:text-gray-100">{{ transaction.processor.name }}</p>
          <p class="text-sm text-gray-600 dark:text-gray-400">{{ t('transactionSummary.gatewayId', { id: transaction.processor.gatewayId }) }}</p>
        </div>
      </div>

      <!-- Optional Notes -->
      <div v-if="transaction.notes" class="mt-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
        <p class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{{ t('common.notes') }}</p>
        <p class="text-sm text-gray-800 dark:text-gray-200">{{ transaction.notes }}</p>
      </div>

      <!-- Edit / Action Buttons -->
      <div class="mt-6 flex flex-wrap gap-3 justify-end">
        <button
            @click="$emit('edit')"
            class="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
        >
          <Edit2 size="16" class="mr-2" />
          {{ t('transactions.editTransaction') }}
        </button>
        <button
            @click="$emit('download-receipt')"
            class="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            :disabled="!transaction.receipt"
        >
          <Download size="16" class="mr-2" />
          {{ t('receiptCard.viewFull') }}
        </button>
        <button
            @click="$emit('update-status')"
            class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
        >
          <RefreshCw size="16" class="mr-2" />
          {{ t('shipmentPage.updateStatus') }}
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

const { t, locale } = useI18n()

const props = defineProps({
  transaction: {
    type: Object,
    required: true
  }
})

defineEmits(['edit', 'download-receipt', 'update-status'])

// Format date from ISO string (locale-aware)
const formatDate = (isoDate: string) => {
  if (!isoDate) return ''

  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  const date = new Date(isoDate)
  return date.toLocaleDateString(dateLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

// Format source type to be more readable
const formatSource = (source: string) => {
  if (!source) return ''

  return t(`transactions.sources.${source}`) || source
}

// Format currency with proper symbol and decimals (locale-aware)
const formatCurrency = (amount: number, currency = 'JPY') => {
  if (!amount && amount !== 0) return ''

  const currencyLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  const currencyCode = currency || (locale.value === 'ko' ? 'KRW' : 'JPY')
  return new Intl.NumberFormat(currencyLocale, {
    style: 'currency',
    currency: currencyCode,
    maximumFractionDigits: 0
  }).format(amount)
}

// Copy text to clipboard
const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text)
}
</script>