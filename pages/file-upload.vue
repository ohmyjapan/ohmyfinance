<template>
  <div class="max-w-4xl mx-auto p-6">
    <h1 class="text-2xl font-bold mb-6">File Upload Test</h1>

    <div class="bg-white shadow-md rounded-lg p-6">
      <h2 class="text-xl font-semibold mb-4">Upload Excel or CSV File</h2>
      <p class="text-gray-600 mb-6">
        This page demonstrates file uploading and processing that avoids ESM loading issues on Windows.
        The backend uses a child process with CommonJS to process Excel files safely.
      </p>

      <FileUpload @file-processed="handleFileProcessed" />
    </div>

    <div v-if="fileData" class="mt-8 bg-white shadow-md rounded-lg p-6">
      <h2 class="text-xl font-semibold mb-4">Processed Data</h2>

      <div class="mb-4">
        <h3 class="font-medium text-gray-700 mb-2">File Information</h3>
        <ul class="list-disc pl-5 text-gray-600">
          <li><strong>Original Filename:</strong> {{ fileData.originalName }}</li>
          <li><strong>Saved Path:</strong> {{ fileData.savedPath }}</li>
          <li><strong>Processed Path:</strong> {{ fileData.processedPath }}</li>
        </ul>
      </div>

      <div v-if="fileData.data">
        <h3 class="font-medium text-gray-700 mb-2">Data Preview</h3>
        <div class="border rounded-md overflow-auto max-h-96">
          <div v-if="isExcelFile(fileData.originalName)">
            <!-- Excel file with multiple sheets -->
            <div v-for="(sheet, sheetName) in fileData.data" :key="sheetName" class="mb-4">
              <h4 class="bg-gray-100 p-2 font-medium">Sheet: {{ sheetName }}</h4>
              <div class="p-4">
                <table class="min-w-full divide-y divide-gray-200">
                  <thead class="bg-gray-50">
                  <tr>
                    <th v-for="(header, index) in getHeaders(sheet)" :key="index" class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {{ header }}
                    </th>
                  </tr>
                  </thead>
                  <tbody class="bg-white divide-y divide-gray-200">
                  <tr v-for="(row, rowIndex) in getPreviewRows(sheet)" :key="rowIndex">
                    <td v-for="(header, headerIndex) in getHeaders(sheet)" :key="headerIndex" class="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                      {{ getCellValue(row, header, headerIndex) }}
                    </td>
                  </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div v-else>
            <!-- CSV file -->
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
              <tr>
                <th v-for="(header, index) in Object.keys(fileData.data[0] || {})" :key="index" class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {{ header }}
                </th>
              </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
              <tr v-for="(row, rowIndex) in fileData.data.slice(0, 5)" :key="rowIndex">
                <td v-for="(header, headerIndex) in Object.keys(fileData.data[0] || {})" :key="headerIndex" class="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                  {{ row[header] }}
                </td>
              </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const fileData = ref(null);

const handleFileProcessed = (data) => {
  fileData.value = data;
};

// Helper functions for displaying the data
const isExcelFile = (filename) => {
  const ext = filename.split('.').pop().toLowerCase();
  return ext === 'xlsx' || ext === 'xls';
};

const getHeaders = (sheet) => {
  if (!sheet || !Array.isArray(sheet) || sheet.length === 0) return [];

  // If the first row is an array, use it as headers
  if (Array.isArray(sheet[0])) {
    return sheet[0];
  }

  // If the first row is an object, use its keys
  if (typeof sheet[0] === 'object') {
    return Object.keys(sheet[0]);
  }

  return [];
};

const getPreviewRows = (sheet) => {
  if (!sheet || !Array.isArray(sheet)) return [];

  // Skip the header row if it exists
  return sheet.slice(1, 6);
};

const getCellValue = (row, header, headerIndex) => {
  // If row is an array, use the index
  if (Array.isArray(row)) {
    return row[headerIndex];
  }

  // If row is an object, use the header as key
  if (typeof row === 'object') {
    return row[header];
  }

  return '';
};
</script>