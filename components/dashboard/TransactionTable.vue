<template>
  <div class="overflow-x-auto">
    <table class="w-full">
      <thead>
      <tr class="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        <th class="px-6 py-3 border-b border-gray-200 dark:border-white/10">{{ t('dashboard.transactionId') }}</th>
        <th class="px-6 py-3 border-b border-gray-200 dark:border-white/10">{{ t('dashboard.source') }}</th>
        <th class="px-6 py-3 border-b border-gray-200 dark:border-white/10">{{ t('dashboard.amount') }}</th>
        <th class="px-6 py-3 border-b border-gray-200 dark:border-white/10">{{ t('dashboard.date') }}</th>
        <th class="px-6 py-3 border-b border-gray-200 dark:border-white/10">{{ t('dashboard.status') }}</th>
        <th class="px-6 py-3 border-b border-gray-200 dark:border-white/10">{{ t('dashboard.actions') }}</th>
      </tr>
      </thead>
      <tbody class="divide-y divide-gray-200 dark:divide-white/10">
      <tr
          v-for="transaction in transactions"
          :key="transaction.id"
          class="hover:bg-gray-50 dark:hover:bg-white/[0.07] transition"
      >
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="text-sm font-medium font-mono text-gray-800 dark:text-gray-200">#{{ transaction.id }}</div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="text-sm text-gray-700 dark:text-gray-300">{{ transaction.source }}</div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="text-sm font-mono text-gray-700 dark:text-gray-300">{{ transaction.amount }}</div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="text-sm text-gray-700 dark:text-gray-300">{{ transaction.date }}</div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
            <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full"
                  :class="statusClasses[transaction.status]">
              {{ t(`status.${transaction.status}`) }}
            </span>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm">
          <button class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" @click="viewDetails(transaction.id)">
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
const statusClasses: Record<string, string> = {
  completed: 'bg-green-500/20 text-green-800 dark:text-green-400',
  pending: 'bg-yellow-500/20 text-yellow-800 dark:text-yellow-400',
  processing: 'bg-blue-500/20 text-blue-800 dark:text-blue-400',
  failed: 'bg-red-500/20 text-red-800 dark:text-red-400'
}

// Method to navigate to transaction details
const router = useRouter()
const viewDetails = (id: string) => {
  router.push(`/transactions/${id}`)
}
</script>
