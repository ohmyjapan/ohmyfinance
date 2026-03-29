<template>
  <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm">
    <div class="p-6">
      <div class="mb-6">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">{{ t('dataPreview.title') }}</h2>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          {{ t('dataPreview.description') }}
        </p>
      </div>

      <!-- Data Stats -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <!-- Total Records -->
        <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
              <Database class="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">{{ t('dataPreview.totalRecords') }}</p>
              <p class="text-2xl font-bold font-mono text-gray-900 dark:text-white">{{ stats.totalRecords }}</p>
            </div>
          </div>
        </div>

        <!-- Valid Records -->
        <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center flex-shrink-0">
              <CheckCircle class="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">{{ t('dataPreview.validRecords') }}</p>
              <p class="text-2xl font-bold font-mono text-green-600 dark:text-green-400">{{ stats.validRecords }}</p>
            </div>
          </div>
        </div>

        <!-- Warning Records -->
        <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
              <AlertTriangle class="w-6 h-6 text-amber-600 dark:text-amber-400" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">{{ t('dataPreview.warningRecords') }}</p>
              <p class="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">{{ stats.warningRecords }}</p>
            </div>
          </div>
        </div>

        <!-- Invalid Records -->
        <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center flex-shrink-0">
              <XCircle class="w-6 h-6 text-red-600 dark:text-red-400" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">{{ t('dataPreview.invalidRecords') }}</p>
              <p class="text-2xl font-bold font-mono text-red-600 dark:text-red-400">{{ stats.invalidRecords }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Table Controls -->
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3">
          <div class="relative">
            <select
                v-model="filter.recordType"
                class="block w-full pl-3 pr-10 py-2.5 text-sm border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-main focus:border-primary-main rounded-xl transition-colors touch-manipulation"
            >
              <option value="all">{{ t('dataPreview.allRecords') }}</option>
              <option value="valid">{{ t('dataPreview.validOnly') }}</option>
              <option value="warning">{{ t('dataPreview.warningOnly') }}</option>
              <option value="invalid">{{ t('dataPreview.invalidOnly') }}</option>
            </select>
            <div class="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none">
              <ChevronDown class="h-4 w-4 text-gray-400" />
            </div>
          </div>
          <button
              class="inline-flex items-center px-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.07] transition-all duration-200 touch-manipulation"
              @click="isFilterOpen = !isFilterOpen"
          >
            <Filter class="mr-2 h-4 w-4" />
            {{ t('common.filter') }}
          </button>
        </div>
        <div>
          <button
              class="inline-flex items-center px-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.07] transition-all duration-200 touch-manipulation"
              @click="exportPreview"
          >
            <Download class="mr-2 h-4 w-4" />
            {{ t('dataPreview.exportPreview') }}
          </button>
        </div>
      </div>

      <!-- Additional Filters (conditionally shown) -->
      <div v-if="isFilterOpen" class="mb-4 p-4 border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('dataPreview.dateRange') }}</label>
            <select
                v-model="filter.dateRange"
                class="block w-full border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 dark:text-gray-200 rounded-xl shadow-sm focus:ring-2 focus:ring-primary-main focus:border-primary-main text-sm py-2.5 px-3 transition-colors touch-manipulation"
            >
              <option value="">{{ t('dataPreview.allDates') }}</option>
              <option value="last30">{{ t('dataPreview.last30Days') }}</option>
              <option value="last90">{{ t('dataPreview.last90Days') }}</option>
              <option value="thisYear">{{ t('dataPreview.thisYear') }}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('dataPreview.amountRange') }}</label>
            <div class="flex gap-2">
              <input
                  v-model="filter.minAmount"
                  type="number"
                  min="0"
                  :placeholder="t('dataPreview.min')"
                  class="block w-full border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 dark:text-gray-200 rounded-xl shadow-sm focus:ring-2 focus:ring-primary-main focus:border-primary-main text-sm py-2.5 px-3 transition-colors"
              />
              <input
                  v-model="filter.maxAmount"
                  type="number"
                  min="0"
                  :placeholder="t('dataPreview.max')"
                  class="block w-full border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 dark:text-gray-200 rounded-xl shadow-sm focus:ring-2 focus:ring-primary-main focus:border-primary-main text-sm py-2.5 px-3 transition-colors"
              />
            </div>
          </div>
          <div class="flex items-end">
            <button
                class="inline-flex items-center px-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.07] transition-all duration-200 touch-manipulation"
                @click="resetFilters"
            >
              {{ t('dataPreview.resetFilters') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Data Preview Table -->
      <div class="border border-gray-200 dark:border-white/10 rounded-xl overflow-x-auto mb-6">
        <table class="min-w-full divide-y divide-gray-200 dark:divide-white/10">
          <thead class="bg-gray-50 dark:bg-white/5">
          <tr>
            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {{ t('common.status') }}
            </th>
            <th
                v-for="field in previewFields"
                :key="field"
                scope="col"
                class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
            >
              {{ field }}
            </th>
          </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-white/5">
          <tr
              v-for="(row, index) in filteredData"
              :key="index"
              :class="getRowClass(row)"
              class="hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors"
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
              <div class="text-sm" :class="field === 'status' ? getStatusClass(row[field]) : 'text-gray-900 dark:text-gray-100'">
                {{ formatFieldValue(field, row[field]) }}
              </div>
            </td>
          </tr>

          <!-- Empty state -->
          <tr v-if="filteredData.length === 0">
            <td :colspan="previewFields.length + 1" class="px-6 py-12 text-center">
              <Database class="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
              <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">{{ t('dataPreview.noRecordsFound') }}</p>
            </td>
          </tr>
          </tbody>
        </table>
      </div>

      <!-- Validation Summary -->
      <div v-if="stats.warningRecords > 0 || stats.invalidRecords > 0"
           class="mb-6 rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-500/10 p-4">
        <h3 class="text-sm font-medium text-amber-800 dark:text-amber-300 mb-2">{{ t('dataPreview.validationWarnings') }}</h3>
        <ul class="text-sm text-amber-700 dark:text-amber-400 space-y-1">
          <li v-if="validationIssues.missingEmails > 0" class="flex items-start">
            <AlertCircle class="h-4 w-4 text-amber-500 mr-2 mt-0.5 flex-shrink-0" />
            <span>{{ t('dataPreview.missingEmails', { count: validationIssues.missingEmails }) }}</span>
          </li>
          <li v-if="validationIssues.missingStatus > 0" class="flex items-start">
            <AlertCircle class="h-4 w-4 text-amber-500 mr-2 mt-0.5 flex-shrink-0" />
            <span>{{ t('dataPreview.missingStatus', { count: validationIssues.missingStatus }) }}</span>
          </li>
          <li v-if="validationIssues.outOfRangeDates > 0" class="flex items-start">
            <AlertCircle class="h-4 w-4 text-amber-500 mr-2 mt-0.5 flex-shrink-0" />
            <span>{{ t('dataPreview.outOfRangeDates', { count: validationIssues.outOfRangeDates }) }}</span>
          </li>
        </ul>
      </div>

      <!-- Action Buttons -->
      <div class="flex justify-between">
        <button
            class="inline-flex items-center px-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.07] transition-all duration-200 touch-manipulation"
            @click="$emit('back')"
        >
          {{ t('dataPreview.backToMapping') }}
        </button>
        <div class="flex gap-3">
          <button
              class="inline-flex items-center px-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.07] transition-all duration-200 touch-manipulation"
              @click="processData"
          >
            <RefreshCw class="mr-2 h-4 w-4" />
            {{ t('dataPreview.refreshPreview') }}
          </button>
          <button
              class="inline-flex items-center px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main shadow-lg shadow-primary-main/25 transition-all duration-300 touch-manipulation"
              @click="$emit('continue')"
          >
            {{ t('dataPreview.continueToImport') }}
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
  AlertTriangle,
  XCircle,
  RefreshCw,
  ArrowRight,
  Database
} from 'lucide-vue-next'

const { t, locale } = useI18n()

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

  let data = [...props.parsedData]

  if (data.length === 0) return

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
      if (mapping && mapping.field && mapping.field !== '' && mapping.field !== 'null') {
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

// Export preview data as CSV
const exportPreview = () => {
  if (filteredData.value.length === 0) return

  const fields = previewFields.value
  const csvRows = [fields.join(',')]

  filteredData.value.forEach(row => {
    const values = fields.map(field => {
      const val = row[field] ?? ''
      const str = String(val)
      // Quote fields containing commas, quotes, or newlines
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"'
      }
      return str
    })
    csvRows.push(values.join(','))
  })

  const bom = '\uFEFF' // UTF-8 BOM for Excel compatibility
  const blob = new Blob([bom + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `preview-export-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// Get CSS class for a row based on its status
const getRowClass = (row) => {
  if (row._status === 'warning') return 'bg-yellow-50 dark:bg-yellow-500/5'
  if (row._status === 'invalid') return 'bg-red-50 dark:bg-red-500/5'
  return ''
}

// Get CSS class for a field based on its validation status
const getFieldClass = (row, field) => {
  // Highlight specific fields with issues
  if (field === 'customer_email' && row._issues?.includes('invalid_email')) {
    return 'text-yellow-800 dark:text-yellow-400'
  }
  if (field === 'transaction_status' && row._issues?.includes('missing_status')) {
    return 'text-yellow-800 dark:text-yellow-400'
  }
  if (field === 'transaction_date' && row._issues?.includes('date_out_of_range')) {
    return 'text-yellow-800 dark:text-yellow-400'
  }

  return 'text-gray-500 dark:text-gray-400'
}

// Get CSS class for status field
const getStatusClass = (status) => {
  if (!status) return 'text-gray-500 dark:text-gray-400'

  const statusLower = status.toLowerCase()
  if (statusLower.includes('complete') || statusLower.includes('success')) {
    return 'inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-lg bg-green-500/10 text-green-600 dark:text-green-400'
  } else if (statusLower.includes('pending') || statusLower.includes('await')) {
    return 'inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
  } else if (statusLower.includes('process') || statusLower.includes('progress')) {
    return 'inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400'
  } else if (statusLower.includes('fail') || statusLower.includes('error') || statusLower.includes('decline')) {
    return 'inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-lg bg-red-500/10 text-red-600 dark:text-red-400'
  }

  return 'inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-lg bg-gray-500/10 text-gray-600 dark:text-gray-400'
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

// Format currency (locale-aware)
const formatCurrency = (value) => {
  const num = parseFloat(value)
  if (isNaN(num)) return value

  const currencyLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  const currency = locale.value === 'ko' ? 'KRW' : 'JPY'

  return new Intl.NumberFormat(currencyLocale, {
    style: 'currency',
    currency: currency,
    maximumFractionDigits: 0
  }).format(num)
}

// Format date (locale-aware)
const formatDate = (value) => {
  try {
    const date = new Date(value)
    const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
    return date.toLocaleDateString(dateLocale, {
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
</script>
