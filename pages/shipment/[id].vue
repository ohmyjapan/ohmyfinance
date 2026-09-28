<template>
  <div>
    <!-- Back Button Header -->
    <div class="mb-6 flex items-center">
      <button
          @click="router.back()"
          class="p-2 rounded-full hover:bg-gray-100"
      >
        <ArrowLeft size="20" class="text-gray-600" />
      </button>
      <h1 class="ml-2 text-xl font-medium text-gray-800">{{ t('shipments.details') }}</h1>
    </div>

    <div v-if="isLoading" class="flex justify-center items-center h-64">
      <Loader size="32" class="text-primary-main animate-spin" />
    </div>

    <div v-else-if="error && !shipment" role="alert" class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
      {{ error }}
      <button class="ml-3 underline" @click="load">{{ t('shipmentPage.retry') }}</button>
    </div>

    <template v-else-if="shipment">
      <p v-if="actionMessage" role="status" class="mb-4 text-sm text-primary-main">{{ actionMessage }}</p>
      <!-- Shipment Summary Card -->
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-hidden mb-6">
        <div class="p-6">
          <div class="flex flex-col md:flex-row md:justify-between md:items-center mb-6">
            <div>
              <h2 class="text-xl font-semibold text-gray-800 break-all">#{{ shipment.id }}</h2>
              <p class="text-sm text-gray-500">
                {{ t('shipmentPage.createdOn') }} &middot; {{ formatDate(shipment.createdAt) }}
              </p>
            </div>
            <div class="mt-4 md:mt-0 flex items-center space-x-3">
              <ShipmentStatusBadge :status="shipment.status" />
              <button
                  v-if="canEdit"
                  class="inline-flex items-center px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
                  @click="openStatus"
              >
                {{ t('shipmentPage.updateStatus') }}
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-b py-6 my-6">
            <div>
              <p class="text-sm font-medium text-gray-500 mb-1">{{ t('shipmentPage.trackingNumber') }}</p>
              <div class="flex items-center">
                <p class="text-base font-medium text-gray-800 mr-2 break-all">{{ shipment.trackingNumber || t('shipmentPage.notRecorded') }}</p>
                <button
                    class="text-gray-400 hover:text-gray-600"
                    v-if="shipment.trackingNumber"
                    @click="copyToClipboard(shipment.trackingNumber)"
                >
                  <Clipboard size="14" />
                </button>
              </div>
              <div class="flex items-center mt-2">
                <p class="text-sm text-gray-600 mr-2">{{ getCarrierName(shipment.carrier || '') || t('shipmentPage.notRecorded') }}</p>
                <button
                    class="text-primary-main hover:text-primary-dark text-sm flex items-center"
                    v-if="shipment.trackingNumber && shipment.carrier"
                    @click="trackShipment(shipment.trackingNumber, shipment.carrier)"
                >
                  <ExternalLink size="12" class="mr-1" />
                  {{ t('shipmentPage.track') }}
                </button>
              </div>
            </div>
            <div>
              <p class="text-sm font-medium text-gray-500 mb-1">{{ t('shipmentPage.linkedPurchases') }}</p>
              <ul v-if="shipment.transactions?.length" class="space-y-2">
                <li v-for="purchase in shipment.transactions" :key="purchase._id">
                  <NuxtLink :to="localePath(`/transactions/${purchase._id}`)" class="text-sm text-primary-main underline break-all">
                    {{ purchase.referenceNumber || purchase._id }}
                  </NuxtLink>
                  <p class="text-xs text-gray-500">{{ formatDate(purchase.date) }}</p>
                </li>
              </ul>
              <p v-else class="text-sm text-gray-500">{{ t('shipmentPage.noLinkedPurchases') }}</p>
            </div>
            <div>
              <p class="text-sm font-medium text-gray-500 mb-1">{{ t('shipmentPage.estimatedDelivery') }}</p>
              <p class="text-base font-medium text-gray-800">{{ formatDate(shipment.estimatedDelivery) }}</p>
              <p class="text-sm" :class="getETAClass(shipment)">{{ getETAText(shipment) }}</p>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p class="text-sm font-medium text-gray-500 mb-1">{{ t('shipmentPage.recipient') }}</p>
              <p class="text-base font-medium text-gray-800">{{ address?.name || t('shipmentPage.notRecorded') }}</p>
            </div>
            <div>
              <p class="text-sm font-medium text-gray-500 mb-1">{{ t('shipmentPage.shippingAddress') }}</p>
              <template v-if="address">
                <p class="text-sm text-gray-600">{{ address.line1 }}</p>
                <p v-if="address.line2" class="text-sm text-gray-600">{{ address.line2 }}</p>
                <p class="text-sm text-gray-600">{{ [address.city, address.state, address.postalCode].filter(Boolean).join(' ') }}</p>
                <p class="text-sm text-gray-600">{{ getCountryName(address.country) }}</p>
              </template>
              <p v-else class="text-sm text-gray-600">{{ t('shipmentPage.notRecorded') }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Shipment Timeline -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left Column - 2/3 width -->
        <div class="lg:col-span-2">
          <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-hidden">
            <div class="px-6 py-4 border-b">
              <h3 class="text-lg font-medium text-gray-800">{{ t('shipmentPage.timeline') }}</h3>
            </div>
            <div class="p-6">
              <div class="flow-root">
                <p v-if="!shipment.events?.length" class="text-sm text-gray-500">{{ t('shipmentPage.noEvents') }}</p>
                <ul v-else class="-mb-8">
                  <li
                      v-for="(event, index) in shipment.events"
                      :key="index"
                      class="relative pb-8"
                      :class="{ 'pb-0': index === shipment.events.length - 1 }"
                  >
                    <!-- Vertical line connecting events -->
                    <div
                        v-if="index < shipment.events.length - 1"
                        class="absolute top-4 left-4 -ml-px h-full w-0.5 bg-gray-200"
                        aria-hidden="true"
                    ></div>

                    <!-- Event Content -->
                    <div class="relative flex space-x-3">
                      <!-- Event Icon -->
                      <div>
                        <span
                            class="h-8 w-8 rounded-full flex items-center justify-center ring-8 ring-white"
                            :class="getEventIconBackground(event.type)"
                        >
                          <component
                              :is="getEventIcon(event.type)"
                              size="16"
                              :class="getEventIconColor(event.type)"
                          />
                        </span>
                      </div>

                      <!-- Event Details -->
                      <div class="min-w-0 flex-1">
                        <div>
                          <p class="text-sm text-gray-500">
                            <span class="font-medium text-gray-900">{{ event.title }}</span>
                          </p>
                          <p class="mt-1 text-sm text-gray-500">{{ formatDate(event.timestamp) }} {{ formatTime(event.timestamp) }}</p>
                        </div>
                        <div v-if="event.description" class="mt-2">
                          <p class="text-sm text-gray-500">{{ event.description }}</p>
                        </div>
                        <div v-if="event.location" class="mt-1">
                          <p class="text-xs text-gray-500">{{ event.location }}</p>
                        </div>
                      </div>
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <!-- Right Column - 1/3 width -->
        <div>
          <!-- Shipment Details Card -->
          <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-hidden mb-6">
            <div class="px-6 py-4 border-b">
              <h3 class="text-lg font-medium text-gray-800">{{ t('shipmentPage.details') }}</h3>
            </div>
            <div class="p-6">
              <dl class="space-y-4">
                <div>
                  <dt class="text-sm font-medium text-gray-500">{{ t('shipmentPage.serviceType') }}</dt>
                  <dd class="mt-1 text-sm text-gray-900">{{ shipment.shippingMethod?.name || t('shipmentPage.notRecorded') }}</dd>
                </div>
                <div>
                  <dt class="text-sm font-medium text-gray-500">{{ t('shipmentPage.weight') }}</dt>
                  <dd class="mt-1 text-sm text-gray-900">{{ weightText }}</dd>
                </div>
                <div>
                  <dt class="text-sm font-medium text-gray-500">{{ t('shipmentPage.dimensions') }}</dt>
                  <dd class="mt-1 text-sm text-gray-900">{{ dimensionsText }}</dd>
                </div>
              </dl>
            </div>
          </div>

          <!-- Actions Card -->
          <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-hidden">
            <div class="px-6 py-4 border-b">
              <h3 class="text-lg font-medium text-gray-800">{{ t('shipmentPage.actions') }}</h3>
            </div>
            <div class="p-6">
              <p class="text-sm text-gray-500">{{ t('shipmentPage.unavailableActions') }}</p>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Status Update Modal -->
    <div
        v-if="updateStatus && canEdit && shipment"
        class="fixed inset-0 z-10 overflow-y-auto"
        aria-labelledby="modal-title"
        role="dialog"
        aria-modal="true"
    >
      <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div
            class="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            aria-hidden="true"
            @click="!saving && (updateStatus = false)"
        ></div>

        <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

        <div class="inline-block align-bottom bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div class="sm:flex sm:items-start">
              <div class="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-primary-main/20 sm:mx-0 sm:h-10 sm:w-10">
                <Truck class="h-6 w-6 text-primary-main" />
              </div>
              <div class="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                <h3 class="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                  {{ t('shipmentPage.updateStatusTitle') }}
                </h3>
                <div class="mt-2">
                  <p class="text-sm text-gray-500">
                    {{ t('shipmentPage.updateStatusDesc') }}
                  </p>
                </div>
              </div>
            </div>
            <div class="mt-4">
              <label for="status" class="block text-sm font-medium text-gray-700">{{ t('shipmentPage.statusLabel') }}</label>
              <select
                  id="status"
                  v-model="newStatus"
                  :disabled="saving || !!pendingEvent"
                  class="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm rounded-md"
              >
                <option v-for="status in statuses" :key="status" :value="status">{{ t(`shipments.statuses.${status}`) }}</option>
              </select>
            </div>
            <div class="mt-4">
              <label for="location" class="block text-sm font-medium text-gray-700">{{ t('shipmentPage.currentLocation') }}</label>
              <input
                  type="text"
                  id="location"
                  v-model="statusLocation"
                  :disabled="saving || !!pendingEvent"
                  class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm"
                  :placeholder="t('shipmentPage.locationPlaceholder')"
              />
            </div>
            <div class="mt-4">
              <label for="notes" class="block text-sm font-medium text-gray-700">{{ t('shipmentPage.additionalNotes') }}</label>
              <textarea
                  id="notes"
                  v-model="statusNotes"
                  :disabled="saving || !!pendingEvent"
                  rows="3"
                  class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm"
                  :placeholder="t('shipmentPage.notesPlaceholder')"
              ></textarea>
            </div>
            <p class="mt-4 text-sm text-gray-500">{{ t('shipmentPage.recordOnly') }}</p>
            <p v-if="pendingEvent && !saving" class="mt-3 text-sm text-gray-500">{{ t('shipmentPage.retrySameUpdate') }}</p>
            <p v-if="error" role="alert" class="mt-3 text-sm text-red-600">{{ error }}</p>
          </div>
          <div class="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
                type="button"
                class="w-full inline-flex justify-center rounded-xl border border-transparent shadow-sm px-4 py-2 bg-primary-main text-base font-medium text-white hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main sm:ml-3 sm:w-auto sm:text-sm"
                :disabled="saving"
                @click="updateShipmentStatus"
            >
              {{ t('shipmentPage.updateStatus') }}
            </button>
            <button
                type="button"
                class="mt-3 w-full inline-flex justify-center rounded-xl border border-gray-300 dark:border-white/10 shadow-sm px-4 py-2 bg-white dark:bg-white/5 text-base font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                @click="!saving && (updateStatus = false)"
            >
              {{ t('common.cancel') }}
            </button>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useShipmentStore, type ShipmentEvent } from '~/stores/shipment'
import { useUserStore } from '~/stores/user'
import {
  ArrowLeft,
  Clipboard,
  ExternalLink,
  Truck,
  Package,
  CheckCircle,
  AlertTriangle,
  AlertOctagon,
  Clock,
  Loader
} from 'lucide-vue-next'

const { t, locale } = useI18n()

const route = useRoute()
const router = useRouter()
const shipmentId = computed(() => route.params.id as string)

const store = useShipmentStore()
const user = useUserStore()
const localePath = useLocalePath()
const mounted = ref(false)
const shipment = computed(() => store.currentShipment)
const isLoading = computed(() => store.isLoading && !shipment.value)
const error = computed(() => store.error)
const canEdit = computed(() => ['owner', 'admin', 'member'].includes(user.currentOrganization?.role))
const updateStatus = ref(false)
const newStatus = ref<NonNullable<typeof shipment.value>['status']>('pending')
const statusLocation = ref('')
const statusNotes = ref('')
const pendingEvent = ref<Partial<ShipmentEvent> | null>(null)
const saving = ref(false)
const actionMessage = ref('')
const statuses = ['pending', 'processing', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned', 'cancelled', 'delayed', 'exception']
const address = computed(() => shipment.value?.shippingAddress)
const weightText = computed(() => {
  const weight = shipment.value?.weight
  return weight?.value == null ? t('shipmentPage.notRecorded') : `${weight.value} ${weight.unit || ''}`.trim()
})
const dimensionsText = computed(() => {
  const size = shipment.value?.dimensions
  return !size || [size.length, size.width, size.height].some(value => value == null)
    ? t('shipmentPage.notRecorded') : `${size.length} × ${size.width} × ${size.height} ${size.unit || ''}`.trim()
})
const load = () => store.fetchShipmentById(shipmentId.value)
watch([mounted, () => store.contextKey(), shipmentId], () => {
  store.resetContext()
  updateStatus.value = false
  pendingEvent.value = null
  saving.value = false
  actionMessage.value = ''
  if (mounted.value) void load()
}, { flush: 'sync' })
onMounted(() => { mounted.value = true })
onBeforeUnmount(() => { mounted.value = false })
const openStatus = () => {
  if (!canEdit.value || !shipment.value) return
  if (!pendingEvent.value) {
    newStatus.value = shipment.value.status
    statusLocation.value = ''
    statusNotes.value = ''
  }
  actionMessage.value = ''
  updateStatus.value = true
}

// Format date with locale
const formatDate = (isoDate?: string) => {
  if (!isoDate || !Number.isFinite(new Date(isoDate).getTime())) return t('shipmentPage.notRecorded')

  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(isoDate).toLocaleDateString(dateLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

// Format time with locale
const formatTime = (isoDate: string) => {
  if (!isoDate) return ''

  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(isoDate).toLocaleTimeString(dateLocale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: locale.value !== 'ja'
  })
}

// Get carrier name from code
const getCarrierName = (code: string) => {
  const carriers: Record<string, string> = {
    fedex: 'FedEx',
    ups: 'UPS',
    usps: 'USPS',
    dhl: 'DHL'
  }

  return carriers[code] || code
}

// Get country name from code
const getCountryName = (code?: string) => {
  if (!code) return t('shipmentPage.notRecorded')
  const countryKey = `countries.${code.toLowerCase()}`
  const translated = t(countryKey)
  // Return the translation if found, otherwise return code
  return translated !== countryKey ? translated : code
}

// Get ETA class and text
const getETAClass = (shipment: any) => {
  if (shipment.status === 'delivered') {
    return 'text-green-600'
  }

  const today = new Date()
  const etaDate = new Date(shipment.estimatedDelivery)

  if (etaDate < today && shipment.status !== 'delivered') {
    return 'text-red-600'
  }

  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  if (etaDate.toDateString() === today.toDateString()) {
    return 'text-yellow-600'
  }

  return 'text-gray-900'
}

const getETAText = (shipment: any) => {
  if (!shipment.estimatedDelivery || !Number.isFinite(new Date(shipment.estimatedDelivery).getTime())) return ''
  if (shipment.status === 'delivered') {
    return t('shipmentPage.etaDelivered')
  }

  const today = new Date()
  const etaDate = new Date(shipment.estimatedDelivery)

  if (etaDate < today && shipment.status !== 'delivered') {
    return t('shipmentPage.etaOverdue')
  }

  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  if (etaDate.toDateString() === today.toDateString()) {
    return t('shipmentPage.etaToday')
  }

  if (etaDate.toDateString() === tomorrow.toDateString()) {
    return t('shipmentPage.etaTomorrow')
  }

  // Calculate days from now
  const diffTime = Math.abs(etaDate.getTime() - today.getTime())
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  return t('shipmentPage.etaInDays', { days: diffDays })
}

// Get event icon and colors
const getEventIcon = (type: string) => {
  switch (type) {
    case 'created':
      return Package
    case 'processing':
      return Clock
    case 'in_transit':
      return Truck
    case 'out_for_delivery':
      return Truck
    case 'delivered':
      return CheckCircle
    case 'delayed':
      return AlertTriangle
    case 'exception':
      return AlertOctagon
    default:
      return Clock
  }
}

const getEventIconBackground = (type: string) => {
  switch (type) {
    case 'created':
      return 'bg-primary-main/20'
    case 'processing':
      return 'bg-gray-100'
    case 'in_transit':
      return 'bg-blue-100'
    case 'out_for_delivery':
      return 'bg-blue-100'
    case 'delivered':
      return 'bg-green-100'
    case 'delayed':
      return 'bg-yellow-100'
    case 'exception':
      return 'bg-red-100'
    default:
      return 'bg-gray-100'
  }
}

const getEventIconColor = (type: string) => {
  switch (type) {
    case 'created':
      return 'text-primary-main'
    case 'processing':
      return 'text-gray-600'
    case 'in_transit':
      return 'text-blue-600'
    case 'out_for_delivery':
      return 'text-blue-600'
    case 'delivered':
      return 'text-green-600'
    case 'delayed':
      return 'text-yellow-600'
    case 'exception':
      return 'text-red-600'
    default:
      return 'text-gray-600'
  }
}

// Confirm browser actions only after their result is known.
const copyToClipboard = async (text?: string) => {
  if (!text) return
  try { await navigator.clipboard.writeText(text); actionMessage.value = t('shipmentPage.copiedToClipboard') }
  catch { actionMessage.value = t('shipmentPage.copyFailed') }
}

// Track shipment externally
const trackShipment = (trackingNumber?: string, carrier?: string) => {
  if (!trackingNumber || !carrier) return
  trackingNumber = encodeURIComponent(trackingNumber)
  // Open carrier tracking site in new window
  let trackingUrl = ''

  switch (carrier) {
    case 'fedex':
      trackingUrl = `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`
      break
    case 'ups':
      trackingUrl = `https://www.ups.com/track?tracknum=${trackingNumber}`
      break
    case 'usps':
      trackingUrl = `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`
      break
    case 'dhl':
      trackingUrl = `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`
      break
    default:
      actionMessage.value = t('shipmentPage.noTrackingUrl')
      return
  }

  window.open(trackingUrl, '_blank', 'noopener,noreferrer')
}

// One request identity is retained while this form retries an uncertain result.
const updateShipmentStatus = async () => {
  if (!canEdit.value || !shipment.value || saving.value) return
  const id = shipmentId.value, context = store.contextKey()
  pendingEvent.value ||= { type: newStatus.value, title: getStatusTitle(newStatus.value), status: newStatus.value,
    description: statusNotes.value, location: statusLocation.value }
  saving.value = true
  const result = await store.addTrackingEvent(id, pendingEvent.value)
  if (context !== store.contextKey() || id !== shipmentId.value || !mounted.value) return
  saving.value = false
  if (!result) return
  pendingEvent.value = null
  updateStatus.value = false
  actionMessage.value = t('shipmentPage.statusUpdateSuccess')
}

// Persist the localized status label instead of a missing translation key.
const getStatusTitle = (status: string) => t(`shipments.statuses.${status}`)

</script>
