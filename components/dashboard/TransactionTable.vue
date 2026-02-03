<template>
  <div class="overflow-x-auto">
    <table class="w-full">
      <thead>
      <tr class="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
        <th class="px-6 py-3 border-b">{{ t('dashboard.transactionId') }}</th>
        <th class="px-6 py-3 border-b">{{ t('dashboard.source') }}</th>
        <th class="px-6 py-3 border-b">{{ t('dashboard.amount') }}</th>
        <th class="px-6 py-3 border-b">{{ t('dashboard.date') }}</th>
        <th class="px-6 py-3 border-b">{{ t('dashboard.status') }}</th>
        <th class="px-6 py-3 border-b">{{ t('dashboard.actions') }}</th>
      </tr>
      </thead>
      <tbody class="divide-y">
      <tr
          v-for="transaction in transactions"
          :key="transaction.id"
          class="hover:bg-gray-50"
      >
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="text-sm font-medium text-gray-800">#{{ transaction.id }}</div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="text-sm text-gray-700">{{ transaction.source }}</div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="text-sm text-gray-700">{{ transaction.amount }}</div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="text-sm text-gray-700">{{ transaction.date }}</div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
            <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full"
                  :class="statusClasses[transaction.status]">
              {{ t(`status.${transaction.status}`) }}
            </span>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm">
          <button class="text-gray-500 hover:text-gray-700" @click="viewDetails(transaction.id)">
            <MoreVertical size="16" />
          </button>
        </td>
      </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { MoreVertical } from 'lucide-vue-next'

const { t } = useI18n()

const props = defineProps({
  transactions: {
    type: Array,
    required: true
  }
})

// Status badge classes based on status
const statusClasses = {
  completed: 'bg-green-100 text-green-800',
  pending: 'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
  failed: 'bg-red-100 text-red-800'
}

// Method to navigate to transaction details
const router = useRouter()
const viewDetails = (id: string) => {
  router.push(`/transactions/${id}`)
}
</script>
