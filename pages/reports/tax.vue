<template>
  <div>
    <header class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-800 dark:text-gray-100">{{ t('taxReport.title') }}</h1>
        <p class="text-gray-600 dark:text-gray-400">{{ t('taxReport.description') }}</p>
      </div>
      <div class="mt-4 md:mt-0 flex space-x-3">
        <select
            v-model="selectedYear"
            @change="loadReport"
            class="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md px-3 py-2"
        >
          <option v-for="year in availableYears" :key="year" :value="year">{{ year }}</option>
        </select>
        <button
            @click="exportCSV"
            class="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
        >
          <Download class="h-4 w-4 mr-2" />
          {{ t('taxReport.exportCSV') }}
        </button>
      </div>
    </header>

    <div v-if="isLoading" class="text-center py-8 text-gray-500">{{ t('common.loading') }}</div>

    <div v-else-if="report">
      <!-- Summary Cards -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4">
          <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('taxReport.totalIncome') }}</div>
          <div class="text-2xl font-bold text-green-600">{{ formatCurrency(report.summary.totalIncome) }}</div>
          <div class="text-xs text-gray-400">{{ report.summary.incomeCount }} {{ t('nav.transactions') }}</div>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4">
          <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('taxReport.totalExpenses') }}</div>
          <div class="text-2xl font-bold text-red-600">{{ formatCurrency(report.summary.totalExpenses) }}</div>
          <div class="text-xs text-gray-400">{{ report.summary.expenseCount }} {{ t('nav.transactions') }}</div>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4">
          <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('taxReport.deductibleExpenses') }}</div>
          <div class="text-2xl font-bold text-purple-600">{{ formatCurrency(report.summary.totalDeductible) }}</div>
          <div class="text-xs text-gray-400">{{ report.summary.deductibleCount }} {{ t('taxReport.items') }}</div>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4">
          <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('taxReport.netIncome') }}</div>
          <div class="text-2xl font-bold" :class="report.summary.netIncome >= 0 ? 'text-green-600' : 'text-red-600'">
            {{ formatCurrency(report.summary.netIncome) }}
          </div>
        </div>
      </div>

      <!-- Quarterly Summary -->
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-sm mb-6">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-medium text-gray-800 dark:text-gray-100">{{ t('taxReport.quarterlySummary') }}</h2>
        </div>
        <div class="p-6">
          <div class="grid grid-cols-4 gap-4">
            <div v-for="q in report.quarterlyData" :key="q.quarter" class="text-center p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div class="text-sm font-medium text-gray-500 dark:text-gray-400">{{ q.quarter }}</div>
              <div class="mt-2">
                <div class="text-xs text-gray-400">{{ t('taxReport.income') }}</div>
                <div class="text-sm font-medium text-green-600">{{ formatCurrency(q.income) }}</div>
              </div>
              <div class="mt-1">
                <div class="text-xs text-gray-400">{{ t('taxReport.expenses') }}</div>
                <div class="text-sm font-medium text-red-600">{{ formatCurrency(q.expenses) }}</div>
              </div>
              <div class="mt-1">
                <div class="text-xs text-gray-400">{{ t('taxReport.net') }}</div>
                <div class="text-sm font-bold" :class="q.net >= 0 ? 'text-green-600' : 'text-red-600'">
                  {{ formatCurrency(q.net) }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Expenses by Category -->
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-sm mb-6">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-medium text-gray-800 dark:text-gray-100">{{ t('taxReport.expensesByCategory') }}</h2>
        </div>
        <div class="divide-y divide-gray-200 dark:divide-gray-700">
          <div
              v-for="(data, category) in report.expensesByCategory"
              :key="category"
              class="px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <div>
              <div class="font-medium text-gray-900 dark:text-gray-100 capitalize">{{ category.replace(/_/g, ' ') }}</div>
              <div class="text-sm text-gray-500 dark:text-gray-400">{{ data.count }} transactions</div>
            </div>
            <div class="text-right">
              <div class="font-medium text-gray-900 dark:text-gray-100">{{ formatCurrency(data.total) }}</div>
              <div class="text-sm text-gray-500 dark:text-gray-400">
                {{ ((data.total / report.summary.totalExpenses) * 100).toFixed(1) }}%
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Monthly Breakdown -->
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-medium text-gray-800 dark:text-gray-100">{{ t('taxReport.monthlyBreakdown') }}</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead class="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('taxReport.month') }}</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('taxReport.income') }}</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('taxReport.expenses') }}</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('taxReport.net') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-for="month in report.monthlyData" :key="month.month" class="hover:bg-gray-50 dark:hover:bg-gray-700">
                <td class="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{{ month.monthName }}</td>
                <td class="px-6 py-4 text-sm text-right text-green-600">{{ formatCurrency(month.income) }}</td>
                <td class="px-6 py-4 text-sm text-right text-red-600">{{ formatCurrency(month.expenses) }}</td>
                <td class="px-6 py-4 text-sm text-right font-medium" :class="month.net >= 0 ? 'text-green-600' : 'text-red-600'">
                  {{ formatCurrency(month.net) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Download } from 'lucide-vue-next'

const { t, locale } = useI18n()
const isLoading = ref(false)
const selectedYear = ref(new Date().getFullYear())
const report = ref<any>(null)

const availableYears = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)

const loadReport = async () => {
  isLoading.value = true
  try {
    report.value = await $fetch(`/api/reports/tax?year=${selectedYear.value}`)
  } catch (error) {
    console.error('Failed to load tax report:', error)
  } finally {
    isLoading.value = false
  }
}

const exportCSV = () => {
  window.open(`/api/reports/tax?year=${selectedYear.value}&format=csv`, '_blank')
}

const formatCurrency = (value: number) => {
  const currencyLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  const currency = locale.value === 'ko' ? 'KRW' : 'JPY'
  return new Intl.NumberFormat(currencyLocale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
}

onMounted(() => loadReport())
</script>
