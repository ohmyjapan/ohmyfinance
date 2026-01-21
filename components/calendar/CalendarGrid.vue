<template>
  <div class="bg-white dark:bg-background-darkPaper rounded-lg shadow">
    <!-- Calendar Header -->
    <div class="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700">
      <div class="flex items-center space-x-4">
        <button
          @click="$emit('previous-month')"
          class="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"
        >
          <ChevronLeft class="h-5 w-5 text-gray-600 dark:text-gray-400" />
        </button>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
          {{ monthYearLabel }}
        </h2>
        <button
          @click="$emit('next-month')"
          class="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"
        >
          <ChevronRight class="h-5 w-5 text-gray-600 dark:text-gray-400" />
        </button>
      </div>
      <button
        @click="$emit('go-today')"
        class="px-4 py-2 text-sm font-medium text-primary-main hover:bg-primary-light dark:hover:bg-primary-dark/20 rounded-md"
      >
        Today
      </button>
    </div>

    <!-- Days of Week -->
    <div class="grid grid-cols-7 border-b dark:border-gray-700">
      <div
        v-for="day in daysOfWeek"
        :key="day"
        class="py-3 text-center text-sm font-medium text-gray-500 dark:text-gray-400"
      >
        {{ day }}
      </div>
    </div>

    <!-- Calendar Grid -->
    <div class="grid grid-cols-7">
      <div
        v-for="(day, index) in calendarDays"
        :key="index"
        :class="[
          'min-h-[120px] p-2 border-b border-r dark:border-gray-700',
          day.isCurrentMonth ? 'bg-white dark:bg-background-darkPaper' : 'bg-gray-50 dark:bg-gray-800/50',
          day.isToday ? 'bg-primary-light/30 dark:bg-primary-dark/20' : '',
          index % 7 === 6 ? 'border-r-0' : ''
        ]"
        @click="$emit('select-date', day.date)"
      >
        <div class="flex justify-between items-start mb-1">
          <span
            :class="[
              'inline-flex items-center justify-center w-7 h-7 rounded-full text-sm',
              day.isToday ? 'bg-primary-main text-white' : '',
              !day.isCurrentMonth ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'
            ]"
          >
            {{ day.date.getDate() }}
          </span>
          <button
            v-if="day.isCurrentMonth"
            @click.stop="$emit('add-payment', day.dateString)"
            class="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Plus class="h-4 w-4 text-gray-400" />
          </button>
        </div>

        <!-- Payment indicators -->
        <div class="space-y-1">
          <div
            v-for="payment in day.payments.slice(0, 3)"
            :key="payment.id"
            @click.stop="$emit('edit-payment', payment)"
            :class="[
              'px-2 py-1 rounded text-xs truncate cursor-pointer',
              getPaymentClass(payment)
            ]"
          >
            <span class="font-medium">{{ formatCurrency(payment.amount, payment.currency) }}</span>
            <span class="ml-1 opacity-75">{{ payment.title }}</span>
          </div>
          <div
            v-if="day.payments.length > 3"
            class="text-xs text-gray-500 dark:text-gray-400 pl-2"
          >
            +{{ day.payments.length - 3 }} more
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-vue-next'
import type { Payment, CalendarDay } from '~/types/calendar'

const props = defineProps<{
  currentMonth: Date
  payments: Payment[]
}>()

defineEmits<{
  (e: 'previous-month'): void
  (e: 'next-month'): void
  (e: 'go-today'): void
  (e: 'select-date', date: Date): void
  (e: 'add-payment', dateString: string): void
  (e: 'edit-payment', payment: Payment): void
}>()

const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const monthYearLabel = computed(() => {
  return props.currentMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric'
  })
})

const calendarDays = computed((): CalendarDay[] => {
  const year = props.currentMonth.getFullYear()
  const month = props.currentMonth.getMonth()

  const firstDayOfMonth = new Date(year, month, 1)
  const lastDayOfMonth = new Date(year, month + 1, 0)

  const startDate = new Date(firstDayOfMonth)
  startDate.setDate(startDate.getDate() - firstDayOfMonth.getDay())

  const endDate = new Date(lastDayOfMonth)
  endDate.setDate(endDate.getDate() + (6 - lastDayOfMonth.getDay()))

  const days: CalendarDay[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const current = new Date(startDate)
  while (current <= endDate) {
    const dateString = current.toISOString().split('T')[0]
    const dayPayments = props.payments.filter(p =>
      p.dueDate.split('T')[0] === dateString
    )

    days.push({
      date: new Date(current),
      dateString,
      isCurrentMonth: current.getMonth() === month,
      isToday: current.getTime() === today.getTime(),
      payments: dayPayments
    })

    current.setDate(current.getDate() + 1)
  }

  return days
})

const getPaymentClass = (payment: Payment): string => {
  if (payment.type === 'income') {
    return 'bg-success-light dark:bg-success-dark/30 text-success-dark dark:text-success-light'
  }

  switch (payment.status) {
    case 'paid':
      return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 line-through'
    case 'overdue':
      return 'bg-error-light dark:bg-error-dark/30 text-error-dark dark:text-error-light'
    default:
      return 'bg-warning-light dark:bg-warning-dark/30 text-warning-dark dark:text-warning-light'
  }
}

const formatCurrency = (amount: number, currency: string): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount)
}
</script>
