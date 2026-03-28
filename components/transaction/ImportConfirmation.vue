<template>
  <div class="bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 backdrop-blur-sm">
    <div class="p-6">
      <div class="mb-8 text-center">
        <h2 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">{{ t('importConfirmation.title') }}</h2>
        <p class="text-sm text-gray-600 dark:text-gray-400 max-w-3xl mx-auto">
          {{ t('importConfirmation.description', { count: stats.totalRecords }) }}
        </p>
      </div>

      <!-- Import Summary -->
      <div class="max-w-3xl mx-auto mb-8">
        <div class="bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-200 dark:border-white/10 p-6">
          <h3 class="text-base font-medium text-gray-900 dark:text-gray-100 mb-4">{{ t('importConfirmation.importSummary') }}</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">{{ t('importConfirmation.filesToImport') }}</h4>
              <div class="space-y-3">
                <div
                    v-for="(file, index) in files"
                    :key="index"
                    class="flex items-center"
                >
                  <div class="h-8 w-8 flex-shrink-0 bg-primary-main/20 dark:bg-primary-main/20 rounded flex items-center justify-center">
                    <FileText class="h-4 w-4 text-primary-main dark:text-primary-light" />
                  </div>
                  <div class="ml-3">
                    <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ file.name }}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('importConfirmation.records', { count: file.rowCount || 0 }) }}</p>
                  </div>
                </div>
              </div>
            </div>
            <div>
              <h4 class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">{{ t('importConfirmation.importSettings') }}</h4>
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-sm text-gray-600 dark:text-gray-400">{{ t('importConfirmation.sourceType') }}:</span>
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ getSourceTypeLabel() }}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-sm text-gray-600 dark:text-gray-400">{{ t('importConfirmation.recordsToImport') }}:</span>
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {{ stats.validRecords + stats.warningRecords }} / {{ stats.totalRecords }}
                  </span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-sm text-gray-600 dark:text-gray-400">{{ t('importConfirmation.duplicates') }}:</span>
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {{ localOptions.skipDuplicates ? t('importConfirmation.skipDuplicates') : t('importConfirmation.allowDuplicates') }}
                  </span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-sm text-gray-600 dark:text-gray-400">{{ t('importConfirmation.dataQuality') }}:</span>
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
        <div class="bg-white dark:bg-white/5 rounded-lg border border-gray-200 dark:border-white/10 p-6">
          <h3 class="text-base font-medium text-gray-900 dark:text-gray-100 mb-4">{{ t('importConfirmation.importOptions') }}</h3>
          <div class="space-y-4">
            <div class="flex items-start">
              <div class="flex items-center h-5">
                <input
                    id="skip-duplicates"
                    v-model="localOptions.skipDuplicates"
                    type="checkbox"
                    class="focus:ring-primary-main h-4 w-4 text-primary-main border-gray-300 rounded"
                />
              </div>
              <div class="ml-3 text-sm">
                <label for="skip-duplicates" class="font-medium text-gray-700 dark:text-gray-300">{{ t('importConfirmation.skipDuplicatesOption') }}</label>
                <p class="text-gray-500 dark:text-gray-400">{{ t('importConfirmation.skipDuplicatesDesc') }}</p>
              </div>
            </div>
            <div class="flex items-start">
              <div class="flex items-center h-5">
                <input
                    id="update-matches"
                    v-model="localOptions.updateMatches"
                    type="checkbox"
                    class="focus:ring-primary-main h-4 w-4 text-primary-main border-gray-300 rounded"
                />
              </div>
              <div class="ml-3 text-sm">
                <label for="update-matches" class="font-medium text-gray-700 dark:text-gray-300">{{ t('importConfirmation.updateMatches') }}</label>
                <p class="text-gray-500 dark:text-gray-400">{{ t('importConfirmation.updateMatchesDesc') }}</p>
              </div>
            </div>
            <div class="flex items-start">
              <div class="flex items-center h-5">
                <input
                    id="save-template"
                    v-model="localOptions.saveTemplate"
                    type="checkbox"
                    class="focus:ring-primary-main h-4 w-4 text-primary-main border-gray-300 rounded"
                />
              </div>
              <div class="ml-3 text-sm">
                <label for="save-template" class="font-medium text-gray-700 dark:text-gray-300">{{ t('importConfirmation.saveTemplate') }}</label>
                <p class="text-gray-500 dark:text-gray-400">{{ t('importConfirmation.saveTemplateDesc') }}</p>
              </div>
            </div>
            <div class="flex items-start">
              <div class="flex items-center h-5">
                <input
                    id="notify"
                    v-model="localOptions.notifyWhenComplete"
                    type="checkbox"
                    class="focus:ring-primary-main h-4 w-4 text-primary-main border-gray-300 rounded"
                />
              </div>
              <div class="ml-3 text-sm">
                <label for="notify" class="font-medium text-gray-700 dark:text-gray-300">{{ t('importConfirmation.emailNotify') }}</label>
                <p class="text-gray-500 dark:text-gray-400">{{ t('importConfirmation.emailNotifyDesc') }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Warning for low quality data -->
      <div v-if="stats.warningRecords > 0" class="max-w-3xl mx-auto mb-8">
        <div class="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 p-4">
          <div class="flex">
            <div class="flex-shrink-0">
              <AlertTriangle class="h-5 w-5 text-yellow-400" />
            </div>
            <div class="ml-3">
              <p class="text-sm text-yellow-700 dark:text-yellow-300">
                {{ t('importConfirmation.warningRecords', { count: stats.warningRecords }) }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex justify-between max-w-3xl mx-auto">
        <button
            class="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-white/10 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
            @click="$emit('back')"
        >
          {{ t('importConfirmation.backToPreview') }}
        </button>
        <div>
          <button
              class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-main hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
              @click="performImport"
              :disabled="isImporting"
          >
            <span v-if="isImporting">
              <Loader class="animate-spin mr-2 h-4 w-4" />
              {{ t('importConfirmation.importing') }}
            </span>
            <span v-else>
              {{ t('importConfirmation.startImport') }}
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

const { t } = useI18n()

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
    return t('importConfirmation.creditCardFiles')
  } else if (firstFile.toLowerCase().includes('payment') || firstFile.toLowerCase().includes('gateway')) {
    return t('importConfirmation.paymentGateway')
  } else if (firstFile.toLowerCase().includes('overseas') || firstFile.toLowerCase().includes('order')) {
    return t('importConfirmation.overseasOrders')
  }

  return t('importConfirmation.transactionFiles')
}

// Get data quality label
const getDataQualityLabel = () => {
  const validPercentage = props.stats.totalRecords > 0
      ? Math.round((props.stats.validRecords / props.stats.totalRecords) * 100)
      : 0

  if (validPercentage >= 95) {
    return t('importConfirmation.excellent')
  } else if (validPercentage >= 85) {
    return t('importConfirmation.good')
  } else if (validPercentage >= 70) {
    return t('importConfirmation.fair')
  } else {
    return t('importConfirmation.poor')
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