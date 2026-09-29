<template>
  <div
    v-if="isOpen"
    data-payment-modal
    class="fixed inset-0 z-50 overflow-y-auto"
    @click.self="$emit('close')"
  >
    <div class="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
      <!-- Backdrop -->
      <div class="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity" @click="$emit('close')"></div>

      <!-- Modal -->
      <div class="relative bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:max-w-lg sm:w-full">
        <form @submit.prevent="handleSubmit">
          <!-- Header -->
          <div class="px-6 py-4 border-b dark:border-white/10 flex items-center justify-between">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ isEditing ? t('paymentModal.editPayment') : t('paymentModal.addPayment') }}
            </h3>
            <button
              type="button"
              data-close-payment
              @click="$emit('close')"
              class="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            >
              <X class="h-5 w-5" />
            </button>
          </div>

          <p v-if="error" role="alert" class="mx-6 mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ error }}</p>
          <div v-if="terminal || pending || needsRecovery" data-payment-recovery class="mx-6 mt-4 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-gray-800">
            <p v-if="terminal">{{ t('calendar.recovery.deleted') }}</p>
            <p v-else-if="pending">{{ t('calendar.recovery.pending') }}</p>
            <p v-else-if="missing">{{ t('calendar.recovery.missing') }}</p>
            <p v-else>{{ t('calendar.recovery.draftKept') }}</p>
            <p v-if="terminal && currentPayment" data-terminal-summary class="font-medium">{{ currentPayment.title }} · {{ currentPayment.amount }} {{ currentPayment.currency }} · {{ currentPayment.dueDate.split('T')[0] }}</p>
            <p v-if="recovery?.state === 'failed'" class="text-red-700">{{ t('calendar.recovery.refreshFailed') }}</p>
            <div class="flex flex-wrap gap-3">
              <button type="button" data-refresh-payment :disabled="busy || recovery?.state === 'loading'" class="font-medium text-primary-main underline" @click="$emit('refresh')">{{ t('calendar.recovery.refresh') }}</button>
              <button v-if="pending && !readOnly" type="button" data-resume-payment :disabled="busy" class="font-medium text-primary-main underline" @click="$emit('complete', savedPayment || payment!)">{{ t('calendar.recovery.resume') }}</button>
            </div>
            <details v-if="canLoadSaved" data-saved-comparison>
              <summary class="cursor-pointer font-medium">{{ t('calendar.recovery.compare') }}</summary>
              <div class="mt-2 max-h-44 space-y-2 overflow-y-auto">
                <div v-for="difference in differences" :key="difference.field" :data-comparison-field="difference.field" class="rounded-lg bg-white p-2">
                  <p class="font-medium">{{ t(`calendar.recovery.fields.${difference.field}`) }}</p>
                  <p class="break-words">{{ t('calendar.recovery.yourDraft') }}: {{ difference.draft }}</p>
                  <p class="break-words">{{ t('calendar.recovery.saved') }}: {{ difference.saved }}</p>
                </div>
                <p v-if="!differences.length">{{ t('calendar.recovery.sameValues') }}</p>
              </div>
              <p class="mt-3 text-xs text-gray-600">{{ t('calendar.recovery.replaceDraft') }}</p>
              <button type="button" data-use-saved :disabled="busy" class="mt-2 font-medium text-primary-main underline" @click="$emit('use-saved')">{{ t('calendar.recovery.useSaved') }}</button>
            </details>
          </div>
          <fieldset :disabled="readOnly || busy || pending">
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
                    : 'border-gray-300 dark:border-white/10 hover:border-primary-main hover:bg-primary-light/10 dark:hover:bg-primary-dark/10'
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
            <div class="flex rounded-lg bg-gray-100 dark:bg-white/5 p-1">
              <button
                type="button"
                @click="form.type = 'expense'"
                :class="[
                  'flex-1 py-2 text-sm font-medium rounded-md transition-colors',
                  form.type === 'expense'
                    ? 'bg-white dark:bg-slate-600 text-error-main shadow'
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
                    ? 'bg-white dark:bg-slate-600 text-success-main shadow'
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
                data-payment-field="title" v-model="form.title"
                type="text"
                required
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-white/5 dark:text-white"
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
                  data-payment-field="amount" v-model="form.amount"
                  type="number"
                  step="1"
                  min="0"
                  required
                  class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-white/5 dark:text-white"
                  placeholder="0"
                />
              </div>
              <div v-if="settingsStore.isMultiCurrencyEnabled">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {{ t('paymentModal.currency') }}
                </label>
                <select
                  data-payment-field="currency" v-model="form.currency"
                  class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-white/5 dark:text-white"
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
                  data-payment-field="dueDate" v-model="form.dueDate"
                  type="date"
                  required
                  class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-white/5 dark:text-white"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {{ t('paymentModal.category') }} *
                </label>
                <select
                  data-payment-field="category" v-model="form.category"
                  required
                  class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-white/5 dark:text-white"
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
                data-payment-field="status" v-model="form.status"
                :disabled="!!payment?.completionState || ['paid', 'completed'].includes(payment?.status || '')"
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-white/5 dark:text-white"
              >
                <option value="pending">{{ t('paymentModal.statuses.pending') }}</option>
                <option :disabled="payment?.status !== 'paid'" value="paid">{{ t('paymentModal.statuses.paid') }}</option>
                <option :disabled="payment?.status !== 'completed'" value="completed">{{ t('paymentModal.statuses.completed') }}</option>
                <option value="overdue">{{ t('paymentModal.statuses.overdue') }}</option>
                <option value="cancelled">{{ t('paymentModal.statuses.cancelled') }}</option>
              </select>
            </div>

            <!-- Recurring -->
            <div class="flex items-center space-x-4">
              <label class="flex items-center">
                <input
                  data-payment-field="recurring" v-model="form.recurring"
                  type="checkbox"
                  class="rounded border-gray-300 dark:border-white/10 text-primary-main focus:ring-primary-main"
                />
                <span class="ml-2 text-sm text-gray-700 dark:text-gray-300">{{ t('paymentModal.recurringPayment') }}</span>
              </label>
              <select
                v-if="form.recurring"
                data-payment-field="recurringFrequency" v-model="form.recurringFrequency"
                class="px-3 py-1 text-sm border border-gray-300 dark:border-white/10 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-white/5 dark:text-white"
              >
                <option value="weekly">{{ t('recurring.frequencies.weekly') }}</option>
                <option value="monthly">{{ t('recurring.frequencies.monthly') }}</option>
                <option value="quarterly">{{ t('recurring.frequencies.quarterly') }}</option>
                <option value="yearly">{{ t('recurring.frequencies.yearly') }}</option>
              </select>
            </div>

            <!-- Bank Transfer Toggle -->
            <div class="border-t dark:border-white/10 pt-4">
              <button
                type="button"
                data-bank-transfer-toggle @click="showBankTransfer = !showBankTransfer"
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
                      data-payment-field="bankTransfer.bankName" v-model="form.bankTransfer.bankName"
                      type="text"
                      class="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-white/10 rounded-md dark:bg-white/5 dark:text-white"
                      :placeholder="t('paymentModal.bankNamePlaceholder')"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('paymentModal.branchName') }}</label>
                    <input
                      data-payment-field="bankTransfer.branchName" v-model="form.bankTransfer.branchName"
                      type="text"
                      class="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-white/10 rounded-md dark:bg-white/5 dark:text-white"
                      :placeholder="t('paymentModal.branchNamePlaceholder')"
                    />
                  </div>
                </div>
                <!-- Row 2: Account Type & Account Number -->
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('paymentModal.accountType') }}</label>
                    <select
                      data-payment-field="bankTransfer.accountType" v-model="form.bankTransfer.accountType"
                      class="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-white/10 rounded-md dark:bg-white/5 dark:text-white"
                    >
                      <option value="ordinary">{{ t('paymentModal.accountTypes.ordinary') }}</option>
                      <option value="current">{{ t('paymentModal.accountTypes.current') }}</option>
                      <option value="savings">{{ t('paymentModal.accountTypes.savings') }}</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('paymentModal.accountNumber') }}</label>
                    <input
                      data-payment-field="bankTransfer.accountNumber" v-model="form.bankTransfer.accountNumber"
                      type="text"
                      class="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-white/10 rounded-md dark:bg-white/5 dark:text-white"
                      :placeholder="t('paymentModal.accountNumberPlaceholder')"
                    />
                  </div>
                </div>
                <!-- Row 3: Account Holder -->
                <div>
                  <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('paymentModal.accountHolder') }}</label>
                  <input
                    data-payment-field="bankTransfer.accountHolder" v-model="form.bankTransfer.accountHolder"
                    type="text"
                    class="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-white/10 rounded-md dark:bg-white/5 dark:text-white"
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
                data-payment-field="notes" v-model="form.notes"
                rows="2"
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main dark:bg-white/5 dark:text-white"
                :placeholder="t('paymentModal.notesPlaceholder')"
              ></textarea>
            </div>
          </div>

          </fieldset>
          <!-- Footer -->
          <div class="px-6 py-4 border-t dark:border-white/10 flex justify-between">
            <button
              v-if="isEditing && !readOnly && !pending && !missing"
              :disabled="busy || recovery?.state === 'loading' || recovery?.state === 'failed'"
              type="button"
              data-delete-payment
              @click="$emit('delete', terminal ? (savedPayment || payment!) : payment!)"
              class="px-4 py-2 text-sm font-medium text-error-main hover:bg-error-light dark:hover:bg-error-dark/20 rounded-xl"
            >
              {{ t(terminal ? 'calendar.recovery.removeEntry' : 'common.delete') }}
            </button>
            <div v-else></div>
            <div class="flex space-x-3">
              <button
                type="button"
                @click="$emit('close')"
                class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                v-if="!readOnly && !missing && !terminal"
                :disabled="busy || pending"
                data-save-payment
                type="submit"
                class="px-4 py-2 text-sm font-medium text-white bg-primary-main hover:bg-primary-dark rounded-xl"
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
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { X, ChevronDown, ChevronRight, Camera, Loader2 } from 'lucide-vue-next'
import type { Payment, PaymentFormData, BankTransferInfo, CalendarRecovery } from '~/types/calendar'
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
  readOnly?: boolean
  busy?: boolean
  error?: string | null
  isOpen: boolean
  payment?: Payment | null
  savedPayment?: Payment | null
  recovery?: CalendarRecovery | null
  defaultDate?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', data: PaymentFormData): void
  (e: 'delete', payment: Payment): void
  (e: 'refresh'): void
  (e: 'use-saved'): void
  (e: 'complete', payment: Payment): void
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

type PaymentDraft = PaymentFormData & { bankTransfer: BankTransferInfo }

const getDefaultForm = (): PaymentDraft => ({
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

const form = reactive<PaymentDraft>(getDefaultForm())

const currentPayment = computed(() => props.savedPayment || props.payment)
const terminal = computed(() => currentPayment.value?.completionState === 'deleted')
const pending = computed(() => currentPayment.value?.completionState === 'pending')
const missing = computed(() => props.recovery?.state === 'ready' && !props.savedPayment)
const needsRecovery = computed(() => !!props.recovery || (!!props.savedPayment && props.savedPayment.revision !== props.payment?.revision))
const canLoadSaved = computed(() => !!props.savedPayment && !['loading', 'failed'].includes(props.recovery?.state || ''))
const shownValue = (value: unknown, field?: string): string => {
  if (value === undefined || value === null || value === '') return '—'
  if (field === 'status') return t(`paymentModal.statuses.${value}`)
  if (field === 'type') return t(`paymentModal.${value}`)
  if (field === 'recurringFrequency') return t(`recurring.frequencies.${value}`)
  if (typeof value === 'boolean') return t(`calendar.recovery.${value ? 'enabled' : 'disabled'}`)
  if (typeof value === 'object') return Object.values(value).filter(Boolean).join(' / ') || '—'
  return String(value)
}
const differences = computed(() => {
  if (!props.savedPayment) return []
  return (Object.keys(form) as (keyof PaymentFormData)[]).flatMap(field => {
    let saved = field === 'dueDate' ? props.savedPayment!.dueDate.split('T')[0] : props.savedPayment![field]
    let draft = form[field]
    if (field === 'recurringFrequency') {
      saved = props.savedPayment!.recurring ? saved : undefined
      draft = form.recurring ? draft : undefined
    } else if (field === 'bankTransfer') {
      saved = props.savedPayment!.bankTransfer?.bankName ? saved : undefined
      draft = showBankTransfer.value && form.bankTransfer?.bankName ? draft : undefined
    }
    return shownValue(saved, field) === shownValue(draft, field) ? [] : [{ field, draft: shownValue(draft, field), saved: shownValue(saved, field) }]
  })
})

watch([() => props.isOpen, () => props.payment], ([newVal]) => {
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
        bankTransfer: props.payment.bankTransfer ? JSON.parse(JSON.stringify(props.payment.bankTransfer)) : getDefaultForm().bankTransfer,
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
  if (props.readOnly || props.busy || pending.value || missing.value || terminal.value) return
  const data: PaymentFormData = {
    ...form,
    bankTransfer: showBankTransfer.value && form.bankTransfer?.bankName
      ? form.bankTransfer
      : undefined
  }
  emit('submit', data)
}
</script>
