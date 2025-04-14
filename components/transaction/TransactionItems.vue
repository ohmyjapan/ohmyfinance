<template>
  <div class="bg-white rounded-lg shadow overflow-hidden">
    <div class="px-6 py-4 border-b">
      <h3 class="text-lg font-medium text-gray-800">Transaction Items</h3>
    </div>
    <div class="overflow-x-auto">
      <table class="min-w-full divide-y">
        <thead class="bg-gray-50">
        <tr>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            Item
          </th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            Quantity
          </th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            Price
          </th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            Total
          </th>
        </tr>
        </thead>
        <tbody class="bg-white divide-y">
        <tr v-for="(item, index) in items" :key="index">
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="text-sm font-medium text-gray-900">{{ item.name }}</div>
            <div class="text-sm text-gray-500">{{ item.description }}</div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
            {{ item.quantity }}
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
            {{ formatCurrency(item.price) }}
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
            {{ formatCurrency(item.total) }}
          </td>
        </tr>
        </tbody>
        <tfoot class="bg-gray-50">
        <tr>
          <td colspan="3" class="px-6 py-3 text-right text-sm font-medium text-gray-900">
            Subtotal
          </td>
          <td class="px-6 py-3 text-sm text-gray-900">
            {{ formatCurrency(subtotal) }}
          </td>
        </tr>
        <tr>
          <td colspan="3" class="px-6 py-3 text-right text-sm font-medium text-gray-900">
            Tax
          </td>
          <td class="px-6 py-3 text-sm text-gray-900">
            {{ formatCurrency(tax) }}
          </td>
        </tr>
        <tr>
          <td colspan="3" class="px-6 py-3 text-right text-sm font-bold text-gray-900">
            Total
          </td>
          <td class="px-6 py-3 text-sm font-bold text-gray-900">
            {{ formatCurrency(total) }}
          </td>
        </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  items: {
    type: Array,
    required: true
  },
  currency: {
    type: String,
    default: 'USD'
  },
  taxRate: {
    type: Number,
    default: 0 // 0% tax by default
  }
})

// Calculate subtotal
const subtotal = computed(() => {
  return props.items.reduce((total, item) => total + item.total, 0)
})

// Calculate tax amount
const tax = computed(() => {
  return subtotal.value * (props.taxRate / 100)
})

// Calculate total
const total = computed(() => {
  return subtotal.value + tax.value
})

// Format currency with proper symbol and decimals
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: props.currency
  }).format(amount)
}
</script>