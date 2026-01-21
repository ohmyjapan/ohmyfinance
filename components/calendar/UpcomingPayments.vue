<template>
  <div class="bg-white dark:bg-background-darkPaper rounded-lg shadow">
    <div class="px-4 py-3 border-b dark:border-gray-700">
      <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Upcoming Payments</h3>
    </div>
    <div class="divide-y dark:divide-gray-700">
      <div
        v-for="payment in payments"
        :key="payment.id"
        @click="$emit('select', payment)"
        class="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
      >
        <div class="flex items-start justify-between">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-900 dark:text-white truncate">
              {{ payment.title }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ formatDate(payment.dueDate) }}
            </p>
          </div>
          <div class="ml-3 text-right">
            <p :class="[
              'text-sm font-semibold',
              payment.type === 'income' ? 'text-success-main' : 'text-error-main'
            ]">
              {{ payment.type === 'income' ? '+' : '-' }}{{ formatCurrency(payment.amount, payment.currency) }}
            </p>
            <span :class="[
              'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
              getStatusClass(payment.status)
            ]">
              {{ payment.status }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="payments.length === 0" class="px-4 py-8 text-center">
        <Calendar class="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" />
        <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">No upcoming payments</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Calendar } from 'lucide-vue-next'
import type { Payment } from '~/types/calendar'

defineProps<{
  payments: Payment[]
}>()

defineEmits<{
  (e: 'select', payment: Payment): void
}>()

const formatDate = (dateString: string): string => {
  const date = new Date(dateString)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (date.toDateString() === today.toDateString()) {
    return 'Today'
  }
  if (date.toDateString() === tomorrow.toDateString()) {
    return 'Tomorrow'
  }

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  })
}

const formatCurrency = (amount: number, currency: string): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount)
}

const getStatusClass = (status: string): string => {
  switch (status) {
    case 'paid':
      return 'bg-success-light text-success-dark'
    case 'overdue':
      return 'bg-error-light text-error-dark'
    case 'cancelled':
      return 'bg-gray-100 text-gray-600'
    default:
      return 'bg-warning-light text-warning-dark'
  }
}
</script>
