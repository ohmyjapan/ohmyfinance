// components/FileUploader.vue
<template>
  <div>
    <h2 class="text-lg font-semibold mb-4">Upload Excel File</h2>

    <div
        class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="handleFileDrop"
        :class="{ 'border-purple-400 bg-purple-50': isDragging }"
    >
      <div v-if="isUploading">
        <p>Uploading... {{ uploadProgress }}%</p>
        <div class="w-full bg-gray-200 rounded-full h-2.5 mt-2">
          <div
              class="bg-purple-600 h-2.5 rounded-full"
              :style="{ width: `${uploadProgress}%` }"
          ></div>
        </div>
      </div>
      <div v-else>
        <p class="mb-2">Drag and drop Excel files here</p>
        <p class="text-sm text-gray-500 mb-4">or</p>
        <button
            @click="$refs.fileInput.click()"
            class="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
        >
          Select File
        </button>
        <input
            type="file"
            ref="fileInput"
            class="hidden"
            accept=".xls,.xlsx"
            @change="handleFileInput"
        />
      </div>
    </div>

    <div v-if="result" class="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
      <h3 class="font-semibold text-green-700 mb-2">File Processed Successfully</h3>
      <p class="text-sm mb-1"><strong>Original name:</strong> {{ result.originalName }}</p>
      <p class="text-sm mb-1"><strong>Saved as:</strong> {{ result.savedAs }}</p>
      <p class="text-sm"><strong>Processed path:</strong> {{ result.processedPath }}</p>
    </div>

    <div v-if="error" class="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
      <h3 class="font-semibold text-red-700 mb-2">Error</h3>
      <p class="text-sm">{{ error }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const isDragging = ref(false);
const isUploading = ref(false);
const uploadProgress = ref(0);
const result = ref(null);
const error = ref(null);
const fileInput = ref(null);

const handleFileInput = (event) => {
  const files = event.target.files;
  if (files.length > 0) {
    uploadFile(files[0]);
  }
};

const handleFileDrop = (event) => {
  isDragging.value = false;
  const files = event.dataTransfer.files;
  if (files.length > 0) {
    uploadFile(files[0]);
  }
};

const uploadFile = async (file) => {
  try {
    error.value = null;
    result.value = null;
    isUploading.value = true;

    // Create form data
    const formData = new FormData();
    formData.append('file', file);

    // Simulate progress
    const progressInterval = setInterval(() => {
      if (uploadProgress.value < 90) {
        uploadProgress.value += 10;
      }
    }, 300);

    // Upload the file
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    clearInterval(progressInterval);
    uploadProgress.value = 100;

    const data = await response.json();

    if (data.success) {
      result.value = data;
    } else {
      error.value = data.error || 'Upload failed';
    }
  } catch (e) {
    error.value = e.message || 'An unexpected error occurred';
  } finally {
    setTimeout(() => {
      isUploading.value = false;
      uploadProgress.value = 0;
    }, 500);
  }
};
</script>