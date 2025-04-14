<template>
  <div>
    <div class="mb-8">
      <h1 class="text-2xl font-bold text-gray-800">Transaction Dashboard</h1>
      <p class="text-gray-600">Overview of all transaction activities</p>
    </div>

    <!-- Stats Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <StatCard
          title="Total Transactions"
          value="8,492"
          change="+4.5%"
          trend="up"
          icon="CreditCard"
          color="purple"
      />

      <StatCard
          title="Pending Matching"
          value="142"
          change="+12.3%"
          trend="down"
          icon="FileText"
          color="blue"
      />

      <StatCard
          title="Shipments"
          value="3,845"
          change="+2.8%"
          trend="up"
          icon="Package"
          color="green"
      />

      <StatCard
          title="Unmatched Receipts"
          value="67"
          change="-5.2%"
          trend="up"
          icon="FileText"
          color="amber"
      />
    </div>

    <!-- Recent Transactions Table -->
    <div class="bg-white rounded-lg shadow overflow-hidden mb-8">
      <div class="p-6 border-b">
        <h2 class="text-lg font-semibold text-gray-800">Recent Transactions</h2>
      </div>

      <TransactionTable :transactions="recentTransactions" />

      <div class="p-4 border-t">
        <div class="flex items-center justify-between">
          <p class="text-sm text-gray-600">Showing 4 of 250 transactions</p>
          <div class="flex space-x-1">
            <button class="px-3 py-1 border rounded text-sm">Previous</button>
            <button class="px-3 py-1 bg-purple-600 text-white rounded text-sm">1</button>
            <button class="px-3 py-1 border rounded text-sm">2</button>
            <button class="px-3 py-1 border rounded text-sm">3</button>
            <button class="px-3 py-1 border rounded text-sm">Next</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CreditCard, FileText, Package } from 'lucide-vue-next'

// Mock data for recent transactions
const recentTransactions = [
  {
    id: 'TRX-7829',
    source: 'Credit Card',
    amount: '$1,459.00',
    date: 'Apr 12, 2025',
    status: 'completed'
  },
  {
    id: 'TRX-7828',
    source: 'Payment Gateway',
    amount: '$849.99',
    date: 'Apr 11, 2025',
    status: 'pending'
  },
  {
    id: 'TRX-7827',
    source: 'Overseas Order',
    amount: '$2,135.00',
    date: 'Apr 10, 2025',
    status: 'failed'
  },
  {
    id: 'TRX-7826',
    source: 'Credit Card',
    amount: '$599.00',
    date: 'Apr 09, 2025',
    status: 'processing'
  }
]
</script>