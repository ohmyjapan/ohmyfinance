<template>
  <div class="overflow-x-auto">
    <table class="min-w-full">
      <thead>
        <tr class="border-b border-gray-200 dark:border-white/10">
          <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            {{ t('receiptTable.receipt') }}
          </th>
          <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            {{ t('receiptTable.dateUploaded') }}
          </th>
          <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            {{ t('receiptTable.amount') }}
          </th>
          <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            {{ t('receiptTable.merchant') }}
          </th>
          <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            {{ t('receiptTable.status') }}
          </th>
          <th class="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            {{ t('receiptTable.actions') }}
          </th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100 dark:divide-white/5">
        <tr
          v-for="receipt in receipts"
          :key="receipt.id"
          class="group transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
        >
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-gray-100 dark:bg-white/10 flex items-center justify-center flex-shrink-0">
                <component :is="getFileIcon(receipt.filename)" class="w-5 h-5 text-gray-500 dark:text-gray-400" />
              </div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-gray-900 dark:text-white truncate max-w-[200px]">{{ receipt.filename }}</p>
                <p class="text-xs text-gray-400 dark:text-gray-500">{{ formatFileSize(receipt.size) }}</p>
              </div>
            </div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <p class="text-sm text-gray-900 dark:text-gray-200">{{ formatDate(receipt.uploadDate) }}</p>
            <p class="text-xs text-gray-400 dark:text-gray-500">{{ formatTime(receipt.uploadDate) }}</p>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <p v-if="receipt.amount" class="text-sm font-mono font-medium text-gray-900 dark:text-white">
              {{ formatCurrency(receipt.amount) }}
            </p>
            <span v-else class="text-sm text-gray-300 dark:text-gray-600">--</span>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <p v-if="receipt.merchant" class="text-sm text-gray-900 dark:text-gray-200">{{ receipt.merchant }}</p>
            <span v-else class="text-sm text-gray-300 dark:text-gray-600">--</span>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <span v-if="receipt.status === 'matched'"
              class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-green-500/10 text-green-600 dark:text-green-400"
            >
              <CheckCircle class="w-3.5 h-3.5" />
              {{ t('receiptTable.matched') }}
            </span>
            <span v-else
              class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400"
            >
              <AlertTriangle class="w-3.5 h-3.5" />
              {{ t('receiptTable.unmatched') }}
            </span>
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-right">
            <div class="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <button
                @click="$emit('view', receipt.id)"
                class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-primary-main transition-all touch-manipulation"
                :title="t('common.view')"
              >
                <Eye class="w-4 h-4" />
              </button>
              <button
                v-if="receipt.status === 'unmatched'"
                @click="$emit('match', receipt.id)"
                class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-primary-main transition-all touch-manipulation"
                :title="t('receiptTable.match')"
              >
                <Link class="w-4 h-4" />
              </button>
              <button
                @click="confirmDelete(receipt.id)"
                class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 transition-all touch-manipulation"
                :title="t('common.delete')"
              >
                <Trash2 class="w-4 h-4" />
              </button>
            </div>
          </td>
        </tr>

        <!-- Empty state -->
        <tr v-if="receipts.length === 0">
          <td colspan="6" class="px-6 py-16 text-center">
            <div class="flex flex-col items-center">
              <div class="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-white/10 flex items-center justify-center mb-4">
                <FileText class="w-8 h-8 text-gray-300 dark:text-gray-600" />
              </div>
              <p class="text-sm font-medium text-gray-500 dark:text-gray-400">{{ t('receiptTable.noReceipts') }}</p>
              <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">{{ t('receiptUpload.dragAndDrop') }}</p>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, h } from 'vue'
import { FileText, Image, CheckCircle, AlertTriangle, Eye, Link, Trash2 } from 'lucide-vue-next'

const { t, locale } = useI18n()

defineProps({
  receipts: {
    type: Array as () => any[],
    required: true
  }
})

defineEmits(['view', 'match', 'delete'])

const getFileIcon = (filename: string) => {
  const ext = filename?.split('.').pop()?.toLowerCase()
  if (['jpg', 'jpeg', 'png', 'heic', 'webp'].includes(ext || '')) return Image
  return FileText
}

const formatFileSize = (bytes: number) => {
  if (!bytes) return '--'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

const formatDate = (isoDate: string) => {
  if (!isoDate) return '--'
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(isoDate).toLocaleDateString(dateLocale, { year: 'numeric', month: 'short', day: 'numeric' })
}

const formatTime = (isoDate: string) => {
  if (!isoDate) return ''
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(isoDate).toLocaleTimeString(dateLocale, { hour: 'numeric', minute: '2-digit', hour12: false })
}

const formatCurrency = (amount: number) => {
  const currencyLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  const currency = locale.value === 'ko' ? 'KRW' : 'JPY'
  return new Intl.NumberFormat(currencyLocale, { style: 'currency', currency, minimumFractionDigits: 0 }).format(amount)
}

const confirmDelete = (receiptId: string) => {
  if (confirm(t('receiptTable.confirmDelete'))) {
    emit('delete', receiptId)
  }
}
</script>
