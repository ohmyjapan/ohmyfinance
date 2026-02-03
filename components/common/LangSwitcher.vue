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
        <button
          @click="selectLanguage('ja')"
          :class="[
            'flex items-center w-full px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700',
            locale === 'ja' ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-gray-300'
          ]"
        >
          <span class="mr-2">🇯🇵</span>
          <span>日本語</span>
        </button>
        <button
          @click="selectLanguage('ko')"
          :class="[
            'flex items-center w-full px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700',
            locale === 'ko' ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-gray-300'
          ]"
        >
          <span class="mr-2">🇰🇷</span>
          <span>한국어</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const { locale, setLocale } = useI18n()
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

const selectLanguage = async (lang: string) => {
  await setLocale(lang)
  isOpen.value = false
}

const languageEmoji = computed(() => {
  switch (locale.value) {
    case 'ko': return '🇰🇷'
    case 'ja': return '🇯🇵'
    default: return '🇯🇵'
  }
})

const languageName = computed(() => {
  switch (locale.value) {
    case 'ko': return '한국어'
    case 'ja': return '日本語'
    default: return '日本語'
  }
})
</script>
