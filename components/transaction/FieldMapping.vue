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

// Target field options for OMF (Japanese accounting style)
const translatedTargetFieldOptions = computed(() => [
  { label: '日付 (Date)', value: 'date' },
  { label: t('fieldMapper.typeField'), value: 'type' },
  { label: '金額 (Amount)', value: 'amount' },
  { label: '勘定科目 (Account Category)', value: 'accountCategoryName' },
  { label: '補助科目 (Sub Account)', value: 'subAccountCategoryName' },
  { label: '税区分 (Tax Category)', value: 'taxCategoryName' },
  { label: '税率 (Tax Rate)', value: 'taxRate' },
  { label: '仕入れ先 (Supplier)', value: 'supplierName' },
  { label: '顧客 (Customer)', value: 'customerName' },
  { label: '区分 (Transaction Category)', value: 'transactionCategoryName' },
  { label: '法人情報 (Company Info)', value: 'companyInfo' },
  { label: 'インボイス番号 (Invoice Number)', value: 'invoiceNumber' },
  { label: '領収書番号 (Receipt Number)', value: 'receiptNumber' },
  { label: '商品名 (Product Name)', value: 'productName' },
  { label: '商品価格 (Product Price)', value: 'productPrice' },
  { label: 'JANコード (JAN Code)', value: 'janCode' },
  { label: '参照番号 (Reference Number)', value: 'referenceNumber' },
  { label: '備考 (Notes)', value: 'notes' }
])

// Format options by field type (OMF style)
const translatedFormatOptions = computed(() => ({
  string: [
    { label: 'テキスト (Text)', value: 'text' },
    { label: 'メール (Email)', value: 'email' },
    { label: '電話番号 (Phone)', value: 'phone' }
  ],
  number: [
    { label: '数値 (Number)', value: 'number' },
    { label: '金額 (円)', value: 'currency_jpy' },
    { label: 'パーセント (%)', value: 'percentage' },
    { label: '小数 (Decimal)', value: 'decimal' }
  ],
  date: [
    { label: 'ISO形式 (YYYY-MM-DD)', value: 'date_iso' },
    { label: '日本形式 (YYYY/MM/DD)', value: 'date_jp' },
    { label: '日本形式 (YYYY年MM月DD日)', value: 'date_jp_kanji' },
    { label: '日時 (Datetime)', value: 'datetime' }
  ],
  type: [
    { label: 'テキスト (Text)', value: 'text' },
    { label: t('fieldMapper.typeCode'), value: 'type_code' }
  ]
}))

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

// Generate sample data for the selected file (OMF style)
const generateSampleData = () => {
  // In a real app, this would load data from the file
  // For this example, we'll generate some mock data

  const file = props.files.find(f => f.name === currentFile.value)

  if (!file) return

  // Determine fields based on the file type (OMF Japanese accounting)
  let fields = []

  if (file.name.toLowerCase().includes('経費') || file.name.toLowerCase().includes('expense')) {
    fields = ['日付', '金額', '勘定科目', '税区分', '仕入れ先', '備考']
  } else if (file.name.toLowerCase().includes('売上') || file.name.toLowerCase().includes('sales')) {
    fields = ['日付', '金額', '勘定科目', '顧客', '税区分', 'インボイス番号']
  } else if (file.name.toLowerCase().includes('仕入') || file.name.toLowerCase().includes('purchase')) {
    fields = ['日付', '金額', '勘定科目', '仕入れ先', '商品名', '税区分']
  } else {
    // Default fields
    fields = ['日付', '区別', '金額', '勘定科目', '税区分', '仕入れ先', '備考']
  }

  // Generate sample data
  const data = []
  const accountCategories = ['消耗品費', '通信費', '交通費', '接待交際費', '広告宣伝費']
  const taxCategories = ['課税仕入', '課税仕入(軽減)', '非課税']
  const suppliers = ['株式会社ABC', '○○商店', 'XYZ株式会社']
  const customers = ['田中太郎', '鈴木花子', '山田商事']

  for (let i = 0; i < 10; i++) {
    const row = {}

    fields.forEach(field => {
      if (field === '日付' || field.includes('date')) {
        const date = new Date()
        date.setDate(date.getDate() - Math.floor(Math.random() * 30))
        row[field] = date.toISOString().split('T')[0]
      } else if (field === '金額' || field.includes('amount') || field.includes('price')) {
        row[field] = Math.floor(Math.random() * 50000 + 1000)
      } else if (field === '区別' || field.includes('type')) {
        row[field] = Math.random() > 0.5 ? '支出' : '入金'
      } else if (field === '勘定科目') {
        row[field] = accountCategories[Math.floor(Math.random() * accountCategories.length)]
      } else if (field === '税区分') {
        row[field] = taxCategories[Math.floor(Math.random() * taxCategories.length)]
      } else if (field === '仕入れ先') {
        row[field] = suppliers[Math.floor(Math.random() * suppliers.length)]
      } else if (field === '顧客') {
        row[field] = customers[Math.floor(Math.random() * customers.length)]
      } else if (field === 'インボイス番号') {
        row[field] = `T${1000000000000 + i}`
      } else if (field === '商品名') {
        row[field] = `商品${i + 1}`
      } else if (field === '備考') {
        row[field] = `サンプル備考${i + 1}`
      } else {
        row[field] = `値${i}`
      }
    })

    data.push(row)
  }

  sampleData.value = data
}

// Initialize mappings for fields (OMF style)
const initializeMappings = () => {
  sourceFields.value.forEach(field => {
    if (!localMappings.value[field]) {
      // Auto-map based on field name (Japanese and English)
      let targetField = null
      let format = 'text'

      const lowerField = field.toLowerCase()

      if (field === '日付' || lowerField.includes('date')) {
        targetField = 'date'
        format = 'date_iso'
      } else if (field === '区別' || lowerField.includes('type')) {
        targetField = 'type'
        format = 'type_code'
      } else if (field === '金額' || lowerField.includes('amount') || lowerField.includes('total')) {
        targetField = 'amount'
        format = 'currency_jpy'
      } else if (field === '勘定科目' || lowerField.includes('account')) {
        targetField = 'accountCategoryName'
        format = 'text'
      } else if (field === '補助科目' || lowerField.includes('sub')) {
        targetField = 'subAccountCategoryName'
        format = 'text'
      } else if (field === '税区分' || lowerField.includes('tax')) {
        targetField = 'taxCategoryName'
        format = 'text'
      } else if (field === '税率' || lowerField.includes('rate')) {
        targetField = 'taxRate'
        format = 'percentage'
      } else if (field === '仕入れ先' || lowerField.includes('supplier') || lowerField.includes('vendor')) {
        targetField = 'supplierName'
        format = 'text'
      } else if (field === '顧客' || lowerField.includes('customer')) {
        targetField = 'customerName'
        format = 'text'
      } else if (field === '法人情報' || lowerField.includes('company')) {
        targetField = 'companyInfo'
        format = 'text'
      } else if (field === 'インボイス番号' || lowerField.includes('invoice')) {
        targetField = 'invoiceNumber'
        format = 'text'
      } else if (field === '領収書番号' || lowerField.includes('receipt')) {
        targetField = 'receiptNumber'
        format = 'text'
      } else if (field === '商品名' || lowerField.includes('product')) {
        targetField = 'productName'
        format = 'text'
      } else if (field === '商品価格' || lowerField.includes('price')) {
        targetField = 'productPrice'
        format = 'currency_jpy'
      } else if (field === 'JANコード' || lowerField.includes('jan') || lowerField.includes('barcode')) {
        targetField = 'janCode'
        format = 'text'
      } else if (field === '参照番号' || lowerField.includes('reference')) {
        targetField = 'referenceNumber'
        format = 'text'
      } else if (field === '備考' || lowerField.includes('note') || lowerField.includes('memo')) {
        targetField = 'notes'
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

// Get the field type based on the field name or sample value (OMF style)
const getFieldType = (field) => {
  const sampleValue = getSampleValue(field)
  const lowerField = field.toLowerCase()

  if (field === '日付' || lowerField.includes('date')) {
    return 'date'
  } else if (field === '区別' || lowerField.includes('type')) {
    return 'type'
  } else if (field === '金額' || field === '税率' || field === '商品価格' ||
             lowerField.includes('amount') || lowerField.includes('price') ||
             lowerField.includes('total') || lowerField.includes('rate')) {
    return 'number'
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