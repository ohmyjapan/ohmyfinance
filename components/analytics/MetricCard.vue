<template>
  <div class="bg-white rounded-lg shadow-sm p-6">
    <div class="flex items-center">
      <div :class="`p-3 rounded-full bg-${color}-100 text-${color}-600`">
        <component :is="resolveIcon(icon)" size="24" />
      </div>
      <div class="ml-4">
        <p class="text-sm font-medium text-gray-500">{{ title }}</p>
        <p class="text-2xl font-semibold text-gray-800">{{ value }}</p>
      </div>
    </div>
    <div class="mt-4">
      <div class="flex items-center">
        <component :is="change >= 0 ? 'TrendingUp' : 'TrendingDown'"
                   size="18"
                   :class="change >= 0 ? 'text-green-500' : 'text-red-500'"
        />
        <span
            class="text-sm font-medium ml-1"
            :class="change >= 0 ? 'text-green-500' : 'text-red-500'"
        >
          {{ change >= 0 ? '+' : '' }}{{ change }}%
        </span>
        <span class="text-sm text-gray-500 ml-2">from last period</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  TrendingUp,
  TrendingDown,
  CreditCard,
  DollarSign,
  FileText,
  Package,
  ShoppingCart,
  Users,
  BarChart2,
  Activity
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
    type: Number,
    required: true
  },
  icon: {
    type: String,
    default: 'Activity'
  },
  color: {
    type: String,
    default: 'purple',
    validator: (val: string) => {
      return ['purple', 'blue', 'green', 'amber', 'red', 'gray'].includes(val)
    }
  }
})

// Resolve icon component based on string name
const resolveIcon = (iconName: string) => {
  const icons = {
    CreditCard,
    DollarSign,
    FileText,
    Package,
    ShoppingCart,
    Users,
    BarChart2,
    Activity
  }

  return icons[iconName] || Activity
}
</script>