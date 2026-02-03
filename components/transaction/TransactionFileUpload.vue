<template>
  <div class="space-y-6">
    <!-- Source Selection - Horizontal -->
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
        {{ t('transactionImport.selectSource') }}
      </label>
      <div class="flex gap-3">
        <button
          v-for="source in sources"
          :key="source.id"
          type="button"
          class="flex-1 flex items-center gap-3 p-4 rounded-xl border-2 transition-all"
          :class="selectedSource === source.id
            ? 'border-primary-main bg-primary-main/10 dark:bg-primary-main/20'
            : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'"
          @click="$emit('source-selected', source.id)"
        >
          <div
            class="w-10 h-10 rounded-lg flex items-center justify-center"
            :class="selectedSource === source.id ? 'bg-primary-main text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'"
          >
            <component :is="source.icon" class="h-5 w-5" />
          </div>
          <div class="text-left flex-1">
            <p class="text-sm font-medium text-gray-900 dark:text-white">{{ source.label }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ source.desc }}</p>
          </div>
          <CheckCircle v-if="selectedSource === source.id" class="h-5 w-5 text-primary-main" />
        </button>
      </div>
    </div>

    <!-- Upload Area - Full Width -->
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
      <div
        class="border-2 border-dashed rounded-xl p-8 transition-all cursor-pointer"
        :class="isDragging
          ? 'border-primary-main bg-primary-main/10'
          : 'border-gray-300 dark:border-gray-600 hover:border-primary-main/50'"
        @dragenter.prevent="isDragging = true"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="handleDrop"
        @click="fileInput?.click()"
      >
        <input ref="fileInput" type="file" class="hidden" accept=".csv,.xls,.xlsx" multiple @change="handleFileInput" />
        <div class="flex flex-col items-center">
          <Upload class="h-10 w-10 text-gray-400 mb-3" />
          <p class="text-base font-medium text-gray-900 dark:text-white mb-1">
            {{ isDragging ? 'ここにドロップ' : 'ファイルをドラッグ＆ドロップ' }}
          </p>
          <p class="text-sm text-gray-500 mb-4">CSV, XLS, XLSX（最大10MB）</p>
          <button
            type="button"
            class="px-4 py-2 bg-primary-main text-white rounded-lg hover:bg-primary-dark transition-colors"
            @click.stop="fileInput?.click()"
          >
            ファイルを選択
          </button>
        </div>
      </div>

      <!-- Error -->
      <div v-if="error" class="mt-4 p-3 bg-error-light/50 border border-error-main/30 rounded-lg flex items-center gap-2">
        <AlertCircle class="h-5 w-5 text-error-main flex-shrink-0" />
        <p class="text-sm text-error-main">{{ error }}</p>
      </div>
    </div>

    <!-- Files Table - Full Width -->
    <div v-if="selectedFiles.length > 0" class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h3 class="font-medium text-gray-900 dark:text-white">
          アップロードファイル
          <span class="ml-2 text-sm text-gray-500">{{ selectedFiles.length }}件</span>
        </h3>
        <button type="button" class="text-sm text-error-main hover:underline" @click="clearFiles">
          すべてクリア
        </button>
      </div>

      <!-- Table -->
      <table class="w-full">
        <thead class="bg-gray-50 dark:bg-gray-700/50">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">ファイル名</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-24">形式</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-24">サイズ</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-24">行数</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-28">ステータス</th>
            <th class="px-4 py-3 w-16"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
          <tr v-for="(file, index) in selectedFiles" :key="index" class="hover:bg-gray-50 dark:hover:bg-gray-700/30">
            <td class="px-4 py-3">
              <div class="flex items-center gap-3">
                <div
                  class="w-8 h-8 rounded flex items-center justify-center"
                  :class="file.isValid ? 'bg-success-light text-success-main' : file.isProcessing ? 'bg-primary-light text-primary-main' : 'bg-error-light text-error-main'"
                >
                  <Loader2 v-if="file.isProcessing" class="h-4 w-4 animate-spin" />
                  <FileSpreadsheet v-else class="h-4 w-4" />
                </div>
                <span class="text-sm font-medium text-gray-900 dark:text-white truncate max-w-xs">{{ file.name }}</span>
              </div>
            </td>
            <td class="px-4 py-3">
              <span class="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-xs font-medium rounded">
                {{ getFileType(file.name) }}
              </span>
            </td>
            <td class="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{{ formatFileSize(file.size) }}</td>
            <td class="px-4 py-3 text-sm">
              <span v-if="file.rowCount" class="text-success-main font-medium">{{ file.rowCount.toLocaleString() }}</span>
              <span v-else-if="file.isProcessing" class="text-gray-400">-</span>
              <span v-else class="text-error-main">-</span>
            </td>
            <td class="px-4 py-3">
              <span
                v-if="file.isProcessing"
                class="inline-flex items-center gap-1 px-2 py-1 bg-primary-light text-primary-main text-xs font-medium rounded-full"
              >
                <Loader2 class="h-3 w-3 animate-spin" />
                処理中
              </span>
              <span
                v-else-if="file.isValid"
                class="inline-flex items-center gap-1 px-2 py-1 bg-success-light text-success-main text-xs font-medium rounded-full"
              >
                <CheckCircle class="h-3 w-3" />
                有効
              </span>
              <span
                v-else
                class="inline-flex items-center gap-1 px-2 py-1 bg-error-light text-error-main text-xs font-medium rounded-full"
                :title="file.error"
              >
                <AlertCircle class="h-3 w-3" />
                エラー
              </span>
            </td>
            <td class="px-4 py-3">
              <button
                type="button"
                class="p-1 text-gray-400 hover:text-error-main rounded transition-colors"
                @click="removeFile(index)"
              >
                <X class="h-4 w-4" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Error Details -->
      <div v-if="selectedFiles.some(f => f.error)" class="px-4 py-3 bg-error-light/30 border-t border-error-main/20">
        <p class="text-sm text-error-main">
          <strong>エラー詳細:</strong>
          {{ selectedFiles.find(f => f.error)?.error }}
        </p>
      </div>
    </div>

    <!-- Action -->
    <div class="flex justify-end">
      <button
        type="button"
        class="px-6 py-3 rounded-xl text-sm font-medium transition-all"
        :class="canContinue
          ? 'bg-primary-main text-white hover:bg-primary-dark'
          : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'"
        :disabled="!canContinue"
        @click="continueToMapping"
      >
        マッピングに進む
        <ArrowRight class="inline-block ml-2 h-4 w-4" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { FileSpreadsheet, Upload, CreditCard, Wallet, Globe, ArrowRight, CheckCircle, AlertCircle, X, Loader2 } from 'lucide-vue-next'

const { t } = useI18n()

interface ProcessedFile {
  name: string
  size: number
  type: string
  isValid: boolean
  isProcessing: boolean
  rowCount?: number
  headers?: string[]
  data?: any[]
  error?: string
  file: File
}

const props = defineProps({
  selectedSource: { type: String, default: 'credit_card' }
})

const emit = defineEmits(['source-selected', 'files-selected', 'continue'])

const sources = [
  { id: 'credit_card', label: 'クレジットカード', desc: 'カード明細をインポート', icon: CreditCard },
  { id: 'payment_gateway', label: '決済ゲートウェイ', desc: 'Stripe, PayPal等', icon: Wallet },
  { id: 'overseas', label: '海外取引', desc: '海外注文データ', icon: Globe }
]

const isDragging = ref(false)
const selectedFiles = ref<ProcessedFile[]>([])
const error = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const canContinue = computed(() => selectedFiles.value.length > 0 && selectedFiles.value.every(f => f.isValid && !f.isProcessing))

const handleFileInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  if (target.files?.length) {
    processFiles(Array.from(target.files))
  }
  target.value = ''
}

const handleDrop = (event: DragEvent) => {
  isDragging.value = false
  if (event.dataTransfer?.files?.length) {
    processFiles(Array.from(event.dataTransfer.files))
  }
}

const processFiles = async (files: File[]) => {
  error.value = ''
  const validExts = ['.csv', '.xls', '.xlsx']

  for (const file of files) {
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()

    if (!validExts.includes(ext)) {
      error.value = `無効な形式: ${file.name}`
      continue
    }

    if (file.size > 10 * 1024 * 1024) {
      error.value = `サイズ超過: ${file.name}`
      continue
    }

    if (selectedFiles.value.some(f => f.name === file.name)) continue

    const pf: ProcessedFile = { name: file.name, size: file.size, type: file.type, isValid: false, isProcessing: true, file }
    selectedFiles.value.push(pf)

    try {
      const formData = new FormData()
      formData.append('file', file)

      console.log('Uploading file:', file.name, 'size:', file.size, 'type:', file.type)

      const res = await fetch('/api/excel-processor', {
        method: 'POST',
        body: formData
      }).then(r => r.json())

      console.log('Response:', JSON.stringify(res, null, 2))

      const idx = selectedFiles.value.findIndex(f => f.name === file.name)
      if (idx !== -1) {
        if (res.success && res.data && res.data.length > 0) {
          selectedFiles.value[idx] = {
            ...selectedFiles.value[idx],
            isValid: true,
            isProcessing: false,
            rowCount: res.data.length,
            headers: res.headers,
            data: res.data
          }
          console.log('File processed successfully:', file.name, 'rows:', res.data.length)
        } else {
          const errorMsg = res.error || res.statusMessage || (res.data?.length === 0 ? 'データが空です' : '処理に失敗しました')
          selectedFiles.value[idx] = {
            ...selectedFiles.value[idx],
            isValid: false,
            isProcessing: false,
            error: errorMsg
          }
          console.error('File validation failed:', file.name, errorMsg)
        }
      }
    } catch (err: any) {
      console.error('Upload error:', err)
      const idx = selectedFiles.value.findIndex(f => f.name === file.name)
      if (idx !== -1) {
        const errorMsg = err.data?.statusMessage || err.data?.message || err.message || 'アップロード失敗'
        selectedFiles.value[idx] = {
          ...selectedFiles.value[idx],
          isValid: false,
          isProcessing: false,
          error: errorMsg
        }
        console.error('File error details:', errorMsg)
      }
    }
  }
}

const removeFile = (i: number) => selectedFiles.value.splice(i, 1)
const clearFiles = () => { selectedFiles.value = []; error.value = '' }

const getFileType = (name: string) => {
  const ext = name.substring(name.lastIndexOf('.')).toLowerCase()
  return ext === '.csv' ? 'CSV' : ext === '.xls' ? 'XLS' : ext === '.xlsx' ? 'XLSX' : '?'
}

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

const continueToMapping = () => {
  emit('files-selected', selectedFiles.value.map(f => ({ name: f.name, size: f.size, type: f.type, isValid: f.isValid, rowCount: f.rowCount, headers: f.headers, data: f.data, file: f.file })))
  emit('continue')
}
</script>
