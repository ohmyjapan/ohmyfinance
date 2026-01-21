<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 overflow-y-auto"
    @click.self="$emit('close')"
  >
    <div class="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
      <!-- Backdrop -->
      <div class="fixed inset-0 bg-gray-500 dark:bg-gray-900 bg-opacity-75 dark:bg-opacity-75 transition-opacity" @click="$emit('close')"></div>

      <!-- Modal -->
      <div class="relative bg-white dark:bg-background-darkPaper rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:max-w-lg sm:w-full">
        <form @submit.prevent="handleSubmit">
          <!-- Header -->
          <div class="px-6 py-4 border-b dark:border-gray-700 flex items-center justify-between">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ isEditing ? 'Edit Payment' : 'Add Payment' }}
            </h3>
            <button
              type="button"
              @click="$emit('close')"
              class="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
            >
              <X class="h-5 w-5" />
            </button>
          </div>

          <!-- Body -->
          <div class="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
            <!-- Type Toggle -->
            <div class="flex rounded-lg bg-gray-100 dark:bg-gray-700 p-1">
              <button
                type="button"
                @click="form.type = 'expense'"
                :class="[
                  'flex-1 py-2 text-sm font-medium rounded-md transition-colors',
                  form.type === 'expense'
                    ? 'bg-white dark:bg-gray-600 text-error-main shadow'
                    : 'text-gray-500 dark:text-gray-400'
                ]"
              >
                Expense
              </button>
              <button
                type="button"
                @click="form.type = 'income'"
                :class="[
                  'flex-1 py-2 text-sm font-medium rounded-md transition-colors',
                  form.type === 'income'
                    ? 'bg-white dark:bg-gray-600 text-success-main shadow'
                    : 'text-gray-500 dark:text-gray-400'
                ]"
              >
                Income
              </button>
            </div>

            <!-- Title -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Title *
              </label>
              <input
                v-model="form.title"
                type="text"
                required
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-gray-700 dark:text-white"
                placeholder="e.g., Office Rent, Client Payment"
              />
            </div>

            <!-- Amount & Currency -->
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Amount *
                </label>
                <input
                  v-model="form.amount"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-gray-700 dark:text-white"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Currency
                </label>
                <select
                  v-model="form.currency"
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-gray-700 dark:text-white"
                >
                  <option v-for="c in CURRENCIES" :key="c.code" :value="c.code">
                    {{ c.symbol }} {{ c.code }}
                  </option>
                </select>
              </div>
            </div>

            <!-- Due Date & Category -->
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Due Date *
                </label>
                <input
                  v-model="form.dueDate"
                  type="date"
                  required
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Category *
                </label>
                <select
                  v-model="form.category"
                  required
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-gray-700 dark:text-white"
                >
                  <option v-for="cat in PAYMENT_CATEGORIES" :key="cat" :value="cat">
                    {{ cat }}
                  </option>
                </select>
              </div>
            </div>

            <!-- Status (only for editing) -->
            <div v-if="isEditing">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Status
              </label>
              <select
                v-model="form.status"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-gray-700 dark:text-white"
              >
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <!-- Recurring -->
            <div class="flex items-center space-x-4">
              <label class="flex items-center">
                <input
                  v-model="form.recurring"
                  type="checkbox"
                  class="rounded border-gray-300 dark:border-gray-600 text-primary-main focus:ring-primary-main"
                />
                <span class="ml-2 text-sm text-gray-700 dark:text-gray-300">Recurring payment</span>
              </label>
              <select
                v-if="form.recurring"
                v-model="form.recurringFrequency"
                class="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-gray-700 dark:text-white"
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>

            <!-- Bank Transfer Toggle -->
            <div class="border-t dark:border-gray-700 pt-4">
              <button
                type="button"
                @click="showBankTransfer = !showBankTransfer"
                class="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <component :is="showBankTransfer ? ChevronDown : ChevronRight" class="h-4 w-4 mr-2" />
                Bank Transfer Information
              </button>

              <div v-if="showBankTransfer" class="mt-4 space-y-3 pl-6">
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Bank Name</label>
                    <input
                      v-model="form.bankTransfer.bankName"
                      type="text"
                      class="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
                      placeholder="e.g., Chase Bank"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Account Holder</label>
                    <input
                      v-model="form.bankTransfer.accountHolder"
                      type="text"
                      class="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
                      placeholder="Account holder name"
                    />
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Account Number</label>
                    <input
                      v-model="form.bankTransfer.accountNumber"
                      type="text"
                      class="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
                      placeholder="Account number"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Routing Number</label>
                    <input
                      v-model="form.bankTransfer.routingNumber"
                      type="text"
                      class="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
                      placeholder="Routing number"
                    />
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">SWIFT/BIC</label>
                    <input
                      v-model="form.bankTransfer.swiftCode"
                      type="text"
                      class="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
                      placeholder="SWIFT code"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">IBAN</label>
                    <input
                      v-model="form.bankTransfer.iban"
                      type="text"
                      class="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
                      placeholder="IBAN"
                    />
                  </div>
                </div>
              </div>
            </div>

            <!-- Notes -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Notes
              </label>
              <textarea
                v-model="form.notes"
                rows="2"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-gray-700 dark:text-white"
                placeholder="Additional notes..."
              ></textarea>
            </div>
          </div>

          <!-- Footer -->
          <div class="px-6 py-4 border-t dark:border-gray-700 flex justify-between">
            <button
              v-if="isEditing"
              type="button"
              @click="$emit('delete')"
              class="px-4 py-2 text-sm font-medium text-error-main hover:bg-error-light dark:hover:bg-error-dark/20 rounded-md"
            >
              Delete
            </button>
            <div v-else></div>
            <div class="flex space-x-3">
              <button
                type="button"
                @click="$emit('close')"
                class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="px-4 py-2 text-sm font-medium text-white bg-primary-main hover:bg-primary-dark rounded-md"
              >
                {{ isEditing ? 'Update' : 'Add Payment' }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { X, ChevronDown, ChevronRight } from 'lucide-vue-next'
import type { Payment, PaymentFormData, BankTransferInfo } from '~/types/calendar'
import { PAYMENT_CATEGORIES, CURRENCIES } from '~/types/calendar'

const props = defineProps<{
  isOpen: boolean
  payment?: Payment | null
  defaultDate?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', data: PaymentFormData): void
  (e: 'delete'): void
}>()

const isEditing = ref(false)
const showBankTransfer = ref(false)

const getDefaultForm = (): PaymentFormData => ({
  title: '',
  amount: '',
  currency: 'USD',
  dueDate: props.defaultDate || new Date().toISOString().split('T')[0],
  type: 'expense',
  status: 'pending',
  category: 'Other',
  recurring: false,
  recurringFrequency: 'monthly',
  bankTransfer: {
    bankName: '',
    accountNumber: '',
    accountHolder: '',
    routingNumber: '',
    swiftCode: '',
    iban: '',
    notes: ''
  },
  notes: ''
})

const form = reactive<PaymentFormData>(getDefaultForm())

watch(() => props.isOpen, (newVal) => {
  if (newVal) {
    if (props.payment) {
      isEditing.value = true
      Object.assign(form, {
        title: props.payment.title,
        amount: props.payment.amount,
        currency: props.payment.currency,
        dueDate: props.payment.dueDate.split('T')[0],
        type: props.payment.type,
        status: props.payment.status,
        category: props.payment.category,
        recurring: props.payment.recurring,
        recurringFrequency: props.payment.recurringFrequency || 'monthly',
        bankTransfer: props.payment.bankTransfer || getDefaultForm().bankTransfer,
        notes: props.payment.notes || ''
      })
      showBankTransfer.value = !!props.payment.bankTransfer?.bankName
    } else {
      isEditing.value = false
      Object.assign(form, getDefaultForm())
      if (props.defaultDate) {
        form.dueDate = props.defaultDate
      }
      showBankTransfer.value = false
    }
  }
})

const handleSubmit = () => {
  const data: PaymentFormData = {
    ...form,
    bankTransfer: showBankTransfer.value && form.bankTransfer?.bankName
      ? form.bankTransfer
      : undefined
  }
  emit('submit', data)
}
</script>
