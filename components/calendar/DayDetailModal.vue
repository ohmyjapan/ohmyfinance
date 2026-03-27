<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 overflow-y-auto"
    @click.self="$emit('close')"
  >
    <div class="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
      <!-- Backdrop -->
      <div class="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity" @click="$emit('close')"></div>

      <!-- Modal -->
      <div class="relative bg-white dark:bg-background-darkPaper rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:max-w-lg sm:w-full">
        <!-- Header -->
        <div class="px-6 py-4 border-b dark:border-gray-700">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ formattedDate }}
            </h3>
            <button
              type="button"
              @click="$emit('close')"
              class="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
            >
              <X class="h-5 w-5" />
            </button>
          </div>
          <!-- Progress Bar -->
          <div v-if="payments.length > 0" class="space-y-1">
            <div class="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>{{ t('calendar.dayDetail.progress') }}</span>
              <span class="font-medium">{{ completedCount }}/{{ payments.length }}</span>
            </div>
            <div class="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                class="h-full bg-success-main rounded-full transition-all duration-300"
                :style="{ width: `${progressPercent}%` }"
              />
            </div>
          </div>
        </div>

        <!-- Payment List -->
        <div class="px-6 py-4 max-h-[60vh] overflow-y-auto">
          <div v-if="payments.length === 0" class="text-center py-8 text-gray-500 dark:text-gray-400">
            {{ t('calendar.dayDetail.noPayments') }}
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="payment in sortedPayments"
              :key="payment.id"
              :class="[
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50',
                isCompleted(payment) ? 'opacity-60' : ''
              ]"
              @click="$emit('edit-payment', payment)"
            >
              <!-- Checkbox -->
              <button
                v-if="payment.status === 'pending' || payment.status === 'overdue'"
                @click.stop="$emit('mark-completed', payment)"
                class="flex-shrink-0 w-5 h-5 rounded-full border-2 border-gray-400 dark:border-gray-500 hover:bg-success-main hover:border-success-main hover:text-white transition-all"
              />
              <div
                v-else-if="isCompleted(payment)"
                class="flex-shrink-0 w-5 h-5 rounded-full bg-success-main flex items-center justify-center"
              >
                <Check class="h-3 w-3 text-white" />
              </div>
              <div v-else class="flex-shrink-0 w-5 h-5 rounded-full bg-gray-300 dark:bg-gray-600" />

              <!-- Payment Info -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span
                    :class="[
                      'text-sm font-medium truncate',
                      isCompleted(payment) ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'
                    ]"
                  >
                    {{ payment.title }}
                  </span>
                  <!-- Category Tag -->
                  <span
                    :class="[
                      'flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded',
                      getCategoryColors(payment.category).bg,
                      getCategoryColors(payment.category).text
                    ]"
                  >
                    {{ t(`paymentModal.categories.${payment.category.toLowerCase().replace(/\s+/g, '_')}`) }}
                  </span>
                </div>
                <!-- Status Badge -->
                <div class="flex items-center gap-2 mt-0.5">
                  <span
                    :class="[
                      'text-[10px] font-medium px-1.5 py-0.5 rounded',
                      getStatusClass(payment.status)
                    ]"
                  >
                    {{ t(`paymentModal.statuses.${payment.status}`) }}
                  </span>
                  <span v-if="payment.recurring" class="text-[10px] text-gray-400 dark:text-gray-500">
                    {{ t(`recurring.frequencies.${payment.recurringFrequency || 'monthly'}`) }}
                  </span>
                </div>
              </div>

              <!-- Amount -->
              <div class="flex-shrink-0 text-right">
                <span
                  :class="[
                    'text-sm font-semibold',
                    isCompleted(payment) ? 'line-through text-gray-400 dark:text-gray-500' :
                    payment.type === 'income' ? 'text-success-main' : 'text-error-main'
                  ]"
                >
                  {{ payment.type === 'income' ? '+' : '-' }}{{ formatCurrency(payment.amount, payment.currency) }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-6 py-4 border-t dark:border-gray-700">
          <!-- Totals by currency -->
          <div v-if="payments.length > 0" class="flex flex-wrap gap-4 mb-3">
            <div v-for="(totals, currency) in currencyTotals" :key="currency" class="text-xs">
              <span v-if="totals.income > 0" class="text-success-main font-medium mr-2">
                +{{ formatCurrency(totals.income, String(currency)) }}
              </span>
              <span v-if="totals.expense > 0" class="text-error-main font-medium">
                -{{ formatCurrency(totals.expense, String(currency)) }}
              </span>
            </div>
          </div>
          <button
            @click="$emit('add-payment')"
            class="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-main hover:bg-primary-dark rounded-md transition-colors"
          >
            <Plus class="h-4 w-4" />
            {{ t('calendar.addPayment') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { X, Check, Plus } from 'lucide-vue-next'
import type { Payment } from '~/types/calendar'

const { t, locale } = useI18n()

const props = defineProps<{
  isOpen: boolean
  dateString: string
  payments: Payment[]
}>()

defineEmits<{
  (e: 'close'): void
  (e: 'mark-completed', payment: Payment): void
  (e: 'edit-payment', payment: Payment): void
  (e: 'add-payment'): void
}>()

const formattedDate = computed(() => {
  if (!props.dateString) return ''
  const [year, month, day] = props.dateString.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return date.toLocaleDateString(dateLocale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  })
})

const isCompleted = (payment: Payment): boolean => {
  return payment.status === 'paid' || payment.status === 'completed'
}

const completedCount = computed(() => {
  return props.payments.filter(p => isCompleted(p)).length
})

const progressPercent = computed(() => {
  if (props.payments.length === 0) return 0
  return Math.round((completedCount.value / props.payments.length) * 100)
})

const sortedPayments = computed(() => {
  return [...props.payments].sort((a, b) => {
    // Pending/overdue first, then completed
    const aCompleted = isCompleted(a) ? 1 : 0
    const bCompleted = isCompleted(b) ? 1 : 0
    if (aCompleted !== bCompleted) return aCompleted - bCompleted
    // Overdue before pending
    if (a.status === 'overdue' && b.status !== 'overdue') return -1
    if (b.status === 'overdue' && a.status !== 'overdue') return 1
    // By amount descending
    return b.amount - a.amount
  })
})

const currencyTotals = computed(() => {
  const totals: Record<string, { income: number; expense: number }> = {}
  for (const p of props.payments) {
    if (!totals[p.currency]) totals[p.currency] = { income: 0, expense: 0 }
    if (p.type === 'income') {
      totals[p.currency].income += p.amount
    } else {
      totals[p.currency].expense += p.amount
    }
  }
  return totals
})

const getCategoryColors = (category: string): { bg: string; text: string } => {
  const colors: Record<string, { bg: string; text: string }> = {
    'Term Credit Card': { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300' },
    'Personal': { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300' },
    'Salary': { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300' },
    'Invoice': { bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-700 dark:text-indigo-300' },
    'Utilities': { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300' },
    'Rent': { bg: 'bg-pink-100 dark:bg-pink-900/30', text: 'text-pink-700 dark:text-pink-300' },
    'Subscription': { bg: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-700 dark:text-cyan-300' },
    'Insurance': { bg: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-700 dark:text-teal-300' },
    'Tax': { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300' },
    'Loan': { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300' },
    'Other': { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-700 dark:text-gray-300' }
  }
  return colors[category] || colors['Other']
}

const getStatusClass = (status: string): string => {
  switch (status) {
    case 'pending': return 'bg-warning-light dark:bg-warning-dark/30 text-warning-dark dark:text-warning-light'
    case 'paid':
    case 'completed': return 'bg-success-light dark:bg-success-dark/30 text-success-dark dark:text-success-light'
    case 'overdue': return 'bg-error-light dark:bg-error-dark/30 text-error-dark dark:text-error-light'
    case 'cancelled': return 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
    default: return 'bg-gray-100 dark:bg-gray-700 text-gray-500'
  }
}

const formatCurrency = (amount: number, currency: string): string => {
  const currencyLocale = currency === 'JPY' ? 'ja-JP' : currency === 'KRW' ? 'ko-KR' : 'en-US'
  return new Intl.NumberFormat(currencyLocale, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount)
}
</script>
