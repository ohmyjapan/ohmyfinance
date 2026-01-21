<template>
  <div>
    <!-- Header -->
    <div class="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Payment Calendar</h1>
        <p class="text-gray-600 dark:text-gray-400">Track and manage your payments and expected income</p>
      </div>
      <button
        @click="openAddModal()"
        class="mt-4 sm:mt-0 inline-flex items-center px-4 py-2 bg-primary-main hover:bg-primary-dark text-white rounded-lg font-medium transition-colors"
      >
        <Plus class="h-5 w-5 mr-2" />
        Add Payment
      </button>
    </div>

    <!-- Stats -->
    <CalendarStats :stats="calendarStore.monthlyStats" />

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
        />
      </div>

      <!-- Sidebar -->
      <div class="space-y-6">
        <!-- Upcoming Payments -->
        <UpcomingPayments
          :payments="calendarStore.upcomingPayments"
          @select="openEditModal"
        />

        <!-- Overdue Payments Alert -->
        <div v-if="calendarStore.overduePayments.length > 0" class="bg-error-light dark:bg-error-dark/30 rounded-lg p-4">
          <div class="flex items-start">
            <AlertTriangle class="h-5 w-5 text-error-main mt-0.5" />
            <div class="ml-3">
              <h4 class="text-sm font-medium text-error-dark dark:text-error-light">
                {{ calendarStore.overduePayments.length }} Overdue Payment{{ calendarStore.overduePayments.length > 1 ? 's' : '' }}
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

        <!-- Quick Actions -->
        <div class="bg-white dark:bg-background-darkPaper rounded-lg shadow p-4">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-3">Quick Add</h3>
          <div class="space-y-2">
            <button
              @click="quickAdd('expense', 'Rent')"
              class="w-full flex items-center px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
            >
              <Home class="h-4 w-4 mr-2 text-gray-400" />
              <span class="text-gray-700 dark:text-gray-300">Add Rent Payment</span>
            </button>
            <button
              @click="quickAdd('expense', 'Utilities')"
              class="w-full flex items-center px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
            >
              <Zap class="h-4 w-4 mr-2 text-gray-400" />
              <span class="text-gray-700 dark:text-gray-300">Add Utility Bill</span>
            </button>
            <button
              @click="quickAdd('income', 'Invoice')"
              class="w-full flex items-center px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
            >
              <FileText class="h-4 w-4 mr-2 text-gray-400" />
              <span class="text-gray-700 dark:text-gray-300">Add Invoice Income</span>
            </button>
            <button
              @click="quickAdd('income', 'Salary')"
              class="w-full flex items-center px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
            >
              <DollarSign class="h-4 w-4 mr-2 text-gray-400" />
              <span class="text-gray-700 dark:text-gray-300">Add Salary Income</span>
            </button>
          </div>
        </div>
      </div>
    </div>

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
import { ref, onMounted } from 'vue'
import { Plus, AlertTriangle, Home, Zap, FileText, DollarSign } from 'lucide-vue-next'
import { useCalendarStore } from '~/stores/calendar'
import type { Payment, PaymentFormData } from '~/types/calendar'

const calendarStore = useCalendarStore()

// Modal state
const isModalOpen = ref(false)
const selectedPayment = ref<Payment | null>(null)
const selectedDate = ref<string>('')
const quickAddType = ref<'expense' | 'income'>('expense')
const quickAddCategory = ref<string>('')

onMounted(() => {
  calendarStore.fetchPayments()
})

const openAddModal = (dateString?: string) => {
  selectedPayment.value = null
  selectedDate.value = dateString || new Date().toISOString().split('T')[0]
  isModalOpen.value = true
}

const openEditModal = (payment: Payment) => {
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

const formatCurrency = (amount: number, currency: string): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount)
}
</script>
