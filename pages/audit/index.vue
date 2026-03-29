<template>
  <div>
    <!-- Page Header -->
    <div class="mb-8">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('audit.title') }}</h1>
          <p class="mt-1 text-gray-500 dark:text-gray-400">{{ t('audit.description') }}</p>
        </div>
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10">
            <Activity class="h-4 w-4 text-primary-main dark:text-primary-light" />
            <span class="text-sm font-mono font-bold text-gray-900 dark:text-white">{{ pagination.total }}</span>
            <span class="text-sm text-gray-500 dark:text-gray-400">{{ t('audit.totalEntries') }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm p-4 mb-6">
      <div class="flex flex-wrap gap-3">
        <select
          v-model="filters.entityType"
          class="border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-primary-main/30 focus:border-primary-main transition-colors"
        >
          <option value="">{{ t('audit.allTypes') }}</option>
          <option value="transaction">{{ t('nav.transactions') }}</option>
          <option value="receipt">{{ t('nav.receipts') }}</option>
          <option value="recurring">{{ t('nav.recurringPayments') }}</option>
          <option value="category">{{ t('common.category') }}</option>
          <option value="template">{{ t('audit.templates') }}</option>
          <option value="settings">{{ t('nav.settings') }}</option>
        </select>
        <select
          v-model="filters.action"
          class="border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-primary-main/30 focus:border-primary-main transition-colors"
        >
          <option value="">{{ t('audit.allActions') }}</option>
          <option value="create">{{ t('common.create') }}</option>
          <option value="update">{{ t('audit.update') }}</option>
          <option value="delete">{{ t('common.delete') }}</option>
          <option value="import">{{ t('common.import') }}</option>
          <option value="export">{{ t('common.export') }}</option>
          <option value="backup">{{ t('audit.backup') }}</option>
          <option value="restore">{{ t('audit.restore') }}</option>
        </select>
        <div class="flex items-center gap-2">
          <div class="relative">
            <Calendar class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              v-model="filters.dateFrom"
              type="date"
              class="border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-primary-main/30 focus:border-primary-main transition-colors"
              :placeholder="t('common.dateRange')"
            />
          </div>
          <span class="text-gray-400">-</span>
          <div class="relative">
            <Calendar class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              v-model="filters.dateTo"
              type="date"
              class="border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-primary-main/30 focus:border-primary-main transition-colors"
            />
          </div>
        </div>
        <button
          @click="loadLogs"
          class="inline-flex items-center px-4 py-2 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main shadow-lg shadow-primary-main/25 transition-all duration-300 touch-manipulation"
        >
          <Filter class="mr-2 h-4 w-4" />
          {{ t('common.filter') }}
        </button>
      </div>
    </div>

    <!-- Log Timeline -->
    <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm overflow-hidden">
      <div v-if="isLoading" class="p-12 text-center">
        <div class="flex flex-col items-center gap-3">
          <Loader2 class="w-6 h-6 animate-spin text-primary-main" />
          <span class="text-sm text-gray-500 dark:text-gray-400">{{ t('common.loading') }}</span>
        </div>
      </div>

      <div v-else-if="logs.length === 0" class="p-12 text-center">
        <div class="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-white/5 flex items-center justify-center mx-auto mb-4">
          <FileText class="w-8 h-8 text-gray-400 dark:text-gray-500" />
        </div>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-1">{{ t('audit.noLogs') }}</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('audit.noLogsDesc') }}</p>
      </div>

      <table v-else class="min-w-full divide-y divide-gray-200 dark:divide-white/10">
        <thead class="bg-gray-50 dark:bg-white/[0.03]">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('audit.timestamp') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('audit.action') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('common.type') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('audit.entity') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('audit.changes') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 dark:divide-white/10">
          <tr
            v-for="log in logs"
            :key="log.id"
            class="group hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors"
          >
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="flex items-center gap-3">
                <div class="w-2 h-2 rounded-full flex-shrink-0" :class="getTimelineDotClass(log.action)"></div>
                <div>
                  <div class="text-sm text-gray-900 dark:text-white">{{ formatDate(log.timestamp) }}</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">{{ formatTime(log.timestamp) }}</div>
                </div>
              </div>
            </td>
            <td class="px-6 py-4">
              <span :class="getActionBadgeClass(log.action)" class="rounded-lg px-2.5 py-1 text-xs font-medium capitalize">
                {{ t(`audit.actions.${log.action}`) }}
              </span>
            </td>
            <td class="px-6 py-4">
              <div class="flex items-center gap-2">
                <div :class="getEntityIconBg(log.entityType)" class="w-7 h-7 rounded-lg flex items-center justify-center">
                  <component :is="getEntityIcon(log.entityType)" class="h-3.5 w-3.5" />
                </div>
                <span class="text-sm text-gray-700 dark:text-gray-300 capitalize">{{ t(`audit.entityTypes.${log.entityType}`) }}</span>
              </div>
            </td>
            <td class="px-6 py-4 text-sm text-gray-900 dark:text-white font-medium">
              {{ log.entityName || log.entityId || '-' }}
            </td>
            <td class="px-6 py-4">
              <span v-if="log.changes && log.changes.length > 0" class="bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg px-2.5 py-1 text-xs font-medium">
                {{ t('audit.fieldsChanged', { count: log.changes.length }) }}
              </span>
              <span v-else class="text-gray-400 dark:text-gray-500 text-sm">-</span>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Pagination -->
      <div v-if="pagination.totalPages > 1" class="px-6 py-4 border-t border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03] flex items-center justify-between">
        <div class="text-sm text-gray-500 dark:text-gray-400">
          {{ t('audit.pageInfo', { page: pagination.page, totalPages: pagination.totalPages, total: pagination.total }) }}
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="changePage(pagination.page - 1)"
            :disabled="pagination.page === 1"
            class="inline-flex items-center px-3 py-1.5 border border-gray-200 dark:border-white/10 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors touch-manipulation"
          >
            <ChevronLeft class="h-4 w-4 mr-1" />
            {{ t('common.previous') }}
          </button>
          <span class="px-3 py-1.5 text-sm font-mono font-bold text-gray-900 dark:text-white">
            {{ pagination.page }}
          </span>
          <button
            @click="changePage(pagination.page + 1)"
            :disabled="pagination.page === pagination.totalPages"
            class="inline-flex items-center px-3 py-1.5 border border-gray-200 dark:border-white/10 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors touch-manipulation"
          >
            {{ t('common.next') }}
            <ChevronRight class="h-4 w-4 ml-1" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import {
  Activity, FileText, Loader2, Calendar, Filter,
  ChevronLeft, ChevronRight, CreditCard, Receipt,
  RefreshCw, Settings, FileSpreadsheet, FolderOpen
} from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

const { t, locale } = useI18n()
const userStore = useUserStore()
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

    const data = await $fetch(`/api/audit?${params.toString()}`, { headers: userStore.authHeader })
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

const formatDate = (dateStr: string) => {
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(dateStr).toLocaleDateString(dateLocale, { year: 'numeric', month: 'short', day: 'numeric' })
}

const formatTime = (dateStr: string) => {
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(dateStr).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
}

const getTimelineDotClass = (action: string) => {
  const classes: Record<string, string> = {
    create: 'bg-green-500',
    update: 'bg-blue-500',
    delete: 'bg-red-500',
    import: 'bg-primary-main',
    export: 'bg-amber-500',
    backup: 'bg-indigo-500',
    restore: 'bg-pink-500'
  }
  return classes[action] || 'bg-gray-400'
}

const getActionBadgeClass = (action: string) => {
  const classes: Record<string, string> = {
    create: 'bg-green-500/10 text-green-600 dark:text-green-400',
    update: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    delete: 'bg-red-500/10 text-red-600 dark:text-red-400',
    import: 'bg-primary-main/10 text-primary-main dark:text-primary-light',
    export: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    backup: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    restore: 'bg-pink-500/10 text-pink-600 dark:text-pink-400'
  }
  return classes[action] || 'bg-gray-500/10 text-gray-600 dark:text-gray-400'
}

const entityIcons: Record<string, any> = {
  transaction: CreditCard,
  receipt: Receipt,
  recurring: RefreshCw,
  category: FolderOpen,
  template: FileSpreadsheet,
  settings: Settings
}

const getEntityIcon = (type: string) => entityIcons[type] || FileText

const getEntityIconBg = (type: string) => {
  const classes: Record<string, string> = {
    transaction: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    receipt: 'bg-green-500/10 text-green-600 dark:text-green-400',
    recurring: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    category: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
    template: 'bg-primary-main/10 text-primary-main dark:text-primary-light',
    settings: 'bg-gray-500/10 text-gray-600 dark:text-gray-400'
  }
  return classes[type] || 'bg-gray-500/10 text-gray-600 dark:text-gray-400'
}

onMounted(() => loadLogs())
</script>
