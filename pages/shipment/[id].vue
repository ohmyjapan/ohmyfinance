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
      <Loader size="32" class="text-purple-600 animate-spin" />
    </div>

    <div v-else-if="error" class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
      {{ error }}
    </div>

    <template v-else>
      <!-- Shipment Summary Card -->
      <div class="bg-white rounded-lg shadow-sm overflow-hidden mb-6">
        <div class="p-6">
          <div class="flex flex-col md:flex-row md:justify-between md:items-center mb-6">
            <div>
              <h2 class="text-xl font-semibold text-gray-800">#{{ shipment.id }}</h2>
              <p class="text-sm text-gray-500">
                {{ t('shipmentPage.createdOn', { date: formatDate(shipment.createdAt) }) }}
              </p>
            </div>
            <div class="mt-4 md:mt-0 flex items-center space-x-3">
              <ShipmentStatusBadge :status="shipment.status" />
              <button
                  v-if="shipment.status !== 'delivered' && shipment.status !== 'cancelled'"
                  class="inline-flex items-center px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                  @click="updateStatus = true"
              >
                {{ t('shipmentPage.updateStatus') }}
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-b py-6 my-6">
            <div>
              <p class="text-sm font-medium text-gray-500 mb-1">{{ t('shipmentPage.trackingNumber') }}</p>
              <div class="flex items-center">
                <p class="text-base font-medium text-gray-800 mr-2">{{ shipment.trackingNumber }}</p>
                <button
                    class="text-gray-400 hover:text-gray-600"
                    @click="copyToClipboard(shipment.trackingNumber)"
                >
                  <Clipboard size="14" />
                </button>
              </div>
              <div class="flex items-center mt-2">
                <p class="text-sm text-gray-600 mr-2">{{ getCarrierName(shipment.carrier) }}</p>
                <button
                    class="text-purple-600 hover:text-purple-800 text-sm flex items-center"
                    @click="trackShipment(shipment.trackingNumber, shipment.carrier)"
                >
                  <ExternalLink size="12" class="mr-1" />
                  {{ t('shipmentPage.track') }}
                </button>
              </div>
            </div>
            <div>
              <p class="text-sm font-medium text-gray-500 mb-1">{{ t('shipmentPage.linkedOrder') }}</p>
              <p class="text-base font-medium text-gray-800">{{ t('shipmentPage.orderNumber', { id: shipment.orderId }) }}</p>
              <p class="text-sm text-gray-600">
                <button class="text-purple-600 hover:text-purple-800">
                  {{ t('shipmentPage.viewOrder') }}
                </button>
              </p>
            </div>
            <div>
              <p class="text-sm font-medium text-gray-500 mb-1">{{ t('shipmentPage.estimatedDelivery') }}</p>
              <p class="text-base font-medium text-gray-800">{{ formatDate(shipment.estimatedDelivery) }}</p>
              <p class="text-sm" :class="getETAClass(shipment)">{{ getETAText(shipment) }}</p>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p class="text-sm font-medium text-gray-500 mb-1">{{ t('shipmentPage.customerInfo') }}</p>
              <p class="text-base font-medium text-gray-800">{{ shipment.customer.name }}</p>
              <p class="text-sm text-gray-600">{{ shipment.customer.email }}</p>
              <p class="text-sm text-gray-600">
                <button class="text-purple-600 hover:text-purple-800 mt-1">
                  {{ t('shipmentPage.viewCustomer') }}
                </button>
              </p>
            </div>
            <div>
              <p class="text-sm font-medium text-gray-500 mb-1">{{ t('shipmentPage.shippingAddress') }}</p>
              <p class="text-base font-medium text-gray-800">{{ shipment.customer.name }}</p>
              <p class="text-sm text-gray-600">{{ shipment.destination.address }}</p>
              <p class="text-sm text-gray-600">
                {{ shipment.destination.city }}, {{ shipment.destination.state }} {{ shipment.destination.postalCode }}
              </p>
              <p class="text-sm text-gray-600">{{ getCountryName(shipment.destination.country) }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Shipment Timeline -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left Column - 2/3 width -->
        <div class="lg:col-span-2">
          <div class="bg-white rounded-lg shadow-sm overflow-hidden">
            <div class="px-6 py-4 border-b">
              <h3 class="text-lg font-medium text-gray-800">{{ t('shipmentPage.timeline') }}</h3>
            </div>
            <div class="p-6">
              <div class="flow-root">
                <ul class="-mb-8">
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
          <div class="bg-white rounded-lg shadow-sm overflow-hidden mb-6">
            <div class="px-6 py-4 border-b">
              <h3 class="text-lg font-medium text-gray-800">{{ t('shipmentPage.details') }}</h3>
            </div>
            <div class="p-6">
              <dl class="space-y-4">
                <div>
                  <dt class="text-sm font-medium text-gray-500">{{ t('shipmentPage.serviceType') }}</dt>
                  <dd class="mt-1 text-sm text-gray-900">{{ shipment.serviceType }}</dd>
                </div>
                <div>
                  <dt class="text-sm font-medium text-gray-500">{{ t('shipmentPage.packageType') }}</dt>
                  <dd class="mt-1 text-sm text-gray-900">{{ shipment.packageType }}</dd>
                </div>
                <div>
                  <dt class="text-sm font-medium text-gray-500">{{ t('shipmentPage.weight') }}</dt>
                  <dd class="mt-1 text-sm text-gray-900">{{ shipment.weight }} {{ shipment.weightUnit }}</dd>
                </div>
                <div>
                  <dt class="text-sm font-medium text-gray-500">{{ t('shipmentPage.dimensions') }}</dt>
                  <dd class="mt-1 text-sm text-gray-900">{{ shipment.dimensions }}</dd>
                </div>
                <div>
                  <dt class="text-sm font-medium text-gray-500">{{ t('shipmentPage.insurance') }}</dt>
                  <dd class="mt-1 text-sm text-gray-900">{{ shipment.insurance ? formatCurrency(parseFloat(shipment.insurance)) : t('shipmentPage.noInsurance') }}</dd>
                </div>
                <div>
                  <dt class="text-sm font-medium text-gray-500">{{ t('shipmentPage.signatureRequired') }}</dt>
                  <dd class="mt-1 text-sm text-gray-900">{{ shipment.signatureRequired ? t('common.yes') : t('common.no') }}</dd>
                </div>
              </dl>
            </div>
          </div>

          <!-- Actions Card -->
          <div class="bg-white rounded-lg shadow-sm overflow-hidden">
            <div class="px-6 py-4 border-b">
              <h3 class="text-lg font-medium text-gray-800">{{ t('shipmentPage.actions') }}</h3>
            </div>
            <div class="p-6">
              <div class="space-y-4">
                <button class="w-full inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500">
                  <Printer class="mr-2 h-4 w-4" />
                  {{ t('shipmentPage.printLabel') }}
                </button>
                <button class="w-full inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500">
                  <FileText class="mr-2 h-4 w-4 text-gray-500" />
                  {{ t('shipmentPage.downloadPod') }}
                </button>
                <button
                    class="w-full inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                    @click="sendTrackingInfo = true"
                >
                  <Mail class="mr-2 h-4 w-4 text-gray-500" />
                  {{ t('shipmentPage.emailTracking') }}
                </button>
                <button
                    v-if="shipment.status !== 'cancelled'"
                    class="w-full inline-flex items-center px-4 py-2 border border-red-300 rounded-md shadow-sm text-sm font-medium text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                >
                  <AlertOctagon class="mr-2 h-4 w-4 text-red-500" />
                  {{ t('shipmentPage.cancelShipment') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Status Update Modal -->
    <div
        v-if="updateStatus"
        class="fixed inset-0 z-10 overflow-y-auto"
        aria-labelledby="modal-title"
        role="dialog"
        aria-modal="true"
    >
      <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div
            class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
            aria-hidden="true"
            @click="updateStatus = false"
        ></div>

        <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

        <div class="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div class="sm:flex sm:items-start">
              <div class="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-purple-100 sm:mx-0 sm:h-10 sm:w-10">
                <Truck class="h-6 w-6 text-purple-600" />
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
                  class="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm rounded-md"
              >
                <option value="pending">{{ t('shipmentPage.statusPending') }}</option>
                <option value="processing">{{ t('shipmentPage.statusProcessing') }}</option>
                <option value="in_transit">{{ t('shipmentPage.statusInTransit') }}</option>
                <option value="out_for_delivery">{{ t('shipmentPage.statusOutForDelivery') }}</option>
                <option value="delivered">{{ t('shipmentPage.statusDelivered') }}</option>
                <option value="delayed">{{ t('shipmentPage.statusDelayed') }}</option>
                <option value="exception">{{ t('shipmentPage.statusException') }}</option>
              </select>
            </div>
            <div class="mt-4">
              <label for="location" class="block text-sm font-medium text-gray-700">{{ t('shipmentPage.currentLocation') }}</label>
              <input
                  type="text"
                  id="location"
                  v-model="statusLocation"
                  class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  :placeholder="t('shipmentPage.locationPlaceholder')"
              />
            </div>
            <div class="mt-4">
              <label for="notes" class="block text-sm font-medium text-gray-700">{{ t('shipmentPage.additionalNotes') }}</label>
              <textarea
                  id="notes"
                  v-model="statusNotes"
                  rows="3"
                  class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  :placeholder="t('shipmentPage.notesPlaceholder')"
              ></textarea>
            </div>
            <div class="mt-4 flex items-start">
              <div class="flex items-center h-5">
                <input
                    id="notify-customer"
                    v-model="notifyCustomer"
                    type="checkbox"
                    class="focus:ring-purple-500 h-4 w-4 text-purple-600 border-gray-300 rounded"
                />
              </div>
              <div class="ml-3 text-sm">
                <label for="notify-customer" class="font-medium text-gray-700">{{ t('shipmentPage.notifyCustomer') }}</label>
                <p class="text-gray-500">{{ t('shipmentPage.notifyCustomerDesc') }}</p>
              </div>
            </div>
          </div>
          <div class="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
                type="button"
                class="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-purple-600 text-base font-medium text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 sm:ml-3 sm:w-auto sm:text-sm"
                @click="updateShipmentStatus"
            >
              {{ t('shipmentPage.updateStatus') }}
            </button>
            <button
                type="button"
                class="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                @click="updateStatus = false"
            >
              {{ t('common.cancel') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Email Tracking Modal -->
    <div
        v-if="sendTrackingInfo"
        class="fixed inset-0 z-10 overflow-y-auto"
        aria-labelledby="modal-title"
        role="dialog"
        aria-modal="true"
    >
      <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div
            class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
            aria-hidden="true"
            @click="sendTrackingInfo = false"
        ></div>

        <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

        <div class="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div class="sm:flex sm:items-start">
              <div class="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-purple-100 sm:mx-0 sm:h-10 sm:w-10">
                <Mail class="h-6 w-6 text-purple-600" />
              </div>
              <div class="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                <h3 class="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                  {{ t('shipmentPage.emailTrackingTitle') }}
                </h3>
                <div class="mt-2">
                  <p class="text-sm text-gray-500">
                    {{ t('shipmentPage.emailTrackingDesc') }}
                  </p>
                </div>
              </div>
            </div>
            <div class="mt-4">
              <label for="recipient-email" class="block text-sm font-medium text-gray-700">{{ t('shipmentPage.recipientEmail') }}</label>
              <input
                  type="email"
                  id="recipient-email"
                  v-model="recipientEmail"
                  class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  :placeholder="shipment.customer.email"
              />
              <p class="mt-1 text-xs text-gray-500">{{ t('shipmentPage.leaveBlankForCustomer') }}</p>
            </div>
            <div class="mt-4">
              <label for="additional-recipients" class="block text-sm font-medium text-gray-700">{{ t('shipmentPage.additionalRecipients') }}</label>
              <input
                  type="text"
                  id="additional-recipients"
                  v-model="additionalRecipients"
                  class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  placeholder="email@example.com, another@example.com"
              />
              <p class="mt-1 text-xs text-gray-500">{{ t('shipmentPage.separateEmails') }}</p>
            </div>
            <div class="mt-4">
              <label for="email-message" class="block text-sm font-medium text-gray-700">{{ t('shipmentPage.additionalMessage') }}</label>
              <textarea
                  id="email-message"
                  v-model="emailMessage"
                  rows="3"
                  class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  :placeholder="t('shipmentPage.messagePlaceholder')"
              ></textarea>
            </div>
            <div class="mt-4">
              <label class="block text-sm font-medium text-gray-700">{{ t('shipmentPage.includeInEmail') }}</label>
              <div class="mt-2 space-y-2">
                <div class="flex items-center">
                  <input
                      id="include-tracking"
                      type="checkbox"
                      checked
                      disabled
                      class="h-4 w-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                  />
                  <label for="include-tracking" class="ml-2 text-sm text-gray-700">{{ t('shipmentPage.includeTracking') }}</label>
                </div>
                <div class="flex items-center">
                  <input
                      id="include-eta"
                      type="checkbox"
                      checked
                      class="h-4 w-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                  />
                  <label for="include-eta" class="ml-2 text-sm text-gray-700">{{ t('shipmentPage.includeEta') }}</label>
                </div>
                <div class="flex items-center">
                  <input
                      id="include-order"
                      type="checkbox"
                      checked
                      class="h-4 w-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                  />
                  <label for="include-order" class="ml-2 text-sm text-gray-700">{{ t('shipmentPage.includeOrder') }}</label>
                </div>
              </div>
            </div>
          </div>
          <div class="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
                type="button"
                class="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-purple-600 text-base font-medium text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 sm:ml-3 sm:w-auto sm:text-sm"
                @click="sendTrackingEmail"
            >
              {{ t('shipmentPage.sendEmail') }}
            </button>
            <button
                type="button"
                class="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                @click="sendTrackingInfo = false"
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
import { ref, computed, onMounted } from 'vue'
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
  FileText,
  Printer,
  Mail,
  Loader
} from 'lucide-vue-next'

const { t, locale } = useI18n()

const route = useRoute()
const router = useRouter()
const shipmentId = computed(() => route.params.id as string)

// State
const shipment = ref(null)
const isLoading = ref(true)
const error = ref(null)

// Modal states
const updateStatus = ref(false)
const sendTrackingInfo = ref(false)

// Form values for status update
const newStatus = ref('')
const statusLocation = ref('')
const statusNotes = ref('')
const notifyCustomer = ref(true)

// Form values for sending tracking info
const recipientEmail = ref('')
const additionalRecipients = ref('')
const emailMessage = ref('')

// Load shipment data
onMounted(async () => {
  try {
    // In a real app, this would be an API call
    // await fetchShipment(shipmentId.value)

    // For now, we'll simulate an API response with mock data
    await new Promise(resolve => setTimeout(resolve, 500))

    // Generate mock shipment data
    shipment.value = generateMockShipment(shipmentId.value)

    // Initialize the newStatus with the current status
    newStatus.value = shipment.value.status
  } catch (err) {
    error.value = 'Failed to load shipment data'
    console.error(err)
  } finally {
    isLoading.value = false
  }
})

// Format date with locale
const formatDate = (isoDate: string) => {
  if (!isoDate) return t('common.unknown')

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

// Format currency with locale
const formatCurrency = (amount: number) => {
  const currencyLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  const currency = locale.value === 'ko' ? 'KRW' : 'JPY'
  return new Intl.NumberFormat(currencyLocale, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount)
}

// Get carrier name from code
const getCarrierName = (code: string) => {
  const carriers = {
    fedex: 'FedEx',
    ups: 'UPS',
    usps: 'USPS',
    dhl: 'DHL'
  }

  return carriers[code] || code
}

// Get country name from code
const getCountryName = (code: string) => {
  const countryKey = `countries.${code.toLowerCase()}`
  const translated = t(countryKey)
  // Return the translation if found, otherwise return code
  return translated !== countryKey ? translated : code
}

// Get ETA class and text
const getETAClass = (shipment) => {
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

const getETAText = (shipment) => {
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
      return 'bg-purple-100'
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
      return 'text-purple-600'
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

// Copy to clipboard
const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text)
  // Could add a toast notification here
  alert(t('shipmentPage.copiedToClipboard', { text }))
}

// Track shipment externally
const trackShipment = (trackingNumber: string, carrier: string) => {
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
      alert(t('shipmentPage.noTrackingUrl'))
      return
  }

  window.open(trackingUrl, '_blank')
}

// Update shipment status
const updateShipmentStatus = () => {
  // In a real app, this would make an API call

  // Add new event to the timeline
  const now = new Date().toISOString()

  const newEvent = {
    type: newStatus.value,
    title: getStatusTitle(newStatus.value),
    timestamp: now,
    description: statusNotes.value,
    location: statusLocation.value
  }

  // Update shipment status and add new event
  shipment.value.status = newStatus.value
  shipment.value.events.unshift(newEvent)

  // Close modal
  updateStatus.value = false

  // Reset form
  statusLocation.value = ''
  statusNotes.value = ''

  // Show success message (in a real app, this would be a toast)
  alert(t('shipmentPage.statusUpdateSuccess'))
}

// Send tracking email
const sendTrackingEmail = () => {
  // In a real app, this would make an API call

  // Get the email recipient
  const email = recipientEmail.value || shipment.value.customer.email

  // Additional recipients
  const additional = additionalRecipients.value
      .split(',')
      .map(e => e.trim())
      .filter(e => e)

  // Log the email details (for demo purposes)
  console.log('Sending tracking info to:', email)
  console.log('Additional recipients:', additional)
  console.log('Message:', emailMessage.value)

  // Close modal
  sendTrackingInfo.value = false

  // Reset form
  recipientEmail.value = ''
  additionalRecipients.value = ''
  emailMessage.value = ''

  // Show success message (in a real app, this would be a toast)
  alert(t('shipmentPage.emailSentSuccess'))
}

// Helper to get status title
const getStatusTitle = (status: string) => {
  const statusKeys = {
    pending: 'eventPending',
    processing: 'eventProcessing',
    in_transit: 'eventInTransit',
    out_for_delivery: 'eventOutForDelivery',
    delivered: 'eventDelivered',
    delayed: 'eventDelayed',
    exception: 'eventException'
  }

  const key = statusKeys[status]
  return key ? t(`shipmentPage.${key}`) : t('shipmentPage.statusUpdated')
}

// Generate mock shipment for demo
const generateMockShipment = (id: string) => {
  // Create dates
  const now = new Date()
  const createdDate = new Date(now.getTime())
  createdDate.setDate(now.getDate() - Math.floor(Math.random() * 10)) // Last 10 days

  // Determine status and events randomly
  const possibleStatuses = ['pending', 'processing', 'in_transit', 'delivered', 'delayed']
  const randomStatus = possibleStatuses[Math.floor(Math.random() * possibleStatuses.length)]

  // Create events based on status
  const events = []

  // Always add created event
  events.push({
    type: 'created',
    title: 'Shipment Created',
    timestamp: createdDate.toISOString(),
    description: 'Shipping label created',
    location: 'Warehouse'
  })

  // Add processing event
  if (randomStatus !== 'pending') {
    const processingDate = new Date(createdDate.getTime())
    processingDate.setHours(processingDate.getHours() + 4)

    events.push({
      type: 'processing',
      title: 'Shipment Processing',
      timestamp: processingDate.toISOString(),
      description: 'Package received at origin facility',
      location: 'Origin Sorting Facility'
    })
  }

  // Add in_transit event
  if (randomStatus === 'in_transit' || randomStatus === 'delivered' || randomStatus === 'delayed') {
    const transitDate = new Date(createdDate.getTime())
    transitDate.setHours(transitDate.getHours() + 12)

    events.push({
      type: 'in_transit',
      title: 'In Transit',
      timestamp: transitDate.toISOString(),
      description: 'Package in transit to destination',
      location: 'In Transit'
    })

    // Add additional transit scan
    const transitDate2 = new Date(transitDate.getTime())
    transitDate2.setHours(transitDate2.getHours() + 12)

    events.push({
      type: 'in_transit',
      title: 'In Transit',
      timestamp: transitDate2.toISOString(),
      description: 'Package arrived at destination facility',
      location: 'Destination Sorting Facility'
    })
  }

  // Add out_for_delivery event
  if (randomStatus === 'delivered') {
    const deliveryDate = new Date(createdDate.getTime())
    deliveryDate.setHours(deliveryDate.getHours() + 36)

    events.push({
      type: 'out_for_delivery',
      title: 'Out for Delivery',
      timestamp: deliveryDate.toISOString(),
      description: 'Package is out for delivery',
      location: 'Local Delivery Facility'
    })

    // Add delivered event
    const deliveredDate = new Date(deliveryDate.getTime())
    deliveredDate.setHours(deliveredDate.getHours() + 6)

    events.push({
      type: 'delivered',
      title: 'Delivered',
      timestamp: deliveredDate.toISOString(),
      description: 'Package has been delivered',
      location: 'Recipient Address'
    })
  }

  // Add delayed event
  if (randomStatus === 'delayed') {
    const delayedDate = new Date(createdDate.getTime())
    delayedDate.setHours(delayedDate.getHours() + 24)

    events.push({
      type: 'delayed',
      title: 'Shipment Delayed',
      timestamp: delayedDate.toISOString(),
      description: 'Package delivery delayed due to weather conditions',
      location: 'Transit Hub'
    })
  }

  // Sort events by date (newest first)
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  // Create estimated delivery date
  let estimatedDelivery = new Date(createdDate.getTime())
  estimatedDelivery.setDate(estimatedDelivery.getDate() + 3 + Math.floor(Math.random() * 4)) // 3-7 days

  if (randomStatus === 'delivered') {
    // For delivered items, set ETA to delivery date
    const deliveredEvent = events.find(event => event.type === 'delivered')
    if (deliveredEvent) {
      estimatedDelivery = new Date(deliveredEvent.timestamp)
    }
  } else if (randomStatus === 'delayed') {
    // For delayed items, set ETA further out
    estimatedDelivery.setDate(estimatedDelivery.getDate() + 3) // Add 3 more days
  }

  // Random carrier
  const carriers = ['fedex', 'ups', 'usps', 'dhl']
  const randomCarrier = carriers[Math.floor(Math.random() * carriers.length)]

  // Random destination
  const countries = ['US', 'CA', 'UK', 'AU', 'DE', 'JP']
  const randomCountry = countries[Math.floor(Math.random() * countries.length)]

  const cities = {
    US: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Miami'],
    CA: ['Toronto', 'Vancouver', 'Montreal', 'Calgary', 'Ottawa'],
    UK: ['London', 'Manchester', 'Birmingham', 'Glasgow', 'Liverpool'],
    AU: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide'],
    DE: ['Berlin', 'Munich', 'Hamburg', 'Frankfurt', 'Cologne'],
    JP: ['Tokyo', 'Osaka', 'Kyoto', 'Yokohama', 'Nagoya']
  }

  const states = {
    US: ['NY', 'CA', 'IL', 'TX', 'FL'],
    CA: ['ON', 'BC', 'QC', 'AB', 'MB'],
    UK: ['LDN', 'MAN', 'BIR', 'GLA', 'LIV'],
    AU: ['NSW', 'VIC', 'QLD', 'WA', 'SA'],
    DE: ['BE', 'BY', 'HH', 'HE', 'NW'],
    JP: ['TK', 'OS', 'KY', 'KN', 'AI']
  }

  const randomCity = cities[randomCountry][Math.floor(Math.random() * cities[randomCountry].length)]
  const randomState = states[randomCountry][Math.floor(Math.random() * states[randomCountry].length)]

  // Mock shipment details
  return {
    id,
    trackingNumber: `${randomCarrier.toUpperCase()}-${Math.floor(Math.random() * 10000000)}`,
    carrier: randomCarrier,
    status: randomStatus,
    createdAt: createdDate.toISOString(),
    estimatedDelivery: estimatedDelivery.toISOString(),
    events,
    customer: {
      name: 'John Anderson',
      email: 'john.anderson@example.com'
    },
    orderId: `ORD-${9000 + parseInt(id.replace(/\D/g, ''))}`,
    destination: {
      address: `${123 + parseInt(id.replace(/\D/g, ''))} Main St`,
      city: randomCity,
      state: randomState,
      postalCode: `${10000 + Math.floor(Math.random() * 90000)}`,
      country: randomCountry
    },
    serviceType: 'Standard',
    packageType: 'Package',
    weight: (1 + Math.random() * 9).toFixed(2),
    weightUnit: 'kg',
    dimensions: '30cm x 20cm x 10cm',
    insurance: Math.random() > 0.5 ? (50 + Math.random() * 500).toFixed(2) : null,
    signatureRequired: Math.random() > 0.7
  }
}
</script>