<template>
  <div class="bg-white rounded-lg shadow overflow-hidden">
    <div class="px-6 py-4 border-b">
      <h3 class="text-lg font-medium text-gray-800">Timeline</h3>
    </div>
    <div class="p-6">
      <div class="flow-root">
        <ul class="-mb-8">
          <li
              v-for="(event, index) in events"
              :key="index"
              class="relative pb-8"
              :class="{ 'pb-0': index === events.length - 1 }"
          >
            <!-- Vertical line connecting events -->
            <div
                v-if="index < events.length - 1"
                class="absolute top-4 left-4 -ml-px h-full w-0.5 bg-gray-200"
                aria-hidden="true"
            ></div>

            <!-- Event Content -->
            <div class="relative flex space-x-3">
              <!-- Event Icon -->
              <div>
                <span
                    class="h-8 w-8 rounded-full flex items-center justify-center ring-8 ring-white"
                    :class="getIconBackground(event.type)"
                >
                  <component
                      :is="getEventIcon(event.type)"
                      size="16"
                      :class="getIconColor(event.type)"
                  />
                </span>
              </div>

              <!-- Event Details -->
              <div class="min-w-0 flex-1">
                <div>
                  <p class="text-sm text-gray-500">
                    <span class="font-medium text-gray-900">{{ event.title }}</span>
                  </p>
                  <p class="mt-1 text-sm text-gray-500">{{ formatDate(event.timestamp) }}</p>
                </div>
                <div v-if="event.description" class="mt-2">
                  <p class="text-sm text-gray-500">{{ event.description }}</p>
                </div>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  CheckCircle,
  CreditCard,
  Archive,
  MessageSquare,
  RefreshCw,
  XCircle,
  AlertTriangle,
  Package,
  Truck,
  Home
} from 'lucide-vue-next'

const props = defineProps({
  events: {
    type: Array,
    required: true
  }
})

// Format date from ISO string
const formatDate = (isoDate: string) => {
  const date = new Date(isoDate)

  return `${date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })} at ${date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })}`
}

// Get appropriate icon based on event type
const getEventIcon = (type: string) => {
  switch (type) {
    case 'completed':
      return CheckCircle
    case 'processing':
      return CreditCard
    case 'created':
      return Archive
    case 'contact':
      return MessageSquare
    case 'refunded':
      return RefreshCw
    case 'failed':
      return XCircle
    case 'shipped':
      return Package
    case 'in_transit':
    case 'in-transit':
      return Truck
    case 'delivered':
      return Home
    default:
      return AlertTriangle
  }
}

// Get background color for icon
const getIconBackground = (type: string) => {
  switch (type) {
    case 'completed':
    case 'delivered':
      return 'bg-green-100'
    case 'processing':
    case 'in_transit':
    case 'in-transit':
    case 'shipped':
      return 'bg-blue-100'
    case 'created':
      return 'bg-purple-100'
    case 'refunded':
      return 'bg-yellow-100'
    case 'failed':
      return 'bg-red-100'
    case 'contact':
    default:
      return 'bg-gray-100'
  }
}

// Get icon color
const getIconColor = (type: string) => {
  switch (type) {
    case 'completed':
    case 'delivered':
      return 'text-green-600'
    case 'processing':
    case 'in_transit':
    case 'in-transit':
    case 'shipped':
      return 'text-blue-600'
    case 'created':
      return 'text-purple-600'
    case 'refunded':
      return 'text-yellow-600'
    case 'failed':
      return 'text-red-600'
    case 'contact':
    default:
      return 'text-gray-600'
  }
}
</script>