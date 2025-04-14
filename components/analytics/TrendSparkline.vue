<template>
  <div class="w-full h-full">
    <LineChart
        :chart-data="chartData"
        :options="chartOptions"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler
} from 'chart.js'
import { Line as LineChart } from 'vue-chartjs'

// Register ChartJS components
ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Filler
)

const props = defineProps({
  data: {
    type: Array,
    required: true
  },
  color: {
    type: String,
    default: '#10b981' // Green
  }
})

// Generate chart data
const chartData = computed(() => {
  return {
    labels: Array(props.data.length).fill(''),
    datasets: [
      {
        data: props.data,
        borderColor: props.color,
        backgroundColor: props.color,
        fill: false,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 0
      }
    ]
  }
})

// Minimal chart options
const chartOptions = {
  responsive: true,
  maintainAspectRatio: true,
  plugins: {
    legend: {
      display: false
    },
    tooltip: {
      enabled: false
    }
  },
  scales: {
    x: {
      display: false,
      grid: {
        display: false
      }
    },
    y: {
      display: false,
      grid: {
        display: false
      },
      min: (context) => {
        const min = Math.min(...props.data)
        const max = Math.max(...props.data)
        const padding = (max - min) * 0.2
        return Math.max(0, min - padding)
      }
    }
  },
  elements: {
    line: {
      tension: 0.4
    },
    point: {
      radius: 0
    }
  },
  interaction: {
    intersect: false,
    mode: 'index'
  },
  animation: false
}
</script>