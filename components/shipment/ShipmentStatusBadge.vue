<template>
  <span
      class="px-2 py-1 inline-flex items-center rounded-full text-xs font-medium"
      :class="badgeClasses[status]"
  >
    <component :is="statusIcon" size="12" class="mr-1" />
    {{ formatStatus(status) }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  Clock,
  Truck,
  CheckCircle,
  AlertTriangle,
  AlertCircle
} from 'lucide-vue-next'

const props = defineProps({
  status: {
    type: String,
    required: true
  }
})

// CSS classes for each status
const badgeClasses = {
  pending: 'bg-gray-100 text-gray-800',
  processing: 'bg-gray-100 text-gray-800',
  in_transit: 'bg-blue-100 text-blue-800',
  out_for_delivery: 'bg-purple-100 text-purple-800',
  delivered: 'bg-green-100 text-green-800',
  delayed: 'bg-yellow-100 text-yellow-800',
  exception: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-800'
}

// Get the appropriate icon for each status
const statusIcon = computed(() => {
  switch (props.status) {
    case 'pending':
    case 'processing':
      return Clock
    case 'in_transit':
    case 'out_for_delivery':
      return Truck
    case 'delivered':
      return CheckCircle
    case 'delayed':
      return AlertTriangle
    case 'exception':
    case 'cancelled':
      return AlertCircle
    default:
      return Clock
  }
})

// Format the status for display
const formatStatus = (status: string) => {
  // Replace underscores with spaces and capitalize each word
  return status
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
}
</script>