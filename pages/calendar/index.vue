<template>
  <div>
    <!-- Header -->
    <div class="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('nav.paymentCalendar') }}</h1>
        <p class="text-gray-600 dark:text-gray-400">{{ t('calendar.trackPayments') }}</p>
      </div>
      <button
        data-add-payment v-if="calendarStore.canEdit"
        :disabled="calendarStore.isSaving"
        @click="openAddModal()"
        class="mt-4 sm:mt-0 inline-flex items-center px-4 py-2 bg-primary-main hover:bg-primary-dark text-white rounded-lg font-medium transition-colors"
      >
        <Plus class="h-5 w-5 mr-2" />
        {{ t('calendar.addPayment') }}
      </button>
    </div>

    <div v-if="calendarStore.error" role="alert" class="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">
      <p>{{ calendarError }}</p>
      <button type="button" data-calendar-refresh :disabled="calendarStore.isLoading || calendarStore.isSaving" class="mt-2 font-medium underline" @click="calendarStore.refreshRecovery()">{{ t('calendar.recovery.refresh') }}</button>
    </div>

    <!-- Stats -->
    <CalendarStats :stats="calendarStore.monthlyStats" />

    <!-- Main Content -->
    <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <!-- Calendar -->
      <div class="lg:col-span-3">
        <CalendarGrid
          :read-only="!calendarStore.canEdit"
          :busy="calendarStore.isSaving"
          :current-month="calendarStore.currentMonth"
          :payments="calendarStore.payments"
          @previous-month="calendarStore.previousMonth"
          @next-month="calendarStore.nextMonth"
          @go-today="calendarStore.goToToday"
          @select-date="handleSelectDate"
          @add-payment="openAddModal"
          @edit-payment="openEditModal"
          @mark-completed="handleMarkCompleted"
          @move-payment="handleMovePayment"
          @show-day-detail="openDayDetail"
        />
      </div>

      <!-- Sidebar -->
      <div class="space-y-6">
        <!-- Upcoming Payments -->
        <UpcomingPayments
          :read-only="!calendarStore.canEdit"
          :busy="calendarStore.isSaving"
          :payments="calendarStore.upcomingPayments"
          @select="openEditModal"
          @mark-completed="handleMarkCompleted"
        />

        <!-- Overdue Payments Alert -->
        <div v-if="calendarStore.overduePayments.length > 0" class="bg-error-light dark:bg-error-dark/30 rounded-lg p-4">
          <div class="flex items-start">
            <AlertTriangle class="h-5 w-5 text-error-main mt-0.5" />
            <div class="ml-3">
              <h4 class="text-sm font-medium text-error-dark dark:text-error-light">
                {{ t('calendar.overduePayments', { count: calendarStore.overduePayments.length }) }}
              </h4>
              <div class="mt-2 space-y-1">
                <div
                  v-for="payment in calendarStore.overduePayments.slice(0, 3)"
                  :key="payment.id"
                  @click="openEditModal(payment)"
                  class="text-sm text-error-dark dark:text-error-light cursor-pointer hover:underline"
                >
                  {{ payment.title }} - {{ formatCurrency(payment.amount, payment.currency) }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Quick Actions (OMF style) -->
        <div v-if="calendarStore.canEdit" class="bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 backdrop-blur-sm p-4">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-3">{{ t('calendar.quickAdd') }}</h3>
          <div class="space-y-2">
            <button
              @click="quickAdd('expense', '地代家賃')"
              class="w-full flex items-center px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-white/[0.07] rounded-md"
            >
              <Home class="h-4 w-4 mr-2 text-gray-400" />
              <span class="text-gray-700 dark:text-gray-300">{{ t('calendar.quickItems.rent') }}</span>
            </button>
            <button
              @click="quickAdd('expense', '水道光熱費')"
              class="w-full flex items-center px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-white/[0.07] rounded-md"
            >
              <Zap class="h-4 w-4 mr-2 text-gray-400" />
              <span class="text-gray-700 dark:text-gray-300">{{ t('calendar.quickItems.utilities') }}</span>
            </button>
            <button
              @click="quickAdd('income', '売上')"
              class="w-full flex items-center px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-white/[0.07] rounded-md"
            >
              <FileText class="h-4 w-4 mr-2 text-gray-400" />
              <span class="text-gray-700 dark:text-gray-300">{{ t('calendar.quickItems.salesIncome') }}</span>
            </button>
            <button
              @click="quickAdd('expense', '給与手当')"
              class="w-full flex items-center px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-white/[0.07] rounded-md"
            >
              <DollarSign class="h-4 w-4 mr-2 text-gray-400" />
              <span class="text-gray-700 dark:text-gray-300">{{ t('calendar.quickItems.salary') }}</span>
            </button>
            <button
              @click="quickAdd('expense', 'クレジットカード')"
              class="w-full flex items-center px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-white/[0.07] rounded-md"
            >
              <CreditCard class="h-4 w-4 mr-2 text-gray-400" />
              <span class="text-gray-700 dark:text-gray-300">{{ t('calendar.quickItems.cardPayment') }}</span>
            </button>
            <button
              @click="quickAdd('expense', '通信費')"
              class="w-full flex items-center px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-white/[0.07] rounded-md"
            >
              <Zap class="h-4 w-4 mr-2 text-gray-400" />
              <span class="text-gray-700 dark:text-gray-300">{{ t('calendar.quickItems.communication') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Day Detail Modal -->
    <DayDetailModal
          :read-only="!calendarStore.canEdit"
          :busy="calendarStore.isSaving"
      :is-open="isDayDetailOpen"
      :date-string="dayDetailDate"
      :payments="dayDetailPayments"
      @close="isDayDetailOpen = false"
      @mark-completed="handleDayDetailMarkCompleted"
      @edit-payment="handleDayDetailEdit"
      @add-payment="handleDayDetailAdd"
    />

    <!-- Payment Modal -->
    <PaymentModal
      :read-only="!calendarStore.canEdit"
      :busy="calendarStore.isSaving"
      :error="calendarStore.error ? calendarError : null"
      :recovery="modalRecovery"
      :saved-payment="savedPayment"
      :is-open="isModalOpen"
      :payment="selectedPayment"
      :default-date="selectedDate"
      @close="closeModal"
      @submit="handleSubmit"
      @delete="handleDelete"
      @refresh="calendarStore.refreshRecovery()"
      @use-saved="useSavedPayment"
      @complete="handleMarkCompleted"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { Plus, AlertTriangle, Home, Zap, FileText, DollarSign, CreditCard } from 'lucide-vue-next'
import { useCalendarStore } from '~/stores/calendar'
import type { Payment, PaymentFormData } from '~/types/calendar'

const { t, locale } = useI18n()
const calendarStore = useCalendarStore()

// Format date to YYYY-MM-DD in local timezone (JST)
const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Day Detail Modal state
const isDayDetailOpen = ref(false)
const dayDetailDate = ref('')

const dayDetailPayments = computed(() => {
  if (!dayDetailDate.value) return []
  return calendarStore.getPaymentsByDate(dayDetailDate.value)
})

const openDayDetail = (dateString: string) => {
  dayDetailDate.value = dateString
  isDayDetailOpen.value = true
}

const handleDayDetailMarkCompleted = async (payment: Payment) => {
  await handleMarkCompleted(payment)
}

const handleDayDetailEdit = (payment: Payment) => {
  isDayDetailOpen.value = false
  openEditModal(payment)
}

const handleDayDetailAdd = () => {
  isDayDetailOpen.value = false
  openAddModal(dayDetailDate.value)
}

// Modal state
const isModalOpen = ref(false)
const selectedPayment = ref<Payment | null>(null)
const selectedDate = ref<string>('')
const clonePayment = (payment: Payment): Payment => JSON.parse(JSON.stringify(payment))
const savedPayment = computed(() => calendarStore.payments.find(payment => payment.id === selectedPayment.value?.id) || null)
const modalRecovery = computed(() => calendarStore.recovery?.paymentId === selectedPayment.value?.id ? calendarStore.recovery : null)
const calendarError = computed(() => {
  const code = calendarStore.recovery?.code
  const messages: Record<string, string> = {
    PAYMENT_CHANGED: 'changed', PAYMENT_LINK_DELETED: 'deleted', PAYMENT_MISSING: 'missing',
    PAYMENT_COMPLETION_PENDING: 'pending', PAYMENT_CURRENCY_REVIEW: 'currency',
    PAYMENT_CANCELLED: 'cancelled', PAYMENT_LINK_REVIEW: 'linkReview', PAYMENT_LINK_UNAVAILABLE: 'unavailable'
  }
  return t(`calendar.recovery.${code && messages[code] || 'requestFailed'}`)
})
const quickAddType = ref<'expense' | 'income'>('expense')
const quickAddCategory = ref<string>('')

onMounted(() => {
  calendarStore.fetchPayments()
})

const openAddModal = (dateString?: string) => {
  if (!calendarStore.canEdit || calendarStore.isSaving) return
  selectedPayment.value = null
  selectedDate.value = dateString || formatLocalDate(new Date())
  isModalOpen.value = true
}

const openEditModal = (payment: Payment) => {
  if (calendarStore.isSaving) return
  selectedPayment.value = clonePayment(payment)
  selectedDate.value = ''
  isModalOpen.value = true
}

const closeModal = () => {
  isModalOpen.value = false
  selectedPayment.value = null
  selectedDate.value = ''
}

watch(() => calendarStore.contextKey, () => {
  closeModal(); isDayDetailOpen.value = false
  void calendarStore.fetchPayments()
}, { flush: 'post' })

const useSavedPayment = () => {
  if (!savedPayment.value || calendarStore.isSaving || modalRecovery.value?.state === 'loading' || modalRecovery.value?.state === 'failed') return
  selectedPayment.value = clonePayment(savedPayment.value)
  calendarStore.recovery = null
  calendarStore.error = null
}

const handleSelectDate = (date: Date) => {
  calendarStore.setSelectedDate(date)
}

const handleMarkCompleted = async (payment: Payment) => {
  try {
    await calendarStore.markAsCompleted(payment.id, payment.revision)
  } catch (error) {
    console.error('Error marking payment as completed:', error)
  }
}

const handleMovePayment = async (payment: Payment, newDate: string) => {
  try {
    await calendarStore.updatePayment(payment.id, { dueDate: newDate }, payment.revision)
  } catch (error) {
    console.error('Error moving payment:', error)
  }
}

const handleSubmit = async (data: PaymentFormData) => {
  try {
    if (!selectedPayment.value && quickAddType.value && quickAddCategory.value) {
      data.type = quickAddType.value; data.category = quickAddCategory.value
    }
    const result = selectedPayment.value
      ? await calendarStore.updatePayment(selectedPayment.value.id, data, selectedPayment.value.revision)
      : await calendarStore.addPayment(data)
    if (result) { quickAddType.value = 'expense'; quickAddCategory.value = ''; closeModal() }
  } catch { /* The store error remains visible in the open form. */ }
}

const handleDelete = async (payment: Payment) => {
  if (!payment || payment.id !== selectedPayment.value?.id) return
  try { if (await calendarStore.deletePayment(payment.id, payment.revision)) closeModal() }
  catch { /* The store error remains visible in the open form. */ }
}

const quickAdd = (type: 'expense' | 'income', category: string) => {
  quickAddType.value = type
  quickAddCategory.value = category
  openAddModal()
}

const formatCurrency = (amount: number, currency: string): string => {
  const currencyLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Intl.NumberFormat(currencyLocale, {
    style: 'currency',
    currency: currency || (locale.value === 'ko' ? 'KRW' : 'JPY'),
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount)
}
</script>
