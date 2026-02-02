<template>
  <div class="bg-white dark:bg-background-darkPaper rounded-lg shadow">
    <div class="px-4 py-3 border-b dark:border-gray-700">
      <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('upcomingPayments.title') }}</h3>
    </div>
    <div class="divide-y dark:divide-gray-700">
      <div
        v-for="payment in payments"
        :key="payment.id"
        class="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700"
      >
        <div class="flex items-center gap-3">
          <!-- Complete button -->
          <button
            v-if="payment.status === 'pending' || payment.status === 'overdue'"
            @click.stop="$emit('mark-completed', payment)"
            class="flex-shrink-0 p-1.5 rounded-full border-2 border-gray-300 dark:border-gray-600 hover:border-success-main hover:bg-success-light dark:hover:bg-success-dark/30 transition-all duration-200 hover:scale-110"
            :title="t('calendar.markComplete')"
          >
            <Check class="h-3 w-3 text-transparent hover:text-success-main" />
          </button>
          <div
            v-else-if="payment.status === 'completed'"
            class="flex-shrink-0 p-1.5 rounded-full bg-success-light dark:bg-success-dark/30"
          >
            <Check class="h-3 w-3 text-success-main" />
          </div>

          <!-- Payment info -->
          <div class="flex-1 min-w-0 cursor-pointer" @click="$emit('select', payment)">
            <p class="text-sm font-medium text-gray-900 dark:text-white truncate">
              {{ payment.title }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ formatDate(payment.dueDate) }}
            </p>
          </div>

          <!-- Amount -->
          <div class="text-right">
            <p :class="[
              'text-sm font-semibold',
              payment.type === 'income' ? 'text-success-main' : 'text-error-main'
            ]">
              {{ payment.type === 'income' ? '+' : '-' }}{{ formatCurrency(payment.amount, payment.currency) }}
            </p>
          </div>
        </div>
      </div>

      <div v-if="payments.length === 0" class="px-4 py-8 text-center">
        <Calendar class="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" />
        <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">{{ t('upcomingPayments.noPayments') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Calendar, Check } from 'lucide-vue-next'
import type { Payment } from '~/types/calendar'

const { t, locale } = useI18n()

defineProps<{
  payments: Payment[]
}>()

defineEmits<{
  (e: 'select', payment: Payment): void
  (e: 'mark-completed', payment: Payment): void
}>()

// Parse date string to local date (avoid timezone issues)
const parseLocalDate = (dateString: string): Date => {
  const [year, month, day] = dateString.split('T')[0].split('-').map(Number)
  return new Date(year, month - 1, day)
}

// Format date to YYYY-MM-DD in local timezone
const formatLocalDateStr = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const formatDate = (dateString: string): string => {
  const date = parseLocalDate(dateString)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const dateStr = formatLocalDateStr(date)
  const todayStr = formatLocalDateStr(today)
  const tomorrowStr = formatLocalDateStr(tomorrow)

  if (dateStr === todayStr) {
    return t('time.today')
  }
  if (dateStr === tomorrowStr) {
    return t('time.tomorrow')
  }

  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return date.toLocaleDateString(dateLocale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  })
}

const formatCurrency = (amount: number, currency: string): string => {
  const currencyLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Intl.NumberFormat(currencyLocale, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount)
}

const getStatusClass = (status: string): string => {
  switch (status) {
    case 'paid':
      return 'bg-gray-100 text-gray-600'
    case 'completed':
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
