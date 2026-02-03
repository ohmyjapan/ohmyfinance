<template>
  <div>
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-gray-800 dark:text-gray-100">{{ t('audit.title') }}</h1>
      <p class="text-gray-600 dark:text-gray-400">{{ t('audit.description') }}</p>
    </header>

    <!-- Filters -->
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 mb-6">
      <div class="flex flex-wrap gap-4">
        <select v-model="filters.entityType" class="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md px-3 py-2 text-sm">
          <option value="">{{ t('audit.allTypes') }}</option>
          <option value="transaction">{{ t('nav.transactions') }}</option>
          <option value="receipt">{{ t('nav.receipts') }}</option>
          <option value="recurring">{{ t('nav.recurringPayments') }}</option>
          <option value="category">{{ t('common.category') }}</option>
          <option value="template">{{ t('audit.templates') }}</option>
          <option value="settings">{{ t('nav.settings') }}</option>
        </select>
        <select v-model="filters.action" class="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md px-3 py-2 text-sm">
          <option value="">{{ t('audit.allActions') }}</option>
          <option value="create">{{ t('common.create') }}</option>
          <option value="update">{{ t('audit.update') }}</option>
          <option value="delete">{{ t('common.delete') }}</option>
          <option value="import">{{ t('common.import') }}</option>
          <option value="export">{{ t('common.export') }}</option>
          <option value="backup">{{ t('audit.backup') }}</option>
          <option value="restore">{{ t('audit.restore') }}</option>
        </select>
        <input v-model="filters.dateFrom" type="date" class="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md px-3 py-2 text-sm" />
        <input v-model="filters.dateTo" type="date" class="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md px-3 py-2 text-sm" />
        <button @click="loadLogs" class="px-4 py-2 bg-purple-600 text-white rounded-md text-sm hover:bg-purple-700">
          {{ t('common.filter') }}
        </button>
      </div>
    </div>

    <!-- Log Table -->
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden">
      <div v-if="isLoading" class="p-8 text-center text-gray-500">{{ t('common.loading') }}</div>
      <div v-else-if="logs.length === 0" class="p-8 text-center text-gray-500">{{ t('audit.noLogs') }}</div>
      <table v-else class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead class="bg-gray-50 dark:bg-gray-700">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('audit.timestamp') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('audit.action') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('common.type') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('audit.entity') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('audit.changes') }}</th>
          </tr>
        </thead>
        <tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
          <tr v-for="log in logs" :key="log.id" class="hover:bg-gray-50 dark:hover:bg-gray-700">
            <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {{ formatDateTime(log.timestamp) }}
            </td>
            <td class="px-6 py-4">
              <span :class="getActionClass(log.action)" class="px-2 py-1 text-xs font-medium rounded-full capitalize">
                {{ log.action }}
              </span>
            </td>
            <td class="px-6 py-4 text-sm text-gray-700 dark:text-gray-300 capitalize">
              {{ log.entityType }}
            </td>
            <td class="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
              {{ log.entityName || log.entityId || '-' }}
            </td>
            <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
              <span v-if="log.changes && log.changes.length > 0">
                {{ t('audit.fieldsChanged', { count: log.changes.length }) }}
              </span>
              <span v-else>-</span>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Pagination -->
      <div v-if="pagination.totalPages > 1" class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div class="text-sm text-gray-500 dark:text-gray-400">
          {{ t('audit.pageInfo', { page: pagination.page, totalPages: pagination.totalPages, total: pagination.total }) }}
        </div>
        <div class="flex space-x-2">
          <button
            @click="changePage(pagination.page - 1)"
            :disabled="pagination.page === 1"
            class="px-3 py-1 border dark:border-gray-600 rounded text-sm disabled:opacity-50 dark:text-gray-300"
          >
            {{ t('common.previous') }}
          </button>
          <button
            @click="changePage(pagination.page + 1)"
            :disabled="pagination.page === pagination.totalPages"
            class="px-3 py-1 border dark:border-gray-600 rounded text-sm disabled:opacity-50 dark:text-gray-300"
          >
            {{ t('common.next') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'

const { t, locale } = useI18n()
const isLoading = ref(false)
const logs = ref<any[]>([])
const pagination = ref({ page: 1, limit: 50, total: 0, totalPages: 1 })

const filters = reactive({
  entityType: '',
  action: '',
  dateFrom: '',
  dateTo: ''
})

const loadLogs = async () => {
  isLoading.value = true
  try {
    const params = new URLSearchParams({ page: pagination.value.page.toString() })
    if (filters.entityType) params.set('entityType', filters.entityType)
    if (filters.action) params.set('action', filters.action)
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
    if (filters.dateTo) params.set('dateTo', filters.dateTo)

    const data = await $fetch(`/api/audit?${params.toString()}`)
    logs.value = data.logs
    pagination.value = data.pagination
  } catch (error) {
    console.error('Failed to load audit logs:', error)
  } finally {
    isLoading.value = false
  }
}

const changePage = (page: number) => {
  pagination.value.page = page
  loadLogs()
}

const formatDateTime = (dateStr: string) => {
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(dateStr).toLocaleString(dateLocale)
}

const getActionClass = (action: string) => {
  const classes: Record<string, string> = {
    create: 'bg-green-100 text-green-700',
    update: 'bg-blue-100 text-blue-700',
    delete: 'bg-red-100 text-red-700',
    import: 'bg-purple-100 text-purple-700',
    export: 'bg-yellow-100 text-yellow-700',
    backup: 'bg-indigo-100 text-indigo-700',
    restore: 'bg-pink-100 text-pink-700'
  }
  return classes[action] || 'bg-gray-100 text-gray-700'
}

onMounted(() => loadLogs())
</script>
