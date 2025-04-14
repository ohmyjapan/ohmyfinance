<template>
  <span
      class="px-3 py-1 inline-flex items-center rounded-full text-sm font-medium"
      :class="badgeClasses[normalizedStatus]"
  >
    <component :is="statusIcon" class="mr-1" size="16" />
    {{ formatStatus(status) }}
  </span>
</template>

<script setup lang="ts">
import { CheckCircle, Clock, AlertTriangle, XCircle } from 'lucide-vue-next'

const props = defineProps({
  status: {
    type: String,
    required: true
  }
})

// Normalize status to handle different formats
const normalizedStatus = computed(() => {
  const status = props.status.toLowerCase()

  if (['complete', 'completed', 'success', 'successful'].includes(status)) {
    return 'completed'
  } else if (['pending', 'awaiting', 'waiting'].includes(status)) {
    return 'pending'
  } else if (['process', 'processing', 'in_process', 'in_progress', 'in-progress', 'in_transit', 'in-transit'].includes(status)) {
    return 'processing'
  } else if (['fail', 'failed', 'error', 'declined', 'rejected', 'canceled', 'cancelled'].includes(status)) {
    return 'failed'
  } else if (['refund', 'refunded'].includes(status)) {
    return 'refunded'
  } else {
    return 'unknown'
  }
})

// CSS classes for each status type
const badgeClasses = {
  completed: 'bg-green-100 text-green-800',
  pending: 'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
  failed: 'bg-red-100 text-red-800',
  refunded: 'bg-purple-100 text-purple-800',
  unknown: 'bg-gray-100 text-gray-800'
}

// Icon for each status type
const statusIcon = computed(() => {
  switch (normalizedStatus.value) {
    case 'completed':
      return CheckCircle
    case 'pending':
    case 'processing':
      return Clock
    case 'failed':
      return XCircle
    case 'refunded':
    case 'unknown':
      return AlertTriangle
  }
})

// Format status for display
const formatStatus = (status: string) => {
  // Handle special cases
  if (status.toLowerCase() === 'in_transit' || status.toLowerCase() === 'in-transit') {
    return 'In Transit'
  }

  // Capitalize first letter of each word
  return status
      .split('_').join(' ')
      .split('-').join(' ')
      .replace(/\w\S*/g, (txt) => {
        return txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase()
      })
}
</script>