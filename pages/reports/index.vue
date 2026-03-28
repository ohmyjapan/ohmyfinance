<template>
  <div>
    <header class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-800">{{ t('reports.title') }}</h1>
        <p class="text-gray-600">{{ t('reports.description') }}</p>
      </div>

      <div class="mt-4 md:mt-0 flex space-x-3">
        <select v-model="reportType" class="border border-gray-300 rounded-md px-3 py-2 text-sm">
          <option value="monthly">{{ t('reports.monthlyReport') }}</option>
          <option value="yearly">{{ t('reports.yearlyReport') }}</option>
        </select>
        <select v-model="selectedYear" class="border border-gray-300 rounded-md px-3 py-2 text-sm">
          <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
        </select>
        <select v-if="reportType === 'monthly'" v-model="selectedMonth" class="border border-gray-300 rounded-md px-3 py-2 text-sm">
          <option v-for="(name, idx) in months" :key="idx" :value="idx + 1">{{ name }}</option>
        </select>
        <button @click="exportReport" class="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">
          <Download class="h-4 w-4 inline mr-2" />
          {{ t('common.export') }}
        </button>
      </div>
    </header>

    <div v-if="isLoading" class="text-center py-12 text-gray-500">{{ t('reports.loading') }}</div>

    <div v-else-if="report" class="space-y-6">
      <!-- Period Header -->
      <div class="bg-primary-main text-white rounded-2xl p-6">
        <div class="text-sm opacity-80">{{ t('reports.reportPeriod') }}</div>
        <div class="text-2xl font-bold">{{ report.period.label }}</div>
        <div class="text-sm opacity-80 mt-1">
          {{ formatDate(report.period.startDate) }} - {{ formatDate(report.period.endDate) }}
        </div>
      </div>

      <!-- Summary Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-6">
          <div class="text-sm text-gray-500">{{ t('reports.totalTransactions') }}</div>
          <div class="text-2xl font-bold font-mono text-gray-800 dark:text-gray-100">{{ report.summary.transactions.total }}</div>
          <div class="text-lg text-primary-main">{{ formatCurrency(report.summary.transactions.totalAmount) }}</div>
        </div>
        <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-6">
          <div class="text-sm text-gray-500">{{ t('reports.averageTransaction') }}</div>
          <div class="text-2xl font-bold font-mono text-gray-800 dark:text-gray-100">{{ formatCurrency(report.summary.transactions.averageAmount) }}</div>
          <div class="text-sm text-gray-500">
            {{ t('reports.min') }}: {{ formatCurrency(report.summary.transactions.minAmount) }} |
            {{ t('reports.max') }}: {{ formatCurrency(report.summary.transactions.maxAmount) }}
          </div>
        </div>
        <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-6">
          <div class="text-sm text-gray-500">{{ t('receipts.title') }}</div>
          <div class="text-2xl font-bold font-mono text-gray-800 dark:text-gray-100">{{ report.summary.receipts.total }}</div>
          <div class="text-sm">
            <span class="text-green-600">{{ report.summary.receipts.matched }} {{ t('receipts.matched') }}</span> |
            <span class="text-yellow-600">{{ report.summary.receipts.unmatched }} {{ t('reports.pending') }}</span>
          </div>
        </div>
        <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-6">
          <div class="text-sm text-gray-500">{{ t('nav.recurringPayments') }}</div>
          <div class="text-2xl font-bold font-mono text-gray-800 dark:text-gray-100">{{ report.summary.recurring.active }} {{ t('recurring.active') }}</div>
          <div class="text-sm text-gray-500">{{ t('reports.estimated') }} {{ formatCurrency(report.summary.recurring.monthlyEstimate) }}/{{ t('reports.month') }}</div>
        </div>
      </div>

      <!-- Breakdown Charts -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- By Status -->
        <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10">
            <h3 class="text-lg font-medium text-gray-800">{{ t('reports.byStatus') }}</h3>
          </div>
          <div class="p-6">
            <div v-for="item in report.breakdown.byStatus" :key="item.status" class="mb-4">
              <div class="flex justify-between text-sm mb-1">
                <span class="capitalize">{{ t(`transactions.statuses.${item.status}`) }}</span>
                <span>{{ item.count }} ({{ item.percentage }}%)</span>
              </div>
              <div class="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div :style="{ width: item.percentage + '%' }" :class="getStatusBarColor(item.status)" class="h-full"></div>
              </div>
              <div class="text-right text-xs text-gray-500 mt-1">{{ formatCurrency(item.amount) }}</div>
            </div>
            <div v-if="report.breakdown.byStatus.length === 0" class="text-gray-500 text-center py-4">{{ t('common.noData') }}</div>
          </div>
        </div>

        <!-- By Source -->
        <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10">
            <h3 class="text-lg font-medium text-gray-800">{{ t('reports.bySource') }}</h3>
          </div>
          <div class="p-6">
            <div v-for="item in report.breakdown.bySource" :key="item.source" class="mb-4">
              <div class="flex justify-between text-sm mb-1">
                <span class="capitalize">{{ t(`transactions.sources.${item.source}`) }}</span>
                <span>{{ item.count }} ({{ item.percentage }}%)</span>
              </div>
              <div class="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div :style="{ width: item.percentage + '%' }" class="h-full bg-primary-main/100"></div>
              </div>
              <div class="text-right text-xs text-gray-500 mt-1">{{ formatCurrency(item.amount) }}</div>
            </div>
            <div v-if="report.breakdown.bySource.length === 0" class="text-gray-500 text-center py-4">{{ t('common.noData') }}</div>
          </div>
        </div>
      </div>

      <!-- Top Customers -->
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <h3 class="text-lg font-medium text-gray-800">{{ t('reports.topCustomers') }}</h3>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50 dark:bg-white/5">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">#</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ t('transactions.customer') }}</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">{{ t('nav.transactions') }}</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">{{ t('common.total') }}</th>
              </tr>
            </thead>
            <tbody class="bg-white dark:bg-white/5 divide-y divide-gray-200 dark:divide-white/5">
              <tr v-for="(customer, idx) in report.breakdown.topCustomers" :key="customer.name">
                <td class="px-6 py-4 text-sm text-gray-500">{{ idx + 1 }}</td>
                <td class="px-6 py-4 text-sm font-medium text-gray-900">{{ customer.name }}</td>
                <td class="px-6 py-4 text-sm text-gray-500 text-right">{{ customer.count }}</td>
                <td class="px-6 py-4 text-sm font-medium text-gray-900 text-right">{{ formatCurrency(customer.amount) }}</td>
              </tr>
              <tr v-if="report.breakdown.topCustomers.length === 0">
                <td colspan="4" class="px-6 py-4 text-center text-gray-500">{{ t('reports.noCustomerData') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Daily Breakdown -->
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <h3 class="text-lg font-medium text-gray-800">{{ t('reports.dailyBreakdown') }}</h3>
        </div>
        <div class="p-6 overflow-x-auto">
          <div class="flex space-x-1 min-w-max">
            <div v-for="day in report.breakdown.daily" :key="day.date" class="flex flex-col items-center">
              <div class="text-xs text-gray-400 mb-1">{{ formatDayLabel(day.date) }}</div>
              <div
                class="w-8 bg-primary-main/100 rounded-t"
                :style="{ height: getDayBarHeight(day.amount) + 'px' }"
                :title="`${day.date}: ${formatCurrency(day.amount)} (${day.count} transactions)`"
              ></div>
            </div>
          </div>
          <div v-if="report.breakdown.daily.length === 0" class="text-gray-500 text-center py-4">No daily data</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue'
import { Download } from 'lucide-vue-next'

const { t, locale } = useI18n()

const isLoading = ref(false)
const report = ref<any>(null)
const reportType = ref('monthly')
const selectedYear = ref(new Date().getFullYear())
const selectedMonth = ref(new Date().getMonth() + 1)

const years = computed(() => {
  const current = new Date().getFullYear()
  return Array.from({ length: 5 }, (_, i) => current - i)
})

const months = computed(() => [
  t('calendar.months.january'),
  t('calendar.months.february'),
  t('calendar.months.march'),
  t('calendar.months.april'),
  t('calendar.months.may'),
  t('calendar.months.june'),
  t('calendar.months.july'),
  t('calendar.months.august'),
  t('calendar.months.september'),
  t('calendar.months.october'),
  t('calendar.months.november'),
  t('calendar.months.december')
])

const loadReport = async () => {
  isLoading.value = true
  try {
    const params = new URLSearchParams({
      type: reportType.value,
      year: selectedYear.value.toString()
    })
    if (reportType.value === 'monthly') {
      params.set('month', selectedMonth.value.toString())
    }
    report.value = await $fetch(`/api/reports?${params.toString()}`)
  } catch (error) {
    console.error('Failed to load report:', error)
  } finally {
    isLoading.value = false
  }
}

const exportReport = () => {
  if (!report.value) return
  const dataStr = JSON.stringify(report.value, null, 2)
  const blob = new Blob([dataStr], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `report_${report.value.period.label}.json`
  a.click()
  URL.revokeObjectURL(url)
}

const formatCurrency = (amount: number) => {
  const currencyLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  const currency = locale.value === 'ko' ? 'KRW' : 'JPY'
  return new Intl.NumberFormat(currencyLocale, { style: 'currency', currency }).format(amount || 0)
}

const formatDate = (dateStr: string) => {
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(dateStr).toLocaleDateString(dateLocale)
}

const formatDayLabel = (dateStr: string) => {
  const date = new Date(dateStr)
  return date.getDate().toString()
}

const formatSource = (source: string) => {
  const labels: Record<string, string> = {
    credit_card: 'Credit Card',
    payment_gateway: 'Payment Gateway',
    overseas: 'Overseas',
    manual: 'Manual',
    other: 'Other'
  }
  return labels[source] || source
}

const getStatusBarColor = (status: string) => {
  const colors: Record<string, string> = {
    completed: 'bg-green-500',
    pending: 'bg-yellow-500',
    processing: 'bg-blue-500',
    failed: 'bg-red-500'
  }
  return colors[status] || 'bg-gray-500'
}

const getDayBarHeight = (amount: number) => {
  if (!report.value?.breakdown.daily.length) return 0
  const max = Math.max(...report.value.breakdown.daily.map((d: any) => d.amount))
  if (max === 0) return 0
  return Math.max(4, (amount / max) * 100)
}

watch([reportType, selectedYear, selectedMonth], () => loadReport())

onMounted(() => loadReport())
</script>
