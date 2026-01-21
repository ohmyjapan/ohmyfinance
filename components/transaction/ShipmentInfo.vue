<template>
  <div class="bg-white rounded-lg shadow overflow-hidden">
    <div class="px-6 py-4 border-b">
      <h3 class="text-lg font-medium text-gray-800">Shipment Info</h3>
    </div>
    <div class="p-6">
      <div v-if="shipment" class="space-y-4">
        <div class="flex items-center justify-between">
          <span class="text-gray-600">Tracking Number</span>
          <span class="font-medium">{{ shipment.trackingNumber || 'N/A' }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-gray-600">Carrier</span>
          <span class="font-medium">{{ shipment.carrier || 'N/A' }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-gray-600">Status</span>
          <StatusBadge :status="shipment.status || 'pending'" />
        </div>
        <div class="flex items-center justify-between">
          <span class="text-gray-600">Ship Date</span>
          <span class="font-medium">{{ formatDate(shipment.shipDate) }}</span>
        </div>
        <div v-if="shipment.estimatedDelivery" class="flex items-center justify-between">
          <span class="text-gray-600">Est. Delivery</span>
          <span class="font-medium">{{ formatDate(shipment.estimatedDelivery) }}</span>
        </div>
      </div>
      <div v-else class="text-center text-gray-500 py-8">
        <Package class="w-12 h-12 mx-auto mb-3 text-gray-400" />
        <p>No shipment information available</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Package } from 'lucide-vue-next'

interface Shipment {
  trackingNumber?: string
  carrier?: string
  status?: string
  shipDate?: string
  estimatedDelivery?: string
}

defineProps<{
  shipment?: Shipment | null
}>()

const formatDate = (dateString?: string) => {
  if (!dateString) return 'N/A'
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}
</script>
