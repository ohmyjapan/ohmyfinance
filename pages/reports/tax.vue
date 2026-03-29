<template>
  <div>
    <!-- Page Header -->
    <div class="mb-8">
      <div class="bg-gradient-to-r from-primary-main to-primary-dark dark:from-primary-dark dark:to-primary-dark/80 rounded-2xl p-6 text-white relative overflow-hidden">
        <div class="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
        <div class="absolute -bottom-8 -left-8 w-32 h-32 bg-white/5 rounded-full blur-2xl"></div>
        <div class="flex flex-col md:flex-row md:items-center md:justify-between relative z-10">
          <div>
            <h1 class="text-2xl font-bold mb-1">{{ t('taxReport.title') }}</h1>
            <p class="text-primary-light">{{ t('taxReport.description') }}</p>
          </div>
          <div class="mt-4 md:mt-0 flex items-center gap-3">
            <select
              v-model="selectedYear"
              @change="loadReport"
              class="bg-white/20 border border-white/30 text-white rounded-xl px-3 py-2 backdrop-blur-sm [&>option]:text-gray-900"
            >
              <option v-for="year in availableYears" :key="year" :value="year">{{ year }}</option>
            </select>
            <button
              @click="exportCSV"
              class="inline-flex items-center gap-2 px-5 py-2.5 bg-white/20 hover:bg-white/30 text-white rounded-xl backdrop-blur-sm transition-all duration-300 touch-manipulation"
            >
              <Download class="h-4 w-4" />
              {{ t('taxReport.exportCSV') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="isLoading" class="flex items-center justify-center py-12">
      <Loader2 class="w-8 h-8 text-primary-main animate-spin" />
    </div>

    <div v-else-if="report">
      <!-- Summary Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-xl bg-green-500/10 dark:bg-green-500/20 flex items-center justify-center">
              <TrendingUp class="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p class="text-sm font-medium text-gray-500 dark:text-gray-400">{{ t('taxReport.totalIncome') }}</p>
              <p class="text-2xl font-bold font-mono text-green-600 dark:text-green-400">{{ formatCurrency(report.summary.totalIncome) }}</p>
              <p class="text-xs text-gray-400 font-mono">{{ report.summary.incomeCount }} {{ t('taxReport.transactions') }}</p>
            </div>
          </div>
        </div>
        <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-xl bg-red-500/10 dark:bg-red-500/20 flex items-center justify-center">
              <TrendingDown class="w-6 h-6 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p class="text-sm font-medium text-gray-500 dark:text-gray-400">{{ t('taxReport.totalExpenses') }}</p>
              <p class="text-2xl font-bold font-mono text-red-600 dark:text-red-400">{{ formatCurrency(report.summary.totalExpenses) }}</p>
              <p class="text-xs text-gray-400 font-mono">{{ report.summary.expenseCount }} {{ t('taxReport.transactions') }}</p>
            </div>
          </div>
        </div>
        <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center">
              <FileText class="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p class="text-sm font-medium text-gray-500 dark:text-gray-400">{{ t('taxReport.deductibleExpenses') }}</p>
              <p class="text-2xl font-bold font-mono text-primary-main dark:text-primary-light">{{ formatCurrency(report.summary.totalDeductible) }}</p>
              <p class="text-xs text-gray-400 font-mono">{{ report.summary.deductibleCount }} {{ t('taxReport.items') }}</p>
            </div>
          </div>
        </div>
        <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 flex items-center justify-center">
              <DollarSign class="w-6 h-6 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p class="text-sm font-medium text-gray-500 dark:text-gray-400">{{ t('taxReport.netIncome') }}</p>
              <p class="text-2xl font-bold font-mono" :class="report.summary.netIncome >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
                {{ formatCurrency(report.summary.netIncome) }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Quarterly Summary -->
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm mb-8 overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex items-center gap-2">
          <BarChart3 class="w-5 h-5 text-primary-main dark:text-primary-light" />
          <h2 class="text-lg font-semibold text-gray-800 dark:text-gray-100">{{ t('taxReport.quarterlySummary') }}</h2>
        </div>
        <div class="p-6">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div
              v-for="q in report.quarterlyData"
              :key="q.quarter"
              class="text-center p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
            >
              <div class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{{ q.quarter }}</div>
              <div class="space-y-2">
                <div>
                  <div class="text-xs text-gray-400">{{ t('taxReport.income') }}</div>
                  <div class="text-sm font-medium font-mono text-green-600 dark:text-green-400">{{ formatCurrency(q.income) }}</div>
                </div>
                <div>
                  <div class="text-xs text-gray-400">{{ t('taxReport.expenses') }}</div>
                  <div class="text-sm font-medium font-mono text-red-600 dark:text-red-400">{{ formatCurrency(q.expenses) }}</div>
                </div>
                <div class="pt-2 border-t border-gray-200 dark:border-white/10">
                  <div class="text-xs text-gray-400">{{ t('taxReport.net') }}</div>
                  <div class="text-sm font-bold font-mono" :class="q.net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
                    {{ formatCurrency(q.net) }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Expenses by Category -->
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm mb-8 overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex items-center gap-2">
          <Package class="w-5 h-5 text-primary-main dark:text-primary-light" />
          <h2 class="text-lg font-semibold text-gray-800 dark:text-gray-100">{{ t('taxReport.expensesByCategory') }}</h2>
        </div>
        <div class="divide-y divide-gray-200 dark:divide-white/10">
          <div
            v-for="(data, category) in report.expensesByCategory"
            :key="category"
            class="px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors"
          >
            <div class="flex items-center gap-3">
              <div class="w-2 h-2 rounded-full bg-primary-main"></div>
              <div>
                <div class="font-medium text-gray-900 dark:text-gray-100 capitalize">{{ category.replace(/_/g, ' ') }}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">{{ data.count }} {{ t('taxReport.transactions') }}</div>
              </div>
            </div>
            <div class="text-right">
              <div class="font-medium font-mono text-gray-900 dark:text-gray-100">{{ formatCurrency(data.total) }}</div>
              <div class="text-sm font-mono text-gray-500 dark:text-gray-400">
                {{ ((data.total / report.summary.totalExpenses) * 100).toFixed(1) }}%
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Monthly Breakdown -->
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex items-center gap-2">
          <Calendar class="w-5 h-5 text-primary-main dark:text-primary-light" />
          <h2 class="text-lg font-semibold text-gray-800 dark:text-gray-100">{{ t('taxReport.monthlyBreakdown') }}</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 dark:divide-white/10">
            <thead class="bg-gray-50 dark:bg-white/5">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('taxReport.month') }}</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('taxReport.income') }}</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('taxReport.expenses') }}</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('taxReport.net') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-white/10">
              <tr v-for="month in report.monthlyData" :key="month.month" class="hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors">
                <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">{{ month.monthName }}</td>
                <td class="px-6 py-4 text-sm text-right font-mono text-green-600 dark:text-green-400">{{ formatCurrency(month.income) }}</td>
                <td class="px-6 py-4 text-sm text-right font-mono text-red-600 dark:text-red-400">{{ formatCurrency(month.expenses) }}</td>
                <td class="px-6 py-4 text-sm text-right font-bold font-mono" :class="month.net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
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
import {
  Download, Loader2, TrendingUp, TrendingDown, FileText,
  DollarSign, BarChart3, Package, Calendar
} from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

const { t, locale } = useI18n()
const userStore = useUserStore()
const getAuthHeaders = () => userStore.authHeader

const isLoading = ref(false)
const selectedYear = ref(new Date().getFullYear())
const report = ref<any>(null)

const availableYears = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)

const loadReport = async () => {
  isLoading.value = true
  try {
    report.value = await $fetch(`/api/reports/tax?year=${selectedYear.value}`, {
      headers: getAuthHeaders()
    })
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
