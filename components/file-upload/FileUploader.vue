<template>
  <div>
    <div
        class="border-2 border-dashed rounded-lg p-8"
        :class="isDragging
        ? 'border-purple-400 bg-purple-50'
        : 'border-gray-300'"
        @dragenter.prevent="isDragging = true"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="handleFileDrop"
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

    <!-- Progress indicator (shown during upload) -->
    <div v-if="isUploading" class="w-full mt-4">
      <div class="bg-gray-200 rounded-full h-2.5 mb-2">
        <div
            class="bg-purple-600 h-2.5 rounded-full"
            :style="{ width: `${uploadProgress}%` }"
        ></div>
      </div>
      <p class="text-xs text-gray-500">Uploading: {{ uploadProgress }}%</p>
    </div>

    <!-- Error message -->
    <p v-if="error" class="mt-2 text-sm text-red-600">
      {{ error }}
    </p>

    <!-- Selected Files List -->
    <div v-if="selectedFiles.length > 0" class="mt-4">
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useFileUpload } from '~/composables/useFileUpload'
import {
  Upload,
  FileText,
  CheckCircle,
  AlertCircle,
  X
} from 'lucide-vue-next'

const emit = defineEmits(['files-selected'])

// Use the file upload composable
const {
  selectedFiles,
  uploadProgress,
  isUploading,
  isDragging,
  error,
  validateFiles,
  formatFileSize,
  getFileType
} = useFileUpload()

// References
const fileInput = ref(null)

// Computed properties
const canUpload = computed(() => {
  return selectedFiles.value.length > 0 &&
      selectedFiles.value.every(file => file.isValid)
})

// Handle file input change
const handleFileInput = (event) => {
  const files = event.target.files

  if (files && files.length > 0) {
    processFiles(Array.from(files))
  }

  // Reset the input so the same file can be uploaded again if needed
  event.target.value = null
}

// Handle file drop
const handleFileDrop = (event) => {
  isDragging.value = false

  const files = event.dataTransfer.files

  if (files && files.length > 0) {
    processFiles(Array.from(files))
  }
}

// Process and validate files
const processFiles = (files) => {
  error.value = ''

  // Validate files (file types and size)
  if (!validateFiles(files, ['csv', 'excel'])) {
    return
  }

  // Add metadata to files
  const processedFiles = files.map(file => ({
    ...file,
    isValid: true,
    rowCount: estimateRowCount(file) // This would be more sophisticated in a real app
  }))

  // Add to selectedFiles
  selectedFiles.value = [...selectedFiles.value, ...processedFiles]

  // Emit the files selected event
  emit('files-selected', selectedFiles.value)
}

// Remove a file from the selection
const removeFile = (index) => {
  selectedFiles.value.splice(index, 1)

  // Emit updated files list
  emit('files-selected', selectedFiles.value)
}

// Clear all selected files
const clearFiles = () => {
  selectedFiles.value = []

  // Emit empty files list
  emit('files-selected', selectedFiles.value)
}

// Estimate row count based on file size (very rough estimate for demo purposes)
const estimateRowCount = (file) => {
  // In a real app, you would parse the file and count actual rows
  // For now, we'll just make a very rough estimate based on file size
  const sizeInKB = file.size / 1024

  // Assume roughly 100 bytes per row (this varies widely in reality)
  return Math.floor(sizeInKB * 10)
}
</script>