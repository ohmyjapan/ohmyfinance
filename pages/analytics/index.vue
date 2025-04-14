<template>
  <div>
    <header class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-800">Analytics Dashboard</h1>
        <p class="text-gray-600">Monitor and analyze your transaction data and business metrics</p>
      </div>

      <div class="mt-4 md:mt-0 flex space-x-3">
        <div class="relative">
          <select
              v-model="dateRange"
              class="block w-full pl-3 pr-10 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
          >
            <option value="last7days">Last 7 Days</option>
            <option value="last30days">Last 30 Days</option>
            <option value="last90days">Last 90 Days</option>
            <option value="lastYear">Last Year</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>

        <div v-if="dateRange === 'custom'" class="flex space-x-2">
          <input
              v-model="customDateFrom"
              type="date"
              class="block w-32 border border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
          />
          <input
              v-model="customDateTo"
              type="date"
              class="block w-32 border border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
          />
        </div>

        <button class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500">
          <Download class="mr-2 h-4 w-4 text-gray-500" />
          Export
        </button>
      </div>
    </header>

    <!-- Key Metrics -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
      <MetricCard
          title="Total Transactions"
          :value="formatCurrency(metrics.totalTransactions.value)"
          :change="metrics.totalTransactions.change"
          color="purple"
          icon="CreditCard"
      />

      <MetricCard
          title="Average Order Value"
          :value="formatCurrency(metrics.averageOrderValue.value)"
          :change="metrics.averageOrderValue.change"
          color="blue"
          icon="DollarSign"
      />

      <MetricCard
          title="Pending Receipts"
          :value="metrics.pendingReceipts.value.toString()"
          :change="metrics.pendingReceipts.change"
          color="amber"
          icon="FileText"
      />

      <MetricCard
          title="Active Shipments"
          :value="metrics.activeShipments.value.toString()"
          :change="metrics.activeShipments.change"
          color="green"
          icon="Package"
      />
    </div>

    <!-- Charts Row -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <!-- Transactions Over Time Chart -->
      <div class="bg-white rounded-lg shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200">
          <h2 class="text-lg font-medium text-gray-800">Transactions Over Time</h2>
        </div>
        <div class="p-6">
          <TransactionsChart :chart-data="transactionsChartData" />
        </div>
      </div>

      <!-- Transaction Sources Chart -->
      <div class="bg-white rounded-lg shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200">
          <h2 class="text-lg font-medium text-gray-800">Transaction Sources</h2>
        </div>
        <div class="p-6">
          <TransactionSourcesChart :chart-data="sourcesChartData" />
        </div>
      </div>
    </div>

    <!-- Transaction Status and Geographic Distribution -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <!-- Transaction Status Chart -->
      <div class="bg-white rounded-lg shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200">
          <h2 class="text-lg font-medium text-gray-800">Transaction Status</h2>
        </div>
        <div class="p-6">
          <StatusChart :chart-data="statusChartData" />
        </div>
      </div>

      <!-- Geographic Distribution -->
      <div class="bg-white rounded-lg shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200">
          <h2 class="text-lg font-medium text-gray-800">Geographic Distribution</h2>
        </div>
        <div class="p-6">
          <GeographicChart :chart-data="geoChartData" />
        </div>
      </div>
    </div>

    <!-- Recent Trends Table -->
    <div class="bg-white rounded-lg shadow-sm">
      <div class="px-6 py-4 border-b border-gray-200">
        <h2 class="text-lg font-medium text-gray-800">Recent Trends</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
          <tr>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Metric</th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Trend</th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Change</th>
          </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
          <tr v-for="(trend, index) in trends" :key="index">
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm font-medium text-gray-900">{{ trend.name }}</div>
              <div class="text-xs text-gray-500">{{ trend.period }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm text-gray-900">{{ formatTrendValue(trend) }}</div>
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
                  class="text-sm font-medium"
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
import { ref, computed, onMounted } from 'vue'
import { Download } from 'lucide-vue-next'

// State
const isLoading = ref(false)
const dateRange = ref('last30days')
const customDateFrom = ref('')
const customDateTo = ref('')

// Key metrics data
const metrics = ref({
  totalTransactions: {
    value: 458950.75,
    change: 8.2
  },
  averageOrderValue: {
    value: 89.25,
    change: 3.4
  },
  pendingReceipts: {
    value: 142,
    change: -5.2
  },
  activeShipments: {
    value: 567,
    change: 12.3
  }
})

// Chart data for transactions over time
const transactionsChartData = ref({
  labels: ['Apr 1', 'Apr 8', 'Apr 15', 'Apr 22', 'Apr 29', 'May 6', 'May 13'],
  datasets: [
    {
      label: 'Transactions',
      data: [12500, 15000, 14200, 16800, 19500, 16300, 18400],
      borderColor: '#7c3aed', // Purple
      backgroundColor: 'rgba(124, 58, 237, 0.1)',
      tension: 0.4,
      fill: true
    }
  ]
})

// Chart data for transaction sources
const sourcesChartData = ref({
  labels: ['Credit Card', 'Payment Gateway', 'Overseas', 'Other'],
  datasets: [
    {
      data: [45, 30, 20, 5],
      backgroundColor: [
        '#7c3aed', // Purple
        '#3b82f6', // Blue
        '#10b981', // Green
        '#f59e0b'  // Amber
      ],
      borderWidth: 0
    }
  ]
})

// Chart data for transaction status
const statusChartData = ref({
  labels: ['Completed', 'Pending', 'Processing', 'Failed'],
  datasets: [
    {
      data: [65, 15, 12, 8],
      backgroundColor: [
        '#10b981', // Green
        '#f59e0b', // Amber
        '#3b82f6', // Blue
        '#ef4444'  // Red
      ],
      borderWidth: 0
    }
  ]
})

// Chart data for geographic distribution
const geoChartData = ref({
  labels: ['United States', 'Europe', 'Asia Pacific', 'Canada', 'Other'],
  datasets: [
    {
      data: [38, 24, 18, 12, 8],
      backgroundColor: [
        '#7c3aed', // Purple
        '#3b82f6', // Blue
        '#10b981', // Green
        '#f59e0b', // Amber
        '#9ca3af'  // Gray
      ],
      borderWidth: 0
    }
  ]
})

// Trends data
const trends = ref([
  {
    name: 'Weekly Transactions',
    period: 'Last 7 days',
    value: 2845,
    data: [65, 72, 68, 78, 85, 82, 91],
    change: 5.8
  },
  {
    name: 'Average Processing Time',
    period: 'Last 7 days',
    value: 34.5,
    unit: 'minutes',
    data: [42, 38, 35, 36, 35, 32, 34.5],
    change: -17.9
  },
  {
    name: 'Failed Transactions',
    period: 'Last 30 days',
    value: 2.8,
    unit: 'percent',
    data: [3.4, 3.2, 3.1, 2.9, 2.8, 2.8, 2.8],
    change: -17.6
  },
  {
    name: 'International Transactions',
    period: 'Last 30 days',
    value: 18.5,
    unit: 'percent',
    data: [15.2, 16.1, 16.8, 17.2, 17.5, 18.1, 18.5],
    change: 21.7
  },
  {
    name: 'Receipt Match Rate',
    period: 'Last 30 days',
    value: 92.4,
    unit: 'percent',
    data: [88.7, 89.5, 90.2, 91.0, 91.5, 92.0, 92.4],
    change: 4.2
  }
])

// Load data
onMounted(async () => {
  // In a real app, this would load data based on the selected date range
  // loadAnalyticsData(dateRange.value)
})

// Format currency
const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
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
    return 'text-green-600'
  } else if (change < 0) {
    return 'text-red-600'
  } else {
    return 'text-gray-500'
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