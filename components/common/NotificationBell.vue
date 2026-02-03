<template>
  <div class="relative" ref="container">
    <button
      @click="toggleDropdown"
      class="relative p-2 text-gray-500 hover:text-gray-700 focus:outline-none"
    >
      <Bell class="h-5 w-5" />
      <span
        v-if="unreadCount > 0"
        class="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center"
      >
        {{ unreadCount > 9 ? '9+' : unreadCount }}
      </span>
    </button>

    <!-- Dropdown -->
    <div
      v-if="showDropdown"
      class="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50"
    >
      <div class="px-4 py-3 border-b border-gray-200 flex justify-between items-center">
        <h3 class="font-medium text-gray-900">{{ t('notifications.title') }}</h3>
        <button @click="refresh" class="text-gray-400 hover:text-gray-600">
          <RefreshCw :class="['h-4 w-4', isLoading ? 'animate-spin' : '']" />
        </button>
      </div>

      <div class="max-h-96 overflow-y-auto">
        <div v-if="isLoading && notifications.length === 0" class="p-4 text-center text-gray-500">
          {{ t('common.loading') }}
        </div>
        <div v-else-if="notifications.length === 0" class="p-4 text-center text-gray-500">
          {{ t('notifications.noNotifications') }}
        </div>
        <div v-else>
          <NuxtLink
            v-for="notification in notifications"
            :key="notification.id"
            :to="notification.url"
            @click="showDropdown = false"
            class="block px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-0"
          >
            <div class="flex items-start">
              <div :class="getPriorityDot(notification.priority)" class="w-2 h-2 rounded-full mt-2 mr-3 flex-shrink-0"></div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-gray-900">{{ notification.title }}</div>
                <div class="text-sm text-gray-500 truncate">{{ notification.message }}</div>
                <div v-if="notification.amount" class="text-sm font-medium text-purple-600 mt-1">
                  {{ formatCurrency(notification.amount) }}
                </div>
              </div>
            </div>
          </NuxtLink>
        </div>
      </div>

      <div class="px-4 py-3 border-t border-gray-200 text-center">
        <NuxtLink to="/recurring" @click="showDropdown = false" class="text-sm text-purple-600 hover:text-purple-700">
          {{ t('notifications.viewAll') }}
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Bell, RefreshCw } from 'lucide-vue-next'

const { t, locale } = useI18n()

const container = ref<HTMLElement | null>(null)
const showDropdown = ref(false)
const isLoading = ref(false)
const notifications = ref<any[]>([])
const unreadCount = ref(0)

const loadNotifications = async () => {
  isLoading.value = true
  try {
    const data = await $fetch('/api/notifications')
    notifications.value = data.notifications
    unreadCount.value = data.unreadCount
  } catch (error) {
    console.error('Failed to load notifications:', error)
  } finally {
    isLoading.value = false
  }
}

const toggleDropdown = () => {
  showDropdown.value = !showDropdown.value
  if (showDropdown.value && notifications.value.length === 0) {
    loadNotifications()
  }
}

const refresh = () => {
  loadNotifications()
}

const formatCurrency = (amount: number) => {
  const currencyLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  const currency = locale.value === 'ko' ? 'KRW' : 'JPY'
  return new Intl.NumberFormat(currencyLocale, { style: 'currency', currency, minimumFractionDigits: 0 }).format(amount)
}

const getPriorityDot = (priority: string) => {
  switch (priority) {
    case 'high': return 'bg-red-500'
    case 'medium': return 'bg-yellow-500'
    default: return 'bg-gray-300'
  }
}

const handleClickOutside = (event: MouseEvent) => {
  if (container.value && !container.value.contains(event.target as Node)) {
    showDropdown.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  loadNotifications()
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>
