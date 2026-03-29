<template>
  <div>
    <header class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-800 dark:text-white">{{ t('nav.shipmentTracking') }}</h1>
        <p class="text-gray-600 dark:text-gray-400">{{ t('shipments.title') }}</p>
      </div>
    </header>

    <!-- Stats Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4">
        <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('shipments.statuses.in_transit') }}</div>
        <div class="text-2xl font-bold text-gray-800 dark:text-white mt-1">{{ stats.inTransit }}</div>
      </div>
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4">
        <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('shipments.statuses.delivered') }}</div>
        <div class="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">{{ stats.delivered }}</div>
      </div>
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4">
        <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('shipments.statuses.pending') }}</div>
        <div class="text-2xl font-bold text-yellow-600 dark:text-yellow-400 mt-1">{{ stats.pending }}</div>
      </div>
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4">
        <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('shipments.statuses.failed') }}</div>
        <div class="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">{{ stats.failed }}</div>
      </div>
    </div>

    <!-- Filter Tabs -->
    <div class="flex items-center gap-2 mb-4 overflow-x-auto pb-2">
      <button
        v-for="tab in filterTabs"
        :key="tab.value"
        @click="activeFilter = tab.value"
        :class="[
          activeFilter === tab.value
            ? 'bg-primary-main text-white'
            : 'bg-white dark:bg-white/5 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/[0.07]',
          'px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors touch-manipulation'
        ]"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Shipments List -->
    <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-hidden">
      <div v-if="isLoading" class="flex justify-center items-center py-16">
        <Loader class="h-8 w-8 text-primary-main animate-spin" />
      </div>
      <div v-else-if="filteredShipments.length === 0" class="text-center py-16">
        <Package class="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <p class="text-gray-500 dark:text-gray-400 text-sm">No shipments found</p>
      </div>
      <div v-else class="divide-y divide-gray-100 dark:divide-white/5">
        <NuxtLink
          v-for="shipment in filteredShipments"
          :key="shipment.id"
          :to="`/shipment/${shipment.id}`"
          class="flex items-center justify-between px-6 py-4 hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors"
        >
          <div class="flex items-center gap-4 min-w-0">
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              :class="getStatusBgClass(shipment.status)"
            >
              <Package class="h-5 w-5" :class="getStatusIconClass(shipment.status)" />
            </div>
            <div class="min-w-0">
              <div class="text-sm font-medium text-gray-800 dark:text-white truncate">
                {{ shipment.trackingNumber }}
              </div>
              <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {{ getCarrierName(shipment.carrier) }} &middot; {{ formatDate(shipment.createdAt) }}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-3 flex-shrink-0">
            <span
              class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
              :class="getStatusBadgeClass(shipment.status)"
            >
              {{ getStatusLabel(shipment.status) }}
            </span>
            <ChevronRight class="h-4 w-4 text-gray-400 dark:text-gray-500" />
          </div>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Package, Loader, ChevronRight } from 'lucide-vue-next'

const { t, locale } = useI18n()

const isLoading = ref(true)
const activeFilter = ref('all')

interface Shipment {
  id: string
  trackingNumber: string
  carrier: string
  status: string
  createdAt: string
  estimatedDelivery: string
}

const shipments = ref<Shipment[]>([])

const filterTabs = computed(() => [
  { label: t('common.all') || 'All', value: 'all' },
  { label: t('shipments.statuses.in_transit'), value: 'in_transit' },
  { label: t('shipments.statuses.pending'), value: 'pending' },
  { label: t('shipments.statuses.delivered'), value: 'delivered' },
  { label: t('shipments.statuses.failed'), value: 'failed' }
])

const stats = computed(() => {
  const s = shipments.value
  return {
    inTransit: s.filter(x => x.status === 'in_transit').length,
    delivered: s.filter(x => x.status === 'delivered').length,
    pending: s.filter(x => x.status === 'pending').length,
    failed: s.filter(x => x.status === 'failed').length
  }
})

const filteredShipments = computed(() => {
  if (activeFilter.value === 'all') return shipments.value
  return shipments.value.filter(s => s.status === activeFilter.value)
})

const getCarrierName = (code: string) => {
  const carriers: Record<string, string> = {
    fedex: 'FedEx', ups: 'UPS', usps: 'USPS', dhl: 'DHL', yamato: 'Yamato', sagawa: 'Sagawa'
  }
  return carriers[code] || code
}

const formatDate = (isoDate: string) => {
  if (!isoDate) return ''
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(isoDate).toLocaleDateString(dateLocale, {
    year: 'numeric', month: 'short', day: 'numeric'
  })
}

const getStatusLabel = (status: string) => {
  const key = `shipments.statuses.${status}`
  const translated = t(key)
  return translated !== key ? translated : status
}

const getStatusBgClass = (status: string) => {
  switch (status) {
    case 'delivered': return 'bg-green-100 dark:bg-green-900/30'
    case 'in_transit': return 'bg-blue-100 dark:bg-blue-900/30'
    case 'pending': return 'bg-yellow-100 dark:bg-yellow-900/30'
    case 'processing': return 'bg-gray-100 dark:bg-gray-800'
    case 'failed': return 'bg-red-100 dark:bg-red-900/30'
    default: return 'bg-gray-100 dark:bg-gray-800'
  }
}

const getStatusIconClass = (status: string) => {
  switch (status) {
    case 'delivered': return 'text-green-600 dark:text-green-400'
    case 'in_transit': return 'text-blue-600 dark:text-blue-400'
    case 'pending': return 'text-yellow-600 dark:text-yellow-400'
    case 'failed': return 'text-red-600 dark:text-red-400'
    default: return 'text-gray-600 dark:text-gray-400'
  }
}

const getStatusBadgeClass = (status: string) => {
  switch (status) {
    case 'delivered': return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
    case 'in_transit': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
    case 'pending': return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
    case 'processing': return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
    case 'failed': return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
    default: return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
  }
}

// Generate mock data
const generateMockShipments = (): Shipment[] => {
  const carriers = ['fedex', 'ups', 'dhl', 'yamato', 'sagawa']
  const statuses = ['pending', 'processing', 'in_transit', 'in_transit', 'in_transit', 'delivered', 'delivered', 'delivered', 'delivered', 'failed']
  const items: Shipment[] = []

  for (let i = 1; i <= 12; i++) {
    const carrier = carriers[Math.floor(Math.random() * carriers.length)]
    const status = statuses[Math.floor(Math.random() * statuses.length)]
    const created = new Date()
    created.setDate(created.getDate() - Math.floor(Math.random() * 30))

    const est = new Date(created)
    est.setDate(est.getDate() + 3 + Math.floor(Math.random() * 5))

    items.push({
      id: String(1000 + i),
      trackingNumber: `${carrier.toUpperCase()}-${(1000000 + Math.floor(Math.random() * 9000000))}`,
      carrier,
      status,
      createdAt: created.toISOString(),
      estimatedDelivery: est.toISOString()
    })
  }

  return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

onMounted(async () => {
  // Simulate API loading
  await new Promise(resolve => setTimeout(resolve, 400))
  shipments.value = generateMockShipments()
  isLoading.value = false
})
</script>
