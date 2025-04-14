<template>
  <div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <PieChart
            :chart-data="chartData"
            :options="chartOptions"
            class="max-h-72 mx-auto"
        />
      </div>

      <div class="flex flex-col justify-center">
        <div v-for="(item, index) in legendItems" :key="index" class="flex items-center my-2">
          <div
              class="w-3 h-3 rounded-full mr-2"
              :style="{ backgroundColor: item.color }"
          ></div>
          <span class="text-sm text-gray-700 flex-grow">{{ item.label }}</span>
          <span class="text-sm font-semibold text-gray-900">{{ item.percentage }}%</span>
        </div>

        <div class="mt-4 pt-4 border-t border-gray-200">
          <div class="text-sm text-gray-700">
            <span class="font-medium">Success Rate: </span>
            <span class="font-bold text-green-600">{{ calculateSuccessRate() }}%</span>
          </div>
          <div class="text-xs text-gray-500 mt-1">
            Average processing time: 34 minutes
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend
} from 'chart.js'
import { Pie as PieChart } from 'vue-chartjs'

// Register ChartJS components
ChartJS.register(
    ArcElement,
    Tooltip,
    Legend
)

const props = defineProps({
  chartData: {
    type: Object,
    required: true
  }
})

// Chart options
const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
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
          let label = context.label || '';
          let value = context.formattedValue;
          return `${label}: ${value}%`;
        }
      }
    }
  }
}

// Generate legend items with colors and percentages
const legendItems = computed(() => {
  const labels = props.chartData.labels || []
  const data = props.chartData.datasets[0]?.data || []
  const colors = props.chartData.datasets[0]?.backgroundColor || []

  return labels.map((label, index) => {
    return {
      label,
      color: Array.isArray(colors) ? colors[index] : colors,
      percentage: data[index]
    }
  })
})

// Calculate success rate (Completed transactions)
const calculateSuccessRate = () => {
  const labels = props.chartData.labels || []
  const data = props.chartData.datasets[0]?.data || []

  const completedIndex = labels.findIndex(label => label === 'Completed')

  if (completedIndex !== -1) {
    return data[completedIndex]
  }

  // Default if not found
  return 0
}
</script>