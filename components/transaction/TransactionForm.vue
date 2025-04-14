<template>
  <div class="bg-white rounded-lg shadow-sm">
    <div class="p-6">
      <h2 class="text-lg font-medium text-gray-900 mb-6">
        {{ isEditing ? 'Edit Transaction' : 'Create New Transaction' }}
      </h2>

      <form @submit.prevent="submitForm">
        <!-- Transaction Details Section -->
        <div class="grid grid-cols-1 gap-6 mb-8">
          <h3 class="text-sm font-medium text-gray-700 col-span-full">Transaction Details</h3>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <!-- Transaction Source -->
            <div>
              <label for="source" class="block text-sm font-medium text-gray-700 mb-1">Transaction Source</label>
              <select
                  id="source"
                  v-model="form.source"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  required
              >
                <option value="credit_card">Credit Card</option>
                <option value="payment_gateway">Payment Gateway</option>
                <option value="overseas">Overseas</option>
                <option value="manual">Manual Entry</option>
              </select>
            </div>

            <!-- Amount -->
            <div>
              <label for="amount" class="block text-sm font-medium text-gray-700 mb-1">Amount</label>
              <div class="mt-1 relative rounded-md shadow-sm">
                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span class="text-gray-500 sm:text-sm">{{ currencySymbol }}</span>
                </div>
                <input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0"
                    v-model="form.amount"
                    class="block w-full pl-7 pr-12 border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                    placeholder="0.00"
                    required
                />
                <div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <span class="text-gray-500 sm:text-sm">{{ form.currency }}</span>
                </div>
              </div>
            </div>

            <!-- Currency -->
            <div>
              <label for="currency" class="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <select
                  id="currency"
                  v-model="form.currency"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  required
              >
                <option value="USD">USD - US Dollar</option>
                <option value="EUR">EUR - Euro</option>
                <option value="GBP">GBP - British Pound</option>
                <option value="JPY">JPY - Japanese Yen</option>
                <option value="CAD">CAD - Canadian Dollar</option>
                <option value="AUD">AUD - Australian Dollar</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- Reference ID -->
            <div>
              <label for="reference" class="block text-sm font-medium text-gray-700 mb-1">Reference ID</label>
              <input
                  id="reference"
                  type="text"
                  v-model="form.reference"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  placeholder="Transaction reference number"
              />
              <p class="mt-1 text-xs text-gray-500">
                Leave blank to auto-generate a reference number
              </p>
            </div>

            <!-- Status -->
            <div>
              <label for="status" class="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                  id="status"
                  v-model="form.status"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  required
              >
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="refunded">Refunded</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Customer Information Section -->
        <div class="grid grid-cols-1 gap-6 mb-8">
          <h3 class="text-sm font-medium text-gray-700 col-span-full">Customer Information</h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- Customer Name -->
            <div>
              <label for="customer-name" class="block text-sm font-medium text-gray-700 mb-1">Customer Name</label>
              <input
                  id="customer-name"
                  type="text"
                  v-model="form.customer.name"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  placeholder="Full name"
                  required
              />
            </div>

            <!-- Customer Email -->
            <div>
              <label for="customer-email" class="block text-sm font-medium text-gray-700 mb-1">Customer Email</label>
              <input
                  id="customer-email"
                  type="email"
                  v-model="form.customer.email"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  placeholder="email@example.com"
                  required
              />
            </div>
          </div>
        </div>

        <!-- Payment Method Section -->
        <div class="grid grid-cols-1 gap-6 mb-8">
          <div class="flex items-center justify-between col-span-full">
            <h3 class="text-sm font-medium text-gray-700">Payment Method</h3>
            <div class="flex items-center">
              <input
                  id="has-payment-method"
                  type="checkbox"
                  v-model="hasPaymentMethod"
                  class="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
              />
              <label for="has-payment-method" class="ml-2 block text-sm text-gray-900">
                Include payment method details
              </label>
            </div>
          </div>

          <div v-if="hasPaymentMethod" class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <!-- Payment Type -->
            <div>
              <label for="payment-type" class="block text-sm font-medium text-gray-700 mb-1">Card Type</label>
              <select
                  id="payment-type"
                  v-model="form.paymentMethod.type"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
              >
                <option value="VISA">VISA</option>
                <option value="MasterCard">MasterCard</option>
                <option value="American Express">American Express</option>
                <option value="Discover">Discover</option>
                <option value="PayPal">PayPal</option>
              </select>
            </div>

            <!-- Last 4 Digits -->
            <div>
              <label for="last4" class="block text-sm font-medium text-gray-700 mb-1">Last 4 Digits</label>
              <input
                  id="last4"
                  type="text"
                  v-model="form.paymentMethod.last4"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  placeholder="1234"
                  maxlength="4"
                  pattern="[0-9]{4}"
              />
            </div>

            <!-- Expiry Date -->
            <div>
              <label for="expiry-date" class="block text-sm font-medium text-gray-700 mb-1">Expiry Date</label>
              <input
                  id="expiry-date"
                  type="text"
                  v-model="form.paymentMethod.expiryDate"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  placeholder="MM/YYYY"
              />
            </div>
          </div>
        </div>

        <!-- Processor Information Section -->
        <div class="grid grid-cols-1 gap-6 mb-8">
          <div class="flex items-center justify-between col-span-full">
            <h3 class="text-sm font-medium text-gray-700">Processor Information</h3>
            <div class="flex items-center">
              <input
                  id="has-processor"
                  type="checkbox"
                  v-model="hasProcessor"
                  class="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
              />
              <label for="has-processor" class="ml-2 block text-sm text-gray-900">
                Include processor details
              </label>
            </div>
          </div>

          <div v-if="hasProcessor" class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- Processor Name -->
            <div>
              <label for="processor-name" class="block text-sm font-medium text-gray-700 mb-1">Processor Name</label>
              <input
                  id="processor-name"
                  type="text"
                  v-model="form.processor.name"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  placeholder="e.g. Stripe, PayPal"
              />
            </div>

            <!-- Gateway ID -->
            <div>
              <label for="gateway-id" class="block text-sm font-medium text-gray-700 mb-1">Gateway ID</label>
              <input
                  id="gateway-id"
                  type="text"
                  v-model="form.processor.gatewayId"
                  class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  placeholder="Gateway reference ID"
              />
            </div>
          </div>
        </div>

        <!-- Notes Section -->
        <div class="grid grid-cols-1 gap-6 mb-8">
          <h3 class="text-sm font-medium text-gray-700">Notes</h3>
          <div>
            <textarea
                v-model="form.notes"
                rows="3"
                class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                placeholder="Add any notes about this transaction"
            ></textarea>
          </div>
        </div>

        <!-- Form Actions -->
        <div class="flex justify-end space-x-3">
          <button
              type="button"
              class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
              @click="$emit('cancel')"
          >
            Cancel
          </button>
          <button
              type="submit"
              class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
              :disabled="isSubmitting"
          >
            <span v-if="isSubmitting">
              <Loader class="animate-spin mr-2 h-4 w-4" />
              Saving...
            </span>
            <span v-else>
              {{ isEditing ? 'Update Transaction' : 'Create Transaction' }}
              <Save class="ml-2 h-4 w-4" />
            </span>
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Loader, Save } from 'lucide-vue-next'

const props = defineProps({
  transaction: {
    type: Object,
    default: () => null
  }
})

const emit = defineEmits(['submit', 'cancel'])

// State
const isSubmitting = ref(false)
const hasPaymentMethod = ref(false)
const hasProcessor = ref(false)

// Form data
const form = ref({
  source: 'manual',
  amount: '',
  currency: 'USD',
  reference: '',
  status: 'pending',
  customer: {
    name: '',
    email: ''
  },
  paymentMethod: {
    type: 'VISA',
    last4: '',
    expiryDate: ''
  },
  processor: {
    name: '',
    gatewayId: ''
  },
  notes: ''
})

// Computed properties
const isEditing = computed(() => !!props.transaction)

const currencySymbol = computed(() => {
  const symbols = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    CAD: 'C$',
    AUD: 'A$'
  }
  return symbols[form.value.currency] || '$'
})

// Initialize form data if editing
onMounted(() => {
  if (props.transaction) {
    // Pre-fill form with transaction data
    form.value = {
      source: props.transaction.source || 'manual',
      amount: props.transaction.amount || '',
      currency: props.transaction.currency || 'USD',
      reference: props.transaction.reference || '',
      status: props.transaction.status || 'pending',
      customer: {
        name: props.transaction.customer?.name || '',
        email: props.transaction.customer?.email || ''
      },
      paymentMethod: {
        type: props.transaction.paymentMethod?.type || 'VISA',
        last4: props.transaction.paymentMethod?.last4 || '',
        expiryDate: props.transaction.paymentMethod?.expiryDate || ''
      },
      processor: {
        name: props.transaction.processor?.name || '',
        gatewayId: props.transaction.processor?.gatewayId || ''
      },
      notes: props.transaction.notes || ''
    }

    // Set checkboxes based on data
    hasPaymentMethod.value = !!props.transaction.paymentMethod
    hasProcessor.value = !!props.transaction.processor
  }
})

// Form submission
const submitForm = async () => {
  isSubmitting.value = true

  try {
    // Prepare data for submission - remove empty optional sections
    const formData = { ...form.value }

    if (!hasPaymentMethod.value) {
      delete formData.paymentMethod
    }

    if (!hasProcessor.value) {
      delete formData.processor
    }

    // In a real app, you would send this data to your API
    // await apiClient.saveTransaction(formData)

    // Emit the submit event with form data
    emit('submit', formData)

    // Reset form if creating a new transaction
    if (!isEditing.value) {
      resetForm()
    }
  } catch (error) {
    console.error('Error saving transaction:', error)
    // Handle error - perhaps show an error message
  } finally {
    isSubmitting.value = false
  }
}

// Reset form to initial state
const resetForm = () => {
  form.value = {
    source: 'manual',
    amount: '',
    currency: 'USD',
    reference: '',
    status: 'pending',
    customer: {
      name: '',
      email: ''
    },
    paymentMethod: {
      type: 'VISA',
      last4: '',
      expiryDate: ''
    },
    processor: {
      name: '',
      gatewayId: ''
    },
    notes: ''
  }
  hasPaymentMethod.value = false
  hasProcessor.value = false
}
</script>