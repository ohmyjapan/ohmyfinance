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
              {{ isEditing ? t('paymentModal.editPayment') : t('paymentModal.addPayment') }}
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
            <!-- Invoice Scan (only show when adding new) -->
            <div v-if="!isEditing" class="relative">
              <input
                ref="invoiceInput"
                type="file"
                accept="image/*,.pdf"
                class="hidden"
                @change="handleInvoiceScan"
              />
              <button
                type="button"
                @click="invoiceInput?.click()"
                :disabled="isScanning"
                :class="[
                  'w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed rounded-lg transition-all',
                  isScanning
                    ? 'border-primary-main bg-primary-light/20 dark:bg-primary-dark/20'
                    : 'border-gray-300 dark:border-gray-600 hover:border-primary-main hover:bg-primary-light/10 dark:hover:bg-primary-dark/10'
                ]"
              >
                <Loader2 v-if="isScanning" class="w-5 h-5 text-primary-main animate-spin" />
                <Camera v-else class="w-5 h-5 text-gray-400" />
                <span :class="isScanning ? 'text-primary-main' : 'text-gray-600 dark:text-gray-400'">
                  {{ isScanning ? t('paymentModal.scanning') : t('paymentModal.scanInvoice') }}
                </span>
              </button>
              <p v-if="scanError" class="mt-1 text-xs text-error-main">{{ scanError }}</p>
            </div>

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
                {{ t('paymentModal.expense') }}
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
                {{ t('paymentModal.income') }}
              </button>
            </div>

            <!-- Title -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ t('paymentModal.title') }} *
              </label>
              <input
                v-model="form.title"
                type="text"
                required
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-gray-700 dark:text-white"
                :placeholder="t('paymentModal.titlePlaceholder')"
              />
            </div>

            <!-- Amount & Currency -->
            <div :class="settingsStore.isMultiCurrencyEnabled ? 'grid grid-cols-2 gap-4' : ''">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {{ t('paymentModal.amount') }} ({{ settingsStore.defaultCurrency }}) *
                </label>
                <input
                  v-model="form.amount"
                  type="number"
                  step="1"
                  min="0"
                  required
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-gray-700 dark:text-white"
                  placeholder="0"
                />
              </div>
              <div v-if="settingsStore.isMultiCurrencyEnabled">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {{ t('paymentModal.currency') }}
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
                  {{ t('paymentModal.dueDate') }} *
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
                  {{ t('paymentModal.category') }} *
                </label>
                <select
                  v-model="form.category"
                  required
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-gray-700 dark:text-white"
                >
                  <option v-for="cat in PAYMENT_CATEGORIES" :key="cat" :value="cat">
                    {{ t(`paymentModal.categories.${cat.toLowerCase().replace(/\s+/g, '_')}`) }}
                  </option>
                </select>
              </div>
            </div>

            <!-- Status (only for editing) -->
            <div v-if="isEditing">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ t('common.status') }}
              </label>
              <select
                v-model="form.status"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-gray-700 dark:text-white"
              >
                <option value="pending">{{ t('paymentModal.statuses.pending') }}</option>
                <option value="paid">{{ t('paymentModal.statuses.paid') }}</option>
                <option value="completed">{{ t('paymentModal.statuses.completed') }}</option>
                <option value="overdue">{{ t('paymentModal.statuses.overdue') }}</option>
                <option value="cancelled">{{ t('paymentModal.statuses.cancelled') }}</option>
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
                <span class="ml-2 text-sm text-gray-700 dark:text-gray-300">{{ t('paymentModal.recurringPayment') }}</span>
              </label>
              <select
                v-if="form.recurring"
                v-model="form.recurringFrequency"
                class="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-gray-700 dark:text-white"
              >
                <option value="weekly">{{ t('recurring.frequencies.weekly') }}</option>
                <option value="monthly">{{ t('recurring.frequencies.monthly') }}</option>
                <option value="quarterly">{{ t('recurring.frequencies.quarterly') }}</option>
                <option value="yearly">{{ t('recurring.frequencies.yearly') }}</option>
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
                {{ t('paymentModal.bankTransferInfo') }}
              </button>

              <div v-if="showBankTransfer" class="mt-4 space-y-3 pl-6">
                <!-- Row 1: Bank Name & Branch Name -->
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('paymentModal.bankName') }}</label>
                    <input
                      v-model="form.bankTransfer.bankName"
                      type="text"
                      class="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
                      :placeholder="t('paymentModal.bankNamePlaceholder')"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('paymentModal.branchName') }}</label>
                    <input
                      v-model="form.bankTransfer.branchName"
                      type="text"
                      class="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
                      :placeholder="t('paymentModal.branchNamePlaceholder')"
                    />
                  </div>
                </div>
                <!-- Row 2: Account Type & Account Number -->
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('paymentModal.accountType') }}</label>
                    <select
                      v-model="form.bankTransfer.accountType"
                      class="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
                    >
                      <option value="ordinary">{{ t('paymentModal.accountTypes.ordinary') }}</option>
                      <option value="current">{{ t('paymentModal.accountTypes.current') }}</option>
                      <option value="savings">{{ t('paymentModal.accountTypes.savings') }}</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('paymentModal.accountNumber') }}</label>
                    <input
                      v-model="form.bankTransfer.accountNumber"
                      type="text"
                      class="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
                      :placeholder="t('paymentModal.accountNumberPlaceholder')"
                    />
                  </div>
                </div>
                <!-- Row 3: Account Holder -->
                <div>
                  <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('paymentModal.accountHolder') }}</label>
                  <input
                    v-model="form.bankTransfer.accountHolder"
                    type="text"
                    class="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
                    :placeholder="t('paymentModal.accountHolderPlaceholder')"
                  />
                </div>
              </div>
            </div>

            <!-- Notes -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ t('common.notes') }}
              </label>
              <textarea
                v-model="form.notes"
                rows="2"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-gray-700 dark:text-white"
                :placeholder="t('paymentModal.notesPlaceholder')"
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
              {{ t('common.delete') }}
            </button>
            <div v-else></div>
            <div class="flex space-x-3">
              <button
                type="button"
                @click="$emit('close')"
                class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                type="submit"
                class="px-4 py-2 text-sm font-medium text-white bg-primary-main hover:bg-primary-dark rounded-md"
              >
                {{ isEditing ? t('paymentModal.update') : t('paymentModal.addPayment') }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue'
import { X, ChevronDown, ChevronRight, Camera, Loader2 } from 'lucide-vue-next'
import type { Payment, PaymentFormData, BankTransferInfo } from '~/types/calendar'
import { PAYMENT_CATEGORIES, CURRENCIES, DEFAULT_CURRENCY } from '~/types/calendar'
import { useSettingsStore } from '~/stores/settings'

const { t } = useI18n()
const settingsStore = useSettingsStore()

// Format date to YYYY-MM-DD in local timezone (JST)
const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

onMounted(() => {
  settingsStore.initSettings()
})

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
const isScanning = ref(false)
const scanError = ref('')
const invoiceInput = ref<HTMLInputElement | null>(null)

// Handle invoice scan with Gemini
const handleInvoiceScan = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  if (!file) return

  isScanning.value = true
  scanError.value = ''

  try {
    const formData = new FormData()
    formData.append('invoice', file)

    const response = await fetch('/api/invoices/scan', {
      method: 'POST',
      body: formData
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.statusMessage || 'Failed to scan invoice')
    }

    const result = await response.json()

    if (result.success && result.data) {
      // Auto-fill the form with extracted data
      const data = result.data

      if (data.title) form.title = data.title
      if (data.amount) form.amount = data.amount
      if (data.currency) form.currency = data.currency
      if (data.dueDate) form.dueDate = data.dueDate

      // Fill bank transfer info if available
      if (data.bankTransfer) {
        const bt = data.bankTransfer
        if (bt.bankName || bt.branchName || bt.accountNumber) {
          showBankTransfer.value = true
          form.bankTransfer = {
            bankName: bt.bankName || '',
            branchName: bt.branchName || '',
            accountType: bt.accountType || 'ordinary',
            accountNumber: bt.accountNumber || '',
            accountHolder: bt.accountHolder || ''
          }
        }
      }
    }
  } catch (error: any) {
    console.error('Invoice scan error:', error)
    scanError.value = error.message || 'スキャンに失敗しました'
  } finally {
    isScanning.value = false
    // Reset the input so the same file can be selected again
    if (input) input.value = ''
  }
}

const getDefaultForm = (): PaymentFormData => ({
  title: '',
  amount: '',
  currency: settingsStore.defaultCurrency || DEFAULT_CURRENCY,
  dueDate: props.defaultDate || formatLocalDate(new Date()),
  type: 'expense',
  status: 'pending',
  category: 'Term Credit Card',
  recurring: false,
  recurringFrequency: 'monthly',
  bankTransfer: {
    bankName: '',
    branchName: '',
    accountType: 'ordinary',
    accountNumber: '',
    accountHolder: ''
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
