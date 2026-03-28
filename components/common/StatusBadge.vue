<template>
  <span
      class="px-3 py-1 inline-flex items-center rounded-full text-sm font-medium"
      :class="badgeClasses[normalizedStatus]"
  >
    <component :is="statusIcon" class="mr-1" size="16" />
    {{ t(`status.${normalizedStatus}`) }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { CheckCircle, Clock, AlertTriangle, XCircle } from 'lucide-vue-next'

const { t } = useI18n()

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
const badgeClasses: Record<string, string> = {
  completed: 'bg-green-500/20 text-green-800 dark:text-green-400',
  pending: 'bg-yellow-500/20 text-yellow-800 dark:text-yellow-400',
  processing: 'bg-blue-500/20 text-blue-800 dark:text-blue-400',
  failed: 'bg-red-500/20 text-red-800 dark:text-red-400',
  refunded: 'bg-primary-main/20 text-primary-dark dark:text-primary-light',
  unknown: 'bg-gray-500/20 text-gray-800 dark:text-gray-400'
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
</script>
