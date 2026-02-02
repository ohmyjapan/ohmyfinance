<template>
  <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
    <div class="flex items-center">
      <div :class="[iconContainerClasses]" class="p-3 rounded-full">
        <component :is="icon" :size="24" />
      </div>
      <div class="ml-4">
        <p class="text-sm font-medium text-gray-500 dark:text-gray-400">{{ title }}</p>
        <p class="text-2xl font-semibold text-gray-800 dark:text-gray-100">{{ value }}</p>
      </div>
    </div>
    <div v-if="showTrend" class="mt-4">
      <div class="flex items-center">
        <TrendingUp v-if="trend === 'up'" size="18" :class="trendColorClass" />
        <TrendingDown v-else size="18" :class="trendColorClass" />
        <span class="text-sm font-medium ml-1" :class="trendColorClass">{{ change }}</span>
        <span class="text-sm text-gray-500 dark:text-gray-400 ml-2">from last {{ period }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { TrendingUp, TrendingDown, CreditCard, FileText, Package, DollarSign } from 'lucide-vue-next'

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
    default: ''
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
    default: 'primary'
  }
})

// Map icon names to actual components
const icons: Record<string, any> = {
  CreditCard,
  FileText,
  Package,
  DollarSign,
  TrendingUp,
  TrendingDown
}

// Show trend only if change is provided
const showTrend = computed(() => !!props.change)

// Resolved icon component
const icon = computed(() => icons[props.icon] || CreditCard)

// Container classes for the icon based on color
const iconContainerClasses = computed(() => {
  const colorClasses: Record<string, string> = {
    primary: 'bg-primary-light dark:bg-primary-dark/30 text-primary-main dark:text-primary-light',
    purple: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
    blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    green: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
    amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    red: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
  }
  return colorClasses[props.color] || colorClasses.primary
})

// Determine the color class for the trend indicator
const trendColorClass = computed(() => {
  if (props.trend === 'up') {
    return 'text-green-500 dark:text-green-400'
  } else {
    return 'text-red-500 dark:text-red-400'
  }
})
</script>
