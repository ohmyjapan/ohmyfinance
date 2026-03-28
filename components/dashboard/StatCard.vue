<template>
  <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-6">
    <div class="flex items-center">
      <div :class="[iconContainerClasses]" class="p-3 rounded-xl">
        <component :is="resolvedIcon" :size="24" />
      </div>
      <div class="ml-4">
        <p class="text-sm font-medium text-gray-500 dark:text-gray-400">{{ title }}</p>
        <p class="text-3xl font-bold font-mono text-gray-800 dark:text-gray-100">{{ value }}</p>
      </div>
    </div>
    <div v-if="showTrend" class="mt-4">
      <div class="flex items-center">
        <TrendingUp v-if="trendDirection === 'up'" size="18" :class="trendColorClass" />
        <TrendingDown v-else size="18" :class="trendColorClass" />
        <span class="text-sm font-medium font-mono ml-1" :class="trendColorClass">{{ formattedChange }}</span>
        <span class="text-sm text-gray-500 dark:text-gray-400 ml-2">from last {{ period }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  TrendingUp, TrendingDown, CreditCard, FileText, Package,
  DollarSign, ShoppingCart, Users, BarChart2, BarChart3, Activity
} from 'lucide-vue-next'

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
    type: [String, Number],
    default: ''
  },
  trend: {
    type: String,
    default: '',
    validator: (value: string) => ['up', 'down', ''].includes(value)
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
  TrendingDown,
  ShoppingCart,
  Users,
  BarChart2,
  BarChart3,
  Activity
}

// Show trend only if change is provided
const showTrend = computed(() => props.change !== '' && props.change !== undefined && props.change !== null)

// Resolved icon component
const resolvedIcon = computed(() => icons[props.icon] || CreditCard)

// Determine trend direction from either explicit prop or numeric change
const trendDirection = computed(() => {
  if (props.trend) return props.trend
  if (typeof props.change === 'number') return props.change >= 0 ? 'up' : 'down'
  return 'up'
})

// Format change for display
const formattedChange = computed(() => {
  if (typeof props.change === 'number') {
    return `${props.change >= 0 ? '+' : ''}${props.change}%`
  }
  return props.change
})

// Container classes for the icon based on color
const iconContainerClasses = computed(() => {
  const colorClasses: Record<string, string> = {
    primary: 'bg-primary-main/20 text-primary-main dark:text-primary-light',
    blue: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
    green: 'bg-green-500/20 text-green-600 dark:text-green-400',
    amber: 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
    red: 'bg-red-500/20 text-red-600 dark:text-red-400'
  }
  return colorClasses[props.color] || colorClasses.primary
})

// Determine the color class for the trend indicator
const trendColorClass = computed(() => {
  if (trendDirection.value === 'up') {
    return 'text-green-500 dark:text-green-400'
  } else {
    return 'text-red-500 dark:text-red-400'
  }
})
</script>
