<template>
  <div
      class="border-2 border-dashed border-gray-300 rounded-lg p-6 flex flex-col items-center justify-center text-center h-full"
      :class="{ 'border-purple-400 bg-purple-50': isDragging }"
      @dragenter.prevent="isDragging = true"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="handleDrop"
  >
    <FileText size="48" :class="isDragging ? 'text-purple-400' : 'text-gray-400'" class="mb-4" />
    <h3 class="text-lg font-medium text-gray-900 mb-2">
      {{ isDragging ? 'Drop receipts here' : 'Drag and drop receipts here' }}
    </h3>
    <p class="text-sm text-gray-500 mb-4">or click to browse from your device</p>
    <button
        @click="$refs.fileInput.click()"
        class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
    >
      <Upload size="16" class="mr-2" />
      Upload Receipt
    </button>
    <input
        ref="fileInput"
        type="file"
        class="hidden"
        accept=".pdf,.jpg,.jpeg,.png"
        multiple
        @change="handleFileInput"
    />
    <p class="text-xs text-gray-500 mt-4">Supported formats: PDF, JPG, PNG (max 10MB)</p>

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
    <p v-if="errorMessage" class="text-sm text-red-600 mt-4">
      {{ errorMessage }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { FileText, Upload } from 'lucide-vue-next'

const emit = defineEmits(['files-selected'])

const isDragging = ref(false)
const isUploading = ref(false)
const uploadProgress = ref(0)
const errorMessage = ref('')

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
  errorMessage.value = ''

  // Check file types
  const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg']
  const invalidFiles = files.filter(file => !validTypes.includes(file.type))

  if (invalidFiles.length > 0) {
    errorMessage.value = 'Some files have invalid formats. Please upload only PDF, JPG, or PNG files.'
    return
  }

  // Check file sizes (10MB limit)
  const maxSize = 10 * 1024 * 1024 // 10MB in bytes
  const oversizedFiles = files.filter(file => file.size > maxSize)

  if (oversizedFiles.length > 0) {
    errorMessage.value = 'Some files exceed the 10MB size limit.'
    return
  }

  // Simulate upload process
  uploadFiles(files)
}

// Upload files (simulated)
const uploadFiles = (files) => {
  isUploading.value = true
  uploadProgress.value = 0

  // In a real app, you'd upload files to your server here
  // For now, let's simulate an upload with a progress timer

  const totalSteps = 10
  let currentStep = 0

  const uploadInterval = setInterval(() => {
    currentStep++
    uploadProgress.value = Math.floor((currentStep / totalSteps) * 100)

    if (currentStep >= totalSteps) {
      clearInterval(uploadInterval)
      isUploading.value = false

      // Emit event with uploaded files
      emit('files-selected', files)
    }
  }, 200)
}
</script>