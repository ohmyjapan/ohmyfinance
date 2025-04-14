<template>
  <div class="bg-white rounded-lg shadow-sm">
    <div class="p-6">
      <div class="mb-6">
        <h2 class="text-lg font-medium text-gray-900 mb-2">Map File Fields to Database Fields</h2>
        <p class="text-sm text-gray-600">
          Configure how your imported data fields map to our system fields. The system has automatically
          suggested mappings which you can adjust as needed.
        </p>
      </div>

      <div class="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-md">
        <div class="flex">
          <div class="flex-shrink-0">
            <AlertCircle class="h-5 w-5 text-blue-400" />
          </div>
          <div class="ml-3 flex-1 md:flex md:justify-between">
            <p class="text-sm text-blue-700">
              We've detected <strong>{{ totalRows }}</strong> rows from your files. Please review the field mappings below.
            </p>
            <p class="mt-3 text-sm md:mt-0 md:ml-6">
              <button
                  class="whitespace-nowrap font-medium text-blue-700 hover:text-blue-600"
                  @click="showSampleData = !showSampleData"
              >
                {{ showSampleData ? 'Hide Sample Data' : 'View Sample Data' }}
                <component :is="showSampleData ? ChevronUp : ChevronDown" class="inline h-3 w-3" />
              </button>
            </p>
          </div>
        </div>
      </div>

      <!-- Sample Data Preview -->
      <div v-if="showSampleData" class="mb-6 overflow-x-auto border border-gray-200 rounded-lg">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
          <tr>
            <th
                v-for="(field, index) in sourceFields"
                :key="index"
                class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            >
              {{ field }}
            </th>
          </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
          <tr v-for="(row, rowIndex) in sampleData.slice(0, 3)" :key="rowIndex">
            <td
                v-for="(field, fieldIndex) in sourceFields"
                :key="fieldIndex"
                class="px-3 py-2 whitespace-nowrap text-xs text-gray-500"
            >
              {{ row[field] }}
            </td>
          </tr>
          </tbody>
        </table>
      </div>

      <!-- File Selector -->
      <div class="mb-6">
        <label class="block text-sm font-medium text-gray-700 mb-2">Select File to Map</label>
        <div class="relative">
          <select
              v-model="currentFile"
              class="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm rounded-md"
          >
            <option
                v-for="(file, index) in files"
                :key="index"
                :value="file.name"
            >
              {{ file.name }}
            </option>
          </select>
          <div class="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
            <ChevronDown class="h-4 w-4 text-gray-400" />
          </div>
        </div>
      </div>

      <!-- Field Mapping Table -->
      <div class="border border-gray-200 rounded-lg overflow-hidden mb-6">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
          <tr>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Source Field
            </th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Sample Data
            </th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Maps To
            </th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Data Format
            </th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
          </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
          <tr
              v-for="(field, index) in sourceFields"
              :key="index"
              :class="{'bg-yellow-50': !isFieldMapped(field)}"
          >
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
              {{ field }}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
              {{ getSampleValue(field) }}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm">
              <div class="relative">
                <select
                    v-model="localMappings[field].field"
                    class="block w-full pl-3 pr-10 py-1 text-sm border-gray-300 focus:outline-none focus:ring-purple-500 focus:border-purple-500 rounded-md"
                    :class="{'bg-yellow-50 border-yellow-300': !isFieldMapped(field)}"
                >
                  <option value="">-- Select Field --</option>
                  <option
                      v-for="(option, optIndex) in targetFieldOptions"
                      :key="optIndex"
                      :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                  <option value="null">-- Do Not Import --</option>
                </select>
              </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm">
              <div class="relative">
                <select
                    v-model="localMappings[field].format"
                    class="block w-full pl-3 pr-10 py-1 text-sm border-gray-300 focus:outline-none focus:ring-purple-500 focus:border-purple-500 rounded-md"
                >
                  <option
                      v-for="(option, optIndex) in formatOptions[getFieldType(field)]"
                      :key="optIndex"
                      :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span
                    class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full"
                    :class="isFieldMapped(field)
                    ? 'bg-green-100 text-green-800'
                    : 'bg-yellow-100 text-yellow-800'"
                >
                  {{ isFieldMapped(field) ? 'Mapped' : 'Needs Mapping' }}
                </span>
            </td>
          </tr>
          </tbody>
        </table>
      </div>

      <!-- Save Mapping Template -->
      <div class="mb-6">
        <div class="flex items-start">
          <div class="flex items-center h-5">
            <input
                id="save-template"
                v-model="saveTemplate"
                type="checkbox"
                class="focus:ring-purple-500 h-4 w-4 text-purple-600 border-gray-300 rounded"
            />
          </div>
          <div class="ml-3 text-sm">
            <label for="save-template" class="font-medium text-gray-700">Save this mapping as a template</label>
            <p class="text-gray-500">You can reuse this mapping for future imports from the same source</p>
          </div>
        </div>

        <div v-if="saveTemplate" class="mt-3 flex">
          <input
              v-model="templateName"
              type="text"
              class="flex-1 focus:ring-purple-500 focus:border-purple-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
              placeholder="Template name"
          />
          <button
              class="ml-3 inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
              :disabled="!templateName"
          >
            Save Template
          </button>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex justify-between">
        <button
            class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            @click="$emit('back')"
        >
          Back to Upload
        </button>
        <div>
          <button
              class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
              :disabled="!allFieldsMapped"
              @click="continueToPreview"
          >
            Continue to Preview
            <ArrowRight class="ml-2 h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ArrowRight
} from 'lucide-vue-next'

const props = defineProps({
  files: {
    type: Array,
    required: true
  },
  mappings: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update-mappings', 'back', 'continue'])

// State
const showSampleData = ref(false)
const currentFile = ref('')
const localMappings = ref({...props.mappings})
const saveTemplate = ref(false)
const templateName = ref('')

// Sample data for the current file
const sampleData = ref([
  // This would be dynamically loaded based on the selected file
  // Here's a placeholder with sample data
])

// Get total number of rows from all files
const totalRows = computed(() => {
  return props.files.reduce((total, file) => total + (file.rowCount || 0), 0)
})

// Get the source fields from the current file
const sourceFields = computed(() => {
  if (!sampleData.value.length) return []
  return Object.keys(sampleData.value[0] || {})
})

// Check if all fields are mapped
const allFieldsMapped = computed(() => {
  return sourceFields.value.every(field => isFieldMapped(field))
})

// Target field options
const targetFieldOptions = [
  { label: 'Transaction ID', value: 'transaction_id' },
  { label: 'Transaction Date', value: 'transaction_date' },
  { label: 'Amount', value: 'amount' },
  { label: 'Currency Code', value: 'currency_code' },
  { label: 'Customer Email', value: 'customer_email' },
  { label: 'Customer Name', value: 'customer_name' },
  { label: 'Transaction Status', value: 'transaction_status' },
  { label: 'Payment Method', value: 'payment_method' },
  { label: 'Reference Number', value: 'reference_number' },
  { label: 'Order Number', value: 'order_number' },
  { label: 'Country', value: 'country' },
  { label: 'Notes', value: 'notes' }
]

// Format options by field type
const formatOptions = {
  string: [
    { label: 'Text', value: 'text' },
    { label: 'Email', value: 'email' },
    { label: 'Phone Number', value: 'phone' },
    { label: 'Address', value: 'address' }
  ],
  number: [
    { label: 'Number', value: 'number' },
    { label: 'Currency (USD)', value: 'currency_usd' },
    { label: 'Percentage', value: 'percentage' },
    { label: 'Decimal', value: 'decimal' }
  ],
  date: [
    { label: 'Date (YYYY-MM-DD)', value: 'date_iso' },
    { label: 'Date (MM/DD/YYYY)', value: 'date_us' },
    { label: 'Date (DD/MM/YYYY)', value: 'date_eu' },
    { label: 'Date/Time', value: 'datetime' }
  ],
  status: [
    { label: 'Text', value: 'text' },
    { label: 'Status Code', value: 'status_code' }
  ]
}

// Initialize component
onMounted(() => {
  if (props.files.length > 0) {
    currentFile.value = props.files[0].name

    // Generate sample data for the first file
    generateSampleData()

    // Initialize mappings for all fields
    initializeMappings()
  }
})

// Watch for changes in the selected file
watch(currentFile, () => {
  generateSampleData()
  initializeMappings()
})

// Generate sample data for the selected file
const generateSampleData = () => {
  // In a real app, this would load data from the file
  // For this example, we'll generate some mock data

  const file = props.files.find(f => f.name === currentFile.value)

  if (!file) return

  // Determine fields based on the file type
  let fields = []

  if (file.name.toLowerCase().includes('credit') || file.name.toLowerCase().includes('card')) {
    fields = ['transaction_id', 'date', 'amount', 'currency_code', 'customer_email', 'status_code']
  } else if (file.name.toLowerCase().includes('payment') || file.name.toLowerCase().includes('gateway')) {
    fields = ['reference', 'transaction_date', 'payment_amount', 'currency', 'customer_id', 'payment_status']
  } else { // overseas
    fields = ['order_id', 'order_date', 'total_amount', 'currency', 'customer_email', 'order_status', 'country']
  }

  // Generate sample data
  const data = []
  for (let i = 0; i < 10; i++) {
    const row = {}

    fields.forEach(field => {
      if (field.includes('id') || field.includes('reference')) {
        row[field] = `TRX-${10000 + i}`
      } else if (field.includes('date')) {
        const date = new Date()
        date.setDate(date.getDate() - Math.floor(Math.random() * 30))
        row[field] = date.toISOString().split('T')[0]
      } else if (field.includes('amount') || field.includes('total')) {
        row[field] = (Math.random() * 1000 + 50).toFixed(2)
      } else if (field.includes('currency')) {
        row[field] = 'USD'
      } else if (field.includes('email')) {
        row[field] = `customer${i}@example.com`
      } else if (field.includes('status')) {
        const statuses = ['COMPLETED', 'PENDING', 'PROCESSING', 'FAILED']
        row[field] = statuses[Math.floor(Math.random() * statuses.length)]
      } else if (field.includes('country')) {
        const countries = ['USA', 'Canada', 'UK', 'Australia', 'Japan']
        row[field] = countries[Math.floor(Math.random() * countries.length)]
      } else if (field.includes('customer')) {
        row[field] = `Customer ${i}`
      } else {
        row[field] = `Value ${i}`
      }
    })

    data.push(row)
  }

  sampleData.value = data
}

// Initialize mappings for fields
const initializeMappings = () => {
  sourceFields.value.forEach(field => {
    if (!localMappings.value[field]) {
      // Auto-map based on field name
      let targetField = null
      let format = 'text'

      if (field.includes('id') || field.includes('reference')) {
        targetField = 'transaction_id'
        format = 'text'
      } else if (field.includes('date')) {
        targetField = 'transaction_date'
        format = 'date_iso'
      } else if (field.includes('amount') || field.includes('total')) {
        targetField = 'amount'
        format = 'currency_usd'
      } else if (field.includes('currency')) {
        targetField = 'currency_code'
        format = 'text'
      } else if (field.includes('email')) {
        targetField = 'customer_email'
        format = 'email'
      } else if (field.includes('status')) {
        targetField = 'transaction_status'
        format = 'text'
      } else if (field.includes('country')) {
        targetField = 'country'
        format = 'text'
      } else if (field.includes('customer')) {
        targetField = 'customer_name'
        format = 'text'
      } else {
        targetField = '' // Needs manual mapping
      }

      localMappings.value[field] = { field: targetField, format }
    }
  })

  // Emit the updated mappings
  emit('update-mappings', localMappings.value)
}

// Get a sample value for a field
const getSampleValue = (field) => {
  if (sampleData.value.length === 0) return ''
  return sampleData.value[0][field]
}

// Check if a field is mapped
const isFieldMapped = (field) => {
  return localMappings.value[field] && localMappings.value[field].field && localMappings.value[field].field !== ''
}

// Get the field type based on the field name or sample value
const getFieldType = (field) => {
  const sampleValue = getSampleValue(field)

  if (field.includes('date')) {
    return 'date'
  } else if (field.includes('amount') || field.includes('price') || field.includes('total')) {
    return 'number'
  } else if (field.includes('status')) {
    return 'status'
  } else if (!isNaN(parseFloat(sampleValue)) && isFinite(sampleValue)) {
    return 'number'
  } else {
    return 'string'
  }
}

// Continue to preview
const continueToPreview = () => {
  emit('update-mappings', localMappings.value)
  emit('continue')
}
</script>