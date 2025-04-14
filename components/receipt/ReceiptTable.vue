<template>
  <div class="overflow-x-auto">
    <table class="min-w-full divide-y divide-gray-200">
      <thead class="bg-gray-50">
      <tr>
        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
          Receipt
        </th>
        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
          Date Uploaded
        </th>
        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
          Amount
        </th>
        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
          Merchant
        </th>
        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
          Status
        </th>
        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
          Actions
        </th>
      </tr>
      </thead>
      <tbody class="bg-white divide-y divide-gray-200">
      <tr v-for="receipt in receipts" :key="receipt.id" class="hover:bg-gray-50">
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="flex items-center">
            <div class="h-10 w-10 flex-shrink-0 bg-gray-100 rounded">
              <div class="h-10 w-10 flex items-center justify-center text-gray-500">
                <FileIcon :filename="receipt.filename" />
              </div>
            </div>
            <div class="ml-4">
              <div class="text-sm font-medium text-gray-900">{{ receipt.filename }}</div>
              <div class="text-sm text-gray-500">{{ formatFileSize(receipt.size) }}</div>
            </div>
          </div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="text-sm text-gray-900">{{ formatDate(receipt.uploadDate) }}</div>
          <div class="text-sm text-gray-500">{{ formatTime(receipt.uploadDate) }}</div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="text-sm text-gray-900" v-if="receipt.amount">
            {{ formatCurrency(receipt.amount) }}
          </div>
          <div class="text-sm text-gray-500" v-else>--</div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="text-sm text-gray-900" v-if="receipt.merchant">
            {{ receipt.merchant }}
          </div>
          <div class="text-sm text-gray-500" v-else>--</div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
            <span v-if="receipt.status === 'matched'"
                  class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
              <CheckCircle size="14" class="mr-1" />
              Matched
            </span>
          <span v-else
                class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">
              <AlertTriangle size="14" class="mr-1" />
              Unmatched
            </span>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          <button
              @click="$emit('view', receipt.id)"
              class="text-purple-600 hover:text-purple-900 mr-3"
          >
            View
          </button>
          <button
              v-if="receipt.status === 'unmatched'"
              @click="$emit('match', receipt.id)"
              class="text-purple-600 hover:text-purple-900 mr-3"
          >
            Match
          </button>
          <button
              @click="confirmDelete(receipt.id)"
              class="text-red-600 hover:text-red-900"
          >
            Delete
          </button>
        </td>
      </tr>

      <!-- Empty state -->
      <tr v-if="receipts.length === 0">
        <td colspan="6" class="px-6 py-12 text-center">
          <FileText size="40" class="text-gray-300 mx-auto mb-3" />
          <p class="text-gray-500 text-sm">No receipts found</p>
        </td>
      </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { FileText, CheckCircle, AlertTriangle } from 'lucide-vue-next'

const props = defineProps({
  receipts: {
    type: Array,
    required: true
  }
})

const emit = defineEmits(['view', 'match', 'delete'])

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

// Format time
const formatTime = (isoDate: string) => {
  return new Date(isoDate).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

// Format currency
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount)
}

// Confirm delete
const confirmDelete = (receiptId: string) => {
  if (confirm('Are you sure you want to delete this receipt?')) {
    emit('delete', receiptId)
  }
}

// Component to display appropriate icon based on file type
const FileIcon = defineComponent({
  props: {
    filename: {
      type: String,
      required: true
    }
  },
  setup(props) {
    const extension = computed(() => {
      const parts = props.filename.split('.')
      return parts[parts.length - 1].toLowerCase()
    })

    return () => {
      // Choose icon based on file extension
      switch (extension.value) {
        case 'pdf':
          return h(FileText, { size: 20 })
        case 'jpg':
        case 'jpeg':
        case 'png':
          return h(Image, { size: 20 })
        default:
          return h(FileText, { size: 20 })
      }
    }
  }
})
</script>