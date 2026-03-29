<template>
  <div class="max-w-5xl mx-auto">
    <!-- Header -->
    <header class="mb-8">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('transactionUpload.title') }}</h1>
      <p class="mt-1 text-gray-500 dark:text-gray-400">{{ t('transactionUpload.description') }}</p>
    </header>

    <!-- Step Navigation -->
    <div class="mb-8">
      <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm p-6">
        <div class="relative">
          <!-- Progress Bar Background -->
          <div class="absolute top-5 left-0 right-0 h-1 bg-gray-200 dark:bg-white/10 rounded-full" />
          <!-- Progress Bar Fill -->
          <div
            class="absolute top-5 left-0 h-1 bg-gradient-to-r from-primary-main to-primary-dark rounded-full transition-all duration-500 ease-out"
            :style="{ width: `${(currentStep / (steps.length - 1)) * 100}%` }"
          />

          <!-- Steps -->
          <nav class="relative flex justify-between">
            <button
              v-for="(step, index) in steps"
              :key="step.id"
              class="flex flex-col items-center group touch-manipulation"
              :disabled="!canNavigateToStep(index)"
              @click="navigateToStep(index)"
            >
              <!-- Step Circle -->
              <div
                class="relative z-10 flex items-center justify-center w-10 h-10 rounded-xl border-2 transition-all duration-300"
                :class="getStepCircleClass(index)"
              >
                <CheckCircle v-if="completedSteps.includes(index)" class="h-5 w-5" />
                <component v-else :is="getStepIcon(index)" class="h-5 w-5" />
              </div>
              <!-- Step Label -->
              <span
                class="mt-2.5 text-xs font-medium transition-colors"
                :class="currentStep === index
                  ? 'text-primary-main dark:text-primary-light'
                  : completedSteps.includes(index)
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-gray-500 dark:text-gray-400'"
              >
                {{ t(`transactionUpload.steps.${step.id}`) }}
              </span>
            </button>
          </nav>
        </div>
      </div>
    </div>

    <!-- Step Content -->
    <div class="transition-all duration-300">
      <!-- Step 1: File Upload -->
      <Transition name="fade" mode="out-in">
        <div v-if="currentStep === 0" key="upload">
          <TransactionFileUpload
            :selected-source="selectedSource"
            @source-selected="selectSource"
            @files-selected="handleFilesSelected"
            @continue="nextStep"
          />
        </div>

        <!-- Step 2: Field Mapping -->
        <div v-else-if="currentStep === 1" key="mapping">
          <FieldMapping
            :files="uploadedFiles"
            :mappings="fieldMappings"
            @update-mappings="updateMappings"
            @back="previousStep"
            @continue="nextStep"
          />
        </div>

        <!-- Step 3: Data Preview -->
        <div v-else-if="currentStep === 2" key="preview">
          <TransactionDataPreview
            :files="uploadedFiles"
            :mappings="fieldMappings"
            :parsed-data="parsedData"
            @update-data="updateParsedData"
            @back="previousStep"
            @continue="nextStep"
          />
        </div>

        <!-- Step 4: Import -->
        <div v-else-if="currentStep === 3" key="import">
          <ImportConfirmation
            :files="uploadedFiles"
            :stats="importStats"
            :options="importOptions"
            @update-options="updateImportOptions"
            @back="previousStep"
            @import="performImport"
          />
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { CheckCircle, Upload, GitBranch, Eye, Download } from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

const { t } = useI18n()
const userStore = useUserStore()
const getAuthHeaders = () => userStore.authHeader

// Define steps for the import process
const steps = [
  { id: 'upload' },
  { id: 'mapping' },
  { id: 'preview' },
  { id: 'import' }
]

// Step icons
const getStepIcon = (index: number) => {
  const icons = [Upload, GitBranch, Eye, Download]
  return icons[index] || Upload
}

// State variables
const currentStep = ref(0)
const completedSteps = ref<number[]>([])
const selectedSource = ref('credit_card')
const uploadedFiles = ref<any[]>([])
const fieldMappings = ref<Record<string, any>>({})
const parsedData = ref<any[]>([])
const importStats = ref({
  totalRecords: 0,
  validRecords: 0,
  warningRecords: 0,
  invalidRecords: 0
})
const importOptions = ref({
  skipDuplicates: true,
  updateMatches: false,
  saveTemplate: true,
  notifyWhenComplete: true
})

// Get step circle class
const getStepCircleClass = (index: number) => {
  if (completedSteps.value.includes(index)) {
    return 'bg-green-500 border-green-500 text-white shadow-lg shadow-green-500/25'
  }
  if (currentStep.value === index) {
    return 'bg-gradient-to-br from-primary-main to-primary-dark border-primary-main text-white shadow-lg shadow-primary-main/25'
  }
  return 'bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-400 dark:text-gray-500'
}

// Check if can navigate to step
const canNavigateToStep = (stepIndex: number) => {
  return completedSteps.value.includes(stepIndex) ||
    stepIndex === currentStep.value ||
    stepIndex === currentStep.value + 1
}

// Navigate between steps
const navigateToStep = (stepIndex: number) => {
  if (canNavigateToStep(stepIndex)) {
    currentStep.value = stepIndex
  }
}

const nextStep = () => {
  if (currentStep.value < steps.length - 1) {
    if (!completedSteps.value.includes(currentStep.value)) {
      completedSteps.value.push(currentStep.value)
    }
    currentStep.value++
  }
}

const previousStep = () => {
  if (currentStep.value > 0) {
    currentStep.value--
  }
}

// Handle source selection
const selectSource = (sourceId: string) => {
  selectedSource.value = sourceId
}

// Handle file selection - now receives actual parsed data from the component
const handleFilesSelected = (files: any[]) => {
  uploadedFiles.value = files

  // If files have parsed data, use it
  if (files.length > 0 && files[0].data) {
    const allData = files.flatMap(f => f.data || [])
    const headers = files[0].headers || Object.keys(files[0].data?.[0] || {})

    // Generate mappings from headers
    const mappings: Record<string, any> = {}
    headers.forEach((header: string) => {
      const headerLower = header.toLowerCase()
      if (headerLower.includes('id') || headerLower.includes('reference') || headerLower.includes('番号')) {
        mappings[header] = { field: 'transaction_id', format: 'text' }
      } else if (headerLower.includes('date') || headerLower.includes('日付') || headerLower.includes('日時')) {
        mappings[header] = { field: 'transaction_date', format: 'date' }
      } else if (headerLower.includes('amount') || headerLower.includes('金額') || headerLower.includes('total') || headerLower.includes('合計')) {
        mappings[header] = { field: 'amount', format: 'currency' }
      } else if (headerLower.includes('currency') || headerLower.includes('通貨')) {
        mappings[header] = { field: 'currency_code', format: 'text' }
      } else if (headerLower.includes('email') || headerLower.includes('メール')) {
        mappings[header] = { field: 'customer_email', format: 'email' }
      } else if (headerLower.includes('status') || headerLower.includes('ステータス') || headerLower.includes('状態')) {
        mappings[header] = { field: 'transaction_status', format: 'text' }
      } else if (headerLower.includes('name') || headerLower.includes('名前') || headerLower.includes('名称')) {
        mappings[header] = { field: 'customer_name', format: 'text' }
      } else if (headerLower.includes('note') || headerLower.includes('memo') || headerLower.includes('メモ') || headerLower.includes('備考')) {
        mappings[header] = { field: 'notes', format: 'text' }
      } else {
        mappings[header] = { field: null, format: 'text' }
      }
    })

    fieldMappings.value = mappings
    parsedData.value = allData

    // Calculate stats
    const validCount = allData.filter((row: any) => {
      const hasAmount = Object.keys(row).some(k =>
        k.toLowerCase().includes('amount') || k.toLowerCase().includes('金額')
      )
      return hasAmount
    }).length

    importStats.value = {
      totalRecords: allData.length,
      validRecords: validCount,
      warningRecords: allData.length - validCount,
      invalidRecords: 0
    }
  }
}

// Update field mappings
const updateMappings = (mappings: Record<string, any>) => {
  fieldMappings.value = mappings
}

// Update parsed data
const updateParsedData = (data: any[]) => {
  parsedData.value = data
}

// Update import options
const updateImportOptions = (options: any) => {
  importOptions.value = options
}

// Perform the actual import
const performImport = async () => {
  try {
    const result = await $fetch('/api/transactions/import', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: {
        data: parsedData.value,
        mappings: fieldMappings.value,
        options: importOptions.value
      }
    })

    const imported = (result as any)?.results?.imported || 0
    alert(t('transactionDetail.importComplete', { count: imported }))
    navigateTo('/transactions')
  } catch (error: any) {
    alert(t('transactionDetail.importError', { message: error.message || t('common.error') }))
  }
}

onMounted(() => {
  userStore.initAuth()
})
</script>

<style scoped>
.fade-enter-active {
  transition: opacity 0.25s ease-out;
}

.fade-leave-active {
  transition: opacity 0.15s ease-in;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
