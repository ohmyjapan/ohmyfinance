<template>
  <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm">
    <div class="p-6">
      <div class="mb-6">
        <h2 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">{{ t('fieldMapper.title') }}</h2>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          {{ t('fieldMapper.description') }}
        </p>
      </div>

      <div class="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-md">
        <div class="flex">
          <div class="flex-shrink-0">
            <AlertCircle class="h-5 w-5 text-blue-400" />
          </div>
          <div class="ml-3 flex-1 md:flex md:justify-between">
            <p class="text-sm text-blue-700 dark:text-blue-300">
              {{ t('fieldMapper.detectedRows', { count: totalRows }) }}
            </p>
            <p class="mt-3 text-sm md:mt-0 md:ml-6">
              <button
                  class="whitespace-nowrap font-medium text-blue-700 dark:text-blue-300 hover:text-blue-600"
                  @click="showSampleData = !showSampleData"
              >
                {{ showSampleData ? t('fieldMapper.hideSampleData') : t('fieldMapper.viewSampleData') }}
                <component :is="showSampleData ? ChevronUp : ChevronDown" class="inline h-3 w-3" />
              </button>
            </p>
          </div>
        </div>
      </div>

      <!-- Sample Data Preview -->
      <div v-if="showSampleData" class="mb-6 overflow-x-auto border border-gray-200 rounded-lg">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50 dark:bg-white/5">
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
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{{ t('fieldMapper.selectFile') }}</label>
        <div class="relative">
          <select
              v-model="currentFile"
              class="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm rounded-md"
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
      <div class="border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden mb-6">
        <table class="min-w-full divide-y divide-gray-200 dark:divide-white/10">
          <thead class="bg-gray-50 dark:bg-white/5">
          <tr>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
              {{ t('fieldMapper.sourceField') }}
            </th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
              {{ t('fieldMapper.sampleData') }}
            </th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
              {{ t('fieldMapper.mapsTo') }}
            </th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
              {{ t('fieldMapper.dataFormat') }}
            </th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
              {{ t('common.status') }}
            </th>
          </tr>
          </thead>
          <tbody class="bg-white dark:bg-white/5 divide-y divide-gray-200 dark:divide-white/10">
          <tr
              v-for="(field, index) in sourceFields"
              :key="index"
              :class="{'bg-yellow-50 dark:bg-yellow-900/20': !isFieldMapped(field)}"
          >
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
              {{ field }}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
              {{ getSampleValue(field) }}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm">
              <div class="relative">
                <select
                    v-model="localMappings[field].field"
                    class="block w-full pl-3 pr-10 py-1 text-sm border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 focus:outline-none focus:ring-primary-main focus:border-primary-main rounded-md"
                    :class="{'bg-yellow-50 border-yellow-300 dark:bg-yellow-900/20': !isFieldMapped(field)}"
                >
                  <option value="">-- {{ t('fieldMapper.selectField') }} --</option>
                  <option
                      v-for="(option, optIndex) in translatedTargetFieldOptions"
                      :key="optIndex"
                      :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                  <option value="null">-- {{ t('fieldMapper.doNotImport') }} --</option>
                </select>
              </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm">
              <div class="relative">
                <select
                    v-model="localMappings[field].format"
                    class="block w-full pl-3 pr-10 py-1 text-sm border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 focus:outline-none focus:ring-primary-main focus:border-primary-main rounded-md"
                >
                  <option
                      v-for="(option, optIndex) in translatedFormatOptions[getFieldType(field)]"
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
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'"
                >
                  {{ isFieldMapped(field) ? t('fieldMapper.mapped') : t('fieldMapper.needsMapping') }}
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
                class="focus:ring-primary-main h-4 w-4 text-primary-main border-gray-300 rounded"
            />
          </div>
          <div class="ml-3 text-sm">
            <label for="save-template" class="font-medium text-gray-700 dark:text-gray-300">{{ t('fieldMapper.saveAsTemplate') }}</label>
            <p class="text-gray-500 dark:text-gray-400">{{ t('fieldMapper.saveTemplateDescription') }}</p>
          </div>
        </div>

        <div v-if="saveTemplate" class="mt-3 flex">
          <input
              v-model="templateName"
              type="text"
              class="flex-1 focus:ring-primary-main focus:border-primary-main block w-full shadow-sm sm:text-sm border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-md"
              :placeholder="t('fieldMapper.templateName')"
          />
          <button
              class="ml-3 inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-main hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
              :disabled="!templateName"
              @click="saveTemplateAction"
          >
            {{ t('fieldMapper.saveTemplate') }}
          </button>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex justify-between">
        <button
            class="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-white/10 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
            @click="$emit('back')"
        >
          {{ t('fieldMapper.backToUpload') }}
        </button>
        <div>
          <button
              class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-main hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
              :disabled="!allFieldsMapped"
              @click="continueToPreview"
          >
            {{ t('fieldMapper.continueToPreview') }}
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

const { t } = useI18n()

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
const sampleData = ref([])

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

// Target field options (translated)
const translatedTargetFieldOptions = computed(() => [
  { label: t('fieldMapper.targetFields.transactionId'), value: 'transaction_id' },
  { label: t('fieldMapper.targetFields.transactionDate'), value: 'transaction_date' },
  { label: t('fieldMapper.targetFields.amount'), value: 'amount' },
  { label: t('fieldMapper.targetFields.currencyCode'), value: 'currency_code' },
  { label: t('fieldMapper.targetFields.customerEmail'), value: 'customer_email' },
  { label: t('fieldMapper.targetFields.customerName'), value: 'customer_name' },
  { label: t('fieldMapper.targetFields.transactionStatus'), value: 'transaction_status' },
  { label: t('fieldMapper.targetFields.paymentMethod'), value: 'payment_method' },
  { label: t('fieldMapper.targetFields.referenceNumber'), value: 'reference_number' },
  { label: t('fieldMapper.targetFields.orderNumber'), value: 'order_number' },
  { label: t('fieldMapper.targetFields.country'), value: 'country' },
  { label: t('fieldMapper.targetFields.notes'), value: 'notes' }
])

// Format options by field type (translated)
const translatedFormatOptions = computed(() => ({
  string: [
    { label: t('fieldMapper.formatOptions.text'), value: 'text' },
    { label: t('fieldMapper.formatOptions.email'), value: 'email' },
    { label: t('fieldMapper.formatOptions.phone'), value: 'phone' },
    { label: t('fieldMapper.formatOptions.address'), value: 'address' }
  ],
  number: [
    { label: t('fieldMapper.formatOptions.number'), value: 'number' },
    { label: t('fieldMapper.formatOptions.currency'), value: 'currency_usd' },
    { label: t('fieldMapper.formatOptions.percentage'), value: 'percentage' },
    { label: t('fieldMapper.formatOptions.decimal'), value: 'decimal' }
  ],
  date: [
    { label: t('fieldMapper.formatOptions.dateIso'), value: 'date_iso' },
    { label: t('fieldMapper.formatOptions.dateUs'), value: 'date_us' },
    { label: t('fieldMapper.formatOptions.dateEu'), value: 'date_eu' },
    { label: t('fieldMapper.formatOptions.datetime'), value: 'datetime' }
  ],
  status: [
    { label: t('fieldMapper.formatOptions.text'), value: 'text' },
    { label: t('fieldMapper.formatOptions.statusCode'), value: 'status_code' }
  ]
}))

// Initialize component
onMounted(async () => {
  // Load saved templates
  await loadTemplates()

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

// Saved templates
const savedTemplates = ref<any[]>([])
const selectedTemplate = ref('')

// Load saved templates
const loadTemplates = async () => {
  try {
    const templates = await $fetch('/api/templates')
    savedTemplates.value = templates as any[]
  } catch (error) {
    console.error('Failed to load templates:', error)
  }
}

// Apply a saved template
const applyTemplate = (templateId: string) => {
  const template = savedTemplates.value.find(t => t.id === templateId)
  if (!template) return

  // Convert array back to object format
  template.mappings.forEach((mapping: any) => {
    if (localMappings.value[mapping.sourceField]) {
      localMappings.value[mapping.sourceField] = {
        field: mapping.targetField,
        format: mapping.format
      }
    }
  })

  emit('update-mappings', localMappings.value)
}

// Save the current mapping template
const saveTemplateAction = async () => {
  if (!templateName.value) return

  try {
    // Determine source type from file name
    let sourceType = 'custom'
    if (currentFile.value.toLowerCase().includes('credit') || currentFile.value.toLowerCase().includes('card')) {
      sourceType = 'credit_card'
    } else if (currentFile.value.toLowerCase().includes('payment') || currentFile.value.toLowerCase().includes('gateway')) {
      sourceType = 'payment_gateway'
    } else if (currentFile.value.toLowerCase().includes('overseas')) {
      sourceType = 'overseas'
    }

    await $fetch('/api/templates', {
      method: 'POST',
      body: {
        name: templateName.value,
        sourceType,
        mappings: localMappings.value
      }
    })

    // Reload templates
    await loadTemplates()

    // Reset
    templateName.value = ''
    saveTemplate.value = false
  } catch (error) {
    console.error('Failed to save template:', error)
  }
}

// Continue to preview
const continueToPreview = () => {
  emit('update-mappings', localMappings.value)
  emit('continue')
}
</script>