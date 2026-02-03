<template>
  <div>
    <header class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-800 dark:text-gray-100">{{ t('vendors.title') }}</h1>
        <p class="text-gray-600 dark:text-gray-400">{{ t('vendors.description') }}</p>
      </div>
      <div class="mt-4 md:mt-0 flex space-x-3">
        <button
            @click="syncVendors"
            class="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <RefreshCw class="h-4 w-4 mr-2" :class="isSyncing ? 'animate-spin' : ''" />
          {{ t('vendors.syncFromTransactions') }}
        </button>
        <button
            @click="openModal()"
            class="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
        >
          <Plus class="h-4 w-4 mr-2" />
          {{ t('vendors.newVendor') }}
        </button>
      </div>
    </header>

    <!-- Search -->
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 mb-6">
      <input
          v-model="searchQuery"
          @input="debouncedSearch"
          type="text"
          :placeholder="t('vendors.searchPlaceholder')"
          class="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md px-4 py-2"
      />
    </div>

    <!-- Vendors Grid -->
    <div v-if="isLoading" class="text-center py-8 text-gray-500">{{ t('common.loading') }}</div>
    <div v-else-if="vendors.length === 0" class="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-8 text-center text-gray-500">
      {{ t('vendors.noVendors') }}
    </div>
    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
          v-for="vendor in vendors"
          :key="vendor.id"
          class="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 hover:shadow-md transition-shadow cursor-pointer"
          @click="viewVendor(vendor)"
      >
        <div class="flex items-start justify-between">
          <div>
            <h3 class="font-medium text-gray-900 dark:text-gray-100">{{ vendor.name }}</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ vendor.category || 'Uncategorized' }}</p>
          </div>
          <span
              class="px-2 py-1 text-xs rounded-full"
              :class="vendor.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'"
          >
            {{ vendor.isActive ? t('vendors.active') : t('vendors.inactive') }}
          </span>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-4">
          <div>
            <div class="text-xs text-gray-500 dark:text-gray-400">{{ t('vendors.totalSpent') }}</div>
            <div class="font-medium text-gray-900 dark:text-gray-100">{{ formatCurrency(vendor.totalSpent) }}</div>
          </div>
          <div>
            <div class="text-xs text-gray-500 dark:text-gray-400">{{ t('vendors.transactionCount') }}</div>
            <div class="font-medium text-gray-900 dark:text-gray-100">{{ vendor.transactionCount }}</div>
          </div>
        </div>

        <div v-if="vendor.lastTransactionDate" class="mt-3 text-xs text-gray-400">
          {{ t('vendors.lastTransaction') }}: {{ formatDate(vendor.lastTransactionDate) }}
        </div>
      </div>
    </div>

    <!-- Modal -->
    <div v-if="showModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div class="fixed inset-0 bg-black/50" @click="showModal = false"></div>
        <div class="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
          <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
            {{ editingVendor ? t('vendors.editVendor') : t('vendors.newVendor') }}
          </h3>

          <form @submit.prevent="saveVendor" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('vendors.vendorName') }}</label>
              <input v-model="form.name" type="text" required class="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md px-3 py-2" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('common.category') }}</label>
              <input v-model="form.category" type="text" class="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md px-3 py-2" />
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('vendors.email') }}</label>
                <input v-model="form.email" type="email" class="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md px-3 py-2" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('vendors.phone') }}</label>
                <input v-model="form.phone" type="text" class="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md px-3 py-2" />
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('vendors.notes') }}</label>
              <textarea v-model="form.notes" rows="2" class="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md px-3 py-2"></textarea>
            </div>

            <div class="flex justify-end space-x-3 pt-4">
              <button type="button" @click="showModal = false" class="px-4 py-2 text-gray-700 dark:text-gray-300">{{ t('common.cancel') }}</button>
              <button type="submit" class="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700">{{ t('common.save') }}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { Plus, RefreshCw } from 'lucide-vue-next'

const { t, locale } = useI18n()

const isLoading = ref(false)
const isSyncing = ref(false)
const showModal = ref(false)
const vendors = ref<any[]>([])
const editingVendor = ref<any>(null)
const searchQuery = ref('')

const form = reactive({
  name: '',
  category: '',
  email: '',
  phone: '',
  notes: ''
})

let searchTimeout: any = null
const debouncedSearch = () => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => loadVendors(), 300)
}

const loadVendors = async () => {
  isLoading.value = true
  try {
    const params = new URLSearchParams()
    if (searchQuery.value) params.set('search', searchQuery.value)
    const data = await $fetch(`/api/vendors?${params.toString()}`)
    vendors.value = data.vendors
  } catch (error) {
    console.error('Failed to load vendors:', error)
  } finally {
    isLoading.value = false
  }
}

const syncVendors = async () => {
  isSyncing.value = true
  try {
    await $fetch('/api/vendors?sync=true')
    loadVendors()
  } catch (error) {
    console.error('Failed to sync:', error)
  } finally {
    isSyncing.value = false
  }
}

const openModal = (vendor?: any) => {
  if (vendor) {
    editingVendor.value = vendor
    form.name = vendor.name
    form.category = vendor.category || ''
    form.email = vendor.email || ''
    form.phone = vendor.phone || ''
    form.notes = vendor.notes || ''
  } else {
    editingVendor.value = null
    form.name = ''
    form.category = ''
    form.email = ''
    form.phone = ''
    form.notes = ''
  }
  showModal.value = true
}

const saveVendor = async () => {
  try {
    if (editingVendor.value) {
      await $fetch(`/api/vendors/${editingVendor.value.id}`, { method: 'PUT', body: form })
    } else {
      await $fetch('/api/vendors', { method: 'POST', body: form })
    }
    showModal.value = false
    loadVendors()
  } catch (error) {
    console.error('Failed to save:', error)
  }
}

const viewVendor = (vendor: any) => {
  openModal(vendor)
}

const formatCurrency = (value: number) => {
  const currencyLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  const currency = locale.value === 'ko' ? 'KRW' : 'JPY'
  return new Intl.NumberFormat(currencyLocale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value || 0)
}

const formatDate = (date: string) => {
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(date).toLocaleDateString(dateLocale)
}

onMounted(() => loadVendors())
</script>
