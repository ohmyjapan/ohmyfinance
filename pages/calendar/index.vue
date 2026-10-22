<template>
  <div>
    <!-- Header -->
    <div class="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('nav.paymentCalendar') }}</h1>
        <p class="text-gray-600 dark:text-gray-400">{{ t('calendar.trackPayments') }}</p>
      </div>
      <button
        @click="openAddModal()"
        class="mt-4 sm:mt-0 inline-flex items-center px-4 py-2 bg-primary-main hover:bg-primary-dark text-white rounded-lg font-medium transition-colors"
      >
        <Plus class="h-5 w-5 mr-2" />
        {{ t('calendar.addPayment') }}
      </button>
    </div>

    <!-- Stats -->
    <CalendarStats :stats="calendarStore.monthlyStats" />
    <p v-if="calendarStore.payments.some(payment => payment.currency !== 'JPY')" data-calendar-currency-notice class="mb-6 text-sm text-gray-600 dark:text-gray-400">
      {{ locale === 'ko' ? '엔화 이외의 예정은 완료해도 달력 상태만 갱신합니다. 엔화 장부 기록은 은행·거래 화면에서 등록해 주세요.' : '円以外の予定の完了はカレンダーの状態更新です。円建ての記帳は銀行・取引画面で行ってください。' }}
      <NuxtLink to="/transactions" class="text-primary-main underline">{{ t('nav.transactions') }}</NuxtLink>
    </p>

    <!-- Main Content -->
    <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <!-- Calendar -->
      <div class="lg:col-span-3">
        <CalendarGrid
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
          :payments="calendarStore.upcomingPayments"
          :consult-disabled="!navi.available.value"
          @select="openEditModal"
          @mark-completed="handleMarkCompleted"
          @consult="consultPayment"
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
        <div class="bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 backdrop-blur-sm p-4">
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
      :is-open="isDayDetailOpen"
      :date-string="dayDetailDate"
      :payments="dayDetailPayments"
      :consult-disabled="!navi.available.value"
      @close="isDayDetailOpen = false"
      @mark-completed="handleDayDetailMarkCompleted"
      @edit-payment="handleDayDetailEdit"
      @add-payment="handleDayDetailAdd"
      @consult="handleDayDetailConsult"
    />

    <!-- Payment Modal -->
    <PaymentModal
      :is-open="isModalOpen"
      :payment="selectedPayment"
      :default-date="selectedDate"
      @close="closeModal"
      @submit="handleSubmit"
      @delete="handleDelete"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Plus, AlertTriangle, Home, Zap, FileText, DollarSign, CreditCard } from 'lucide-vue-next'
import { useCalendarStore } from '~/stores/calendar'
import { useAssistantStore } from '~/stores/assistant'
import { useUserStore } from '~/stores/user'
import { tokenClaims } from '~/utils/auth-session'
import type { Payment, PaymentFormData } from '~/types/calendar'
import { formatCalendarMoney } from '~/shared/finance-calendar-money.mjs'
import { useNaviRecordSelection } from '~/composables/useNaviRecordSelection'

const { t, locale } = useI18n()
const calendarStore = useCalendarStore()
const assistant = useAssistantStore(), userStore = useUserStore()
// Consulting Navi about one saved calendar entry from the upcoming list or the read-only day list (pointer only; the payment editor
// and its values are never published, and a dirty editor is never closed).
const navi = useNaviRecordSelection('calendar')
const consultPayment = (payment: Payment) => { const day = String(payment.dueDate || '').slice(0, 10).split('-'); navi.consult({ id: String(payment.id), label: String(payment.title || '') + (day.length === 3 ? '（' + Number(day[1]) + '/' + Number(day[2]) + '）' : '') }) }
// The calendar's own native load; its entries are consultable once the store actually applied a read for the actor/company it started
// under (the store drops a superseded or other-identity reply before it touches the rows, and such a read never vouches for them).
const loadCalendar = async () => {
  const rows = navi.loading()
  if (await calendarStore.fetchPayments()) navi.loaded(rows)
}
// Navi added or removed a calendar entry of this same actor and company: reload the calendar (issuer bills it suppressed stay hidden).
watch(() => assistant.companyResourceSequence, () => {
  const saved = assistant.companyResource, scope = tokenClaims(userStore.token)
  if (saved && saved.actorId === scope?.userId && saved.organizationId === scope?.organizationId && saved.kinds.includes('payment') && saved.effect !== 'update') loadCalendar()
})

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

// The day list is read only (it holds no unsaved values), so it closes for the consultation; no editor opens.
const handleDayDetailConsult = (payment: Payment) => {
  isDayDetailOpen.value = false
  consultPayment(payment)
}

// Modal state
const isModalOpen = ref(false)
const selectedPayment = ref<Payment | null>(null)
const selectedDate = ref<string>('')
const quickAddType = ref<'expense' | 'income'>('expense')
const quickAddCategory = ref<string>('')

onMounted(() => {
  loadCalendar()
})

const openAddModal = (dateString?: string) => {
  navi.clear()
  selectedPayment.value = null
  selectedDate.value = dateString || formatLocalDate(new Date())
  isModalOpen.value = true
}

const openEditModal = (payment: Payment) => {
  navi.clear()
  selectedPayment.value = payment
  selectedDate.value = ''
  isModalOpen.value = true
}

const closeModal = () => {
  isModalOpen.value = false
  selectedPayment.value = null
  selectedDate.value = ''
}

const handleSelectDate = (date: Date) => {
  calendarStore.setSelectedDate(date)
}

const handleMarkCompleted = async (payment: Payment) => {
  try {
    await calendarStore.markAsCompleted(payment.id)
  } catch (error) {
    console.error('Error marking payment as completed:', error)
  }
}

const handleMovePayment = async (payment: Payment, newDate: string) => {
  try {
    await calendarStore.updatePayment(payment.id, { dueDate: newDate })
  } catch (error) {
    console.error('Error moving payment:', error)
  }
}

const handleSubmit = async (data: PaymentFormData) => {
  try {
    if (selectedPayment.value) {
      await calendarStore.updatePayment(selectedPayment.value.id, data)
    } else {
      // Apply quick add presets if set
      if (quickAddType.value && quickAddCategory.value) {
        data.type = quickAddType.value
        data.category = quickAddCategory.value
        quickAddType.value = 'expense'
        quickAddCategory.value = ''
      }
      await calendarStore.addPayment(data)
    }
    closeModal()
  } catch (error) {
    console.error('Error saving payment:', error)
  }
}

const handleDelete = async () => {
  if (selectedPayment.value) {
    try {
      await calendarStore.deletePayment(selectedPayment.value.id)
      closeModal()
    } catch (error) {
      console.error('Error deleting payment:', error)
    }
  }
}

const quickAdd = (type: 'expense' | 'income', category: string) => {
  quickAddType.value = type
  quickAddCategory.value = category
  openAddModal()
}

const formatCurrency = (amount: number, currency: string): string => formatCalendarMoney(amount, currency, locale.value)
</script>
