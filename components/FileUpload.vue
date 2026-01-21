<template>
  <div>
    <div
        class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center"
        :class="{ 'border-purple-400 bg-purple-50': isDragging }"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="handleFileDrop"
    >
      <div v-if="isLoading">
        <div class="animate-spin rounded-full h-10 w-10 border-4 border-purple-500 border-t-transparent mx-auto mb-3"></div>
        <p class="text-gray-600">Processing file...</p>
      </div>
      <div v-else>
        <div class="text-gray-400 mb-3">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <p class="text-base mb-2">Drag and drop your file here</p>
        <p class="text-sm text-gray-500 mb-4">or</p>
        <button
            class="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 focus:outline-none"
            @click="$refs.fileInput.click()"
        >
          Browse files
        </button>
        <input
            ref="fileInput"
            type="file"
            accept=".xlsx,.xls,.csv"
            class="hidden"
            @change="handleFileSelect"
        />
        <p class="mt-3 text-xs text-gray-500">
          Supported formats: XLSX, XLS, CSV
        </p>
      </div>
    </div>

    <!-- Results section -->
    <div v-if="result" class="mt-6 p-4 border rounded-md bg-green-50 border-green-100">
      <h3 class="font-medium text-green-800 mb-2">File processed successfully!</h3>
      <div class="text-sm text-gray-700">
        <p><strong>Original filename:</strong> {{ result.originalName }}</p>
        <p><strong>Saved at:</strong> {{ result.savedPath }}</p>
        <p><strong>Processed at:</strong> {{ result.processedPath }}</p>
      </div>

      <!-- Show sample of processed data -->
      <div v-if="result.data" class="mt-4">
        <h4 class="font-medium text-gray-800 mb-2">Sample data:</h4>
        <div class="bg-white p-3 rounded border overflow-auto max-h-60">
          <pre class="text-xs">{{ JSON.stringify(getSampleData(result.data), null, 2) }}</pre>
        </div>
      </div>
    </div>

    <!-- Error message -->
    <div v-if="error" class="mt-6 p-4 border rounded-md bg-red-50 border-red-100">
      <h3 class="font-medium text-red-800 mb-2">Error processing file</h3>
      <p class="text-sm text-red-700">{{ error }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const isDragging = ref(false);
const isLoading = ref(false);
const result = ref(null);
const error = ref(null);
const fileInput = ref(null);

const props = defineProps({
  uploadUrl: {
    type: String,
    default: '/api/excel-processor'
  }
});

const emit = defineEmits(['file-processed']);

// Handle file selected from input
const handleFileSelect = (event) => {
  const files = event.target.files;
  if (files.length > 0) {
    processFile(files[0]);
  }
};

// Handle file dropped on the component
const handleFileDrop = (event) => {
  isDragging.value = false;
  const files = event.dataTransfer.files;
  if (files.length > 0) {
    processFile(files[0]);
  }
};

// Process and upload the file
const processFile = async (file) => {
  try {
    isLoading.value = true;
    error.value = null;
    result.value = null;

    // Create FormData
    const formData = new FormData();
    formData.append('file', file);

    // Upload to server
    const response = await fetch(props.uploadUrl, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.statusMessage || 'Error processing file');
    }

    // Handle success
    const data = await response.json();
    result.value = data;
    emit('file-processed', data);
  } catch (err) {
    console.error('File processing error:', err);
    error.value = err.message || 'Failed to process file';
  } finally {
    isLoading.value = false;
  }
};

// Get a sample of the processed data for display
const getSampleData = (data) => {
  if (!data) return {};

  // If it's an object with sheet names (Excel file)
  if (typeof data === 'object' && !Array.isArray(data)) {
    const result = {};
    // For each sheet, get up to 5 rows
    Object.keys(data).forEach(sheetName => {
      const sheet = data[sheetName];
      result[sheetName] = Array.isArray(sheet) ? sheet.slice(0, 5) : sheet;
    });
    return result;
  }

  // If it's an array (CSV file)
  if (Array.isArray(data)) {
    return data.slice(0, 5);
  }

  return data;
};
</script>