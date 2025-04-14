<template>
  <div class="bg-white rounded-lg shadow-sm">
    <div class="p-6">
      <div class="mb-8 text-center">
        <h2 class="text-lg font-medium text-gray-900 mb-2">Ready to Import Data</h2>
        <p class="text-sm text-gray-600 max-w-3xl mx-auto">
          You're about to import {{ stats.totalRecords }} transaction records into your system.
          The system will process these records and match them with existing data where possible.
        </p>
      </div>

      <!-- Import Summary -->
      <div class="max-w-3xl mx-auto mb-8">
        <div class="bg-gray-50 rounded-lg border border-gray-200 p-6">
          <h3 class="text-base font-medium text-gray-900 mb-4">Import Summary</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 class="text-sm font-medium text-gray-500 mb-3">Files to Import</h4>
              <div class="space-y-3">
                <div
                    v-for="(file, index) in files"
                    :key="index"
                    class="flex items-center"
                >
                  <div class="h-8 w-8 flex-shrink-0 bg-purple-100 rounded flex items-center justify-center">
                    <FileText class="h-4 w-4 text-purple-600" />
                  </div>
                  <div class="ml-3">
                    <p class="text-sm font-medium text-gray-900">{{ file.name }}</p>
                    <p class="text-xs text-gray-500">{{ file.rowCount || 0 }} records</p>
                  </div>
                </div>
              </div>
            </div>
            <div>
              <h4 class="text-sm font-medium text-gray-500 mb-3">Import Settings</h4>
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-sm text-gray-600">Source Type:</span>
                  <span class="text-sm font-medium text-gray-900">{{ getSourceTypeLabel() }}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-sm text-gray-600">Records to Import:</span>
                  <span class="text-sm font-medium text-gray-900">
                    {{ stats.validRecords + stats.warningRecords }} of {{ stats.totalRecords }}
                  </span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-sm text-gray-600">Duplicates:</span>
                  <span class="text-sm font-medium text-gray-900">
                    {{ localOptions.skipDuplicates ? 'Skip Duplicate Entries' : 'Allow Duplicates' }}
                  </span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-sm text-gray-600">Data Quality:</span>
                  <span
                      class="text-sm font-medium"
                      :class="getDataQualityColor()"
                  >
                    {{ getDataQualityLabel() }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Import Options -->
      <div class="max-w-3xl mx-auto mb-8">
        <div class="bg-white rounded-lg border border-gray-200 p-6">
          <h3 class="text-base font-medium text-gray-900 mb-4">Import Options</h3>
          <div class="space-y-4">
            <div class="flex items-start">
              <div class="flex items-center h-5">
                <input
                    id="skip-duplicates"
                    v-model="localOptions.skipDuplicates"
                    type="checkbox"
                    class="focus:ring-purple-500 h-4 w-4 text-purple-600 border-gray-300 rounded"
                />
              </div>
              <div class="ml-3 text-sm">
                <label for="skip-duplicates" class="font-medium text-gray-700">Skip duplicate entries</label>
                <p class="text-gray-500">Don't import records that already exist in the system</p>
              </div>
            </div>
            <div class="flex items-start">
              <div class="flex items-center h-5">
                <input
                    id="update-matches"
                    v-model="localOptions.updateMatches"
                    type="checkbox"
                    class="focus:ring-purple-500 h-4 w-4 text-purple-600 border-gray-300 rounded"
                />
              </div>
              <div class="ml-3 text-sm">
                <label for="update-matches" class="font-medium text-gray-700">Update matching records</label>
                <p class="text-gray-500">Update existing records with new data if transaction ID matches</p>
              </div>
            </div>
            <div class="flex items-start">
              <div class="flex items-center h-5">
                <input
                    id="save-template"
                    v-model="localOptions.saveTemplate"
                    type="checkbox"
                    class="focus:ring-purple-500 h-4 w-4 text-purple-600 border-gray-300 rounded"
                />
              </div>
              <div class="ml-3 text-sm">
                <label for="save-template" class="font-medium text-gray-700">Save import template</label>
                <p class="text-gray-500">Save this configuration for future imports</p>
              </div>
            </div>
            <div class="flex items-start">
              <div class="flex items-center h-5">
                <input
                    id="notify"
                    v-model="localOptions.notifyWhenComplete"
                    type="checkbox"
                    class="focus:ring-purple-500 h-4 w-4 text-purple-600 border-gray-300 rounded"
                />
              </div>
              <div class="ml-3 text-sm">
                <label for="notify" class="font-medium text-gray-700">Email me when complete</label>
                <p class="text-gray-500">Receive a notification when the import process is finished</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Warning for low quality data -->
      <div v-if="stats.warningRecords > 0" class="max-w-3xl mx-auto mb-8">
        <div class="bg-yellow-50 border-l-4 border-yellow-400 p-4">
          <div class="flex">
            <div class="flex-shrink-0">
              <AlertTriangle class="h-5 w-5 text-yellow-400" />
            </div>
            <div class="ml-3">
              <p class="text-sm text-yellow-700">
                <strong>Warning:</strong> {{ stats.warningRecords }} records have validation issues.
                These records will still be imported but may require manual review after import.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex justify-between max-w-3xl mx-auto">
        <button
            class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            @click="$emit('back')"
        >
          Back to Preview
        </button>
        <div>
          <button
              class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
              @click="performImport"
              :disabled="isImporting"
          >
            <span v-if="isImporting">
              <Loader class="animate-spin mr-2 h-4 w-4" />
              Importing...
            </span>
            <span v-else>
              Start Import Process
              <ArrowRight class="ml-2 h-4 w-4" />
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  FileText,
  AlertTriangle,
  ArrowRight,
  Loader
} from 'lucide-vue-next'

const props = defineProps({
  files: {
    type: Array,
    required: true
  },
  stats: {
    type: Object,
    required: true,
    default: () => ({
      totalRecords: 0,
      validRecords: 0,
      warningRecords: 0,
      invalidRecords: 0
    })
  },
  options: {
    type: Object,
    default: () => ({
      skipDuplicates: true,
      updateMatches: false,
      saveTemplate: true,
      notifyWhenComplete: true
    })
  }
})

const emit = defineEmits(['update-options', 'back', 'import'])

// Local state
const localOptions = ref({...props.options})
const isImporting = ref(false)

// Watch for changes to localOptions
watch(localOptions.value, (newOptions) => {
  emit('update-options', newOptions)
}, { deep: true })

// Get source type label
const getSourceTypeLabel = () => {
  // Try to detect source type from filenames
  const firstFile = props.files[0]?.name || ''

  if (firstFile.toLowerCase().includes('credit') || firstFile.toLowerCase().includes('card')) {
    return 'Credit Card Files'
  } else if (firstFile.toLowerCase().includes('payment') || firstFile.toLowerCase().includes('gateway')) {
    return 'Payment Gateway'
  } else if (firstFile.toLowerCase().includes('overseas') || firstFile.toLowerCase().includes('order')) {
    return 'Overseas Orders'
  }

  return 'Transaction Files'
}

// Get data quality label
const getDataQualityLabel = () => {
  const validPercentage = props.stats.totalRecords > 0
      ? Math.round((props.stats.validRecords / props.stats.totalRecords) * 100)
      : 0

  if (validPercentage >= 95) {
    return 'Excellent'
  } else if (validPercentage >= 85) {
    return 'Good'
  } else if (validPercentage >= 70) {
    return 'Fair'
  } else {
    return 'Poor'
  }
}

// Get color for data quality
const getDataQualityColor = () => {
  const validPercentage = props.stats.totalRecords > 0
      ? Math.round((props.stats.validRecords / props.stats.totalRecords) * 100)
      : 0

  if (validPercentage >= 95) {
    return 'text-green-600'
  } else if (validPercentage >= 85) {
    return 'text-green-500'
  } else if (validPercentage >= 70) {
    return 'text-yellow-600'
  } else {
    return 'text-red-600'
  }
}

// Perform the import
const performImport = async () => {
  isImporting.value = true

  try {
    // In a real app, this would make an API call to start the import
    // For demo purposes, we'll simulate an import with a delay
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Emit the import event
    emit('import', localOptions.value)
  } catch (error) {
    console.error('Import failed:', error)
    // Handle error
  } finally {
    isImporting.value = false
  }
}
</script>