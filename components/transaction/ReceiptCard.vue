<template>
  <div class="bg-white rounded-lg shadow overflow-hidden">
    <div class="px-6 py-4 border-b">
      <h3 class="text-lg font-medium text-gray-800">Receipt</h3>
    </div>
    <div class="p-6">
      <!-- If there's a receipt attached -->
      <div v-if="receipt" class="space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center">
            <div class="h-10 w-10 flex-shrink-0 bg-purple-100 rounded">
              <div class="h-10 w-10 flex items-center justify-center text-purple-600">
                <FileText size="20" />
              </div>
            </div>
            <div class="ml-4">
              <p class="text-sm font-medium text-gray-900">{{ receipt.filename }}</p>
              <p class="text-xs text-gray-500">{{ formatFileSize(receipt.size) }}</p>
            </div>
          </div>
          <div>
            <button class="text-gray-400 hover:text-gray-600 p-1">
              <Download size="18" />
            </button>
          </div>
        </div>

        <div class="border border-gray-200 rounded-lg p-4">
          <div class="text-sm text-gray-600 mb-2">Receipt Information</div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <p class="text-xs text-gray-500">Date</p>
              <p class="text-sm font-medium">{{ formatDate(receipt.date) }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Amount</p>
              <p class="text-sm font-medium">{{ formatCurrency(receipt.amount) }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Merchant</p>
              <p class="text-sm font-medium">{{ receipt.merchant }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Status</p>
              <p class="text-sm font-medium text-green-600">Verified</p>
            </div>
          </div>
        </div>

        <div class="flex justify-end">
          <button class="text-sm text-purple-600 hover:text-purple-700">
            View Full Receipt
          </button>
        </div>
      </div>

      <!-- If no receipt is attached -->
      <div v-else>
        <div class="flex flex-col items-center justify-center bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-6 mb-4">
          <div class="text-center">
            <FileText size="36" class="mx-auto text-gray-400" />
            <p class="mt-2 text-sm font-medium text-gray-900">No receipt uploaded yet</p>
            <p class="mt-1 text-xs text-gray-500">Upload a receipt to match with this transaction</p>
          </div>
          <button
              class="mt-4 inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
              @click="navigateToReceiptUpload"
          >
            <Upload size="16" class="mr-2" />
            Upload Receipt
          </button>
        </div>
        <p class="text-xs text-gray-500 text-center">Supported formats: PDF, JPG, PNG (max 10MB)</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Upload, FileText, Download } from 'lucide-vue-next'

const props = defineProps({
  receipt: {
    type: Object,
    default: null
  },
  transactionId: {
    type: String,
    required: true
  }
})

const router = useRouter()

// Navigate to receipt upload page with transaction ID
const navigateToReceiptUpload = () => {
  router.push({
    path: '/receipts/upload',
    query: { transactionId: props.transactionId }
  })
}

// Format file size
const formatFileSize = (bytes: number) => {
  if (bytes < 1024) {
    return bytes + ' B'
  } else if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + ' KB'
  } else {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }
}

// Format date
const formatDate = (isoDate: string) => {
  return new Date(isoDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

// Format currency
const formatCurrency = (amount: number, currency = 'USD') => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency
  }).format(amount)
}
</script>