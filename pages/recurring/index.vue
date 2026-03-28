<template>
  <div>
    <header class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-800">{{ t('nav.recurringPayments') }}</h1>
        <p class="text-gray-600">{{ t('recurring.description') }}</p>
      </div>

      <div class="mt-4 md:mt-0 flex space-x-3">
        <button
          @click="processPayments"
          :disabled="isProcessing"
          class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-xl shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.07]"
        >
          <RefreshCw :class="['mr-2 h-4 w-4', isProcessing ? 'animate-spin' : '']" />
          {{ t('recurring.processDue') }}
        </button>
        <button
          @click="showCreateModal = true"
          class="inline-flex items-center px-4 py-2 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-primary-main hover:bg-primary-dark touch-manipulation"
        >
          <Plus class="mr-2 h-4 w-4" />
          {{ t('recurring.addRecurring') }}
        </button>
      </div>
    </header>

    <!-- Stats Cards -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4">
        <div class="text-sm text-gray-500">{{ t('recurring.active') }}</div>
        <div class="text-2xl font-semibold font-mono text-gray-800 dark:text-gray-100">{{ stats.active }}</div>
      </div>
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4">
        <div class="text-sm text-gray-500">{{ t('recurring.monthlyEstimate') }}</div>
        <div class="text-2xl font-semibold font-mono text-primary-main">{{ formatCurrency(stats.activeMonthlyAmount) }}</div>
      </div>
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4">
        <div class="text-sm text-gray-500">{{ t('recurring.upcoming30days') }}</div>
        <div class="text-2xl font-semibold font-mono text-amber-600">{{ upcoming.count }}</div>
      </div>
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4">
        <div class="text-sm text-gray-500">{{ t('recurring.paused') }}</div>
        <div class="text-2xl font-semibold font-mono text-gray-400">{{ stats.paused }}</div>
      </div>
    </div>

    <!-- Filters -->
    <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4 mb-6">
      <div class="flex flex-wrap gap-4">
        <select v-model="filters.status" class="border border-gray-300 rounded-md px-3 py-2 text-sm">
          <option value="">{{ t('recurring.allStatus') }}</option>
          <option value="active">{{ t('recurring.statusActive') }}</option>
          <option value="paused">{{ t('recurring.statusPaused') }}</option>
          <option value="completed">{{ t('recurring.statusCompleted') }}</option>
          <option value="cancelled">{{ t('recurring.statusCancelled') }}</option>
        </select>
        <select v-model="filters.frequency" class="border border-gray-300 rounded-md px-3 py-2 text-sm">
          <option value="">{{ t('recurring.allFrequencies') }}</option>
          <option value="daily">{{ t('recurring.daily') }}</option>
          <option value="weekly">{{ t('recurring.weekly') }}</option>
          <option value="biweekly">{{ t('recurring.biweekly') }}</option>
          <option value="monthly">{{ t('recurring.monthly') }}</option>
          <option value="quarterly">{{ t('recurring.quarterly') }}</option>
          <option value="yearly">{{ t('recurring.yearly') }}</option>
        </select>
        <input
          v-model="filters.search"
          type="text"
          :placeholder="t('common.search')"
          class="border border-gray-300 rounded-md px-3 py-2 text-sm flex-1 min-w-48"
        />
      </div>
    </div>

    <!-- Payments List -->
    <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-hidden">
      <div v-if="isLoading" class="p-8 text-center text-gray-500">
        {{ t('common.loading') }}
      </div>
      <div v-else-if="payments.length === 0" class="p-8 text-center text-gray-500">
        {{ t('recurring.noPayments') }}
      </div>
      <table v-else class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50 dark:bg-white/5">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ t('common.name') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ t('common.amount') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ t('recurring.frequency') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ t('recurring.nextDue') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ t('common.status') }}</th>
            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">{{ t('common.actions') }}</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
          <tr v-for="payment in payments" :key="payment.id" class="hover:bg-gray-50 dark:hover:bg-white/[0.07]">
            <td class="px-6 py-4">
              <div class="text-sm font-medium text-gray-900">{{ payment.name }}</div>
              <div class="text-sm text-gray-500">{{ payment.customer?.name }}</div>
            </td>
            <td class="px-6 py-4 text-sm text-gray-900">
              {{ formatCurrency(payment.amount) }}
            </td>
            <td class="px-6 py-4 text-sm text-gray-500 capitalize">
              {{ payment.frequency }}
            </td>
            <td class="px-6 py-4 text-sm">
              <span :class="isOverdue(payment.nextDueDate) ? 'text-red-600 font-medium' : 'text-gray-500'">
                {{ formatDate(payment.nextDueDate) }}
              </span>
            </td>
            <td class="px-6 py-4">
              <span :class="getStatusClass(payment.status)" class="px-2 py-1 text-xs font-medium rounded-full">
                {{ payment.status }}
              </span>
            </td>
            <td class="px-6 py-4 text-right text-sm space-x-2">
              <button @click="generateNow(payment)" class="text-primary-main hover:text-primary-dark" title="Generate Transaction">
                <Play class="h-4 w-4 inline" />
              </button>
              <button @click="togglePause(payment)" class="text-gray-600 hover:text-gray-900" :title="payment.status === 'paused' ? 'Resume' : 'Pause'">
                <component :is="payment.status === 'paused' ? PlayCircle : PauseCircle" class="h-4 w-4 inline" />
              </button>
              <button @click="editPayment(payment)" class="text-blue-600 hover:text-blue-900" title="Edit">
                <Pencil class="h-4 w-4 inline" />
              </button>
              <button @click="deletePayment(payment)" class="text-red-600 hover:text-red-900" title="Delete">
                <Trash2 class="h-4 w-4 inline" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Create/Edit Modal -->
    <div v-if="showCreateModal || showEditModal" class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div class="bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div class="px-6 py-4 border-b border-gray-200">
          <h3 class="text-lg font-medium text-gray-900">
            {{ showEditModal ? t('recurring.editRecurring') : t('recurring.newRecurring') }}
          </h3>
        </div>
        <form @submit.prevent="savePayment" class="p-6 space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('common.name') }} *</label>
            <input v-model="form.name" type="text" required class="w-full border border-gray-300 rounded-md px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('common.description') }}</label>
            <input v-model="form.description" type="text" class="w-full border border-gray-300 rounded-md px-3 py-2" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('common.amount') }} *</label>
              <input v-model.number="form.amount" type="number" required min="0" class="w-full border border-gray-300 rounded-md px-3 py-2" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('recurring.frequency') }} *</label>
              <select v-model="form.frequency" required class="w-full border border-gray-300 rounded-md px-3 py-2">
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
              <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('recurring.startDate') }} *</label>
              <input v-model="form.startDate" type="date" required class="w-full border border-gray-300 rounded-md px-3 py-2" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('recurring.endDate') }}</label>
              <input v-model="form.endDate" type="date" class="w-full border border-gray-300 rounded-md px-3 py-2" />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('recurring.customerPayee') }} *</label>
            <input v-model="form.customerName" type="text" required class="w-full border border-gray-300 rounded-md px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('common.category') }}</label>
            <input v-model="form.category" type="text" class="w-full border border-gray-300 rounded-md px-3 py-2" :placeholder="t('recurring.categoryPlaceholder')" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('common.notes') }}</label>
            <textarea v-model="form.notes" rows="2" class="w-full border border-gray-300 rounded-md px-3 py-2"></textarea>
          </div>
          <div class="flex items-center">
            <input v-model="form.autoGenerate" type="checkbox" id="autoGenerate" class="mr-2" />
            <label for="autoGenerate" class="text-sm text-gray-700">{{ t('recurring.autoGenerate') }}</label>
          </div>
          <div class="flex justify-end space-x-3 pt-4">
            <button type="button" @click="closeModal" class="px-4 py-2 border border-gray-300 dark:border-white/10 rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/10">
              {{ t('common.cancel') }}
            </button>
            <button type="submit" :disabled="isSaving" class="px-4 py-2 bg-primary-main text-white rounded-xl hover:bg-primary-dark disabled:opacity-50">
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
import { Plus, RefreshCw, Play, Pencil, Trash2, PauseCircle, PlayCircle } from 'lucide-vue-next'

const { t, locale } = useI18n()

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

    payments.value = await $fetch(`/api/recurring?${params.toString()}`)
  } catch (error) {
    console.error('Failed to load payments:', error)
  } finally {
    isLoading.value = false
  }
}

const loadStats = async () => {
  try {
    const data = await $fetch('/api/recurring?stats=true')
    stats.value = data
  } catch (error) {
    console.error('Failed to load stats:', error)
  }
}

const loadUpcoming = async () => {
  try {
    const data = await $fetch('/api/recurring/process')
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
      await $fetch(`/api/recurring/${editingId.value}`, { method: 'PUT', body: payload })
    } else {
      await $fetch('/api/recurring', { method: 'POST', body: payload })
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
    await $fetch(`/api/recurring/${payment.id}`, { method: 'DELETE' })
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
    await $fetch(`/api/recurring/${payment.id}`, { method: 'PUT', body: { status: newStatus } })
    await loadPayments()
    await loadStats()
  } catch (error) {
    console.error('Failed to toggle pause:', error)
  }
}

const generateNow = async (payment: any) => {
  try {
    await $fetch(`/api/recurring/${payment.id}`, { method: 'POST' })
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
    const result = await $fetch('/api/recurring/process', { method: 'POST' })
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

const getStatusClass = (status: string) => {
  const classes: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    paused: 'bg-yellow-100 text-yellow-800',
    completed: 'bg-gray-100 text-gray-800',
    cancelled: 'bg-red-100 text-red-800'
  }
  return classes[status] || 'bg-gray-100 text-gray-800'
}

watch(filters, () => loadPayments(), { deep: true })

onMounted(() => {
  loadPayments()
  loadStats()
  loadUpcoming()
})
</script>
