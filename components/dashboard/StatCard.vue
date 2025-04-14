<template>
  <div class="bg-white rounded-lg shadow p-6">
    <div class="flex items-center">
      <div :class="`p-3 rounded-full bg-${color}-100 text-${color}-600`">
        <component :is="icon" size="24" />
      </div>
      <div class="ml-4">
        <p class="text-sm font-medium text-gray-500">{{ title }}</p>
        <p class="text-2xl font-semibold text-gray-800">{{ value }}</p>
      </div>
    </div>
    <div class="mt-4">
      <div class="flex items-center">
        <TrendingUp v-if="trend === 'up'" size="18" :class="`text-${trendColor}-500`" />
        <TrendingDown v-else size="18" :class="`text-${trendColor}-500`" />
        <span class="text-sm font-medium ml-1" :class="`text-${trendColor}-500`">{{ change }}</span>
        <span class="text-sm text-gray-500 ml-2">from last {{ period }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { TrendingUp, TrendingDown } from 'lucide-vue-next'

const props = defineProps({
  title: {
    type: String,
    required: true
  },
  value: {
    type: String,
    required: true
  },
  change: {
    type: String,
    default: '0%'
  },
  trend: {
    type: String,
    default: 'up',
    validator: (value: string) => ['up', 'down'].includes(value)
  },
  period: {
    type: String,
    default: 'month'
  },
  icon: {
    type: String,
    required: true
  },
  color: {
    type: String,
    default: 'purple'
  }
})

// Determine the color of the trend indicator
const trendColor = computed(() => {
  if (props.trend === 'up') {
    return 'green'
  } else {
    return 'red'
  }
})
</script>