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

        <div class="relative mx-4 md:block hidden">
          <span class="absolute inset-y-0 left-0 flex items-center pl-3">
            <Search class="text-gray-400 dark:text-gray-500 h-5 w-5" />
          </span>
          <input
              class="py-2 pl-10 pr-4 w-64 rounded-lg border border-gray-200 dark:border-gray-600 dark:bg-background-dark dark:text-gray-200 focus:outline-none focus:border-primary-main dark:focus:border-primary-light"
              placeholder="Search transactions..."
              type="text"
          />
        </div>
      </div>

      <div class="flex items-center gap-2 md:gap-4">
        <!-- Language Switcher -->
        <LangSwitcher />

        <!-- Theme Toggle -->
        <ThemeToggle />

        <!-- Notifications -->
        <button class="text-gray-500 dark:text-gray-400 focus:outline-none hover:text-gray-700 dark:hover:text-gray-300">
          <Bell class="h-6 w-6" />
        </button>

        <!-- User Profile -->
        <div class="relative hidden md:block">
          <div
              @click="isProfileOpen = !isProfileOpen"
              class="flex items-center cursor-pointer"
          >
            <div class="mr-2 text-right">
              <p class="text-sm font-medium text-gray-700 dark:text-gray-200">Admin User</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">admin@example.com</p>
            </div>
            <div class="h-8 w-8 rounded-full bg-primary-light dark:bg-primary-dark flex items-center justify-center text-primary-main dark:text-primary-light">
              <User class="h-5 w-5" />
            </div>
            <ChevronDown class="h-4 w-4 ml-1 text-gray-500 dark:text-gray-400" />
          </div>

          <div v-if="isProfileOpen"
               class="absolute right-0 mt-2 w-48 bg-white dark:bg-background-darkPaper rounded-md shadow-lg py-1 z-10 border dark:border-gray-700"
          >
            <a href="#" class="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
              Your Profile
            </a>
            <a href="#" class="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
              Settings
            </a>
            <a href="#" class="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
              Sign out
            </a>
          </div>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Menu, Search, Bell, User, ChevronDown } from 'lucide-vue-next'

const isProfileOpen = ref(false)

defineEmits(['toggleSidebar'])
</script>
