<template>
  <div class="bg-white rounded-lg shadow-sm">
    <div class="p-6">
      <div class="mb-6">
        <h2 class="text-lg font-medium text-gray-900 mb-2">Preview Processed Data</h2>
        <p class="text-sm text-gray-600">
          Review how your data will appear in the system after import. You can make adjustments
          to field mappings if needed before finalizing the import.
        </p>
      </div>

      <!-- Data Stats -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div class="bg-gray-50 rounded-lg p-4 border border-gray-200">
          <div class="text-sm font-medium text-gray-500 mb-1">Total Records</div>
          <div class="text-2xl font-semibold text-gray-900">{{ stats.totalRecords }}</div>
        </div>
        <div class="bg-gray-50 rounded-lg p-4 border border-gray-200">
          <div class="text-sm font-medium text-gray-500 mb-1">Valid Records</div>
          <div class="text-2xl font-semibold text-green-600">{{ stats.validRecords }}</div>
        </div>
        <div class="bg-gray-50 rounded-lg p-4 border border-gray-200">
          <div class="text-sm font-medium text-gray-500 mb-1">Records with Warnings</div>
          <div class="text-2xl font-semibold text-yellow-600">{{ stats.warningRecords }}</div>
        </div>
        <div class="bg-gray-50 rounded-lg p-4 border border-gray-200">
          <div class="text-sm font-medium text-gray-500 mb-1">Invalid Records</div>
          <div class="text-2xl font-semibold text-gray-900">{{ stats.invalidRecords }}</div>
        </div>
      </div>

      <!-- Table Controls -->
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center space-x-3">
          <div class="relative">
            <select
                v-model="filter.recordType"
                class="block w-full pl-3 pr-10 py-2 text-sm border-gray-300 focus:outline-none focus:ring-purple-500 focus:border-purple-500 rounded-md"
            >
              <option value="all">All Records</option>
              <option value="valid">Valid Records Only</option>
              <option value="warning">Records with Warnings</option>
              <option value="invalid">Invalid Records</option>
            </select>
            <div class="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
              <ChevronDown class="h-4 w-4 text-gray-400" />
            </div>
          </div>
          <button
              class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
              @click="isFilterOpen = !isFilterOpen"
          >
            <Filter class="mr-2 h-4 w-4" />
            Filter
          </button>
        </div>
        <div>
          <button
              class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
          >
            <Download class="mr-2 h-4 w-4" />
            Export Preview
          </button>
        </div>
      </div>

      <!-- Additional Filters (conditionally shown) -->
      <div v-if="isFilterOpen" class="mb-4 p-4 border border-gray-200 rounded-lg bg-gray-50">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Date Range</label>
            <select
                v-model="filter.dateRange"
                class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
            >
              <option value="">All Dates</option>
              <option value="last30">Last 30 Days</option>
              <option value="last90">Last 90 Days</option>
              <option value="thisYear">This Year</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Amount Range</label>
            <div class="flex space-x-2">
              <input
                  v-model="filter.minAmount"
                  type="number"
                  min="0"
                  placeholder="Min"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
              />
              <input
                  v-model="filter.maxAmount"
                  type="number"
                  min="0"
                  placeholder="Max"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
              />
            </div>
          </div>
          <div class="flex items-end">
            <button
                class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                @click="resetFilters"
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      <!-- Data Preview Table -->
      <div class="border border-gray-200 rounded-lg overflow-x-auto mb-6">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
          <tr>
            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            <th
                v-for="field in previewFields"
                :key="field"
                scope="col"
                class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            >
              {{ field }}
            </th>
          </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
          <tr
              v-for="(row, index) in filteredData"
              :key="index"
              :class="getRowClass(row)"
          >
            <td class="px-4 py-4 whitespace-nowrap">
                <span class="flex-shrink-0 h-4 w-4">
                  <CheckCircle v-if="row._status === 'valid'" class="h-4 w-4 text-green-500" />
                  <AlertCircle v-else-if="row._status === 'warning'" class="h-4 w-4 text-yellow-500" />
                  <XCircle v-else class="h-4 w-4 text-red-500" />
                </span>
            </td>
            <td
                v-for="field in previewFields"
                :key="`${index}-${field}`"
                class="px-4 py-4 whitespace-nowrap"
                :class="getFieldClass(row, field)"
            >
              <div class="text-sm" :class="field === 'status' ? getStatusClass(row[field]) : 'text-gray-900'">
                {{ formatFieldValue(field, row[field]) }}
              </div>
            </td>
          </tr>

          <!-- Empty state -->
          <tr v-if="filteredData.length === 0">
            <td :colspan="previewFields.length + 1" class="px-6 py-12 text-center">
              <Database class="mx-auto h-10 w-10 text-gray-300" />
              <p class="mt-2 text-sm text-gray-500">No matching records found</p>
            </td>
          </tr>
          </tbody>
        </table>
      </div>

      <!-- Validation Summary -->
      <div v-if="stats.warningRecords > 0 || stats.invalidRecords > 0"
           class="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h3 class="text-sm font-medium text-yellow-800 mb-2">Data Validation Warnings</h3>
        <ul class="text-sm text-yellow-700 space-y-1">
          <li v-if="validationIssues.missingEmails > 0" class="flex items-start">
            <AlertCircle class="h-4 w-4 text-yellow-500 mr-2 mt-0.5" />
            <span>{{ validationIssues.missingEmails }} records have missing or invalid email addresses</span>
          </li>
          <li v-if="validationIssues.missingStatus > 0" class="flex items-start">
            <AlertCircle class="h-4 w-4 text-yellow-500 mr-2 mt-0.5" />
            <span>{{ validationIssues.missingStatus }} records have missing transaction status codes</span>
          </li>
          <li v-if="validationIssues.outOfRangeDates > 0" class="flex items-start">
            <AlertCircle class="h-4 w-4 text-yellow-500 mr-2 mt-0.5" />
            <span>{{ validationIssues.outOfRangeDates }} records have dates outside the expected range</span>
          </li>
        </ul>
      </div>

      <!-- Action Buttons -->
      <div class="flex justify-between">
        <button
            class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            @click="$emit('back')"
        >
          Back to Field Mapping
        </button>
        <div>
          <button
              class="mr-3 inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
          >
            <RefreshCw class="mr-2 h-4 w-4" />
            Refresh Preview
          </button>
          <button
              class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
              @click="$emit('continue')"
          >
            Continue to Import
            <ArrowRight class="ml-2 h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  ChevronDown,
  Filter,
  Download,
  CheckCircle,
  AlertCircle,
  XCircle,
  RefreshCw,
  ArrowRight,
  Database
} from 'lucide-vue-next'

const props = defineProps({
  files: {
    type: Array,
    required: true
  },
  mappings: {
    type: Object,
    required: true
  },
  parsedData: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update-data', 'back', 'continue'])

// State
const isFilterOpen = ref(false)
const filter = ref({
  recordType: 'all',
  dateRange: '',
  minAmount: '',
  maxAmount: ''
})

// Statistics
const stats = ref({
  totalRecords: 0,
  validRecords: 0,
  warningRecords: 0,
  invalidRecords: 0
})

// Validation issues summary
const validationIssues = ref({
  missingEmails: 0,
  missingStatus: 0,
  outOfRangeDates: 0
})

// Preview data
const previewData = ref([])

// Initialize component
onMounted(() => {
  // Process the data for preview
  processData()
})

// Fields to display in preview table (transformed)
const previewFields = computed(() => {
  if (previewData.value.length === 0) return []

  // Exclude internal fields starting with underscore
  return Object.keys(previewData.value[0]).filter(key => !key.startsWith('_'))
})

// Filtered data based on user filters
const filteredData = computed(() => {
  let result = [...previewData.value]

  // Apply record type filter
  if (filter.value.recordType !== 'all') {
    if (filter.value.recordType === 'valid') {
      result = result.filter(row => row._status === 'valid')
    } else if (filter.value.recordType === 'warning') {
      result = result.filter(row => row._status === 'warning')
    } else if (filter.value.recordType === 'invalid') {
      result = result.filter(row => row._status === 'invalid')
    }
  }

  // Apply date range filter if a date field exists
  if (filter.value.dateRange && result.length > 0) {
    const dateField = previewFields.value.find(f =>
        f.toLowerCase().includes('date') || f.toLowerCase().includes('time')
    )

    if (dateField) {
      const now = new Date()
      let cutoffDate = new Date()

      if (filter.value.dateRange === 'last30') {
        cutoffDate.setDate(now.getDate() - 30)
      } else if (filter.value.dateRange === 'last90') {
        cutoffDate.setDate(now.getDate() - 90)
      } else if (filter.value.dateRange === 'thisYear') {
        cutoffDate = new Date(now.getFullYear(), 0, 1) // January 1st of current year
      }

      result = result.filter(row => {
        const rowDate = new Date(row[dateField])
        return rowDate >= cutoffDate
      })
    }
  }

  // Apply amount filter if an amount field exists
  if ((filter.value.minAmount !== '' || filter.value.maxAmount !== '') && result.length > 0) {
    const amountField = previewFields.value.find(f =>
        f.toLowerCase().includes('amount') || f.toLowerCase().includes('price') ||
        f.toLowerCase().includes('total') || f.toLowerCase().includes('payment')
    )

    if (amountField) {
      if (filter.value.minAmount !== '') {
        const min = parseFloat(filter.value.minAmount)
        result = result.filter(row => parseFloat(row[amountField]) >= min)
      }

      if (filter.value.maxAmount !== '') {
        const max = parseFloat(filter.value.maxAmount)
        result = result.filter(row => parseFloat(row[amountField]) <= max)
      }
    }
  }

  return result
})

// Reset filters
const resetFilters = () => {
  filter.value = {
    recordType: 'all',
    dateRange: '',
    minAmount: '',
    maxAmount: ''
  }
}

// Process the raw data for preview
const processData = () => {
  // This would be more sophisticated in a real app
  // Here we're just adding validation status to each row

  // Start with the parsed data (or generate some if empty)
  let data = [...props.parsedData]

  if (data.length === 0) {
    // Generate mock data
    data = generateMockData()
  }

  // Reset validation counters
  validationIssues.value = {
    missingEmails: 0,
    missingStatus: 0,
    outOfRangeDates: 0
  }

  // Create a transformed dataset with mapped fields
  const transformed = data.map(row => {
    // Create a new row with transformed fields
    const newRow = {
      _status: 'valid', // default status
      _issues: [] // tracking issues for this row
    }

    // Map each source field to target field based on mappings
    Object.keys(props.mappings).forEach(sourceField => {
      const mapping = props.mappings[sourceField]
      if (mapping && mapping.field) {
        newRow[mapping.field] = row[sourceField]

        // Apply validation based on field type
        if (mapping.field === 'customer_email') {
          if (!row[sourceField] || !isValidEmail(row[sourceField])) {
            newRow._status = 'warning'
            newRow._issues.push('invalid_email')
            validationIssues.value.missingEmails++
          }
        } else if (mapping.field === 'transaction_status') {
          if (!row[sourceField]) {
            newRow._status = 'warning'
            newRow._issues.push('missing_status')
            validationIssues.value.missingStatus++
          }
        } else if (mapping.field === 'transaction_date') {
          const date = new Date(row[sourceField])
          const now = new Date()
          const oneYearAgo = new Date(now.setFullYear(now.getFullYear() - 1))

          if (isNaN(date.getTime()) || date < oneYearAgo) {
            newRow._status = 'warning'
            newRow._issues.push('date_out_of_range')
            validationIssues.value.outOfRangeDates++
          }
        }
      }
    })

    return newRow
  })

  // Update the preview data
  previewData.value = transformed

  // Update statistics
  stats.value = {
    totalRecords: transformed.length,
    validRecords: transformed.filter(row => row._status === 'valid').length,
    warningRecords: transformed.filter(row => row._status === 'warning').length,
    invalidRecords: transformed.filter(row => row._status === 'invalid').length
  }

  // Emit the transformed data for parent component
  emit('update-data', transformed)
}

// Generate mock data for preview
const generateMockData = () => {
  const data = []

  for (let i = 0; i < 50; i++) {
    const row = {}

    // Add some sample data
    Object.keys(props.mappings).forEach(sourceField => {
      if (sourceField.includes('id') || sourceField.includes('reference')) {
        row[sourceField] = `TRX-${10000 + i}`
      } else if (sourceField.includes('date')) {
        const date = new Date()
        date.setDate(date.getDate() - Math.floor(Math.random() * 30))
        row[sourceField] = date.toISOString().split('T')[0]
      } else if (sourceField.includes('amount') || sourceField.includes('total')) {
        row[sourceField] = (Math.random() * 1000 + 50).toFixed(2)
      } else if (sourceField.includes('currency')) {
        row[sourceField] = 'USD'
      } else if (sourceField.includes('email')) {
        // Add some "errors" for the warning records
        if (i < 6) {
          row[sourceField] = ''
        } else {
          row[sourceField] = `customer${i}@example.com`
        }
      } else if (sourceField.includes('status')) {
        const statuses = ['COMPLETED', 'PENDING', 'PROCESSING', 'FAILED']
        row[sourceField] = statuses[Math.floor(Math.random() * statuses.length)]
      } else if (sourceField.includes('country')) {
        const countries = ['USA', 'Canada', 'UK', 'Australia', 'Japan']
        row[sourceField] = countries[Math.floor(Math.random() * countries.length)]
      } else {
        row[sourceField] = `Value ${i}`
      }
    })

    data.push(row)
  }

  return data
}

// Get CSS class for a row based on its status
const getRowClass = (row) => {
  if (row._status === 'warning') return 'bg-yellow-50'
  if (row._status === 'invalid') return 'bg-red-50'
  return ''
}

// Get CSS class for a field based on its validation status
const getFieldClass = (row, field) => {
  // Highlight specific fields with issues
  if (field === 'customer_email' && row._issues?.includes('invalid_email')) {
    return 'text-yellow-800'
  }
  if (field === 'transaction_status' && row._issues?.includes('missing_status')) {
    return 'text-yellow-800'
  }
  if (field === 'transaction_date' && row._issues?.includes('date_out_of_range')) {
    return 'text-yellow-800'
  }

  return 'text-gray-500'
}

// Get CSS class for status field
const getStatusClass = (status) => {
  if (!status) return 'text-gray-500'

  const statusLower = status.toLowerCase()
  if (statusLower.includes('complete') || statusLower.includes('success')) {
    return 'inline-flex px-2 text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800'
  } else if (statusLower.includes('pending') || statusLower.includes('await')) {
    return 'inline-flex px-2 text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800'
  } else if (statusLower.includes('process') || statusLower.includes('progress')) {
    return 'inline-flex px-2 text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800'
  } else if (statusLower.includes('fail') || statusLower.includes('error') || statusLower.includes('decline')) {
    return 'inline-flex px-2 text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800'
  }

  return 'inline-flex px-2 text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800'
}

// Format a field value based on its type
const formatFieldValue = (field, value) => {
  if (value === undefined || value === null) return '--'

  if (field.includes('amount') || field.includes('total') || field.includes('price') || field.includes('payment')) {
    return formatCurrency(value)
  }

  if (field.includes('date')) {
    return formatDate(value)
  }

  return value
}

// Format currency
const formatCurrency = (value) => {
  const num = parseFloat(value)
  if (isNaN(num)) return value

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(num)
}

// Format date
const formatDate = (value) => {
  try {
    const date = new Date(value)
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  } catch (e) {
    return value
  }
}

// Validate email format
const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}