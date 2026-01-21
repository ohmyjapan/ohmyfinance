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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useThemeStore } from '../stores/theme'
import { useLanguageStore } from '../stores/language'

const themeStore = useThemeStore()
const languageStore = useLanguageStore()
const isSidebarOpen = ref(false)

onMounted(() => {
  themeStore.initTheme()
  languageStore.initLanguage()
})
</script>
