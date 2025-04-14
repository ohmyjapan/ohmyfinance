<template>
  <div>
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center space-x-4">
        <div class="flex items-center">
          <div class="w-3 h-3 bg-purple-500 rounded-full mr-2"></div>
          <span class="text-sm text-gray-600">Transactions</span>
        </div>
      </div>

      <div class="relative">
        <select
            v-model="selectedPeriod"
            class="block w-full pl-3 pr-8 py-1 text-sm border-gray-300 rounded-md focus:outline-none focus:ring-purple-500 focus:border-purple-500"
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>
    </div>

    <div class="h-64">
      <LineChart
          :chart-data="chartData"
          :options="chartOptions"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js'
import { Line as LineChart } from 'vue-chartjs'

// Register ChartJS components
ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
)

const props = defineProps({
  chartData: {
    type: Object,
    required: true
  }
})

// State
const selectedPeriod = ref('weekly')

// Create chart data with selected period
const chartData = computed(() => {
  // In a real app, we would filter data based on selectedPeriod
  return {
    labels: props.chartData.labels,
    datasets: props.chartData.datasets
  }
})

// Chart options
const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    y: {
      beginAtZero: false,
      grid: {
        color: 'rgba(0, 0, 0, 0.05)'
      }
    },
    x: {
      grid: {
        display: false
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
      usePointStyle: true,
      callbacks: {
        label: (context) => {
          let label = context.dataset.label || '';
          if (label) {
            label += ': ';
          }
          if (context.parsed.y !== null) {
            label += new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: 'USD',
              minimumFractionDigits: 0,
              maximumFractionDigits: 0
            }).format(context.parsed.y);
          }
          return label;
        }
      }
    }
  },
  interaction: {
    intersect: false,
    mode: 'index'
  },
  elements: {
    line: {
      tension: 0.4
    },
    point: {
      radius: 2,
      hoverRadius: 5,
      hitRadius: 30,
      hoverBorderWidth: 2
    }
  }
}

// Watch for period changes
watch(selectedPeriod, (newValue) => {
  console.log('Period changed to', newValue)
  // In a real app, we would reload data here
})
</script>