<template>
  <div class="bg-white rounded-lg shadow overflow-hidden">
    <div class="px-6 py-4 border-b">
      <h3 class="text-lg font-medium text-gray-800">{{ t('shipmentInfo.title') }}</h3>
    </div>
    <div class="p-6">
      <div v-if="shipment" class="space-y-4">
        <div class="flex items-center justify-between">
          <span class="text-gray-600">{{ t('shipmentInfo.trackingNumber') }}</span>
          <span class="font-medium">{{ shipment.trackingNumber || t('common.unknown') }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-gray-600">{{ t('shipmentInfo.carrier') }}</span>
          <span class="font-medium">{{ shipment.carrier || t('common.unknown') }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-gray-600">{{ t('common.status') }}</span>
          <StatusBadge :status="shipment.status || 'pending'" />
        </div>
        <div class="flex items-center justify-between">
          <span class="text-gray-600">{{ t('shipmentInfo.shipDate') }}</span>
          <span class="font-medium">{{ formatDate(shipment.shipDate) }}</span>
        </div>
        <div v-if="shipment.estimatedDelivery" class="flex items-center justify-between">
          <span class="text-gray-600">{{ t('shipmentInfo.estimatedDelivery') }}</span>
          <span class="font-medium">{{ formatDate(shipment.estimatedDelivery) }}</span>
        </div>
      </div>
      <div v-else class="text-center text-gray-500 py-8">
        <Package class="w-12 h-12 mx-auto mb-3 text-gray-400" />
        <p>{{ t('shipmentInfo.noShipment') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Package } from 'lucide-vue-next'

const { t, locale } = useI18n()

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
  if (!dateString) return t('common.unknown')
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(dateString).toLocaleDateString(dateLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}
</script>
