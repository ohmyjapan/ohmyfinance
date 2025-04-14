<template>
  <div>
    <div class="grid grid-cols-1 gap-4">
      <div>
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-sm font-medium text-gray-700">Transaction Distribution by Region</h3>
          <div class="relative">
            <select
                v-model="selectedView"
                class="block w-full pl-3 pr-8 py-1 text-sm border-gray-300 rounded-md focus:outline-none focus:ring-purple-500 focus:border-purple-500"
            >
              <option value="percent">Percentage</option>
              <option value="absolute">Absolute</option>
            </select>
          </div>
        </div>

        <BarChart
            :chart-data="chartData"
            :options="chartOptions"
            class="max-h-72"
        />
      </div>

      <div class="grid grid-cols-2 gap-2 mt-2">
        <div v-for="(item, index) in topRegions" :key="index" class="bg-gray-50 p-3 rounded">
          <div class="text-xs text-gray-500">{{ item.region }}</div>
          <div class="text-sm font-medium text-gray-800">
            {{ selectedView === 'percent' ? `${item.percentage}%` : formatCurrency(item.value) }}
          </div>
          <div class="text-xs text-gray-500">
            {{ formatChange(item.change) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js'
import { Bar as BarChart } from 'vue-chartjs'

// Register ChartJS components
ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend
)

const props = defineProps({
  chartData: {
    type: Object,
    required: true
  }
})

// State
const selectedView = ref('percent')

// Chart options
const chartOptions = computed(() => {
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y', // Horizontal bars
    scales: {
      y: {
        grid: {
          display: false
        }
      },
      x: {
        grid: {
          color: 'rgba(0, 0, 0, 0.05)'
        },
        ticks: {
          callback: (value) => {
            if (selectedView.value === 'percent') {
              return `${value}%`
            } else {
              return `$${(value / 1000).toFixed(0)}k`
            }
          }
        }
      }
    },
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        backgroundColor: '#333',
        titleColor: '#fff',
        bodyColor: '#fff',
        bodyFont: {
          family: 'Inter, system-ui, sans-serif'
        },
        titleFont: {
          family: 'Inter, system-ui, sans-serif',
          weight: 'bold'
        },
        padding: 12,
        boxPadding: 8,
        callbacks: {
          label: (context) => {
            let label = context.dataset.label || '';
            let value = context.formattedValue;

            if (selectedView.value === 'percent') {
              return `${label}: ${value}%`;
            } else {
              return `${label}: $${(parseFloat(value) / 1000).toFixed(1)}k`;
            }
          }
        }
      }
    },
    interaction: {
      intersect: false,
      mode: 'index'
    }
  }
})

// Computed chart data based on selected view
const chartData = computed(() => {
  const labels = props.chartData.labels || []
  const data = props.chartData.datasets[0]?.data || []
  const colors = props.chartData.datasets[0]?.backgroundColor || []

  let displayData

  if (selectedView.value === 'percent') {
    // Use percentage values directly
    displayData = data
  } else {
    // Convert to absolute values (mock data for example)
    const totalTransactions = 458950.75 // From metrics
    displayData = data.map(percentage => (percentage / 100) * totalTransactions)
  }

  return {
    labels,
    datasets: [
      {
        label: 'Transactions',
        data: displayData,
        backgroundColor: colors
      }
    ]
  }
})

// Mock data for top regions cards
const topRegions = [
  { region: 'New York', percentage: 12, value: 55074.09, change: 8.4 },
  { region: 'California', percentage: 9, value: 41305.57, change: 5.2 },
  { region: 'London', percentage: 7, value: 32126.55, change: 11.3 },
  { region: 'Tokyo', percentage: 6, value: 27537.05, change: -3.6 }
]

// Format currency
const formatCurrency = (value) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value)
}

// Format change with + or - prefix and % suffix
const formatChange = (value) => {
  const prefix = value >= 0 ? '+' : ''
  return `${prefix}${value}% from last period`
}
</script>