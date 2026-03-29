<template>
  <div>
    <header class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-800 dark:text-gray-100">{{ t('nav.analytics') }}</h1>
        <p class="text-gray-600 dark:text-gray-400">{{ t('dashboard.overview') }}</p>
      </div>

      <div class="mt-4 md:mt-0 flex space-x-3">
        <div class="relative">
          <select
              v-model="dateRange"
              class="block w-full pl-3 pr-10 py-2 border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm"
          >
            <option value="last7days">{{ t('analytics.last7Days') }}</option>
            <option value="last30days">{{ t('analytics.last30Days') }}</option>
            <option value="last90days">{{ t('analytics.last90Days') }}</option>
            <option value="lastYear">{{ t('analytics.lastYear') }}</option>
            <option value="custom">{{ t('analytics.customRange') }}</option>
          </select>
        </div>

        <div v-if="dateRange === 'custom'" class="flex space-x-2">
          <input
              v-model="customDateFrom"
              type="date"
              class="block w-32 border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl shadow-sm focus:ring-primary-main focus:border-primary-main sm:text-sm"
          />
          <input
              v-model="customDateTo"
              type="date"
              class="block w-32 border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl shadow-sm focus:ring-primary-main focus:border-primary-main sm:text-sm"
          />
        </div>

        <button
            @click="showCustomize = true"
            class="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-slate-600 touch-manipulation"
        >
          <Settings class="h-4 w-4" />
        </button>

        <button class="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-white/10 rounded-xl shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main touch-manipulation">
          <Download class="mr-2 h-4 w-4 text-gray-500 dark:text-gray-400" />
          {{ t('common.export') }}
        </button>
      </div>
    </header>

    <!-- Customization Panel -->
    <div v-if="showCustomize" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" @click="showCustomize = false"></div>
        <div class="relative bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl max-w-lg w-full p-6">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100">{{ t('analytics.customizeDashboard') }}</h3>
            <button @click="showCustomize = false" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X class="h-5 w-5" />
            </button>
          </div>

          <div class="space-y-4">
            <p class="text-sm text-gray-600 dark:text-gray-400">{{ t('analytics.selectWidgets') }}</p>

            <div class="space-y-2">
              <label v-for="widget in availableWidgets" :key="widget.id" class="flex items-center space-x-3 p-2 rounded-xl hover:bg-gray-50 dark:hover:bg-white/[0.07]">
                <input
                    type="checkbox"
                    v-model="widgetSettings[widget.id]"
                    class="h-4 w-4 text-primary-main focus:ring-primary-main border-gray-300 dark:border-white/10 rounded"
                />
                <component :is="widget.icon" class="h-5 w-5 text-gray-400 dark:text-gray-500" />
                <span class="text-sm text-gray-700 dark:text-gray-300">{{ widget.name }}</span>
              </label>
            </div>
          </div>

          <div class="mt-6 flex justify-end space-x-3">
            <button
                @click="resetWidgets"
                class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 rounded-xl"
            >
              {{ t('analytics.resetDefault') }}
            </button>
            <button
                @click="saveWidgetSettings"
                class="px-4 py-2 bg-primary-main text-white text-sm font-medium rounded-xl hover:bg-primary-dark touch-manipulation"
            >
              {{ t('analytics.saveChanges') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Key Metrics -->
    <div v-if="widgetSettings.metrics" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
      <StatCard
          :title="t('analytics.expenseTotal')"
          :value="formatCurrency(metrics.expenseTotal.value)"
          :change="metrics.expenseTotal.change"
          color="red"
          icon="CreditCard"
      />

      <StatCard
          :title="t('analytics.incomeTotal')"
          :value="formatCurrency(metrics.incomeTotal.value)"
          :change="metrics.incomeTotal.change"
          color="green"
          icon="DollarSign"
      />

      <StatCard
          title="未マッチ領収書"
          :value="metrics.pendingReceipts.value.toString()"
          :change="metrics.pendingReceipts.change"
          color="amber"
          icon="FileText"
      />

      <StatCard
          title="取引件数"
          :value="metrics.transactionCount.value.toString()"
          :change="metrics.transactionCount.change"
          color="primary"
          icon="BarChart3"
      />
    </div>

    <!-- Charts Row -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <!-- Transactions Over Time Chart -->
      <div v-if="widgetSettings.transactionChart" class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <h2 class="text-lg font-medium text-gray-800 dark:text-gray-100">{{ t('analytics.transactionsOverTime') }}</h2>
        </div>
        <div class="p-6">
          <TransactionsChart :chart-data="transactionsChartData" />
        </div>
      </div>

      <!-- Transaction Type Chart -->
      <div v-if="widgetSettings.sourceChart" class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <h2 class="text-lg font-medium text-gray-800 dark:text-gray-100">{{ t('analytics.typeDistribution') }}</h2>
        </div>
        <div class="p-6">
          <TransactionSourcesChart :chart-data="sourcesChartData" />
        </div>
      </div>
    </div>

    <!-- Transaction Status and Category Distribution -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <!-- Transaction Status Chart -->
      <div v-if="widgetSettings.statusChart" class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <h2 class="text-lg font-medium text-gray-800 dark:text-gray-100">{{ t('analytics.statusDistribution') }}</h2>
        </div>
        <div class="p-6">
          <StatusChart :chart-data="statusChartData" />
        </div>
      </div>

      <!-- Category Distribution -->
      <div v-if="widgetSettings.geoChart" class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <h2 class="text-lg font-medium text-gray-800 dark:text-gray-100">{{ t('analytics.categoryDistribution') }}</h2>
        </div>
        <div class="p-6">
          <GeographicChart :chart-data="geoChartData" />
        </div>
      </div>
    </div>

    <!-- Recent Trends Table -->
    <div v-if="widgetSettings.trends" class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm">
      <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10">
        <h2 class="text-lg font-medium text-gray-800 dark:text-gray-100">{{ t('analytics.recentTrends') }}</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 dark:divide-white/10">
          <thead class="bg-gray-50 dark:bg-white/5">
          <tr>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('analytics.metric') }}</th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('analytics.value') }}</th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('analytics.trend') }}</th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('analytics.change') }}</th>
          </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-white/10">
          <tr v-for="(trend, index) in trends" :key="index" class="hover:bg-gray-50 dark:hover:bg-white/[0.07] transition">
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ trend.name }}</div>
              <div class="text-xs text-gray-500 dark:text-gray-400">{{ trend.period }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm font-mono text-gray-900 dark:text-gray-100">{{ formatTrendValue(trend) }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <TrendSparkline
                  :data="trend.data"
                  :color="getTrendColor(trend.change)"
                  class="h-8 w-24"
              />
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div
                  class="text-sm font-medium font-mono"
                  :class="getChangeTextColor(trend.change)"
              >
                <span v-if="trend.change > 0">+</span>{{ trend.change }}%
              </div>
            </td>
          </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { Download, Settings, X, CreditCard, TrendingUp, PieChart, Globe, BarChart3, FileText } from 'lucide-vue-next'

const { t } = useI18n()

// State
const isLoading = ref(false)
const dateRange = ref('last30days')
const customDateFrom = ref('')
const customDateTo = ref('')
const showCustomize = ref(false)

// Widget configuration
const defaultWidgetSettings = {
  metrics: true,
  transactionChart: true,
  sourceChart: true,
  statusChart: true,
  geoChart: true,
  trends: true
}

const widgetSettings = reactive({ ...defaultWidgetSettings })

const availableWidgets = computed(() => [
  { id: 'metrics', name: t('analytics.metricsCard'), icon: CreditCard },
  { id: 'transactionChart', name: t('analytics.trendChart'), icon: TrendingUp },
  { id: 'sourceChart', name: t('analytics.typeDistribution'), icon: PieChart },
  { id: 'statusChart', name: t('analytics.statusDistribution'), icon: BarChart3 },
  { id: 'geoChart', name: t('analytics.categoryDistribution'), icon: Globe },
  { id: 'trends', name: t('analytics.trendList'), icon: FileText }
])

const loadWidgetSettings = () => {
  const saved = localStorage.getItem('dashboardWidgets')
  if (saved) {
    const parsed = JSON.parse(saved)
    Object.assign(widgetSettings, parsed)
  }
}

const saveWidgetSettings = () => {
  localStorage.setItem('dashboardWidgets', JSON.stringify(widgetSettings))
  showCustomize.value = false
}

const resetWidgets = () => {
  Object.assign(widgetSettings, defaultWidgetSettings)
}

// Key metrics data
const metrics = ref({
  expenseTotal: {
    value: 0,
    change: 0
  },
  incomeTotal: {
    value: 0,
    change: 0
  },
  pendingReceipts: {
    value: 0,
    change: 0
  },
  transactionCount: {
    value: 0,
    change: 0
  }
})

// Chart data
const transactionsChartData = ref({
  labels: [] as string[],
  datasets: [{
    label: 'Transactions',
    data: [] as number[],
    borderColor: '#C0392B',
    backgroundColor: 'rgba(192, 57, 43, 0.1)',
    tension: 0.4,
    fill: true
  }]
})

const sourcesChartData = ref({
  labels: [] as string[],
  datasets: [{
    data: [] as number[],
    backgroundColor: ['#C0392B', '#3b82f6', '#10b981', '#f59e0b', '#9ca3af'],
    borderWidth: 0
  }]
})

const statusChartData = ref({
  labels: [] as string[],
  datasets: [{
    data: [] as number[],
    backgroundColor: ['#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#C0392B'],
    borderWidth: 0
  }]
})

// Account category distribution
const geoChartData = ref({
  labels: [t('analytics.chartLabels.expenses'), t('analytics.chartLabels.purchases'), t('analytics.chartLabels.sales'), t('analytics.chartLabels.salary'), t('analytics.chartLabels.other')],
  datasets: [{
    data: [40, 25, 20, 10, 5],
    backgroundColor: ['#C0392B', '#3b82f6', '#10b981', '#f59e0b', '#9ca3af'],
    borderWidth: 0
  }]
})

// Trends data
const trends = ref<any[]>([])

// Load analytics data from API
const loadAnalyticsData = async () => {
  isLoading.value = true
  try {
    // Fetch transaction stats
    const [analyticsData, statsData, receiptsData] = await Promise.all([
      $fetch<any>(`/api/analytics?range=${dateRange.value}`).catch(() => null),
      $fetch<any>('/api/transactions/stats').catch(() => null),
      $fetch<any>('/api/receipts?stats=true').catch(() => null)
    ])

    // Use transaction stats for metrics
    if (statsData) {
      metrics.value = {
        expenseTotal: {
          value: statsData.expense?.amount || 0,
          change: 0
        },
        incomeTotal: {
          value: statsData.income?.amount || 0,
          change: 0
        },
        pendingReceipts: {
          value: receiptsData?.stats?.unmatched || 0,
          change: 0
        },
        transactionCount: {
          value: statsData.total?.count || 0,
          change: 0
        }
      }
    }

    // Handle analytics data if available
    if (analyticsData) {
      if (analyticsData.charts) {
        if (analyticsData.charts.transactionsOverTime) {
          transactionsChartData.value = analyticsData.charts.transactionsOverTime
        }
        if (analyticsData.charts.typeDistribution) {
          sourcesChartData.value = {
            labels: [t('analytics.chartLabels.expense'), t('analytics.chartLabels.income')],
            datasets: [{
              data: [
                statsData?.expense?.count || 0,
                statsData?.income?.count || 0
              ],
              backgroundColor: ['#ef4444', '#10b981'],
              borderWidth: 0
            }]
          }
        }
        if (analyticsData.charts.statusDistribution) {
          statusChartData.value = analyticsData.charts.statusDistribution
        }
      }

      if (analyticsData.trends) {
        trends.value = analyticsData.trends
      }
    } else {
      // Build charts from stats data if analytics endpoint not available
      sourcesChartData.value = {
        labels: [t('analytics.chartLabels.expense'), t('analytics.chartLabels.income')],
        datasets: [{
          data: [
            statsData?.expense?.count || 0,
            statsData?.income?.count || 0
          ],
          backgroundColor: ['#ef4444', '#10b981'],
          borderWidth: 0
        }]
      }

      statusChartData.value = {
        labels: [t('analytics.chartLabels.completed'), t('analytics.chartLabels.pending'), t('analytics.chartLabels.processing'), t('analytics.chartLabels.failed')],
        datasets: [{
          data: [
            statsData?.completed?.count || 0,
            statsData?.pending?.count || 0,
            statsData?.processing?.count || 0,
            statsData?.failed?.count || 0
          ],
          backgroundColor: ['#10b981', '#f59e0b', '#3b82f6', '#ef4444'],
          borderWidth: 0
        }]
      }
    }
  } catch (error) {
    console.error('Failed to load analytics:', error)
  } finally {
    isLoading.value = false
  }
}

// Watch for date range changes
watch([dateRange, customDateFrom, customDateTo], () => {
  if (dateRange.value !== 'custom' || (customDateFrom.value && customDateTo.value)) {
    loadAnalyticsData()
  }
})

// Load data on mount
onMounted(() => {
  loadWidgetSettings()
  loadAnalyticsData()
})

// Format currency (JPY default)
const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0
  }).format(value)
}

// Format trend values with appropriate units
const formatTrendValue = (trend) => {
  if (trend.unit === 'percent') {
    return `${trend.value}%`
  } else if (trend.unit === 'minutes') {
    return `${trend.value} min`
  } else if (trend.value > 1000) {
    return formatCurrency(trend.value)
  } else {
    return trend.value.toLocaleString()
  }
}

// Get text color based on change direction
const getChangeTextColor = (change: number) => {
  if (change > 0) {
    return 'text-green-600 dark:text-green-400'
  } else if (change < 0) {
    return 'text-red-600 dark:text-red-400'
  } else {
    return 'text-gray-500 dark:text-gray-400'
  }
}

// Get trend line color
const getTrendColor = (change: number) => {
  if (change > 0) {
    return '#10b981' // Green
  } else if (change < 0) {
    return '#ef4444' // Red
  } else {
    return '#9ca3af' // Gray
  }
}
</script>
