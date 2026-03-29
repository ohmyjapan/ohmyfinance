<template>
  <div>
    <!-- Mobile sidebar overlay -->
    <div
        v-if="isOpen"
        class="fixed inset-0 z-40 lg:hidden"
        @click="$emit('close')"
    >
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
    </div>

    <!-- Mobile sidebar -->
    <div
        v-if="isOpen"
        class="fixed inset-y-0 left-0 flex flex-col z-40 w-64 bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border-r border-gray-200 dark:border-white/10 lg:hidden transition-transform duration-300 ease-in-out"
    >
      <div class="flex items-center justify-between px-4 py-4 border-b border-gray-200 dark:border-white/10">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-main to-primary-dark flex items-center justify-center shadow-sm">
            <Wallet class="w-4 h-4 text-white" />
          </div>
          <NuxtLink to="/" class="text-lg font-bold text-gray-900 dark:text-white">OhMyFinance</NuxtLink>
        </div>
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
                    ? 'bg-primary-main/10 text-primary-main dark:text-primary-light font-medium'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.07]',
                  'flex items-center px-3 py-2.5 rounded-xl group transition-all duration-200 relative'
                ]"
              >
                <div v-if="isActive(item.route)" class="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary-main rounded-r-full"></div>
                <component
                  :is="icons[item.icon]"
                  class="h-5 w-5 mr-3 transition-colors duration-200"
                  :class="isActive(item.route) ? 'text-primary-main dark:text-primary-light' : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300'"
                />
                <span class="text-sm">{{ item.name }}</span>
              </NuxtLink>
            </div>
          </div>
        </nav>

        <div class="p-4 border-t border-gray-200 dark:border-white/10">
          <div v-if="isAuthenticated && user" class="space-y-3">
            <div class="flex items-center">
              <div class="w-9 h-9 bg-gradient-to-br from-primary-main to-primary-dark rounded-xl flex items-center justify-center text-white text-sm font-medium shadow-sm">
                {{ user.name?.charAt(0)?.toUpperCase() || 'U' }}
              </div>
              <div class="ml-3 flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{{ user.name }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ user.email }}</p>
              </div>
            </div>
            <button
              @click="handleLogout"
              class="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-primary-main hover:bg-primary-main/10 dark:hover:bg-primary-main/20 rounded-xl touch-manipulation"
            >
              <LogOut class="h-4 w-4" />
              {{ t('auth.signOut') }}
            </button>
          </div>
          <div v-else>
            <NuxtLink
              to="/login"
              class="block w-full text-center px-3 py-2 text-sm text-primary-main hover:bg-primary-main/10 dark:hover:bg-primary-main/20 rounded-xl"
            >
              {{ t('auth.signIn') }}
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>

    <!-- Desktop sidebar -->
    <div class="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:z-40 lg:w-64 bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border-r border-gray-200 dark:border-white/10">
      <div class="flex items-center h-16 px-4 border-b border-gray-200 dark:border-white/10 gap-3">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-main to-primary-dark flex items-center justify-center shadow-sm">
          <Wallet class="w-4 h-4 text-white" />
        </div>
        <NuxtLink to="/" class="text-lg font-bold text-gray-900 dark:text-white">OhMyFinance</NuxtLink>
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
                    ? 'bg-primary-main/10 text-primary-main dark:text-primary-light font-medium'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.07]',
                  'flex items-center px-3 py-2.5 rounded-xl group transition-all duration-200 relative'
                ]"
              >
                <div v-if="isActive(item.route)" class="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary-main rounded-r-full"></div>
                <component
                  :is="icons[item.icon]"
                  class="h-5 w-5 mr-3 transition-colors duration-200"
                  :class="isActive(item.route) ? 'text-primary-main dark:text-primary-light' : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300'"
                />
                <span class="text-sm">{{ item.name }}</span>
              </NuxtLink>
            </div>
          </div>
        </nav>

        <div class="p-4 border-t border-gray-200 dark:border-white/10">
          <div v-if="isAuthenticated && user" class="space-y-3">
            <div class="flex items-center">
              <div class="w-9 h-9 bg-gradient-to-br from-primary-main to-primary-dark rounded-xl flex items-center justify-center text-white text-sm font-medium shadow-sm">
                {{ user.name?.charAt(0)?.toUpperCase() || 'U' }}
              </div>
              <div class="ml-3 flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{{ user.name }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ user.email }}</p>
              </div>
            </div>
            <button
              @click="handleLogout"
              class="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-primary-main hover:bg-primary-main/10 dark:hover:bg-primary-main/20 rounded-xl touch-manipulation"
            >
              <LogOut class="h-4 w-4" />
              {{ t('auth.signOut') }}
            </button>
          </div>
          <div v-else>
            <NuxtLink
              to="/login"
              class="block w-full text-center px-3 py-2 text-sm text-primary-main hover:bg-primary-main/10 dark:hover:bg-primary-main/20 rounded-xl"
            >
              {{ t('auth.signIn') }}
            </NuxtLink>
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
  User,
  Calendar,
  RefreshCw,
  BarChart3,
  FileSpreadsheet,
  History,
  Wallet,
  Receipt,
  Users,
  Copy,
  FileCheck,
  LogOut
} from 'lucide-vue-next'
import { computed } from 'vue'
import { useUserStore } from '~/stores/user'

defineProps({
  isOpen: {
    type: Boolean,
    default: false
  }
})

defineEmits(['close'])

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const userStore = useUserStore()

// Computed properties for template
const user = computed(() => userStore.user)
const isAuthenticated = computed(() => userStore.isAuthenticated)

const handleLogout = async () => {
  await userStore.logout()
  router.push('/login')
}

// Map icon names to components
const icons: Record<string, any> = {
  TrendingUp,
  CreditCard,
  Upload,
  Globe,
  FileText,
  Package,
  Settings,
  Code,
  Calendar,
  RefreshCw,
  BarChart3,
  FileSpreadsheet,
  History,
  Wallet,
  Receipt,
  Users,
  Copy,
  FileCheck,
  LogOut
}

// Navigation items with i18n keys
const navItems = computed(() => [
  {
    section: t('nav.dashboard'),
    items: [
      { name: t('nav.analytics'), icon: 'TrendingUp', route: '/' },
      { name: t('nav.reports'), icon: 'BarChart3', route: '/reports' },
      { name: t('nav.taxReport'), icon: 'FileCheck', route: '/reports/tax' },
      { name: t('nav.paymentCalendar'), icon: 'Calendar', route: '/calendar' }
    ]
  },
  {
    section: t('nav.transactions'),
    items: [
      { name: t('nav.allTransactions'), icon: 'CreditCard', route: '/transactions' },
      { name: t('nav.importData'), icon: 'Upload', route: '/transactions/upload' },
      { name: t('nav.recurringPayments'), icon: 'RefreshCw', route: '/recurring' },
      { name: t('nav.duplicates'), icon: 'Copy', route: '/transactions/duplicates' }
    ]
  },
  {
    section: t('nav.finance'),
    items: [
      { name: t('nav.budgets'), icon: 'Wallet', route: '/budgets' },
      { name: t('nav.invoices'), icon: 'Receipt', route: '/invoices' },
      { name: t('nav.vendors'), icon: 'Users', route: '/vendors' }
    ]
  },
  {
    section: t('nav.receipts'),
    items: [
      { name: t('nav.receiptManagement'), icon: 'FileText', route: '/receipts' },
      { name: t('nav.uploadReceipts'), icon: 'Upload', route: '/receipts/upload' }
    ]
  },
  {
    section: t('nav.shipments'),
    items: [
      { name: t('nav.shipmentTracking'), icon: 'Package', route: '/shipments' }
    ]
  },
  {
    section: t('nav.settings'),
    items: [
      { name: t('nav.generalSettings'), icon: 'Settings', route: '/settings' },
      { name: t('nav.organizationSettings'), icon: 'Users', route: '/settings/organization' },
      { name: t('nav.importTemplates'), icon: 'FileSpreadsheet', route: '/templates' },
      { name: t('nav.auditLog'), icon: 'History', route: '/audit' },
      { name: t('nav.apiConfiguration'), icon: 'Code', route: '/settings/api' }
    ]
  }
])

// Check if a route is active
const isActive = (path: string) => {
  return route.path === path
}
</script>
