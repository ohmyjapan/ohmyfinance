<template>
  <div class="relative">
    <button @click="toggleDropdown" class="flex items-center px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md">
      <span class="mx-1">{{ languageEmoji }}</span>
      <span class="mx-1 hidden md:inline">{{ languageName }}</span>
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <!-- Dropdown Menu -->
    <div v-if="isOpen" class="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg z-50 border dark:border-gray-700">
      <div class="py-1">
        <button @click="forceSelectLanguage('en')" class="flex items-center w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
          <span class="mr-2">🇺🇸</span>
          <span>English</span>
        </button>
        <button @click="forceSelectLanguage('ko')" class="flex items-center w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
          <span class="mr-2">🇰🇷</span>
          <span>한국어</span>
        </button>
        <button @click="forceSelectLanguage('ja')" class="flex items-center w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
          <span class="mr-2">🇯🇵</span>
          <span>日本語</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useLanguageStore, type Language } from '../../stores/language'

const languageStore = useLanguageStore()
const isOpen = ref(false)

onMounted(() => {
  document.addEventListener('click', closeDropdownOnOutsideClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeDropdownOnOutsideClick)
})

const toggleDropdown = (event: Event) => {
  event.stopPropagation()
  isOpen.value = !isOpen.value
}

const closeDropdownOnOutsideClick = () => {
  if (isOpen.value) {
    isOpen.value = false
  }
}

const forceSelectLanguage = (lang: Language) => {
  if (process.client) {
    localStorage.setItem('forcedLanguage', lang)
  }
  languageStore.setLanguage(lang)
  isOpen.value = false
}

const languageEmoji = computed(() => {
  switch (languageStore.current) {
    case 'en': return '🇺🇸'
    case 'ko': return '🇰🇷'
    case 'ja': return '🇯🇵'
    default: return '🇺🇸'
  }
})

const languageName = computed(() => {
  switch (languageStore.current) {
    case 'en': return 'English'
    case 'ko': return '한국어'
    case 'ja': return '日本語'
    default: return 'English'
  }
})
</script>
