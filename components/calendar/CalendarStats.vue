<template>
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
    <!-- Expected Income -->
    <div class="bg-white dark:bg-background-darkPaper rounded-lg shadow p-4">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium text-gray-500 dark:text-gray-400">Expected Income</p>
          <p class="text-2xl font-bold text-success-main">
            {{ formatCurrency(stats.totalIncome) }}
          </p>
        </div>
        <div class="p-3 bg-success-light dark:bg-success-dark/30 rounded-full">
          <TrendingUp class="h-6 w-6 text-success-main" />
        </div>
      </div>
    </div>

    <!-- Expected Expenses -->
    <div class="bg-white dark:bg-background-darkPaper rounded-lg shadow p-4">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium text-gray-500 dark:text-gray-400">Expected Expenses</p>
          <p class="text-2xl font-bold text-error-main">
            {{ formatCurrency(stats.totalExpenses) }}
          </p>
        </div>
        <div class="p-3 bg-error-light dark:bg-error-dark/30 rounded-full">
          <TrendingDown class="h-6 w-6 text-error-main" />
        </div>
      </div>
    </div>

    <!-- Pending Payments -->
    <div class="bg-white dark:bg-background-darkPaper rounded-lg shadow p-4">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium text-gray-500 dark:text-gray-400">Pending</p>
          <p class="text-2xl font-bold text-warning-main">
            {{ stats.pendingPayments }}
          </p>
        </div>
        <div class="p-3 bg-warning-light dark:bg-warning-dark/30 rounded-full">
          <Clock class="h-6 w-6 text-warning-main" />
        </div>
      </div>
    </div>

    <!-- Overdue Payments -->
    <div class="bg-white dark:bg-background-darkPaper rounded-lg shadow p-4">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium text-gray-500 dark:text-gray-400">Overdue</p>
          <p class="text-2xl font-bold text-error-dark">
            {{ stats.overduePayments }}
          </p>
        </div>
        <div class="p-3 bg-error-light dark:bg-error-dark/30 rounded-full">
          <AlertTriangle class="h-6 w-6 text-error-dark" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { TrendingUp, TrendingDown, Clock, AlertTriangle } from 'lucide-vue-next'
import type { MonthlyStats } from '~/types/calendar'

defineProps<{
  stats: MonthlyStats
}>()

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount)
}
</script>
