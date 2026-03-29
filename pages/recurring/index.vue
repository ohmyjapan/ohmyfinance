<template>
  <div>
    <!-- Page Header -->
    <div class="mb-8">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('nav.recurringPayments') }}</h1>
          <p class="mt-1 text-gray-500 dark:text-gray-400">{{ t('recurring.description') }}</p>
        </div>
        <div class="flex items-center gap-3">
          <button
            @click="processPayments"
            :disabled="isProcessing"
            class="inline-flex items-center px-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.07] transition-all duration-200 touch-manipulation"
          >
            <RefreshCw :class="['mr-2 h-4 w-4', isProcessing ? 'animate-spin' : '']" />
            {{ t('recurring.processDue') }}
          </button>
          <button
            @click="showCreateModal = true"
            class="inline-flex items-center px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main shadow-lg shadow-primary-main/25 transition-all duration-300 touch-manipulation"
          >
            <Plus class="mr-2 h-4 w-4" />
            {{ t('recurring.addRecurring') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Stats Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <StatCard
        :title="t('recurring.active')"
        :value="stats.active.toString()"
        icon="Activity"
        color="green"
      />
      <StatCard
        :title="t('recurring.monthlyEstimate')"
        :value="formatCurrency(stats.activeMonthlyAmount)"
        icon="DollarSign"
        color="primary"
      />
      <StatCard
        :title="t('recurring.upcoming30days')"
        :value="upcoming.count.toString()"
        icon="CreditCard"
        color="amber"
      />
      <StatCard
        :title="t('recurring.paused')"
        :value="stats.paused.toString()"
        icon="Package"
        color="red"
      />
    </div>

    <!-- Filters -->
    <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm p-4 mb-6">
      <div class="flex flex-wrap gap-4">
        <select
          v-model="filters.status"
          class="border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-primary-main/30 focus:border-primary-main transition-colors"
        >
          <option value="">{{ t('recurring.allStatus') }}</option>
          <option value="active">{{ t('recurring.statusActive') }}</option>
          <option value="paused">{{ t('recurring.statusPaused') }}</option>
          <option value="completed">{{ t('recurring.statusCompleted') }}</option>
          <option value="cancelled">{{ t('recurring.statusCancelled') }}</option>
        </select>
        <select
          v-model="filters.frequency"
          class="border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-primary-main/30 focus:border-primary-main transition-colors"
        >
          <option value="">{{ t('recurring.allFrequencies') }}</option>
          <option value="daily">{{ t('recurring.daily') }}</option>
          <option value="weekly">{{ t('recurring.weekly') }}</option>
          <option value="biweekly">{{ t('recurring.biweekly') }}</option>
          <option value="monthly">{{ t('recurring.monthly') }}</option>
          <option value="quarterly">{{ t('recurring.quarterly') }}</option>
          <option value="yearly">{{ t('recurring.yearly') }}</option>
        </select>
        <div class="relative flex-1 min-w-48">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            v-model="filters.search"
            type="text"
            :placeholder="t('common.search')"
            class="w-full border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-primary-main/30 focus:border-primary-main transition-colors"
          />
        </div>
      </div>
    </div>

    <!-- Payments Table -->
    <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm overflow-hidden">
      <div v-if="isLoading" class="p-12 text-center">
        <div class="flex flex-col items-center gap-3">
          <Loader2 class="w-6 h-6 animate-spin text-primary-main" />
          <span class="text-sm text-gray-500 dark:text-gray-400">{{ t('common.loading') }}</span>
        </div>
      </div>

      <div v-else-if="payments.length === 0" class="p-12 text-center">
        <div class="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-white/5 flex items-center justify-center mx-auto mb-4">
          <CreditCard class="w-8 h-8 text-gray-400 dark:text-gray-500" />
        </div>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-1">{{ t('recurring.noPayments') }}</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">{{ t('recurring.noPaymentsDesc') }}</p>
        <button
          @click="showCreateModal = true"
          class="inline-flex items-center px-4 py-2 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main shadow-lg shadow-primary-main/25 transition-all duration-300 touch-manipulation"
        >
          <Plus class="mr-2 h-4 w-4" />
          {{ t('recurring.addRecurring') }}
        </button>
      </div>

      <table v-else class="min-w-full divide-y divide-gray-200 dark:divide-white/10">
        <thead class="bg-gray-50 dark:bg-white/[0.03]">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('common.name') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('common.amount') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('recurring.frequency') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('recurring.nextDue') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('common.status') }}</th>
            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('common.actions') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 dark:divide-white/10">
          <tr
            v-for="payment in payments"
            :key="payment.id"
            class="group hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors"
          >
            <td class="px-6 py-4">
              <div class="text-sm font-medium text-gray-900 dark:text-white">{{ payment.name }}</div>
              <div class="text-xs text-gray-500 dark:text-gray-400">{{ payment.customer?.name }}</div>
            </td>
            <td class="px-6 py-4 text-sm font-mono font-bold text-gray-900 dark:text-white">
              {{ formatCurrency(payment.amount) }}
            </td>
            <td class="px-6 py-4">
              <span class="bg-primary-main/10 dark:bg-primary-main/20 text-primary-main dark:text-primary-light rounded-lg px-2.5 py-1 text-xs font-medium capitalize">
                {{ t(`recurring.${payment.frequency}`) }}
              </span>
            </td>
            <td class="px-6 py-4 text-sm">
              <span :class="isOverdue(payment.nextDueDate) ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500 dark:text-gray-400'">
                {{ formatDate(payment.nextDueDate) }}
              </span>
              <span v-if="isOverdue(payment.nextDueDate)" class="ml-1.5 bg-red-500/10 text-red-600 dark:text-red-400 rounded-lg px-2 py-0.5 text-xs font-medium">
                {{ t('recurring.overdue') }}
              </span>
            </td>
            <td class="px-6 py-4">
              <span :class="getStatusBadgeClass(payment.status)" class="rounded-lg px-2.5 py-1 text-xs font-medium">
                {{ t(`recurring.status${payment.status.charAt(0).toUpperCase() + payment.status.slice(1)}`) }}
              </span>
            </td>
            <td class="px-6 py-4 text-right">
              <div class="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  @click="generateNow(payment)"
                  class="p-2 rounded-lg text-gray-400 hover:text-primary-main hover:bg-primary-main/10 transition-colors touch-manipulation"
                  :title="t('recurring.generateNow')"
                >
                  <Play class="h-4 w-4" />
                </button>
                <button
                  @click="togglePause(payment)"
                  class="p-2 rounded-lg text-gray-400 hover:text-amber-500 hover:bg-amber-500/10 transition-colors touch-manipulation"
                  :title="payment.status === 'paused' ? t('recurring.resume') : t('recurring.pause')"
                >
                  <component :is="payment.status === 'paused' ? PlayCircle : PauseCircle" class="h-4 w-4" />
                </button>
                <button
                  @click="editPayment(payment)"
                  class="p-2 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-500/10 transition-colors touch-manipulation"
                  :title="t('common.edit')"
                >
                  <Pencil class="h-4 w-4" />
                </button>
                <button
                  @click="deletePayment(payment)"
                  class="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-500/10 transition-colors touch-manipulation"
                  :title="t('common.delete')"
                >
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Create/Edit Modal -->
    <div v-if="showCreateModal || showEditModal" class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
            {{ showEditModal ? t('recurring.editRecurring') : t('recurring.newRecurring') }}
          </h3>
          <button @click="closeModal" class="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors touch-manipulation">
            <X class="h-5 w-5" />
          </button>
        </div>
        <form @submit.prevent="savePayment" class="p-6 space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('common.name') }} *</label>
            <input v-model="form.name" type="text" required class="w-full border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-primary-main/30 focus:border-primary-main transition-colors" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('common.description') }}</label>
            <input v-model="form.description" type="text" class="w-full border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-primary-main/30 focus:border-primary-main transition-colors" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('common.amount') }} *</label>
              <input v-model.number="form.amount" type="number" required min="0" class="w-full border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-primary-main/30 focus:border-primary-main transition-colors" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('recurring.frequency') }} *</label>
              <select v-model="form.frequency" required class="w-full border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-primary-main/30 focus:border-primary-main transition-colors">
                <option value="daily">{{ t('recurring.daily') }}</option>
                <option value="weekly">{{ t('recurring.weekly') }}</option>
                <option value="biweekly">{{ t('recurring.biweekly') }}</option>
                <option value="monthly">{{ t('recurring.monthly') }}</option>
                <option value="quarterly">{{ t('recurring.quarterly') }}</option>
                <option value="yearly">{{ t('recurring.yearly') }}</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('recurring.startDate') }} *</label>
              <input v-model="form.startDate" type="date" required class="w-full border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-primary-main/30 focus:border-primary-main transition-colors" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('recurring.endDate') }}</label>
              <input v-model="form.endDate" type="date" class="w-full border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-primary-main/30 focus:border-primary-main transition-colors" />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('recurring.customerPayee') }} *</label>
            <input v-model="form.customerName" type="text" required class="w-full border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-primary-main/30 focus:border-primary-main transition-colors" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('common.category') }}</label>
            <input v-model="form.category" type="text" class="w-full border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-primary-main/30 focus:border-primary-main transition-colors" :placeholder="t('recurring.categoryPlaceholder')" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('common.notes') }}</label>
            <textarea v-model="form.notes" rows="2" class="w-full border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-primary-main/30 focus:border-primary-main transition-colors"></textarea>
          </div>
          <div class="flex items-center gap-2">
            <input v-model="form.autoGenerate" type="checkbox" id="autoGenerate" class="rounded border-gray-300 dark:border-white/20 text-primary-main focus:ring-primary-main/30" />
            <label for="autoGenerate" class="text-sm text-gray-700 dark:text-gray-300">{{ t('recurring.autoGenerate') }}</label>
          </div>
          <div class="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-white/10">
            <button
              type="button"
              @click="closeModal"
              class="px-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/10 transition-colors touch-manipulation"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              type="submit"
              :disabled="isSaving"
              class="px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main shadow-lg shadow-primary-main/25 transition-all duration-300 disabled:opacity-50 touch-manipulation"
            >
              {{ isSaving ? t('common.loading') : t('common.save') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue'
import {
  Plus, RefreshCw, Play, Pencil, Trash2, PauseCircle, PlayCircle,
  Search, Loader2, CreditCard, X
} from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

const { t, locale } = useI18n()
const userStore = useUserStore()

const isLoading = ref(false)
const isSaving = ref(false)
const isProcessing = ref(false)
const payments = ref<any[]>([])
const stats = ref({ active: 0, paused: 0, activeMonthlyAmount: 0 })
const upcoming = ref({ count: 0, payments: [] })
const showCreateModal = ref(false)
const showEditModal = ref(false)
const editingId = ref<string | null>(null)

const filters = reactive({
  status: '',
  frequency: '',
  search: ''
})

const form = reactive({
  name: '',
  description: '',
  amount: 0,
  frequency: 'monthly',
  startDate: new Date().toISOString().split('T')[0],
  endDate: '',
  customerName: '',
  category: '',
  notes: '',
  autoGenerate: true
})

const loadPayments = async () => {
  isLoading.value = true
  try {
    const params = new URLSearchParams()
    if (filters.status) params.set('status', filters.status)
    if (filters.frequency) params.set('frequency', filters.frequency)
    if (filters.search) params.set('search', filters.search)

    payments.value = await $fetch(`/api/recurring?${params.toString()}`, { headers: userStore.authHeader })
  } catch (error) {
    console.error('Failed to load payments:', error)
  } finally {
    isLoading.value = false
  }
}

const loadStats = async () => {
  try {
    const data = await $fetch('/api/recurring?stats=true', { headers: userStore.authHeader })
    stats.value = data
  } catch (error) {
    console.error('Failed to load stats:', error)
  }
}

const loadUpcoming = async () => {
  try {
    const data = await $fetch('/api/recurring/process', { headers: userStore.authHeader })
    upcoming.value = data
  } catch (error) {
    console.error('Failed to load upcoming:', error)
  }
}

const savePayment = async () => {
  isSaving.value = true
  try {
    const payload = {
      name: form.name,
      description: form.description,
      amount: form.amount,
      frequency: form.frequency,
      startDate: form.startDate,
      endDate: form.endDate || undefined,
      customer: { name: form.customerName },
      category: form.category,
      notes: form.notes,
      autoGenerate: form.autoGenerate
    }

    if (showEditModal.value && editingId.value) {
      await $fetch(`/api/recurring/${editingId.value}`, { method: 'PUT', body: payload, headers: userStore.authHeader })
    } else {
      await $fetch('/api/recurring', { method: 'POST', body: payload, headers: userStore.authHeader })
    }

    closeModal()
    await loadPayments()
    await loadStats()
  } catch (error) {
    console.error('Failed to save payment:', error)
    alert('Failed to save payment')
  } finally {
    isSaving.value = false
  }
}

const editPayment = (payment: any) => {
  editingId.value = payment.id
  form.name = payment.name
  form.description = payment.description || ''
  form.amount = payment.amount
  form.frequency = payment.frequency
  form.startDate = payment.startDate?.split('T')[0] || ''
  form.endDate = payment.endDate?.split('T')[0] || ''
  form.customerName = payment.customer?.name || ''
  form.category = payment.category || ''
  form.notes = payment.notes || ''
  form.autoGenerate = payment.autoGenerate !== false
  showEditModal.value = true
}

const deletePayment = async (payment: any) => {
  if (!confirm(`Delete "${payment.name}"?`)) return
  try {
    await $fetch(`/api/recurring/${payment.id}`, { method: 'DELETE', headers: userStore.authHeader })
    await loadPayments()
    await loadStats()
  } catch (error) {
    console.error('Failed to delete:', error)
    alert('Failed to delete payment')
  }
}

const togglePause = async (payment: any) => {
  try {
    const newStatus = payment.status === 'paused' ? 'active' : 'paused'
    await $fetch(`/api/recurring/${payment.id}`, { method: 'PUT', body: { status: newStatus }, headers: userStore.authHeader })
    await loadPayments()
    await loadStats()
  } catch (error) {
    console.error('Failed to toggle pause:', error)
  }
}

const generateNow = async (payment: any) => {
  try {
    await $fetch(`/api/recurring/${payment.id}`, { method: 'POST', headers: userStore.authHeader })
    alert('Transaction generated successfully')
    await loadPayments()
  } catch (error: any) {
    console.error('Failed to generate:', error)
    alert(error.data?.statusMessage || 'Failed to generate transaction')
  }
}

const processPayments = async () => {
  isProcessing.value = true
  try {
    const result = await $fetch('/api/recurring/process', { method: 'POST', headers: userStore.authHeader })
    alert(result.message)
    await loadPayments()
    await loadStats()
  } catch (error) {
    console.error('Failed to process:', error)
    alert('Failed to process payments')
  } finally {
    isProcessing.value = false
  }
}

const closeModal = () => {
  showCreateModal.value = false
  showEditModal.value = false
  editingId.value = null
  Object.assign(form, {
    name: '', description: '', amount: 0, frequency: 'monthly',
    startDate: new Date().toISOString().split('T')[0], endDate: '',
    customerName: '', category: '', notes: '', autoGenerate: true
  })
}

const formatCurrency = (amount: number) => {
  const currencyLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  const currency = locale.value === 'ko' ? 'KRW' : 'JPY'
  return new Intl.NumberFormat(currencyLocale, { style: 'currency', currency }).format(amount)
}

const formatDate = (dateStr: string) => {
  if (!dateStr) return '-'
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(dateStr).toLocaleDateString(dateLocale)
}

const isOverdue = (dateStr: string) => {
  if (!dateStr) return false
  return new Date(dateStr) < new Date()
}

const getStatusBadgeClass = (status: string) => {
  const classes: Record<string, string> = {
    active: 'bg-green-500/10 text-green-600 dark:text-green-400',
    paused: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    completed: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
    cancelled: 'bg-red-500/10 text-red-600 dark:text-red-400'
  }
  return classes[status] || 'bg-gray-500/10 text-gray-600 dark:text-gray-400'
}

watch(filters, () => loadPayments(), { deep: true })

onMounted(() => {
  loadPayments()
  loadStats()
  loadUpcoming()
})
</script>
