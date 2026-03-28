<template>
  <div>
    <!-- Back Button Header -->
    <div class="mb-6 flex items-center justify-between">
      <div class="flex items-center">
        <button
            @click="router.back()"
            class="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-white/10"
        >
          <ArrowLeft size="20" class="text-gray-600 dark:text-gray-400" />
        </button>
        <h1 class="ml-2 text-xl font-medium text-gray-800 dark:text-gray-200">取引詳細</h1>
      </div>
      <div class="flex space-x-2">
        <button
            @click="editTransaction"
            class="px-4 py-2 text-sm bg-primary-main text-white rounded-xl hover:bg-primary-dark touch-manipulation"
        >
          編集
        </button>
        <button
            @click="deleteTransactionConfirm"
            class="px-4 py-2 text-sm border border-red-300 text-red-600 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 touch-manipulation"
        >
          削除
        </button>
      </div>
    </div>

    <div v-if="isLoading" class="flex justify-center items-center h-64">
      <Loader size="32" class="text-primary-main animate-spin" />
    </div>

    <div v-else-if="error" class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
      {{ error }}
    </div>

    <template v-else-if="transaction">
      <!-- Transaction Summary Card -->
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-6 mb-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <span :class="[
              'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium',
              transaction.type === '入金' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            ]">
              {{ transaction.type || '支出' }}
            </span>
            <span class="ml-2 text-sm text-gray-500 dark:text-gray-400">
              {{ transaction.referenceNumber || transaction.id }}
            </span>
          </div>
          <StatusBadge :status="transaction.status" />
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <!-- Amount -->
          <div>
            <p class="text-sm text-gray-500 dark:text-gray-400">金額</p>
            <p :class="[
              'text-2xl font-bold font-mono',
              transaction.type === '入金' ? 'text-green-600' : 'text-gray-900 dark:text-white'
            ]">
              {{ formatCurrency(transaction.amount) }}
            </p>
          </div>

          <!-- Date -->
          <div>
            <p class="text-sm text-gray-500 dark:text-gray-400">日付</p>
            <p class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ formatDate(transaction.date) }}
            </p>
          </div>

          <!-- Account Category -->
          <div>
            <p class="text-sm text-gray-500 dark:text-gray-400">勘定科目</p>
            <p class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ transaction.accountCategoryId?.name || transaction.accountCategoryName || '-' }}
            </p>
            <p v-if="transaction.subAccountCategoryId?.name || transaction.subAccountCategoryName" class="text-sm text-gray-500">
              {{ transaction.subAccountCategoryId?.name || transaction.subAccountCategoryName }}
            </p>
          </div>

          <!-- Receipt Status -->
          <div>
            <p class="text-sm text-gray-500 dark:text-gray-400">領収書</p>
            <p class="text-lg font-semibold" :class="transaction.hasReceipt ? 'text-green-600' : 'text-gray-400'">
              {{ transaction.hasReceipt ? 'あり' : 'なし' }}
            </p>
          </div>
        </div>
      </div>

      <!-- Two Column Layout for Details -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left Column - 2/3 width -->
        <div class="lg:col-span-2 space-y-6">
          <!-- Transaction Details Card -->
          <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-6">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">取引詳細</h2>

            <dl class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <dt class="text-sm text-gray-500 dark:text-gray-400">顧客</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ transaction.customerId?.name || transaction.customerName || '-' }}
                </dd>
              </div>

              <div>
                <dt class="text-sm text-gray-500 dark:text-gray-400">仕入れ先</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ transaction.supplierId?.name || transaction.supplierName || '-' }}
                </dd>
              </div>

              <div>
                <dt class="text-sm text-gray-500 dark:text-gray-400">税区分</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ transaction.taxCategoryId?.name || transaction.taxCategoryName || '-' }}
                </dd>
              </div>

              <div>
                <dt class="text-sm text-gray-500 dark:text-gray-400">税率</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ transaction.taxRate ? transaction.taxRate + '%' : '-' }}
                </dd>
              </div>

              <div>
                <dt class="text-sm text-gray-500 dark:text-gray-400">区分</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ transaction.transactionCategoryId?.name || transaction.transactionCategoryName || '-' }}
                </dd>
              </div>

              <div>
                <dt class="text-sm text-gray-500 dark:text-gray-400">法人情報</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ transaction.companyInfo || '-' }}
                </dd>
              </div>

              <div>
                <dt class="text-sm text-gray-500 dark:text-gray-400">インボイス番号</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ transaction.invoiceNumber || '-' }}
                </dd>
              </div>

              <div>
                <dt class="text-sm text-gray-500 dark:text-gray-400">レシート/注文番号</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ transaction.receiptNumber || '-' }}
                </dd>
              </div>

              <div>
                <dt class="text-sm text-gray-500 dark:text-gray-400">JAN CODE</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ transaction.janCode || '-' }}
                </dd>
              </div>

              <div>
                <dt class="text-sm text-gray-500 dark:text-gray-400">商品名</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ transaction.productName || '-' }}
                </dd>
              </div>

              <div v-if="transaction.productPrice">
                <dt class="text-sm text-gray-500 dark:text-gray-400">商品価格</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ formatCurrency(transaction.productPrice) }}
                </dd>
              </div>
            </dl>

            <div v-if="transaction.notes" class="mt-4 pt-4 border-t border-gray-200 dark:border-white/10">
              <dt class="text-sm text-gray-500 dark:text-gray-400 mb-1">メモ</dt>
              <dd class="text-sm text-gray-900 dark:text-white whitespace-pre-wrap">
                {{ transaction.notes }}
              </dd>
            </div>
          </div>

          <!-- Items Card -->
          <div v-if="transaction.items && transaction.items.length > 0" class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-6">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">商品明細</h2>

            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200 dark:divide-white/10">
                <thead>
                  <tr>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">商品名</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">JAN/商品コード</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">数量</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">単価</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">小計</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-white/10">
                  <tr v-for="(item, index) in transaction.items" :key="index">
                    <td class="px-4 py-3 text-sm text-gray-900 dark:text-white">
                      {{ item.productName || '-' }}
                      <a v-if="item.productUrl" :href="item.productUrl" target="_blank" class="ml-2 text-primary-main hover:text-primary-dark">
                        <ExternalLink class="h-3 w-3 inline" />
                      </a>
                    </td>
                    <td class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{{ item.janCode || '-' }}</td>
                    <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right">{{ item.quantity }}</td>
                    <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right">{{ formatCurrency(item.unitPrice) }}</td>
                    <td class="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white text-right">
                      {{ formatCurrency(item.quantity * item.unitPrice) }}
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr class="bg-gray-50 dark:bg-white/5">
                    <td colspan="4" class="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white text-right">合計</td>
                    <td class="px-4 py-3 text-sm font-bold text-gray-900 dark:text-white text-right">
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
          <div v-if="transaction.timeline && transaction.timeline.length > 0" class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-6">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">履歴</h2>

            <div class="flow-root">
              <ul class="-mb-8">
                <li v-for="(event, index) in transaction.timeline" :key="index">
                  <div class="relative pb-8">
                    <span v-if="index !== transaction.timeline.length - 1" class="absolute top-4 left-4 -ml-px h-full w-0.5 bg-gray-200 dark:bg-white/5" />
                    <div class="relative flex space-x-3">
                      <div>
                        <span :class="[
                          'h-8 w-8 rounded-full flex items-center justify-center ring-8 ring-white dark:ring-gray-800',
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
          <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-6">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">領収書</h2>

            <div v-if="transaction.hasReceipt && transaction.receiptFilePath">
              <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 rounded-md">
                <div class="flex items-center">
                  <FileText class="h-8 w-8 text-gray-400" />
                  <div class="ml-3">
                    <p class="text-sm font-medium text-gray-900 dark:text-white">領収書ファイル</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      {{ transaction.receiptUploadedAt ? formatDate(transaction.receiptUploadedAt) + ' アップロード' : '' }}
                    </p>
                  </div>
                </div>
                <button class="text-primary-main hover:text-primary-dark">
                  <Download class="h-5 w-5" />
                </button>
              </div>
            </div>
            <div v-else class="text-center py-6">
              <FileText class="mx-auto h-12 w-12 text-gray-300" />
              <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">領収書がありません</p>
              <button
                  @click="uploadReceipt"
                  class="mt-3 px-4 py-2 text-sm bg-primary-main text-white rounded-xl hover:bg-primary-dark touch-manipulation"
              >
                領収書をアップロード
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
import { ArrowLeft, Loader, FileText, Download, ExternalLink, Check, Clock, AlertCircle, Plus } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const transactionId = computed(() => route.params.id as string)

const transaction = ref<any>(null)
const isLoading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  await fetchTransaction()
})

const fetchTransaction = async () => {
  isLoading.value = true
  error.value = null

  try {
    const response = await $fetch<any>(`/api/transactions/${transactionId.value}`)
    transaction.value = {
      ...response,
      id: response.id || response._id,
      date: response.date || new Date().toISOString(),
      items: response.items || [],
      timeline: response.timeline || []
    }
  } catch (err: any) {
    error.value = err.message || '取引データの読み込みに失敗しました'
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
  // TODO: Implement edit modal or page
  alert('編集機能は準備中です')
}

const deleteTransactionConfirm = async () => {
  if (confirm('この取引を削除しますか？')) {
    try {
      await $fetch(`/api/transactions/${transactionId.value}`, { method: 'DELETE' })
      router.push('/transactions')
    } catch (err) {
      console.error('Failed to delete transaction:', err)
      alert('削除に失敗しました')
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
