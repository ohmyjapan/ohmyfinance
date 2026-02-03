<template>
  <header class="bg-white dark:bg-background-darkPaper shadow-sm sticky top-0 z-10">
    <div class="flex items-center justify-between px-4 py-3 md:py-4">
      <div class="flex items-center">
        <button
            @click="$emit('toggleSidebar')"
            class="text-gray-500 dark:text-gray-400 focus:outline-none focus:text-gray-700 dark:focus:text-gray-300 lg:hidden"
        >
          <Menu class="h-6 w-6" />
        </button>

        <div class="mx-4 md:block hidden w-80">
          <GlobalSearch />
        </div>
      </div>

      <div class="flex items-center gap-2 md:gap-4">
        <!-- Language Switcher -->
        <LangSwitcher />

        <!-- Theme Toggle -->
        <ThemeToggle />

        <!-- Notifications -->
        <NotificationBell />

        <!-- User Profile -->
        <div class="relative hidden md:block">
          <div
              @click="isProfileOpen = !isProfileOpen"
              class="flex items-center cursor-pointer"
          >
            <div class="mr-2 text-right">
              <p class="text-sm font-medium text-gray-700 dark:text-gray-200">{{ userStore.user?.name || t('header.adminUser') }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ userStore.user?.email || '' }}</p>
            </div>
            <div class="h-8 w-8 rounded-full bg-primary-light dark:bg-primary-dark flex items-center justify-center text-primary-main dark:text-primary-light">
              {{ userStore.user?.name?.charAt(0)?.toUpperCase() || 'U' }}
            </div>
            <ChevronDown class="h-4 w-4 ml-1 text-gray-500 dark:text-gray-400" />
          </div>

          <div v-if="isProfileOpen"
               class="absolute right-0 mt-2 w-48 bg-white dark:bg-background-darkPaper rounded-md shadow-lg py-1 z-10 border dark:border-gray-700"
          >
            <NuxtLink to="/settings" class="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700" @click="isProfileOpen = false">
              {{ t('settings.title') }}
            </NuxtLink>
            <NuxtLink to="/reports" class="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700" @click="isProfileOpen = false">
              {{ t('reports.title') }}
            </NuxtLink>
            <NuxtLink to="/audit" class="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700" @click="isProfileOpen = false">
              {{ t('nav.auditLog') }}
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Menu, User, ChevronDown } from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

const { t } = useI18n()
const userStore = useUserStore()

const isProfileOpen = ref(false)

defineEmits(['toggleSidebar'])
</script>
