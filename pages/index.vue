<template>
  <div>
    <!-- Welcome Section -->
    <div class="mb-8">
      <div class="bg-gradient-to-r from-primary-main to-primary-dark dark:from-primary-dark dark:to-primary-dark/80 rounded-lg shadow-lg p-6 text-white">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-bold mb-1">
              {{ dashboardData?.user?.name ? `${t('dashboard.welcome')}, ${dashboardData.user.name}` : t('dashboard.title') }}
            </h1>
            <p class="text-primary-light">
              {{ dashboardData?.organization?.name || t('dashboard.overview') }}
            </p>
            <div v-if="dashboardData?.organization" class="mt-2 flex items-center gap-2">
              <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/20 text-white">
                {{ getOrganizationTypeLabel(dashboardData.organization.type) }}
              </span>
              <span class="text-sm text-primary-light">
                {{ t('dashboard.recentActivityCount', { count: dashboardData?.stats?.recentActivityCount || 0 }) }}
              </span>
            </div>
          </div>
          <div class="hidden md:block">
            <div class="flex items-center gap-4">
              <div class="text-right">
                <p class="text-sm text-primary-light">{{ t('dashboard.totalTransactions') }}</p>
                <p class="text-3xl font-bold">{{ dashboardData?.stats?.total?.count || 0 }}</p>
              </div>
              <div class="w-px h-12 bg-white/30"></div>
              <div class="text-right">
                <p class="text-sm text-primary-light">{{ t('dashboard.upcomingPayments') }}</p>
                <p class="text-3xl font-bold">{{ dashboardData?.stats?.upcomingPaymentsCount || 0 }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- No Organization Prompt -->
      <div v-if="!isLoading && dashboardData && !dashboardData.hasOrganization" class="mt-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4">
        <div class="flex items-start gap-3">
          <div class="flex-shrink-0">
            <AlertCircle class="w-5 h-5 text-amber-500" />
          </div>
          <div class="flex-1">
            <h3 class="text-sm font-medium text-amber-800 dark:text-amber-200">
              {{ t('dashboard.noOrganization') }}
            </h3>
            <p class="mt-1 text-sm text-amber-700 dark:text-amber-300">
              {{ t('dashboard.noOrganizationDesc') }}
            </p>
            <div class="mt-3 flex gap-3">
              <NuxtLink
                to="/settings/organization/new"
                class="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors"
              >
                {{ t('dashboard.createOrganization') }}
              </NuxtLink>
              <NuxtLink
                to="/settings/organization/join"
                class="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md bg-white dark:bg-gray-700 text-amber-600 dark:text-amber-400 border border-amber-300 dark:border-amber-600 hover:bg-amber-50 dark:hover:bg-gray-600 transition-colors"
              >
                {{ t('dashboard.joinOrganization') }}
              </NuxtLink>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Quick Stats Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <StatCard
        :title="t('dashboard.expense')"
        :value="formatCurrency(dashboardData?.stats?.expense?.amount || 0)"
        icon="CreditCard"
        color="red"
      />

      <StatCard
        :title="t('dashboard.income')"
        :value="formatCurrency(dashboardData?.stats?.income?.amount || 0)"
        icon="DollarSign"
        color="green"
      />

      <StatCard
        :title="t('dashboard.receiptsCount')"
        :value="(dashboardData?.stats?.receiptsCount || 0).toString()"
        icon="FileText"
        color="red"
      />

      <StatCard
        :title="t('dashboard.receiptMatchRate')"
        :value="Math.round((dashboardData?.stats?.receiptMatchRate || 0) * 100) + '%'"
        icon="FileText"
        color="red"
      />
    </div>

    <!-- Quick Actions -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <NuxtLink
        to="/transactions/upload"
        class="flex items-center gap-3 p-4 bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-md transition-shadow border border-gray-200 dark:border-gray-700 hover:border-red-300 dark:hover:border-red-600"
      >
        <div class="p-2 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
          <Upload class="w-5 h-5" />
        </div>
        <span class="text-sm font-medium text-gray-700 dark:text-gray-200">{{ t('dashboard.uploadTransaction') }}</span>
      </NuxtLink>

      <NuxtLink
        to="/receipts/upload"
        class="flex items-center gap-3 p-4 bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-md transition-shadow border border-gray-200 dark:border-gray-700 hover:border-red-300 dark:hover:border-red-600"
      >
        <div class="p-2 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
          <Receipt class="w-5 h-5" />
        </div>
        <span class="text-sm font-medium text-gray-700 dark:text-gray-200">{{ t('dashboard.uploadReceipt') }}</span>
      </NuxtLink>

      <NuxtLink
        to="/calendar"
        class="flex items-center gap-3 p-4 bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-md transition-shadow border border-gray-200 dark:border-gray-700 hover:border-red-300 dark:hover:border-red-600"
      >
        <div class="p-2 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
          <Calendar class="w-5 h-5" />
        </div>
        <span class="text-sm font-medium text-gray-700 dark:text-gray-200">{{ t('dashboard.viewCalendar') }}</span>
      </NuxtLink>

      <NuxtLink
        to="/analytics"
        class="flex items-center gap-3 p-4 bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-md transition-shadow border border-gray-200 dark:border-gray-700 hover:border-red-300 dark:hover:border-red-600"
      >
        <div class="p-2 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
          <BarChart3 class="w-5 h-5" />
        </div>
        <span class="text-sm font-medium text-gray-700 dark:text-gray-200">{{ t('dashboard.viewAnalytics') }}</span>
      </NuxtLink>
    </div>

    <!-- Recent Transactions Table -->
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden mb-8">
      <div class="p-6 border-b dark:border-gray-700 flex items-center justify-between">
        <h2 class="text-lg font-semibold text-gray-800 dark:text-gray-100">{{ t('dashboard.recentTransactions') }}</h2>
        <NuxtLink
          to="/transactions"
          class="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium"
        >
          {{ t('common.viewAll') }} →
        </NuxtLink>
      </div>

      <div v-if="isLoading" class="p-8 text-center text-gray-500">
        <div class="flex items-center justify-center gap-2">
          <Loader2 class="w-5 h-5 animate-spin" />
          <span>{{ t('common.loading') }}</span>
        </div>
      </div>

      <div v-else-if="!recentTransactions || recentTransactions.length === 0" class="p-8 text-center text-gray-500">
        <FileText class="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
        <p>{{ t('dashboard.noTransactions') }}</p>
        <NuxtLink
          to="/transactions/upload"
          class="mt-3 inline-flex items-center px-4 py-2 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors"
        >
          {{ t('dashboard.uploadFirst') }}
        </NuxtLink>
      </div>

      <table v-else class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead class="bg-gray-50 dark:bg-gray-700">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('transactions.date') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('transactions.type') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('transactions.category') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('transactions.amount') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('transactions.status') }}</th>
          </tr>
        </thead>
        <tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
          <tr
            v-for="tx in recentTransactions"
            :key="tx._id || tx.id"
            class="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
            @click="navigateToTransaction(tx._id || tx.id)"
          >
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
              {{ formatDate(tx.date) }}
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <span :class="[
                'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                tx.type === '入金' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
              ]">
                {{ tx.type || '支出' }}
              </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
              {{ tx.accountCategoryId?.name || '-' }}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium" :class="tx.type === '入金' ? 'text-green-600' : 'text-gray-900 dark:text-gray-100'">
              {{ formatCurrency(tx.amount) }}
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <span :class="getStatusClass(tx.status)">
                {{ getStatusLabel(tx.status) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="recentTransactions && recentTransactions.length > 0" class="p-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
        <div class="flex items-center justify-between">
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ t('common.showing') }} {{ recentTransactions.length }} {{ t('common.of') }} {{ dashboardData?.stats?.total?.count || 0 }} {{ t('transactions.title').toLowerCase() }}
          </p>
          <NuxtLink
            to="/transactions"
            class="text-sm text-red-600 hover:text-red-700 dark:text-red-400"
          >
            {{ t('common.viewAll') }} →
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  CreditCard,
  FileText,
  DollarSign,
  Upload,
  Receipt,
  Calendar,
  BarChart3,
  AlertCircle,
  Loader2
} from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

const { t } = useI18n()
const router = useRouter()
const userStore = useUserStore()

// State
const isLoading = ref(true)
const dashboardData = ref<any>(null)

// Computed
const recentTransactions = computed(() => dashboardData.value?.recentTransactions || [])

// Fetch data on mount
onMounted(async () => {
  isLoading.value = true

  // Ensure auth is initialized from localStorage before making API calls
  userStore.initAuth()

  try {
    const data = await $fetch<any>('/api/dashboard/stats', {
      headers: userStore.authHeader
    }).catch(() => null)

    if (data) {
      dashboardData.value = data
    }
  } catch (error) {
    console.error('Failed to load dashboard data:', error)
  } finally {
    isLoading.value = false
  }
})

// Navigate to transaction detail
const navigateToTransaction = (id: string) => {
  if (id) {
    router.push(`/transactions/${id}`)
  }
}

// Get organization type label
const getOrganizationTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    personal: t('organization.personal'),
    business: t('organization.business'),
    enterprise: t('organization.enterprise')
  }
  return labels[type] || type
}

// Format currency (JPY)
const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0
  }).format(value || 0)
}

// Format date
const formatDate = (dateStr: string) => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

// Get status class
const getStatusClass = (status: string) => {
  const classes: Record<string, string> = {
    completed: 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    pending: 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    processing: 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    failed: 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    cancelled: 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
  }
  return classes[status] || classes.pending
}

// Get status label
const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    completed: t('status.completed'),
    pending: t('status.pending'),
    processing: t('status.processing'),
    failed: t('status.failed'),
    cancelled: t('status.cancelled')
  }
  return labels[status] || status
}
</script>
