<template>
  <div>
    <!-- Page Header -->
    <div class="mb-8">
      <div class="bg-gradient-to-r from-primary-main to-primary-dark dark:from-primary-dark dark:to-primary-dark/80 rounded-2xl p-6 text-white relative overflow-hidden">
        <div class="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
        <div class="absolute -bottom-8 -left-8 w-32 h-32 bg-white/5 rounded-full blur-2xl"></div>
        <div class="flex flex-col md:flex-row md:items-center md:justify-between relative z-10">
          <div>
            <h1 class="text-2xl font-bold mb-1">{{ t('vendors.title') }}</h1>
            <p class="text-primary-light">{{ t('vendors.description') }}</p>
          </div>
          <div class="mt-4 md:mt-0 flex items-center gap-3">
            <button
              @click="syncVendors"
              class="inline-flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl backdrop-blur-sm transition-all duration-300 touch-manipulation"
            >
              <RefreshCw class="h-4 w-4" :class="isSyncing ? 'animate-spin' : ''" />
              {{ t('vendors.syncFromTransactions') }}
            </button>
            <button
              @click="openModal()"
              class="inline-flex items-center gap-2 px-5 py-2.5 bg-white/20 hover:bg-white/30 text-white rounded-xl backdrop-blur-sm transition-all duration-300 touch-manipulation"
            >
              <Plus class="h-5 w-5" />
              {{ t('vendors.newVendor') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Stat Cards -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <StatCard
        :title="t('common.total')"
        :value="vendors.length.toString()"
        icon="Package"
        color="blue"
      />
      <StatCard
        :title="t('vendors.totalSpent')"
        :value="formatCurrency(totalSpent)"
        icon="DollarSign"
        color="red"
      />
      <StatCard
        :title="t('vendors.active')"
        :value="activeCount.toString()"
        icon="Activity"
        color="green"
      />
    </div>

    <!-- Search -->
    <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4 mb-6">
      <div class="flex items-center gap-3">
        <Search class="w-5 h-5 text-gray-400" />
        <input
          v-model="searchQuery"
          @input="debouncedSearch"
          type="text"
          :placeholder="t('vendors.searchPlaceholder')"
          class="flex-1 bg-transparent border-none outline-none text-gray-900 dark:text-white placeholder-gray-400"
        />
      </div>
    </div>

    <!-- Vendors Grid -->
    <div v-if="isLoading" class="flex items-center justify-center py-12">
      <Loader2 class="w-8 h-8 text-primary-main animate-spin" />
    </div>
    <div v-else-if="vendors.length === 0" class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-12 text-center">
      <ShoppingCart class="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
      <p class="text-gray-500 dark:text-gray-400">{{ t('vendors.noVendors') }}</p>
      <button
        @click="openModal()"
        class="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 transition-all duration-300 touch-manipulation"
      >
        <Plus class="h-4 w-4" />
        {{ t('vendors.newVendor') }}
      </button>
    </div>
    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <div
        v-for="vendor in vendors"
        :key="vendor.id"
        class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg cursor-pointer group"
        @click="viewVendor(vendor)"
      >
        <div class="flex items-start justify-between mb-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center">
              <ShoppingCart class="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 class="font-semibold text-gray-900 dark:text-gray-100">{{ vendor.name }}</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ vendor.category || t('vendors.uncategorized') }}</p>
            </div>
          </div>
          <span
            class="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-lg"
            :class="vendor.isActive
              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
              : 'bg-gray-500/10 text-gray-500 dark:text-gray-500'"
          >
            {{ vendor.isActive ? t('vendors.active') : t('vendors.inactive') }}
          </span>
        </div>

        <div class="grid grid-cols-2 gap-4 mb-3">
          <div class="p-3 rounded-xl bg-gray-50 dark:bg-white/5">
            <div class="text-xs text-gray-500 dark:text-gray-400 mb-1">{{ t('vendors.totalSpent') }}</div>
            <div class="font-bold font-mono text-gray-900 dark:text-gray-100">{{ formatCurrency(vendor.totalSpent) }}</div>
          </div>
          <div class="p-3 rounded-xl bg-gray-50 dark:bg-white/5">
            <div class="text-xs text-gray-500 dark:text-gray-400 mb-1">{{ t('vendors.transactionCount') }}</div>
            <div class="font-bold font-mono text-gray-900 dark:text-gray-100">{{ vendor.transactionCount }}</div>
          </div>
        </div>

        <div v-if="vendor.lastTransactionDate" class="flex items-center justify-between pt-3 border-t border-gray-200 dark:border-white/10">
          <span class="text-xs text-gray-400">
            {{ t('vendors.lastTransaction') }}: {{ formatDate(vendor.lastTransactionDate) }}
          </span>
          <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <button
              @click.stop="openModal(vendor)"
              class="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-500/10 transition-colors touch-manipulation"
              :title="t('common.edit')"
            >
              <Pencil class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <div v-if="showModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" @click="showModal = false"></div>
        <div class="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl max-w-md w-full p-6">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            {{ editingVendor ? t('vendors.editVendor') : t('vendors.newVendor') }}
          </h3>

          <form @submit.prevent="saveVendor" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('vendors.vendorName') }}</label>
              <input v-model="form.name" type="text" required class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('common.category') }}</label>
              <input v-model="form.category" type="text" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('vendors.email') }}</label>
                <input v-model="form.email" type="email" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('vendors.phone') }}</label>
                <input v-model="form.phone" type="text" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('vendors.notes') }}</label>
              <textarea v-model="form.notes" rows="2" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors"></textarea>
            </div>

            <div class="flex justify-end gap-3 pt-4">
              <button type="button" @click="showModal = false" class="px-4 py-2 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-white/[0.07] transition-colors touch-manipulation">{{ t('common.cancel') }}</button>
              <button type="submit" class="px-5 py-2.5 bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 transition-all duration-300 touch-manipulation">{{ t('common.save') }}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import {
  Plus, RefreshCw, Search, Loader2, ShoppingCart, Pencil
} from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

const { t, locale } = useI18n()
const userStore = useUserStore()
const getAuthHeaders = () => userStore.authHeader

const isLoading = ref(false)
const isSyncing = ref(false)
const showModal = ref(false)
const vendors = ref<any[]>([])
const editingVendor = ref<any>(null)
const searchQuery = ref('')

// Computed stats
const totalSpent = computed(() => vendors.value.reduce((sum, v) => sum + (v.totalSpent || 0), 0))
const activeCount = computed(() => vendors.value.filter(v => v.isActive).length)

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
    const data = await $fetch(`/api/vendors?${params.toString()}`, { headers: getAuthHeaders() })
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
    await $fetch('/api/vendors?sync=true', { headers: getAuthHeaders() })
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
      await $fetch(`/api/vendors/${editingVendor.value.id}`, { method: 'PUT', body: form, headers: getAuthHeaders() })
    } else {
      await $fetch('/api/vendors', { method: 'POST', body: form, headers: getAuthHeaders() })
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
