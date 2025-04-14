<template>
  <div class="bg-white rounded-lg shadow-sm p-6">
    <div class="max-w-3xl mx-auto">
      <div class="text-center mb-8">
        <Database class="h-12 w-12 text-purple-500 mx-auto mb-4" />
        <h2 class="text-xl font-semibold text-gray-900 mb-2">Import Transaction Data</h2>
        <p class="text-gray-600">
          Upload CSV or Excel files containing transaction data from various sources.
          Our system will help you map and import the data into your transaction database.
        </p>
      </div>

      <!-- File Type Selection -->
      <div class="mb-8">
        <h3 class="text-sm font-medium text-gray-700 mb-3">Select Import Source</h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
              class="border rounded-lg p-4 flex flex-col items-center text-center cursor-pointer"
              :class="selectedSource === 'credit_card'
              ? 'border-purple-200 bg-purple-50'
              : 'border-gray-200 hover:bg-gray-50'"
              @click="$emit('source-selected', 'credit_card')"
          >
            <div class="w-10 h-10 rounded-full flex items-center justify-center mb-3"
                 :class="selectedSource === 'credit_card' ? 'bg-purple-100' : 'bg-gray-100'"
            >
              <CreditCard
                  class="h-5 w-5"
                  :class="selectedSource === 'credit_card' ? 'text-purple-600' : 'text-gray-600'"
              />
            </div>
            <h4 class="text-sm font-medium text-gray-900 mb-1">Credit Card Files</h4>
            <p class="text-xs text-gray-500">Import transaction data from credit card companies</p>
          </div>

          <div
              class="border rounded-lg p-4 flex flex-col items-center text-center cursor-pointer"
              :class="selectedSource === 'payment_gateway'
              ? 'border-purple-200 bg-purple-50'
              : 'border-gray-200 hover:bg-gray-50'"
              @click="$emit('source-selected', 'payment_gateway')"
          >
            <div class="w-10 h-10 rounded-full flex items-center justify-center mb-3"
                 :class="selectedSource === 'payment_gateway' ? 'bg-purple-100' : 'bg-gray-100'"
            >
              <CreditCard
                  class="h-5 w-5"
                  :class="selectedSource === 'payment_gateway' ? 'text-purple-600' : 'text-gray-600'"
              />
            </div>
            <h4 class="text-sm font-medium text-gray-900 mb-1">Payment Gateway</h4>
            <p class="text-xs text-gray-500">Import from payment gateway systems</p>
          </div>

          <div
              class="border rounded-lg p-4 flex flex-col items-center text-center cursor-pointer"
              :class="selectedSource === 'overseas'
              ? 'border-purple-200 bg-purple-50'
              : 'border-gray-200 hover:bg-gray-50'"
              @click="$emit('source-selected', 'overseas')"
          >
            <div class="w-10 h-10 rounded-full flex items-center justify-center mb-3"
                 :class="selectedSource === 'overseas' ? 'bg-purple-100' : 'bg-gray-100'"
            >
              <Globe
                  class="h-5 w-5"
                  :class="selectedSource === 'overseas' ? 'text-purple-600' : 'text-gray-600'"
              />
            </div>
            <h4 class="text-sm font-medium text-gray-900 mb-1">Overseas Transactions</h4>
            <p class="text-xs text-gray-500">Import orders and transactions from overseas markets</p>
          </div>
        </div>
      </div>

      <!-- File Upload Area -->
      <div class="mb-8">
        <h3 class="text-sm font-medium text-gray-700 mb-3">Upload Files</h3>
        <div
            class="border-2 border-dashed rounded-lg p-8"
            :class="isDragging
            ? 'border-purple-400 bg-purple-50'
            : 'border-gray-300'"
            @dragenter.prevent="isDragging = true"
            @dragover.prevent="isDragging = true"
            @dragleave.prevent="isDragging = false"
            @drop.prevent="handleDrop"
        >
          <div class="flex flex-col items-center justify-center text-center">
            <Upload :class="isDragging ? 'text-purple-400' : 'text-gray-400'" class="h-10 w-10 mb-3" />
            <h4 class="text-sm font-medium text-gray-900 mb-1">
              {{ isDragging ? 'Drop files here' : 'Drag and drop files here' }}
            </h4>
            <p class="text-xs text-gray-500 mb-4">Support for CSV, XLS, XLSX files (Max. 10MB each)</p>
            <input
                type="file"
                ref="fileInput"
                class="hidden"
                accept=".csv,.xls,.xlsx"
                multiple
                @change="handleFileInput"
            />
            <button
                class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                @click="$refs.fileInput.click()"
            >
              <Upload class="mr-2 h-4 w-4" />
              Browse Files
            </button>
          </div>
        </div>

        <!-- Error message -->
        <p v-if="error" class="mt-2 text-sm text-red-600">
          {{ error }}
        </p>
      </div>

      <!-- Selected Files List -->
      <div v-if="selectedFiles.length > 0">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-medium text-gray-700">Selected Files</h3>
          <button
              class="text-sm text-purple-600 hover:text-purple-800"
              @click="clearFiles"
          >
            Clear All
          </button>
        </div>
        <div class="border border-gray-200 rounded-lg divide-y divide-gray-200">
          <div
              v-for="(file, index) in selectedFiles"
              :key="index"
              class="p-4"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center">
                <div class="h-10 w-10 flex-shrink-0 bg-purple-100 rounded-lg flex items-center justify-center">
                  <FileText class="h-5 w-5 text-purple-600" />
                </div>
                <div class="ml-3">
                  <p class="text-sm font-medium text-gray-900">{{ file.name }}</p>
                  <p class="text-xs text-gray-500">
                    {{ getFileType(file.name) }} • {{ formatFileSize(file.size) }}
                    • {{ file.rowCount ? `${file.rowCount} rows` : 'Processing...' }}
                  </p>
                </div>
              </div>
              <div class="flex items-center">
                <span
                    class="px-2.5 py-0.5 text-xs font-medium rounded-full flex items-center"
                    :class="file.isValid
                    ? 'bg-green-100 text-green-800'
                    : 'bg-red-100 text-red-800'"
                >
                  <component
                      :is="file.isValid ? CheckCircle : AlertCircle"
                      class="mr-1 h-3 w-3"
                  />
                  {{ file.isValid ? 'Valid' : 'Invalid' }}
                </span>
                <button
                    class="ml-2 text-gray-400 hover:text-gray-500"
                    @click="removeFile(index)"
                >
                  <X class="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="mt-8 flex justify-end">
        <button
            class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            :disabled="!canContinue"
            @click="continueToMapping"
        >
          Continue to Field Mapping
          <ArrowRight class="ml-2 h-4 w-4" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  Database,
  Upload,
  FileText,
  CreditCard,
  Globe,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  X
} from 'lucide-vue-next'

const props = defineProps({
  selectedSource: {
    type: String,
    default: 'credit_card'
  }
})

const emit = defineEmits(['source-selected', 'files-selected', 'continue'])

// State
const isDragging = ref(false)
const selectedFiles = ref([])
const error = ref('')
const fileInput = ref(null)

// Check if we can continue to next step
const canContinue = computed(() => {
  return selectedFiles.value.length > 0 &&
      selectedFiles.value.every(file => file.isValid)
})

// Handle file input change
const handleFileInput = (event) => {
  const files = event.target.files

  if (files && files.length > 0) {
    validateAndProcessFiles(Array.from(files))
  }

  // Reset the input so the same file can be uploaded again if needed
  event.target.value = null
}

// Handle drop event
const handleDrop = (event) => {
  isDragging.value = false

  const files = event.dataTransfer.files

  if (files && files.length > 0) {
    validateAndProcessFiles(Array.from(files))
  }
}

// Validate and process files
const validateAndProcessFiles = (files) => {
  error.value = ''

  // Check file types
  const validTypes = [
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]

  const validExtensions = ['.csv', '.xls', '.xlsx']

  const invalidFiles = files.filter(file => {
    const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
    return !validTypes.includes(file.type) && !validExtensions.includes(extension)
  })

  if (invalidFiles.length > 0) {
    error.value = 'Some files have invalid formats. Please upload only CSV or Excel files.'
    return
  }

  // Check file sizes (10MB limit)
  const maxSize = 10 * 1024 * 1024 // 10MB in bytes
  const oversizedFiles = files.filter(file => file.size > maxSize)

  if (oversizedFiles.length > 0) {
    error.value = 'Some files exceed the 10MB size limit.'
    return
  }

  // Add files to selected files list with mock validation
  const processedFiles = files.map(file => ({
    ...file,
    isValid: true,
    rowCount: Math.floor(Math.random() * 3000) + 500 // Mock row count
  }))

  // Add to selectedFiles
  selectedFiles.value = [...selectedFiles.value, ...processedFiles]
}

// Remove a file from the selection
const removeFile = (index) => {
  selectedFiles.value.splice(index, 1)
}

// Clear all selected files
const clearFiles = () => {
  selectedFiles.value = []
}

// Get file type from filename
const getFileType = (filename) => {
  const extension = filename.substring(filename.lastIndexOf('.')).toLowerCase()

  if (extension === '.csv') {
    return 'CSV'
  } else if (extension === '.xls') {
    return 'Excel (XLS)'
  } else if (extension === '.xlsx') {
    return 'Excel (XLSX)'
  } else {
    return 'Unknown'
  }
}

// Format file size
const formatFileSize = (bytes) => {
  if (bytes < 1024) {
    return bytes + ' B'
  } else if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + ' KB'
  } else {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }
}

// Continue to field mapping
const continueToMapping = () => {
  emit('files-selected', selectedFiles.value)
  emit('continue')
}
</script>