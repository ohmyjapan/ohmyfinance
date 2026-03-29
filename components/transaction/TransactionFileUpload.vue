<template>
  <div class="space-y-6">
    <!-- Source Selection with Icon Boxes -->
    <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm p-5">
      <label class="block text-sm font-semibold text-gray-900 dark:text-white mb-4">
        {{ t('transactionImport.selectSource') }}
      </label>
      <div class="flex gap-3">
        <button
          v-for="source in sources"
          :key="source.id"
          type="button"
          class="flex-1 flex items-center gap-4 p-4 rounded-xl border-2 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md touch-manipulation"
          :class="selectedSource === source.id
            ? 'border-primary-main bg-primary-main/5 dark:bg-primary-main/10'
            : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'"
          @click="$emit('source-selected', source.id)"
        >
          <div
            class="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-300"
            :class="selectedSource === source.id
              ? 'bg-primary-main text-white shadow-lg shadow-primary-main/25'
              : 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400'"
          >
            <component :is="source.icon" class="h-6 w-6" />
          </div>
          <div class="text-left flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-900 dark:text-white">{{ source.label }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ source.desc }}</p>
          </div>
          <CheckCircle v-if="selectedSource === source.id" class="h-5 w-5 text-primary-main flex-shrink-0" />
        </button>
      </div>
    </div>

    <!-- Hero Dropzone -->
    <div class="relative">
      <!-- Decorative glow -->
      <div
        class="absolute -inset-1 bg-gradient-to-r from-primary-main via-primary-dark to-primary-main rounded-3xl blur-lg opacity-0 dark:opacity-10 transition-opacity duration-500"
        :class="{ 'dark:opacity-25 opacity-10': isDragging }"
      ></div>

      <div
        class="relative rounded-2xl border-2 border-dashed bg-white dark:bg-white/5 backdrop-blur-sm transition-all duration-300 overflow-hidden cursor-pointer"
        :class="isDragging
          ? 'border-primary-main bg-primary-main/5 dark:bg-primary-main/10 scale-[1.01]'
          : 'border-gray-300 dark:border-white/20 hover:border-primary-main/50 dark:hover:border-primary-main/30'"
        @dragenter.prevent="isDragging = true"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="handleDrop"
        @click="fileInput?.click()"
      >
        <input ref="fileInput" type="file" class="hidden" accept=".csv,.xls,.xlsx" multiple @change="handleFileInput" />

        <div class="flex flex-col items-center justify-center py-16 px-6">
          <!-- Animated upload icon -->
          <div
            class="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-main/20 to-primary-dark/20 dark:from-primary-main/30 dark:to-primary-dark/30 flex items-center justify-center mb-6 transition-transform duration-300"
            :class="{ 'scale-110': isDragging }"
          >
            <Upload
              class="w-10 h-10 text-primary-main transition-transform duration-300"
              :class="{ '-translate-y-1': isDragging }"
            />
          </div>

          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            {{ isDragging ? t('transactionImport.dropFilesHere') : t('transactionImport.dragDropFiles') }}
          </h3>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">{{ t('transactionImport.supportedFormats') }}</p>

          <button
            type="button"
            class="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white font-medium rounded-xl shadow-lg shadow-primary-main/25 hover:shadow-xl hover:shadow-primary-main/30 transition-all duration-300 hover:-translate-y-0.5 touch-manipulation"
            @click.stop="fileInput?.click()"
          >
            <Upload class="w-4 h-4" />
            {{ t('transactionImport.selectFile') }}
          </button>

          <!-- Format badge row -->
          <div class="flex items-center gap-3 mt-6">
            <span
              v-for="fmt in ['CSV', 'XLS', 'XLSX']"
              :key="fmt"
              class="px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400"
            >{{ fmt }}</span>
            <span class="text-xs text-gray-400 dark:text-gray-500">{{ t('transactionImport.maxSize') }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-if="error" class="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 p-4 flex items-start gap-3">
      <AlertCircle class="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
      <p class="text-sm font-medium text-red-800 dark:text-red-400 flex-1">{{ error }}</p>
      <button @click="error = ''" class="ml-auto text-red-400 hover:text-red-600 dark:hover:text-red-300 touch-manipulation">
        <X class="w-4 h-4" />
      </button>
    </div>

    <!-- Files Table - Modern -->
    <div v-if="selectedFiles.length > 0" class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm overflow-hidden">
      <div class="px-5 py-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <FileSpreadsheet class="w-4 h-4 text-primary-main" />
          {{ t('transactionImport.uploadedFiles') }}
          <span class="ml-1 px-2 py-0.5 text-xs font-medium rounded-full bg-primary-main/10 text-primary-main">
            {{ t('transactionImport.filesCount', { count: selectedFiles.length }) }}
          </span>
        </h3>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 text-sm text-red-500 hover:text-red-600 transition-colors touch-manipulation"
          @click="clearFiles"
        >
          <X class="w-3.5 h-3.5" />
          {{ t('transactionImport.clearAll') }}
        </button>
      </div>

      <table class="w-full">
        <thead class="bg-gray-50/50 dark:bg-white/[0.02]">
          <tr>
            <th class="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('transactionImport.fileName') }}</th>
            <th class="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-24">{{ t('transactionImport.format') }}</th>
            <th class="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-24">{{ t('transactionImport.size') }}</th>
            <th class="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-24">{{ t('transactionImport.rowCountHeader') }}</th>
            <th class="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-28">{{ t('transactionImport.statusHeader') }}</th>
            <th class="px-5 py-3 w-12"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 dark:divide-white/10">
          <tr v-for="(file, index) in selectedFiles" :key="index" class="hover:bg-gray-50/50 dark:hover:bg-white/[0.03] transition-colors">
            <td class="px-5 py-3.5">
              <div class="flex items-center gap-3">
                <div
                  class="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
                  :class="file.isValid
                    ? 'bg-green-500/10 text-green-500'
                    : file.isProcessing
                      ? 'bg-primary-main/10 text-primary-main'
                      : 'bg-red-500/10 text-red-500'"
                >
                  <Loader2 v-if="file.isProcessing" class="h-4 w-4 animate-spin" />
                  <FileSpreadsheet v-else class="h-4 w-4" />
                </div>
                <span class="text-sm font-medium text-gray-900 dark:text-white truncate max-w-xs">{{ file.name }}</span>
              </div>
            </td>
            <td class="px-5 py-3.5">
              <span class="px-2.5 py-1 bg-gray-100 dark:bg-white/10 text-xs font-medium rounded-lg text-gray-600 dark:text-gray-300">
                {{ getFileType(file.name) }}
              </span>
            </td>
            <td class="px-5 py-3.5 text-sm text-gray-600 dark:text-gray-400 font-mono">{{ formatFileSize(file.size) }}</td>
            <td class="px-5 py-3.5 text-sm">
              <span v-if="file.rowCount" class="text-green-500 font-medium font-mono">{{ file.rowCount.toLocaleString() }}</span>
              <span v-else-if="file.isProcessing" class="text-gray-400">-</span>
              <span v-else class="text-red-500">-</span>
            </td>
            <td class="px-5 py-3.5">
              <span
                v-if="file.isProcessing"
                class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary-main/10 text-primary-main text-xs font-medium rounded-lg"
              >
                <Loader2 class="h-3 w-3 animate-spin" />
                {{ t('transactionImport.processing') }}
              </span>
              <span
                v-else-if="file.isValid"
                class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 text-green-500 text-xs font-medium rounded-lg"
              >
                <CheckCircle class="h-3 w-3" />
                {{ t('transactionImport.valid') }}
              </span>
              <span
                v-else
                class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 text-red-500 text-xs font-medium rounded-lg"
                :title="file.error"
              >
                <AlertCircle class="h-3 w-3" />
                {{ t('transactionImport.invalid') }}
              </span>
            </td>
            <td class="px-5 py-3.5">
              <button
                type="button"
                class="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-500/10 transition-all touch-manipulation"
                @click="removeFile(index)"
              >
                <X class="h-4 w-4" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Error Details -->
      <div v-if="selectedFiles.some(f => f.error)" class="px-5 py-3.5 bg-red-500/5 border-t border-red-500/10">
        <p class="text-sm text-red-500">
          <strong>{{ t('transactionImport.errorDetails') }}</strong>
          {{ selectedFiles.find(f => f.error)?.error }}
        </p>
      </div>
    </div>

    <!-- Continue Button - Gradient -->
    <div class="flex justify-end">
      <button
        type="button"
        class="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium transition-all duration-300 touch-manipulation"
        :class="canContinue
          ? 'bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white shadow-lg shadow-primary-main/25 hover:shadow-xl hover:shadow-primary-main/30 hover:-translate-y-0.5'
          : 'bg-gray-200 dark:bg-white/5 text-gray-400 cursor-not-allowed'"
        :disabled="!canContinue"
        @click="continueToMapping"
      >
        {{ t('transactionImport.continueToMapping') }}
        <ArrowRight class="h-4 w-4" />
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

const sources = computed(() => [
  { id: 'credit_card', label: t('transactionImport.creditCard'), desc: t('transactionImport.creditCardDesc'), icon: CreditCard },
  { id: 'payment_gateway', label: t('transactionImport.paymentGatewayLabel'), desc: t('transactionImport.paymentGatewayDesc2'), icon: Wallet },
  { id: 'overseas', label: t('transactionImport.overseasLabel'), desc: t('transactionImport.overseasDesc2'), icon: Globe }
])

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
      error.value = t('transactionImport.invalidFormat', { name: file.name })
      continue
    }

    if (file.size > 10 * 1024 * 1024) {
      error.value = t('transactionImport.sizeExceeded', { name: file.name })
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
          const errorMsg = res.error || res.statusMessage || (res.data?.length === 0 ? t('transactionImport.emptyData') : t('transactionImport.processFailed'))
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
        const errorMsg = err.data?.statusMessage || err.data?.message || err.message || t('transactionImport.uploadFailed')
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
