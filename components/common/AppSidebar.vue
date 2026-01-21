<template>
  <div>
    <!-- Mobile sidebar overlay -->
    <div
        v-if="isOpen"
        class="fixed inset-0 z-40 lg:hidden"
        @click="$emit('close')"
    >
      <div class="absolute inset-0 bg-gray-600 dark:bg-gray-900 opacity-75"></div>
    </div>

    <!-- Mobile sidebar -->
    <div
        v-if="isOpen"
        class="fixed inset-y-0 left-0 flex flex-col z-40 w-64 bg-white dark:bg-background-darkPaper shadow-lg lg:hidden transition-transform duration-300 ease-in-out"
    >
      <div class="flex items-center justify-between px-4 py-4 border-b dark:border-gray-700">
        <NuxtLink to="/" class="text-xl font-bold text-primary-main">OhMyFinance</NuxtLink>
        <button
            @click="$emit('close')"
            class="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 focus:outline-none"
        >
          <X class="h-6 w-6" />
        </button>
      </div>

      <div class="flex flex-col flex-grow overflow-y-auto">
        <nav class="flex-1 p-4 space-y-8">
          <div v-for="(section, index) in navItems" :key="index">
            <h2 class="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
              {{ section.section }}
            </h2>

            <div class="space-y-1">
              <NuxtLink
                v-for="item in section.items"
                :key="item.name"
                :to="item.route"
                :class="[
                  isActive(item.route)
                    ? 'bg-primary-light dark:bg-primary-dark/20 text-primary-main dark:text-primary-light'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700',
                  'flex items-center px-4 py-2 rounded-lg group'
                ]"
              >
                <component
                  :is="icons[item.icon]"
                  class="h-5 w-5 mr-3"
                  :class="isActive(item.route) ? 'text-primary-main dark:text-primary-light' : 'text-gray-500 dark:text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300'"
                />
                <span>{{ item.name }}</span>
              </NuxtLink>
            </div>
          </div>
        </nav>

        <div class="p-4 border-t dark:border-gray-700">
          <div class="flex items-center">
            <div class="w-8 h-8 bg-primary-light dark:bg-primary-dark rounded-full flex items-center justify-center text-primary-main dark:text-primary-light">
              <User :size="18" />
            </div>
            <div class="ml-3">
              <p class="text-sm font-medium text-gray-700 dark:text-gray-200">Admin User</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">admin@example.com</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Desktop sidebar -->
    <div class="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:z-40 lg:w-64 bg-white dark:bg-background-darkPaper shadow-md">
      <div class="flex items-center h-16 px-4 border-b dark:border-gray-700">
        <NuxtLink to="/" class="text-xl font-bold text-primary-main">OhMyFinance</NuxtLink>
      </div>

      <div class="flex flex-col flex-grow overflow-y-auto">
        <nav class="flex-1 p-4 space-y-8">
          <div v-for="(section, index) in navItems" :key="index">
            <h2 class="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
              {{ section.section }}
            </h2>

            <div class="space-y-1">
              <NuxtLink
                v-for="item in section.items"
                :key="item.name"
                :to="item.route"
                :class="[
                  isActive(item.route)
                    ? 'bg-primary-light dark:bg-primary-dark/20 text-primary-main dark:text-primary-light'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700',
                  'flex items-center px-4 py-2 rounded-lg group'
                ]"
              >
                <component
                  :is="icons[item.icon]"
                  class="h-5 w-5 mr-3"
                  :class="isActive(item.route) ? 'text-primary-main dark:text-primary-light' : 'text-gray-500 dark:text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300'"
                />
                <span>{{ item.name }}</span>
              </NuxtLink>
            </div>
          </div>
        </nav>

        <div class="p-4 border-t dark:border-gray-700">
          <div class="flex items-center">
            <div class="w-8 h-8 bg-primary-light dark:bg-primary-dark rounded-full flex items-center justify-center text-primary-main dark:text-primary-light">
              <User :size="18" />
            </div>
            <div class="ml-3">
              <p class="text-sm font-medium text-gray-700 dark:text-gray-200">Admin User</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">admin@example.com</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  X,
  TrendingUp,
  CreditCard,
  Upload,
  Globe,
  FileText,
  Package,
  Settings,
  Code,
  User
} from 'lucide-vue-next'

defineProps({
  isOpen: {
    type: Boolean,
    default: false
  }
})

defineEmits(['close'])

const route = useRoute()

// Map icon names to components
const icons: Record<string, any> = {
  TrendingUp,
  CreditCard,
  Upload,
  Globe,
  FileText,
  Package,
  Settings,
  Code
}

// Navigation items
const navItems = [
  {
    section: 'Dashboard',
    items: [
      { name: 'Analytics', icon: 'TrendingUp', route: '/' }
    ]
  },
  {
    section: 'Transactions',
    items: [
      { name: 'All Transactions', icon: 'CreditCard', route: '/transactions' },
      { name: 'Import Data', icon: 'Upload', route: '/transactions/upload' },
      { name: 'Overseas Orders', icon: 'Globe', route: '/transactions/overseas' }
    ]
  },
  {
    section: 'Receipts',
    items: [
      { name: 'Receipt Management', icon: 'FileText', route: '/receipts' },
      { name: 'Upload Receipts', icon: 'Upload', route: '/receipts/upload' }
    ]
  },
  {
    section: 'Shipments',
    items: [
      { name: 'Shipment Tracking', icon: 'Package', route: '/shipments' }
    ]
  },
  {
    section: 'Settings',
    items: [
      { name: 'General Settings', icon: 'Settings', route: '/settings' },
      { name: 'API Configuration', icon: 'Code', route: '/settings/api' }
    ]
  }
]

// Check if a route is active
const isActive = (path: string) => {
  return route.path === path
}
</script>
