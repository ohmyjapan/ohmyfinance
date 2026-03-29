<template>
  <div class="space-y-6">
    <!-- Page Header -->
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('receiptUpload.title') }}</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('receiptUpload.description') }}</p>
      </div>
      <NuxtLink
        to="/receipts"
        class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl hover:bg-gray-50 dark:hover:bg-white/[0.07] transition-all"
      >
        <FileText class="w-4 h-4" />
        {{ t('receiptUpload.viewAll') }}
      </NuxtLink>
    </header>

    <!-- Stats Row -->
    <div class="grid grid-cols-3 gap-4">
      <div class="relative overflow-hidden rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl bg-primary-main/10 dark:bg-primary-main/20 flex items-center justify-center flex-shrink-0">
            <FileText class="w-6 h-6 text-primary-main" />
          </div>
          <div>
            <p class="text-3xl font-bold font-mono text-gray-900 dark:text-white">{{ receiptStats.total }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('receiptUpload.totalReceipts') }}</p>
          </div>
        </div>
      </div>
      <div class="relative overflow-hidden rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl bg-green-500/10 dark:bg-green-500/20 flex items-center justify-center flex-shrink-0">
            <CheckCircle class="w-6 h-6 text-green-500" />
          </div>
          <div>
            <p class="text-3xl font-bold font-mono text-gray-900 dark:text-white">{{ receiptStats.matched }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('receiptUpload.matched') }}</p>
          </div>
        </div>
      </div>
      <div class="relative overflow-hidden rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 flex items-center justify-center flex-shrink-0">
            <AlertTriangle class="w-6 h-6 text-amber-500" />
          </div>
          <div>
            <p class="text-3xl font-bold font-mono text-gray-900 dark:text-white">{{ receiptStats.unmatched }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('receiptUpload.unmatched') }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Upload Zone — Hero -->
    <div class="relative">
      <!-- Decorative glow -->
      <div class="absolute -inset-1 bg-gradient-to-r from-primary-main via-primary-dark to-primary-main rounded-3xl blur-lg opacity-0 dark:opacity-10 transition-opacity duration-500" :class="{ 'dark:opacity-25 opacity-10': isDragging }"></div>

      <div
        class="relative rounded-2xl border-2 border-dashed bg-white dark:bg-white/5 backdrop-blur-sm transition-all duration-300 overflow-hidden"
        :class="isDragging
          ? 'border-primary-main bg-primary-main/5 dark:bg-primary-main/10 scale-[1.01]'
          : 'border-gray-300 dark:border-white/20 hover:border-primary-main/50 dark:hover:border-primary-main/30'"
        @dragenter.prevent="isDragging = true"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="handleDrop"
      >
        <!-- Upload content — no files yet -->
        <div v-if="!uploadedFiles.length && !isUploading" class="flex flex-col items-center justify-center py-16 px-6">
          <div class="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-main/20 to-primary-dark/20 dark:from-primary-main/30 dark:to-primary-dark/30 flex items-center justify-center mb-6 transition-transform duration-300" :class="{ 'scale-110': isDragging }">
            <Upload class="w-10 h-10 text-primary-main transition-transform duration-300" :class="{ '-translate-y-1': isDragging }" />
          </div>
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            {{ isDragging ? t('receiptUpload.dropHere') : t('receiptUpload.dragAndDrop') }}
          </h3>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">{{ t('receiptUpload.orClickBrowse') }}</p>

          <div class="flex flex-col sm:flex-row gap-3">
            <button
              @click="$refs.fileInput.click()"
              class="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white font-medium rounded-xl shadow-lg shadow-primary-main/25 hover:shadow-xl hover:shadow-primary-main/30 transition-all duration-300 hover:-translate-y-0.5 touch-manipulation"
            >
              <Upload class="w-4 h-4" />
              {{ t('receiptUpload.uploadButton') }}
            </button>
            <button
              @click="$refs.cameraInput.click()"
              class="inline-flex items-center gap-2 px-6 py-3 bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200 font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-white/[0.07] transition-all duration-300 hover:-translate-y-0.5 touch-manipulation"
            >
              <Camera class="w-4 h-4" />
              {{ t('receiptUpload.takePhoto') }}
            </button>
          </div>

          <input ref="fileInput" type="file" class="hidden" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" multiple @change="handleFileInput" />
          <input ref="cameraInput" type="file" class="hidden" accept="image/*" capture="environment" @change="handleFileInput" />

          <div class="flex items-center gap-3 mt-6">
            <span v-for="fmt in ['PDF', 'JPG', 'PNG', 'HEIC', 'WebP']" :key="fmt"
              class="px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400"
            >{{ fmt }}</span>
            <span class="text-xs text-gray-400 dark:text-gray-500">{{ t('receiptUpload.maxSize') }}</span>
          </div>
        </div>

        <!-- Upload progress -->
        <div v-if="isUploading" class="py-16 px-6">
          <div class="max-w-md mx-auto text-center">
            <div class="w-16 h-16 rounded-2xl bg-primary-main/10 dark:bg-primary-main/20 flex items-center justify-center mx-auto mb-6">
              <Loader2 class="w-8 h-8 text-primary-main animate-spin" />
            </div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ t('receiptUpload.uploading') }}</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">{{ uploadingFileName }}</p>
            <div class="w-full bg-gray-200 dark:bg-white/10 rounded-full h-2 overflow-hidden">
              <div class="bg-gradient-to-r from-primary-main to-primary-dark h-full rounded-full transition-all duration-300 ease-out" :style="{ width: `${uploadProgress}%` }"></div>
            </div>
            <p class="text-xs text-gray-400 dark:text-gray-500 mt-2 font-mono">{{ uploadProgress }}%</p>
          </div>
        </div>

        <!-- Uploaded files preview -->
        <div v-if="uploadedFiles.length && !isUploading" class="p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">
              {{ t('receiptUpload.filesUploaded', { count: uploadedFiles.length }) }}
            </h3>
            <button @click="addMoreFiles" class="inline-flex items-center gap-1.5 text-sm text-primary-main hover:text-primary-dark transition-colors touch-manipulation">
              <Plus class="w-4 h-4" />
              {{ t('receiptUpload.addMore') }}
            </button>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <div v-for="(file, idx) in uploadedFiles" :key="idx"
              class="group relative rounded-xl overflow-hidden border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 aspect-square flex items-center justify-center transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <!-- Image preview -->
              <img v-if="file.preview" :src="file.preview" class="w-full h-full object-cover" :alt="file.name" />
              <!-- PDF icon -->
              <div v-else class="flex flex-col items-center gap-2">
                <FileText class="w-8 h-8 text-primary-main/60" />
                <span class="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[80%]">{{ file.name }}</span>
              </div>

              <!-- Status overlay -->
              <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <div class="absolute bottom-0 left-0 right-0 p-2">
                  <p class="text-xs text-white truncate">{{ file.name }}</p>
                  <p class="text-[10px] text-white/60">{{ formatFileSize(file.size) }}</p>
                </div>
              </div>

              <!-- Remove button -->
              <button
                @click="removeFile(idx)"
                class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-red-500 touch-manipulation"
              >
                <X class="w-3.5 h-3.5" />
              </button>

              <!-- Success check -->
              <div v-if="file.uploaded" class="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center shadow-sm">
                <Check class="w-3.5 h-3.5" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Error message -->
    <div v-if="errorMessage" class="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 p-4 flex items-start gap-3">
      <AlertCircle class="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
      <div>
        <p class="text-sm font-medium text-red-800 dark:text-red-400">{{ errorMessage }}</p>
      </div>
      <button @click="errorMessage = ''" class="ml-auto text-red-400 hover:text-red-600 dark:hover:text-red-300">
        <X class="w-4 h-4" />
      </button>
    </div>

    <!-- Tips Section -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div v-for="tip in tips" :key="tip.icon"
        class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
      >
        <div class="w-10 h-10 rounded-xl bg-primary-main/10 dark:bg-primary-main/20 flex items-center justify-center mb-3">
          <component :is="tipIcons[tip.icon]" class="w-5 h-5 text-primary-main" />
        </div>
        <h4 class="text-sm font-semibold text-gray-900 dark:text-white mb-1">{{ tip.title }}</h4>
        <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{{ tip.desc }}</p>
      </div>
    </div>

    <!-- Recent Uploads Table -->
    <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm overflow-hidden">
      <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <History class="w-5 h-5 text-primary-main" />
          {{ t('receiptUpload.recentUploads') }}
        </h2>
        <div class="flex items-center gap-2">
          <div class="relative">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              v-model="searchQuery"
              type="text"
              class="block w-full sm:w-56 pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-white dark:bg-white/5 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-all"
              :placeholder="t('receiptUpload.searchReceipts')"
            />
          </div>
          <button
            @click="isFilterOpen = !isFilterOpen"
            class="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-xl transition-all touch-manipulation"
            :class="isFilterOpen
              ? 'border-primary-main text-primary-main bg-primary-main/5 dark:bg-primary-main/10'
              : 'border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.07]'"
          >
            <SlidersHorizontal class="w-4 h-4" />
            {{ t('common.filters') }}
          </button>
        </div>
      </div>

      <!-- Filters -->
      <div v-if="isFilterOpen" class="px-6 py-4 border-b border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-white/[0.02]">
        <div class="flex flex-wrap items-center gap-3">
          <select
            v-model="filters.status"
            class="text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-white dark:bg-white/5 text-gray-700 dark:text-gray-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-main/50"
          >
            <option value="">{{ t('receiptUpload.allStatuses') }}</option>
            <option value="matched">{{ t('receiptUpload.matched') }}</option>
            <option value="unmatched">{{ t('receiptUpload.unmatched') }}</option>
          </select>
          <select
            v-model="filters.dateRange"
            class="text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-white dark:bg-white/5 text-gray-700 dark:text-gray-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-main/50"
          >
            <option value="">{{ t('common.allTime') }}</option>
            <option value="today">{{ t('common.today') }}</option>
            <option value="week">{{ t('common.thisWeek') }}</option>
            <option value="month">{{ t('common.thisMonth') }}</option>
          </select>
          <button
            @click="resetFilters"
            class="text-sm text-gray-500 dark:text-gray-400 hover:text-primary-main transition-colors"
          >
            {{ t('common.resetFilters') }}
          </button>
        </div>
      </div>

      <!-- Table -->
      <ReceiptTable
        :receipts="filteredReceipts"
        @view="viewReceipt"
        @match="openMatchDialog"
        @delete="deleteReceipt"
      />

      <!-- Pagination -->
      <div v-if="filteredReceipts.length > 0" class="px-6 py-4 border-t border-gray-200 dark:border-white/10 flex items-center justify-between">
        <p class="text-sm text-gray-500 dark:text-gray-400">
          {{ t('common.showingRange', { start: paginationStart, end: paginationEnd, total: receiptStats.total }) }}
        </p>
        <div class="flex items-center gap-1">
          <button
            class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.07] disabled:opacity-30 disabled:cursor-not-allowed transition-colors touch-manipulation"
            :disabled="currentPage === 1"
            @click="currentPage--"
          >
            <ChevronLeft class="w-4 h-4" />
          </button>
          <template v-for="page in totalPages" :key="page">
            <button
              class="w-8 h-8 rounded-lg text-sm font-medium transition-all touch-manipulation"
              :class="page === currentPage
                ? 'bg-primary-main text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.07]'"
              @click="currentPage = page"
            >
              {{ page }}
            </button>
          </template>
          <button
            class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.07] disabled:opacity-30 disabled:cursor-not-allowed transition-colors touch-manipulation"
            :disabled="currentPage === totalPages"
            @click="currentPage++"
          >
            <ChevronRight class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- Receipt Matching Dialog -->
    <ReceiptMatchDialog
      v-if="showMatchDialog"
      :receipt="selectedReceipt"
      @close="showMatchDialog = false"
      @match="matchReceipt"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  Upload, FileText, Camera, CheckCircle, AlertTriangle, AlertCircle,
  Loader2, X, Plus, Check, Search, SlidersHorizontal, History,
  ChevronLeft, ChevronRight, Focus, DollarSign, Calendar, Sparkles
} from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

const { t, locale } = useI18n()
const userStore = useUserStore()

// Auth headers
const getAuthHeaders = () => userStore.authHeader

// Refs
const fileInput = ref<HTMLInputElement | null>(null)
const cameraInput = ref<HTMLInputElement | null>(null)

// State
const receipts = ref<any[]>([])
const searchQuery = ref('')
const isFilterOpen = ref(false)
const isLoading = ref(false)
const isUploading = ref(false)
const uploadProgress = ref(0)
const uploadingFileName = ref('')
const isDragging = ref(false)
const errorMessage = ref('')
const uploadedFiles = ref<Array<{ name: string; size: number; preview: string | null; uploaded: boolean; file: File }>>([])
const filters = ref({ status: '', dateRange: '' })
const currentPage = ref(1)
const itemsPerPage = ref(10)
const showMatchDialog = ref(false)
const selectedReceipt = ref(null)

// Receipt stats
const receiptStats = ref({ total: 0, matched: 0, unmatched: 0 })

// Tips
const tipIcons: Record<string, any> = { Camera, Focus, DollarSign, Calendar }
const tips = computed(() => [
  { icon: 'Camera', title: t('receiptUpload.tips.imageQuality'), desc: t('receiptUpload.tips.imageQualityDesc') },
  { icon: 'Focus', title: t('receiptUpload.tips.cropTitle'), desc: t('receiptUpload.tips.cropDesc') },
  { icon: 'DollarSign', title: t('receiptUpload.tips.totalAmount'), desc: t('receiptUpload.tips.totalAmountDesc') },
  { icon: 'Calendar', title: t('receiptUpload.tips.transactionDate'), desc: t('receiptUpload.tips.transactionDateDesc') }
])

// Format file size
const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// Handle file input
const handleFileInput = (event: Event) => {
  const input = event.target as HTMLInputElement
  if (input.files && input.files.length > 0) {
    processFiles(Array.from(input.files))
  }
  input.value = ''
}

// Handle drag & drop
const handleDrop = (event: DragEvent) => {
  isDragging.value = false
  if (event.dataTransfer?.files?.length) {
    processFiles(Array.from(event.dataTransfer.files))
  }
}

// Process & upload files
const processFiles = async (files: File[]) => {
  errorMessage.value = ''
  const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp']
  const maxSize = 10 * 1024 * 1024

  const invalid = files.filter(f => !validTypes.includes(f.type))
  if (invalid.length) {
    errorMessage.value = t('receiptUpload.invalidFileError')
    return
  }

  const oversized = files.filter(f => f.size > maxSize)
  if (oversized.length) {
    errorMessage.value = t('receiptUpload.fileTooLarge')
    return
  }

  // Upload each file
  for (const file of files) {
    isUploading.value = true
    uploadProgress.value = 0
    uploadingFileName.value = file.name

    // Create preview
    const preview = file.type.startsWith('image/')
      ? URL.createObjectURL(file)
      : null

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        if (uploadProgress.value < 90) {
          uploadProgress.value += Math.random() * 15
        }
      }, 200)

      const formData = new FormData()
      formData.append('file', file)

      const result = await $fetch<any>('/api/receipts/upload', {
        method: 'POST',
        body: formData,
        headers: getAuthHeaders()
      })

      clearInterval(progressInterval)
      uploadProgress.value = 100

      // Add to uploaded files
      uploadedFiles.value.push({
        name: file.name,
        size: file.size,
        preview,
        uploaded: true,
        file
      })

      if (result?.receipt) {
        receipts.value.unshift(result.receipt)
        receiptStats.value.total++
        receiptStats.value.unmatched++
      }

      // Brief pause to show 100%
      await new Promise(r => setTimeout(r, 300))
    } catch (error) {
      console.error('Upload failed:', error)
      errorMessage.value = t('receiptUpload.uploadError')
    }
  }

  isUploading.value = false
  uploadProgress.value = 0
}

// Remove file from preview
const removeFile = (idx: number) => {
  const file = uploadedFiles.value[idx]
  if (file.preview) URL.revokeObjectURL(file.preview)
  uploadedFiles.value.splice(idx, 1)
}

// Add more files
const addMoreFiles = () => {
  fileInput.value?.click()
}

// Load receipts from API
const loadReceipts = async () => {
  isLoading.value = true
  try {
    const response = await $fetch<any>('/api/receipts', {
      headers: getAuthHeaders()
    })
    const data = Array.isArray(response) ? response : (response?.receipts || [])
    receipts.value = data

    receiptStats.value = {
      total: receipts.value.length,
      matched: receipts.value.filter((r: any) => r.status === 'matched' || r.transactionId).length,
      unmatched: receipts.value.filter((r: any) => r.status !== 'matched' && !r.transactionId).length
    }
  } catch (error) {
    console.error('Failed to load receipts:', error)
    receipts.value = []
  } finally {
    isLoading.value = false
  }
}

onMounted(() => loadReceipts())

// Filtered receipts
const filteredReceipts = computed(() => {
  let result = [...receipts.value]

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(r =>
      r.filename?.toLowerCase().includes(query) ||
      r.merchant?.toLowerCase().includes(query) ||
      r.amount?.toString().includes(query)
    )
  }

  if (filters.value.status) {
    result = result.filter(r => r.status === filters.value.status)
  }

  if (filters.value.dateRange) {
    const now = new Date()
    let cutoff = new Date()
    if (filters.value.dateRange === 'today') cutoff.setHours(0, 0, 0, 0)
    else if (filters.value.dateRange === 'week') cutoff.setDate(now.getDate() - 7)
    else if (filters.value.dateRange === 'month') cutoff.setMonth(now.getMonth() - 1)
    result = result.filter(r => new Date(r.uploadDate) >= cutoff)
  }

  return result
})

// Pagination
const paginationStart = computed(() => (currentPage.value - 1) * itemsPerPage.value + 1)
const paginationEnd = computed(() => Math.min(currentPage.value * itemsPerPage.value, filteredReceipts.value.length))
const totalPages = computed(() => Math.ceil(filteredReceipts.value.length / itemsPerPage.value) || 1)

const resetFilters = () => {
  filters.value = { status: '', dateRange: '' }
  searchQuery.value = ''
}

// Receipt actions
const viewReceipt = (id: string) => navigateTo(`/receipts/${id}`)

const openMatchDialog = (id: string) => {
  const receipt = receipts.value.find(r => r.id === id)
  if (receipt) {
    selectedReceipt.value = receipt
    showMatchDialog.value = true
  }
}

const matchReceipt = async (receiptId: string, transactionId: string) => {
  try {
    await $fetch(`/api/receipts/${receiptId}/match`, {
      method: 'POST',
      body: { transactionId },
      headers: getAuthHeaders()
    })

    const receipt = receipts.value.find(r => r.id === receiptId || r._id === receiptId)
    if (receipt) {
      receipt.status = 'matched'
      receipt.transactionId = transactionId
      receiptStats.value.matched++
      receiptStats.value.unmatched--
    }
  } catch (error) {
    console.error('Failed to match receipt:', error)
  }
  showMatchDialog.value = false
}

const deleteReceipt = async (receiptId: string) => {
  if (!confirm(t('receiptUpload.confirmDelete'))) return

  try {
    await $fetch(`/api/receipts/${receiptId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    })

    const idx = receipts.value.findIndex(r => r.id === receiptId || r._id === receiptId)
    if (idx !== -1) {
      const receipt = receipts.value[idx]
      receiptStats.value.total--
      if (receipt.status === 'matched' || receipt.transactionId) {
        receiptStats.value.matched--
      } else {
        receiptStats.value.unmatched--
      }
      receipts.value.splice(idx, 1)
    }
  } catch (error) {
    console.error('Failed to delete receipt:', error)
  }
}
</script>
