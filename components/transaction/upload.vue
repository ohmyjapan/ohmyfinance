<template>
  <div>
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-gray-800">Transaction Data Import</h1>
      <p class="text-gray-600">Upload and import transaction data from various sources</p>
    </header>

    <!-- Step Navigation -->
    <div class="mb-8">
      <div class="border-b border-gray-200">
        <nav class="flex -mb-px">
          <button
              v-for="(step, index) in steps"
              :key="step.id"
              class="flex items-center py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap mr-8"
              :class="[
              currentStep === index
                ? 'border-purple-500 text-purple-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
              completedSteps.includes(index) ? 'text-green-600' : ''
            ]"
              @click="navigateToStep(index)"
          >
            <div
                class="flex items-center justify-center h-6 w-6 rounded-full mr-2"
                :class="[
                currentStep === index
                  ? 'bg-purple-100 text-purple-600'
                  : completedSteps.includes(index)
                    ? 'bg-green-100 text-green-600'
                    : 'bg-gray-100 text-gray-500'
              ]"
            >
              <CheckCircle v-if="completedSteps.includes(index)" size="16" />
              <span v-else>{{ index + 1 }}</span>
            </div>
            {{ step.name }}
          </button>
        </nav>
      </div>
    </div>

    <!-- Conditional content based on current step -->
    <div>
      <!-- Step 1: File Upload -->
      <div v-if="currentStep === 0">
        <TransactionFileUpload
            :selected-source="selectedSource"
            @source-selected="selectSource"
            @files-selected="handleFilesSelected"
            @continue="nextStep"
        />
      </div>

      <!-- Step 2: Field Mapping -->
      <div v-if="currentStep === 1">
        <FieldMapping
            :files="uploadedFiles"
            :mappings="fieldMappings"
            @update-mappings="updateMappings"
            @back="previousStep"
            @continue="nextStep"
        />
      </div>

      <!-- Step 3: Data Preview -->
      <div v-if="currentStep === 2">
        <DataPreview
            :files="uploadedFiles"
            :mappings="fieldMappings"
            :parsed-data="parsedData"
            @update-data="updateParsedData"
            @back="previousStep"
            @continue="nextStep"
        />
      </div>

      <!-- Step 4: Import -->
      <div v-if="currentStep === 3">
        <ImportConfirmation
            :files="uploadedFiles"
            :stats="importStats"
            :options="importOptions"
            @update-options="updateImportOptions"
            @back="previousStep"
            @import="performImport"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { CheckCircle } from 'lucide-vue-next'

// Define steps for the import process
const steps = [
  { id: 'upload', name: 'Upload Files' },
  { id: 'mapping', name: 'Field Mapping' },
  { id: 'preview', name: 'Data Preview' },
  { id: 'import', name: 'Import' }
]

// State variables
const currentStep = ref(0)
const completedSteps = ref<number[]>([])
const selectedSource = ref('credit_card')
const uploadedFiles = ref<File[]>([])
const fieldMappings = ref({})
const parsedData = ref([])
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

// Navigate between steps
const navigateToStep = (stepIndex: number) => {
  // Only allow navigation to completed steps or the current step + 1
  if (completedSteps.value.includes(stepIndex) || stepIndex === currentStep.value ||
      stepIndex === currentStep.value + 1) {
    currentStep.value = stepIndex
  }
}

const nextStep = () => {
  if (currentStep.value < steps.length - 1) {
    // Mark current step as completed
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

// Handle file selection
const handleFilesSelected = (files: File[]) => {
  uploadedFiles.value = files

  // In a real application, you would upload these files to your server
  // and process them there. For now, we'll just simulate this process.

  // Generate a basic mapping based on file headers (in a real app, this would
  // be more sophisticated with header detection from the CSV/Excel file)
  if (files.length > 0) {
    simulateFileParsing(files[0])
  }
}

// Simulate parsing a file to extract headers and generate mapping
const simulateFileParsing = (file: File) => {
  // This is a mock function. In a real app, you would use
  // PapaParse or xlsx to read the file and extract headers

  // Sample headers based on file type
  let headers: string[]

  if (selectedSource.value === 'credit_card') {
    headers = ['transaction_id', 'date', 'amount', 'currency_code', 'customer_email', 'status_code']
  } else if (selectedSource.value === 'payment_gateway') {
    headers = ['reference', 'transaction_date', 'payment_amount', 'currency', 'customer_id', 'payment_status']
  } else { // overseas
    headers = ['order_id', 'order_date', 'total_amount', 'currency', 'customer_email', 'order_status', 'country']
  }

  // Generate default mappings
  const mappings = {}
  headers.forEach(header => {
    // Simple mapping logic - could be more sophisticated
    if (header.includes('id') || header.includes('reference')) {
      mappings[header] = { field: 'transaction_id', format: 'text' }
    } else if (header.includes('date')) {
      mappings[header] = { field: 'transaction_date', format: 'date' }
    } else if (header.includes('amount') || header.includes('total')) {
      mappings[header] = { field: 'amount', format: 'currency' }
    } else if (header.includes('currency')) {
      mappings[header] = { field: 'currency_code', format: 'text' }
    } else if (header.includes('email')) {
      mappings[header] = { field: 'customer_email', format: 'email' }
    } else if (header.includes('status')) {
      mappings[header] = { field: 'transaction_status', format: 'text' }
    } else {
      mappings[header] = { field: null, format: 'text' }
    }
  })

  fieldMappings.value = mappings

  // Generate sample parsed data
  parsedData.value = generateSampleData(headers, 50)

  // Calculate import stats
  importStats.value = {
    totalRecords: 50,
    validRecords: 44,
    warningRecords: 6,
    invalidRecords: 0
  }
}

// Generate sample data for preview
const generateSampleData = (headers: string[], count: number) => {
  const data = []

  for (let i = 0; i < count; i++) {
    const row = {}

    headers.forEach(header => {
      if (header.includes('id') || header.includes('reference')) {
        row[header] = `${selectedSource.value.toUpperCase()}-${10000 + i}`
      } else if (header.includes('date')) {
        const date = new Date()
        date.setDate(date.getDate() - Math.floor(Math.random() * 30))
        row[header] = date.toISOString().split('T')[0]
      } else if (header.includes('amount') || header.includes('total')) {
        row[header] = (Math.random() * 1000 + 50).toFixed(2)
      } else if (header.includes('currency')) {
        row[header] = 'USD'
      } else if (header.includes('email')) {
        // Add some "errors" for the warning records
        if (i < 6) {
          row[header] = ''
        } else {
          row[header] = `customer${i}@example.com`
        }
      } else if (header.includes('status')) {
        const statuses = ['COMPLETED', 'PENDING', 'PROCESSING', 'FAILED']
        row[header] = statuses[Math.floor(Math.random() * statuses.length)]
      } else if (header.includes('country')) {
        const countries = ['USA', 'Canada', 'UK', 'Australia', 'Japan']
        row[header] = countries[Math.floor(Math.random() * countries.length)]
      } else {
        row[header] = `Value ${i}`
      }
    })

    data.push(row)
  }

  return data
}

// Update field mappings
const updateMappings = (mappings) => {
  fieldMappings.value = mappings
}

// Update parsed data
const updateParsedData = (data) => {
  parsedData.value = data
}

// Update import options
const updateImportOptions = (options) => {
  importOptions.value = options
}

// Perform the actual import
const performImport = () => {
  // In a real app, this would make an API call to import the data
  console.log('Performing import with options:', importOptions.value)
  console.log('Importing data:', parsedData.value)

  // Simulate successful import
  alert('Import completed successfully!')

  // Reset the form for a new import
  // Or redirect to transactions page
  // router.push('/transactions')
}
</script>