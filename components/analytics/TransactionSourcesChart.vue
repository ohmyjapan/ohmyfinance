<template>
  <div>
    <DoughnutChart
        :chart-data="chartData"
        :options="chartOptions"
        class="max-h-80 mx-auto"
    />

    <div class="grid grid-cols-2 mt-4 gap-4">
      <div v-for="(item, index) in legendItems" :key="index" class="flex items-center">
        <div
            class="w-3 h-3 rounded-full mr-2"
            :style="{ backgroundColor: item.color }"
        ></div>
        <span class="text-sm text-gray-700">{{ item.label }}: {{ item.percentage }}%</span>
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
import { Doughnut as DoughnutChart } from 'vue-chartjs'

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
  cutout: '70%',
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
          let percentage = context.parsed;
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
</script>