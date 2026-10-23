<template>
  <div class="min-h-screen bg-background-default dark:bg-gradient-to-br dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 text-gray-900 dark:text-gray-100" :class="naviClass">
    <AppSidebar :is-open="isSidebarOpen" @close="isSidebarOpen = false" />

    <div class="lg:pl-64 flex min-w-0 flex-col flex-1">
      <AppHeader data-app-header class="!z-30" @toggle-sidebar="isSidebarOpen = !isSidebarOpen" />

      <main class="navi-host min-w-0 flex-1 p-4 md:p-6">
        <div class="navi-page-frame min-w-0 max-w-7xl mx-auto">
          <div data-page-content>
            <slot />
          </div>
        </div>
      </main>

      <AppFooter class="navi-host" />
    </div>

    <AssistantPanel />

    <!-- Screen Lock Overlay -->
    <ScreenLockOverlay />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import AssistantPanel from '~/components/finance/AssistantPanel.vue'
import { useThemeStore } from '../stores/theme'
import { useLanguageStore } from '../stores/language'
import { useActivityTracker } from '~/composables/useActivityTracker'
import { useUserStore } from '~/stores/user'
import { useAssistantStore } from '~/stores/assistant'

const themeStore = useThemeStore()
const languageStore = useLanguageStore()
const userStore = useUserStore()
const assistant = useAssistantStore()
const isSidebarOpen = ref(false)

const { init: initActivityTracker, configure: configureActivityTracker, isLocked } = useActivityTracker()
// Navi's layout contract on the root: the chosen size token the dock reads, open (the right reserve widens to the rail) and off (locked or signed out).
const naviClass = computed(() => ['navi-layout', 'navi-size-' + assistant.size, { 'navi-open': assistant.open, 'navi-off': !userStore.isAuthenticated || isLocked.value }])

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
