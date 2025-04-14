<template>
  <div>
    <!-- Mobile sidebar overlay -->
    <div
        v-if="isOpen"
        class="fixed inset-0 z-40 lg:hidden"
        @click="$emit('close')"
    >
      <div class="absolute inset-0 bg-gray-600 opacity-75"></div>
    </div>

    <!-- Mobile sidebar -->
    <div
        v-if="isOpen"
        class="fixed inset-y-0 left-0 flex flex-col z-40 w-64 bg-white shadow-lg lg:hidden transition-transform duration-300 ease-in-out"
    >
      <div class="flex items-center justify-between px-4 py-4 border-b">
        <router-link to="/" class="text-xl font-bold text-purple-600">TransactHub</router-link>
        <button
            @click="$emit('close')"
            class="text-gray-500 hover:text-gray-700 focus:outline-none"
        >
          <X class="h-6 w-6" />
        </button>
      </div>

      <SidebarContent />
    </div>

    <!-- Desktop sidebar -->
    <div class="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:z-40 lg:w-64 bg-white shadow-md">
      <div class="flex items-center h-16 px-4 border-b">
        <router-link to="/" class="text-xl font-bold text-purple-600">TransactHub</router-link>
      </div>

      <SidebarContent />
    </div>
  </div>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'

defineProps({
  isOpen: {
    type: Boolean,
    default: false
  }
})

defineEmits(['close'])
</script>

<script lang="ts">
// Using a separate component for the sidebar content to avoid duplication
const SidebarContent = {
  setup() {
    const { useRouter, useRoute } = useNuxtApp()
    const router = useRouter()
    const route = useRoute()

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

    // Dynamic component import for Lucide icons
    const getIcon = (iconName: string) => {
      return resolveComponent(iconName)
    }

    return {
      navItems,
      isActive,
      getIcon
    }
  },

  template: `
    <div class="flex flex-col flex-grow overflow-y-auto">
      <nav class="flex-1 p-4 space-y-8">
        <div v-for="(section, index) in navItems" :key="index">
          <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            {{ section.section }}
          </h2>

          <div class="space-y-1">
            <router-link
              v-for="item in section.items"
              :key="item.name"
              :to="item.route"
              :class="[
                isActive(item.route)
                  ? 'bg-purple-50 text-purple-600'
                  : 'text-gray-600 hover:bg-gray-100',
                'flex items-center px-4 py-2 rounded-lg group'
              ]"
            >
              <component
                :is="getIcon(item.icon)"
                class="h-5 w-5 mr-3"
                :class="isActive(item.route) ? 'text-purple-600' : 'text-gray-500 group-hover:text-gray-600'"
              />
              <span>{{ item.name }}</span>
            </router-link>
          </div>
        </div>
      </nav>

      <div class="p-4 border-t">
        <div class="flex items-center">
          <div class="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center text-purple-600">
            <User size="18" />
          </div>
          <div class="ml-3">
            <p class="text-sm font-medium">Admin User</p>
            <p class="text-xs text-gray-500">admin@example.com</p>
          </div>
        </div>
      </div>
    </div>
  `
}
</script>