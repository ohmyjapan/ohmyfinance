<template>
  <header class="bg-white shadow-sm sticky top-0 z-10">
    <div class="flex items-center justify-between px-4 py-3 md:py-4">
      <div class="flex items-center">
        <button
            @click="$emit('toggleSidebar')"
            class="text-gray-500 focus:outline-none focus:text-gray-700 lg:hidden"
        >
          <Menu class="h-6 w-6" />
        </button>

        <div class="relative mx-4 md:block hidden">
          <span class="absolute inset-y-0 left-0 flex items-center pl-3">
            <Search class="text-gray-400 h-5 w-5" />
          </span>
          <input
              class="py-2 pl-10 pr-4 w-64 rounded-lg border border-gray-200 focus:outline-none focus:border-purple-500"
              placeholder="Search transactions..."
              type="text"
          />
        </div>
      </div>

      <div class="flex items-center gap-4">
        <button class="text-gray-500 focus:outline-none hover:text-gray-700">
          <Bell class="h-6 w-6" />
        </button>

        <div class="relative hidden md:block">
          <div
              @click="isProfileOpen = !isProfileOpen"
              class="flex items-center cursor-pointer"
          >
            <div class="mr-2 text-right">
              <p class="text-sm font-medium text-gray-700">Admin User</p>
              <p class="text-xs text-gray-500">admin@example.com</p>
            </div>
            <div class="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-600">
              <User class="h-5 w-5" />
            </div>
            <ChevronDown class="h-4 w-4 ml-1 text-gray-500" />
          </div>

          <div v-if="isProfileOpen"
               class="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-10"
          >
            <a href="#" class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
              Your Profile
            </a>
            <a href="#" class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
              Settings
            </a>
            <a href="#" class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
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