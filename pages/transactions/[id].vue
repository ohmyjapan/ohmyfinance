<template>
  <div>
    <!-- Back Button + Title Header -->
    <div class="mb-6 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <button
          @click="router.back()"
          class="w-10 h-10 rounded-xl bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 flex items-center justify-center transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md touch-manipulation"
        >
          <ArrowLeft class="w-5 h-5 text-gray-600 dark:text-gray-400" />
        </button>
        <div>
          <h1 class="text-xl font-semibold text-gray-800 dark:text-white">{{ t('transactionDetail.title') }}</h1>
          <p v-if="transaction" class="text-sm text-gray-500 dark:text-gray-400">
            {{ transaction.referenceNumber || transaction.id }}
          </p>
        </div>
      </div>
      <div class="flex gap-2">
        <button
          @click="editTransaction"
          class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 transition-all duration-300 touch-manipulation"
        >
          <Pencil class="w-4 h-4" />
          {{ t('transactionDetail.edit') }}
        </button>
        <button
          @click="deleteTransactionConfirm"
          class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-400 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-300 touch-manipulation"
        >
          <Trash2 class="w-4 h-4" />
          {{ t('transactionDetail.delete') }}
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="flex justify-center items-center h-64">
      <div class="flex items-center gap-3">
        <Loader2 class="w-6 h-6 text-primary-main animate-spin" />
        <span class="text-gray-500 dark:text-gray-400">{{ t('common.loading') }}</span>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="rounded-2xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-900/10 backdrop-blur-sm p-6">
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 rounded-xl bg-red-500/10 dark:bg-red-500/20 flex items-center justify-center">
          <AlertCircle class="w-6 h-6 text-red-500" />
        </div>
        <div>
          <p class="font-medium text-red-800 dark:text-red-300">{{ t('common.error') }}</p>
          <p class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
        </div>
      </div>
    </div>

    <template v-else-if="transaction">
      <!-- Transaction Summary Card -->
      <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm p-6 mb-6 transition-all duration-300 hover:shadow-lg">
        <div class="flex items-center justify-between mb-6">
          <div class="flex items-center gap-3">
            <span :class="[
              'inline-flex items-center px-3 py-1 rounded-lg text-sm font-medium',
              transaction.type === '入金'
                ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                : 'bg-red-500/10 text-red-600 dark:text-red-400'
            ]">
              {{ transaction.type || t('transactions.expense') }}
            </span>
            <StatusBadge :status="transaction.status" />
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <!-- Amount -->
          <div class="flex items-start gap-3">
            <div class="w-12 h-12 rounded-xl bg-primary-main/10 dark:bg-primary-main/20 flex items-center justify-center flex-shrink-0">
              <DollarSign class="w-6 h-6 text-primary-main dark:text-primary-light" />
            </div>
            <div>
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('transactionDetail.amount') }}</p>
              <p :class="[
                'text-2xl font-bold font-mono',
                transaction.type === '入金' ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'
              ]">
                {{ formatCurrency(transaction.amount) }}
              </p>
            </div>
          </div>

          <!-- Date -->
          <div class="flex items-start gap-3">
            <div class="w-12 h-12 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              <Calendar class="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('transactionDetail.date') }}</p>
              <p class="text-lg font-semibold text-gray-900 dark:text-white">
                {{ formatDate(transaction.date) }}
              </p>
            </div>
          </div>

          <!-- Account Category -->
          <div class="flex items-start gap-3">
            <div class="w-12 h-12 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <Tag class="w-6 h-6 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('transactionDetail.accountCategory') }}</p>
              <p class="text-lg font-semibold text-gray-900 dark:text-white">
                {{ transaction.accountCategoryId?.name || transaction.accountCategoryName || '-' }}
              </p>
              <p v-if="transaction.subAccountCategoryId?.name || transaction.subAccountCategoryName" class="text-sm text-gray-500 dark:text-gray-400">
                {{ transaction.subAccountCategoryId?.name || transaction.subAccountCategoryName }}
              </p>
            </div>
          </div>

          <!-- Receipt Status -->
          <div class="flex items-start gap-3">
            <div class="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
              :class="transaction.hasReceipt ? 'bg-green-500/10 dark:bg-green-500/20' : 'bg-gray-500/10 dark:bg-gray-500/20'"
            >
              <FileText class="w-6 h-6" :class="transaction.hasReceipt ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'" />
            </div>
            <div>
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('transactionDetail.receipt') }}</p>
              <p class="text-lg font-semibold" :class="transaction.hasReceipt ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'">
                {{ transaction.hasReceipt ? t('transactionDetail.receiptExists') : t('transactionDetail.receiptNone') }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Two Column Layout for Details -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left Column - 2/3 width -->
        <div class="lg:col-span-2 space-y-6">
          <!-- Transaction Details Card -->
          <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm p-6 transition-all duration-300 hover:shadow-lg">
            <div class="flex items-center gap-2 mb-5">
              <div class="w-8 h-8 rounded-lg bg-primary-main/10 dark:bg-primary-main/20 flex items-center justify-center">
                <ClipboardList class="w-4 h-4 text-primary-main dark:text-primary-light" />
              </div>
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('transactionDetail.details') }}</h2>
            </div>

            <dl class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="p-3 rounded-xl bg-gray-50 dark:bg-white/[0.03]">
                <dt class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{{ t('transactionDetail.customer') }}</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ transaction.customerId?.name || transaction.customerName || '-' }}
                </dd>
              </div>

              <div class="p-3 rounded-xl bg-gray-50 dark:bg-white/[0.03]">
                <dt class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{{ t('transactionDetail.supplier') }}</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ transaction.supplierId?.name || transaction.supplierName || '-' }}
                </dd>
              </div>

              <div class="p-3 rounded-xl bg-gray-50 dark:bg-white/[0.03]">
                <dt class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{{ t('transactionDetail.taxCategory') }}</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ transaction.taxCategoryId?.name || transaction.taxCategoryName || '-' }}
                </dd>
              </div>

              <div class="p-3 rounded-xl bg-gray-50 dark:bg-white/[0.03]">
                <dt class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{{ t('transactionDetail.taxRate') }}</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white font-mono">
                  {{ transaction.taxRate ? transaction.taxRate + '%' : '-' }}
                </dd>
              </div>

              <div class="p-3 rounded-xl bg-gray-50 dark:bg-white/[0.03]">
                <dt class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{{ t('transactionDetail.transactionCategory') }}</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ transaction.transactionCategoryId?.name || transaction.transactionCategoryName || '-' }}
                </dd>
              </div>

              <div class="p-3 rounded-xl bg-gray-50 dark:bg-white/[0.03]">
                <dt class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{{ t('transactionDetail.companyInfo') }}</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ transaction.companyInfo || '-' }}
                </dd>
              </div>

              <div class="p-3 rounded-xl bg-gray-50 dark:bg-white/[0.03]">
                <dt class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{{ t('transactionDetail.invoiceNumber') }}</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white font-mono">
                  {{ transaction.invoiceNumber || '-' }}
                </dd>
              </div>

              <div class="p-3 rounded-xl bg-gray-50 dark:bg-white/[0.03]">
                <dt class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{{ t('transactionDetail.receiptNumber') }}</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white font-mono">
                  {{ transaction.receiptNumber || '-' }}
                </dd>
              </div>

              <div class="p-3 rounded-xl bg-gray-50 dark:bg-white/[0.03]">
                <dt class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{{ t('transactionDetail.janCode') }}</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white font-mono">
                  {{ transaction.janCode || '-' }}
                </dd>
              </div>

              <div class="p-3 rounded-xl bg-gray-50 dark:bg-white/[0.03]">
                <dt class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{{ t('transactionDetail.productName') }}</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ transaction.productName || '-' }}
                </dd>
              </div>

              <div v-if="transaction.productPrice" class="p-3 rounded-xl bg-gray-50 dark:bg-white/[0.03]">
                <dt class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{{ t('transactionDetail.productPrice') }}</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white font-mono">
                  {{ formatCurrency(transaction.productPrice) }}
                </dd>
              </div>
            </dl>

            <div v-if="transaction.notes" class="mt-5 pt-5 border-t border-gray-200 dark:border-white/10">
              <dt class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">{{ t('transactionDetail.notes') }}</dt>
              <dd class="text-sm text-gray-900 dark:text-white whitespace-pre-wrap p-3 rounded-xl bg-gray-50 dark:bg-white/[0.03]">
                {{ transaction.notes }}
              </dd>
            </div>
          </div>

          <!-- Items Card -->
          <div v-if="transaction.items && transaction.items.length > 0" class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm overflow-hidden transition-all duration-300 hover:shadow-lg">
            <div class="p-6 pb-4">
              <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-lg bg-teal-500/10 dark:bg-teal-500/20 flex items-center justify-center">
                  <Package class="w-4 h-4 text-teal-600 dark:text-teal-400" />
                </div>
                <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('transactionDetail.itemDetails') }}</h2>
              </div>
            </div>

            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200 dark:divide-white/10">
                <thead class="bg-gray-50 dark:bg-white/5">
                  <tr>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{{ t('transactionDetail.itemName') }}</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{{ t('transactionDetail.itemCode') }}</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{{ t('transactionDetail.quantity') }}</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{{ t('transactionDetail.unitPrice') }}</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{{ t('transactionDetail.subtotal') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-white/10">
                  <tr v-for="(item, index) in transaction.items" :key="index" class="hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                    <td class="px-4 py-3 text-sm text-gray-900 dark:text-white">
                      {{ item.productName || '-' }}
                      <a v-if="item.productUrl" :href="item.productUrl" target="_blank" class="ml-2 text-primary-main hover:text-primary-dark inline-flex items-center">
                        <ExternalLink class="h-3 w-3" />
                      </a>
                    </td>
                    <td class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 font-mono">{{ item.janCode || '-' }}</td>
                    <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right font-mono">{{ item.quantity }}</td>
                    <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right font-mono">{{ formatCurrency(item.unitPrice) }}</td>
                    <td class="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white text-right font-mono">
                      {{ formatCurrency(item.quantity * item.unitPrice) }}
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr class="bg-gray-50 dark:bg-white/5">
                    <td colspan="4" class="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white text-right">{{ t('transactionDetail.total') }}</td>
                    <td class="px-4 py-3 text-sm font-bold text-gray-900 dark:text-white text-right font-mono">
                      {{ formatCurrency(calculateItemsTotal()) }}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        <!-- Right Column - 1/3 width -->
        <div class="space-y-6">
          <!-- Timeline Card -->
          <div v-if="transaction.timeline && transaction.timeline.length > 0" class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm p-6 transition-all duration-300 hover:shadow-lg">
            <div class="flex items-center gap-2 mb-5">
              <div class="w-8 h-8 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center">
                <Clock class="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('transactionDetail.timeline') }}</h2>
            </div>

            <div class="flow-root">
              <ul class="-mb-8">
                <li v-for="(event, index) in transaction.timeline" :key="index">
                  <div class="relative pb-8">
                    <span v-if="index !== transaction.timeline.length - 1" class="absolute top-4 left-4 -ml-px h-full w-0.5 bg-gray-200 dark:bg-white/10" />
                    <div class="relative flex space-x-3">
                      <div>
                        <span :class="[
                          'h-8 w-8 rounded-full flex items-center justify-center ring-4 ring-white dark:ring-gray-900',
                          getTimelineColor(event.type)
                        ]">
                          <component :is="getTimelineIcon(event.type)" class="h-4 w-4 text-white" />
                        </span>
                      </div>
                      <div class="flex min-w-0 flex-1 justify-between space-x-4 pt-1.5">
                        <div>
                          <p class="text-sm text-gray-900 dark:text-white">{{ event.title }}</p>
                          <p v-if="event.description" class="text-xs text-gray-500 dark:text-gray-400">{{ event.description }}</p>
                        </div>
                        <div class="whitespace-nowrap text-right text-xs text-gray-500 dark:text-gray-400">
                          {{ formatDateTime(event.timestamp) }}
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              </ul>
            </div>
          </div>

          <!-- Receipt Card -->
          <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm p-6 transition-all duration-300 hover:shadow-lg">
            <div class="flex items-center gap-2 mb-5">
              <div class="w-8 h-8 rounded-lg bg-green-500/10 dark:bg-green-500/20 flex items-center justify-center">
                <Receipt class="w-4 h-4 text-green-600 dark:text-green-400" />
              </div>
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('transactionDetail.receipt') }}</h2>
            </div>

            <div v-if="transaction.hasReceipt && transaction.receiptFilePath">
              <div class="flex items-center justify-between p-4 bg-gray-50 dark:bg-white/[0.03] rounded-xl border border-gray-200 dark:border-white/10">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-lg bg-primary-main/10 dark:bg-primary-main/20 flex items-center justify-center">
                    <FileText class="h-5 w-5 text-primary-main dark:text-primary-light" />
                  </div>
                  <div>
                    <p class="text-sm font-medium text-gray-900 dark:text-white">{{ t('transactionDetail.receiptFile') }}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      {{ transaction.receiptUploadedAt ? formatDate(transaction.receiptUploadedAt) + ' ' + t('transactionDetail.uploaded') : '' }}
                    </p>
                  </div>
                </div>
                <button class="w-10 h-10 rounded-xl bg-primary-main/10 dark:bg-primary-main/20 flex items-center justify-center hover:bg-primary-main/20 dark:hover:bg-primary-main/30 transition-colors touch-manipulation">
                  <Download class="h-5 w-5 text-primary-main dark:text-primary-light" />
                </button>
              </div>
            </div>
            <div v-else class="text-center py-8">
              <div class="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-white/5 flex items-center justify-center mx-auto mb-3">
                <FileText class="w-8 h-8 text-gray-300 dark:text-gray-600" />
              </div>
              <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">{{ t('transactionDetail.noReceipt') }}</p>
              <button
                @click="uploadReceipt"
                class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 transition-all duration-300 touch-manipulation"
              >
                <Upload class="w-4 h-4" />
                {{ t('transactionDetail.uploadReceipt') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  ArrowLeft, Loader2, FileText, Download, ExternalLink,
  Check, Clock, AlertCircle, Plus, Pencil, Trash2,
  DollarSign, Calendar, Tag, ClipboardList, Package,
  Upload, Receipt
} from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const getAuthHeaders = () => userStore.authHeader

const transactionId = computed(() => route.params.id as string)

const transaction = ref<any>(null)
const isLoading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  userStore.initAuth()
  await fetchTransaction()
})

const fetchTransaction = async () => {
  isLoading.value = true
  error.value = null

  try {
    const response = await $fetch<any>(`/api/transactions/${transactionId.value}`, {
      headers: getAuthHeaders()
    })
    transaction.value = {
      ...response,
      id: response.id || response._id,
      date: response.date || new Date().toISOString(),
      items: response.items || [],
      timeline: response.timeline || []
    }
  } catch (err: any) {
    error.value = err.message || t('transactionDetail.loadFailed')
    console.error(err)
  } finally {
    isLoading.value = false
  }
}

const formatDate = (dateString: string) => {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

const formatDateTime = (dateString: string) => {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const formatCurrency = (amount: number) => {
  if (amount === undefined || amount === null) return '-'
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    currencyDisplay: 'narrowSymbol'
  }).format(amount)
}

const calculateItemsTotal = () => {
  if (!transaction.value?.items) return 0
  return transaction.value.items.reduce((sum: number, item: any) => {
    return sum + (item.quantity || 0) * (item.unitPrice || 0)
  }, 0)
}

const getTimelineColor = (type: string) => {
  const colors: Record<string, string> = {
    created: 'bg-blue-500',
    updated: 'bg-yellow-500',
    completed: 'bg-green-500',
    imported: 'bg-primary-main/100',
    receipt_linked: 'bg-teal-500',
    failed: 'bg-red-500'
  }
  return colors[type] || 'bg-gray-500'
}

const getTimelineIcon = (type: string) => {
  const icons: Record<string, any> = {
    created: Plus,
    updated: Clock,
    completed: Check,
    imported: FileText,
    receipt_linked: FileText,
    failed: AlertCircle
  }
  return icons[type] || Clock
}

const editTransaction = () => {
  alert(t('transactionDetail.editInProgress'))
}

const deleteTransactionConfirm = async () => {
  if (confirm(t('transactionDetail.deleteConfirm'))) {
    try {
      await $fetch(`/api/transactions/${transactionId.value}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      router.push('/transactions')
    } catch (err) {
      console.error('Failed to delete transaction:', err)
      alert(t('transactionDetail.deleteFailed'))
    }
  }
}

const uploadReceipt = () => {
  router.push({
    path: '/receipts/upload',
    query: { transactionId: transactionId.value }
  })
}
</script>
