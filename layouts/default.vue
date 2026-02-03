<template>
  <div class="min-h-screen bg-background-default dark:bg-background-dark text-gray-900 dark:text-gray-100">
    <AppSidebar :is-open="isSidebarOpen" @close="isSidebarOpen = false" />

    <div class="lg:pl-64 flex flex-col flex-1">
      <AppHeader @toggle-sidebar="isSidebarOpen = !isSidebarOpen" />

      <main class="flex-1 p-4 md:p-6 bg-background-default dark:bg-background-dark">
        <slot />
      </main>

      <AppFooter />
    </div>

    <!-- Screen Lock Overlay -->
    <ScreenLockOverlay />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useThemeStore } from '../stores/theme'
import { useLanguageStore } from '../stores/language'
import { useActivityTracker } from '~/composables/useActivityTracker'
import { useUserStore } from '~/stores/user'

const themeStore = useThemeStore()
const languageStore = useLanguageStore()
const userStore = useUserStore()
const isSidebarOpen = ref(false)

const { init: initActivityTracker, configure: configureActivityTracker } = useActivityTracker()

onMounted(() => {
  themeStore.initTheme()
  languageStore.initLanguage()

  // Initialize activity tracker if authenticated
  if (userStore.isAuthenticated) {
    initActivityTracker()
  }
})

// Configure activity tracker based on user preferences
watch(() => userStore.user?.securityPreferences, (prefs) => {
  if (prefs) {
    configureActivityTracker({
      screenLockTimeout: prefs.screenLockTimeout || 15,
      forceLogoutTimeout: prefs.forceLogoutTimeout || 8
    })
  }
}, { immediate: true })
</script>
