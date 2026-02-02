<!-- components/transaction/TransactionFormModal.vue -->
<template>
  <Teleport to="body">
    <Transition name="slide-panel">
      <div v-if="modelValue" class="fixed inset-0 z-50 overflow-hidden">
        <!-- Backdrop -->
        <div
          class="absolute inset-0 bg-black/50 transition-opacity"
          @click="close"
        />

        <!-- Panel -->
        <div class="absolute inset-y-0 right-0 w-full sm:w-3/4 lg:w-1/2 flex flex-col bg-white dark:bg-gray-900 shadow-2xl border-l border-gray-200 dark:border-gray-700">

              <!-- Header -->
              <div class="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                <div class="px-6 py-4">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                      <div class="p-2 rounded-lg" :class="form.type === '入金' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'">
                        <TrendingUp v-if="form.type === '入金'" class="w-5 h-5 text-green-600 dark:text-green-400" />
                        <TrendingDown v-else class="w-5 h-5 text-red-600 dark:text-red-400" />
                      </div>
                      <div>
                        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
                          {{ isEditing ? t('transactionForm.editTitle') : t('transactionForm.createTitle') }}
                        </h2>
                        <p class="text-sm text-gray-500 dark:text-gray-400">
                          {{ form.type === '入金' ? t('transactions.income') : t('transactions.expense') }}
                        </p>
                      </div>
                    </div>
                    <button
                      @click="close"
                      class="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      <X class="w-5 h-5" />
                    </button>
                  </div>

                  <!-- Quick Type Toggle -->
                  <div class="mt-4 flex gap-2">
                    <button
                      type="button"
                      @click="form.type = '支出'"
                      :class="[
                        'flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all',
                        form.type === '支出'
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 ring-2 ring-red-500'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      ]"
                    >
                      <TrendingDown class="w-4 h-4 inline mr-2" />
                      {{ t('transactions.expense') }}
                    </button>
                    <button
                      type="button"
                      @click="form.type = '入金'"
                      :class="[
                        'flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all',
                        form.type === '入金'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 ring-2 ring-green-500'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      ]"
                    >
                      <TrendingUp class="w-4 h-4 inline mr-2" />
                      {{ t('transactions.income') }}
                    </button>
                  </div>
                </div>
              </div>

              <!-- Form Content -->
              <div class="flex-1 overflow-y-auto">
                <form @submit.prevent="submitForm" class="p-6 space-y-6 pb-32">

                  <!-- Essential Info Section -->
                  <section class="space-y-4">
                    <div class="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400">
                      <Info class="w-4 h-4" />
                      {{ t('transactionForm.essentialInfo') }}
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                      <!-- Date -->
                      <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                          {{ t('transactionForm.date') }}
                        </label>
                        <ClientOnly>
                          <VDatePicker
                            v-model="datePickerValue"
                            :is-dark="isDark"
                            :locale="locale"
                            :popover="{ visibility: 'click' }"
                            :masks="{ input: 'YYYY年MM月DD日' }"
                            @update:model-value="handleDateUpdate"
                          >
                            <template #default="{ inputValue, inputEvents }">
                              <input
                                :value="inputValue"
                                v-on="inputEvents"
                                class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent text-sm cursor-pointer"
                                :placeholder="t('transactionForm.date')"
                                readonly
                              />
                            </template>
                          </VDatePicker>
                          <template #fallback>
                            <input
                              type="date"
                              v-model="form.date"
                              class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                            />
                          </template>
                        </ClientOnly>
                      </div>

                      <!-- Amount -->
                      <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                          <Coins class="w-4 h-4 inline mr-1" />
                          {{ t('transactionForm.amount') }}
                        </label>
                        <div class="relative">
                          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">¥</span>
                          <input
                            type="text"
                            v-model="form.amount"
                            required
                            @input="formatAmount"
                            placeholder="10,000"
                            class="w-full h-11 pl-8 pr-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent transition-shadow text-right font-medium"
                          />
                        </div>
                      </div>
                    </div>
                  </section>

                  <!-- Categories Section -->
                  <section class="space-y-4">
                    <button
                      type="button"
                      @click="sections.categories = !sections.categories"
                      class="w-full flex items-center justify-between text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      <div class="flex items-center gap-2">
                        <FolderOpen class="w-4 h-4" />
                        {{ t('transactionForm.categoriesSection') }}
                      </div>
                      <ChevronDown :class="['w-4 h-4 transition-transform', sections.categories ? 'rotate-180' : '']" />
                    </button>

                    <Transition name="collapse">
                      <div v-show="sections.categories" class="space-y-4">
                        <div class="grid grid-cols-2 gap-4">
                          <!-- Account Category -->
                          <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              {{ t('transactionForm.accountCategory') }}
                            </label>
                            <select
                              v-model="form.accountCategoryId"
                              @change="handleAccountCategoryChange"
                              class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                            >
                              <option value="">{{ t('common.select') }}</option>
                              <option v-for="cat in accountCategories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
                            </select>
                          </div>

                          <!-- Sub Account Category -->
                          <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              {{ t('transactionForm.subAccountCategory') }}
                            </label>
                            <select
                              v-model="form.subAccountCategoryId"
                              class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                            >
                              <option value="">{{ t('common.select') }}</option>
                              <option v-for="cat in filteredSubAccountCategories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
                            </select>
                          </div>
                        </div>

                        <div class="grid grid-cols-2 gap-4">
                          <!-- Tax Category -->
                          <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              {{ t('transactionForm.taxCategory') }}
                            </label>
                            <select
                              v-model="form.taxCategoryId"
                              class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                            >
                              <option value="">{{ t('common.select') }}</option>
                              <option v-for="cat in taxCategories" :key="cat.id" :value="cat.name">{{ cat.name }}</option>
                            </select>
                          </div>

                          <!-- Tax Rate -->
                          <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              {{ t('transactionForm.taxRate') }}
                            </label>
                            <select
                              v-model="form.taxRate"
                              class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                            >
                              <option value="">{{ t('common.select') }}</option>
                              <option value="10%">10%</option>
                              <option value="8%">8%</option>
                              <option value="0%">0%</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </Transition>
                  </section>

                  <!-- Parties Section -->
                  <section class="space-y-4">
                    <button
                      type="button"
                      @click="sections.parties = !sections.parties"
                      class="w-full flex items-center justify-between text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      <div class="flex items-center gap-2">
                        <Users class="w-4 h-4" />
                        {{ t('transactionForm.partiesSection') }}
                      </div>
                      <ChevronDown :class="['w-4 h-4 transition-transform', sections.parties ? 'rotate-180' : '']" />
                    </button>

                    <Transition name="collapse">
                      <div v-show="sections.parties" class="space-y-4">
                        <div class="grid grid-cols-2 gap-4">
                          <!-- Customer -->
                          <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              {{ t('transactionForm.customer') }}
                            </label>
                            <select
                              v-model="form.customerId"
                              class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                            >
                              <option value="">{{ t('common.select') }}</option>
                              <option v-for="cust in customers" :key="cust.id" :value="cust.id">{{ cust.name }}</option>
                            </select>
                          </div>

                          <!-- Supplier -->
                          <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              {{ t('transactionForm.supplier') }}
                            </label>
                            <div class="relative">
                              <input
                                type="text"
                                v-model="supplierSearch"
                                @focus="showSupplierSuggestions = true"
                                @blur="onSupplierBlur"
                                :placeholder="t('transactionForm.searchSupplier')"
                                class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                              />
                              <div
                                v-if="showSupplierSuggestions && filteredSuppliers.length > 0"
                                class="absolute z-20 w-full mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-h-48 overflow-auto"
                              >
                                <button
                                  v-for="supplier in filteredSuppliers"
                                  :key="supplier.id"
                                  type="button"
                                  @mousedown="selectSupplier(supplier)"
                                  class="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100"
                                >
                                  {{ supplier.name }}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Transition>
                  </section>

                  <!-- Details Section -->
                  <section class="space-y-4">
                    <button
                      type="button"
                      @click="sections.details = !sections.details"
                      class="w-full flex items-center justify-between text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      <div class="flex items-center gap-2">
                        <FileText class="w-4 h-4" />
                        {{ t('transactionForm.detailsSection') }}
                      </div>
                      <ChevronDown :class="['w-4 h-4 transition-transform', sections.details ? 'rotate-180' : '']" />
                    </button>

                    <Transition name="collapse">
                      <div v-show="sections.details" class="space-y-4">
                        <div class="grid grid-cols-2 gap-4">
                          <!-- Receipt Number -->
                          <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              {{ t('transactionForm.receiptNumber') }}
                            </label>
                            <input
                              type="text"
                              v-model="form.receiptNumber"
                              :placeholder="t('transactionForm.receiptNumberPlaceholder')"
                              class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                            />
                          </div>

                          <!-- Invoice Number -->
                          <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              {{ t('transactionForm.invoiceNumber') }}
                            </label>
                            <input
                              type="text"
                              v-model="form.invoiceNumber"
                              placeholder="INV-12345"
                              class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                            />
                          </div>
                        </div>

                        <!-- Product Name -->
                        <div>
                          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {{ t('transactionForm.productName') }}
                          </label>
                          <input
                            type="text"
                            v-model="form.productName"
                            :placeholder="t('transactionForm.productNamePlaceholder')"
                            class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                          />
                        </div>

                        <!-- Notes -->
                        <div>
                          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {{ t('transactionForm.notes') }}
                          </label>
                          <textarea
                            v-model="form.notes"
                            rows="3"
                            :placeholder="t('transactionForm.notesPlaceholder')"
                            class="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent resize-none"
                          />
                        </div>
                      </div>
                    </Transition>
                  </section>

                  <!-- Receipt Upload Section -->
                  <section class="space-y-4">
                    <button
                      type="button"
                      @click="sections.receipt = !sections.receipt"
                      class="w-full flex items-center justify-between text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      <div class="flex items-center gap-2">
                        <Receipt class="w-4 h-4" />
                        {{ t('transactionForm.receiptSection') }}
                      </div>
                      <ChevronDown :class="['w-4 h-4 transition-transform', sections.receipt ? 'rotate-180' : '']" />
                    </button>

                    <Transition name="collapse">
                      <div v-show="sections.receipt">
                        <div
                          class="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center hover:border-primary-main dark:hover:border-primary-main transition-colors cursor-pointer"
                          @click="triggerFileUpload"
                          @dragover.prevent="isDragging = true"
                          @dragleave="isDragging = false"
                          @drop.prevent="handleDrop"
                          :class="{ 'border-primary-main bg-primary-light dark:bg-primary-dark/20': isDragging }"
                        >
                          <input
                            ref="fileInput"
                            type="file"
                            accept="image/*,.pdf"
                            class="hidden"
                            @change="handleFileUpload"
                          />
                          <Upload class="w-10 h-10 mx-auto text-gray-400 dark:text-gray-500 mb-2" />
                          <p class="text-sm text-gray-600 dark:text-gray-400">
                            {{ t('transactionForm.dropOrClick') }}
                          </p>
                          <p class="text-xs text-gray-500 dark:text-gray-500 mt-1">
                            PNG, JPG, PDF ({{ t('transactionForm.maxSize') }})
                          </p>
                        </div>

                        <div v-if="form.receiptFile" class="mt-3 flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                          <CheckCircle class="w-5 h-5 text-green-600 dark:text-green-400" />
                          <span class="text-sm text-green-700 dark:text-green-300 flex-1 truncate">{{ form.receiptFile.name }}</span>
                          <button type="button" @click="form.receiptFile = null" class="text-gray-400 hover:text-red-500">
                            <X class="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </Transition>
                  </section>

                </form>
              </div>

          <!-- Floating Actions -->
          <div class="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 px-6 py-4">
            <div class="flex items-center justify-between">
              <div class="text-sm text-gray-500 dark:text-gray-400">
                <span v-if="form.amount" class="font-medium text-gray-900 dark:text-white">
                  ¥{{ form.amount }}
                </span>
              </div>
              <div class="flex gap-3">
                <button
                  type="button"
                  @click="close"
                  class="px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  {{ t('common.cancel') }}
                </button>
                <button
                  type="button"
                  @click="submitForm"
                  :disabled="isSubmitting || !form.amount || !form.date"
                  class="px-5 py-2.5 text-sm font-medium text-white bg-primary-main rounded-lg hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  <Loader v-if="isSubmitting" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                  {{ isEditing ? t('common.update') : t('common.save') }}
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import {
  X, TrendingUp, TrendingDown, Coins, FolderOpen, Users, FileText,
  Receipt, Upload, ChevronDown, Info, Save, Loader, CheckCircle
} from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

const { t, locale } = useI18n()
const userStore = useUserStore()

// Check dark mode from document class
const isDark = computed(() => {
  if (process.client) {
    return document.documentElement.classList.contains('dark')
  }
  return false
})

const props = defineProps<{
  modelValue: boolean
  initialData?: any
  isEditing?: boolean
}>()

const emit = defineEmits(['update:modelValue', 'submit'])

const isSubmitting = ref(false)
const isDragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const showSupplierSuggestions = ref(false)
const supplierSearch = ref('')
const datePickerValue = ref<Date | null>(null)

const sections = ref({
  categories: true,
  parties: false,
  details: false,
  receipt: false
})

const form = ref({
  date: new Date().toISOString().split('T')[0],
  type: '支出',
  amount: '',
  customerId: '',
  accountCategoryId: '',
  subAccountCategoryId: '',
  taxCategoryId: '',
  taxRate: '',
  supplierId: '',
  receiptNumber: '',
  invoiceNumber: '',
  productName: '',
  notes: '',
  receiptFile: null as File | null
})

// Master data
const customers = ref<any[]>([])
const accountCategories = ref<any[]>([])
const subAccountCategories = ref<any[]>([])
const taxCategories = ref<any[]>([])
const suppliers = ref<any[]>([])

// Load master data
onMounted(async () => {
  userStore.initAuth()
  const headers = userStore.authHeader

  try {
    const [custData, acctData, subAcctData, taxData, supplierData] = await Promise.all([
      $fetch<any[]>('/api/customers', { headers }).catch(() => []),
      $fetch<any[]>('/api/account-categories?topLevel=true', { headers }).catch(() => []),
      $fetch<any[]>('/api/account-categories', { headers }).catch(() => []),
      $fetch<any[]>('/api/tax-categories', { headers }).catch(() => []),
      $fetch<any[]>('/api/suppliers', { headers }).catch(() => [])
    ])

    customers.value = custData.map((c: any) => ({ id: c.id || c._id, name: c.name }))
    accountCategories.value = acctData.map((c: any) => ({ id: c.id || c._id, name: c.name }))
    subAccountCategories.value = subAcctData.filter((c: any) => c.parentId).map((c: any) => ({ id: c.id || c._id, name: c.name, parentId: c.parentId }))
    taxCategories.value = taxData.map((c: any) => ({ id: c.id || c._id, name: c.name }))
    suppliers.value = supplierData.map((s: any) => ({ id: s.id || s._id, name: s.name }))
  } catch (e) {
    console.error('Failed to load master data:', e)
  }
})

// Watch for initial data
watch(() => props.initialData, (data) => {
  if (data && props.isEditing) {
    const dateValue = data.date ? new Date(data.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
    form.value = {
      date: dateValue,
      type: data.type || '支出',
      amount: data.amount ? formatNumberWithCommas(String(data.amount)) : '',
      customerId: data.customerId || '',
      accountCategoryId: data.accountCategoryId || '',
      subAccountCategoryId: data.subAccountCategoryId || '',
      taxCategoryId: data.taxCategoryId || '',
      taxRate: data.taxRate ? `${data.taxRate}%` : '',
      supplierId: data.supplierId || '',
      receiptNumber: data.receiptNumber || '',
      invoiceNumber: data.invoiceNumber || '',
      productName: data.productName || '',
      notes: data.notes || '',
      receiptFile: null
    }
    // Sync date picker value
    datePickerValue.value = new Date(dateValue)
    if (data.supplierId) {
      const supplier = suppliers.value.find(s => s.id === data.supplierId)
      if (supplier) supplierSearch.value = supplier.name
    }
  }
}, { immediate: true })

// Initialize datePickerValue from form.date on mount
watch(() => form.value.date, (newDate) => {
  if (newDate && !datePickerValue.value) {
    datePickerValue.value = new Date(newDate)
  }
}, { immediate: true })

const filteredSubAccountCategories = computed(() => {
  if (form.value.accountCategoryId) {
    return subAccountCategories.value.filter(s => s.parentId === form.value.accountCategoryId)
  }
  return subAccountCategories.value
})

const filteredSuppliers = computed(() => {
  if (!supplierSearch.value) return []
  return suppliers.value.filter(s => s.name.toLowerCase().includes(supplierSearch.value.toLowerCase()))
})

const close = () => emit('update:modelValue', false)

// Handle date picker update
const handleDateUpdate = (value: Date | null) => {
  if (value) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    form.value.date = `${year}-${month}-${day}`
  } else {
    form.value.date = ''
  }
}

const handleAccountCategoryChange = () => {
  form.value.subAccountCategoryId = ''
}

const formatAmount = () => {
  form.value.amount = formatNumberWithCommas(form.value.amount)
}

const formatNumberWithCommas = (value: string) => {
  const plain = value.replace(/,/g, '')
  if (!plain || isNaN(Number(plain))) return plain
  return plain.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const parseNumber = (value: string) => Number(value.replace(/,/g, ''))

const selectSupplier = (supplier: any) => {
  supplierSearch.value = supplier.name
  form.value.supplierId = supplier.id
  showSupplierSuggestions.value = false
}

const onSupplierBlur = () => {
  setTimeout(() => { showSupplierSuggestions.value = false }, 200)
}

const triggerFileUpload = () => {
  fileInput.value?.click()
}

const handleFileUpload = (e: Event) => {
  const input = e.target as HTMLInputElement
  if (input.files?.[0]) {
    form.value.receiptFile = input.files[0]
  }
}

const handleDrop = (e: DragEvent) => {
  isDragging.value = false
  if (e.dataTransfer?.files?.[0]) {
    form.value.receiptFile = e.dataTransfer.files[0]
  }
}

const submitForm = async () => {
  isSubmitting.value = true
  try {
    const data: any = {
      date: new Date(form.value.date).toISOString(),
      type: form.value.type,
      amount: parseNumber(form.value.amount),
      status: 'pending',
      receiptNumber: form.value.receiptNumber,
      invoiceNumber: form.value.invoiceNumber,
      productName: form.value.productName,
      notes: form.value.notes,
      hasReceipt: !!form.value.receiptFile
    }

    if (form.value.customerId) data.customerId = form.value.customerId
    if (form.value.accountCategoryId) data.accountCategoryId = form.value.accountCategoryId
    if (form.value.subAccountCategoryId) data.subAccountCategoryId = form.value.subAccountCategoryId
    if (form.value.taxCategoryId) data.taxCategoryId = form.value.taxCategoryId
    if (form.value.taxRate) data.taxRate = parseFloat(form.value.taxRate.replace('%', ''))
    if (form.value.supplierId) data.supplierId = form.value.supplierId

    emit('submit', data)
    close()
  } finally {
    isSubmitting.value = false
  }
}
</script>

<style scoped>
.slide-panel-enter-active,
.slide-panel-leave-active {
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-panel-enter-active > div:first-child,
.slide-panel-leave-active > div:first-child {
  transition: opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-panel-enter-active > div:nth-child(2),
.slide-panel-leave-active > div:nth-child(2) {
  transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-panel-enter-from > div:first-child,
.slide-panel-leave-to > div:first-child {
  opacity: 0;
}

.slide-panel-enter-from > div:nth-child(2),
.slide-panel-leave-to > div:nth-child(2) {
  transform: translateX(100%);
}

.collapse-enter-active,
.collapse-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.collapse-enter-from,
.collapse-leave-to {
  opacity: 0;
  max-height: 0;
}

.collapse-enter-to,
.collapse-leave-from {
  opacity: 1;
  max-height: 500px;
}
</style>
