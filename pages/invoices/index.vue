<template>
  <div>
    <!-- Page Header -->
    <div class="mb-8">
      <div class="bg-gradient-to-r from-primary-main to-primary-dark dark:from-primary-dark dark:to-primary-dark/80 rounded-2xl p-6 text-white relative overflow-hidden">
        <div class="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
        <div class="absolute -bottom-8 -left-8 w-32 h-32 bg-white/5 rounded-full blur-2xl"></div>
        <div class="flex flex-col md:flex-row md:items-center md:justify-between relative z-10">
          <div>
            <h1 class="text-2xl font-bold mb-1">{{ t('invoices.title') }}</h1>
            <p class="text-primary-light">{{ t('invoices.description') }}</p>
          </div>
          <button
            @click="openModal()"
            class="mt-4 md:mt-0 inline-flex items-center gap-2 px-5 py-2.5 bg-white/20 hover:bg-white/30 text-white rounded-xl backdrop-blur-sm transition-all duration-300 touch-manipulation"
          >
            <Plus class="h-5 w-5" />
            {{ t('invoices.newInvoice') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Stat Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <StatCard
        :title="t('common.total')"
        :value="invoices.length.toString()"
        icon="FileText"
        color="blue"
      />
      <StatCard
        :title="t('invoices.statuses.paid')"
        :value="paidCount.toString()"
        icon="DollarSign"
        color="green"
      />
      <StatCard
        :title="t('invoices.statuses.overdue')"
        :value="overdueCount.toString()"
        icon="CreditCard"
        color="red"
      />
      <StatCard
        :title="t('invoices.statuses.draft')"
        :value="draftCount.toString()"
        icon="FileText"
        color="amber"
      />
    </div>

    <!-- Filters -->
    <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4 mb-6">
      <div class="flex items-center gap-4">
        <Filter class="w-5 h-5 text-gray-400" />
        <select
          v-model="statusFilter"
          @change="loadInvoices"
          class="bg-transparent border border-gray-300 dark:border-white/10 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors"
        >
          <option value="">{{ t('invoices.allStatus') }}</option>
          <option value="draft">{{ t('invoices.statuses.draft') }}</option>
          <option value="sent">{{ t('invoices.statuses.sent') }}</option>
          <option value="paid">{{ t('invoices.statuses.paid') }}</option>
          <option value="overdue">{{ t('invoices.statuses.overdue') }}</option>
          <option value="cancelled">{{ t('invoices.statuses.cancelled') }}</option>
        </select>
      </div>
    </div>

    <!-- Invoices Table -->
    <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-hidden">
      <div v-if="isLoading" class="p-12 text-center">
        <div class="flex items-center justify-center gap-2 text-gray-500">
          <Loader2 class="w-6 h-6 animate-spin text-primary-main" />
          <span>{{ t('common.loading') }}</span>
        </div>
      </div>
      <div v-else-if="invoices.length === 0" class="p-12 text-center">
        <FileText class="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
        <p class="text-gray-500 dark:text-gray-400">{{ t('invoices.noInvoices') }}</p>
        <button
          @click="openModal()"
          class="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 transition-all duration-300 touch-manipulation"
        >
          <Plus class="h-4 w-4" />
          {{ t('invoices.newInvoice') }}
        </button>
      </div>
      <table v-else class="min-w-full divide-y divide-gray-200 dark:divide-white/10">
        <thead class="bg-gray-50 dark:bg-white/5">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('invoices.invoiceNumber') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('transactions.customer') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('invoices.issueDate') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('invoices.dueDate') }}</th>
            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('common.amount') }}</th>
            <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('common.status') }}</th>
            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('common.actions') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 dark:divide-white/10">
          <tr
            v-for="invoice in invoices"
            :key="invoice.id"
            class="hover:bg-gray-50 dark:hover:bg-white/[0.03] group transition-colors"
          >
            <td class="px-6 py-4">
              <div class="font-medium font-mono text-gray-900 dark:text-gray-100">{{ invoice.invoiceNumber }}</div>
            </td>
            <td class="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{{ invoice.to?.name }}</td>
            <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{{ formatDate(invoice.issueDate) }}</td>
            <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{{ formatDate(invoice.dueDate) }}</td>
            <td class="px-6 py-4 text-right font-bold font-mono text-gray-900 dark:text-gray-100">{{ formatCurrency(invoice.total) }}</td>
            <td class="px-6 py-4 text-center">
              <span :class="getStatusClass(invoice.status)" class="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-lg capitalize">
                {{ t(`invoices.statuses.${invoice.status}`) || invoice.status }}
              </span>
            </td>
            <td class="px-6 py-4 text-right">
              <div class="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <button
                  @click="viewPdf(invoice.id)"
                  class="p-2 rounded-lg text-gray-400 hover:text-primary-main hover:bg-primary-main/10 transition-colors touch-manipulation"
                  :title="t('common.view')"
                >
                  <Eye class="h-4 w-4" />
                </button>
                <button
                  @click="openModal(invoice)"
                  class="p-2 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-500/10 transition-colors touch-manipulation"
                  :title="t('common.edit')"
                >
                  <Pencil class="h-4 w-4" />
                </button>
                <button
                  @click="deleteInvoice(invoice.id)"
                  class="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-500/10 transition-colors touch-manipulation"
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

    <!-- Modal -->
    <div v-if="showModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" @click="showModal = false"></div>
        <div class="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            {{ editingInvoice ? t('invoices.editInvoice') : t('invoices.newInvoice') }}
          </h3>

          <form @submit.prevent="saveInvoice" class="space-y-4">
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('invoices.issueDate') }}</label>
                <input v-model="form.issueDate" type="date" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('invoices.dueDate') }}</label>
                <input v-model="form.dueDate" type="date" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('invoices.from') }}</label>
                <input v-model="form.from.name" type="text" :placeholder="t('invoices.companyName')" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 mb-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
                <input v-model="form.from.email" type="email" :placeholder="t('common.email')" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('invoices.to') }}</label>
                <input v-model="form.to.name" type="text" :placeholder="t('invoices.customerName')" required class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 mb-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
                <input v-model="form.to.email" type="email" :placeholder="t('common.email')" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
              </div>
            </div>

            <!-- Items -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{{ t('invoices.items') }}</label>
              <div v-for="(item, idx) in form.items" :key="idx" class="flex gap-2 mb-2">
                <input v-model="item.description" type="text" :placeholder="t('common.description')" class="flex-1 border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2" />
                <input v-model.number="item.quantity" type="number" min="1" class="w-20 border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2" />
                <input v-model.number="item.unitPrice" type="number" :placeholder="t('invoices.price')" class="w-28 border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2" />
                <button type="button" @click="removeItem(idx)" class="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-500/10 transition-colors touch-manipulation">
                  <X class="h-4 w-4" />
                </button>
              </div>
              <button type="button" @click="addItem" class="text-sm text-primary-main hover:text-primary-dark font-medium touch-manipulation">+ {{ t('invoices.addItem') }}</button>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('invoices.taxRate') }} (%)</label>
                <input v-model.number="form.taxRate" type="number" min="0" max="100" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('common.status') }}</label>
                <select v-model="form.status" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2">
                  <option value="draft">{{ t('invoices.statuses.draft') }}</option>
                  <option value="sent">{{ t('invoices.statuses.sent') }}</option>
                  <option value="paid">{{ t('invoices.statuses.paid') }}</option>
                  <option value="overdue">{{ t('invoices.statuses.overdue') }}</option>
                  <option value="cancelled">{{ t('invoices.statuses.cancelled') }}</option>
                </select>
              </div>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('invoices.notes') }}</label>
              <textarea v-model="form.notes" rows="2" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2"></textarea>
            </div>

            <div class="flex justify-end gap-3 pt-4">
              <button type="button" @click="showModal = false" class="px-4 py-2 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-white/[0.07] transition-colors touch-manipulation">{{ t('common.cancel') }}</button>
              <button type="submit" class="px-5 py-2.5 bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 transition-all duration-300 touch-manipulation">
                {{ editingInvoice ? t('common.edit') : t('common.create') }}
              </button>
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
  Plus, FileText, Pencil, Trash2, X, Eye, Filter, Loader2
} from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

const { t, locale } = useI18n()
const userStore = useUserStore()
const getAuthHeaders = () => userStore.authHeader

const isLoading = ref(false)
const showModal = ref(false)
const invoices = ref<any[]>([])
const editingInvoice = ref<any>(null)
const statusFilter = ref('')

// Computed stats
const paidCount = computed(() => invoices.value.filter(i => i.status === 'paid').length)
const overdueCount = computed(() => invoices.value.filter(i => i.status === 'overdue').length)
const draftCount = computed(() => invoices.value.filter(i => i.status === 'draft').length)

const form = reactive({
  issueDate: new Date().toISOString().split('T')[0],
  dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  from: { name: '', email: '' },
  to: { name: '', email: '' },
  items: [{ description: '', quantity: 1, unitPrice: 0 }],
  taxRate: 10,
  status: 'draft',
  notes: ''
})

const loadInvoices = async () => {
  isLoading.value = true
  try {
    const params = new URLSearchParams()
    if (statusFilter.value) params.set('status', statusFilter.value)
    const data = await $fetch(`/api/invoices?${params.toString()}`, { headers: getAuthHeaders() })
    invoices.value = data.invoices
  } catch (error) {
    console.error('Failed to load invoices:', error)
  } finally {
    isLoading.value = false
  }
}

const openModal = (invoice?: any) => {
  if (invoice) {
    editingInvoice.value = invoice
    form.issueDate = new Date(invoice.issueDate).toISOString().split('T')[0]
    form.dueDate = new Date(invoice.dueDate).toISOString().split('T')[0]
    form.from = { ...invoice.from }
    form.to = { ...invoice.to }
    form.items = invoice.items.map((i: any) => ({ ...i }))
    form.taxRate = invoice.taxRate
    form.status = invoice.status
    form.notes = invoice.notes || ''
  } else {
    editingInvoice.value = null
    form.issueDate = new Date().toISOString().split('T')[0]
    form.dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    form.from = { name: '', email: '' }
    form.to = { name: '', email: '' }
    form.items = [{ description: '', quantity: 1, unitPrice: 0 }]
    form.taxRate = 10
    form.status = 'draft'
    form.notes = ''
  }
  showModal.value = true
}

const addItem = () => {
  form.items.push({ description: '', quantity: 1, unitPrice: 0 })
}

const removeItem = (idx: number) => {
  form.items.splice(idx, 1)
}

const saveInvoice = async () => {
  try {
    const items = form.items.map(item => ({
      ...item,
      amount: item.quantity * item.unitPrice
    }))

    if (editingInvoice.value) {
      await $fetch(`/api/invoices/${editingInvoice.value.id}`, {
        method: 'PUT',
        body: { ...form, items },
        headers: getAuthHeaders()
      })
    } else {
      await $fetch('/api/invoices', {
        method: 'POST',
        body: { ...form, items },
        headers: getAuthHeaders()
      })
    }
    showModal.value = false
    loadInvoices()
  } catch (error) {
    console.error('Failed to save invoice:', error)
  }
}

const deleteInvoice = async (id: string) => {
  if (!confirm(t('admin.confirmDelete'))) return
  try {
    await $fetch(`/api/invoices/${id}`, { method: 'DELETE', headers: getAuthHeaders() })
    loadInvoices()
  } catch (error) {
    console.error('Failed to delete:', error)
  }
}

const viewPdf = (id: string) => {
  window.open(`/api/invoices/${id}/pdf`, '_blank')
}

const formatCurrency = (value: number) => {
  const currencyLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  const currency = locale.value === 'ko' ? 'KRW' : 'JPY'
  return new Intl.NumberFormat(currencyLocale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
}

const formatDate = (date: string) => {
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(date).toLocaleDateString(dateLocale)
}

const getStatusClass = (status: string) => {
  const classes: Record<string, string> = {
    draft: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
    sent: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    paid: 'bg-green-500/10 text-green-600 dark:text-green-400',
    overdue: 'bg-red-500/10 text-red-600 dark:text-red-400',
    cancelled: 'bg-gray-500/10 text-gray-500 dark:text-gray-500'
  }
  return classes[status] || 'bg-gray-500/10 text-gray-600 dark:text-gray-400'
}

onMounted(() => loadInvoices())
</script>
