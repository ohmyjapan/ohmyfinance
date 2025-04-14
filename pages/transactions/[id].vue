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
      <h1 class="ml-2 text-xl font-medium text-gray-800">Transaction Details</h1>
    </div>

    <div v-if="isLoading" class="flex justify-center items-center h-64">
      <Loader size="32" class="text-purple-600 animate-spin" />
    </div>

    <div v-else-if="error" class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
      {{ error }}
    </div>

    <template v-else>
      <!-- Transaction Summary Card -->
      <TransactionSummary :transaction="transaction" />

      <!-- Two Column Layout for Details -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        <!-- Left Column - 2/3 width -->
        <div class="lg:col-span-2 space-y-6">
          <!-- Items Card -->
          <TransactionItems :items="transaction.items" />

          <!-- Shipment Card -->
          <ShipmentInfo
              v-if="transaction.shipment"
              :shipment="transaction.shipment"
          />
        </div>

        <!-- Right Column - 1/3 width -->
        <div class="space-y-6">
          <!-- Status Timeline Card -->
          <TransactionTimeline :events="transaction.timeline" />

          <!-- Receipt Upload Card -->
          <ReceiptCard
              :receipt="transaction.receipt"
              :transaction-id="transaction.id"
          />

          <!-- Related Transactions Card -->
          <RelatedTransactions
              v-if="transaction.relatedTransactions && transaction.relatedTransactions.length > 0"
              :transactions="transaction.relatedTransactions"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ArrowLeft, Loader } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const transactionId = computed(() => route.params.id as string)

const transaction = ref(null)
const isLoading = ref(true)
const error = ref(null)

onMounted(async () => {
  try {
    // In a real app, this would be an API call
    // await fetchTransaction(transactionId.value)

    // For now, we'll simulate an API response with mock data
    await new Promise(resolve => setTimeout(resolve, 500))

    transaction.value = {
      id: transactionId.value,
      reference: `CC-89734-XTR`,
      createdAt: '2025-04-12T15:32:00Z',
      status: 'completed',
      source: 'Credit Card',
      amount: 1459.00,
      currency: 'USD',
      customer: {
        name: 'John Anderson',
        email: 'john.anderson@example.com'
      },
      paymentMethod: {
        type: 'VISA',
        last4: '4242',
        expiryDate: '09/2027'
      },
      processor: {
        name: 'VISA Direct',
        gatewayId: 'VD-89223'
      },
      items: [
        {
          name: 'Premium Subscription',
          description: '12-month plan',
          quantity: 1,
          price: 1199.00,
          total: 1199.00
        },
        {
          name: 'Add-on Package',
          description: 'Premium support',
          quantity: 1,
          price: 260.00,
          total: 260.00
        }
      ],
      shipment: {
        trackingNumber: 'TN-7829-9087-6512',
        status: 'in_transit',
        address: {
          name: 'John Anderson',
          line1: '123 Main Street',
          line2: 'Apt 4B',
          city: 'New York',
          state: 'NY',
          postalCode: '10001',
          country: 'United States'
        },
        shippingMethod: {
          name: 'Express Shipping',
          estimatedDelivery: '2025-04-15',
          carrier: 'FedEx'
        }
      },
      timeline: [
        {
          type: 'completed',
          title: 'Transaction Completed',
          timestamp: '2025-04-12T15:32:00Z',
          description: 'Payment successfully processed and confirmed.'
        },
        {
          type: 'processing',
          title: 'Payment Processing',
          timestamp: '2025-04-12T15:30:00Z'
        },
        {
          type: 'created',
          title: 'Order Placed',
          timestamp: '2025-04-12T15:28:00Z'
        },
        {
          type: 'contact',
          title: 'Customer Contact',
          timestamp: '2025-04-12T15:25:00Z'
        }
      ],
      receipt: null,
      relatedTransactions: [
        {
          id: 'TRX-7645',
          date: '2025-04-05',
          amount: 299.00,
          status: 'completed'
        },
        {
          id: 'TRX-7550',
          date: '2025-03-28',
          amount: 1459.00,
          status: 'refunded'
        },
        {
          id: 'TRX-7320',
          date: '2025-03-11',
          amount: 59.99,
          status: 'completed'
        }
      ]
    }

  } catch (err) {
    error.value = 'Failed to load transaction data'
    console.error(err)
  } finally {
    isLoading.value = false
  }
})
</script>